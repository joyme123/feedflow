# X（Twitter）关注信息流 Plugin 技术方案

> 调研日期: 2026-07-27 | 作者: FeedFlow
> 更新日期: 2026-07-27

---

## 0. 方案选择：官方 API vs 免费方案

| | 官方 API (developer.x.com) | 免费方案 (x.com GraphQL) |
|---|---|---|
| **费用** | 基础版免费，高级接口需付费 | ✅ 完全免费 |
| **注册** | 需注册开发者账号、创建应用、审核 | ❌ 无需注册 |
| **认证** | OAuth 2.0 (API Key + Secret + Token) | Cookie (浏览器登录即可) |
| **Token 有效期** | 1天~90天，过期需重新授权 | Cookie 有效期通常数天~数周 |
| **数据完整度** | 高 (官方接口，字段完整) | 高 (x.com GraphQL 返回完整 JSON) |
| **稳定性** | 高 (官方维护) | 中 (GraphQL operation ID 可能随前端更新变化) |
| **频率限制** | 100~10000次/月/用户 (免费层) | 较宽松 (Cookie 方式) |
| **关注流接口** | `users/:id/timelines/reverse_chronological` | `graphql/{opId}/HomeLatestTimeline` (一次调用) |
| **法律风险** | 低 (官方授权) | 中 (需遵守 ToS，仅个人使用) |

**结论**: 采用**免费方案** (x.com GraphQL API)，与微博插件保持一致。
- 免费方案: 基于 x.com GraphQL API，用户提供 Cookie 即可
  - 核心接口: `POST https://x.com/i/api/graphql/{opId}/HomeLatestTimeline` — 直接获取关注时间线
- 无需 OAuth、无需 App Key/Secret、完全免费

---

## 1. 背景与目标

为 FeedFlow 新增**X（Twitter）关注信息流**（Home Timeline）作为信息源，让用户能在 FeedFlow 中浏览 X 关注列表的最新动态。

### 目标
- 通过 x.com GraphQL API 获取数据（与微博插件的免费方案对齐）
- 插件化实现，不侵入主程序代码
- 支持 Cookie 认证，每个用户使用自己的 X 账号
- 支持分页游标，可与 FeedFlow 的刷新机制配合
- 能力上对齐微博插件：关注流获取、Cookie 验证、数据映射、游标分页

---

## 2. X.com API 调研

### 2.1 GraphQL API 概况

X.com 桌面版网页使用 GraphQL API（`/i/api/graphql/` 路径下）。
用户在浏览器登录 `x.com` 后，将 Cookie 复制到 FeedFlow 中即可使用。

