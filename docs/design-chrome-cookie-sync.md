# Chrome 扩展 Cookie 自动同步方案设计

## 1. 背景与目标

### 1.1 背景
FeedFlow 的信息源插件（微博、X 等）依赖用户的登录 Cookie 来抓取数据。当前用户获取 Cookie 的流程门槛较高：

1. 打开浏览器开发者工具 → Application → Cookies
2. 手动复制关键 Cookie 值（如微博的 `SUB`、X 的 `auth_token`）
3. 回到 FeedFlow 设置页 → 凭证管理 → 粘贴 → 验证 → 保存

Cookie 过期后需要重复上述流程，体验不佳。

### 1.2 目标
开发一个 **Chrome 浏览器扩展**，自动读取用户在浏览器中已登录的信息源 Cookie，并**自动同步**到 FeedFlow 桌面端，实现：

- **自动同步**：扩展监听 Cookie 变化，自动将最新 Cookie 同步到桌面端，用户无需手动操作
- **状态可视**：扩展面板展示各信息源的 Cookie 获取情况与同步状态
- **自动匹配**：根据域名自动识别对应的信息源 provider
- **自动存储**：桌面端接收后自动创建或更新凭证，无需手动粘贴
- **低门槛**：用户无需了解 Cookie 结构，只需在浏览器中正常登录即可
- **主动引导**：在桌面端手动录入 Cookie 的入口处，根据扩展状态显示差异化引导文案——未安装时引导安装，已安装时引导"去浏览器登录后自动同步"

### 1.3 设计原则
- **最小权限**：扩展用 `optional_host_permissions` 按需授权域名，不请求多余权限
- **本地通信**：扩展与桌面端通过本机 HTTP 通信，数据不出本机
- **自动化优先**：同步自动发生，手动触发仅作为兜底
- **复用现有系统**：直接写入 `credentials` 表，复用加密、provider 作用域、验证逻辑
- **动态可扩展**：新增插件只需声明 `cookieDomains`，扩展无需更新版本

---

## 2. 技术方案对比与选择

### 2.1 通信方式对比

| 方案 | 实现复杂度 | 用户配置成本 | 跨平台 | 安全性 | 实时性 |
|------|-----------|------------|--------|--------|--------|
| **A. 本地 HTTP 服务器** | 低 | 低（无需配置） | ✓ | 中（仅监听 127.0.0.1） | 请求-响应 |
| B. Native Messaging | 高 | 高（需手动安装 host 配置） | ✓（路径不同） | 高 | 请求-响应 |
| C. WebSocket | 中 | 低 | ✓ | 中 | 双向实时 |
| D. 文件导出/导入 | 低 | 高（需手动操作） | ✓ | 低 | 无 |

### 2.2 方案选择：本地 HTTP 服务器

**选择理由：**

1. **实现简单**：FeedFlow 已有 MCP Server（`src/main/mcp-server/`）使用 Node.js `http` 模块监听本地端口的成熟经验，可直接复用模式
2. **零配置**：用户安装扩展后即可使用，无需手动配置 Native Messaging Host
3. **跨平台一致**：Windows/macOS/Linux 行为统一，无需处理各平台 Native Messaging 路径差异
4. **满足需求**：自动同步由扩展主动发起（cookie 变化 → POST /sync），请求-响应模式足够

**潜在问题及应对：**

- **端口冲突**：选择一个不常用的端口（如 `33940`，与 MCP 的 `33939` 相邻），并支持端口可配置
- **桌面端未运行**：扩展检测到连接失败时，在面板中提示用户"请先打开 FeedFlow"
- **CORS**：桌面端 HTTP 服务器设置 `Access-Control-Allow-Origin: chrome-extension://*`，允许扩展访问

---

## 3. 详细设计

### 3.1 整体架构

