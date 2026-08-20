/**
 * dsh-balance-monitor 浏览器半：侧边栏余额徽章。
 *
 * - 挂载点：`sidebar.footer.action` slot（侧边栏底部，Settings 旁）
 * - 数据通道：官方 RPC 公开协议直调（POST /api/balance/<method>，
 *   client-request 信封，经 api-gateway 的 strict 注册认领到 host 余额服务）
 * - 视觉：1999 年绿磷光 CRT 终端；点 UI 按钮可切换为贴近 dsh 原生风格的样式。
 * - 峰谷计价：host 按北京时间计算阶段，徽章展示 `高峰 HH:MM:SS` / `空闲`，
 *   高峰期倒计时到空闲（旧 host 进程的 flat 兼容值显示 `生效前 08-17`）。
 */
import { useEffect, useRef, useState } from 'react'
// 仅引入类型：拿到 SlotMap 的 merge 面与 SlotComponent
import type { SlotComponent, SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { BalanceClientWire, BalanceErrorCode, SessionCostWire } from './types.js'

/** useSessions 标准 props 的最小结构面（仅取当前会话 id，避免依赖运行时内部子路径） */
interface SessionListStateLike {
  current?: string
}

// 声明本插件消费的侧边栏插槽键（由 @deepseek-ai/dsh-client-ui-sidebar 官方声明，
// 此处按契约复述其形状以获取类型检查；owner 面只有折叠态 wide 布尔）
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar.footer.action': {
      kind: 'list'
      scope: 'root'
      owner: { wide: boolean }
    }
  }
}

/** 浏览器侧 cordis 上下文的最小结构面（slot 注册） */
interface ClientCtx {
  slots: {
    register(
      options: {
        name: 'sidebar.footer.action'
        id: string
        order?: number
        inject: () => BadgeInjected
      },
      component: SlotComponent<{ wide: boolean } & BadgeInjected & { useSessions: SnapshotSelectorHook<SessionListStateLike> }>,
    ): () => void
  }
}

/** 客户端依赖的 cordis 服务 */
export const inject = ['slots']

/**
 * 官方 RPC 协议直调（dsh-host-apiproxy 的 fetch carrier 公开信封）：
 * POST /api/balance/<method>，body 为 client-request 信封；
 * 校验 rpcId 回显，响应 result.value 即 host 端 zod 校验后的 BalanceClientWire。
 */
