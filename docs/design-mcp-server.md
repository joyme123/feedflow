# FeedFlow MCP Server 设计文档 (v2)

## 1. 背景与目标

### 1.1 背景
FeedFlow 是 Electron 桌面应用，聚合多源信息流（微博、X 等），数据存储在本地 SQLite。目前数据只能通过 UI 访问。

### 1.2 目标
设计一个 **嵌入 Electron 主进程** 的 MCP Server，为本机 AI agent 提供：

- 获取信息源列表
- 查询信息流条目（翻页、时间段、关键词搜索）
- **主动触发刷新**，通过插件 API 获取最新数据（防止用户只开软件不刷新）
- 获取单条详情（自动展开被截断的长文）

### 1.3 设计原则
- **嵌入主进程**：MCP server 作为 Electron 主进程的一部分运行，直接复用 DB 连接、插件系统、刷新逻辑
- **读写均可**：可触发刷新（写入 DB），但不提供修改/删除条目的工具
- **生命周期跟随 app**：app 启动时 MCP server 启动，app 退出时关闭
- **安全**：不暴露 credentials 表数据

---

## 2. 架构设计

### 2.1 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│  Agent (Claude Code / Cursor / ...)                          │
│                                                              │
│  通过 MCP 协议 (HTTP over localhost) 调用工具                 │
└───────────────────────┬──────────────────────────────────────┘
                        │ Streamable HTTP / SSE
                        ▼
