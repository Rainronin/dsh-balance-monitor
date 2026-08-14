/**
 * 共享类型：host 半与 client 半共用的余额数据结构。
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
/** Remote 边界值：浏览器徽章拿到并严格校验的 wire 结构 */
export interface BalanceWire {
    ok: boolean;
    isAvailable: boolean;
    infos: BalanceInfo[];
    fetchedAt: number;
    /** 缓存距 TTL 的陈旧毫秒数；0 = 新鲜 */
    staleMs: number;
    /** 失败原因（ok=false 时） */
    error?: string;
}