```
┌──────────────────────────────┐      ┌──────────────────────────────────┐
│  Chrome 扩展                 │      │  FeedFlow 桌面端 (Electron 主进程) │
│                              │      │                                  │
│  ┌────────────────────────┐  │      │  ┌────────────────────────────┐  │
│  │ Popup UI               │  │      │  │ Cookie Sync HTTP Server     │  │
│  │ - 多 Provider 状态面板 │  │      │  │ (127.0.0.1:33940)           │  │
│  │ - 授权/同步/手动按钮   │  │      │  └─────────────┬──────────────┘  │
│  └────────────────────────┘  │      │                │                 │
│                              │      │                ▼                 │
│  ┌────────────────────────┐  │      │  ┌────────────────────────────┐  │
│  │ chrome.cookies.onChanged│ │      │  │ 域名 → Provider 映射        │  │
│  │ 监听 Cookie 变化(防抖)  │  │      │  │ (插件声明 cookieDomains)    │  │
│  └─────────────┬──────────┘  │      │  └─────────────┬──────────────┘  │
│                │             │      │                │                 │
│                ▼             │      │                ▼                 │
│  ┌────────────────────────┐  │      │  ┌────────────────────────────┐  │
│  │ chrome.cookies.getAll  │  │      │  │ credentials:add / update   │  │
│  │ 读取 Cookie             │  │      │  │ (含 source/lastSyncedAt)    │  │
│  └─────────────┬──────────┘  │      │  └─────────────┬──────────────┘  │
│                │             │      │                │                 │
│                ▼             │      │                ▼                 │
│  ┌────────────────────────┐  │      │  ┌────────────────────────────┐  │
│  │ fetch POST /sync       │──┼──────┼──▶ 接收 Cookie 数据            │  │
│  │ POST /heartbeat        │──┼──────┼──▶ 扩展存活上报                │  │
│  │ GET /providers         │◀─┼──────┼──│ Provider 列表(动态)         │  │
│  │ GET /sync-status       │◀─┼──────┼──│ 各 Provider 同步状态        │  │
│  └────────────────────────┘  │      │  └────────────────────────────┘  │
└──────────────────────────────┘      └──────────────────────────────────┘
```

### 3.2 Chrome 扩展端设计

#### 3.2.1 扩展结构
```
feedflow-cookie-extension/
├── manifest.json          # 扩展清单（MV3）
├── popup.html             # 弹窗 UI（多 Provider 状态面板）
├── popup.js               # 弹窗逻辑
├── background.js          # Service Worker（自动同步、心跳、初始同步）
└── icons/                 # 扩展图标
```

#### 3.2.2 manifest.json 关键配置
```json
{
  "manifest_version": 3,
  "name": "FeedFlow Cookie 同步",
  "version": "1.0.0",
  "permissions": ["cookies", "alarms"],
  "optional_host_permissions": ["<all_urls>"],
  "action": {
    "default_popup": "popup.html",
    "default_title": "FeedFlow Cookie 同步状态"
  }
}
```

**权限说明：**
- `cookies`：读取/监听浏览器 Cookie 的核心权限
- `alarms`：定时心跳
- `optional_host_permissions: ["<all_urls>"]`：按需动态申请域名权限，支持新插件无需更新扩展（见 3.2.6）

#### 3.2.3 自动同步逻辑（background.js）

扩展监听已授权域名的 Cookie 变化，自动同步到桌面端：

```javascript
const SYNC_URL = 'http://127.0.0.1:33940/sync'
const DEBOUNCE_MS = 5000  // 防抖窗口

// 按域名防抖：同一域名短时间内多次变化合并为一次同步
const debounceTimers = new Map()

chrome.cookies.onChanged.addListener((changeInfo) => {
  const domain = changeInfo.cookie.domain
  // 只处理已授权且支持的域名
  if (!isSupportedDomain(domain)) return

  clearTimeout(debounceTimers.get(domain))
  debounceTimers.set(domain, setTimeout(() => syncDomain(domain), DEBOUNCE_MS))
})

async function syncDomain(domain) {
  try {
    const cookies = await chrome.cookies.getAll({ domain })
    if (!cookies.length) return
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ')
    await fetch(SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, cookie: cookieHeader }),
    })
  } catch (e) {
    // 桌面端未运行，静默忽略；状态在面板中展示
  }
}
```

