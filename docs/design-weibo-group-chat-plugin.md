# 微博群聊 Plugin 技术方案

> 调研日期: 2026-07-29 | 作者: FeedFlow
> 验证状态: ✅ 已通过实际 API 调用验证（使用 FeedFlow 数据库中的微博 Cookie）

---

## 0. 方案概述

为 FeedFlow 新增**微博群聊**（微博粉丝群/讨论组）作为信息源，让用户能在 FeedFlow 中浏览所加入群聊的最新消息。

### 核心结论

- **技术方案完全可行**。微博群聊的所有核心接口均可通过 **Cookie 认证 + HTTPS GET** 方式访问，与现有微博关注流插件的技术模式完全一致。
- **凭据复用**。群聊接口与微博首页接口使用同一 `weibo.com` Cookie，可直接复用 FeedFlow 的凭据管理系统，用户无需重复配置。
- **API 已验证**。通过从 FeedFlow 数据库提取微博 Cookie 并进行实际 API 调用，已确认群列表接口和群消息接口均正常返回数据。

### 与微博关注流插件的差异

| 维度 | 微博关注流（现有） | 微博群聊（本方案） |
|---|---|---|
| API Host | `weibo.com` | `api.weibo.com` |
| 群列表接口 | `/ajax/feed/allGroups` | `/webim/groupchat/query_join_groups.json` |
| 消息接口 | `/ajax/feed/unreadfriendstimeline` | `/webim/groupchat/query_messages.json` |
| 认证方式 | Cookie | Cookie（同一凭据） |
| 数据结构 | 微博帖子（长文、图片、转发） | 聊天消息（短文本、发送者、时间戳） |
| 消息 ID 字段 | `idstr` / `mid` | `id`（雪花 ID） |
| 时间格式 | 中文相对时间（"刚刚"、"5分钟前"） | Unix 时间戳 |
| 凭据系统 | 复用 | 复用 |
| FeedType | `timeline`（默认） | `group-chat` |

### FeedType 模式设计

群聊消息是对话式的，混入聚合流会丢失上下文。因此引入 `feedType` 概念，从架构层面区分两种来源模式：

- **`timeline`**（默认）：普通信息流，消息进入聚合流，与其他来源按时间混排
- **`group-chat`**：群聊模式，消息**不进入聚合流**，仅在单独查看该来源时展示，保留对话上下文

**数据流**：

```
PluginMeta.feedType → Source.feedType → sources 表 feed_type 列
                                              ↓
聚合流查询: WHERE source_id NOT IN (SELECT id FROM sources WHERE feed_type = 'group-chat')
                                              ↓
侧边栏: 按 feedType 分区展示（信息流 / 群聊）
```

**涉及变更**：

| 层 | 文件 | 变更 |
|---|---|---|
| 类型 | `src/shared/types/plugin.ts` | `PluginMeta` 新增 `feedType` 字段 |
| 类型 | `src/shared/types/source.ts` | `Source` 新增 `feedType` 字段 |
| 数据库 | `src/main/database/schema.ts` | `sources` 表新增 `feed_type` 列（含迁移） |
| 查询 | `src/main/database/queries/sources.ts` | 所有 SELECT 包含 `feed_type`，`addSource` 从插件继承 |
| 查询 | `src/main/database/queries/items.ts` | 聚合流查询排除 `group-chat` 来源 |
| UI | `src/renderer/src/components/sources/SourceList.tsx` | 按 `feedType` 分区展示 |

---

## 1. API 验证结果

### 1.1 验证方法

从 FeedFlow 运行数据库（`~/Library/Application Support/FeedFlow/feedflow.db`）中提取已加密存储的微博 Cookie，通过 Electron `safeStorage` 解密后，对微博群聊 API 端点进行实际调用验证。

### 1.2 验证环境

- Cookie 来源：FeedFlow 凭据管理系统中已存储的微博凭据（`plugin_id = feedflow-plugin-weibo`）
- 验证账号：角蚁（UID: 1934183965）
- 已加入群聊：2 个（西医养生俱乐部等）

### 1.3 API 端点发现过程

