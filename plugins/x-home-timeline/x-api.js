/**
 * x-api.js — X（Twitter）x.com GraphQL API 封装（免费版 v1）
 *
 * 使用 x.com 的 GraphQL JSON API，无需 OAuth、无需 App Key/Secret，
 * 仅需用户提供 x.com 的浏览器 Cookie 即可访问关注信息流。
 *
 * 核心接口:
 *   - 关注时间线: POST https://x.com/i/api/graphql/{opId}/HomeLatestTimeline
 *   - 推荐时间线: POST https://x.com/i/api/graphql/{opId}/HomeTimeline
 *   - 用户信息:   POST https://x.com/i/api/graphql/{opId}/Viewer
 *
 * 认证方式: 请求头中携带 Cookie (用户从 x.com 浏览器登录后复制)
 *           + 公开的 Bearer Token (x.com 网页端使用的固定令牌)
 *
 * 注意: X.com 的 GraphQL operation ID 会随前端更新而变化。
 *       本插件使用已知稳定的 operation ID，如失效可在配置中更新。
 */

const https = require('https')

const X_HOST = 'x.com'

// X.com 网页端使用的公开 Bearer Token（所有网页端用户共享）
const PUBLIC_BEARER_TOKEN =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'

// GraphQL Operation IDs（X.com 前端更新时可能变化）
// 这些是已知的备用默认值；插件会优先从 X.com 网页 JS 中动态解析最新 ID
const OPERATION_IDS = {
  // "关注" 时间线（最新推文）
  HomeLatestTimeline: '0vp2Au9doTKsbn2vIk48Dg',
  // "为你推荐" 时间线
  HomeTimeline: 'xhYBF94fPSp8ey64FfYXiA',
  // 当前登录用户信息（验证 Cookie 有效性）
  Viewer: 'k5X2qB7lgY3SjV7Hr4RcZw'
}

// 需要动态解析的 operation 名称
const RESOLVABLE_OPERATIONS = ['HomeLatestTimeline', 'HomeTimeline', 'Viewer']

// 动态解析的 operation ID 内存缓存（应用生命周期内有效）
let resolvedOperationIds = null
let resolvePromise = null

// X.com GraphQL API 所需的特性标志（与网页端保持一致）
const DEFAULT_FEATURES = {
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_high_ecc_image_preferences_enabled: false,
  responsive_web_android_navigation_blue_pill_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: true,
  responsive_web_grok_image_annotation_enabled: false,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_share_follower_count_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  communities_web_grok_restrict_summary_fetch: false,
  responsive_web_grok_restrict_summary_fetch: false,
  rweb_tipjar_consumption_enabled: true,
  responsive_web_enhance_cards_enabled: false
}

// ============================================================
// 工具函数
// ============================================================

/**
 * 清理 Cookie 值，移除 HTTP 头中的非法字符
 * （换行符、回车符等控制字符会导致 "Invalid character in header content" 错误）
 */
function sanitizeCookie(cookie) {
  if (!cookie) return ''
  return cookie.replace(/[\r\n\t]/g, '').trim()
}

/**
 * 从 Cookie 字符串中提取指定字段的值
 */
function getCookieValue(cookie, name) {
  if (!cookie) return ''
  const match = cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'))
  if (!match) return ''
  try {
    return decodeURIComponent(match[1])
  } catch {
    // Cookie 值包含无法解码的字符时，返回原始值
    return match[1]
  }
}