| 项目 | 说明 |
|------|------|
| 平台 | [X.com](https://x.com/) |
| 认证 | Cookie (auth_token + ct0) + 公开 Bearer Token |
| API 类型 | GraphQL (POST) |
| 响应格式 | JSON |
| 基础 URL | `https://x.com/i/api/graphql/` |

### 2.2 核心接口

#### 2.2.1 关注时间线: HomeLatestTimeline

```
POST https://x.com/i/api/graphql/{operationId}/HomeLatestTimeline
```

获取当前登录用户所关注用户的最新推文（"关注" 标签页）。

**请求 Body**:
```json
{
  "variables": {
    "count": 20,
    "cursor": null,
    "includePromotedContent": false,
    "withQuickPromoteEligibilityTweetFields": false,
    "withVoice": true,
    "withV2Timeline": true
  },
  "features": { ... },
  "fieldToggles": {
    "withArticlePlainText": false
  }
}
```

**响应结构**:
```json
{
  "data": {
    "home": {
      "home_timeline_urt": {
        "instructions": [
          {
            "type": "TimelineAddEntries",
            "entries": [
              {
                "entryId": "tweet-xxx",
                "content": {
                  "entryType": "TimelineTimelineItem",
                  "itemContent": {
                    "tweet_results": {
                      "result": {
                        "rest_id": "1234567890",
                        "legacy": {
                          "full_text": "推文内容",
                          "created_at": "Wed Jul 27 12:00:00 +0000 2026",
                          "entities": { "media": [...] },
                          "retweeted_status_result": { "result": {...} },
                          "quoted_status_result": { "result": {...} }
                        },
                        "core": {
                          "user_results": {
                            "result": {
                              "rest_id": "123",
                              "legacy": {
                                "screen_name": "username",
                                "name": "显示名称",
                                "profile_image_url_https": "https://..."
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              },
              {
                "entryId": "cursor-bottom",
                "content": {
                  "entryType": "TimelineTimelineCursor",
                  "cursorType": "Bottom",
                  "value": "分页游标值"
                }
              }
            ]
          }
        ]
      }
    }
  }
}
```

#### 2.2.2 推荐时间线: HomeTimeline

```
POST https://x.com/i/api/graphql/{operationId}/HomeTimeline
```

获取 "为你推荐" 标签页的算法推荐内容。请求/响应结构与 HomeLatestTimeline 类似。

#### 2.2.3 用户信息: Viewer

```
POST https://x.com/i/api/graphql/{operationId}/Viewer
```

验证 Cookie 有效性，获取当前登录用户信息。

**响应结构**:
```json
{
  "data": {
    "viewer": {
      "rest_id": "123",
      "name": "显示名称",
      "screen_name": "username",
      "profile_image_url_https": "https://..."
    }
  }
}
```

### 2.3 认证方式

所有请求需在 Header 中携带:

| Header | 说明 |
|--------|------|
| `Authorization` | `Bearer {公开令牌}` (x.com 网页端使用的固定公开令牌) |
| `Cookie` | 用户从 x.com 浏览器登录后复制的完整 Cookie |
| `x-csrf-token` | 从 Cookie 的 `ct0` 字段提取 |
| `x-twitter-active-user` | `yes` |
| `x-twitter-client-language` | `en` |
| `x-twitter-client-type` | `web` |
| `Content-Type` | `application/json` |

### 2.4 Operation ID

X.com 的 GraphQL operation ID 是查询文档的哈希，随前端版本更新可能变化。
当前使用的 operation ID:

| 操作 | Operation ID |
|------|-------------|
| `HomeLatestTimeline` | `G12uVyoU2CtFqK4T_R8w4g` |
| `HomeTimeline` | `WlQjJxqB9qHg0B7gV5GJ6g` |
| `Viewer` | `k5X2qB7lgY3SjV7Hr4RcZw` |

> 如遇 API 返回 "Could not authenticate you" 或类似错误，可能是 operation ID 已过期，
> 需要更新为最新值。可在浏览器 DevTools → Network 中查找对应的 GraphQL 请求获取。

---

## 3. 插件架构设计

### 3.1 文件结构

```
plugins/x-home-timeline/
├── package.json          # 插件元信息 + feedflow 字段
├── plugin.js             # 插件主入口（fetchItems 逻辑 + 数据映射）
├── auth.js               # Cookie 验证逻辑
└── x-api.js              # X.com GraphQL API 封装
```

### 3.2 package.json

```json
{
  "name": "feedflow-plugin-x",
  "version": "1.0.0",
  "description": "免费自动获取 X（Twitter）关注信息流（基于 x.com GraphQL API，无需 OAuth）",
  "main": "plugin.js",
  "feedflow": {
    "id": "feedflow-plugin-x",
    "name": "X 关注流",
    "version": "1.0.0",
    "description": "免费自动获取 X（Twitter）关注信息流（基于 x.com GraphQL API，无需 OAuth）",
    "author": "FeedFlow",
    "color": "#1DA1F2",
    "icon": "🐦"
  }
}
```

### 3.3 依赖

插件运行在 Electron main 进程（Node.js），使用 Node 内置模块，**无需额外 npm 依赖**:

| 用途 | 实现方式 |
|------|----------|
| HTTP 请求 | Node.js 内置 `https` 模块 |
| 认证 | Cookie + 公开 Bearer Token |
| 密钥存储 | 通过 `SourceConfig` 由主程序管理 |

---

## 4. Cookie 认证方案

### 4.1 流程设计

采用 **Cookie 复制** 方案（与微博插件一致）:

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   FeedFlow   │     │   Browser    │     │   X.com      │
│  (Electron)  │     │              │     │    Server    │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                     │                     │
       │ 1. 用户在浏览器登录 x.com                     │
       │                     │                     │
       │                     │ 2. 登录成功，获得 Cookie │
       │                     │<────────────────────│
       │                     │                     │
       │ 3. 用户复制 Cookie  │                     │
       │<────────────────────│                     │
       │                     │                     │
       │ 4. 粘贴到 FeedFlow  │                     │
       │                     │                     │
       │ 5. 带 Cookie 请求 API                     │
       │──────────────────────────────────────────>│
       │                     │                     │
       │ 6. 返回关注流数据   │                     │
       │<──────────────────────────────────────────│
```

### 4.2 Cookie 获取方法

1. 浏览器登录 `https://x.com`
2. 按 `F12` 打开开发者工具 → `Network` 标签
3. 刷新页面，点击任意一个 `x.com` 请求
4. 在 `Request Headers` 中找到 `Cookie` 字段，复制完整值

或者:
1. 按 `F12` → `Application` 标签
2. 左侧 `Storage` → `Cookies` → `https://x.com`
3. 复制 `auth_token` 和 `ct0` 的值，拼接为: `auth_token=xxx; ct0=yyy`

### 4.3 Cookie 验证

插件提供 `verifyCookie(cookie)` 函数（通过 `plugins:verify-cookie` IPC 通道调用）:
- 调用 `Viewer` 接口验证 Cookie 有效性
- 返回 `{ valid, uid, screenName, error }` 结构
- UI 中显示验证状态和用户名

---

## 5. 数据映射

### 5.1 X Tweet → FeedFlow TimelineItem

```js
function mapTweetToItem(tweet) {
  const legacy = tweet.legacy || {}
  const userResult = tweet.core?.user_results?.result || {}
  const userLegacy = userResult.legacy || {}

  return {
    externalId: tweet.rest_id,
    author: {
      name: userLegacy.name || userLegacy.screen_name,
      avatarUrl: userLegacy.profile_image_url_https || '',
      profileUrl: `https://x.com/${userLegacy.screen_name}`
    },
    content: {
      text: stripHtml(displayText),
      html: displayText
    },
    mediaUrls,  // 从 legacy.entities.media 提取
    permalink: `https://x.com/${screenName}/status/${tweetId}`,
    publishedAt: parseXDate(legacy.created_at),
    metadata: {
      retweetCount: legacy.retweet_count,
      favoriteCount: legacy.favorite_count,
      replyCount: legacy.reply_count,
      quoteCount: legacy.quote_count,
      isRetweet: !!legacy.retweeted_status_result,
      isQuote: !!legacy.quoted_status_result && !legacy.retweeted_status_result,
      lang: legacy.lang,
      source: stripHtml(legacy.source || '')
    }
  }
}
```

### 5.2 转发 (Retweet) 处理

当推文包含 `retweeted_status_result` 时，显示为转发:
- 提取原推文作者和内容
- 显示格式: `🔁 @原作者:\n原推文内容`

### 5.3 引用 (Quote) 处理

当推文包含 `quoted_status_result` 时，附加引用内容:
- 显示格式: 原文 + `\n\n📎 @被引用作者:\n引用内容`

### 5.4 媒体 URL 处理

- 图片: 使用 `media_url_https` + `:large` 后缀获取大图
- 视频: 使用 `media_url_https` 作为缩略图
- GIF: 使用 `media_url_https`

### 5.5 时间解析

X.com 返回的时间格式为: `"Wed Jul 27 12:00:00 +0000 2026"`
直接用 `new Date(dateStr)` 解析，转为 ISO 8601 格式。

---

## 6. 配置 Schema

```js
const configSchema = [
  {
    key: 'cookie',
    label: 'X Cookie',
    type: 'text-area',
    required: true,
    placeholder: '从 x.com 浏览器登录后，在 DevTools → Network 中复制 Cookie',
    helpText: '登录 https://x.com 后，按 F12 → Network → 刷新页面 → 点击任意请求 → 复制 Cookie 字段的值。插件会自动获取你的关注信息流。'
  },
  {
    key: 'feedType',
    label: '时间线类型',
    type: 'select',
    default: 'following',
    options: [
      { label: '关注（Following）', value: 'following' },
      { label: '为你推荐（For you）', value: 'foryou' }
    ],
    helpText: '选择获取 "关注" 流（已关注用户的推文）或 "为你推荐" 流（算法推荐）'
  },
  {
    key: 'count',
    label: '每次获取条数',
    type: 'number',
    default: 20,
    min: 1,
    max: 50,
    helpText: '单次刷新获取的推文数量'
  }
]
```

---

## 7. 分页策略

### 7.1 Cursor 设计

使用 X.com GraphQL 返回的 `Bottom` cursor 实现增量加载:

```
首次加载:   cursor = null          → 无 cursor，获取最新推文
后续刷新:   cursor = {"cursor":"eyJib3R0b21fY3Vyc29yIjoiMTAwMiJ9"}
```

### 7.2 去重策略

FeedFlow 主程序通过 `externalId` (即 `tweet.rest_id`) 在 `items` 表中 upsert，天然去重。

---

## 8. 错误处理

| 错误码 | 含义 | 处理策略 |
|--------|------|----------|
| `401` | Cookie 过期/无效 | 抛出明确错误，提示用户重新登录 x.com |
| `403` | Cookie 过期/无效 | 抛出明确错误，提示用户重新登录 x.com |
| `429` | 频率超限 | 提示用户稍后重试 |
| 网络错误 | DNS/超时 | 抛出错误信息，下次刷新重试 |
| GraphQL errors | API 返回错误 | 提取 errors[0].message 展示给用户 |

---

## 9. 与微博插件的能力对齐

| 能力 | 微博插件 | X 插件 |
|------|---------|--------|
| 认证方式 | Cookie | Cookie + Bearer Token |
| 关注流获取 | ✅ unreadfriendstimeline | ✅ HomeLatestTimeline |
| 推荐流获取 | ❌ | ✅ HomeTimeline (feedType 配置) |
| Cookie 验证 | ✅ getBasicInfo | ✅ Viewer |
| 数据映射 | ✅ 含转发处理 | ✅ 含转发 + 引用处理 |
| 图片提取 | ✅ pic_ids / pic_urls | ✅ entities.media |
| 游标分页 | ✅ since_id (JSON) | ✅ GraphQL cursor (JSON) |
| 配置项 | cookie, count | cookie, feedType, count |
| 错误处理 | ✅ | ✅ |
| 生命周期 | onRegister | onRegister |

---

## 10. 风险与注意事项

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Cookie 过期 | 无法拉取数据 | 检测 401/403 错误后通知用户重新登录 |
| Operation ID 过期 | API 调用失败 | 集中定义 OPERATION_IDS，便于更新 |
| API 限流 | 临时中断 | 429 错误提示，建议降低刷新频率 |
| X.com API 变更 | 插件失效 | 数据映射层隔离，只需更新 x-api.js |
| 图片 URL 失效 | 图片无法显示 | 使用 :large 后缀获取高质量图片 |

---

## 11. 参考链接

- [X.com GraphQL API 逆向分析](https://github.com/trevorhobenshield/twitter-api-client)
- [X Developer Platform](https://developer.x.com/)
- [Cookie 获取方法](https://help.x.com/)