1. 微博群聊的网页版入口为 `https://api.weibo.com/chat/`（标题：微博聊天网页版）
2. 该页面是独立的 Vue.js SPA 应用，JS Bundle 位于 `h5.sinaimg.cn/m/pcweibochat/`
3. 通过分析 JS Bundle（`app.fcf62844.js`），发现 axios 配置：
   ```javascript
   s.a.defaults.baseURL = ye ? "//api.weibo.com" : ""
   ```
   即生产环境下 API 请求为相对路径，页面 host 为 `api.weibo.com`，因此所有 `/webim/` 开头的接口实际请求 `https://api.weibo.com/webim/...`
4. 从 JS Bundle 中提取出所有群聊相关 API 端点（见下文）

---

## 2. API 接口详细说明

### 2.1 获取已加入群列表

```
GET https://api.weibo.com/webim/groupchat/query_join_groups.json
```

**请求头**：

| Header | 值 |
|--------|-----|
| `Cookie` | weibo.com Cookie |
| `User-Agent` | 浏览器 UA |
| `Accept` | `application/json, text/plain, */*` |
| `X-Requested-With` | `XMLHttpRequest` |
| `Referer` | `https://api.weibo.com/chat/` |

**响应**（已验证，实际返回）：

```json
{
  "total": 2,
  "join_groups": [
    {
      "id": 5211500894489005,
      "no": "33943988",
      "page_objectid": "1022:2304915211500894489005",
      "name": "西医养生俱乐部",
      "system_name": "西医养生俱乐部",
      "avatar": "https://wx1.sinaimg.cn/large/53899d01ly8i5tecrhjulj2050050wf8.jpg",
      "avatar_s": "https://wx1.sinaimg.cn/wap50/53899d01ly8i5tecrhjulj2050050wf8.jpg",
      "round_avatar": "https://wx4.sinaimg.cn/large/53899d01ly8i5tecrndxyj208c08c773.jpg",
      "group_type": 3,
      "super_group_type": 1,
      "summary": "TK的粉丝群，主要谈一百块钱以下的话题。",
      "max_member": 1000,
      "owner": 1401527553,
      "member_count": 1000,
      "create_time": 1758002102,
      "validate_type": 4,
      "group_ts": 1785324743379,
      "status": 3,
      "active": 0,
      "publicity": 1,
      "last_msg_time": 1785325637,
      "join_time": 1778219218,
      "begin_mid": 5296236305057369,
      "push": 1,
      "addsession": 0,
      "filterfeed": 0,
      "push_airborne": 1,
      "filterquery": 0,
      "group_url": "https://weibo.com/p/2304915211500894489005",
      "global_max_admin": 30,
      "max_admin": 30
    }
  ]
}
```

**关键字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int64 | 群 ID，用于调用消息接口 |
| `name` | string | 群名称 |
| `avatar` | string | 群头像 URL |
| `member_count` | int | 群成员数 |
| `owner` | int64 | 群主 UID |
| `last_msg_time` | int64 | 最后消息时间（Unix 时间戳） |
| `group_url` | string | 群在 weibo.com 上的页面 URL |
| `summary` | string | 群简介 |

### 2.2 获取群聊消息

```
GET https://api.weibo.com/webim/groupchat/query_messages.json?convert_emoji=1&query_sender=1&id={group_id}
```

**请求参数**：

| 参数 | 必选 | 类型 | 说明 |
|------|------|------|------|
| `id` | 是 | int64 | 群 ID（从群列表接口获取） |
| `convert_emoji` | 否 | int | 设为 `1`，转换表情符号 |
| `query_sender` | 否 | int | 设为 `1`，返回发送者详细信息 |
| `count` | 否 | int | 单页条数，默认 20 |
| `max_mid` | 否 | int64 | 返回该消息之前的历史消息 |

> 经微博聊天网页的实际调用和接口响应验证，`max_id` 与 `since_id` 会被
> `query_messages.json` 忽略。刷新最新消息时不传游标，历史分页使用 `max_mid`。

**响应**（已验证，实际返回）：

