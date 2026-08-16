import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 构建前清空 lib，避免源文件删除后陈旧产物残留
rmSync(fileURLToPath(new URL('./lib', import.meta.url)), { recursive: true, force: true })
console.log('lib cleaned')
