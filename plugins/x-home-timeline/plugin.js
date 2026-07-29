/**
 * plugin.js — X（Twitter）关注信息流插件（免费版 v1.0，基于 x.com GraphQL API）
 *
 * 通过 x.com 的 GraphQL JSON API 直接获取关注信息流。
 * 无需 OAuth、无需 App Key/Secret、完全免费、无需手动配置 UID。
 * 仅需用户提供 x.com 的浏览器 Cookie，插件自动获取关注流。
 *
 * 数据来源: https://x.com (X 桌面版 GraphQL 接口)
 * 认证方式: Cookie (用户从浏览器登录后复制)
 *
 * 核心接口:
 *   - HomeLatestTimeline — 关注时间线（"关注" 标签页，一次调用获取整个关注流）
 *   - HomeTimeline — 推荐时间线（"为你推荐" 标签页）
 *   - Viewer — 当前用户信息（验证 Cookie 有效性）
 *
 * v1.0 特点: 使用 GraphQL API，1 次 API 调用替代逐个用户拉取，
 *           大幅提升性能并避免触发限流。
 */

const {
  fetchHomeTimeline,
  fetchViewer,
  extractTweets,
  extractNextCursor,
  extractViewerInfo,
  getCookieValue,
  sanitizeCookie
} = require('./x-api')
const { verifyCookie } = require('./auth')

// ============================================================
// Plugin Metadata
// ============================================================

const meta = {
  id: 'feedflow-plugin-x',
  name: 'X 关注流',
  version: '1.0.0',
  description: '免费自动获取 X（Twitter）关注信息流（基于 x.com GraphQL API，无需 OAuth）',
  author: 'FeedFlow',
  color: '#1DA1F2'
}

// ============================================================
// Config Schema
// ============================================================

const configSchema = [
  {
    key: 'cookie',
    label: 'X 凭据',
    type: 'credential',
    required: true,
    helpText: '选择一个已保存的 X Cookie 凭据，或创建新凭据。凭据可在多个信息源间复用（如「关注」和「推荐」流），无需重复粘贴。'
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
  },
  {
    key: 'homeLatestTimelineOpId',
    label: '关注流 Operation ID',
    type: 'text',
    default: '',
    placeholder: '留空使用内置默认值',
    helpText: 'X.com 的 GraphQL operation ID 会随前端更新而变化。如果刷新报 404 "Query not found"，需要更新此 ID。获取方法：浏览器登录 x.com → F12 → Network → 过滤 "HomeLatestTimeline" → 点击请求 → URL 中 /graphql/ 和 /HomeLatestTimeline 之间的字符串即为 operation ID。'
  },
  {
    key: 'homeTimelineOpId',
    label: '推荐流 Operation ID',
    type: 'text',
    default: '',
    placeholder: '留空使用内置默认值',
    helpText: '同上，对应 "为你推荐" 流。Network 中过滤 "HomeTimeline"（不含 Latest）。'
  },
  {
    key: 'viewerOpId',
    label: 'Viewer Operation ID',
    type: 'text',
    default: '',
    placeholder: '留空使用内置默认值',
    helpText: '用于验证 Cookie 有效性。Network 中过滤 "Viewer"。'
  }
]

// ============================================================
// 数据映射
// ============================================================

/**
 * 从推文对象中提取用户信息，兼容多种 X.com API 结构
 *
 * X.com 频繁更改用户数据结构，当前（2025）结构为：
 *   tweet.core.user_results.result: {
 *     __typename: "User",
 *     avatar: { image_url: "https://..." },
 *     core: { created_at, name, screen_name },
 *     id: "...",
 *     legacy: { default_profile, description, ... }
 *   }
 *
 * 同时兼容旧结构：
 *   1. result.legacy.{screen_name, name, profile_image_url_https}  (旧结构)
 *   2. result.core.{screen_name, name} + result.avatar.image_url    (新结构)
 *   3. result.{screen_name, name, profile_image_url_https}           (无包装)
 *   4. result.{screenName, name, profileImageUrlHttps}               (驼峰命名)
 *   5. tweet.legacy.user.legacy.{...}                               (更旧结构)
 */