**防抖策略**：按域名防抖 5 秒，不区分具体哪个 cookie 变化——只要该域名有变化就重新读取全部 cookie 同步一次，简单且不会漏。

#### 3.2.4 初始同步

扩展安装/启动时，对已授权且检测到 cookie 的 provider 执行一次全量同步，解决"装扩展前已登录"的场景：

```javascript
chrome.runtime.onInstalled.addListener(initialSync)
// 启动时也执行一次（Service Worker 重新激活时）
initialSync()

async function initialSync() {
  const providers = await fetchProviders()  // GET /providers
  for (const p of providers) {
    const granted = await chrome.permissions.contains({ origins: p.domains.map(d => `https://*.${d}/*`) })
    if (!granted) continue
    const cookies = await chrome.cookies.getAll({ domain: p.domains[0] })
    if (cookies.length) syncDomain(p.domains[0])
  }
}
```

#### 3.2.5 心跳上报（Heartbeat）

桌面端无法主动探测扩展是否安装，由扩展主动上报：

```javascript
const HEARTBEAT_URL = 'http://127.0.0.1:33940/heartbeat'

async function sendHeartbeat() {
  try {
    await fetch(HEARTBEAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
      }),
    })
  } catch (e) { /* 桌面端未运行，静默忽略 */ }
}

chrome.runtime.onInstalled.addListener(sendHeartbeat)
sendHeartbeat()
chrome.alarms.create('heartbeat', { periodInMinutes: 60 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'heartbeat') sendHeartbeat()
})
```

#### 3.2.6 动态 Provider 与授权

扩展不硬编码 provider 列表，启动时从桌面端 `/providers` 动态获取：

```javascript
async function fetchProviders() {
  const res = await fetch('http://127.0.0.1:33940/providers')
  return res.json()  // ProviderInfo[]
}
```

对每个 provider 的域名，检查是否已授权；未授权的在面板中显示「点击授权」按钮，用户点击后调用 `chrome.permissions.request()` 授权。授权前不能读取 cookie、不能自动同步。

#### 3.2.7 Popup UI 设计（多 Provider 状态面板）

扩展面板是各 provider 的状态总览，每行展示：

| 列 | 数据来源 | 说明 |
|----|---------|------|
| 信息源名称 | `/providers` | 如"微博" |
| 授权状态 | `chrome.permissions.contains` | 已授权 / 未授权（未授权显示授权按钮） |
| Cookie 检测 | `chrome.cookies.getAll` | ✅ 已检测 / ⚠️ 未检测（请先登录） |
| 同步状态 | `/sync-status` | 从未同步 / 上次同步 X 前（成功）/ 上次同步失败：原因 |
| 操作 | — | 「立即同步」按钮（已授权+已检测 cookie 时可点击） |

面板底部：
- 自动同步开关（默认开）
- 桌面端连接状态（`/health` 检测）

**自动同步开关**：关闭后扩展只展示状态，不自动同步，保留手动「立即同步」按钮。开关状态仅在扩展端，不同步到桌面端。

### 3.3 桌面端设计

#### 3.3.1 Cookie Sync HTTP Server
在 Electron 主进程中新增一个轻量 HTTP 服务器，监听 `127.0.0.1:33940`。

**端点设计：**

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/health` | 健康检查，扩展用于检测桌面端是否运行 |
| `POST` | `/sync` | 接收 Cookie 数据，返回同步结果 |
| `GET` | `/providers` | 返回支持的 provider 列表及域名（扩展动态获取） |
| `GET` | `/sync-status` | 返回各 provider 的同步状态（扩展面板展示） |
| `POST` | `/heartbeat` | 扩展上报自身存在，桌面端据此判断扩展状态 |

**POST /sync 请求体：**
```typescript
interface SyncRequest {
  domain: string        // 域名
  cookie: string        // 组装好的 Cookie 头
}
```

