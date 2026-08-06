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
  fetchFriendsTimelineFallback,
  fetchAllGroups,
  extractAllFollowListId,
  fetchUserBlogs,
  fetchStatusById,
  fetchLongTextById,
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
  color: '#E6162D',
  provider: 'weibo',
  providerName: '微博',
  cookieDomains: ['weibo.com', 'weibo.cn']
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

/**
 * 获取微博完整文本：优先使用 long_text 字段，否则清理 text 中的展开标记。
 *
 * 微博长文在 text 字段中会被截断，并附带一个 <a ...>...展开</a> 链接。
 * long_text 字段包含完整正文（纯文本），仅在正文超长时才存在。
 * 无论来源如何，都需要清理展开标记。
 *
 * @returns {{ text: string, isTruncated: boolean }} 清理后的文本及是否被截断
 */
function getFullText(status) {
  // 如果 long_text 不可用且 text 中包含"展开"链接，说明文本被截断了
  const rawText = status.text || ''
  const isTruncated = !status.long_text && /展开/.test(rawText)
  const text = status.long_text || rawText
  return { text: cleanExpandMarker(text), isTruncated }
}

/**
 * 清理微博 HTML 中的"展开"截断标记。
 *
 * 微博长文的 text 字段末尾通常包含：
 *   <a href="..." target="_blank">...展开</a>
 * 或被 <span class="expand"> / <span class="WB_text_opt"> 包裹的展开链接。
 * 此函数移除这些标记，以便 UI 层自行处理展开/收起。
 */
function cleanExpandMarker(html) {
  if (!html) return ''
  return html
    // 移除包含"展开"的 <a> 标签（允许内部有嵌套标签如 <i>/<span>，
    // 但用负向前瞻防止跨越其他 <a> 标签，避免误删前面的链接/话题标签）
    .replace(/<a\b[^>]*>(?:(?!<\/?a\b)[\s\S])*?展开(?:(?!<\/?a\b)[\s\S])*?<\/a>/gi, '')
    // 移除包含"展开"的 <span> 包裹层（expand / WB_text_opt 等微博特有类名）
    .replace(/<span\b[^>]*class="[^"]*(?:expand|WB_text_opt)[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '')
    // 移除尾部残留的"…展开"、"...展开"等纯文本标记（不在任何标签内的情况）
    .replace(/[.。…\s]*展开\s*$/g, '')
    // 清理尾部残留的省略号
    .replace(/[.。…\s]+$/g, '')
    .trim()
}

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

  // 处理正文：优先使用 long_text（完整内容），否则清理 text 中的展开标记
  const { text: mainText, isTruncated } = getFullText(status)
  let displayText = mainText

  // 处理转发微博
  if (status.retweeted_status) {
    const rtUser = status.retweeted_status.user
    const rtName = rtUser ? `@${rtUser.screen_name}` : ''
    const rtResult = getFullText(status.retweeted_status)
    displayText += `\n\n//${rtName}: ${rtResult.text}`
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
      isRetweet: !!status.retweeted_status,
      isTruncated: isTruncated
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
      console.log(`[weibo] allGroups ok, list_id=${cachedListId}`)
    } catch (err) {
      console.warn('[weibo] Failed to fetch allGroups:', err.message)
    }
  }
  console.log(`[weibo] fetchItems params: count=${count}, since_id=${sinceId || '0'}, max_id=${maxId || '无'}, list_id=${cachedListId || '无'}`)

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
    let response
    let usedFallback = false
    try {
      response = await fetchFriendsTimeline(cookie, params)
    } catch (primaryErr) {
      // unreadfriendstimeline 失败（常见原因: XSRF-TOKEN 失效 / 接口变更），
      // 回退到旧版 friends_timeline 接口再试一次
      console.warn('[weibo] unreadfriendstimeline 失败，尝试 friends_timeline 回退:', primaryErr.message)
      usedFallback = true
      const fallbackParams = { count }
      if (maxId) fallbackParams.max_id = maxId
      else fallbackParams.since_id = sinceId || '0'
      response = await fetchFriendsTimelineFallback(cookie, fallbackParams)
    }

    const statuses = extractStatuses(response)
    console.log(`[weibo] timeline response (${usedFallback ? 'fallback' : 'primary'}): ok=${response?.ok}, statuses=${statuses.length}, msg=${response?.msg || '无'}`)

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

    // API 返回成功但无数据：可能是 Cookie 权限不足或接口变化
    const detail = response ? `ok=${response.ok}, msg=${response.msg || '无'}` : '无响应'
    throw new Error(`关注时间线接口返回异常（${detail}）。请检查 Cookie 是否仍然有效，或在浏览器中重新登录微博后自动同步。`)
  } catch (err) {
    console.warn('[weibo] fetchItems failed:', err.message)
    // 如果是上面主动抛出的错误，直接传递；否则包装为更友好的提示
    if (err.message.includes('关注时间线接口返回异常')) {
      throw err
    }
    throw new Error(`关注时间线接口暂时不可用（${err.message}）。请稍后重试，或检查 Cookie 是否仍然有效。`)
  }
}

