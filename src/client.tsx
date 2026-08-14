/**
 * dsh-balance-monitor 浏览器半：Matrix 风格侧边栏余额徽章。
 *
 * - 挂载点：`sidebar.footer.action` slot（侧边栏底部，Settings 旁，由
 *   @deepseek-ai/dsh-client-ui-sidebar 声明；kind: 'list'）
 * - 数据通道：官方 RPC 公开协议直调（POST /api/balance/<method>，
 *   client-request 信封，经 api-gateway 的 strict 注册认领到 host 余额服务）——
 *   `balance/get` 走 host 缓存（30s 轮询），`balance/refresh` 穿透缓存（SYNC 按钮）
 * - 视觉：1999 年绿磷光 CRT 终端——磷光底色、扫描线、双层辉光、更新瞬间余辉闪烁、
 *   琥珀告警；折叠态（rail）退化为单色状态灯。尊重 prefers-reduced-motion。
 *
 * 设计规范见仓库根《UI设计构思.md》。
 */
import { useEffect, useState } from 'react'
// 仅引入类型：拿到 SlotMap 的 merge 面
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { BalanceWire } from './types'

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
    register(options: unknown, component: (props: never) => unknown): () => void
  }
}

/** 客户端依赖的 cordis 服务 */
export const inject = ['slots']

/**
 * 官方 RPC 协议直调（dsh-host-apiproxy 的 fetch carrier 公开信封）：
 * POST /api/balance/<method>，body 为 client-request 信封；
 * 响应为 server-response 信封，result.value 即 host 端 zod 校验后的 BalanceWire。
 */