```json
{
  "result": true,
  "last_read_mid": 5326104111874292,
  "messages": [
    {
      "is_important": 0,
      "gid": 5211500894489005,
      "faith_status": 2,
      "annotations": {
        "send_from": "webchat",
        "clientid": "2wx3h1l4bmu7zxale519csqp1nphfsi",
        "webchat": 1
      },
      "type": 321,
      "from_uid": 5337424763,
      "content": "我甚至觉得，我其实没有能力review他写的代码",
      "from_user": {
        "avatar_large": "https://tvax1.sinaimg.cn/crop.0.0.1080.1080.180/005Pdi0bly8iekuo2jg89j30u00u0mxm.jpg?KID=imgbed,tva&Expires=1785337727&ssig=BRFrtxmLCq",
        "friends_count": 766,
        "followers_count_str": "326",
        "screen_name": "抹库多",
        "profile_url": "u/5337424763",
        "level": 1,
        "followers_count": 326,
        "verified": false,
        "profile_image_url": "https://tvax1.sinaimg.cn/crop.0.0.1080.1080.50/005Pdi0bly8iekuo2jg89j30u00u0mxm.jpg?KID=imgbed,tva&Expires=1785337727&ssig=tKdt8Ltonx",
        "id": 5337424763,
        "friends_count_str": "766"
      },
      "recall_status": 0,
      "media_type": 0,
      "appid": 82,
      "id": 5326056182514158,
      "time": 1785314210
    }
  ],
  "group_tips": [],
  "significant_msgs": [],
  "ts": 1785325637
}
```

**消息字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int64 | 消息 ID（雪花 ID，用于去重和游标分页） |
| `gid` | int64 | 所属群 ID |
| `type` | int | 消息类型。`321` = 普通文本消息 |
| `from_uid` | int64 | 发送者 UID |
| `content` | string | 消息文本内容 |
| `from_user` | object | 发送者详细信息 |
| `from_user.screen_name` | string | 发送者昵称 |
| `from_user.avatar_large` | string | 发送者大头像 URL |
| `from_user.profile_url` | string | 发送者主页路径（如 `u/5337424763`） |
| `from_user.id` | int64 | 发送者 UID |
| `from_user.verified` | bool | 是否认证 |
| `from_user.level` | int | 微博等级 |
| `time` | int64 | 消息发送时间（Unix 时间戳，秒） |
| `media_type` | int | 媒体类型。`0` = 纯文本，其他值为图片/视频/语音等 |
| `appid` | int | 来源 App ID |
| `annotations` | object | 消息注解（send_from、clientid 等） |

**顶层字段说明**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `result` | bool | 是否成功 |
| `last_read_mid` | int64 | 最后已读消息 ID |
| `messages` | array | 消息列表（按时间倒序，最新在前） |
| `ts` | int64 | 服务端时间戳 |

### 2.3 其他可用端点（从 JS Bundle 中提取）

以下端点在 `app.fcf62844.js` 中发现，供后续扩展使用：

| 端点 | 方法 | 用途 |
|------|------|------|
| `/webim/groupchat/query_join_groups.json` | GET | 获取已加入群列表（已验证） |
| `/webim/groupchat/query_messages.json` | GET | 获取群聊消息（已验证） |
| `/webim/groupchat/query_message.json` | GET | 获取单条消息（需 `id` 和 `mid` 参数） |
| `/webim/groupchat/batch_query_messages.json` | GET | 批量查询消息（需权限） |
| `/webim/groupchat/query.json` | GET | 查询群信息（需 `source` 参数） |
| `/webim/groupchat/create.json` | POST | 创建群聊 |
| `/webim/groupchat/update.json` | POST | 更新群信息 |
| `/webim/groupchat/join.json` | POST | 加入群聊 |
| `/webim/groupchat/exit.json` | POST | 退出群聊 |
| `/webim/groupchat/kick.json` | POST | 踢出成员 |
| `/webim/groupchat/send_message.json` | POST | 发送消息 |
| `/webim/groupchat/delete_message.json` | POST | 删除消息 |
| `/webim/groupchat/clear_unread.json` | POST | 清除未读 |
| `/webim/groupchat/clear_sys_unread.json` | POST | 清除系统未读 |
| `/webim/groupchat/update_user_settings.json` | POST | 更新用户设置 |
| `/webim/groupchat/query_nick.json` | GET | 查询群昵称 |
| `/webim/groupchat/send_bulletin.json` | POST | 发送群公告 |
| `/webim/query_config.json` | GET | 查询配置（已验证） |
| `/webim/query_remark.json` | GET | 查询备注 |
| `/webim/pic_infos.json` | GET | 图片信息 |

---

## 3. 数据映射

### 3.1 群聊消息 → FeedFlow TimelineItem