/** 发起 HTTPS POST 请求（带 Cookie + Bearer Token） */
function httpsPost(path, body, cookie) {
  const cleanCookie = sanitizeCookie(cookie)
  const csrfToken = getCookieValue(cleanCookie, 'ct0')

  const postData = JSON.stringify(body)

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: X_HOST,
        path,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${PUBLIC_BEARER_TOKEN}`,
          'Content-Type': 'application/json',
          'Cookie': cleanCookie,
          'x-csrf-token': csrfToken,
          'x-twitter-active-user': 'yes',
          'x-twitter-client-language': 'en',
          'x-twitter-client-type': 'web',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*',
          'Origin': 'https://x.com',
          'Referer': 'https://x.com/home'
        },
        timeout: 15000
      },
      (res) => {
        let responseBody = ''
        res.on('data', (chunk) => (responseBody += chunk))
        res.on('end', () => {
          console.log(`[x-api] ${path} -> status=${res.statusCode}, bodyLength=${responseBody.length}`)

          if (res.statusCode === 401) {
            reject(new ApiError(401, 'Cookie 已过期或无效，请重新登录 x.com 获取'))
            return
          }
          if (res.statusCode === 403) {
            reject(new ApiError(403, 'Cookie 已过期或无效，请重新登录 x.com 获取'))
            return
          }
          if (res.statusCode === 429) {
            reject(new ApiError(429, '请求过于频繁，请稍后重试'))
            return
          }

          // 非 2xx 状态码（非上述特殊状态）时记录响应体以便排查
          if (res.statusCode < 200 || res.statusCode >= 300) {
            console.error(`[x-api] Unexpected status ${res.statusCode}:`, responseBody.slice(0, 500))
            reject(new ApiError(res.statusCode, `请求失败 (HTTP ${res.statusCode})`))
            return
          }

          try {
            const json = JSON.parse(responseBody)
            if (json.errors && Array.isArray(json.errors) && json.errors.length > 0) {
              const err = json.errors[0]
              console.error(`[x-api] API error response:`, JSON.stringify(json.errors).slice(0, 500))
              reject(new ApiError(err.code || -1, err.message || 'API 返回错误'))
              return
            }
            resolve(json)
          } catch (e) {
            console.error(`[x-api] Failed to parse response body:`, responseBody.slice(0, 500))
            reject(new Error(`解析 API 响应失败: ${responseBody.slice(0, 200)}`))
          }
        })
      }
    )

    req.on('error', (err) => reject(err))
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('请求超时'))
    })

    req.write(postData)
    req.end()
  })
}

// ============================================================
// HTTPS GET 工具（用于获取 X.com 网页和 JS bundle）
// ============================================================

/**
 * 发起 HTTPS GET 请求，返回响应体文本（用于抓取 X.com 网页和 JS bundle）
 */
function httpsGet(host, path) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        path,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': '*/*'
        },
        timeout: 15000
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body)
          } else {
            reject(new Error(`GET ${host}${path} failed: HTTP ${res.statusCode}`))
          }
        })
      }
    )
    req.on('error', (err) => reject(err))
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('GET 请求超时'))
    })
    req.end()
  })
}

// ============================================================
// 动态 GraphQL Operation ID 解析器
// ============================================================

/**
 * 从 X.com 网页 JS bundle 中动态解析最新的 GraphQL operation ID。
 *
 * X.com 会定期轮换 operation ID（导致 404 "Query not found"）。
 * 此函数通过以下步骤自动获取最新 ID：
 *   1. 抓取 x.com 首页 HTML
 *   2. 从 HTML 中提取 main.{hash}.js 的 URL
 *   3. 下载 JS bundle 并用正则提取 queryId + operationName 映射
 *
 * 解析结果会缓存在内存中，应用生命周期内只抓取一次。
 *
 * @returns {Promise<Record<string, string>>} operationName -> queryId 映射
 */
async function resolveOperationIds() {
  // 如果已有缓存，直接返回
  if (resolvedOperationIds) {
    return resolvedOperationIds
  }

  // 如果正在解析中，等待同一个 Promise（避免并发重复请求）
  if (resolvePromise) {
    return resolvePromise
  }

  resolvePromise = (async () => {
    try {
      console.log('[x-api] 正在从 X.com 网页动态解析 GraphQL operation ID...')

      // 1. 抓取 x.com 首页 HTML
      const html = await httpsGet(X_HOST, '/')

      // 2. 提取 main.{hash}.js 的 URL（X.com 首页引用了客户端 JS bundle）
      const mainMatch = html.match(/\/client-web\/main\.([a-z0-9]+)\./)
      if (!mainMatch) {
        console.warn('[x-api] 未在 X.com 首页找到 main.js URL，使用备用 operation ID')
        return {}
      }

      const mainJsUrl = `https://abs.twimg.com/responsive-web/client-web/main.${mainMatch[1]}.js`
      console.log(`[x-api] 正在下载 JS bundle: main.${mainMatch[1]}.js`)

      // 3. 下载 JS bundle
      const jsContent = await httpsGet('abs.twimg.com', `/responsive-web/client-web/main.${mainMatch[1]}.js`)

      // 4. 用正则提取 queryId 和 operationName 的映射
      // X.com JS 中的格式: queryId:"xxxx",operationName:"HomeLatestTimeline"
      const ids = {}
      const regex = /queryId:"([^"]+)".+?operationName:"([^"]+)"/g
      let match
      while ((match = regex.exec(jsContent)) !== null) {
        const [, queryId, operationName] = match
        if (RESOLVABLE_OPERATIONS.includes(operationName)) {
          ids[operationName] = queryId
        }
      }

      const found = Object.keys(ids)
      console.log(`[x-api] 动态解析到 ${found.length} 个 operation ID:`, found.join(', ') || '无')

      if (found.length > 0) {
        resolvedOperationIds = ids
      }

      return ids
    } catch (err) {
      console.warn('[x-api] 动态解析 operation ID 失败，将使用备用值:', err.message)
      return {}
    } finally {
      resolvePromise = null
    }
  })()

  return resolvePromise
}