function extractUserInfo(tweet) {
  const userResult = tweet?.core?.user_results?.result
  const userLegacy = userResult?.legacy
  const userCore = userResult?.core
  const userAvatar = userResult?.avatar
  const legacyUser = tweet?.legacy?.user?.legacy

  // screen_name: 新结构在 result.core.screen_name，旧结构在 result.legacy.screen_name
  const screenName =
    userCore?.screen_name ||
    userLegacy?.screen_name ||
    userResult?.screen_name ||
    userResult?.screenName ||
    legacyUser?.screen_name ||
    ''

  // name: 新结构在 result.core.name，旧结构在 result.legacy.name
  const displayName =
    userCore?.name ||
    userLegacy?.name ||
    userResult?.name ||
    legacyUser?.name ||
    screenName ||
    'unknown'

  // 头像: 新结构在 result.avatar.image_url，旧结构在 result.legacy.profile_image_url_https
  const avatarUrl =
    userAvatar?.image_url ||
    userLegacy?.profile_image_url_https ||
    userResult?.profile_image_url_https ||
    userResult?.profileImageUrlHttps ||
    legacyUser?.profile_image_url_https ||
    ''

  // 用户 ID: 新结构用 result.id，旧结构用 result.rest_id
  const userId =
    userResult?.id ||
    userResult?.rest_id ||
    userResult?.restId ||
    legacyUser?.rest_id ||
    ''

  return { screenName, displayName, avatarUrl, userId }
}

// 用于诊断：是否已打印过推文结构（避免刷屏）
let loggedTweetStructure = false

/**
 * 将 X.com 推文对象映射为 FeedFlow TimelineItem
 *
 * 推文结构 (GraphQL):
 * {
 *   rest_id: "123",
 *   legacy: {
 *     full_text: "推文内容",
 *     created_at: "Wed Jul 27 12:00:00 +0000 2026",
 *     entities: { media: [...] },
 *     retweeted_status_result: { result: {...} },
 *     quoted_status_result: { result: {...} }
 *   },
 *   core: { user_results: { result: { rest_id, legacy: { screen_name, name, ... } } } }
 * }
 */
function mapTweetToItem(tweet) {
  // 诊断：打印第一条推文的结构，帮助定位用户数据路径变化
  if (!loggedTweetStructure) {
    loggedTweetStructure = true
    console.log('[x-plugin] 第一条推文结构 (顶层字段):', Object.keys(tweet || {}))
    console.log('[x-plugin] core.user_results.result:', (JSON.stringify(tweet?.core?.user_results?.result, null, 2) ?? '').slice(0, 800))
    console.log('[x-plugin] legacy.user:', (JSON.stringify(tweet?.legacy?.user, null, 2) ?? '').slice(0, 400))
  }

  const legacy = tweet.legacy || {}
  const { screenName, displayName, avatarUrl, userId } = extractUserInfo(tweet)

  // 提取图片/视频 URL
  const mediaUrls = extractMediaUrls(legacy)

  // 处理转发推文 (retweet)
  let displayText = legacy.full_text || ''
  const retweetResult = legacy.retweeted_status_result?.result
  if (retweetResult) {
    const rtUser = extractUserInfo(retweetResult)
    const rtName = rtUser.screenName ? `@${rtUser.screenName}` : ''
    const rtText = retweetResult.legacy?.full_text || ''
    displayText = `🔁 ${rtName}:\n${rtText}`
  }

  // 处理引用推文 (quote)
  const quoteResult = legacy.quoted_status_result?.result
  if (quoteResult && !retweetResult) {
    const quoteUser = extractUserInfo(quoteResult)
    const quoteName = quoteUser.screenName ? `@${quoteUser.screenName}` : ''
    const quoteText = quoteResult.legacy?.full_text || ''
    displayText += `\n\n📎 ${quoteName}:\n${quoteText}`
  }

  const tweetId = tweet.rest_id || legacy.id_str || ''
  const permalink = userId && tweetId ? `https://x.com/${screenName}/status/${tweetId}` : ''

  return {
    externalId: tweetId,
    author: {
      name: displayName,
      avatarUrl,
      profileUrl: screenName ? `https://x.com/${screenName}` : ''
    },
    content: {
      text: stripHtml(displayText) || '',
      html: displayText
    },
    mediaUrls,
    permalink,
    publishedAt: parseXDate(legacy.created_at),
    metadata: {
      retweetCount: legacy.retweet_count || 0,
      favoriteCount: legacy.favorite_count || 0,
      replyCount: legacy.reply_count || 0,
      quoteCount: legacy.quote_count || 0,
      isRetweet: !!retweetResult,
      isQuote: !!quoteResult && !retweetResult,
      lang: legacy.lang || '',
      source: stripHtml(typeof legacy.source === 'string' ? legacy.source : '')
    }
  }
}

/**
 * 从推文 legacy.entities.media 中提取媒体 URL（图片和视频缩略图）
 */
function extractMediaUrls(legacy) {
  const mediaUrls = []
  const media = legacy.entities?.media
  if (!Array.isArray(media)) return mediaUrls

  for (const m of media) {
    if (m.type === 'photo' && m.media_url_https) {
      // 使用大图（:large 后缀获取最佳质量）
      mediaUrls.push(`${m.media_url_https}:large`)
    } else if (m.type === 'video' && m.media_url_https) {
      // 视频使用缩略图
      mediaUrls.push(m.media_url_https)
    } else if (m.type === 'animated_gif' && m.media_url_https) {
      mediaUrls.push(m.media_url_https)
    }
  }

  // 如果扩展实体中有更高质量的图片，使用之
  const extendedMedia = legacy.extended_entities?.media
  if (Array.isArray(extendedMedia)) {
    for (let i = 0; i < extendedMedia.length && i < mediaUrls.length; i++) {
      const em = extendedMedia[i]
      if (em.type === 'photo' && em.media_url_https) {
        mediaUrls[i] = `${em.media_url_https}:large`
      }
    }
  }

  return mediaUrls
}