```javascript
function mapMessageToItem(message, group) {
  const fromUser = message.from_user || {}
  const messageId = String(message.id)

  // 媒体 URL（图片/视频消息需根据 media_type 处理，纯文本消息为空）
  const mediaUrls = []

  // 群聊消息无 HTML，content 为纯文本
  const text = message.content || ''

  return {
    externalId: messageId,
    author: {
      name: fromUser.screen_name || 'unknown',
      avatarUrl: fromUser.avatar_large || fromUser.profile_image_url || '',
      profileUrl: fromUser.profile_url
        ? `https://weibo.com/${fromUser.profile_url}`
        : (fromUser.id ? `https://weibo.com/u/${fromUser.id}` : '')
    },
    content: {
      text: text,
      html: text
    },
    mediaUrls,
    permalink: group && group.group_url ? group.group_url : '',
    publishedAt: message.time ? new Date(message.time * 1000).toISOString() : new Date().toISOString(),
    metadata: {
      type: message.type,
      media_type: message.media_type,
      appid: message.appid,
      gid: message.gid,
      groupName: group ? group.name : ''
    }
  }
}
```

### 3.2 时间处理

群聊消息的 `time` 字段为 Unix 时间戳（秒），直接转换即可：

```javascript
function parseMessageTime(timestamp) {
  if (!timestamp) return new Date().toISOString()
  return new Date(timestamp * 1000).toISOString()
}
```

### 3.3 消息类型过滤

`type` 字段标识消息类型：

| type 值 | 说明 | 处理方式 |
|---------|------|----------|
| `321` | 普通文本消息 | 正常展示 |
| 其他 | 系统消息、入群通知等 | 可过滤或特殊展示 |

建议在 `fetchItems` 中过滤非文本消息（`type !== 321`），避免系统通知污染信息流。

---

## 4. 插件架构设计

### 4.1 文件结构

```
plugins/weibo-group-chat/
├── package.json          # 插件元信息 + feedflow 字段
├── plugin.js             # 插件主入口（fetchItems 逻辑）
├── group-api.js          # 群聊 API 封装
└── auth.js               # Cookie 验证逻辑
```

### 4.2 package.json

```json
{
  "name": "feedflow-plugin-weibo-group-chat",
  "version": "1.0.0",
  "description": "微博群聊信息流插件",
  "main": "plugin.js",
  "feedflow": {
    "id": "feedflow-plugin-weibo-group-chat",
    "name": "微博群聊",
    "version": "1.0.0",
    "description": "获取微博群聊中的最新消息",
    "author": "FeedFlow",
    "color": "#E6162D",
    "icon": "💬"
  }
}
```

### 4.3 group-api.js — API 封装

```javascript
const https = require('https')

const API_HOST = 'api.weibo.com'

/**
 * 清理 Cookie 值，移除 HTTP 头中的非法字符
 */
function sanitizeCookie(cookie) {
  if (!cookie) return ''
  return cookie.replace(/[\r\n\t]/g, '').trim()
}

/**
 * 发起 HTTPS GET 请求（带 Cookie）
 * 与 weibo-home-timeline 插件的 httpsGet 实现一致，但 host 为 api.weibo.com
 */
function httpsGet(path, cookie, referer = 'https://api.weibo.com/chat/') {
  const cleanCookie = sanitizeCookie(cookie)
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: API_HOST,
        path,
        headers: {
          'Cookie': cleanCookie,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': referer
        },
        timeout: 15000
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          if (res.statusCode === 403) {
            reject(new ApiError(403, 'Cookie 已过期或无效，请重新登录 weibo.com 获取'))
            return
          }
          try {
            const json = JSON.parse(body)
            if (json.result === false) {
              reject(new ApiError(json.error_code || -1, json.error || 'API 返回错误'))
              return
            }
            resolve(json)
          } catch (e) {
            reject(new Error(`解析 API 响应失败: ${body.slice(0, 200)}`))
          }
        })
      }
    )
    req.on('error', (err) => reject(err))
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('请求超时'))
    })
  })
}

class ApiError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'WeiboGroupApiError'
    this.code = code
  }
}

/**
 * 获取已加入的群列表
 * GET https://api.weibo.com/webim/groupchat/query_join_groups.json
 */
function fetchJoinGroups(cookie) {
  return httpsGet('/webim/groupchat/query_join_groups.json', cookie)
}

