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
// 仅引入类型合并：cordis-plugin-timer 把 ctx.setInterval 等声明 merge 进 Context
import '@deepseek-ai/cordis-plugin-timer';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
/** 插件名（loader 诊断用） */
export const name = 'balance-monitor';
/** 主插件依赖的服务（与 BalanceRemoteService 的 static inject 保持一致） */
export const inject = ['credentials', 'tools', 'timer'];
/** 配置 schema（Schemastery）：cordis.patch.yml 里的 config 按它校验 */
const BalanceConfig = z.object({
    /** 凭证引用名（环境变量名），默认复用 dsh 的 DeepSeek key */
    apiKeyEnv: z.string().default('DEEPSEEK_API_KEY'),
    /** 缓存有效期（毫秒）：TTL 内不重复请求官方接口 */
    cacheTtlMs: z.number().default(30_000),
    /** 后台轮询间隔（毫秒） */
    pollIntervalMs: z.number().default(30_000),
    /** 是否每轮对话注入余额快照到模型上下文 */
    injectEveryTurn: z.boolean().default(true),
    /** 官方接口请求超时（毫秒） */
    requestTimeoutMs: z.number().default(5_000),
});
export const Config = BalanceConfig;
const BALANCE_ENDPOINT = 'https://api.deepseek.com/user/balance';
/** 币种显示顺序：CNY 排最前 */
const CURRENCY_ORDER = ['CNY', 'USD'];
/** 解析官方响应为快照；字段缺失的币种跳过，全部无效则抛错 */
function parseBalance(data) {
    const rawInfos = Array.isArray(data.balance_infos) ? data.balance_infos : [];
    const infos = rawInfos.flatMap((raw) => {
        if (typeof raw?.currency !== 'string' ||
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
    // CNY 优先，其余按字母序稳定排列
    infos.sort((a, b) => {
        const ia = CURRENCY_ORDER.indexOf(a.currency);
        const ib = CURRENCY_ORDER.indexOf(b.currency);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.currency.localeCompare(b.currency);
    });
    return {
        isAvailable: data.is_available === true,
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
/**
 * 余额服务：缓存、轮询、工具、上下文注入、浏览器 RPC 的统一宿主。
 * 服务键 `balance` 同时是 Remote wire 命名空间。
 *
 * 挂载方式（与官方 GoalService / DynamicCordisRunnerService 同构）：
 * loader 行直接加载本模块的 default 导出类，服务因此注册在 entry ctx——
 * api-gateway 的 ctx.get('balance') 与 typert-loader 的 strict 定义都能解析到它。
 */
let BalanceRemoteService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _get_decorators;
    let _refresh_decorators;
    return class BalanceRemoteService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _get_decorators = [Remote('get')];
            _refresh_decorators = [Remote('refresh')];
            __esDecorate(this, null, _get_decorators, { kind: "method", name: "get", static: false, private: false, access: { has: obj => "get" in obj, get: obj => obj.get }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _refresh_decorators, { kind: "method", name: "refresh", static: false, private: false, access: { has: obj => "refresh" in obj, get: obj => obj.refresh }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        config = __runInitializers(this, _instanceExtraInitializers);
        static inject = ['credentials', 'tools', 'timer'];
        static Config = BalanceConfig;
        /** 最近一次成功抓取的快照 */
        cached;
        /** 在途请求（串行化：同一时刻最多一个） */
        inflight;
        constructor(ctx, config) {
            super(ctx, 'balance');
            this.config = config;
            // ── 1. 后台轮询：每 pollIntervalMs 刷新一次（TTL 内为 no-op） ──
            ctx.setInterval(() => { void this.refreshCached(false); }, config.pollIntervalMs);
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
            ctx.tools.register(defineTool({
                name: 'ds_balance',
                description: '查询 DeepSeek API 账户当前剩余余额（官方 /user/balance 接口快照，含赠送/充值拆分与多币种）',
                parameters: {
                    force: {
                        type: 'boolean',
                        description: 'true 时穿透 30 秒缓存立即请求官方接口；省略或 false 时优先返回缓存',
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
                                : value.error ?? '',
                        }],
                },
                timeoutMs: config.requestTimeoutMs + 1_000, // 协作超时预算：接口超时 + 解析余量
                // 箭头函数：闭包捕获服务实例的 this（defineTool 的对象方法不保留调用者上下文）
                execute: async (args) => {
                    const wire = await this.readWire(args.force === true);
                    if (!wire.ok)
                        throw new Error(wire.error ?? '余额查询失败');
                    return wire;
                },
            }));
        }
        /** 抓取一次官方余额接口（不做缓存判断）；未配置凭证返回 undefined */
        async fetchBalance() {
            const hit = await this.ctx.credentials.resolve(credentialRef(this.config.apiKeyEnv));
            if (hit === undefined)
                return undefined; // 未配置凭证：静默返回空
            const res = await fetch(BALANCE_ENDPOINT, {
                headers: {
                    Authorization: `Bearer ${hit.value}`,
                    Accept: 'application/json',
                },
                signal: AbortSignal.timeout(this.config.requestTimeoutMs),
            });
            if (!res.ok)
                throw new Error(`官方接口返回 HTTP ${res.status}`);
            return parseBalance(await res.json());
        }
        /**
         * 刷新缓存：
         * - force=false 且缓存未过期 → 直接返回缓存（不请求网络）
         * - 否则抓取；同一时刻最多一个在途请求（串行化）
         * - 抓取失败 → 回退返回最后一次成功缓存（可能为 undefined）
         */
        refreshCached(force) {
            const { cacheTtlMs } = this.config;
            if (!force && this.cached !== undefined && Date.now() - this.cached.fetchedAt < cacheTtlMs) {
                return Promise.resolve(this.cached);
            }
            if (this.inflight !== undefined)
                return this.inflight;
            this.inflight = (async () => {
                try {
                    const next = await this.fetchBalance();
                    if (next !== undefined)
                        this.cached = next;
                    return next ?? this.cached;
                }
                catch (error) {
                    // 失败静默降级：记日志（不含任何 key 信息），回退旧缓存
                    this.ctx.logger.warn('[balance-monitor] 余额接口请求失败，回退缓存：%s', String(error));
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
        /** 组装 Remote 边界值 */
        async readWire(force) {
            const snapshot = await this.refreshCached(force);
            if (snapshot === undefined) {
                return {
                    ok: false,
                    isAvailable: false,
                    infos: [],
                    fetchedAt: 0,
                    staleMs: 0,
                    error: `未配置凭证 ${this.config.apiKeyEnv}，无法查询余额：请在 dsh 凭证中配置该环境变量，或在本插件 config 里把 apiKeyEnv 改为其他引用名`,
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
        /** Remote：走缓存读取余额（浏览器徽章 30s 轮询用） */
        get() {
            return this.readWire(false);
        }
        /** Remote：穿透缓存强制刷新（浏览器 SYNC 按钮用） */
        refresh() {
            return this.readWire(true);
        }
    };
})();
export { BalanceRemoteService };
/** 插件主体：loader 直接挂载 default 导出的服务类（entry ctx 注册，官方模式） */
export default BalanceRemoteService;
