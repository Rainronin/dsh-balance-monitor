/**
 * TYPERT host-face 元数据（官方 typert-loader 的 strict 注册契约）：
 * loader 行挂载本包时，typert-loader 解析 exports["./typert"] 并导入本模块，
 * 把 TYPERT manifest 注册进 typert registry——api-gateway 按 strict 定义
 * 认领 /api/balance/* 端点。
 * 结构遵循 @deepseek-ai/dsh-typert-registry 的注册校验。
 */
import { z } from 'zod'

/** 币种条目（金额为官方原样字符串） */
const BalanceInfoSchema = z.object({
  currency: z.string(),
  totalBalance: z.string(),
  grantedBalance: z.string(),
  toppedUpBalance: z.string(),
}).readonly()

/** 峰谷计价状态（与 src/types.ts 的 PricingState 一致） */
const PricingStateSchema = z.object({
  phase: z.union([z.literal('peak'), z.literal('offpeak'), z.literal('flat')]),
  observedAt: z.number(),
  nextChangeAt: z.number(),
  peakRemainingMs: z.number(),
  effectiveAt: z.number(),
}).readonly()

/** 浏览器 Remote 边界值（与 src/types.ts 的 BalanceClientWire 一致） */
const BalanceClientWireSchema = z.object({
  ok: z.boolean(),
  isAvailable: z.boolean(),
  infos: z.array(BalanceInfoSchema),
  fetchedAt: z.number(),
  staleMs: z.number(),
  error: z.string().optional(),
  code: z.string().optional(),
  pricing: PricingStateSchema,
  pollIntervalMs: z.number(),
}).readonly()

const balanceClientWireCodec = {
  mode: 'strict',
  typeSymbol: 'dsh-balance-monitor#BalanceClientWire',
  schema: BalanceClientWireSchema,
}

export const TYPERT = {
  package: '@rainronin/dsh-balance-monitor',
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
      result: balanceClientWireCodec,
    },
    {
      id: 'dsh-balance-monitor#balance/refresh',
      service: 'balance',
      namespace: 'balance',
      method: 'refresh',
      invocation: { kind: 'direct' },
      parameters: [],
      result: balanceClientWireCodec,
    },
  ],
  model: {
    services: [],
    events: [],
    objects: [],
  },
}
