/**
 * dsh-balance-monitor —— DeepSeek API 账户余额监测插件（host 半）
 *
 * 架构：一个 Cordis 服务（键 `balance`，同时是 Typert Remote 命名空间）承载全部逻辑：
 *   1. 凭证解析 → 官方余额接口（GET /user/balance）→ TTL 缓存 + 请求串行化 + 稳定错误码
 *   2. `ds_balance` 工具：会话内查询（force 穿透缓存）
 *   3. `agent/pre-step` 注入：每轮把余额快照放进模型上下文（只读缓存，零阻塞）
 *   4. 后台轮询
 *   5. Typert Remote：`balance/get`（走缓存）与 `balance/refresh`（穿透刷新），
 *      浏览器 wire 额外携带峰谷计价状态与轮询间隔
 *
 * 峰谷计价规则（官方文档 https://api-docs.deepseek.com/zh-cn/quick_start/pricing/）：
 * 北京时间 09:00-12:00、14:00-18:00 为高峰，其余为空闲；2026-08-17 00:00 生效。
 *
 * 金额一律按字符串处理（官方返回即字符串），不做浮点运算。
 * API key 只从 dsh 凭证服务解析，不打印、不落盘、不缓存。
 */
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { BalanceClientWire } from './types.js';
export type { BalanceClientWire, BalanceErrorCode, BalanceInfo, BalanceSnapshot, BalanceWire, PricingPhase, PricingState, } from './types.js';
/** 插件名（loader 诊断用） */
export declare const name = "balance-monitor";
export declare const Config: z<Schemastery.ObjectS<{
    /** 凭证引用名（环境变量名），默认复用 dsh 的 DeepSeek key */
    apiKeyEnv: z<string, string>;
    /** 缓存有效期（毫秒）：TTL 内不重复请求官方接口 */
    cacheTtlMs: z<number, number>;
    /** 后台轮询间隔（毫秒） */
    pollIntervalMs: z<number, number>;
    /** 是否每轮对话注入余额快照到模型上下文 */
    injectEveryTurn: z<boolean, boolean>;
    /** 官方接口请求超时（毫秒） */
    requestTimeoutMs: z<number, number>;
}>, Schemastery.ObjectT<{
    /** 凭证引用名（环境变量名），默认复用 dsh 的 DeepSeek key */
    apiKeyEnv: z<string, string>;
    /** 缓存有效期（毫秒）：TTL 内不重复请求官方接口 */
    cacheTtlMs: z<number, number>;
    /** 后台轮询间隔（毫秒） */
    pollIntervalMs: z<number, number>;
    /** 是否每轮对话注入余额快照到模型上下文 */
    injectEveryTurn: z<boolean, boolean>;
    /** 官方接口请求超时（毫秒） */
    requestTimeoutMs: z<number, number>;
}>>;
/**
 * 余额服务：缓存、轮询、工具、上下文注入、浏览器 RPC 的统一宿主。
 * 服务键 `balance` 同时是 Remote wire 命名空间。
 *
 * 挂载方式（与官方 GoalService / DynamicCordisRunnerService 同构）：
 * loader 行直接加载本模块的 default 导出类，服务因此注册在 entry ctx。
 */
export declare class BalanceRemoteService extends TypertRemoteService {
    private readonly config;
    static inject: string[];
    static Config: z<Schemastery.ObjectS<{
        /** 凭证引用名（环境变量名），默认复用 dsh 的 DeepSeek key */
        apiKeyEnv: z<string, string>;
        /** 缓存有效期（毫秒）：TTL 内不重复请求官方接口 */
        cacheTtlMs: z<number, number>;
        /** 后台轮询间隔（毫秒） */
        pollIntervalMs: z<number, number>;
        /** 是否每轮对话注入余额快照到模型上下文 */
        injectEveryTurn: z<boolean, boolean>;
        /** 官方接口请求超时（毫秒） */
        requestTimeoutMs: z<number, number>;
    }>, Schemastery.ObjectT<{
        /** 凭证引用名（环境变量名），默认复用 dsh 的 DeepSeek key */
        apiKeyEnv: z<string, string>;
        /** 缓存有效期（毫秒）：TTL 内不重复请求官方接口 */
        cacheTtlMs: z<number, number>;
        /** 后台轮询间隔（毫秒） */
        pollIntervalMs: z<number, number>;
        /** 是否每轮对话注入余额快照到模型上下文 */
        injectEveryTurn: z<boolean, boolean>;
        /** 官方接口请求超时（毫秒） */
        requestTimeoutMs: z<number, number>;
    }>>;
    /** 最近一次成功抓取的快照 */
    private cached;
    /** 最近一次失败（用于在无缓存时给出真实错误，而不是一律报“未配置凭证”） */
    private lastError;
    /** 在途请求（串行化：同一时刻最多一个） */
    private inflight;
    constructor(ctx: Context, config: Schemastery.TypeT<typeof Config>);
    /** 抓取一次官方余额接口（不做缓存判断）；所有失败都带稳定错误码抛出 */
    private fetchBalance;
    /**
     * 刷新缓存：
     * - force=false 且缓存未过期 → 直接返回缓存（不请求网络）
     * - 否则抓取；同一时刻最多一个在途请求（串行化）
     * - 抓取失败 → 记录真实错误码；网络类失败回退旧缓存，凭证类失败丢弃旧缓存
     */
    private refreshCached;
    /** 纯缓存读：绝不触发网络请求（供 pre-step 注入使用，保证主循环零阻塞） */
    private peekCached;
    /** 组装工具/模型可见的核心 BalanceWire */
    private readWire;
    /** 组装浏览器徽章 wire：核心余额 + 峰谷计价 + 轮询间隔 */
    private readClientWire;
    /** Remote：走缓存读取余额（浏览器徽章轮询用） */
    get(): Promise<BalanceClientWire>;
    /** Remote：穿透缓存强制刷新（浏览器 SYNC 按钮用） */
    refresh(): Promise<BalanceClientWire>;
}
/** 插件主体：loader 直接挂载 default 导出的服务类（entry ctx 注册，官方模式） */
export default BalanceRemoteService;