/**
 * 获取群聊消息
 * GET https://api.weibo.com/webim/groupchat/query_messages.json
 *
 * @param {string} cookie - weibo.com Cookie
 * @param {object} params
 * @param {string|number} params.id - 群 ID
 * @param {number} [params.count] - 单页条数
 * @param {string|number} [params.max_mid] - 翻页：返回该消息之前的历史消息
 */
function fetchGroupMessages(cookie, params) {
  const query = new URLSearchParams({
    convert_emoji: 1,
    query_sender: 1
  })
  if (params.id) query.set('id', params.id)
  if (params.count) query.set('count', params.count)
  if (params.max_mid) query.set('max_mid', params.max_mid)
  return httpsGet(`/webim/groupchat/query_messages.json?${query.toString()}`, cookie)
}

module.exports = {
  ApiError,
  httpsGet,
  fetchJoinGroups,
  fetchGroupMessages
}
```

### 4.4 plugin.js — 插件主入口

```javascript
const { fetchJoinGroups, fetchGroupMessages, ApiError } = require('./group-api')
const { verifyCookie } = require('./auth')

const meta = {
  id: 'feedflow-plugin-weibo-group-chat',
  name: '微博群聊',
  version: '1.0.0',
  description: '获取微博群聊中的最新消息（基于 api.weibo.com 群聊 API，无需 OAuth）',
  author: 'FeedFlow',
  color: '#E6162D'
}

const configSchema = [
  {
    key: 'cookie',
    label: '微博凭据',
    type: 'credential',
    required: true,
    helpText: '选择一个已保存的微博 Cookie 凭据，或创建新凭据。凭据可在多个信息源间复用，无需重复粘贴。'
  },
  {
    key: 'group_id',
    label: '选择群聊',
    type: 'select',
    required: true,
    helpText: '选择要接入信息流的微博群聊。请先选择上方的微博凭据，群聊列表将自动加载。',
    options: [] // 运行时通过 listGroups IPC 通道动态加载
  },
  {
    key: 'count',
    label: '每次获取条数',
    type: 'number',
    default: 20,
    min: 1,
    max: 50,
    helpText: '单次刷新获取的消息数量'
  }
]

// 群信息缓存（避免每次 fetchItems 都调用群列表接口）
let cachedGroups = null
let groupsCacheTime = 0
const GROUPS_CACHE_TTL = 5 * 60 * 1000 // 群列表缓存 5 分钟

async function fetchItems(config, cursor) {
  const cookie = config.cookie
  if (!cookie) {
    throw new Error('微博 Cookie 未配置。请在源设置中选择或创建微博凭据。')
  }

  const groupId = config.group_id
  if (!groupId) {
    throw new Error('未选择群聊。请在源设置中选择要接入的微博群聊。')
  }

  const count = Math.min(config.count || 20, 50)

  // 解析游标
  let sinceId = null
  let maxId = null
  if (cursor) {
    try {
      const cursorObj = JSON.parse(cursor)
      sinceId = cursorObj.sinceId || null
      maxId = cursorObj.maxId || null
    } catch {
      sinceId = cursor // 兼容旧格式：纯数字 ID
    }
  }

  // 获取群信息（用于消息映射中的 permalink 和 groupName）
  const group = await getGroupInfo(cookie, groupId)

  // 构建 API 参数：刷新不传游标，历史分页使用 max_mid
  const params = { id: groupId, count }
  if (maxId) {
    params.max_mid = maxId
  }

  const response = await fetchGroupMessages(cookie, params)
  const messages = (response.messages || []).filter(m => m.type === 321) // 仅保留文本消息

  if (messages.length === 0 && response.result === true) {
    return { items: [], nextCursor: cursor }
  }

  const items = messages.map(m => mapMessageToItem(m, group))

  // 计算新游标
  const newestId = messages.length > 0 ? String(messages[0].id) : null
  const oldestId = messages.length > 0 ? String(messages[messages.length - 1].id) : null

  const nextCursor = JSON.stringify({
    sinceId: sinceId || newestId || '',   // 保留最高 sinceId
    maxId: oldestId || ''                 // 更新到最旧消息 ID
  })

  return { items, nextCursor }
}

/**
 * 获取群信息（带缓存）
 */
