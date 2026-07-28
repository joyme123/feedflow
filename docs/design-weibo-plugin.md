# 微博关注信息流 Plugin 技术方案

> 调研日期: 2026-07-27 | 作者: FeedFlow
> 更新日期: 2026-07-27 (新增免费方案)

---

## 0. 方案选择：官方 API vs 免费方案

| | 官方 API (open.weibo.com) | 免费方案 (weibo.com AJAX) |
|---|---|---|
| **费用** | 高级接口需付费/审核 | ✅ 完全免费 |
| **注册** | 需注册开发者、创建应用、审核 | ❌ 无需注册 |
| **认证** | OAuth 2.0 (App Key + Secret + Token) | Cookie (浏览器登录即可) |
| **Token 有效期** | 1天~90天，过期需重新授权 | Cookie 有效期通常数天~数周 |
| **数据完整度** | 高 (官方接口，字段完整) | 高 (weibo.com AJAX 返回完整 JSON) |
| **稳定性** | 高 (官方维护) | 高 (weibo.com 桌面版 AJAX 接口) |
| **频率限制** | 150~1500次/小时/用户 | 较宽松 (Cookie 方式) |
| **关注流接口** | `statuses/home_timeline` | `ajax/statuses/friends_timeline` (一次调用) |
| **法律风险** | 低 (官方授权) | 中 (需遵守 ToS，仅个人使用) |

**结论**: 实现了**两套方案**，默认使用免费方案 (weibo.com AJAX API)。
- 免费方案 (`plugin.js` v3.0): 基于 weibo.com AJAX API，用户提供 Cookie 即可
  - 核心接口: `GET https://weibo.com/ajax/statuses/friends_timeline` — 直接获取关注时间线
- 官方 API 方案 (`plugin.js` v1.0 设计): 基于 OAuth 2.0，需 App Key/Secret

---

## 1. 背景与目标

为 FeedFlow 新增**微博关注信息流**（Home Timeline）作为信息源，让用户能在 FeedFlow 中浏览微博关注列表的最新动态。

### 目标
- 通过微博开放平台官方 API 合法获取数据
- 插件化实现，不侵入主程序代码
- 支持 OAuth2.0 用户授权，每个用户使用自己的微博账号
- 支持分页游标，可与 FeedFlow 的刷新机制配合

---

## 2. 微博 API 调研

### 2.1 开放平台概况

