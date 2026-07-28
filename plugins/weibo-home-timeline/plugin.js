/**
 * plugin.js — 微博关注信息流插件（免费版 v4.0，基于 weibo.com AJAX API）
 *
 * 通过 weibo.com 的 AJAX JSON API 直接获取关注信息流。
 * 无需 OAuth、无需 App Key/Secret、完全免费、无需手动配置 UID。
 * 仅需用户提供 weibo.com 的浏览器 Cookie，插件自动获取关注流。
 *
 * 数据来源: https://weibo.com (微博桌面版 AJAX 接口)
 * 认证方式: Cookie (用户从浏览器登录后复制)
 *
 * 核心接口:
 *   - /ajax/feed/unreadfriendstimeline — 关注时间线（一次调用获取整个关注流）
 *   - /ajax/statuses/mymblog — 单用户微博（备用方案）
 *
 * v4.0 改进: 使用 unreadfriendstimeline 接口，1 次 API 调用替代 47+ 次调用，
 *           大幅提升性能并避免触发限流。
 */

const {
  fetchFriendsTimeline,
  fetchAllGroups,
  extractAllFollowListId,
  fetchUserBlogs,
  extractStatuses
} = require('./weibo-api')
const { verifyCookie } = require('./auth')

// ============================================================
// Plugin Metadata
// ============================================================

const meta = {
  id: 'feedflow-plugin-weibo',
  name: '微博关注流',
  version: '4.0.0',
  description: '免费自动获取微博关注信息流（基于 weibo.com AJAX API，无需 OAuth）',
  author: 'FeedFlow',
  color: '#E6162D'
}

// ============================================================
// Config Schema
// ============================================================

const configSchema = [
  {
    key: 'cookie',
    label: '微博 Cookie',
    type: 'text-area',
    required: true,
    placeholder: '从 weibo.com 浏览器登录后，在 DevTools → Network 中复制 Cookie',
    helpText: '登录 https://weibo.com 后，按 F12 → Network → 刷新页面 → 点击任意请求 → 复制 Cookie 字段的值。插件会自动获取你的关注信息流。'
  },
  {
    key: 'count',
    label: '每次获取条数',
    type: 'number',
    default: 20,
    min: 1,
    max: 50,
    helpText: '单次刷新获取的微博数量'
  }
]

// ============================================================
// 缓存（避免重复 API 调用）
// ============================================================

let cachedListId = null
let listIdCacheTime = 0
const LIST_ID_CACHE_TTL = 60 * 60 * 1000 // list_id 缓存 1 小时

// ============================================================
// 数据映射
// ============================================================

function mapStatusToItem(status) {
  const user = status.user || {}
  const mid = status.mid || status.idstr || String(status.id)

  // 提取图片 URL
  const mediaUrls = []
  if (status.pic_ids && Array.isArray(status.pic_ids)) {
    for (const picId of status.pic_ids) {
      mediaUrls.push(`https://wx1.sinaimg.cn/large/${picId}.jpg`)
    }
  }
  if (mediaUrls.length === 0 && status.pic_urls && Array.isArray(status.pic_urls)) {
    for (const pic of status.pic_urls) {
      if (pic.thumbnail_pic) {
        mediaUrls.push(pic.thumbnail_pic.replace('/thumbnail/', '/large/'))
      }
    }
  }
  if (mediaUrls.length === 0 && status.original_pic) mediaUrls.push(status.original_pic)
  if (mediaUrls.length === 0 && status.bmiddle_pic) mediaUrls.push(status.bmiddle_pic)

  // 处理转发微博
  let displayText = status.text || ''
  if (status.retweeted_status) {
    const rtUser = status.retweeted_status.user
    const rtName = rtUser ? `@${rtUser.screen_name}` : ''
    const rtText = status.retweeted_status.text || ''
    displayText += `\n\n//${rtName}: ${rtText}`
  }

  return {
    externalId: status.idstr || String(status.id),
    author: {
      name: user.screen_name || 'unknown',
      avatarUrl: user.avatar_large || user.profile_image_url || '',
      profileUrl: user.id ? `https://weibo.com/u/${user.id}` : ''
    },
    content: {
      text: stripHtml(displayText) || '',
      html: displayText
    },
    mediaUrls,
    permalink: user.id && mid ? `https://weibo.com/${user.id}/${mid}` : '',
    publishedAt: parseWeiboDate(status.created_at),
    metadata: {
      repostsCount: status.reposts_count || 0,
      commentsCount: status.comments_count || 0,
      attitudesCount: status.attitudes_count || 0,
      source: stripHtml(status.source || ''),
      isRetweet: !!status.retweeted_status
    }
  }
}

