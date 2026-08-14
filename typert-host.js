/**
 * TYPERT host-face 元数据（官方 typert-loader 的 strict 注册契约）：
 * loader 行挂载本包时，typert-loader 解析 exports["./typert"] 并导入本模块，
 * 把 TYPERT manifest 注册进 typert registry——api-gateway 按 strict 定义
 * 认领 /api/balance/* 端点（与官方 dsh-goal、dsh-cordis-host-runner 同路径，
 * 不走脆弱的 SRC 运行时反射）。
 * 结构遵循 @deepseek-ai/dsh-typert-loader 的 validateTypertManifest 校验。
 */
import { z } from 'zod'

/** 币种条目（金额为官方原样字符串） */
const BalanceInfoSchema = z.object({
  currency: z.string(),
  totalBalance: z.string(),
  grantedBalance: z.string(),
  toppedUpBalance: z.string(),
}).readonly()

/** Remote 边界值（与 src/types.ts 的 BalanceWire 一致） */
const BalanceWireSchema = z.object({
  ok: z.boolean(),
  isAvailable: z.boolean(),
  infos: z.array(BalanceInfoSchema),
  fetchedAt: z.number(),
  staleMs: z.number(),
  error: z.string().optional(),
}).readonly()

const balanceWireCodec = {
  mode: 'strict',
  typeSymbol: 'dsh-balance-monitor#BalanceWire',
  schema: BalanceWireSchema,
}

export const TYPERT = {
  package: 'dsh-balance-monitor',
  face: 'host',
  schemas: [],
  invocations: [
    {
      id: 'dsh-balance-monitor#balance/get',
      service: 'balance',
      namespace: 'balance',
      method: 'get',
      invocation: { kind: 'direct' },
      parameters: [],
      result: balanceWireCodec,
    },
    {
      id: 'dsh-balance-monitor#balance/refresh',
      service: 'balance',
      namespace: 'balance',
      method: 'refresh',
      invocation: { kind: 'direct' },
      parameters: [],
      result: balanceWireCodec,
    },
  ],
  model: {
    services: [],
    events: [],
    objects: [],
  },
}