**POST /sync 响应体：**
```typescript
interface SyncResponse {
  success: boolean
  provider?: string        // 匹配到的 provider
  action?: 'created' | 'updated'
  verified?: boolean       // Cookie 是否通过验证（验证失败时 success=false）
  message?: string
  error?: string
}
```

**GET /providers 响应体：**
```typescript
interface ProviderInfo {
  provider: string       // 'weibo'
  providerName: string   // '微博'
  domains: string[]      // ['weibo.com', 'weibo.cn']
  hasVerify: boolean     // 是否支持 verifyCookie
}
```

**GET /sync-status 响应体：**
```typescript
interface SyncStatusResponse {
  providers: {
    provider: string
    providerName: string
    hasCredential: boolean
    source: 'manual' | 'extension' | null
    lastSyncedAt: number | null
    lastSyncStatus: 'success' | 'failed' | null
    lastSyncError: string | null
  }[]
}
```

#### 3.3.2 域名 → Provider 映射（动态）

不再硬编码映射表。插件在声明中新增 `cookieDomains` 字段，桌面端加载插件时动态收集：

```javascript
// 插件声明示例（plugins/weibo-home-timeline/plugin.js）
const meta = {
  id: 'feedflow-plugin-weibo',
  provider: 'weibo',
  providerName: '微博',
  cookieDomains: ['weibo.com', 'weibo.cn'],  // 新增字段
}
```

桌面端构建动态映射，`/sync` 时根据域名反查 provider：

```typescript
function matchProvider(domain: string): string | undefined {
  for (const [provider, domains] of Object.entries(PROVIDER_DOMAINS)) {
    if (domains.some(d => domain === d || domain.endsWith('.' + d))) {
      return provider
    }
  }
  return undefined
}
```

#### 3.3.3 凭证模型扩展

`Credential` 模型新增字段：

```typescript
interface Credential {
  // ... 现有字段（id, provider, name, value, ...）
  source: 'manual' | 'extension'          // 来源：手动录入 / 扩展同步
  lastSyncedAt: number | null              // 上次同步时间戳
  lastSyncStatus: 'success' | 'failed' | null
  lastSyncError: string | null
}
```

**不变量：一个 provider 同时只存在一个 credential。** 手动录入和扩展同步共用同一个槽位。

#### 3.3.4 凭证存储逻辑

```typescript
async function handleSync(req: SyncRequest): Promise<SyncResponse> {
  const provider = matchProvider(req.domain)
  if (!provider) {
    return { success: false, error: `不支持的网站: ${req.domain}` }
  }

  // 验证（默认开启，插件有 verifyCookie 就调）
  let verified = true
  if (pluginHasVerify(provider)) {
    const result = await verifyCookie(provider, req.cookie)
    if (!result.valid) {
      // 验证失败：拒绝写入，记录失败状态
      updateSyncStatus(provider, { lastSyncStatus: 'failed', lastSyncError: result.error })
      return { success: false, verified: false, error: result.error }
    }
  }

  // 一个 provider 单 credential：查找唯一凭证，有则更新、无则创建
  const existing = listCredentials(provider)[0]
  if (existing) {
    updateCredential(existing.id, {
      value: req.cookie,
      source: 'extension',              // 覆盖并转换来源
      lastSyncedAt: Date.now(),
      lastSyncStatus: 'success',
      lastSyncError: null,
    })
    return { success: true, provider, action: 'updated', verified }
  } else {
    addCredential({
      provider,
      name: `${providerLabel(provider)} Cookie（自动同步）`,
      value: req.cookie,
      source: 'extension',
      lastSyncedAt: Date.now(),
      lastSyncStatus: 'success',
      lastSyncError: null,
    })
    return { success: true, provider, action: 'created', verified }
  }
}
```

**关键规则：**
- 验证失败 → **拒绝写入**，不创建/更新 credential，仅记录失败状态
- 扩展同步 → 覆盖现有 credential 并把 `source` 转为 `extension`
- `verified` 不持久化，只是 `/sync` 响应的一次性反馈（cookie 有效性会随时间变化）

