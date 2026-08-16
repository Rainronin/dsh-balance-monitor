/**
 * 共享类型：host 半与 client 半共用的余额与计价数据结构。
 * 金额一律为字符串（官方返回即字符串），禁止转数字运算。
 */
/** 官方接口的单个币种条目 */
export interface BalanceInfo {
    currency: string;
    totalBalance: string;
    grantedBalance: string;
    toppedUpBalance: string;
}
/** 一次余额快照（host 侧缓存单位） */
export interface BalanceSnapshot {
    /** 官方字段：账户余额是否可用 */
    isAvailable: boolean;
    /** 币种条目（CNY 优先排序） */
    infos: BalanceInfo[];
    /** 抓取时间戳（epoch 毫秒） */
    fetchedAt: number;
}
/**
 * BalanceWire 的稳定错误分类：
 * missing-credential 凭证未配置；invalid-credential-ref 引用名非法；
 * invalid-api-key key 被官方拒绝；upstream-http-error 非 2xx；
 * upstream-network-error 网络失败；upstream-timeout 超时；
 * upstream-invalid-response 响应无法解析；credential-resolve-error 凭证服务失败；
 * upstream-error 其他未知错误。客户端状态码依据 code 判断，不依赖中文文案子串。
 */
export type BalanceErrorCode = 'missing-credential' | 'invalid-credential-ref' | 'invalid-api-key' | 'upstream-http-error' | 'upstream-network-error' | 'upstream-timeout' | 'upstream-invalid-response' | 'credential-resolve-error' | 'upstream-error';
/**
 * Remote 边界值：浏览器徽章拿到并严格校验的 wire 结构。
 * 工具返回同一个核心结构（不含客户端专属的 pricing/pollIntervalMs）。
 */
export interface BalanceWire {
    ok: boolean;
    isAvailable: boolean;
    infos: BalanceInfo[];
    fetchedAt: number;
    /** 快照抓取到现在的毫秒数；未超过 TTL 时 host 会压成 0 */
    staleMs: number;
    /** 失败原因（ok=false 时） */
    error?: string;
    /** 稳定错误码（ok=false 时） */
    code?: BalanceErrorCode;
}
/**
 * 峰谷计价阶段：按北京时间窗口实时计算。
 * 2026-08-17 00:00 之前也按窗口预览显示，正式计费时间见 effectiveAt。
 * `flat` 仅用于兼容尚未重启的旧 host 进程，新 host 不会返回该值。
 */
export type PricingPhase = 'peak' | 'offpeak' | 'flat';
/**
 * 峰谷计价状态（host 用北京时间计算，客户端只负责展示与倒计时）。
 * 官方规则：高峰时段为北京时间 09:00-12:00、14:00-18:00，其余为空闲。
 */
export interface PricingState {
    phase: PricingPhase;
    /** 服务端计算该状态的时间戳（客户端据此校正本地时钟偏差） */
    observedAt: number;
    /** 下一阶段切换时间戳（epoch 毫秒） */
    nextChangeAt: number;
    /** 若处于高峰期，距进入空闲阶段的剩余毫秒数；其他阶段为 0 */
    peakRemainingMs: number;
    /** 峰谷计价生效时间戳 */
    effectiveAt: number;
}
/**
 * 浏览器徽章使用的客户端 wire：核心余额字段 + 峰谷计价状态 + 轮询间隔。
 * pricing/pollIntervalMs 在 host 端始终提供，这里标可选仅为兼容异常响应。
 */
export interface BalanceClientWire extends BalanceWire {
    pricing?: PricingState;
    pollIntervalMs?: number;
}