async function callBalance(method: 'get' | 'refresh'): Promise<BalanceClientWire> {
  const rpcId = crypto.randomUUID()
  const res = await fetch(`/api/balance/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId,
      method: `balance/${method}`,
      payload: { args: {} },
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const envelope = await res.json() as {
    type?: string
    rpcId?: string
    result?: { ok?: boolean; value?: BalanceClientWire; error?: { message?: string } }
  }
  if (envelope.type !== 'server-response' || envelope.rpcId !== rpcId) {
    throw new Error(`RPC 回显校验失败（期望 rpcId ${rpcId}）`)
  }
  if (envelope.result?.ok !== true || envelope.result.value === undefined) {
    throw new Error(envelope.result?.error?.message ?? 'RPC 调用失败')
  }
  return envelope.result.value
}

/** 读取指定会话的累计费用（官方 RPC 信封，协议同 callBalance） */
async function callSessionCost(sessionId: string): Promise<SessionCostWire> {
  const rpcId = crypto.randomUUID()
  const res = await fetch(`/api/balance/sessionCost`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId,
      method: 'balance/sessionCost',
      payload: { args: { sessionId } },
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const envelope = await res.json() as {
    type?: string
    rpcId?: string
    result?: { ok?: boolean; value?: SessionCostWire; error?: { message?: string } }
  }
  if (envelope.type !== 'server-response' || envelope.rpcId !== rpcId) {
    throw new Error(`RPC 回显校验失败（期望 rpcId ${rpcId}）`)
  }
  if (envelope.result?.ok !== true || envelope.result.value === undefined) {
    throw new Error(envelope.result?.error?.message ?? 'RPC 调用失败')
  }
  return envelope.result.value
}

/** 徽章注入面：由 apply 闭包提供，组件只管渲染与轮询节奏 */
interface BadgeInjected {
  get(): Promise<BalanceClientWire>
  refresh(): Promise<BalanceClientWire>
  sessionCost(sessionId: string): Promise<SessionCostWire>
}

/** key 类错误 → NO KEY；其余失败 → NO SIGNAL */
function isKeyError(code: BalanceErrorCode | undefined, message: string | undefined): boolean {
  return code === 'missing-credential'
    || code === 'invalid-credential-ref'
    || code === 'invalid-api-key'
    || (code === undefined && message?.includes('未配置凭证') === true)
}

/** 错误态 → 中文状态文案（琥珀色渲染异常） */
function statusViewOf(wire: BalanceClientWire | null): { key: 'connecting' | 'link' | 'stale' | 'no-key' | 'no-signal'; text: string; bad: boolean; unknown?: boolean } {
  if (wire === null) return { key: 'connecting', text: '连接中…', bad: false, unknown: true }
  if (!wire.ok) {
    return isKeyError(wire.code, wire.error)
      ? { key: 'no-key', text: '未配置密钥', bad: true }
      : { key: 'no-signal', text: '无信号', bad: true }
  }
  return wire.staleMs > 0
    ? { key: 'stale', text: '数据过期', bad: false }
    : { key: 'link', text: '连接正常', bad: false }
}

/** 主币种（CNY 优先，host 已排序） */
function primaryInfo(wire: BalanceClientWire | null) {
  return wire?.infos[0]
}

/** 币种 → 常用货币符号（非已知币种退回币种码 + 空格） */
function currencySymbol(currency: string): string {
  switch (currency.toUpperCase()) {
    case 'CNY': return '¥'
    case 'USD': return '$'
    case 'EUR': return '€'
    case 'GBP': return '£'
    default: return `${currency} `
  }
}

/** 把主币种渲染为 `CNY ¥32.81` 形式 */
function renderPrimaryValue(wire: BalanceClientWire | null): string {
  const info = primaryInfo(wire)
  if (info === undefined) return '----'
  return `${info.currency} ${currencySymbol(info.currency)}${info.totalBalance}`
}

/** 计价阶段剩余毫秒（用 host observedAt 校正本地时钟偏差） */
function pricingRemainingMs(wire: BalanceClientWire | null, now: number): number {
  const pricing = wire?.pricing
  if (pricing === undefined || pricing.phase !== 'peak') return 0
  const elapsed = Math.max(0, now - pricing.observedAt)
  return Math.max(0, pricing.peakRemainingMs - elapsed)
}

/** HH:MM:SS（ceil 到秒） */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

/** 状态栏计价文本；旧 host 进程的 flat 兼容值显示 `生效前 08-17` */
function pricingText(wire: BalanceClientWire | null, now: number): string | null {
  const pricing = wire?.pricing
  if (pricing === undefined) return null
  if (pricing.phase === 'peak') return `高峰 ${formatDuration(pricingRemainingMs(wire, now))}`
  if (pricing.phase === 'offpeak') return '空闲'
  return '生效前 08-17' // 兼容尚未重启的旧 host 进程
}

/** 计价文本的说明 tooltip */
function pricingTitle(wire: BalanceClientWire | null, now: number): string | undefined {
  const pricing = wire?.pricing
  if (pricing === undefined) return undefined
  const effective = new Date(pricing.effectiveAt).toLocaleString('zh-CN', { hour12: false })
  const note = now < pricing.effectiveAt ? `；正式计费 ${effective} 起生效` : ''
  if (pricing.phase === 'peak') {
    return `高峰阶段：距空闲阶段还剩 ${formatDuration(pricingRemainingMs(wire, now))}（北京时间 09:00-12:00、14:00-18:00 为高峰${note}）`
  }
  if (pricing.phase === 'offpeak') {
    const next = Math.max(0, pricing.nextChangeAt - now)
    return `空闲阶段：距下一个高峰 ${formatDuration(next)}（北京时间 09:00-12:00、14:00-18:00 为高峰${note}）`
  }
  return `峰谷计价尚未生效（生效时间：${effective}）`
}

/** 折叠态 tooltip：余额 + 链路状态 + 计价状态 */
function railTitle(wire: BalanceClientWire | null, pricing: string | null): string {
  if (wire === null) return '正在连接…'
  const balance = wire.ok ? renderPrimaryValue(wire) : (wire.error ?? '无信号')
  const link = wire.ok ? (wire.isAvailable ? '余额可用' : '官方标记余额不可用') : '链路异常'
  return [balance, link, pricing].filter((value): value is string => value !== null).join(' · ')
}

/** 徽章样式（组件内注入一次，带官方 data-plugin 标记，防重复注入） */
const BADGE_CSS = `
.bm-crt {
  --matrix-bg: #050B05;
  --matrix-panel: #0A130A;
  --matrix-phosphor: #00FF41;
  --matrix-dim: #1E7A38;
  --matrix-pale: #B5FFC4;
  --matrix-amber: #FFB000;
  font-family: ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace;
  letter-spacing: 0.06em;
  background: var(--matrix-bg);
  border: 1px solid var(--matrix-dim);
  background-image: repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.22) 2px 3px);
  box-shadow: inset 0 0 12px rgba(0,255,65,0.05);
  color: var(--matrix-dim);
  font-size: 11px;
  line-height: 1.5;
}
.bm-crt .bm-row { display: flex; align-items: center; gap: 8px; padding: 4px 10px; }
.bm-crt .bm-title { flex: none; letter-spacing: 0.2em; }
.bm-crt .bm-value {
  flex: 1; min-width: 0; color: var(--matrix-phosphor); font-size: 16px; letter-spacing: 0.05em;
  font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  text-shadow: 0 0 6px rgba(0,255,65,0.5), 0 0 2px #B5FFC4;
}
.bm-crt .bm-value.bm-flash { animation: bm-flash 320ms ease-out 1; }
@keyframes bm-flash {
  0% { color: var(--matrix-pale); text-shadow: 0 0 14px var(--matrix-pale), 0 0 5px var(--matrix-pale); }
  100% { color: var(--matrix-phosphor); text-shadow: 0 0 6px rgba(0,255,65,0.5), 0 0 2px var(--matrix-pale); }
}
.bm-crt .bm-sync, .bm-crt .bm-ui, .bm-native .bm-sync, .bm-native .bm-ui {
  flex: none; cursor: pointer; background: transparent; border: 1px solid currentColor;
  color: inherit; font: inherit; font-size: 10px; letter-spacing: 0.1em;
  padding: 1px 6px; text-transform: uppercase;
}
.bm-crt .bm-sync:hover, .bm-crt .bm-ui:hover { color: var(--matrix-pale); border-color: var(--matrix-phosphor); text-shadow: 0 0 6px var(--matrix-phosphor); }
.bm-crt .bm-sync:disabled, .bm-crt .bm-ui:disabled { opacity: 0.4; cursor: default; }
.bm-crt .bm-sub { padding: 0 10px 4px; letter-spacing: 0.12em; }
.bm-crt .bm-status { flex: none; letter-spacing: 0.2em; font-size: 10px; }
.bm-crt .bm-bad { color: var(--matrix-amber); text-shadow: 0 0 6px rgba(255,176,0,0.5); }
.bm-crt .bm-signal { display: inline-block; letter-spacing: -1px; color: var(--matrix-phosphor); }
.bm-crt .bm-signal.bm-off { color: var(--matrix-amber); }
.bm-crt .bm-pricing, .bm-native .bm-pricing {
  margin-left: auto; font-size: 10px; letter-spacing: 0.08em;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.bm-lamp {
  width: 8px; height: 8px; border-radius: 999px; background: var(--matrix-phosphor);
  box-shadow: 0 0 8px rgba(0,255,65,0.7); animation: bm-breathe 4s ease-in-out infinite;
}
.bm-lamp.bm-bad { background: var(--matrix-amber); box-shadow: 0 0 8px rgba(255,176,0,0.7); }
.bm-lamp.bm-unknown, .bm-dot.bm-unknown {
  background: #8A938A; box-shadow: none; animation: none;
}
@keyframes bm-breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }

/* dsh 原生风格：使用官方主题变量，缺失时回退中性色 */
.bm-native {
  font-family: inherit;
  color: var(--dsw-alias-label-primary, #1F2329);
  font-size: 12px;
  line-height: 1.5;
}
.bm-native .bm-row { display: flex; align-items: center; gap: 8px; padding: 4px 10px; }
.bm-native .bm-title { flex: none; color: var(--dsw-alias-label-secondary, #6B7280); }
.bm-native .bm-value {
  flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  font-variant-numeric: tabular-nums; font-weight: 500;
}
.bm-native .bm-sync:hover, .bm-native .bm-ui:hover {
  border-color: var(--dsw-alias-label-primary, #1F2329);
  background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.05));
}
.bm-native .bm-sync:disabled, .bm-native .bm-ui:disabled { opacity: 0.4; cursor: default; }
.bm-native .bm-sub { padding: 0 10px 4px; color: var(--dsw-alias-label-secondary, #6B7280); }
.bm-native .bm-status-row { display: flex; align-items: center; gap: 6px; padding: 0 10px 4px; color: var(--dsw-alias-label-secondary, #6B7280); }
.bm-native .bm-dot { flex: none; width: 6px; height: 6px; animation: none; box-shadow: none; background: #22A06B; }
.bm-native .bm-dot.bm-bad { background: #D97706; }
.bm-native .bm-dot.bm-unknown { background: #9CA3AF; }
.bm-native .bm-bad { color: #D97706; }
.bm-native .bm-pricing { margin-left: auto; color: var(--dsw-alias-label-secondary, #6B7280); }

@media (prefers-reduced-motion: reduce) {
  .bm-crt .bm-value.bm-flash { animation: none; }
  .bm-lamp { animation: none; }
}
`

function injectBadgeCss() {
  const id = 'dsh-balance-monitor/Badge.module.css'
  if (typeof document === 'undefined' || document.querySelector(`style[data-plugin-css="${id}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = 'dsh-balance-monitor'
  tag.dataset.pluginCss = id
  tag.textContent = BADGE_CSS
  document.head.appendChild(tag)
}

type UiStyle = 'matrix' | 'native'
const UI_STYLE_KEY = 'dsh-balance-monitor/ui-style'
const DEFAULT_POLL_INTERVAL_MS = 30_000

function loadUiStyle(): UiStyle {
  try {
    const stored = window.localStorage.getItem(UI_STYLE_KEY)
    return stored === 'native' ? 'native' : 'matrix'
  } catch {
    return 'matrix'
  }
}

/** 侧边栏底部余额徽章（wide 态显示读数，rail 态退化为状态灯） */
function BalanceBadge(props: { wide: boolean } & BadgeInjected & { useSessions: SnapshotSelectorHook<SessionListStateLike> }) {
  const { wide, useSessions } = props
  const [wire, setWire] = useState<BalanceClientWire | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [flash, setFlash] = useState(false)
  const [uiStyle, setUiStyle] = useState<UiStyle>(loadUiStyle)
  const [now, setNow] = useState(() => Date.now())
  const [sessionCost, setSessionCost] = useState<SessionCostWire | null>(null)
  const prevPrimary = useRef<string | undefined>(undefined)
  const aliveRef = useRef(true)
  const prevSessionIdRef = useRef<string | undefined>(undefined)
  const currentSessionId = useSessions((s) => s.current)

  // 卸载后不再对 state 做任何更新
  useEffect(() => () => { aliveRef.current = false }, [])

  // 切换会话时先清空上一会话的费用，避免新数据到达前显示旧会话金额
  useEffect(() => {
    if (prevSessionIdRef.current !== currentSessionId) {
      prevSessionIdRef.current = currentSessionId
      setSessionCost(null)
    }
  }, [currentSessionId])

  // 持久化 UI 风格
  useEffect(() => {
    try { window.localStorage.setItem(UI_STYLE_KEY, uiStyle) } catch { /* localStorage 不可用时忽略 */ }
  }, [uiStyle])

  // 挂载即拉取一次，此后按 host 下发的 pollIntervalMs 轮询；
  // 峰谷阶段切换时刻额外触发一次刷新。
  useEffect(() => {
    injectBadgeCss()
    let alive = true
    let pollTimer: number | undefined
    let transitionTimer: number | undefined

    const armPoll = (intervalMs: number) => {
      if (pollTimer !== undefined) clearInterval(pollTimer)
      const safe = Math.min(Math.max(intervalMs, 1_000), 2_147_483_647)
      pollTimer = setInterval(() => { void tick() }, safe)
    }

    const armTransition = (next: BalanceClientWire) => {
      if (transitionTimer !== undefined) clearTimeout(transitionTimer)
      const at = next.pricing?.nextChangeAt
      if (typeof at !== 'number' || !Number.isFinite(at)) return
      const delay = Math.max(0, at - Date.now()) + 250
      if (delay > 2_147_483_647) return
      transitionTimer = setTimeout(() => { void tick() }, delay)
    }

    const tick = async () => {
      try {
        const next = await props.get()
        if (!alive) return
        setWire(next)
        armPoll(next.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
        armTransition(next)
      } catch {
        if (!alive) return
        setWire((prev) => prev ?? {
          ok: false,
          isAvailable: false,
          infos: [],
          fetchedAt: 0,
          staleMs: 0,
          error: '无信号',
          code: 'upstream-error',
        })
      }
      if (currentSessionId === undefined) {
        if (alive) setSessionCost(null)
        return
      }
      try {
        const cost = await props.sessionCost(currentSessionId)
        if (alive) setSessionCost(cost)
      } catch {
        if (alive) setSessionCost(null)
      }
    }

    armPoll(DEFAULT_POLL_INTERVAL_MS)
    void tick()
    return () => {
      alive = false
      if (pollTimer !== undefined) clearInterval(pollTimer)
      if (transitionTimer !== undefined) clearTimeout(transitionTimer)
    }
  }, [props.get, props.sessionCost, currentSessionId])

  // 高峰倒计时每秒刷新；其他阶段不需要高频渲染
  useEffect(() => {
    if (wire?.pricing?.phase !== 'peak') return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [wire?.pricing?.phase])

  // 余额文本变化 → 触发一次 CRT 余辉闪烁；不把 setState 塞进 setWire updater
  const primaryValue = wire?.ok === true ? primaryInfo(wire)?.totalBalance : undefined
  useEffect(() => {
    if (primaryValue === undefined) return
    const previous = prevPrimary.current
    prevPrimary.current = primaryValue
    if (previous !== undefined && previous !== primaryValue) {
      setFlash(true)
      const timer = setTimeout(() => setFlash(false), 350)
      return () => clearTimeout(timer)
    }
  }, [primaryValue])

  /** SYNC：穿透缓存强制刷新 */
  const handleSync = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      const next = await props.refresh()
      if (!aliveRef.current) return
      setWire(next)
    } catch {
      // 失败保持现状：下一轮轮询会重试
    } finally {
      if (aliveRef.current) setSyncing(false)
    }
  }

  const toggleStyle = () => {
    setUiStyle((prev) => prev === 'matrix' ? 'native' : 'matrix')
  }

  const status = statusViewOf(wire)
  const statusText = status.key === 'stale' && wire?.staleMs !== undefined
    ? `数据过期 ${Math.max(1, Math.round(wire.staleMs / 1000))}s`
    : status.text
  const pricingNow = wire?.pricing?.phase === 'peak' ? now : Date.now()
  const pricing = pricingText(wire, pricingNow)
  const value = renderPrimaryValue(wire)
  const costText = currentSessionId === undefined
    ? null
    : sessionCost?.ok === true && sessionCost.cost !== undefined
      ? `本会话 ¥${sessionCost.cost}`
      : '本会话 --'

  // 折叠态（rail）：只有一盏状态灯，颜色即信息
  if (!wide) {
    const dotClass = uiStyle === 'matrix' ? 'bm-lamp' : 'bm-dot'
    const title = [railTitle(wire, pricing), costText].filter((value): value is string => value !== null).join(' · ')
    return (
      <div className={uiStyle === 'matrix' ? 'bm-crt' : 'bm-native'} style={{ display: 'inline-flex', padding: 6 }}>
        <span
          className={`${dotClass}${status.bad ? ' bm-bad' : ''}${status.unknown ? ' bm-unknown' : ''}`}
          title={title}
        />
      </div>
    )
  }

  // 次币种列表（CNY 之外）
  const secondary = wire?.ok === true && wire.infos.length > 1
    ? wire.infos.slice(1).map((info) => `${info.currency} ${currencySymbol(info.currency)}${info.totalBalance}`).join('　')
    : null

  if (uiStyle === 'native') {
    return (
      <div className="bm-native">
        <div className="bm-row">
          <span className="bm-title">余额</span>
          <span className={`bm-value${flash ? ' bm-flash' : ''}`} key={value}>{value}</span>
          <button className="bm-sync" type="button" onClick={() => { void handleSync() }} disabled={syncing}>
            {syncing ? '···' : '刷新'}
          </button>
          <button className="bm-ui" type="button" onClick={toggleStyle} title="切换到矩阵 CRT 样式">矩阵</button>
        </div>
        {secondary !== null ? <div className="bm-sub">{secondary}</div> : null}
        <div className="bm-status-row">
          <span className={`bm-dot${status.bad ? ' bm-bad' : ''}${status.unknown ? ' bm-unknown' : ''}`} />
          <span className={status.bad ? 'bm-bad' : ''}>{statusText}</span>
          {pricing !== null
            ? <span className="bm-pricing" title={pricingTitle(wire, pricingNow)}>{pricing}</span>
            : null}
        </div>
        {costText !== null ? <div className="bm-sub" title="当前会话累计费用（DeepSeek 官方 V4 峰谷价格估算）">{costText}</div> : null}
      </div>
    )
  }

  const signalClass = `bm-signal${wire?.ok === true && !wire.isAvailable ? ' bm-off' : ''}${status.bad ? ' bm-off' : ''}`
  const signalText = wire?.ok === true && !wire.isAvailable ? '░░░░░░▓▓' : '▓▓▓▓▓▓░░'
  return (
    <div className="bm-crt">
      <div className="bm-row">
        <span className="bm-title">▸ 余额</span>
        <span className={`bm-value${flash ? ' bm-flash' : ''}`} key={value}>{value}</span>
        <button className="bm-sync" type="button" onClick={() => { void handleSync() }} disabled={syncing}>
          {syncing ? '···' : '刷新'}
        </button>
        <button className="bm-ui" type="button" onClick={toggleStyle} title="切换到 dsh 原生样式">原生</button>
      </div>
      {secondary !== null ? <div className="bm-sub">{secondary}</div> : null}
      <div className="bm-row">
        <span className={signalClass}>{signalText}</span>
        <span className={`bm-status${status.bad ? ' bm-bad' : ''}`}>{statusText}</span>
        {pricing !== null
          ? <span className="bm-pricing" title={pricingTitle(wire, pricingNow)}>{pricing}</span>
          : null}
      </div>
      {costText !== null ? <div className="bm-sub" title="当前会话累计费用（DeepSeek 官方 V4 峰谷价格估算）">{costText}</div> : null}
    </div>
  )
}

/** 浏览器插件主体：注册侧边栏徽章（数据经官方 RPC 协议直调，见 callBalance） */
export function apply(ctx: ClientCtx) {
  ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'balance-monitor',
    order: -100, // 优先排在侧边栏底部，避免被全宽启动器（插件市场/插件面板）挤到可视区外
    inject: () => ({
      get: () => callBalance('get'),
      refresh: () => callBalance('refresh'),
      sessionCost: (sessionId: string) => callSessionCost(sessionId),
    }),
  }, BalanceBadge)
}