| 项目 | 说明 |
|------|------|
| 平台 | [微博开放平台](https://open.weibo.com/) |
| 认证 | OAuth 2.0 (Authorization Code) |
| API 版本 | V2 (`https://api.weibo.com/2/`) |
| 响应格式 | JSON |
| 文档更新 | 2025-05-09 (持续维护) |

### 2.2 核心接口: `statuses/home_timeline`

```
GET https://api.weibo.com/2/statuses/home_timeline.json
```

**别名**: `statuses/friends_timeline`

获取当前授权用户及其所关注用户的最新微博。

**请求参数**:

| 参数 | 必选 | 类型 | 说明 |
|------|------|------|------|
| `access_token` | 是 | string | OAuth2 授权令牌 |
| `since_id` | 否 | int64 | 返回 ID 大于此值的微博（增量拉取） |
| `max_id` | 否 | int64 | 返回 ID 小于等于此值的微博（翻页） |
| `count` | 否 | int | 单页条数，最大 100，默认 20 |
| `page` | 否 | int | 页码，默认 1 |
| `feature` | 否 | int | 过滤: 0=全部, 1=原创, 2=图片, 3=视频, 4=音乐 |
| `trim_user` | 否 | int | 0=完整用户信息, 1=仅 user_id |

**响应结构**:

```json
{
  "statuses": [
    {
      "created_at": "Tue May 31 17:46:55 +0800 2011",
      "id": 11488058246,
      "mid": "5612814510546515491",
      "idstr": "11488058246",
      "text": "微博正文内容",
      "source": "<a href=\"http://weibo.com\">新浪微博</a>",
      "favorited": false,
      "truncated": false,
      "thumbnail_pic": "http://...",
      "bmiddle_pic": "http://...",
      "original_pic": "http://...",
      "pic_urls": [
        { "thumbnail_pic": "http://..." }
      ],
      "reposts_count": 8,
      "comments_count": 9,
      "attitudes_count": 0,
      "user": {
        "id": 1404376560,
        "screen_name": "zaku",
        "name": "zaku",
        "profile_image_url": "http://...",
        "avatar_large": "http://...",
        "verified": false,
        "description": "...",
        "followers_count": 1204,
        "friends_count": 447,
        "statuses_count": 2908
      },
      "retweeted_status": {
        /* 被转发原微博，结构同上，非转发时不返回 */
      }
    }
  ],
  "total_number": 81655,
  "previous_cursor": 0,
  "next_cursor": 11488013766
}
```

### 2.3 频率限制

| 授权级别 | 限制 |
|----------|------|
| 普通授权 (测试期 1 天) | 150 次/小时/用户 |
| 初级授权 (未审核 7 天) | 500 次/小时/用户 |
| 高级授权 (审核通过) | 1,500 次/小时/用户 |

建议轮询间隔 **2-3 分钟**，检查 `account/rate_limit_status` 接口获取剩余配额。

### 2.4 关键限制

- **Access Token 有效期**: 测试期 1 天 / 未审核 7 天 / 审核通过 90 天
- **无 Refresh Token**: 过期后需用户重新授权
- **只能拉取关注流**: 无法获取未关注用户的微博
- **图片 URL 无防盗链**: 可直接在 UI 中展示

---

## 2.5 免费方案：weibo.com AJAX API

> 此为当前实现的默认方案 (v3.0)。无需注册、无需 OAuth、完全免费。
> 相比 m.weibo.cn 移动端方案，weibo.com 的 AJAX 接口有直接的关注时间线端点，一次调用即可获取整个关注流。

### 2.5.1 原理

微博桌面版 `weibo.com` 提供了一套 AJAX JSON API（`/ajax/` 路径下）。
用户在浏览器登录 `weibo.com` 后，将 Cookie 复制到 FeedFlow 中即可使用。

### 2.5.2 核心接口

所有接口均为 `GET`，需在请求头中携带 `Cookie`：

| 用途 | URL | 说明 |
|------|-----|------|
| **关注时间线** | `https://weibo.com/ajax/statuses/friends_timeline?count=20&since_id=xxx` | **核心接口**，一次获取关注流 |
| 我的微博 | `https://weibo.com/ajax/statuses/mymblog?uid={uid}&page=1` | 用户自己发布的微博 |
| 关注列表 | `https://weibo.com/ajax/side/friends?uid={uid}&page=1` | 关注的用户列表 |
| 用户信息 | `https://weibo.com/ajax/profile/info` | 验证 Cookie 有效性 |
| 单条微博 | `https://weibo.com/ajax/statuses/show?id={id}` | 获取长微博全文 |

### 2.5.3 响应结构

`friends_timeline` 返回：
```json
{
  "ok": 1,
  "data": {
    "list": [
      {
        "id": 123,
        "idstr": "123",
        "mid": "abc123",
        "text": "微博内容 (可含 HTML 标签)",
        "created_at": "刚刚" | "x分钟前" | "今天 HH:MM" | "MM-DD" | 完整日期,
        "pic_ids": ["pic_id_1", "pic_id_2"],
        "user": { "id": 123, "screen_name": "用户名", "avatar_large": "https://..." },
        "reposts_count": 0,
        "comments_count": 0,
        "attitudes_count": 0,
        "source": "iPhone",
        "retweeted_status": { /* 转发的原微博，结构同上 */ }
      }
    ],
    "since_id": "最新微博 ID",
    "next_cursor": "下一页游标",
    "total_number": 100
  }
}
```

### 2.5.4 关注信息流获取策略

1. 用 Cookie 调用 `friends_timeline` 接口，传入 `count` 和 `since_id`
2. `since_id` 用于增量拉取（只返回比此 ID 更新的微博）
3. 将返回的 `list` 数组映射为 TimelineItem
4. 按时间降序排列
5. 返回 `nextCursor` = `{"sinceId": response.data.since_id}`

### 2.5.5 Cookie 获取方法

1. 浏览器登录 `https://weibo.com`
2. 按 `F12` 打开开发者工具 → `Network` 标签
3. 刷新页面，点击任意一个 `weibo.com` 请求
4. 在 `Request Headers` 中找到 `Cookie` 字段，复制完整值

### 2.5.6 时间格式处理

weibo.com AJAX API 返回的 `created_at` 可能是多种格式：
- `刚刚` → 当前时间
- `x分钟前` → 当前时间 - x 分钟
- `x小时前` → 当前时间 - x 小时
- `今天 HH:MM` → 今天的该时刻
- `昨天 HH:MM` → 昨天的该时刻
- `MM-DD` → 今年的该日期
- 完整日期 `Tue May 31 17:46:55 +0800 2011` → 直接解析

---

## 3. 插件架构设计

### 3.1 文件结构

```
plugins/weibo-home-timeline/
├── package.json          # 插件元信息 + feedflow 字段
├── plugin.js             # 插件主入口（FetchItems 逻辑）
├── auth.js               # OAuth2.0 授权逻辑
└── weibo-api.js          # 微博 API 封装
```

### 3.2 package.json

```json
{
  "name": "feedflow-plugin-weibo",
  "version": "1.0.0",
  "description": "微博关注信息流插件",
  "main": "plugin.js",
  "feedflow": {
    "id": "feedflow-plugin-weibo",
    "name": "微博关注流",
    "version": "1.0.0",
    "description": "获取微博首页关注信息流",
    "author": "FeedFlow",
    "color": "#E6162D",
    "icon": "🔴"
  }
}
```

### 3.3 插件入口 (`plugin.js`)

```js
const { buildAuthUrl, exchangeCodeForToken } = require('./auth')
const { fetchHomeTimeline, checkRateLimit } = require('./weibo-api')

const meta = { ... }
const configSchema = [ ... ] // 见第 6 节

async function fetchItems(config, cursor) {
  // 1. 解析 cursor（首次为 null）
  const cursorObj = cursor ? JSON.parse(cursor) : { sinceId: null, page: 1 }

  // 2. 调用微博 API
  const params = {
    access_token: config.accessToken,
    count: config.count ?? 20,
    feature: config.feature ?? 0,
  }
  if (cursorObj.sinceId) params.since_id = cursorObj.sinceId

  const response = await fetchHomeTimeline(params)

  // 3. 映射为 TimelineItem[]
  const items = response.statuses.map(mapStatusToItem)

  // 4. 构造 nextCursor
  const latestId = response.statuses[0]?.idstr
  const nextCursor = latestId
    ? JSON.stringify({ sinceId: latestId, page: cursorObj.page + 1 })
    : null

  return { items, nextCursor }
}

const weiboPlugin = { meta, configSchema, fetchItems }
module.exports = { default: weiboPlugin }
```

### 3.4 依赖

插件运行在 Electron main 进程（Node.js），使用 Node 内置模块，**无需额外 npm 依赖**:

| 用途 | 实现方式 |
|------|----------|
| HTTP 请求 | Node.js 内置 `https` 模块 |
| OAuth 本地服务器 | Node.js 内置 `http` 模块 |
| 密钥存储 | 通过 `SourceConfig` 由主程序管理 |

---

## 4. OAuth 2.0 认证方案

### 4.1 流程设计

采用 **本地 HTTP 服务器 + 浏览器授权** 方案：

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   FeedFlow   │     │   Browser    │     │ Weibo OAuth  │
│  (Electron)  │     │              │     │   Server     │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                     │                     │
       │ 1. 启动本地服务器     │                     │
       │ (localhost:随机端口)  │                     │
       │                     │                     │
       │ 2. 打开浏览器         │                     │
       │────────────────────>│                     │
       │                     │ 3. GET /authorize   │
       │                     │────────────────────>│
       │                     │                     │
       │                     │ 4. 用户登录+授权     │
       │                     │<────────────────────│
       │                     │                     │
       │                     │ 5. 302 redirect_uri │
       │                     │    ?code=xxxxxxx    │
       │                     │                     │
       │ 6. 本地服务器收到 code │                     │
       │<────────────────────│                     │
       │                     │                     │
       │ 7. POST /access_token│                    │
       │──────────────────────────────────────────>│
       │                     │                     │
       │ 8. 返回 access_token │                     │
       │<──────────────────────────────────────────│
       │                     │                     │
       │ 9. 保存 token        │                     │
       │ 10. 关闭本地服务器    │                     │
```

### 4.2 auth.js 实现要点

```js
const http = require('http')
const https = require('https')
const { shell } = require('electron')

/**
 * 启动 OAuth 授权流程
 * @returns {Promise<{accessToken: string, uid: string}>}
 */
function startOAuth(appKey, appSecret, redirectUri) {
  return new Promise((resolve, reject) => {
    // 1. 启动本地 HTTP 服务器接收回调
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://localhost:${port}`)
      const code = url.searchParams.get('code')

      if (code) {
        res.end('<html><body><h1>授权成功！请返回 FeedFlow</h1></body></html>')
        server.close()

        // 2. 用 code 换取 access_token
        const tokenData = await exchangeCodeForToken(appKey, appSecret, code, redirectUri)
        resolve(tokenData)
      }
    })

    server.listen(0, () => {
      const port = server.address().port
      // 3. 构造授权 URL 并打开浏览器
      const authUrl = buildAuthUrl(appKey, `http://localhost:${port}/callback`)
      shell.openExternal(authUrl)
    })
  })
}
```

**备选方案（更简单）**: 使用微博官方默认回调页 `https://api.weibo.com/oauth2/default.html`，用户手动复制 code 粘贴到 FeedFlow 中。这种方式更稳定，不依赖本地网络环境。