// ============================================================
// fetchItemDetail — 拉取单条微博完整正文（用于内联展开长文）
// ============================================================

/**
 * 获取单条微博的完整内容。
 *
 * 关注时间线接口返回的长文会被截断（text 字段末尾带"展开"链接），
 * 此函数通过 /ajax/statuses/show 拉取单条详情，拿到 long_text 完整正文，
 * 供 UI 层内联展开，无需跳转浏览器。
 *
 * @param {SourceConfig} config - 用户配置（含 cookie）
 * @param {string} externalId - 微博 id (idstr / mid)
 * @returns {Promise<ItemDetailResult>}
 */
async function fetchItemDetail(config, externalId) {
  console.log('[weibo] fetchItemDetail CALLED, externalId=', externalId, '| hasCookie=', !!config.cookie, '| cookieLen=', config.cookie?.length)
  const cookie = config.cookie
  if (!cookie) {
    throw new Error('微博 Cookie 未配置。请在源设置中填入 weibo.com 的 Cookie。')
  }
  if (!externalId) {
    throw new Error('缺少微博 ID，无法获取完整内容。')
  }

  console.log('[weibo] fetchItemDetail calling fetchStatusById...')
  const response = await fetchStatusById(cookie, externalId)
  const status = response?.data || response
  if (!status || (!status.text && !status.long_text)) {
    throw new Error('获取微博完整内容失败，请稍后重试。')
  }

  // 长微博：weibo.com 的 /ajax/statuses/show 只返回截断 text，
  // 需调用 m.weibo.cn/statuses/extend 获取 longTextContent 完整正文
  let displayText
  if (status.isLongText) {
    console.log('[weibo] fetchItemDetail isLongText=true, calling fetchLongTextById...')
    try {
      const ltRes = await fetchLongTextById(cookie, externalId)
      const longText = ltRes?.data?.longTextContent
      if (longText) {
        console.log('[weibo] fetchItemDetail got longTextContent, length=', longText.length)
        displayText = longText
      } else {
        console.log('[weibo] fetchItemDetail longTextContent empty, fallback to text')
        displayText = getFullText(status).text
      }
    } catch (err) {
      console.log('[weibo] fetchItemDetail fetchLongTextById failed, fallback:', err.message)
      displayText = getFullText(status).text
    }
  } else {
    displayText = getFullText(status).text
  }

  // 处理转发微博
  if (status.retweeted_status) {
    const rtUser = status.retweeted_status.user
    const rtName = rtUser ? `@${rtUser.screen_name}` : ''
    const rtResult = getFullText(status.retweeted_status)
    displayText += `\n\n//${rtName}: ${rtResult.text}`
  }

  const result = {
    content: {
      text: stripHtml(displayText) || '',
      html: displayText
    },
    // 已拿到完整正文，不再标记为截断
    metadata: { isTruncated: false }
  }
  console.log('[weibo] fetchItemDetail RETURNING content.text length=', result.content.text.length)
  return result
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
  fetchItemDetail,
  onRegister
}

module.exports = {
  default: weiboPlugin,
  verifyCookie
}