/**
 * 获取指定 operation 的最佳 ID（优先级：配置覆盖 > 动态解析 > 备用默认值）
 *
 * @param {string} operationName - operation 名称 (如 'HomeLatestTimeline')
 * @param {string} [configOverride] - 用户在配置中指定的 ID
 * @returns {Promise<string>} operation ID
 */
async function getOperationId(operationName, configOverride) {
  // 1. 用户配置覆盖（最高优先级）
  if (configOverride) {
    return configOverride
  }

  // 2. 尝试动态解析
  try {
    const resolved = await resolveOperationIds()
    if (resolved[operationName]) {
      return resolved[operationName]
    }
  } catch {
    // 解析失败时回退到备用值
  }

  // 3. 备用默认值
  return OPERATION_IDS[operationName]
}

// ============================================================
// 自定义错误类
// ============================================================

class ApiError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'XApiError'
    this.code = code
  }
}

// ============================================================
// x.com GraphQL API
// ============================================================

/**
 * 获取关注时间线（"关注" 标签页 - 已关注用户的最新推文）
 * POST https://x.com/i/api/graphql/{opId}/HomeLatestTimeline
 *
 * 一次调用即可获取整个关注流，与浏览器实际调用一致。
 *
 * @param {string} cookie    - x.com Cookie
 * @param {object} params
 * @param {number} [params.count]    - 单页条数 (默认 20)
 * @param {string} [params.cursor]   - 分页游标 (增量/翻页)
 * @param {string} [params.feedType] - "following" | "foryou"
 * @param {string} [params.opId]     - 自定义 GraphQL operation ID（覆盖默认值）
 */
async function fetchHomeTimeline(cookie, params) {
  const count = Number(params.count) || 20
  const cursor = params.cursor || null
  const feedType = params.feedType || 'following'

  const operationName = feedType === 'foryou' ? 'HomeTimeline' : 'HomeLatestTimeline'
  // 优先级：配置覆盖 > 动态解析 > 备用默认值
  const operationId = await getOperationId(operationName, params.opId)
  const path = `/i/api/graphql/${operationId}/${operationName}`

  // cursor 为 null 时不发送该字段，避免 GraphQL 端点拒绝 null 值
  const variables = {
    count,
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: false,
    withVoice: true,
    withV2Timeline: true
  }
  if (cursor) {
    variables.cursor = cursor
  }

  const body = {
    variables,
    features: DEFAULT_FEATURES,
    fieldToggles: {
      withArticlePlainText: false
    }
  }

  console.log(`[x-api] fetchHomeTimeline: operation=${operationName}, count=${count}, hasCursor=${!!cursor}`)

  return httpsPost(path, body, cookie)
}

/**
 * 获取当前登录用户信息（验证 Cookie 有效性）
 * POST https://x.com/i/api/graphql/{opId}/Viewer
 *
 * 返回结构: { data: { viewer: { rest_id, name, screen_name, ... } } }
 *
 * @param {string} cookie - x.com Cookie
 * @param {string} [opId] - 自定义 GraphQL operation ID（覆盖默认值）
 */
async function fetchViewer(cookie, opId) {
  const operationId = await getOperationId('Viewer', opId)
  const path = `/i/api/graphql/${operationId}/Viewer`

  const body = {
    variables: {},
    features: DEFAULT_FEATURES
  }

  return httpsPost(path, body, cookie)
}

// ============================================================
// 响应解析辅助
// ============================================================

/**
 * 从 GraphQL 时间线响应中提取推文列表
 *
 * 响应结构:
 * {
 *   data: {
 *     home: {
 *       home_timeline_urt: {
 *         instructions: [
 *           {
 *             type: "TimelineAddEntries",
 *             entries: [
 *               { entryId: "...", content: { entryType: "TimelineTimelineItem", itemContent: {...} } },
 *               { entryId: "cursor-bottom", content: { entryType: "TimelineTimelineCursor", value: "..." } },
 *               ...
 *             ]
 *           }
 *         ]
 *       }
 *     }
 *   }
 * }
 */