┌──────────────────────────────────────────────────────────────┐
│  Electron 主进程                                              │
│                                                              │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────────────┐    │
│  │ MCP Server   │  │  Tool 层    │  │  查询层 (复用)    │    │
│  │ (HTTP 监听)  │→ │  (参数校验)  │→ │  queries/*.ts    │    │
│  └──────────────┘  └──────┬──────┘  └────────┬─────────┘    │
│                           │                  │              │
│                           ▼                  ▼              │
│                    ┌─────────────┐  ┌────────────────┐      │
│                    │ 刷新层      │  │  SQLite (读写)  │      │
│                    │ runner.ts   │  │  feedflow.db   │      │
│                    │ (调用插件)   │  └────────────────┘      │
│                    └──────┬──────┘                           │
│                           │                                  │
│                           ▼                                  │
│                    ┌─────────────┐                           │
│                    │ 插件系统    │                           │
│                    │ registry.ts │                           │
│                    └─────────────┘                           │
│                                                              │
│  同时存在: IPC handlers (与渲染进程通信)、窗口管理等          │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Transport 选择：为什么用 HTTP 而非 stdio

MCP 协议支持多种 transport。嵌入 Electron 主进程后，**stdio 不可用**（被 Electron 自身占用），因此选择 **HTTP transport**：

| Transport | 适用场景 | 本项目是否可行 |
|-----------|---------|--------------|
| stdio | 独立子进程 | ❌ Electron 主进程 stdio 被占用 |
| **Streamable HTTP** | 长驻 HTTP 服务 | ✅ **推荐**，监听 localhost 端口 |
| SSE | 旧版 HTTP 传输 | ✅ 可行，作为备选 |

**HTTP transport 配置示例（agent 端）：**
```json
{
  "mcpServers": {
    "feedflow": {
      "url": "http://localhost:33939/mcp"
    }
  }
}
```

> **端口选择**：默认 `33939`，可通过环境变量 `FEEDFLOW_MCP_PORT` 或设置项配置。仅监听 `127.0.0.1`，不暴露到网络。

### 2.3 启动时机

在 `src/main/index.ts` 的 `app.whenReady()` 中，插件加载完成后启动 MCP server：

```typescript
// app.whenReady().then(async () => {
//   initializeDatabase()
//   await loadPlugins()
//   registerIpcHandlers()
//   startMcpServer()  // ← 新增：启动 MCP server
//   createWindow()
// })
```

### 2.4 与现有系统的关系

| 现有模块 | MCP server 如何使用 |
|---------|-------------------|
| `database/connection.ts` | 直接复用 `getDb()`，同一连接 |
| `database/queries/*.ts` | 直接 import 复用所有查询函数 |
| `plugin-system/registry.ts` | 直接 import `get()` 获取插件实例 |
| `plugin-system/runner.ts` | 复用 `refreshSources()`，需小幅改造（见 §4.3） |
| `ipc/handlers.ts` | 部分逻辑可复用（如 `enrichItems`） |

---

## 3. MCP 工具定义

### 3.1 工具列表

| 工具名 | 说明 |
|--------|------|
| `list_sources` | 获取所有已配置的信息源。用于了解有哪些信息流可供查询。 |
| `list_items` | 分页查询信息流条目。支持按信息源筛选、按时间范围筛选、翻页加载更多。 |
| `search_items` | 在信息流条目中搜索关键词。返回正文匹配的条目列表。 |
| `get_item` | 根据条目 ID 获取单条条目的完整内容。若原文被截断（如长微博），自动返回完整正文。 |
| `refresh_source` | 主动刷新信息源，从信息平台拉取最新条目。刷新后新条目立即可被查询。 |

---

### 3.2 工具详细定义

---

#### 3.2.1 `list_sources`

**工具描述：** 获取所有已配置的信息源列表，包括每个源的名称、类型、已存储的条目数量等。在查询条目之前，通常需要先调用此工具获取可用的信息源 ID。

**输入参数：**

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `enabled` | boolean | 否 | 无（返回全部） | 按启用状态过滤。`true` 只返回启用的源，`false` 只返回禁用的源。 |

**输出结构：**

```typescript
{
  sources: Array<{
    id: string            // 信息源唯一标识，用于 list_items / refresh_source 等工具的 sourceIds 参数
    name: string          // 信息源显示名称，如 "微博关注流"
    feedType: 'timeline' | 'group-chat'  // 信息流类型：时间线 或 群聊
    enabled: boolean      // 是否启用
    itemCount: number     // 该源已存储的条目总数
    lastFetchedAt: string | null  // 最近一次刷新时间 (ISO 8601)，null 表示从未刷新
    createdAt: string     // 信息源创建时间 (ISO 8601)
  }>
}
```

**使用示例：**
- 首次使用时调用 `list_sources` 获取所有源的 ID
- 然后用源 ID 调用 `list_items` 查询具体内容

---

#### 3.2.2 `list_items`

**工具描述：** 分页查询信息流条目，按发布时间倒序排列（最新在前）。支持按信息源筛选、按时间范围筛选，以及通过游标翻页加载更多历史条目。这是最常用的查询工具。

**输入参数：**

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `sourceIds` | string[] | 否 | 无（查询全部时间线） | 要查询的信息源 ID 列表。不传则查询所有 `timeline` 类型源的聚合流（`group-chat` 类型不包含在聚合流中）。 |
| `limit` | number | 否 | 20 | 每页返回的条目数。取值范围 1–100，超过 100 按 100 处理。 |
| `cursor` | string | 否 | 无（从最新开始） | 翻页游标。值为上一次调用返回的 `nextCursor`。传入后返回发布时间早于该游标的条目。 |
| `since` | string | 否 | 无 | 起始时间 (ISO 8601)，如 `"2026-07-01T00:00:00Z"`。只返回发布时间 >= 此时间的条目。 |
| `until` | string | 否 | 无 | 截止时间 (ISO 8601)。只返回发布时间 <= 此时间的条目。 |

**输出结构：**

```typescript
{
  items: Array<{
    id: string           // 条目唯一标识，用于 get_item 工具
    sourceId: string     // 所属信息源 ID
    sourceName: string   // 所属信息源名称
    authorName: string   // 作者名称
    contentText: string  // 条目正文（纯文本，可能被截断）
    permalink: string    // 原文链接
    publishedAt: string  // 发布时间 (ISO 8601)
    mediaUrls: string[]  // 媒体（图片/视频）URL 列表
  }>
  hasMore: boolean       // 是否还有更多历史条目可加载
  nextCursor: string | null  // 下一页游标。当 hasMore 为 true 时，将此值作为下次调用的 cursor 参数
}
```

**翻页说明：**
- 首次调用不传 `cursor`，返回最新的 `limit` 条
- 若 `hasMore` 为 `true`，用 `nextCursor` 作为 `cursor` 再次调用，获取更早的条目
- `cursor` 与 `since`/`until` 可同时使用，三者取交集

**注意事项：**
- `list_items` 返回的 `contentText` 可能是截断的摘要。如需完整正文，请用 `get_item` 获取单条详情
- 条目按 `publishedAt` 倒序排列

---

#### 3.2.3 `search_items`

**工具描述：** 在信息流条目的正文中搜索关键词，返回匹配的条目列表。支持按信息源和时间范围筛选。

**输入参数：**

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `query` | string | 是 | — | 搜索关键词。在条目正文中进行模糊匹配（包含即命中）。 |
| `sourceIds` | string[] | 否 | 无（搜索全部） | 限定搜索范围为指定信息源。 |
| `limit` | number | 否 | 20 | 返回的最大条目数。取值范围 1–100。 |
| `since` | string | 否 | 无 | 起始时间 (ISO 8601)，只搜索此时间之后发布的条目。 |
| `until` | string | 否 | 无 | 截止时间 (ISO 8601)，只搜索此时间之前发布的条目。 |

**输出结构：** 同 `list_items`。

**注意事项：**
- 搜索仅匹配正文文本，不匹配作者名
- 结果按发布时间倒序排列
- 若 `query` 为空字符串，返回空结果

---

#### 3.2.4 `get_item`

**工具描述：** 根据条目 ID 获取单条条目的完整信息，包括正文、作者、媒体链接、元数据等。如果条目正文被截断（例如长微博只显示了前半部分），此工具会自动获取并返回完整正文。

**输入参数：**

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `id` | string | 是 | — | 条目唯一标识，来自 `list_items` 或 `search_items` 返回的 `id` 字段。 |

**输出结构：**

```typescript
{
  item: {
    id: string
    sourceId: string
    sourceName: string
    authorName: string
    authorAvatar: string     // 作者头像 URL
    contentText: string      // 完整正文（已自动展开截断内容）
    contentHtml: string      // 正文 HTML 版本（可能为空字符串）
    mediaUrls: string[]      // 媒体 URL 列表
    permalink: string        // 原文链接
    publishedAt: string      // 发布时间 (ISO 8601)
    fetchedAt: string        // 抓取时间 (ISO 8601)
    metadata: object         // 附加元数据（结构因信息源而异）
  }
  expanded: boolean          // 正文是否因截断而被补全。true = 原本截断，已获取完整内容
}
```

**注意事项：**
- 若条目不存在，返回错误
- 若正文原本就是完整的，`expanded` 为 `false`，`contentText` 即为原文
- 若正文被截断但无法获取完整内容（如信息源不支持），`expanded` 为 `false`，返回现有内容

---

#### 3.2.5 `refresh_source`

**工具描述：** 主动刷新指定的信息源，从对应的信息平台（如微博、X）拉取最新条目并存储。刷新完成后，新条目立即可通过 `list_items` / `search_items` 查询到。适用于需要获取实时最新内容的场景。

**输入参数：**

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `sourceIds` | string[] | 否 | 无（刷新所有启用源） | 要刷新的信息源 ID 列表。不传则刷新所有启用的信息源。 |
| `timeout` | number | 否 | 30 | 单个源刷新的超时时间（秒）。超过此时间未完成则该源标记为失败。取值范围 5–120。 |

**输出结构：**

```typescript
{
  refreshed: Array<{
    sourceId: string
    sourceName: string
    status: 'success' | 'error'   // 刷新结果
    itemsFetched: number           // 本次新抓取的条目数
    error?: string                 // 失败时的错误信息（status 为 error 时存在）
  }>
  totalFetched: number             // 所有源新抓取的条目总数
  newItems: Array<{                // 本次新抓取的条目（结构同 list_items 的 items）
    id: string
    sourceId: string
    sourceName: string
    authorName: string
    contentText: string
    permalink: string
    publishedAt: string
    mediaUrls: string[]
  }>
}
```

**注意事项：**
- 刷新需要联网，耗时取决于信息平台响应速度和网络状况
- 若某个源正在被其他操作刷新（如用户在界面上手动刷新），该源会被跳过
- 刷新失败不影响其他源，每个源独立返回状态
- 建议在需要最新内容时才调用，避免频繁刷新

---

## 4. 关键实现细节

### 4.1 MCP Server 启动

```typescript
// src/main/mcp-server/index.ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { listSourcesTool } from './tools/sources'
import { listItemsTool, searchItemsTool, getItemTool } from './tools/items'
import { refreshSourceTool } from './tools/refresh'

export function startMcpServer(): void {
  const port = Number(process.env.FEEDFLOW_MCP_PORT || 33939)
  const server = new Server(
    { name: 'feedflow', version: '0.1.0' },
    { capabilities: { tools: {} } }
  )

  // 注册工具
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [listSourcesTool, listItemsTool, searchItemsTool, getItemTool, refreshSourceTool]
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // 路由到对应工具处理函数
  })

  // 启动 HTTP transport
  const transport = new StreamableHTTPServerTransport({
    port,
    host: '127.0.0.1',
    path: '/mcp'
  })
  server.connect(transport)

  console.log(`[MCP] Server listening on http://127.0.0.1:${port}/mcp`)
}
```

### 4.2 工具处理函数示例

```typescript
// src/main/mcp-server/tools/items.ts
import { listItems } from '../../database/queries/items'
import { listSources } from '../../database/queries/sources'

export async function handleListItems(args: Record<string, unknown>) {
  const params = {
    sourceIds: args.sourceIds as string[] | undefined,
    limit: Math.min(Number(args.limit ?? 20), 100),
    cursor: args.cursor as string | undefined,
  }
  const result = listItems(params)
  // 附加 sourceName 等展示字段
  const sources = new Map(listSources().map(s => [s.id, s]))
  const items = result.items.map(item => ({
    ...item,
    sourceName: sources.get(item.sourceId)?.name ?? '未知源',
  }))
  return { items, hasMore: result.hasMore, nextCursor: result.nextCursor }
}
```

### 4.3 刷新逻辑改造

现有 `refreshSources()` 直接依赖 `BrowserWindow` 发进度事件。MCP 触发刷新时：
- 如果窗口存在，进度事件正常发送到 UI（UI 会显示刷新状态，这是好事）
- 如果窗口不存在，`win?.` 可选链安全跳过

**需要改造的点：并发锁**

UI 刷新（IPC `timeline:refresh`）和 MCP 刷新（`refresh_source` 工具）可能同时触发同一源。需加锁：

```typescript
// src/main/plugin-system/refresh-lock.ts
const refreshingSources = new Set<string>()

export function isRefreshing(sourceId: string): boolean {
  return refreshingSources.has(sourceId)
}

export function acquireRefreshLock(sourceIds: string[]): string[] {
  // 返回成功获取锁的源 ID 列表（已在刷新中的源会被跳过）
  const acquired: string[] = []
  for (const id of sourceIds) {
    if (!refreshingSources.has(id)) {
      refreshingSources.add(id)
      acquired.push(id)
    }
  }
  return acquired
}

export function releaseRefreshLock(sourceIds: string[]): void {
  for (const id of sourceIds) {
    refreshingSources.delete(id)
  }
}
```

然后在 `refreshSources()` 开头和结尾加锁/解锁。

### 4.4 时间段查询扩展

现有 `listItems()` 只支持 cursor 翻页，不支持 since/until。需要扩展查询函数或新建：

```typescript
// 在 queries/items.ts 中新增，或在 mcp-server 层封装
export function listItemsWithTimeRange(params: {
  sourceIds?: string[]
  limit?: number
  cursor?: string
  since?: string
  until?: string
}) {
  // 构建 WHERE 子句：published_at < cursor AND published_at >= since AND published_at <= until
  // 复用现有查询结构，增加时间范围条件
}
```

### 4.5 `get_item` 自动展开实现

`get_item` 工具需要自动检测并展开被截断的正文，实现逻辑：

1. 从 DB 取 item，解析 `metadata` JSON
2. 判断是否被截断：检查 `metadata.isTruncated === true`（插件在 `fetchItems` 时标记）
3. 若被截断：
   - 通过 `sourceId` 找到 source，解析 `config`（含凭证解析，复用 `resolveCredentialFields`）
   - 通过 `pluginId` 从 registry 获取插件实例
   - 若插件实现了 `fetchItemDetail`，调用 `plugin.fetchItemDetail(config, item.externalId)`
   - 将返回的完整内容更新到 DB（`content_text` / `content_html` / `metadata`）
4. 返回最终 item，`expanded` 字段标记是否成功补全

**容错：** 插件未实现 `fetchItemDetail`、调用失败、或内容未截断时，`expanded` 为 `false`，返回 DB 现有内容，不向 agent 报错。

**复用现有代码：** 核心逻辑与 `ipc/handlers.ts` 中的 `timeline:get-item-detail` handler 一致，可提取为共享函数。

---

## 5. 项目结构

```
src/main/
├── mcp-server/
│   ├── index.ts              # MCP server 启动入口
│   ├── tools/
│   │   ├── sources.ts        # list_sources
│   │   ├── items.ts          # list_items, search_items, get_item (含自动展开)
│   │   └── refresh.ts        # refresh_source
│   └── types.ts              # 工具输入输出类型
├── plugin-system/
│   ├── runner.ts             # 改造：加刷新锁
│   └── refresh-lock.ts       # 新增：刷新并发锁
└── index.ts                  # 改造：app.whenReady 中调用 startMcpServer()
```

---

## 6. 安全考虑

### 6.1 网络安全
- HTTP transport **仅监听 `127.0.0.1`**，不接受外部连接
- 可选：增加简单的 token 认证（通过设置项配置，agent 请求时携带）

### 6.2 数据安全
- 绝不返回 `credentials` 表的任何数据
- `refresh_source` 只调用插件 `fetchItems`，不暴露插件内部的 cookie/token
- 不提供修改/删除条目的工具

### 6.3 资源限制
- `list_items` / `search_items` 的 `limit` 上限 100，防止 agent 一次拉取过多
- `refresh_source` 有超时（默认 30s），防止插件卡死

---

## 7. 构建与配置

### 7.1 依赖安装
```bash
npm install @modelcontextprotocol/sdk
```

### 7.2 构建
MCP server 代码在 `src/main/mcp-server/` 下，随主进程一起构建（electron-vite 的 main 目标已覆盖 `src/main`），无需额外构建配置。

### 7.3 运行时配置
| 配置项 | 环境变量 | 默认值 | 说明 |
|--------|---------|--------|------|
| 端口 | `FEEDFLOW_MCP_PORT` | `33939` | HTTP 监听端口 |
| 启用 | `FEEDFLOW_MCP_ENABLED` | `true` | 是否启动 MCP server |
| 认证 Token | `FEEDFLOW_MCP_TOKEN` | 无 | 可选，请求需携带 |

也可通过 DB 的 `settings` 表持久化配置，允许用户在 UI 中开关 MCP server。

---

## 8. 实现计划

### Phase 1: 基础框架 (1 天)
- [ ] 安装 `@modelcontextprotocol/sdk`
- [ ] 创建 `src/main/mcp-server/` 结构
- [ ] 实现 `startMcpServer()`，HTTP transport 监听 localhost
- [ ] 实现 `list_sources` 工具

### Phase 2: 查询工具 (1-2 天)
- [ ] 实现 `list_items`（扩展 since/until 时间段查询）
- [ ] 实现 `search_items`
- [ ] 实现 `get_item`（含自动展开截断内容逻辑）

### Phase 3: 刷新能力 (1 天)
- [ ] 实现 `refresh_source` 工具
- [ ] 改造 `runner.ts`，加刷新锁
- [ ] 测试 MCP 刷新与 UI 刷新的并发

### Phase 4: 安全与优化 (1 天)
- [ ] 可选 token 认证
- [ ] 资源限制（limit 上限、超时）
- [ ] 日志与错误处理
- [ ] 编写使用文档

---

## 9. 后续扩展

1. **后台运行**：app 最小化到托盘时 MCP server 继续运行，agent 可随时查询
2. **实时通知**：MCP notifications，新内容到达时主动通知 agent
3. **FTS5 全文搜索**：为 `content_text` 建 FTS5 虚拟表，提升搜索性能
4. **UI 集成**：在设置页提供 MCP server 开关、端口配置、token 生成
5. **统计工具**：提供条目数趋势、源活跃度等聚合查询
