/**
 * 诊断脚本：用真实 cordis 运行时 + 真实 TimerService 挂载本插件，
 * 验证插件挂载 → BalanceRemoteService 构造 → 工具注册 → 服务可见 的完整链路。
 */
import { Context, Service } from '@deepseek-ai/cordis'
import TimerService from '@deepseek-ai/cordis-plugin-timer'

// mock 凭证服务：resolve 永远返回假 key（不发起任何网络请求）
class MockCredentials extends Service {
  constructor(ctx) { super(ctx, 'credentials') }
  async resolve() { return { value: 'dummy-key', source: 'test' } }
}

// mock 工具注册表：只记录 register 调用
class MockTools extends Service {
  registered = []
  constructor(ctx) { super(ctx, 'tools') }
  register(def) { this.registered.push(def); return () => {} }
}

const plugin = await import('../lib/index.js')
// loader 会做 exports.default ?? exports 提升；此处模拟同样语义
const pluginBody = plugin.default ?? plugin
console.log('模块导出:', Object.keys(plugin).join(', '))
console.log('inject:', JSON.stringify(pluginBody.inject))

const root = new Context()
await root.plugin(MockCredentials)
await root.plugin(MockTools)
await root.plugin(TimerService)

try {
  await root.plugin(pluginBody, {})
} catch (e) {
  console.error('插件挂载失败:', e)
  process.exit(1)
}

// 等待子 fiber（BalanceRemoteService）异步激活
await new Promise((r) => setTimeout(r, 100))

const tools = root.get('tools')
console.log('tools 服务存在:', tools !== undefined)
console.log('注册的工具数:', tools?.registered.length)
console.log('注册的工具名:', tools?.registered.map((t) => t.name).join(', '))
console.log('balance 服务存在:', root.get('balance') !== undefined)

// 直接 new 服务类：同步构造，任何错误直接可见
const root2 = new Context()
await root2.plugin(MockCredentials)
await root2.plugin(MockTools)
await root2.plugin(TimerService)
const instance = new plugin.BalanceRemoteService(root2, {
  apiKeyEnv: 'DEEPSEEK_API_KEY',
  cacheTtlMs: 30_000,
  pollIntervalMs: 30_000,
  injectEveryTurn: false,
  requestTimeoutMs: 5_000,
})
console.log('直接 new 成功，工具数:', root2.get('tools').registered.length)
console.log('balance 服务已注册:', root2.get('balance') !== undefined)
console.log('remote 方法:', Object.getOwnPropertyNames(Object.getPrototypeOf(instance)).join(', '))
console.log('默认 injectEveryTurn:', instance.config.injectEveryTurn)

await root2.fiber.dispose()
await root.fiber.dispose()
process.exit(0)