async function getGroupInfo(cookie, groupId) {
  const now = Date.now()
  if (cachedGroups && (now - groupsCacheTime) < GROUPS_CACHE_TTL) {
    return cachedGroups.find(g => String(g.id) === String(groupId)) || null
  }
  try {
    const response = await fetchJoinGroups(cookie)
    cachedGroups = response.join_groups || []
    groupsCacheTime = now
    return cachedGroups.find(g => String(g.id) === String(groupId)) || null
  } catch (err) {
    console.warn('[weibo-group-chat] Failed to fetch groups:', err.message)
    return null
  }
}

function mapMessageToItem(message, group) {
  const fromUser = message.from_user || {}
  const text = message.content || ''

  return {
    externalId: String(message.id),
    author: {
      name: fromUser.screen_name || 'unknown',
      avatarUrl: fromUser.avatar_large || fromUser.profile_image_url || '',
      profileUrl: fromUser.profile_url
        ? `https://weibo.com/${fromUser.profile_url}`
        : (fromUser.id ? `https://weibo.com/u/${fromUser.id}` : '')
    },
    content: {
      text: text,
      html: text
    },
    mediaUrls: [],
    permalink: group && group.group_url ? group.group_url : '',
    publishedAt: message.time ? new Date(message.time * 1000).toISOString() : new Date().toISOString(),
    metadata: {
      type: message.type,
      media_type: message.media_type,
      appid: message.appid,
      gid: message.gid,
      groupName: group ? group.name : ''
    }
  }
}

async function onRegister(ctx) {
  ctx.logger.info('[weibo-group-chat] 微博群聊插件 (api.weibo.com) 已注册')
}

const weiboGroupChatPlugin = {
  meta,
  configSchema,
  fetchItems,
  onRegister
}

