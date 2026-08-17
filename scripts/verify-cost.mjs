/**
 * 会话费用估算自检：用构造的 SessionEvent 验证官方 V4 峰谷价格计算。
 * 接入 npm run build，防止价格表/峰谷判定漂移。
 */
import assert from 'node:assert/strict'
import { computeSessionCost } from '../lib/index.js'

// 北京时间 2026-08-17 01:00 = UTC 2026-08-16 17:00（空闲）
const OFFPEAK = Date.UTC(2026, 7, 16, 17)
// 北京时间 2026-08-17 10:00 = UTC 2026-08-17 02:00（高峰）
const PEAK = Date.UTC(2026, 7, 17, 2)

function eventWith(model, time, usage) {
  return [
    { type: 'request/context', data: { model } },
    { type: 'assistant/message', time, data: { usage } },
  ]
}

const flashOffpeak = computeSessionCost(eventWith('deepseek-v4-flash', OFFPEAK, {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}))
assert.ok(Math.abs(flashOffpeak.costYuan - 6.0) < 1e-9, 'Flash 空闲：1M 未命中输入 + 1M 输出 = 1.5 + 4.5 = 6 元')

const flashPeak = computeSessionCost(eventWith('deepseek-v4-flash', PEAK, {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}))
assert.ok(Math.abs(flashPeak.costYuan - 12.0) < 1e-9, 'Flash 高峰：1M 未命中输入 + 1M 输出 = 3 + 9 = 12 元')

const flashCacheHit = computeSessionCost(eventWith('deepseek-v4-flash', OFFPEAK, {
  inputTokens: 0,
  outputTokens: 1_000_000,
  cacheReadTokens: 1_000_000,
  cacheWriteTokens: 0,
}))
assert.ok(Math.abs(flashCacheHit.costYuan - 4.55) < 1e-9, 'Flash 空闲缓存命中：0.05 + 4.5 = 4.55 元')

const proOffpeak = computeSessionCost(eventWith('deepseek/deepseek-v4-pro', OFFPEAK, {
  inputTokens: 1_000_000,
  outputTokens: 1_000_000,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}))
assert.ok(Math.abs(proOffpeak.costYuan - 18.0) < 1e-9, 'Pro 空闲：4.5 + 13.5 = 18 元')

console.log('会话费用估算（官方 V4 峰谷价格）验证通过')
