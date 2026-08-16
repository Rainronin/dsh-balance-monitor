/**
 * 把 tsc 产出的 CommonJS client 半（lib/client.js）包进官方的
 * `window.__ModuleLoader__.load({ id, factory })` 注册壳——
 * 与官方 client 包（dsh-client-ui-*）的产物形态一致，
 * 由 dsh-client-modules 服务为 /plugins/<id>/client.js。
 * 纯字符串处理，无任何子进程依赖。
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// tsc 先把 client.tsx 编译为 lib/client.js，再原地包装成浏览器 bundle
const body = readFileSync('lib/client.js', 'utf8')
const indented = body.split('\n').map((line) => line.trim() === '' ? '' : '\t\t' + line).join('\n')
const wrapper = `/* 由 dsh-balance-monitor 的 wrap-client 生成：浏览器半通过官方 __ModuleLoader__ 注册壳自注册。 */
window.__ModuleLoader__.load({
\tid: "dsh-balance-monitor",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${indented}
\t\treturn module.exports;
\t}
});
`
writeFileSync('lib/client.js', wrapper)
// types.ts 是纯类型模块；client 的 CommonJS 编译会输出无用的 lib/types.js，
// 且与 package.json 的 "type": "module" 冲突，构建后移除。
rmSync(fileURLToPath(new URL('./lib/types.js', import.meta.url)), { force: true })
console.log(`lib/client.js wrapped (${wrapper.length} bytes)`)
