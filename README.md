# dsh-balance-monitor

[English](#english) | [中文](#中文)

A DeepSeek Harness plugin that monitors your DeepSeek API account balance: official `/user/balance` snapshots, in-session queries, Beijing-time **peak/off-peak pricing status**, and a **Matrix/native dual-style sidebar badge**.

| Matrix CRT 风格 | dsh 原生风格 |
|---|---|
| ![Matrix CRT 风格](assets/screenshot-matrix.png) | ![dsh 原生风格](assets/screenshot-native.png) |

---

<a id="english"></a>
## English

### Features

| Capability | Description |
|---|---|
| 💬 In-session query | `ds_balance` tool: the agent can fetch the official balance snapshot anytime (`force: true` bypasses the cache) |
| 🔄 Optional per-turn injection | Fresh balance can be injected into the model context before every turn (off by default — the badge + `ds_balance` tool already cover it; cache-only read, never blocks the conversation) |
| 🖥️ Sidebar badge | Matrix green-phosphor CRT style: `▸ 余额 CNY ¥32.81 · 连接正常`, `刷新` button for on-demand refresh, 30s auto polling, rail state collapses into a status lamp |
| 🔐 Zero-config key | Reuses `DEEPSEEK_API_KEY` from dsh's credential service (never written to disk, never logged) |
| 💱 Multi-currency | CNY/USD both listed (CNY first, `$`/`€`/`£` rendered per currency); amounts stay strings end-to-end, no float math |
| ⛰️ Peak/off-peak pricing | Shows `高峰 HH:MM:SS` / `空闲` in the status bar; during peak hours it counts down to the next off-peak period (Beijing time). Before 2026-08-17 the same windows are previewed, with the official billing start shown in the tooltip. |
| 💰 Session cost | The sidebar badge also shows the current conversation's estimated cumulative cost (`本会话 ¥xx.xx`), calculated from official DeepSeek V4 peak/off-peak pricing; it follows the currently selected session automatically |
| 🎨 UI style switch | `原生`/`矩阵` button toggles between the Matrix CRT badge and a native dsh look |
| 🛡️ Rate-limit friendly | 30s TTL cache + request serialization (at most one in-flight request) + 5s timeout |

### Installation

```sh
# Option 1: install from npm (recommended)
dsh plugin --profile web add @rainronin/dsh-balance-monitor

# Option 2: install straight from GitHub
dsh plugin --profile web add github:Rainronin/dsh-balance-monitor

# Option 3: clone and link-install locally (instant reload while developing)
git clone https://github.com/Rainronin/dsh-balance-monitor.git
cd dsh-balance-monitor
dsh plugin --profile web add .

# host-side changes require a restart
dsh web
```

> If pnpm blocks the `prepare` build script of a git-hosted plugin, add the
> printed key to `allowBuilds` in `$DSH_HOME/profiles/web/pnpm-workspace.yaml`
> and re-run.

The plugin joins `dsh.profile.bundles` automatically. Inspect the composed tree:

```sh
dsh --profile web --dump-config
```

### Usage

**In-session query** — just ask the agent:

```
查一下 DeepSeek 余额 / check my DeepSeek balance
```

**Sidebar badge** — at the sidebar footer next to Settings: `刷新` force-refreshes
past the cache; polling follows the host-configured interval (30s by default);
the collapsed (rail) state shows a single status lamp (green = `连接正常`,
amber = degraded). The `原生`/`矩阵` button switches between the Matrix CRT badge
and a native dsh style; the choice is remembered in `localStorage`. When a
conversation is selected, the badge also shows `本会话 ¥xx.xx` — the estimated
cumulative cost of that conversation, calculated from official DeepSeek V4
peak/off-peak pricing; switching conversations switches the cost automatically.

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | Credential reference (env var name); change for a different account |
| `cacheTtlMs` | `30000` | Cache lifetime in ms |
| `pollIntervalMs` | `30000` | Background polling interval in ms |
| `injectEveryTurn` | `false` | Whether to inject the balance into context every turn (opt-in; the badge and `ds_balance` tool are on by default) |
| `requestTimeoutMs` | `5000` | Official-API request timeout in ms |

Override in the profile's `cordis.patch.yml`:

```yaml
- id: balance-monitor
  config:
    cacheTtlMs: 10000
    pollIntervalMs: 10000
```

### Error semantics

| State | Behavior |
|---|---|
| No API key configured | Tool returns a Chinese hint; badge shows amber `未配置密钥` |
| API failure + stale cache | Last snapshot is returned, marked "snapshot expired Ns (last refresh failed, retrying)" |
| API failure + no cache | The real failure (HTTP status / network / timeout / bad response) is surfaced; badge shows amber `无信号` |
| Invalid or rejected API key | Tool returns the real reason; badge shows amber `未配置密钥` |
| Injection-time API failure | Silent degradation: nothing injected, conversation unaffected |

### Peak/off-peak pricing status

The official pricing page defines peak hours as **Beijing time 09:00-12:00 and
14:00-18:00**; all other hours are off-peak. The new pricing takes effect at
**2026-08-17 00:00 Beijing time**. The host computes the current phase and the
badge shows:

| Phase | Status text |
|---|---|
| Peak | `高峰 02:14:23` — counts down to the off-peak period |
| Off-peak | `空闲` |
| Before 2026-08-17 | Same windows are previewed; the tooltip notes `2026-08-17 00:00` as the billing start |

### Architecture

```
host half (Node)
  BalanceRemoteService (service key `balance`; loader mounts the default-exported class)
  ├─ credential lookup → GET https://api.deepseek.com/user/balance → 30s TTL cache + serialization
  ├─ ds_balance tool + optional agent/pre-step injection + configurable polling
  ├─ peak/off-peak pricing state computed on Beijing time (09:00-12:00, 14:00-18:00 peak)
  ├─ balance/sessionCost: scans the selected session's event log and estimates cumulative
  │   cost using official DeepSeek V4 peak/off-peak prices
  └─ typert/typert-host.js: hand-written TYPERT strict manifest (exported as ./typert,
      registered by typert-loader; api-gateway claims /api/balance/* via the strict definition)

browser half (client.tsx → lib/client.js, wrapped in the official __ModuleLoader__ shell)
  ├─ sidebar.footer.action slot: Matrix/native dual-style badge (wide/rail states)
  └─ data channel: direct calls over the official RPC protocol (POST /api/balance/<method>,
      client-request envelope), host-configured polling + `刷新` force refresh + phase-transition refresh
```

The third-party Typert Remote client path (`$mount` contribution → namespace
service) failed silently in practice, so the badge talks the official RPC wire
protocol directly (dsh-host-apiproxy fetch-carrier envelope), while the host
side keeps the official TYPERT strict registration.

### Development

```sh
npm install            # toolchain (typescript/pnpm + type deps)
npm run build          # clean + tsc (host ESM/client CJS) + wrap-client + RPC/typert self-checks
node scripts/diagnose.mjs # local cordis integration diagnosis (mock services)
dsh plugin --profile web add .   # link install
```

Build notes: `npm run build` cleans `lib/` first, compiles the host half as ESM
and the browser half as CommonJS, wraps the client with `scripts/wrap-client.mjs` into
the official `window.__ModuleLoader__.load` shell (same shape as official
dsh-client-ui-* artifacts, served by dsh-client-modules as
`/plugins/<id>/client.js`), then runs `scripts/verify-client.mjs` (bundle registration,
slot mounting, RPC envelope and `rpcId` echo) and `scripts/verify-typert.mjs` (strict
codec positive/negative cases).

### Further reading

- [`docs/UI设计构思.md`](docs/UI设计构思.md) (Chinese): Matrix visual spec (phosphor CRT token system)

---

<a id="中文"></a>
## 中文

DeepSeek Harness 插件：DeepSeek API 账户余额监测——官方 `/user/balance` 接口快照 + 会话内查询 + 北京时间峰谷计价状态 + Matrix/原生双风格侧边栏徽章。

### 功能

| 能力 | 说明 |
|---|---|
| 💬 会话内查询 | `ds_balance` 工具：agent 随时可查官方余额快照（`force: true` 穿透缓存） |
| 🔄 每轮注入（可选） | 默认关闭。开启后每轮对话前自动把最新余额放进模型上下文（只读缓存，绝不阻塞对话）——徽章与工具已默认覆盖该信息 |
| 🖥️ 侧边栏徽章 | Matrix 绿磷光 CRT 风格：`▸ 余额 CNY ¥32.81 · 连接正常`，`刷新` 按钮手动穿透刷新，30s 自动轮询，折叠态退化为状态灯 |
| 🔐 零配置密钥 | 复用 dsh 凭证服务里的 `DEEPSEEK_API_KEY`（不落盘、不打印、不缓存） |
| 💱 多币种 | CNY/USD 全列（CNY 优先，USD/EUR/GBP 显示对应货币符号），金额全程字符串透传，无浮点运算 |
| ⛰️ 峰谷计价状态 | 状态栏显示 `高峰 HH:MM:SS` / `空闲`；高峰期实时倒计时到空闲阶段（北京时间）。2026-08-17 前按同一窗口预览，tooltip 标注正式计费生效时间 |
| 💰 单会话费用 | 侧边栏徽章额外显示当前会话累计估算费用（`本会话 ¥xx.xx`），按 DeepSeek 官方 V4 峰谷价格计算，切换会话时自动跟随当前会话 |
| 🎨 UI 风格切换 | `原生`/`矩阵` 按钮在 Matrix CRT 与 dsh 原生风格之间切换，选择保存在 `localStorage` |
| 🛡️ 限流友好 | 30s TTL 缓存 + 请求串行化（同一时刻最多一个在途请求）+ 5s 超时 |

### 安装

```sh
# 方式一：npm 直装（推荐）
dsh plugin --profile web add @rainronin/dsh-balance-monitor

# 方式二：GitHub 直装
dsh plugin --profile web add github:Rainronin/dsh-balance-monitor

# 方式三：本地 clone 后 link 安装（改代码即时生效，适合二次开发）
git clone https://github.com/Rainronin/dsh-balance-monitor.git
cd dsh-balance-monitor
dsh plugin --profile web add .

# host 半改动后重启生效
dsh web
```

> git 托管插件若被 pnpm 拦截 prepare 构建脚本，按提示把键加进
> `$DSH_HOME/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds` 再重跑。

安装后插件自动进入 `dsh.profile.bundles` 层列表；检查配置树：

```sh
dsh --profile web --dump-config
```

### 使用

**会话内查询**——直接让 agent 查：

```
帮我查一下 DeepSeek 余额
```

**侧边栏徽章**——侧边栏底部（Settings 旁）：`刷新` 按钮穿透缓存立即刷新；
轮询间隔跟随 host 配置（默认 30s）；折叠态（rail）显示单色状态灯（绿 = `连接正常`，
琥珀 = 异常）。`原生`/`矩阵` 按钮在 Matrix CRT 徽章与 dsh 原生风格之间切换，选择
保存在 `localStorage`。选中某个会话时，徽章还会显示 `本会话 ¥xx.xx`——按 DeepSeek
官方 V4 峰谷价格估算的当前会话累计费用；切换会话时会自动跟随当前会话。

### 配置

| 键 | 默认值 | 说明 |
|---|---|---|
| `apiKeyEnv` | `DEEPSEEK_API_KEY` | 凭证引用名（环境变量名），多账号时改这里 |
| `cacheTtlMs` | `30000` | 缓存有效期（毫秒） |
| `pollIntervalMs` | `30000` | 后台轮询间隔（毫秒） |
| `injectEveryTurn` | `false` | 是否每轮注入余额到模型上下文（默认关闭，按需开启） |
| `requestTimeoutMs` | `5000` | 官方接口请求超时（毫秒） |

覆盖示例（profile 的 `cordis.patch.yml`）：

```yaml
- id: balance-monitor
  config:
    cacheTtlMs: 10000
    pollIntervalMs: 10000
```

### 错误语义

| 状态 | 表现 |
|---|---|
| 未配置 key | 工具返回中文提示；徽章显示琥珀 `未配置密钥` |
| 接口失败 + 有旧缓存 | 返回最后一次快照并标注"快照已过期 Ns（最近一次刷新失败，自动重试中）" |
| 接口失败 + 无缓存 | 返回真实失败原因（HTTP 状态码 / 网络 / 超时 / 响应格式）；徽章显示琥珀 `无信号` |
| key 无效或未授权 | 返回真实原因；徽章显示琥珀 `未配置密钥` |
| 每轮注入时接口失败 | 静默降级：不注入、不打断对话 |

### 峰谷计价状态

官方价格页定义高峰时段为**北京时间 09:00-12:00、14:00-18:00**，其余为空闲；
新计价于 **2026-08-17 00:00 北京时间**生效。host 计算当前阶段，徽章显示：

| 阶段 | 状态栏 |
|---|---|
| 高峰 | `高峰 02:14:23`——倒计时到进入空闲阶段 |
| 空闲 | `空闲` |
| 2026-08-17 前 | 按同一窗口预览；tooltip 标注 `2026-08-17 00:00` 为正式计费起点 |

### 架构

```
host 半（Node）
  BalanceRemoteService（服务键 balance，loader 行直接挂载 default 导出类）
  ├─ 凭证解析 → GET https://api.deepseek.com/user/balance → 30s TTL 缓存 + 串行化
  ├─ ds_balance 工具 + 可配置轮询（每轮注入为可选项，默认关闭）
  ├─ 峰谷计价状态：按北京时间 09:00-12:00、14:00-18:00 计算高峰
  ├─ balance/sessionCost：扫描所选会话事件日志，按官方 DeepSeek V4 峰谷价格估算累计费用
  └─ typert/typert-host.js：手写 TYPERT strict 元数据（./typert 导出，typert-loader 注册，
      api-gateway 按 strict 定义认领 /api/balance/* 端点）

browser 半（client.tsx → lib/client.js，__ModuleLoader__ 注册壳）
  ├─ sidebar.footer.action slot：Matrix/原生双风格徽章（wide/rail 双态）
  └─ 数据通道：官方 RPC 公开协议直调（POST /api/balance/<method>，
      client-request 信封），host 配置轮询 + `刷新` 穿透刷新 + 阶段切换即时刷新
```

第三方 Typert Remote 客户端链路（`$mount` 贡献 → 命名空间服务）在本机环境实测
静默失效，故徽章改用官方 RPC 公开协议直调（dsh-host-apiproxy fetch carrier 信封），
host 端严格保留官方 TYPERT strict 注册路径。

### 开发

```sh
npm install            # 装工具链（typescript/pnpm，含类型依赖）
npm run build          # clean + tsc（host ESM/client CJS）+ wrap-client 包壳 + RPC/typert 自检
node scripts/diagnose.mjs # 本地 cordis 集成诊断（mock 服务验证工具注册与服务可见性）
dsh plugin --profile web add .   # link 安装
```

构建说明：`npm run build` 先清空 `lib/`，host 半编译为 ESM、browser 半编译为
CommonJS，再经 `scripts/wrap-client.mjs` 包进官方 `window.__ModuleLoader__.load` 注册壳
（与官方 dsh-client-ui-* 产物同构，由 dsh-client-modules 服务为
`/plugins/<id>/client.js`）；随后 `scripts/verify-client.mjs` 验证 bundle 注册、slot
挂载、RPC 信封与 `rpcId` 回显，`scripts/verify-typert.mjs` 验证 strict codec 正反例。

### 延伸阅读

- [`docs/UI设计构思.md`](docs/UI设计构思.md)：Matrix 视觉规范（磷光 CRT token 系统）
