# V2EX 信息流 Plugin 技术方案

> 调研日期: 2026-08-03 | 作者: FeedFlow
> 更新日期: 2026-08-03

---

## 0. 方案选择：公开 API vs API 2.0（需 Token）

| | 公开 API (v2ex.com/api/*.json) | API 2.0 Beta (edge.v2ex.com) |
|---|---|---|
| **费用** | ✅ 完全免费 | ✅ 免费 |
| **注册** | ❌ 无需注册 | 需注册账号、创建 Personal Access Token |
| **认证** | ❌ 无需认证 | Bearer Token |
| **最新主题** | ✅ `/api/topics/latest.json` | ❌ 无对应端点 |
| **热门主题** | ✅ `/api/topics/hot.json` | ❌ 无对应端点 |
| **按节点订阅** | ❌ 仅返回节点元数据，无主题列表 | ✅ `nodes/:node_name/topics`（支持分页） |
| **主题详情** | ✅ `/api/topics/show.json?id=xxx` | ✅ `topics/:topic_id` |
| **主题回复** | ❌ 无公开端点 | ✅ `topics/:topic_id/replies` |
| **分页能力** | ❌ latest/hot 不支持分页参数 | ✅ `p` 参数分页 |
| **限流** | 未明确公开（较宽松） | 每 IP 每小时 600 次 |
| **稳定性** | 高（长期稳定，社区广泛使用） | 中（Beta，可能变更） |

**结论**: 优先采用**公开 API**（符合用户要求），实现最新主题和热门主题订阅。
- 公开 API 无需注册、无需 Token、无需 Cookie，零配置即可使用
- 按节点订阅作为可选增强：通过 API 2.0 实现，用户可选填入 Personal Access Token
- 主题正文在公开 API 中已完整返回（`content` + `content_rendered`），无需 `fetchItemDetail` 展开

---

## 1. 背景与目标

为 FeedFlow 新增 **V2EX 信息流**作为信息源，让用户能在 FeedFlow 中浏览 V2EX 的最新主题和热门主题。

### 目标
- 优先使用 V2EX 公开 API（`/api/topics/latest.json`、`/api/topics/hot.json`），无需认证
- 插件化实现，不侵入主程序代码
- 支持"最新主题"和"热门主题"两种信息流
- 可选支持"按节点订阅"（通过 API 2.0，需用户提供 Personal Access Token）
- 支持增量刷新（sinceId 去重），与 FeedFlow 的刷新机制配合
- 数据映射对齐现有插件：作者、正文、链接、时间、元数据（节点、回复数）

### 非目标
- 不实现 V2EX 账号登录、发帖、回复等交互功能
- 不实现通知/提醒功能
- 首版不实现"加载更多"翻页（公开 API 无分页能力）

---

## 2. V2EX API 调研

### 2.1 公开 API 概况

V2EX 提供一组无需认证的公开 JSON API，社区广泛使用。

| 项目 | 说明 |
|------|------|
| 平台 | [V2EX](https://www.v2ex.com/) |
| 认证 | 无需认证 |
| API 类型 | REST (GET) |
| 响应格式 | JSON |
| 基础 URL | `https://www.v2ex.com/api/` |

### 2.2 核心接口

#### 2.2.1 最新主题: latest.json

```
GET https://www.v2ex.com/api/topics/latest.json
```

返回全站最新发布的主题列表（约 20 条），按发布时间倒序。无分页参数。

#### 2.2.2 热门主题: hot.json

```
GET https://www.v2ex.com/api/topics/hot.json
```

返回当前最热的主题列表（约 20 条），按热度排序。无分页参数。

#### 2.2.3 主题详情: show.json（备用）

```
GET https://www.v2ex.com/api/topics/show.json?id={topic_id}
```

返回单个主题的完整信息。公开 API 已返回完整正文，此接口作为 `fetchItemDetail` 的备用实现。

#### 2.2.4 节点信息: nodes/show.json

```
GET https://www.v2ex.com/api/nodes/show.json?name={node_name}
```

返回节点元数据（名称、标题、头像、描述），**不返回该节点下的主题列表**。

### 2.3 API 2.0 Beta（可选，用于按节点订阅）

| 项目 | 说明 |
|------|------|
| 基础 URL | `https://edge.v2ex.com/api/v2/` |
| 认证 | `Authorization: Bearer {token}` |
| 限流 | 每 IP 每小时 600 次（返回 `X-Rate-Limit-*` 头） |

**节点主题列表**:
```
GET https://edge.v2ex.com/api/v2/nodes/{node_name}/topics?p={page}
```
返回指定节点下的主题，支持 `p` 参数分页（默认 1）。需 Personal Access Token。

### 2.4 主题数据结构

公开 API 返回的主题对象字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | number | 主题 ID |
| `title` | string | 主题标题 |
| `content` | string | 原始 Markdown 正文 |
| `content_rendered` | string | 渲染后的 HTML 正文 |
| `url` | string | 主题链接 `https://www.v2ex.com/t/{id}` |
| `created` | number | 创建时间（Unix 秒级时间戳） |
| `last_modified` | number | 最后修改时间（Unix 时间戳） |
| `last_touched` | number | 最后活动时间（Unix 时间戳） |
| `replies` | number | 回复数 |
| `deleted` | number | 是否已删除（0/1） |
| `node` | object | 节点信息 |
| `node.name` | string | 节点英文名（如 `rust`、`life`） |
| `node.title` | string | 节点显示名（如 `Rust`、`生活`） |
| `node.url` | string | 节点链接 |
| `node.avatar_large` | string | 节点头像 URL |
| `member` | object | 发帖人信息 |
| `member.username` | string | 用户名 |
| `member.url` | string | 用户主页链接 |
| `member.avatar_normal` | string | 用户头像 URL |
| `member.avatar_large` | string | 用户大头像 URL |

---

## 3. 插件架构设计

### 3.1 文件结构

```
plugins/v2ex/
├── package.json          # 插件元信息 + feedflow 字段
├── plugin.js             # 插件主入口（fetchItems 逻辑 + 数据映射）
└── v2ex-api.js           # V2EX API 封装（公开 API + 可选 API 2.0）
```

### 3.2 package.json

```json
{
  "name": "feedflow-plugin-v2ex",
  "version": "1.0.0",
  "description": "获取 V2EX 最新主题和热门主题（基于 V2EX 公开 API，无需认证）",
  "main": "plugin.js",
  "feedflow": {
    "id": "feedflow-plugin-v2ex",
    "name": "V2EX",
    "version": "1.0.0",
    "description": "获取 V2EX 最新主题和热门主题（基于 V2EX 公开 API，无需认证）",
    "author": "FeedFlow",
    "color": "#333333",
    "icon": "💬",
    "provider": "v2ex",
    "providerName": "V2EX"
  }
}
```

### 3.3 依赖

插件运行在 Electron main 进程（Node.js），使用 Node 内置模块，**无需额外 npm 依赖**:

| 用途 | 实现方式 |
|------|----------|
| HTTP 请求 | Node.js 内置 `https` 模块（或 `fetch`，Node 18+ 内置） |
| 认证 | 无需认证（公开 API）；可选 Bearer Token（API 2.0） |
| HTML 清理 | 内置工具函数 |

---

## 4. 认证方案

### 4.1 主方案：无需认证（公开 API）

V2EX 公开 API（`latest.json`、`hot.json`）无需任何认证即可访问。
用户添加 V2EX 信息源时，**无需填写 Cookie 或 Token**，选择信息流类型即可使用。

### 4.2 可选：Personal Access Token（按节点订阅）

如果用户选择"按节点订阅"模式，需要调用 API 2.0，此时需要 Personal Access Token：

1. 用户登录 V2EX → 设置 → 个人访问令牌 → 创建令牌
2. 将 Token 填入信息源配置
3. 插件在请求 `nodes/:node_name/topics` 时携带 `Authorization: Bearer {token}` 头

Token 以 `credential` 类型字段存储，可在多个 V2EX 信息源间复用。

---

## 5. 数据映射

### 5.1 V2EX Topic → FeedFlow TimelineItem

```js
function mapTopicToItem(topic) {
  const member = topic.member || {}
  const node = topic.node || {}

  return {
    externalId: String(topic.id),
    author: {
      name: member.username || 'unknown',
      avatarUrl: member.avatar_large || member.avatar_normal || '',
      profileUrl: member.url || `https://www.v2ex.com/u/${member.username}`
    },
    content: {
      text: topic.title + '\n\n' + (topic.content || ''),
      html: `<h2>${escapeHtml(topic.title)}</h2>\n` + (topic.content_rendered || '')
    },
    mediaUrls: extractMediaUrls(topic.content_rendered),
    permalink: topic.url || `https://www.v2ex.com/t/${topic.id}`,
    publishedAt: new Date(topic.created * 1000).toISOString(),
    metadata: {
      nodeName: node.name || '',
      nodeTitle: node.title || '',
      nodeUrl: node.url || '',
      repliesCount: topic.replies || 0,
      lastReplyBy: topic.last_reply_by || '',
      lastTouched: topic.last_touched
        ? new Date(topic.last_touched * 1000).toISOString()
        : null
    }
  }
}
```

### 5.2 正文处理

V2EX 主题的 `content` 是 Markdown 原文，`content_rendered` 是渲染后的 HTML。
- `content.text`：标题 + Markdown 正文（纯文本，用于搜索和摘要）
- `content.html`：标题（`<h2>`）+ 渲染后的 HTML（用于富文本展示）

### 5.3 媒体 URL 提取

V2EX 主题中的图片嵌入在 `content_rendered` 的 HTML 中（`<img>` 标签），
没有独立的媒体字段。从 HTML 中提取所有 `<img src="...">` 的 URL 放入 `mediaUrls`，
供 FeedFlow 的图片预览功能使用。

```js
function extractMediaUrls(html) {
  if (!html) return []
  const urls = []
  const regex = /<img[^>]+src=["']([^"']+)["']/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    urls.push(match[1])
  }
  return urls
}
```

### 5.4 时间解析

V2EX 返回 Unix 秒级时间戳（`created` 字段），转为 ISO 8601：
```js
new Date(topic.created * 1000).toISOString()
```

---

## 6. 配置 Schema

```js
const configSchema = [
  {
    key: 'feedType',
    label: '信息流类型',
    type: 'select',
    default: 'latest',
    required: true,
    options: [
      { label: '最新主题', value: 'latest' },
      { label: '热门主题', value: 'hot' },
      { label: '按节点订阅（需 Token）', value: 'node' }
    ],
    helpText: '选择获取 V2EX 的最新主题、热门主题，或订阅特定节点的主题。'
  },
  {
    key: 'nodeName',
    label: '节点名称',
    type: 'text',
    required: false,
    placeholder: '如：rust、life、apple',
    helpText: '当信息流类型为"按节点订阅"时必填。输入节点的英文名称（URL 中 /go/ 后面的部分）。',
    visibleWhen: { feedType: 'node' }
  },
  {
    key: 'token',
    label: 'V2EX Personal Access Token',
    type: 'credential',
    required: false,
    helpText: '仅"按节点订阅"模式需要。在 V2EX 设置 → 个人访问令牌中创建。可在多个 V2EX 信息源间复用。',
    visibleWhen: { feedType: 'node' }
  },
  {
    key: 'count',
    label: '每次获取条数',
    type: 'number',
    default: 20,
    min: 1,
    max: 50,
    helpText: '单次刷新获取的主题数量。公开 API 通常返回约 20 条，此参数对 latest/hot 模式无效（API 不支持分页），仅对按节点订阅模式有效。'
  }
]
```

> **注意**: `visibleWhen` 为条件显示逻辑，需确认 FeedFlow 配置表单是否支持条件字段显示。
> 如不支持，则 `nodeName` 和 `token` 字段始终显示，在 `fetchItems` 中按 `feedType` 判断是否使用。

---

## 7. 分页策略

### 7.1 公开 API 模式（latest / hot）

V2EX 公开 API **不支持分页参数**，每次调用返回固定数量的最新主题。

**增量刷新**:
- 刷新时 `cursor = undefined`，直接调用 API 获取最新列表
- FeedFlow 主程序通过 `externalId`（`topic.id`）在 `items` 表中 upsert，天然去重
- 返回 `nextCursor` 记录本次获取到的最旧主题 ID，供"加载更多"使用

**加载更多（load older）**:
- 公开 API 无翻页能力，`nextCursor` 始终返回 `null`
- UI 上"加载更多"按钮对 V2EX 信息源不显示或提示"暂不支持"

### 7.2 按节点订阅模式（API 2.0）

API 2.0 支持 `p` 参数分页：

```
cursor = JSON.stringify({ page: 2 })
```

- 首次刷新: `cursor = undefined` → `p=1`
- 加载更多: `cursor = {"page":2}` → `p=2`，以此类推
- 返回 `nextCursor = {"page": currentPage + 1}`

### 7.3 Cursor 格式

```js
// 公开 API 模式: 无实际分页，返回 null
return { items, nextCursor: null }

// 按节点订阅模式: 页码分页
const nextCursor = JSON.stringify({ page: currentPage + 1 })
return { items, nextCursor }
```

---

## 8. 错误处理

| 错误场景 | 含义 | 处理策略 |
|----------|------|----------|
| 网络错误 | DNS/超时/连接失败 | 抛出错误信息，下次刷新重试 |
| 非 200 状态码 | API 返回错误 | 检查状态码，429 提示限流，其他提示稍后重试 |
| 空响应 | API 返回空数组 | 正常返回空列表，不报错 |
| JSON 解析失败 | 响应格式异常 | 抛出错误，记录原始响应用于调试 |
| 401（API 2.0） | Token 无效/过期 | 提示用户检查 Token 或重新创建 |
| 403（API 2.0） | Token 无权限 | 提示用户检查 Token 权限 |
| 429（API 2.0） | 频率超限 | 提示用户稍后重试，建议降低刷新频率 |
| 节点不存在 | nodeName 错误 | 提示用户检查节点名称是否正确 |

---

## 9. fetchItemDetail（可选）

公开 API 已返回完整正文（`content` + `content_rendered`），**首版不需要 `fetchItemDetail`**。

如后续需要（例如 API 返回截断内容），可实现为：
```js
async function fetchItemDetail(config, externalId) {
  const topic = await fetchTopicById(externalId)
  return {
    content: {
      text: topic.content,
      html: topic.content_rendered
    }
  }
}
```
调用 `https://www.v2ex.com/api/topics/show.json?id={externalId}` 获取完整正文。

---

## 10. 与现有插件的能力对齐

| 能力 | 微博插件 | X 插件 | V2EX 插件 |
|------|---------|--------|-----------|
| 认证方式 | Cookie | Cookie + Bearer Token | 无需认证（公开 API）/ 可选 Token |
| 信息流获取 | ✅ 关注流 | ✅ 关注流/推荐流 | ✅ 最新/热门/节点 |
| 凭据验证 | ✅ verifyCookie | ✅ verifyCookie | ❌ 无需验证（公开 API） |
| 数据映射 | ✅ 含转发处理 | ✅ 含转发+引用处理 | ✅ 含节点信息 |
| 图片提取 | ✅ pic_ids / pic_urls | ✅ entities.media | ✅ 从 HTML 中提取 img |
| 游标分页 | ✅ since_id (JSON) | ✅ GraphQL cursor | ⚠️ 仅节点模式支持页码分页 |
| 配置项 | cookie, count | cookie, feedType, count | feedType, nodeName?, token?, count |
| 长文展开 | ✅ fetchItemDetail | ✅ fetchItemDetail | ❌ 不需要（正文已完整） |
| 错误处理 | ✅ | ✅ | ✅ |
| 生命周期 | onRegister | onRegister | onRegister |

---

## 11. 风险与注意事项

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| 公开 API 无分页 | 无法"加载更多"历史主题 | 首版接受此限制；节点模式用 API 2.0 分页 |
| 公开 API 限流未公开 | 高频刷新可能被限流 | 遵循 FeedFlow 默认刷新间隔，建议 ≥10 分钟 |
| API 2.0 处于 Beta | 接口可能变更 | 数据映射层隔离，集中在 v2ex-api.js |
| 节点名称输入错误 | 拉取失败 | 友好错误提示，引导用户检查节点名 |
| V2EX 图片防盗链 | 图片可能无法显示 | 测试图片加载情况，必要时通过主程序代理 |
| `content_rendered` 中的 HTML | 可能包含不安全标签 | 主程序渲染时做 XSS 过滤（FeedFlow 通用机制） |

---

## 12. 参考链接

- [V2EX 公开 API 文档](https://www.v2ex.com/p/7v9TEc53)
- [V2EX API 2.0 Beta 文档](https://edge.v2ex.com/help/api)
- [V2EX 最新主题 API](https://www.v2ex.com/api/topics/latest.json)
- [V2EX 热门主题 API](https://www.v2ex.com/api/topics/hot.json)
- [V2EX 个人访问令牌](https://www.v2ex.com/settings/tokens)