function parseWeiboDate(dateStr) {
  if (!dateStr) return new Date().toISOString()
  if (dateStr === '刚刚') return new Date().toISOString()

  const minMatch = dateStr.match(/(\d+)分钟前/)
  if (minMatch) return new Date(Date.now() - parseInt(minMatch[1]) * 60000).toISOString()

  const hourMatch = dateStr.match(/(\d+)小时前/)
  if (hourMatch) return new Date(Date.now() - parseInt(hourMatch[1]) * 3600000).toISOString()

  const todayMatch = dateStr.match(/今天\s*(\d{1,2}):(\d{2})/)
  if (todayMatch) {
    const d = new Date()
    d.setHours(parseInt(todayMatch[1]), parseInt(todayMatch[2]), 0, 0)
    return d.toISOString()
  }

  const yesterdayMatch = dateStr.match(/昨天\s*(\d{1,2}):(\d{2})/)
  if (yesterdayMatch) {
    const d = new Date(Date.now() - 86400000)
    d.setHours(parseInt(yesterdayMatch[1]), parseInt(yesterdayMatch[2]), 0, 0)
    return d.toISOString()
  }

  const dateMatch = dateStr.match(/^(\d{1,2})-(\d{1,2})$/)
  if (dateMatch) {
    const d = new Date()
    d.setMonth(parseInt(dateMatch[1]) - 1, parseInt(dateMatch[2]))
    d.setHours(0, 0, 0, 0)
    return d.toISOString()
  }

  const d = new Date(dateStr)
  if (!isNaN(d.getTime())) return d.toISOString()
  return new Date().toISOString()
}

function stripHtml(html) {
  if (!html) return ''
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}

// ============================================================
// fetchItems — 核心拉取逻辑
// ============================================================

/**
 * 获取微博关注信息流
 *
 * 主方案: 使用 unreadfriendstimeline 接口（1 次调用获取整个关注流）
 *
 * 游标格式:
 *   - sinceId: 增量刷新，获取比此 ID 更新的微博
 *   - maxId: 向下翻页，获取比此 ID 更旧的微博
 *
 * @param {SourceConfig} config - 用户配置
 * @param {string|null} cursor  - 分页游标 JSON: {"sinceId":"...","maxId":"..."}
 * @returns {Promise<FetchResult>}
 */
async function fetchItems(config, cursor) {
  const cookie = config.cookie
  if (!cookie) {
    throw new Error('微博 Cookie 未配置。请在源设置中填入 weibo.com 的 Cookie。')
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

  // 获取 list_id (缓存 1 小时)
  const now = Date.now()
  if (!cachedListId || (now - listIdCacheTime) > LIST_ID_CACHE_TTL) {
    try {
      const groupsResponse = await fetchAllGroups(cookie)
      cachedListId = extractAllFollowListId(groupsResponse)
      listIdCacheTime = now
    } catch (err) {
      console.warn('[weibo] Failed to fetch allGroups:', err.message)
    }
  }

  // 构建 API 参数: max_id 优先 (加载更旧的微博)，否则用 since_id (增量刷新)
  const params = { count, refresh: 4 }
  if (maxId) {
    params.max_id = maxId
  } else {
    params.since_id = sinceId || '0'
  }
  if (cachedListId) {
    params.list_id = cachedListId
  }

  try {
    const response = await fetchFriendsTimeline(cookie, params)
    const statuses = extractStatuses(response)

    if (statuses.length > 0 || response?.ok === 1) {
      const items = statuses.map(mapStatusToItem)

      // 新游标: 保留最大的 sinceId，更新最小的 maxId
      const newestId = response?.since_id_str || response?.since_id ||
        (statuses.length > 0 ? (statuses[0].idstr || String(statuses[0].id)) : null)
      const oldestId = statuses.length > 0
        ? (statuses[statuses.length - 1].idstr || String(statuses[statuses.length - 1].id))
        : maxId

      const nextCursor = JSON.stringify({
        sinceId: sinceId || newestId || '',
        maxId: oldestId || ''
      })

      return { items, nextCursor }
    }
  } catch (err) {
    console.warn('[weibo] unreadfriendstimeline failed:', err.message)
  }

  throw new Error(
    '关注时间线接口暂时不可用。请稍后重试，或检查 Cookie 是否仍然有效。'
  )
}

// ============================================================
// 生命周期
// ============================================================

async function onRegister(ctx) {
  ctx.logger.info('[weibo] 微博关注流插件 (weibo.com AJAX) 已注册')
}

// ============================================================
// 导出
// ============================================================

const weiboPlugin = {
  meta,
  configSchema,
  fetchItems,
  onRegister
}

module.exports = {
  default: weiboPlugin,
  verifyCookie
}