#### 3.3.5 与现有系统的集成
- **加密存储**：复用 `encryption.ts` 的 `encrypt/decrypt`
- **凭证表**：复用 `credentials.ts` 的 `addCredential/updateCredential`，扩展 `source` 等字段
- **Cookie 验证**：调用 `plugins:verify-cookie` 逻辑，验证失败则拒绝写入
- **Session 注入**：存储后触发 `setWeiboCookies` 等逻辑，更新 Electron session 中的 Cookie

### 3.4 通信安全

#### 3.4.1 网络层安全
- **仅监听 127.0.0.1**：不绑定 `0.0.0.0`，数据不出本机
- **CORS 白名单**：`Access-Control-Allow-Origin` 允许 `chrome-extension://*`
- **无认证 Token**：仅监听本机且 CORS 限制，本地通信场景下 Token 非必须

#### 3.4.2 数据安全
- **传输**：本机 HTTP，不经过网络，无中间人风险
- **存储**：复用 `safeStorage` 加密
- **日志**：不打印 Cookie 明文值到日志

### 3.5 扩展检测与桌面端 UI 引导

#### 3.5.1 扩展检测机制

桌面端无法主动探测扩展是否安装，采用**扩展主动上报**方式：

1. 扩展在安装后、启动时、每小时定时向桌面端 `POST /heartbeat`（见 3.2.5）
2. 桌面端收到后记录 `extensionLastSeen = Date.now()`，保存在内存中（可持久化到设置文件）
3. 桌面端提供 IPC 通道 `cookie-sync:get-status`，渲染端查询扩展状态：
   ```typescript
   interface ExtensionStatus {
     status: 'unknown' | 'active' | 'stale'
     lastSeen: number | null
     serverRunning: boolean
   }
   ```
4. **状态判定**：
   - `unknown`：从未收到心跳（`lastSeen === null`）→ 扩展未安装/从未运行
   - `active`：24 小时内有心跳 → 扩展正常运行
   - `stale`：超过 24 小时无心跳 → 扩展可能未运行（浏览器关闭/扩展被禁用/桌面端重启丢状态）

三态**只影响 UI 引导文案，不限制任何功能**——`/sync` 和 `/heartbeat` 端点始终可用。

#### 3.5.2 UI 引导逻辑

在两个 Cookie 录入入口（`CredentialsPanel.tsx` 和 `SourceConfigForm.tsx`）中，根据 `ExtensionStatus.status` 显示不同引导：

**状态 `unknown`：扩展未安装**

显示提示横幅，置于手动录入表单上方：

> 💡 **更简单的方式：安装 FeedFlow Chrome 扩展**
> 安装后在浏览器中登录微博 / X，Cookie 会自动同步到此处，无需手动复制粘贴。
> [安装扩展]　[了解更多]

- **安装扩展**按钮：打开 Chrome 网上应用店链接（`shell.openExternal`）；若未上架，显示"加载已解压的扩展程序"图文说明
- 手动录入表单保留，标注"手动录入（高级）"

**状态 `active`：扩展正常运行**

显示提示横幅：

> ✅ **检测到 FeedFlow 扩展已安装**
> 请在浏览器中登录对应的网站（微博 / X / V2EX），Cookie 会自动同步到此处，无需手动操作。
> [打开浏览器]　[刷新凭据列表]

- **打开浏览器**按钮：根据当前选中的 provider，用 `shell.openExternal` 打开对应登录页
- **刷新凭据列表**按钮：重新拉取凭据列表
- 手动录入表单折叠弱化，标注"手动录入（高级）"，默认收起

**状态 `stale`：扩展可能未运行**

显示：

> ⚠️ FeedFlow 扩展可能未运行，自动同步可能已停止。请打开 Chrome 浏览器确认扩展已启用。

#### 3.5.3 引导文案的位置