**推荐**: 两种方案都支持 — 默认使用本地服务器自动回调，如果用户防火墙/代理环境复杂，可回退到手动词输入模式。

### 4.3 Access Token 管理

- 存储在 `SourceConfig` 的 `accessToken` 字段中
- FetchItems 前检查 token 是否过期（可先调一次 API，如果 21332 错误则提示用户）
- 过期后提示用户重新授权
- 可选: 在 `onRegister` 中验证 token 有效性

---

## 5. 数据映射

### 5.1 Weibo Status → FeedFlow TimelineItem

```js
function mapStatusToItem(status) {
  const user = status.user
  const mid = status.mid || status.idstr

  // 提取图片 URL: 用 bmiddle_pic 或从 thumbnail_pic 转换
  const mediaUrls = []
  if (status.pic_urls && status.pic_urls.length > 0) {
    for (const pic of status.pic_urls) {
      // thumbnail → large: 替换 /thumbnail/ → /large/
      mediaUrls.push(pic.thumbnail_pic.replace('/thumbnail/', '/large/'))
    }
  } else if (status.original_pic) {
    mediaUrls.push(status.original_pic)
  }

  // 处理转发: 拼接原文内容
  let text = status.text
  let html = null
  if (status.retweeted_status) {
    const rtUser = status.retweeted_status.user?.screen_name || 'unknown'
    text += `\n\n//@${rtUser}: ${status.retweeted_status.text}`
  }

  return {
    externalId: status.idstr,
    author: {
      name: user.screen_name,
      avatarUrl: user.avatar_large || user.profile_image_url,
      profileUrl: `https://weibo.com/u/${user.id}`
    },
    content: {
      text: stripHtml(text),
      html: text  // 微博 text 本身就是简单的 HTML
    },
    mediaUrls,
    permalink: `https://weibo.com/${user.id}/${mid}`,
    publishedAt: parseWeiboDate(status.created_at),
    metadata: {
      repostsCount: status.reposts_count,
      commentsCount: status.comments_count,
      attitudesCount: status.attitudes_count,
      source: stripHtml(status.source || ''),
      isRetweet: !!status.retweeted_status,
      retweetedStatus: status.retweeted_status ? {
        externalId: status.retweeted_status.idstr,
        text: status.retweeted_status.text,
        userName: status.retweeted_status.user?.screen_name
      } : null
    }
  }
}
```

### 5.2 时间解析

微博返回的时间格式为: `"Tue May 31 17:46:55 +0800 2011"`

```js
function parseWeiboDate(dateStr) {
  // Weibo date format: "Tue May 31 17:46:55 +0800 2011"
  const d = new Date(dateStr)
  return d.toISOString()  // → "2011-05-31T09:46:55.000Z"
}
```

### 5.3 HTML 清洗

```js
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
}
```

---

## 6. 配置 Schema

```js
const configSchema = [
  {
    key: 'appKey',
    label: 'App Key',
    type: 'text',
    required: true,
    placeholder: '从微博开放平台获取',
    helpText: '在 open.weibo.com 创建应用后获取'
  },
  {
    key: 'appSecret',
    label: 'App Secret',
    type: 'password',
    required: true,
    helpText: '应用的密钥，不会上传到除微博外的任何服务器'
  },
  {
    key: 'accessToken',
    label: 'Access Token',
    type: 'password',
    required: true,
    helpText: '通过 OAuth 授权获取，或点击"授权"按钮自动获取'
  },
  {
    key: 'redirectUri',
    label: '回调地址',
    type: 'text',
    default: 'https://api.weibo.com/oauth2/default.html',
    helpText: 'OAuth 授权回调 URL，需与应用控制台设置一致'
  },
  {
    key: 'count',
    label: '每次获取条数',
    type: 'number',
    default: 20,
    min: 1,
    max: 100,
    helpText: '单次 API 调用获取的微博数量'
  },
  {
    key: 'feature',
    label: '内容过滤',
    type: 'select',
    default: '0',
    options: [
      { label: '全部微博', value: '0' },
      { label: '仅原创', value: '1' },
      { label: '仅图片', value: '2' },
      { label: '仅视频', value: '3' },
      { label: '仅音乐', value: '4' }
    ],
    helpText: '按类型过滤关注流中的微博'
  }
]
```

---

## 7. 分页策略

### 7.1 Cursor 设计

使用 `since_id` 实现增量加载（FeedFlow 的典型用法是每次刷新拉取新内容）:

```
首次加载:   cursor = null          → 无 since_id，获取最新 20 条
后续刷新:   cursor = {"sinceId":"11488058246","page":2}
```

未来如需向下翻页加载历史, 可扩展为:
```json
{"sinceId": "11488058246", "maxId": "11488013766", "page": 2}
```

### 7.2 去重策略

FeedFlow 主程序通过 `externalId` (即 `status.idstr`) 在 `items` 表中 upsert，天然去重。

---

## 8. 错误处理

| 错误码 | 含义 | 处理策略 |
|--------|------|----------|
| `21332` | Token 过期 | 抛出明确错误，提示用户重新授权 |
| `10004` | 频率超限 | 延迟重试（指数退避），建议用户降低刷新频率 |
| `20502` | 未关注该用户 | 跳过（正常情况，home_timeline 不应出现） |
| `10001` | 系统错误 | 重试 2 次后放弃 |
| 网络错误 | DNS/超时 | 重试 1 次后跳过本次刷新 |

```js
async function fetchWithRetry(fn, maxRetries = 2) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i === maxRetries) throw err
      // 仅对网络错误和系统错误重试
      if (err.code === 21332 || err.code === 10004) throw err // 不重试
      await new Promise(r => setTimeout(r, 1000 * (i + 1)))
    }
  }
}
```

---

## 9. OAuth 授权 UX 建议

### 方案: UI 提供"授权"按钮

在 FeedFlow 的添加源界面中，除了填写 App Key / App Secret 表单，提供一个**"获取 Access Token"按钮**：

1. 用户先填写 App Key 和 App Secret
2. 点击"获取 Access Token"
3. FeedFlow 调用 `plugin.onRegister()` 中的授权逻辑:
   - 启动本地 HTTP 服务器
   - 打开系统默认浏览器跳转微博授权页
   - 用户完成授权后，浏览器回调到 localhost
   - 自动提取 code 并换取 access_token
   - 填入 accessToken 配置字段

> **注意**: 这需要 FeedFlow 主程序支持在插件配置阶段触发 OAuth 流程。作为 MVP，可以先让用户手动完成 OAuth 并将 token 粘贴进来，然后再演进到自动流程。

### MVP 阶段: 手动授权

用户手动完成以下步骤:
1. 在浏览器访问授权 URL（插件提供拼接好的 URL）
2. 授权后浏览器跳转到回调 URL，URL 中包含 `?code=xxxx`
3. 将 code 粘贴到 FeedFlow 中
4. 插件内部用 code 换取 access_token

---

## 10. 风险与注意事项

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Token 过期 | 无法拉取数据 | 检测 21332 错误后通知用户重新授权 |
| API 限流 | 临时中断 | 默认 2-3 分钟刷新间隔; 退避重试 |
| 微博 API 变更 | 插件失效 | 数据映射层隔离，只需修改 mapping 函数 |
| 图片 URL 失效 | 图片无法显示 | 缩略图转大图 URL，已在 mapping 中处理 |
| 长文本截断 | 内容不完整 | 长微博 `truncated=true` 时调用 `statuses/show` 获取全文 |

---

## 11. 实施计划

### Phase 1: 核心插件 (2-3 天)

- [ ] 创建 `plugins/weibo-home-timeline/` 目录结构
- [ ] 实现 `weibo-api.js`: HTTP 封装 + 响应解析
- [ ] 实现 `plugin.js`: fetchItems + 数据映射
- [ ] 实现配置 Schema
- [ ] 手动测试 (用长期 token 验证数据流)

### Phase 2: OAuth 集成 (1-2 天)

- [ ] 实现 `auth.js`: 本地服务器 + 浏览器授权流程
- [ ] Token 持久化与过期检测
- [ ] 错误提示国际化

### Phase 3: 完善 (1 天)

- [ ] 转发微博展示优化 (嵌套 UI)
- [ ] 长微博全文获取
- [ ] 图片画廊展示
- [ ] 文档与注释

---

## 附录

### A. 参考链接

- [微博开放平台 API 文档](https://open.weibo.com/wiki/API)
- [OAuth2.0 授权机制](https://open.weibo.com/wiki/授权机制)
- [statuses/home_timeline 接口](https://open.weibo.com/wiki/2/statuses/home_timeline)
- [错误码列表](https://open.weibo.com/wiki/Error_code)

### B. 微博文本 HTML 示例

微博 `text` 字段返回的是简单 HTML:
```
<a href="/n/人民日报">@人民日报</a>: 今天天气真好 <a href="https://t.cn/xxx">网页链接</a>
```

包含: `@mention` 链接、`#话题#` 链接、短链接。这些在 FeedFlow 的时间线中可以用 `content.html` 保留原始格式，以纯文本展示 `content.text`。
