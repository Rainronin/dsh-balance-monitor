var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
import z from '@deepseek-ai/schemastery';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
/** 插件名（loader 诊断用） */
export const name = 'balance-monitor';
/** 凭证引用名格式：与 dsh-credentials 的 credentialRef 校验保持一致 */
const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** 配置 schema（Schemastery）：cordis.patch.yml 里的 config 按它校验 */
const BalanceConfig = z.object({
    /** 凭证引用名（环境变量名），默认复用 dsh 的 DeepSeek key */
    apiKeyEnv: z.string().pattern(CREDENTIAL_REF_PATTERN).default('DEEPSEEK_API_KEY'),
    /** 缓存有效期（毫秒）：TTL 内不重复请求官方接口 */
    cacheTtlMs: z.number().min(1).default(30_000),
    /** 后台轮询间隔（毫秒） */
    pollIntervalMs: z.number().min(1).default(30_000),
    /** 是否每轮对话注入余额快照到模型上下文 */
    injectEveryTurn: z.boolean().default(false),
    /** 官方接口请求超时（毫秒） */
    requestTimeoutMs: z.number().min(1).default(5_000),
});
export const Config = BalanceConfig;
const BALANCE_ENDPOINT = 'https://api.deepseek.com/user/balance';
/** 币种显示顺序：CNY 排最前 */
const CURRENCY_ORDER = ['CNY', 'USD'];
// ── 峰谷计价规则 ──────────────────────────────────────────────
/** 峰谷计价生效时间：2026-08-17 00:00 北京时间（UTC+8） */
const PRICING_EFFECTIVE_AT_MS = Date.UTC(2026, 7, 16, 16);
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
/** 北京时间的每日阶段边界（分钟）：09:00 / 12:00 / 14:00 / 18:00 */
const PRICING_BOUNDARY_MINUTES = [9 * 60, 12 * 60, 14 * 60, 18 * 60];
const PEAK_WINDOW_MINUTES = [
    [9 * 60, 12 * 60],
    [14 * 60, 18 * 60],
];
/** 解析官方响应为快照；字段缺失的币种跳过，全部无效则抛错 */
function parseBalance(data) {
    const payload = (typeof data === 'object' && data !== null ? data : {});
    const rawInfos = Array.isArray(payload.balance_infos) ? payload.balance_infos : [];
    const infos = rawInfos.flatMap((raw) => {
        if (typeof raw?.currency !== 'string' ||
            raw.currency.length === 0 ||
            typeof raw.total_balance !== 'string' ||
            typeof raw.granted_balance !== 'string' ||
            typeof raw.topped_up_balance !== 'string')
            return []; // 该币种字段不完整：跳过，不影响其他币种
        return [{
                currency: raw.currency,
                totalBalance: raw.total_balance,
                grantedBalance: raw.granted_balance,
                toppedUpBalance: raw.topped_up_balance,
            }];
    });
    if (infos.length === 0)
        throw new Error('官方响应中没有有效的 balance_infos 条目');
    // CNY 优先，其余按码点稳定排列（不依赖运行环境 locale）
    infos.sort((a, b) => {
        const ia = CURRENCY_ORDER.indexOf(a.currency);
        const ib = CURRENCY_ORDER.indexOf(b.currency);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0);
    });
    return {
        isAvailable: payload.is_available === true,
        infos,
        fetchedAt: Date.now(),
    };
}
/** 余额快照渲染为模型可见的中文文本 */
function renderBalanceText(snapshot, staleMs) {
    const lines = snapshot.infos.map((info) => `${info.currency} 总余额 ${info.totalBalance}（赠送 ${info.grantedBalance} + 充值 ${info.toppedUpBalance}）`);
    const availability = snapshot.isAvailable ? '余额可用' : '余额不可用（官方标记 is_available=false）';
    const time = new Date(snapshot.fetchedAt).toLocaleString('zh-CN', { hour12: false });
    const stale = staleMs === undefined ? '' : `；快照已过期 ${Math.round(staleMs / 1000)}s（最近一次刷新失败，自动重试中，展示上次成功抓取的数据）`;
    return `DeepSeek 余额快照（${time}）：${lines.join('；')}。${availability}${stale}`;
}
/** 构造注入上下文的用户消息（snapshot 形式，同官方 time-context 插件的模式） */
function balanceContextMessage(text) {
    return createUserMessage({
        content: [{ type: 'text', text }],
        source: {
            kind: 'plugin',
            plugin: name,
            form: 'snapshot',
            sections: [{ name, text }],
        },
    });
}
/** 内部失败：携带稳定错误码，并声明失败后是否应丢弃旧缓存 */
class BalanceFetchError extends Error {
    code;
    clearCache;
    constructor(code, message, clearCache = false) {
        super(message);
        this.code = code;
        this.clearCache = clearCache;
        this.name = 'BalanceFetchError';
    }
}
/** 给一个 Promise 加 AbortSignal 竞速（credentials.resolve 本身不接收 signal） */
function abortable(promise, signal) {
    if (signal.aborted)
        return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
        const onAbort = () => {
            signal.removeEventListener('abort', onAbort);
            reject(signal.reason);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then((value) => {
            signal.removeEventListener('abort', onAbort);
            resolve(value);
        }, (error) => {
            signal.removeEventListener('abort', onAbort);
            reject(error);
        });
    });
}
/** 计算给定时刻（epoch 毫秒）的北京时间当天 00:00 对应的 epoch */
function beijingDayStart(epoch) {
    const shifted = epoch + BEIJING_OFFSET_MS;
    return shifted - (shifted % DAY_MS) - BEIJING_OFFSET_MS;
}
/** 根据官方峰谷窗口计算当前计价状态；生效前也按窗口预览，effectiveAt 供 UI 提示 */
function computePricingState(now) {
    const dayStart = beijingDayStart(now);
    const msIntoDay = now - dayStart;
    for (const [startMinute, endMinute] of PEAK_WINDOW_MINUTES) {
        const start = dayStart + startMinute * MINUTE_MS;
        const end = dayStart + endMinute * MINUTE_MS;
        if (now >= start && now < end) {
            return {
                phase: 'peak',
                observedAt: now,
                nextChangeAt: end,
                peakRemainingMs: end - now,
                effectiveAt: PRICING_EFFECTIVE_AT_MS,
            };
        }
    }
    const nextBoundaryMinute = PRICING_BOUNDARY_MINUTES.find((minute) => minute * MINUTE_MS > msIntoDay);
    const nextChangeAt = nextBoundaryMinute === undefined
        ? dayStart + DAY_MS + PRICING_BOUNDARY_MINUTES[0] * MINUTE_MS
        : dayStart + nextBoundaryMinute * MINUTE_MS;
    return {
        phase: 'offpeak',
        observedAt: now,
        nextChangeAt,
        peakRemainingMs: 0,
        effectiveAt: PRICING_EFFECTIVE_AT_MS,
    };
}
// ── 会话费用估算（官方 V4 峰谷价格）──────────────────────────
/** DeepSeek 官方 V4 峰谷单价（元 / 百万 tokens），2026-08-17 起生效 */
const DEEPSEEK_V4_PRICES = {
    flash: {
        peak: { cacheRead: 0.10, cacheMiss: 3.0, output: 9.0 },
        offpeak: { cacheRead: 0.05, cacheMiss: 1.5, output: 4.5 },
    },
    pro: {
        peak: { cacheRead: 0.30, cacheMiss: 9.0, output: 27.0 },
        offpeak: { cacheRead: 0.15, cacheMiss: 4.5, output: 13.5 },
    },
};
/** 从模型 id 推断 V4 档位；未知模型按 Flash 估算（ponytail: 官方 V4 只有 Flash/Pro 两档） */
function modelTierOf(model) {
    const id = (model ?? '').toLowerCase();
    if (id.includes('pro'))
        return 'pro';
    return 'flash';
}
/** 扫描一个会话的事件日志，按官方 V4 峰谷价格估算累计费用 */
export function computeSessionCost(events) {
    const stats = {
        costYuan: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        model: undefined,
    };
    for (const event of events) {
        if (event.type === 'request/context') {
            stats.model = event.data.model;
        }
        else if (event.type === 'request/header' && stats.model === undefined) {
            stats.model = event.data.header.config.model;
        }
        else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
            const usage = event.data.usage;
            const tier = modelTierOf(stats.model);
            const phase = computePricingState(event.time).phase;
            const price = DEEPSEEK_V4_PRICES[tier][phase === 'peak' ? 'peak' : 'offpeak'];
            const cacheMiss = usage.inputTokens + (usage.cacheWriteTokens ?? 0);
            const cacheRead = usage.cacheReadTokens ?? 0;
            stats.costYuan += (cacheMiss * price.cacheMiss + cacheRead * price.cacheRead + usage.outputTokens * price.output) / 1_000_000;
            stats.inputTokens += usage.inputTokens;
            stats.cacheReadTokens += cacheRead;
            stats.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
            stats.outputTokens += usage.outputTokens;
        }
    }
    return stats;
}
/** 费用数字格式化为人民币字符串（元，最多 4 位小数，去尾零） */
function formatCostYuan(cost) {
    return cost.toFixed(4).replace(/\.?0+$/, '');
}
/**
 * 余额服务：缓存、轮询、工具、上下文注入、浏览器 RPC 的统一宿主。
 * 服务键 `balance` 同时是 Remote wire 命名空间。
 *
 * 挂载方式（与官方 GoalService / DynamicCordisRunnerService 同构）：
 * loader 行直接加载本模块的 default 导出类，服务因此注册在 entry ctx。
 */
