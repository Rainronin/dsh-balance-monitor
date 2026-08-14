import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// 捕获 bundle 的注册与 apply 行为
let registration
let registered
const fetchCalls = []
const window = { __ModuleLoader__: { load(value) { registration = value } } }

const fakeBalance = {
  ok: true, isAvailable: true,
  infos: [{ currency: 'CNY', totalBalance: '1', grantedBalance: '0', toppedUpBalance: '1' }],
  fetchedAt: 1, staleMs: 0,
}

// 在 VM 中执行浏览器 bundle（注册壳自注册）；callBalance 用裸 fetch，故注入全局
vm.runInNewContext(readFileSync('lib/client.js', 'utf8'), {
  window,
  crypto: { randomUUID: () => 'verify-rpc-id' },
  fetch: async (url, init) => {
    fetchCalls.push({ url: String(url), body: JSON.parse(String(init.body)) })
    return {
      ok: true,
      async json() {
        return { type: 'server-response', rpcId: 'x', result: { ok: true, value: fakeBalance } }
      },
    }
  },
})
assert.equal(registration?.id, 'dsh-balance-monitor')

// 执行 factory，拿到模块导出
const api = registration.factory((id) => {
  if (id === 'react') return { useEffect() {}, useState() { return [null, () => {}] } }
  if (id === 'react/jsx-runtime') return { jsx() {}, jsxs() {} }
  throw new Error(`测试遇到未知依赖：${id}`)
})
assert.ok(typeof api.apply === 'function', '模块应导出 apply')

// 用 mock slots 跑 apply，验证 slot 注册
api.apply({
  slots: {
    register(options, component) {
      registered = { options, component }
      return () => {}
    },
  },
})

assert.equal(registered?.options?.name, 'sidebar.footer.action')
assert.equal(registered?.options?.id, 'balance-monitor')
assert.ok(typeof registered?.component === 'function')

// 调 inject 面的 get：应走官方 RPC 信封直调并解出 BalanceWire
const injected = registered.options.inject()
const wire = await injected.get()
assert.deepEqual(wire, fakeBalance)
assert.equal(fetchCalls.length, 1)
assert.equal(fetchCalls[0].url, '/api/balance/get')
assert.equal(fetchCalls[0].body.type, 'client-request')
assert.equal(fetchCalls[0].body.method, 'balance/get')
assert.deepEqual(fetchCalls[0].body.payload, { args: {} })

console.log('客户端 bundle 注册、slot 挂载与 RPC 直调协议验证通过')
