# AGENTS.md — dsh-balance-monitor

## 项目定位
DeepSeek Harness 插件：DeepSeek API 余额监测。host 半提供缓存/工具/注入/RPC，
browser 半提供侧边栏徽章（Matrix CRT 与 dsh 原生双风格、峰谷计价状态）。

## 怎么跑
```sh
npm install
npm run build        # clean → tsc(host ESM + client CJS) → wrap → verify-client → verify-typert → verify-cost
node scripts/diagnose.mjs    # mock 服务诊断
dsh plugin --profile web add .   # 本地安装
dsh web              # host 改动后必须重启；client 改动浏览器 Ctrl+F5
```

## 技术栈与关键契约
- TypeScript 严格模式；host `src/index.ts` 为 loader 直接挂载的 default Service 类。
- 服务键 `balance` 同时是 Typert namespace；`typert/typert-host.js` 是手写 strict manifest。
- 余额金额全程字符串；API key 只经 `ctx.credentials` 解析，不落盘、不打日志。
- 配置 schema 有边界校验：毫秒数 `min(1)`，`apiKeyEnv` 必须匹配 POSIX 变量名。
- 客户端直调官方 RPC 信封 `/api/balance/get|refresh|sessionCost`，必须校验 `rpcId` 回显。

## 峰谷计价规则（唯一权威实现位置：src/index.ts）
- 高峰：北京时间 09:00–12:00、14:00–18:00；其余空闲。
- 2026-08-17 00:00 起正式计费；此前按窗口预览，生效时间只在 tooltip 标注。
- host 计算 `PricingState` 随 `BalanceClientWire` 下发；客户端只展示与倒计时。

## 目录约定
- `src/` 源码；`lib/` 构建产物（需提交，GitHub 直装依赖）；`assets/` 双风格截图。
- `scripts/` 构建与诊断脚本；`docs/` 设计规范及本地收尾文档；`typert/` Typert 宿主契约。
- `README.md` 面向用户；`docs/开发计划.md`、`docs/排障记录.md` 为本地文档（gitignore）。
- 新增验证脚本后接入 `npm run build`，不要在 build 外留“手动记得跑”的检查。

## 当前状态与下一步
- 功能已实机验证：余额、峰谷计价、双风格切换、错误分类、配置边界、单会话费用估算均正常。
- 待办：无。