let BalanceRemoteService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _get_decorators;
    let _refresh_decorators;
    let _sessionCost_decorators;
    return class BalanceRemoteService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _get_decorators = [Remote('get')];
            _refresh_decorators = [Remote('refresh')];
            _sessionCost_decorators = [Remote('sessionCost')];
            __esDecorate(this, null, _get_decorators, { kind: "method", name: "get", static: false, private: false, access: { has: obj => "get" in obj, get: obj => obj.get }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _refresh_decorators, { kind: "method", name: "refresh", static: false, private: false, access: { has: obj => "refresh" in obj, get: obj => obj.refresh }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _sessionCost_decorators, { kind: "method", name: "sessionCost", static: false, private: false, access: { has: obj => "sessionCost" in obj, get: obj => obj.sessionCost }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        config = __runInitializers(this, _instanceExtraInitializers);
        static inject = ['credentials', 'tools', 'timer', 'sessions'];
        static Config = BalanceConfig;
        /** 最近一次成功抓取的快照 */
        cached;
        /** 最近一次失败（用于在无缓存时给出真实错误，而不是一律报“未配置凭证”） */
        lastError;
        /** 在途请求（串行化：同一时刻最多一个） */
        inflight;
        constructor(ctx, config) {
            super(ctx, 'balance');
            this.config = config;
            // ── 1. 后台轮询：每 pollIntervalMs 刷新一次（TTL 内为 no-op） ──
            ctx.interval(() => { void this.refreshCached(false); }, config.pollIntervalMs);
            // ── 2. 每轮注入：只读缓存，失败/未配置时静默跳过 ──
            ctx.on('agent/pre-step', async ({ agent, turn, step, signal }, next) => {
                const decision = await next();
                if (decision.kind === 'reject' || signal.aborted)
                    return decision;
                if (!config.injectEveryTurn)
                    return decision;
                const peek = this.peekCached();
                if (peek === undefined)
                    return decision;
                const staleMs = peek.staleMs > config.cacheTtlMs ? peek.staleMs : undefined;
                const text = renderBalanceText(peek.snapshot, staleMs);
                return {
                    kind: 'enter',
                    messages: [...decision.messages, balanceContextMessage(text)],
                };
            }, { prepend: true });
            // ── 3. 会话内查询工具：ds_balance ──
            const cacheSeconds = Math.max(1, Math.round(config.cacheTtlMs / 1000));
            ctx.tools.register(defineTool({
                name: 'ds_balance',
                description: `查询 DeepSeek API 账户当前剩余余额（官方 /user/balance 接口快照，含赠送/充值拆分与多币种；缓存有效期 ${cacheSeconds} 秒）`,
                parameters: {
                    force: {
                        type: 'boolean',
                        description: `true 时穿透 ${cacheSeconds} 秒缓存立即请求官方接口；省略或 false 时优先返回缓存`,
                    },
                },
                output: {
                    schema: {
                        type: 'object',
                        additionalProperties: false,
                        properties: {
                            ok: { type: 'boolean', required: true },
                            isAvailable: { type: 'boolean' },
                            infos: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    additionalProperties: false,
                                    properties: {
                                        currency: { type: 'string', required: true },
                                        totalBalance: { type: 'string' },
                                        grantedBalance: { type: 'string' },
                                        toppedUpBalance: { type: 'string' },
                                    },
                                },
                            },
                            fetchedAt: { type: 'number' },
                            staleMs: { type: 'number' },
                            error: { type: 'string' },
                            code: { type: 'string' },
                        },
                    },
                    render: (_args, value) => [{
                            type: 'text',
                            // 展示层防御构造：schema 推断的可选字段全部落默认值后按快照渲染
                            // staleMs 用 0 表示"新鲜"，只有 > 0 才按陈旧快照渲染
                            text: value.ok
                                ? renderBalanceText({
                                    isAvailable: value.isAvailable ?? false,
                                    infos: (value.infos ?? []),
                                    fetchedAt: value.fetchedAt ?? 0,
                                }, value.staleMs !== undefined && value.staleMs > 0 ? value.staleMs : undefined)
                                : value.error ?? '余额查询失败',
                        }],
                },
                timeoutMs: config.requestTimeoutMs + 1_000, // 协作超时预算：接口超时 + 解析余量
                // 箭头函数：闭包捕获服务实例的 this；exec.signal 让工具取消能中断底层请求
                execute: async (args, exec) => {
                    const wire = await this.readWire(args.force === true, exec.signal);
                    if (!wire.ok)
                        throw new Error(wire.error ?? '余额查询失败');
                    return wire;
                },
            }));
        }
        /** 抓取一次官方余额接口（不做缓存判断）；所有失败都带稳定错误码抛出 */
        async fetchBalance(externalSignal) {
            const timeoutSignal = AbortSignal.timeout(this.config.requestTimeoutMs);
            const signal = externalSignal === undefined
                ? timeoutSignal
                : AbortSignal.any([timeoutSignal, externalSignal]);
            let ref;
            try {
                ref = credentialRef(this.config.apiKeyEnv);
            }
            catch {
                throw new BalanceFetchError('invalid-credential-ref', `凭证引用名 ${this.config.apiKeyEnv} 格式不合法（仅允许 POSIX 环境变量名），请修改本插件 config.apiKeyEnv`, true);
            }
            let hit;
            try {
                hit = await abortable(this.ctx.credentials.resolve(ref), signal);
            }
            catch (error) {
                if (externalSignal?.aborted)
                    throw error;
                if (timeoutSignal.aborted) {
                    throw new BalanceFetchError('upstream-timeout', `凭证解析超时（${this.config.requestTimeoutMs}ms）`);
                }
                throw new BalanceFetchError('credential-resolve-error', `凭证服务解析失败：${String(error)}`);
            }
            if (hit === undefined) {
                throw new BalanceFetchError('missing-credential', `未配置凭证 ${this.config.apiKeyEnv}，无法查询余额：请在 dsh 凭证中配置该环境变量，或在本插件 config 里把 apiKeyEnv 改为其他引用名`, true);
            }
            let res;
            try {
                res = await fetch(BALANCE_ENDPOINT, {
                    headers: {
                        Authorization: `Bearer ${hit.value}`,
                        Accept: 'application/json',
                    },
                    signal,
                });
            }
            catch (error) {
                if (externalSignal?.aborted)
                    throw error;
                if (timeoutSignal.aborted) {
                    throw new BalanceFetchError('upstream-timeout', `请求官方接口超时（${this.config.requestTimeoutMs}ms）`);
                }
                throw new BalanceFetchError('upstream-network-error', `请求官方接口失败：${String(error)}`);
            }
            if (!res.ok) {
                const keyRejected = res.status === 401 || res.status === 403;
                throw new BalanceFetchError(keyRejected ? 'invalid-api-key' : 'upstream-http-error', keyRejected
                    ? `API key 无效或未授权（官方接口返回 HTTP ${res.status}）`
                    : `官方接口返回 HTTP ${res.status}`, keyRejected);
            }
            try {
                return parseBalance(await res.json());
            }
            catch (error) {
                throw new BalanceFetchError('upstream-invalid-response', `官方响应格式无效：${String(error)}`);
            }
        }
        /**
         * 刷新缓存：
         * - force=false 且缓存未过期 → 直接返回缓存（不请求网络）
         * - 否则抓取；同一时刻最多一个在途请求（串行化）
         * - 抓取失败 → 记录真实错误码；网络类失败回退旧缓存，凭证类失败丢弃旧缓存
         */
        refreshCached(force, signal) {
            const { cacheTtlMs } = this.config;
            if (!force && this.cached !== undefined && Date.now() - this.cached.fetchedAt < cacheTtlMs) {
                if (signal?.aborted)
                    return Promise.reject(signal.reason);
                return Promise.resolve(this.cached);
            }
            if (signal?.aborted)
                return Promise.reject(signal.reason);
            if (this.inflight !== undefined)
                return this.inflight;
            this.inflight = (async () => {
                try {
                    const next = await this.fetchBalance(signal);
                    this.cached = next;
                    this.lastError = undefined;
                    return next;
                }
                catch (error) {
                    // 调用方主动取消：原样抛出，不把取消当成余额查询失败
                    if (signal?.aborted)
                        throw error;
                    const failure = error instanceof BalanceFetchError
                        ? error
                        : new BalanceFetchError('upstream-error', `余额查询失败：${String(error)}`);
                    this.lastError = { code: failure.code, message: failure.message };
                    if (failure.clearCache)
                        this.cached = undefined;
                    // 未配置/引用名非法是预期状态，不刷错误日志；其余失败记录诊断
                    if (failure.code !== 'missing-credential' && failure.code !== 'invalid-credential-ref') {
                        this.ctx.logger.warn('[balance-monitor] 余额接口请求失败，回退缓存：%s', failure.message);
                    }
                    return this.cached;
                }
                finally {
                    this.inflight = undefined;
                }
            })();
            return this.inflight;
        }
        /** 纯缓存读：绝不触发网络请求（供 pre-step 注入使用，保证主循环零阻塞） */
        peekCached() {
            if (this.cached === undefined)
                return undefined;
            return { snapshot: this.cached, staleMs: Date.now() - this.cached.fetchedAt };
        }
        /** 组装工具/模型可见的核心 BalanceWire */
        async readWire(force, signal) {
            const snapshot = await this.refreshCached(force, signal);
            if (snapshot === undefined) {
                const failure = this.lastError ?? {
                    code: 'missing-credential',
                    message: `未配置凭证 ${this.config.apiKeyEnv}，无法查询余额`,
                };
                return {
                    ok: false,
                    isAvailable: false,
                    infos: [],
                    fetchedAt: 0,
                    staleMs: 0,
                    code: failure.code,
                    error: failure.message,
                };
            }
            const staleMs = Date.now() - snapshot.fetchedAt;
            return {
                ok: true,
                isAvailable: snapshot.isAvailable,
                infos: snapshot.infos,
                fetchedAt: snapshot.fetchedAt,
                staleMs: staleMs > this.config.cacheTtlMs ? staleMs : 0,
            };
        }
        /** 组装浏览器徽章 wire：核心余额 + 峰谷计价 + 轮询间隔 */
        async readClientWire(force) {
            const wire = await this.readWire(force);
            return {
                ...wire,
                pricing: computePricingState(Date.now()),
                pollIntervalMs: this.config.pollIntervalMs,
            };
        }
        /** Remote：走缓存读取余额（浏览器徽章轮询用） */
        get() {
            return this.readClientWire(false);
        }
        /** Remote：穿透缓存强制刷新（浏览器 SYNC 按钮用） */
        refresh() {
            return this.readClientWire(true);
        }
        /** Remote：读取指定会话的累计费用（当前侧边栏随会话切换调用） */
        // ponytail: 每次按需扫描完整事件日志；若未来会话极长可改为 session-projection 增量折叠
        sessionCost(sessionId) {
            const session = this.ctx.sessions.get(sessionId);
            if (session === undefined) {
                return Promise.resolve({
                    ok: false,
                    sessionId,
                    error: `会话 ${sessionId} 不存在或未挂载`,
                });
            }
            const stats = computeSessionCost(session.events);
            return Promise.resolve({
                ok: true,
                sessionId,
                cost: formatCostYuan(stats.costYuan),
            });
        }
    };
})();
export { BalanceRemoteService };
/** 插件主体：loader 直接挂载 default 导出的服务类（entry ctx 注册，官方模式） */
export default BalanceRemoteService;