function extractTweets(response) {
  const instructions =
    response?.data?.home?.home_timeline_urt?.instructions ||
    response?.data?.home?.home_timeline?.instructions ||
    response?.data?.home?.latest_home_timeline?.instructions ||
    []

  // 诊断：如果 data.home 存在但没有找到 instructions，记录实际结构
  if (response?.data?.home && instructions.length === 0) {
    const homeKeys = Object.keys(response.data.home || {})
    console.log(`[x-api] data.home keys:`, homeKeys)
    // 尝试找到包含 instructions 的字段
    for (const key of homeKeys) {
      const val = response.data.home[key]
      if (val && Array.isArray(val.instructions)) {
        console.log(`[x-api] Found instructions in data.home.${key}`)
      }
    }
  }

  // 诊断：如果 data 存在但没有 home，记录 data 的顶层字段
  if (response?.data && !response?.data?.home) {
    console.log(`[x-api] data keys (no home):`, Object.keys(response.data || {}))
  }

  const tweets = []
  for (const instruction of instructions) {
    if (instruction.type === 'TimelineAddEntries' && Array.isArray(instruction.entries)) {
      for (const entry of instruction.entries) {
        const tweet = extractTweetFromEntry(entry)
        if (tweet) tweets.push(tweet)
      }
    }
    // 某些情况下推文直接在 items 中
    if (instruction.type === 'TimelineAddItems' && Array.isArray(instruction.items)) {
      for (const item of instruction.items) {
        const tweet = extractTweetFromItem(item)
        if (tweet) tweets.push(tweet)
      }
    }
  }

  console.log(`[x-api] Extracted ${tweets.length} tweets from ${instructions.length} instructions`)

  return tweets
}

/**
 * 从 TimelineAddEntries 的 entry 中提取推文数据
 */
function extractTweetFromEntry(entry) {
  const content = entry?.content
  if (!content) return null

  // TimelineTimelineItem 类型包含推文
  if (content.entryType === 'TimelineTimelineItem' && content.itemContent) {
    return extractTweetFromItemContent(content.itemContent)
  }

  // 某些版本直接包含 tweet_results
  if (content.tweet_results) {
    return content.tweet_results.result || null
  }

  return null
}

/**
 * 从 TimelineAddItems 的 item 中提取推文数据
 */
function extractTweetFromItem(item) {
  if (item?.item?.itemContent) {
    return extractTweetFromItemContent(item.item.itemContent)
  }
  if (item?.itemContent) {
    return extractTweetFromItemContent(item.itemContent)
  }
  return null
}

/**
 * 从 itemContent 中提取推文结果
 */
function extractTweetFromItemContent(itemContent) {
  if (!itemContent) return null

  // 标准推文
  if (itemContent.tweet_results?.result) {
    return itemContent.tweet_results.result
  }

  // 置顶推文（有 tweetDisplayStyle 等）
  if (itemContent.tweet_results?.result?.tweet) {
    return itemContent.tweet_results.result.tweet
  }

  // 某些版本直接包含 tweet
  if (itemContent.tweet) {
    return itemContent.tweet
  }

  return null
}

/**
 * 从 GraphQL 时间线响应中提取分页游标
 *
 * 游标位于 TimelineTimelineCursor 类型的 entry 中:
 * { entryId: "cursor-bottom", content: { entryType: "TimelineTimelineCursor", value: "..." } }
 */
function extractNextCursor(response) {
  const instructions =
    response?.data?.home?.home_timeline_urt?.instructions ||
    response?.data?.home?.home_timeline?.instructions ||
    response?.data?.home?.latest_home_timeline?.instructions ||
    []

  for (const instruction of instructions) {
    if (instruction.type === 'TimelineAddEntries' && Array.isArray(instruction.entries)) {
      for (const entry of instruction.entries) {
        const content = entry?.content
        if (content?.entryType === 'TimelineTimelineCursor' && content.cursorType === 'Bottom') {
          return content.value || null
        }
      }
    }
  }
  return null
}

/**
 * 从 Viewer 响应中提取当前用户信息
 */
function extractViewerInfo(response) {
  const viewer = response?.data?.viewer
  if (!viewer) return null

  return {
    restId: viewer.rest_id || '',
    name: viewer.name || '',
    screenName: viewer.screen_name || '',
    profileImageUrl: viewer.profile_image_url_https || ''
  }
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  ApiError,
  httpsPost,
  httpsGet,
  OPERATION_IDS,
  resolveOperationIds,
  getOperationId,
  fetchHomeTimeline,
  fetchViewer,
  extractTweets,
  extractNextCursor,
  extractViewerInfo,
  sanitizeCookie,
  getCookieValue
}