/**
 * 解析 X.com 推文日期
 *
 * X.com 返回的时间格式为: "Wed Jul 27 12:00:00 +0000 2026"
 */
function parseXDate(dateStr) {
  if (!dateStr) return new Date().toISOString()

  const d = new Date(dateStr)
  if (!isNaN(d.getTime())) return d.toISOString()

  // 兜底：返回当前时间
  return new Date().toISOString()
}

function stripHtml(html) {
  if (!html || typeof html !== 'string') return ''
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
 * 获取 X（Twitter）关注信息流
 *
 * 使用 HomeLatestTimeline 接口（1 次调用获取整个关注流）
 *
 * @param {SourceConfig} config - 用户配置
 * @param {string|null} cursor  - 分页游标 (X.com GraphQL cursor)
 * @returns {Promise<FetchResult>}
 */
async function fetchItems(config, cursor) {
  const cookie = config.cookie
  if (!cookie) {
    throw new Error('X Cookie 未配置。请在源设置中填入 x.com 的 Cookie。')
  }

  // 检查 Cookie 中是否包含关键字段 auth_token（登录态的核心凭证）
  const cleanCookie = sanitizeCookie(cookie)
  const authToken = getCookieValue(cleanCookie, 'auth_token')
  const ct0 = getCookieValue(cleanCookie, 'ct0')
  if (!authToken) {
    throw new Error(
      'Cookie 中缺少 auth_token 字段。请确保从已登录的 x.com 浏览器中复制完整的 Cookie（F12 → Network → 复制请求头中的 Cookie 字段完整值）。'
    )
  }
  if (!ct0) {
    console.warn('[x-plugin] Cookie 中缺少 ct0 字段，请求可能会被拒绝')
  }

  // 确保 count 为数字（配置表单可能返回字符串）
  const count = Math.min(Number(config.count) || 20, 50)
  const feedType = config.feedType || 'following'

  // X.com GraphQL cursor 直接使用字符串格式，无需 JSON 包装
  // 但为了与 FeedFlow 的游标机制兼容，支持 JSON 格式
  let graphqlCursor = null
  if (cursor) {
    try {
      const cursorObj = JSON.parse(cursor)
      graphqlCursor = cursorObj.cursor || cursor
    } catch {
      graphqlCursor = cursor // 兼容纯字符串游标
    }
  }

  const params = {
    count,
    cursor: graphqlCursor,
    feedType,
    opId: feedType === 'foryou'
      ? (config.homeTimelineOpId || undefined)
      : (config.homeLatestTimelineOpId || undefined)
  }

  console.log(`[x-plugin] fetchItems: feedType=${feedType}, count=${count}, hasCursor=${!!graphqlCursor}, opId=${params.opId || '(default)'}`)

  try {
    const response = await fetchHomeTimeline(cookie, params)
    const tweets = extractTweets(response)

    if (tweets.length > 0) {
      const items = tweets.map(mapTweetToItem)

      // 使用 API 返回的 bottom cursor 作为下一页游标
      const nextCursorValue = extractNextCursor(response)
      const nextCursor = nextCursorValue ? JSON.stringify({ cursor: nextCursorValue }) : null

      console.log(`[x-plugin] fetchItems success: ${items.length} items, hasNextCursor=${!!nextCursor}`)

      return { items, nextCursor }
    }

    // 没有获取到推文，但 API 调用成功（可能关注流为空）
    console.log('[x-plugin] fetchItems: API returned 0 tweets')
    return { items: [], nextCursor: null }
  } catch (err) {
    console.error(`[x-plugin] fetchItems error:`, err)
    if (err.code === 401 || err.code === 403) {
      throw new Error(
        'X Cookie 已过期或无效。请重新登录 x.com 获取新的 Cookie。'
      )
    }
    if (err.code === 429) {
      throw new Error('X API 请求过于频繁，请稍后重试。')
    }
    throw new Error(
      `获取 X 关注流失败: ${err.message}`
    )
  }
}

// ============================================================
// 生命周期
// ============================================================

async function onRegister(ctx) {
  ctx.logger.info('[x] X 关注流插件 (x.com GraphQL) 已注册')
}

// ============================================================
// 导出
// ============================================================

const xPlugin = {
  meta,
  configSchema,
  fetchItems,
  onRegister
}

module.exports = {
  default: xPlugin,
  verifyCookie
}
