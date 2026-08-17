import assert from 'node:assert/strict'
import { TYPERT } from '../typert/typert-host.js'

// TYPERT strict manifest 正反例自检：防止手写 codec 与 src/types.ts 漂移
const invocations = TYPERT.invocations
assert.equal(invocations.length, 3)
assert.deepEqual(invocations.map((item) => `${item.namespace}/${item.method}`), ['balance/get', 'balance/refresh', 'balance/sessionCost'])

const schema = invocations[0].result.schema
assert.equal(invocations[0].result.mode, 'strict')
assert.ok(typeof schema.parse === 'function', 'result codec 必须提供 zod parse()')

const valid = {
  ok: true,
  isAvailable: true,
  infos: [
    { currency: 'CNY', totalBalance: '32.81', grantedBalance: '0', toppedUpBalance: '32.81' },
    { currency: 'USD', totalBalance: '5.00', grantedBalance: '0', toppedUpBalance: '5.00' },
  ],
  fetchedAt: 1,
  staleMs: 0,
  pricing: {
    phase: 'peak',
    observedAt: 1,
    nextChangeAt: 2,
    peakRemainingMs: 1,
    effectiveAt: 0,
  },
  pollIntervalMs: 30_000,
}

assert.doesNotThrow(() => schema.parse(valid), '合法 BalanceClientWire 应通过 strict codec')

const missingPricing = { ...valid }
delete missingPricing.pricing
assert.throws(() => schema.parse(missingPricing), /pricing/, '缺少 pricing 应被 strict codec 拒绝')

const wrongPollType = { ...valid, pollIntervalMs: '30000' }
assert.throws(() => schema.parse(wrongPollType), /pollIntervalMs/, 'pollIntervalMs 类型错误应被 strict codec 拒绝')

const wrongPhase = { ...valid, pricing: { ...valid.pricing, phase: 'peak-time' } }
assert.throws(() => schema.parse(wrongPhase), /pricing/, '非法 phase 应被 strict codec 拒绝')

// balance/sessionCost：参数与结果 codec 正反例
const sessionCostInvocation = invocations.find((item) => item.method === 'sessionCost')
assert.ok(sessionCostInvocation, '应包含 balance/sessionCost 调用')
assert.equal(sessionCostInvocation.parameters.length, 1)
assert.equal(sessionCostInvocation.parameters[0].name, 'sessionId')
assert.doesNotThrow(() => sessionCostInvocation.parameters[0].codec.schema.parse('s1'))
assert.doesNotThrow(() => sessionCostInvocation.result.schema.parse({ ok: true, sessionId: 's1', cost: '0.0123' }))
assert.throws(() => sessionCostInvocation.result.schema.parse({ ok: 'yes' }), /ok/, 'SessionCostWire ok 类型错误应被 strict codec 拒绝')

console.log('typert-host strict codec 正反例验证通过')