| 入口 | 文件 | 引导位置 |
|------|------|---------|
| 设置 → 凭据 | `src/renderer/src/components/credentials/CredentialsPanel.tsx` | 表单顶部横幅 + 空状态提示 |
| 添加信息源 → 凭据字段 | `src/renderer/src/components/sources/SourceConfigForm.tsx` | 凭据下拉框旁/下方的提示行 |
| 凭据过期/验证失败 | 抓取失败通知（Toast/Notification） | 通知中附带"在浏览器重新登录后自动同步"提示 |

#### 3.5.4 桌面端凭据列表展示

自动同步来的 credential（`source=extension`）在凭据列表中：
- 显示「自动同步」标签
- 显示上次同步时间（`lastSyncedAt`）
- 显示同步状态（上次成功/失败）
- **编辑按钮置灰**，标注"由扩展自动维护，请勿手动编辑"

#### 3.5.5 引导状态查询与刷新时机

- 渲染端在以下时机调用 `cookie-sync:get-status`：
  - 凭据面板挂载时
  - 添加信息源对话框打开时
  - 凭据列表刷新时
- 状态缓存在组件本地 state，无需全局 store

---

## 4. 技术可行性验证

### 4.1 Chrome 扩展读取/监听 Cookie — ✅ 可行
- `chrome.cookies.getAll({ domain })` 和 `chrome.cookies.onChanged` 是 MV3 标准 API
- 需要对应域名的 host 权限（通过 `optional_host_permissions` 动态授权）
- 可读取包括 `httpOnly` 在内的所有 Cookie

### 4.2 扩展向本地 HTTP 发送请求 — ✅ 可行
- 扩展的 Service Worker / Popup 可以使用 `fetch` 访问 `http://127.0.0.1:*`
- MV3 扩展不需要为 localhost 声明额外权限

### 4.3 Electron 主进程启动 HTTP 服务器 — ✅ 可行
- 已有 MCP Server 使用 `node:http` 的 `createServer` 监听本地端口的成熟实现
- 主进程生命周期内可保持服务器运行

### 4.4 动态域名匹配 Provider — ✅ 可行
- 插件声明 `cookieDomains`，桌面端动态构建映射
- 后缀匹配支持子域名

### 4.5 写入凭证表 — ✅ 可行
- 直接复用 `addCredential` / `updateCredential`
- 一个 provider 单 credential，`source` 字段区分来源

### 4.6 扩展存活上报与检测 — ✅ 可行
- `chrome.runtime.onInstalled`、`chrome.alarms` 是 MV3 标准 API
- 桌面端用内存变量 + 可选持久化记录 `extensionLastSeen`

### 4.7 动态权限授权 — ✅ 可行
- `optional_host_permissions` + `chrome.permissions.request()` 是 MV3 标准能力
- 可在运行时按需授权新域名，无需更新扩展版本

### 4.8 关键风险点

| 风险 | 影响 | 应对 |
|------|------|------|
| 桌面端未运行 | 扩展无法同步 | 扩展面板提示"请先打开 FeedFlow"；心跳静默失败 |
| 端口被占用 | 服务器启动失败 | 支持端口自动递增或在设置中配置 |
| Cookie 验证失败 | 同步无效 | 拒绝写入，面板显示失败原因，引导重新登录 |
| 用户未登录 | 无 cookie 可同步 | 扩展面板显示"未检测到 Cookie，请先登录" |
| 心跳超时 | UI 误判扩展状态 | 24h 阈值 + stale 文案仅提醒，不限制功能 |
| 新插件需授权 | 扩展无法读新域名 cookie | 面板提示"检测到新信息源，点击授权" |

---

## 5. 实现步骤

