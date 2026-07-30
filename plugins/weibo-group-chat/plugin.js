/**
 * plugin.js — 微博群聊插件（基于 api.weibo.com 群聊 API）
 *
 * 通过 api.weibo.com 的群聊 JSON API 获取已加入群聊的最新消息。
 * 无需 OAuth、无需 App Key/Secret、完全免费。
 * 仅需用户提供 weibo.com 的浏览器 Cookie，插件自动获取群聊消息。
 *
 * 数据来源: https://api.weibo.com/chat (微博聊天网页版 AJAX 接口)
 * 认证方式: Cookie (用户从浏览器登录后复制)
 *
 * 核心接口:
 *   - /webim/groupchat/query_join_groups.json — 已加入群列表
 *   - /webim/groupchat/query_messages.json — 群聊消息
 */

const {
  fetchJoinGroups,
  fetchGroupMessages,
  ApiError
} = require('./group-api')
const { verifyCookie } = require('./auth')

// 微博聊天的 appkey，用于 msget 接口的 source 参数。
// 注意：source 必须是 appkey，不能是用户 UID，否则接口返回 400 "auth failed!"。
const WEIBO_CHAT_APPKEY = '202088835'

// ============================================================
// Plugin Metadata
// ============================================================

const meta = {
  id: 'feedflow-plugin-weibo-group-chat',
  name: '微博群聊',
  version: '1.0.0',
  description: '获取微博群聊中的最新消息（基于 api.weibo.com 群聊 API，无需 OAuth）',
  author: 'FeedFlow',
  color: '#E6162D',
  feedType: 'group-chat',
  provider: 'weibo',
  providerName: '微博'
}

// ============================================================
// Config Schema
// ============================================================

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
    options: [] // 运行时通过 listGroups API 动态加载
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

// ============================================================
// 缓存（避免重复 API 调用）
// ============================================================

let cachedGroups = null
let groupsCacheTime = 0
const GROUPS_CACHE_TTL = 5 * 60 * 1000 // 群列表缓存 5 分钟

// ============================================================
// 数据映射
// ============================================================

/**
 * 将群聊消息映射为 FeedFlow TimelineItem
 *
 * @param {object} message - 群聊消息对象
 * @param {object|null} group - 群信息对象（用于 permalink 和群名称）
 * @returns {TimelineItem}
 */