async function callBalance(method: 'get' | 'refresh'): Promise<BalanceWire> {
  const res = await fetch(`/api/balance/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: crypto.randomUUID(),
      method: `balance/${method}`,
      payload: { args: {} },
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const envelope = await res.json() as {
    result?: { ok?: boolean; value?: BalanceWire; error?: { message?: string } }
  }
  if (envelope.result?.ok !== true || envelope.result.value === undefined) {
    throw new Error(envelope.result?.error?.message ?? 'RPC 调用失败')
  }
  return envelope.result.value
}

/** 徽章注入面：由 apply 闭包提供，组件只管渲染与轮询节奏 */
interface BadgeInjected {
  get(): Promise<BalanceWire>
  refresh(): Promise<BalanceWire>
}

/** 错误态 → 终端口令式短码（琥珀色渲染） */
function statusCodeOf(wire: BalanceWire | null): { code: string; bad: boolean } {
  if (wire === null) return { code: 'LINK…', bad: false }
  if (!wire.ok) {
    const message = typeof wire.error === 'string' ? wire.error : ''
    return {
      code: message.includes('未配置凭证') ? 'NO KEY' : 'NO SIGNAL',
      bad: true,
    }
  }
  return { code: wire.staleMs > 0 ? 'STALE' : 'LINK OK', bad: false }
}

/** 主币种（CNY 优先，host 已排序） */
function primaryInfo(wire: BalanceWire | null) {
  return wire?.infos[0]
}

/** CRT 徽章样式（组件内注入一次，带官方 data-plugin 标记，防重复注入） */
const BADGE_CSS = `
.bm-crt {
  font-family: ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace;
  letter-spacing: 0.06em;
  background: #050B05;
  border: 1px solid #1E7A38;
  background-image: repeating-linear-gradient(0deg, transparent 0 2px, rgba(0,0,0,0.22) 2px 3px);
  box-shadow: inset 0 0 12px rgba(0,255,65,0.05);
  color: #1E7A38;
  font-size: 11px;
  line-height: 1.5;
}
.bm-crt .bm-row { display: flex; align-items: center; gap: 8px; padding: 4px 10px; }
.bm-crt .bm-title { flex: none; letter-spacing: 0.2em; }
.bm-crt .bm-value {
  flex: 1; min-width: 0; color: #00FF41; font-size: 16px; letter-spacing: 0.05em;
  font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  text-shadow: 0 0 6px rgba(0,255,65,0.5), 0 0 2px #B5FFC4;
}
.bm-crt .bm-value.bm-flash { animation: bm-flash 320ms ease-out 1; }
@keyframes bm-flash {
  0% { color: #B5FFC4; text-shadow: 0 0 14px #B5FFC4, 0 0 5px #B5FFC4; }
  100% { color: #00FF41; text-shadow: 0 0 6px rgba(0,255,65,0.5), 0 0 2px #B5FFC4; }
}
.bm-crt .bm-sync {
  flex: none; cursor: pointer; background: transparent; border: 1px solid #1E7A38;
  color: #1E7A38; font: inherit; font-size: 10px; letter-spacing: 0.2em;
  padding: 1px 6px; text-transform: uppercase;
}
.bm-crt .bm-sync:hover { color: #B5FFC4; border-color: #00FF41; text-shadow: 0 0 6px #00FF41; }
.bm-crt .bm-sync:disabled { opacity: 0.4; cursor: default; }
.bm-crt .bm-sub { padding: 0 10px 4px; letter-spacing: 0.12em; }
.bm-crt .bm-status { flex: none; letter-spacing: 0.2em; font-size: 10px; }
.bm-crt .bm-bad { color: #FFB000; text-shadow: 0 0 6px rgba(255,176,0,0.5); }
.bm-crt .bm-signal { display: inline-block; letter-spacing: -1px; color: #00FF41; }
.bm-crt .bm-signal.bm-off { color: #FFB000; }
.bm-lamp {
  width: 8px; height: 8px; border-radius: 999px; background: #00FF41;
  box-shadow: 0 0 8px rgba(0,255,65,0.7); animation: bm-breathe 4s ease-in-out infinite;
}
.bm-lamp.bm-bad { background: #FFB000; box-shadow: 0 0 8px rgba(255,176,0,0.7); }
@keyframes bm-breathe { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
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

/** 侧边栏底部余额徽章（wide 态显示读数，rail 态退化为状态灯） */
function BalanceBadge(props: { wide: boolean } & BadgeInjected) {
  const { wide } = props
  const [wire, setWire] = useState<BalanceWire | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [flash, setFlash] = useState(false)

  // 挂载即拉取一次，此后每 30s 走缓存轮询（与 host 的 30s 轮询对齐）
  useEffect(() => {
    injectBadgeCss()
    let alive = true
    const tick = async () => {
      try {
        const w = await props.get()
        if (!alive) return
        setWire((prev) => {
          // 余额文本变化 → 触发一次 CRT 余辉闪烁
          if (prev !== null && prev.ok && w.ok && primaryInfo(prev)?.totalBalance !== primaryInfo(w)?.totalBalance) {
            setFlash(true)
            setTimeout(() => setFlash(false), 350)
          }
          return w
        })
      } catch {
        if (alive) setWire((prev) => prev ?? { ok: false, isAvailable: false, infos: [], fetchedAt: 0, staleMs: 0, error: 'NO SIGNAL' })
      }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, 30_000)
    return () => { alive = false; clearInterval(timer) }
  }, [props.get])

  /** SYNC：穿透缓存强制刷新 */
  const handleSync = async () => {
    if (syncing) return
    setSyncing(true)
    try {
      const w = await props.refresh()
      setWire((prev) => {
        if (prev !== null && prev.ok && w.ok && primaryInfo(prev)?.totalBalance !== primaryInfo(w)?.totalBalance) {
          setFlash(true)
          setTimeout(() => setFlash(false), 350)
        }
        return w
      })
    } catch {
      // 失败保持现状：下一轮 30s 轮询会重试
    } finally {
      setSyncing(false)
    }
  }

  // 折叠态（rail）：只有一盏状态灯，颜色即信息
  if (!wide) {
    const { bad } = statusCodeOf(wire)
    return (
      <div className="bm-crt" style={{ display: 'inline-flex', padding: 6 }}>
        <span className={`bm-lamp${bad ? ' bm-bad' : ''}`} title={wire?.ok === false ? (wire.error ?? 'NO SIGNAL') : 'LINK OK'} />
      </div>
    )
  }

  const info = primaryInfo(wire)
  const { code, bad } = statusCodeOf(wire)
  const value = info === undefined ? (wire?.ok === false ? '----' : '----') : `${info.currency} ¥${info.totalBalance}`
  return (
    <div className="bm-crt">
      <div className="bm-row">
        <span className="bm-title">▸ BALANCE</span>
        <span className={`bm-value${flash ? ' bm-flash' : ''}`} key={value}>{value}</span>
        <button className="bm-sync" type="button" onClick={() => { void handleSync() }} disabled={syncing}>
          {syncing ? '···' : 'SYNC'}
        </button>
      </div>
      {wire?.ok === true && wire.infos.length > 1
        ? <div className="bm-sub">{wire.infos.slice(1).map((i) => `${i.currency} ¥${i.totalBalance}`).join('　')}</div>
        : null}
      <div className="bm-row">
        <span className={`bm-signal${wire?.ok === true && !wire.isAvailable ? ' bm-off' : ''}${bad ? ' bm-off' : ''}`}>▓▓▓▓▓▓░░</span>
        <span className={`bm-status${bad ? ' bm-bad' : ''}`}>{code}</span>
      </div>
    </div>
  )
}

/** 浏览器插件主体：注册侧边栏徽章（数据经官方 RPC 协议直调，见 callBalance） */
export function apply(ctx: ClientCtx) {
  ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'balance-monitor',
    order: 50,
    inject: () => ({
      get: () => callBalance('get'),
      refresh: () => callBalance('refresh'),
    }),
  }, BalanceBadge)
}