### 阶段一：桌面端 HTTP 服务器与凭证模型（1-2 天）
1. 新建 `src/main/cookie-sync/server.ts`，实现 HTTP 服务器
2. 实现 `/health`、`/sync`、`/providers`、`/sync-status`、`/heartbeat` 端点
3. 插件声明新增 `cookieDomains` 字段，桌面端动态构建域名映射
4. `Credential` 模型新增 `source`、`lastSyncedAt`、`lastSyncStatus`、`lastSyncError` 字段
5. 实现 `/sync` 写入逻辑（验证、单 credential、覆盖转换 source）
6. 实现扩展状态记录（`extensionLastSeen`）与 IPC 通道 `cookie-sync:get-status`
7. 在 `index.ts` 中启动服务器
8. 添加设置项：开关、端口号

### 阶段二：Chrome 扩展（2-3 天）
1. 创建扩展项目结构（manifest.json, popup.html, popup.js, background.js）
2. 实现 `optional_host_permissions` 动态授权流程
3. 实现 `/providers` 动态获取 provider 列表
4. 实现 `chrome.cookies.onChanged` 自动同步（按域名防抖）
5. 实现初始同步
6. 实现心跳上报
7. 实现 Popup 多 Provider 状态面板（授权状态、cookie 检测、同步状态、手动同步按钮、自动同步开关）

### 阶段三：桌面端 UI 引导（1 天）
1. 在 `CredentialsPanel.tsx` 凭据表单顶部添加引导横幅组件
2. 在 `SourceConfigForm.tsx` 凭据字段旁添加引导提示行
3. 实现三态（unknown/active/stale）的条件渲染与文案
4. 实现"安装扩展"、"打开浏览器"、"刷新凭据列表"按钮
5. 凭据列表展示自动同步标签、上次同步时间，编辑置灰
6. 抓取失败通知中附带自动同步提示

### 阶段四：联调与优化（1 天）
1. 端到端联调：微博、X 等信息源
2. 自动同步防抖、初始同步、手动兜底验证
3. Session 注入更新
4. UI 优化与边界情况处理

### 阶段五：打包与发布（0.5 天）
1. 扩展打包或提供文件夹加载方式
2. 桌面端功能随版本发布
3. 编写用户使用说明

---

## 6. 安全与隐私考虑

### 6.1 用户知情权
- 扩展面板清晰展示各 provider 的 cookie 检测与同步状态
- 自动同步在后台发生，用户可随时在面板查看
- 用户可在扩展中关闭自动同步

### 6.2 最小数据原则
- 扩展只读取/发送已授权域名的 Cookie
- 桌面端只存储插件需要的 Cookie
- 不发送浏览历史、页面内容等额外信息

### 6.3 本地闭环
- 所有数据在本机传输和存储，不上传任何服务器
- 扩展不需要网络权限（除了访问 127.0.0.1）
- 桌面端 HTTP 服务器不监听外部网络接口

---

## 7. 后续扩展方向

### 7.1 多浏览器支持
- 同样的扩展可移植到 Edge、Firefox（WebExtensions API 兼容）
- 桌面端 HTTP 服务器无需修改

### 7.2 反向同步（桌面端 → 浏览器）
- 桌面端将更新后的 Cookie 推送到扩展
- 扩展使用 `chrome.cookies.set` 写回浏览器
- 实现"在 FeedFlow 中更新 Cookie，浏览器自动登录"

### 7.3 凭证过期主动提醒
- 桌面端检测到 Cookie 失效（抓取失败）时，通知用户"请在浏览器中重新登录，Cookie 将自动同步"

---

## 8. 总结

本方案通过 **Chrome 扩展 + 本地 HTTP 服务器** 的组合，实现 Cookie 从浏览器到桌面端的**自动同步**：

- **自动化**：Cookie 变化即自动同步，用户只需在浏览器正常登录
- **状态可视**：扩展面板展示各 provider 的授权、cookie 检测、同步状态
- **动态可扩展**：插件声明 `cookieDomains` 即自动支持，扩展按需授权，无需更新版本
- **主动引导**：桌面端手动录入入口处根据扩展状态显示差异化文案
- **安全可控**：数据本地闭环，最小权限原则
- **用户可控**：自动同步可关闭，手动同步作为兜底

建议按阶段一→二→三→四→五顺序实施。