function mapMessageToItem(message, group) {
  const fromUser = message.from_user || {}
  const messageId = String(message.id)

  const rawText = message.content || ''

  // 提取图片 URL：从消息各字段中提取
  const mediaUrls = extractImageUrls(message, rawText)

  // 发送者主页 URL
  let profileUrl = ''
  if (fromUser.profile_url) {
    profileUrl = `https://weibo.com/${fromUser.profile_url}`
  } else if (fromUser.id) {
    profileUrl = `https://weibo.com/u/${fromUser.id}`
  }

  return {
    externalId: messageId,
    author: {
      name: fromUser.screen_name || 'unknown',
      avatarUrl: fromUser.avatar_large || fromUser.profile_image_url || '',
      profileUrl
    },
    content: {
      text: rawText,
      html: rawText
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

// ============================================================
// 内容处理：emoji、链接、图片
// ============================================================

/**
 * 从消息中提取图片 URL
 * 1. 从消息内容中提取图片直链（.jpg/.png 等）
 * 2. 从特定图片字段（pic_url、media_url 等）提取图片 URL
 * 不扫描用户信息字段，不提取非图片 URL
 */
function extractImageUrls(message, rawText) {
  // 纯文本消息（media_type === 0）不提取图片，保持 mediaUrls 为空
  if (message.media_type === 0) return []

  const urls = []
  const imageRegex = /https?:\/\/[^\s"'<>\\]+\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?[^\s"'<>]*)?/gi

  // 从内容中提取图片直链
  const contentMatches = (rawText || '').match(imageRegex)
  if (contentMatches) urls.push(...contentMatches)

  // 从特定图片字段提取（pic_url、media_url、pic_ids、pic_info 等）
  const IMAGE_FIELDS = ['pic_url', 'pic_urls', 'media_url', 'media_urls', 'image_url', 'image_urls', 'photo_url', 'photo_urls', 'thumbnail_url', 'original_url', 'large_url', 'middle_url', 'small_url', 'pic_info', 'pic_infos']

  // pic_ids 是图片 ID 数组，需要拼接为完整 URL
  if (message.pic_ids && Array.isArray(message.pic_ids)) {
    for (const picId of message.pic_ids) {
      if (typeof picId === 'string' && picId) {
        urls.push(`https://wx1.sinaimg.cn/large/${picId}.jpg`)
      }
    }
  }

  // fids 是图片 ID 数组，通过微博 msget 接口获取图片
  // 注意：msget 接口的 source 参数必须是微博聊天的 appkey，
  // 而不是用户 UID。使用 UID 会导致接口返回 400 "auth failed!"。
  if (message.fids) {
    const fids = Array.isArray(message.fids) ? message.fids : [message.fids]
    const ts = Date.now()
    for (const fid of fids) {
      if (fid !== null && fid !== undefined) {
        const fidStr = String(fid)
        if (fidStr) {
          const params = new URLSearchParams({
            fid: fidStr,
            imageType: 'origin',
            ts: String(ts),
            source: WEIBO_CHAT_APPKEY
          })
          urls.push(`https://upload.api.weibo.com/2/mss/msget?${params.toString()}`)
        }
      }
    }
  }

  // pic_infos 是图片信息对象数组，包含不同尺寸的 URL
  if (message.pic_infos && Array.isArray(message.pic_infos)) {
    for (const picInfo of message.pic_infos) {
      if (picInfo && typeof picInfo === 'object') {
        // 优先取 largest/original，其次 large，其次 middle
        const url = picInfo.largest || picInfo.original || picInfo.large || picInfo.middle || picInfo.url || picInfo.thumbnail
        if (url && typeof url === 'string' && url.startsWith('http')) {
          urls.push(url)
        }
      }
    }
  }

  for (const field of IMAGE_FIELDS) {
    if (message[field]) {
      const val = message[field]
      if (typeof val === 'string') {
        const m = val.match(imageRegex)
        if (m) urls.push(...m)
      } else if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === 'string') {
            const m = item.match(imageRegex)
            if (m) urls.push(...m)
          } else if (item && typeof item === 'object') {
            for (const subVal of Object.values(item)) {
              if (typeof subVal === 'string') {
                const m = subVal.match(imageRegex)
                if (m) urls.push(...m)
              }
            }
          }
        }
      }
    }
  }

  // 过滤掉头像 URL
  const filtered = urls.filter(u => !/avatar|profile/i.test(u))

  // 去重：同一图片 fid 只保留一个版本
  const imageMap = new Map()
  for (const url of filtered) {
    const fidMatch = url.match(/[?&]fid=([^&]+)/)
    const idMatch = url.match(/\/([^/]+)\.(jpg|jpeg|png|gif|webp)/i)
    const imageId = fidMatch ? fidMatch[1] : (idMatch ? idMatch[1] : url)
    const sizeMatch = url.match(/\/crop\.\d+\.\d+\.\d+\.\d+\.(\d+)\//)
    const size = sizeMatch ? parseInt(sizeMatch[1], 10) : 0

    if (!imageMap.has(imageId) || size > imageMap.get(imageId).size) {
      imageMap.set(imageId, { url, size })
    }
  }

  return [...imageMap.values()].map(v => v.url)
}

// ============================================================
// 辅助函数
// ============================================================

function compareMessageIds(leftId, rightId) {
  const left = String(leftId).replace(/^0+/, '') || '0'
  const right = String(rightId).replace(/^0+/, '') || '0'
  if (left.length !== right.length) return left.length - right.length
  return left.localeCompare(right)
}

/**
 * 获取群信息（带缓存）
 *
 * @param {string} cookie - weibo.com Cookie
 * @param {string} groupId - 群 ID
 * @returns {Promise<object|null>} 群信息对象，未找到返回 null
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

// ============================================================
// fetchItems — 核心拉取逻辑
// ============================================================

/**
 * 获取微博群聊消息
 *
 * 游标格式:
 *   - sinceId: 增量刷新，获取比此 ID 更新的消息
 *   - maxId: 向下翻页，获取比此 ID 更旧的消息
 *
 * @param {SourceConfig} config - 用户配置
 * @param {string|null} cursor  - 分页游标 JSON: {"sinceId":"...","maxId":"..."}
 * @returns {Promise<FetchResult>}
 */
async function fetchItems(config, cursor) {
  const cookie = config.cookie
  if (!cookie) {
    throw new Error('微博 Cookie 未配置。请在源设置中选择或创建微博凭据。')
  }

  const groupId = config.group_id
  if (!groupId) {
    throw new Error('未填写群聊 ID。请在源设置中填写要接入的微博群聊 ID。')
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
      sinceId = cursor // 兼容旧格式: 纯数字 ID
    }
  }

  // 获取群信息（用于消息映射）
  const group = await getGroupInfo(cookie, groupId)

  // 微博聊天网页使用 max_mid 加载历史消息；max_id/since_id 会被此接口忽略。
  // 刷新不传游标，直接获取最新一页并由数据库 upsert 去重。
  const params = { id: groupId, count }
  if (maxId) {
    params.max_mid = maxId
  }

  try {
    const response = await fetchGroupMessages(cookie, params)
    const allMessages = response.messages || []

    // 仅保留文本消息 (type === 321)，过滤系统通知等
    const messages = allMessages.filter(m => m.type === 321)

    if (allMessages.length === 0 && response.result === true) {
      // API 已经没有下一页，保持当前游标。
      return { items: [], nextCursor: cursor }
    }

    const items = messages.map(m => mapMessageToItem(m, group))

    // 展示层会过滤系统消息，但翻页边界必须基于完整响应，否则遇到一页
    // 全是系统消息时游标不会前进。消息 ID 超过 Number 安全范围，按字符串比较。
    const newestMessage = allMessages.reduce((latest, message) =>
      !latest || compareMessageIds(message.id, latest.id) > 0 ? message : latest
    , null)
    const oldestMessage = allMessages.reduce((oldest, message) =>
      !oldest || compareMessageIds(message.id, oldest.id) < 0 ? message : oldest
    , null)
    const newestId = newestMessage ? String(newestMessage.id) : null
    const oldestId = oldestMessage ? String(oldestMessage.id) : null

    const nextCursor = JSON.stringify({
      sinceId: sinceId || newestId || '',   // 保留最高 sinceId
      maxId: oldestId || ''                 // 更新到最旧消息 ID
    })

    return { items, nextCursor }
  } catch (err) {
    if (err instanceof ApiError && (err.code === 403 || err.code === -100)) {
      throw new Error('Cookie 已过期或无效，请重新登录 weibo.com 获取新 Cookie。')
    }
    console.warn('[weibo-group-chat] fetchItems failed:', err.message)
    throw new Error(
      `群聊消息接口暂时不可用: ${err.message}。请稍后重试，或检查 Cookie 是否仍然有效。`
    )
  }
}

// ============================================================
// 群列表获取（供配置表单动态加载选项）
// ============================================================

/**
 * 获取当前用户已加入的群列表，用于配置表单的下拉选择
 *
 * @param {string} cookie - weibo.com Cookie（已解密的原始值）
 * @returns {Promise<{label: string, value: string}[]>} 选项列表
 */
async function listGroups(cookie) {
  if (!cookie) return []
  try {
    const response = await fetchJoinGroups(cookie)
    const groups = response.join_groups || []
    return groups.map((g) => ({
      label: g.name || `群聊 ${g.id}`,
      value: String(g.id)
    }))
  } catch (err) {
    console.warn('[weibo-group-chat] Failed to list groups:', err.message)
    return []
  }
}

// ============================================================
// 生命周期
// ============================================================

async function onRegister(ctx) {
  ctx.logger.info('[weibo-group-chat] 微博群聊插件 (api.weibo.com) 已注册')
}

// ============================================================
// 导出
// ============================================================

const weiboGroupChatPlugin = {
  meta,
  configSchema,
  fetchItems,
  onRegister
}

module.exports = {
  default: weiboGroupChatPlugin,
  verifyCookie,
  listGroups
}