module.exports = {
  default: weiboGroupChatPlugin,
  verifyCookie
}
```

### 4.5 auth.js — Cookie 验证

复用现有微博插件的 `verifyCookie` 逻辑，调用 `/ajax/setting/getBasicInfo` 验证 Cookie 有效性：

```javascript
// 与 weibo-home-timeline 插件的 auth.js 实现一致
// 调用 weibo.com/ajax/setting/getBasicInfo 验证 Cookie
// 返回 { valid, uid, screenName, error }
```

---

## 5. 配置 Schema

```javascript
const configSchema = [
  {
    key: 'cookie',
    label: '微博凭据',
    type: 'credential',
    required: true,
    helpText: '选择一个已保存的微博 Cookie 凭据，或创建新凭据。凭据可在多个信息源间复用，无需重复粘贴。'
  },
  {
    key: 'group_id',
    label: '选择群聊',
    type: 'select',
    required: true,
    helpText: '选择要接入信息流的微博群聊。可在凭据管理中验证 Cookie 后查看可用群列表。',
    options: [] // 运行时通过 API 动态加载
  },
  {
    key: 'count',
    label: '每次获取条数',
    type: 'number',
    default: 20,
    min: 1,
    max: 50,
    helpText: '单次刷新获取的消息数量'
  }
]
```

### 5.1 群聊下拉选项动态加载

`group_id` 字段类型为 `select`，`options` 需在运行时通过 IPC 通道加载。当用户在 `SourceConfigForm` 中选择凭据后，渲染进程自动调用 `plugins:list-groups` IPC 通道：

1. 主进程接收 `{ pluginId, credentialId }` 参数
2. 通过 `getCredentialById` 解析凭据获取原始 Cookie
3. 调用插件的 `listGroups(cookie)` 函数获取群列表
4. 返回 `{ label, value }[]` 选项列表供渲染进程展示

每个选项的 `value` 为群 ID（`String(group.id)`），`label` 为群名称（`group.name`）。

---

## 6. 分页策略

### 6.1 Cursor 设计

采用与现有微博插件一致的 JSON 游标格式：

```json
{ "sinceId": "5326056182514158", "maxId": "5326058879455864" }
```

| 字段 | 说明 |
|------|------|
| `sinceId` | 记录最新消息 ID；刷新时仍直接请求最新一页并由数据库去重 |
| `maxId` | 内部历史游标，发送请求时映射为接口的 `max_mid` |

### 6.2 游标逻辑

```javascript
const params = { id: groupId, count }
if (maxId) {
  params.max_mid = maxId     // 加载该消息之前的历史消息
}
// 刷新或首次加载（无游标）：不传 max_mid，获取最新消息
```

### 6.3 去重策略

FeedFlow 主程序通过 `externalId`（消息 `id` 字段）在 `items` 表中 upsert，天然去重。

---

## 7. 错误处理

| 错误码 | 含义 | 处理策略 |
|--------|------|----------|
| `21297` | 参数错误（如缺少 `id`） | 检查配置，提示用户重新选择群聊 |
| `21299` | 缺少 `source` 参数（appkey） | 仅影响 `query.json`，不影响核心接口 |
| `21211` | 不支持 POST 方法 | 确保使用 GET 方法 |
| `20099` | 无权限访问 | 检查用户是否仍在群中 |
| HTTP 403 | Cookie 过期 | 抛出明确错误，提示用户重新登录 weibo.com |
| 网络错误 | DNS/超时 | 重试 1 次后跳过本次刷新 |

```javascript
// API 响应中的错误格式
{
  "result": false,
  "request": "/groupchat/query_messages.json",
  "error_code": 21297,
  "error": "invalid parameter: id is required!"
}
```

---

## 8. 风险与注意事项

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Cookie 过期 | 无法拉取数据 | 检测 HTTP 403 或 `result: false` 后通知用户重新配置凭据 |
| API 限流 | 临时中断 | 默认 2-3 分钟刷新间隔；退避重试 |
| 消息类型复杂 | 非文本消息展示异常 | 仅展示 `type=321` 的文本消息，其他类型过滤 |
| 群成员变更 | 群信息变化 | 群列表缓存 5 分钟，定期刷新 |
| SSL 证书 | `api.weibo.com` 在 Node.js 中可能需 CA 配置 | Electron 环境中正常；纯 Node 测试需 `--use-system-ca` |
| 微博 API 变更 | 插件失效 | 数据映射层隔离，只需修改 mapping 函数 |

---

## 9. 实施计划

### Phase 1: 核心插件

- [ ] 创建 `plugins/weibo-group-chat/` 目录结构
- [ ] 实现 `group-api.js`：HTTPS 封装 + 群列表/消息接口
- [ ] 实现 `plugin.js`：fetchItems + 数据映射 + 游标分页
- [ ] 实现 `auth.js`：Cookie 验证（复用现有逻辑）
- [ ] 创建 `package.json`：插件元数据

### Phase 2: 配置 UI

- [ ] 扩展 `SourceConfigForm` 支持 `select` 类型字段的动态选项加载
- [ ] 实现选择凭据后自动加载群列表
- [ ] 测试配置流程：选择凭据 → 加载群列表 → 选择群聊 → 保存

### Phase 3: 测试与完善

- [ ] 端到端测试：配置源 → 刷新 → 加载更多 → 验证消息展示
- [ ] 消息类型过滤验证
- [ ] 游标分页验证
- [ ] 错误处理验证（Cookie 过期、网络错误等）
- [ ] 文档与注释

---

## 附录

### A. 参考链接

- [微博聊天网页版](https://api.weibo.com/chat/)
- [微博开放平台 API 文档](https://open.weibo.com/wiki/API)
- [FeedFlow 微博关注流插件设计文档](./design-weibo-plugin.md)
- [FeedFlow X 插件设计文档](./design-x-plugin.md)

### B. API 验证原始数据

以下为使用 FeedFlow 数据库中的微博 Cookie 进行实际 API 调用的验证结果：

**验证时间**: 2026-07-29
**验证账号**: 角蚁（UID: 1934183965）
**已加入群数**: 2

| 接口 | 状态 | 结果 |
|------|------|------|
| `query_join_groups.json` | ✅ 200 | 返回 2 个群聊（西医养生俱乐部等） |
| `query_messages.json?id=5211500894489005` | ✅ 200 | 返回 20 条消息，含发送者、内容、时间戳 |
| `query_config.json` | ✅ 200 | 返回配置信息 |
| `query_messages.json` (无 `id`) | ❌ 21297 | `id is required` |
| `query.json` (无 `source`) | ❌ 21299 | `source paramter(appkey) is missing` |
| `batch_query_messages.json` | ❌ 20099 | 无权限访问 |

### C. 消息类型参考

从 JS Bundle 中发现的消息类型（`type` 字段）：

| type | 说明 |
|------|------|
| `321` | 普通文本消息 |
| 其他 | 系统通知、入群/退群、公告等 |

建议仅展示 `type=321` 的消息，其他类型可根据需要后续扩展。
