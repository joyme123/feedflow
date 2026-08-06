/**
 * weibo-api.js — 微博 weibo.com AJAX API 封装（免费版 v3）
 *
 * 使用 weibo.com 的 AJAX JSON API，无需 OAuth、无需 App Key/Secret，
 * 仅需用户提供 weibo.com 的浏览器 Cookie 即可访问关注信息流。
 *
 * 核心接口:
 *   - 关注时间线: GET https://weibo.com/ajax/statuses/friends_timeline
 *   - 我的微博:   GET https://weibo.com/ajax/statuses/mymblog
 *   - 关注列表:   GET https://weibo.com/ajax/side/friends
 *   - 用户信息:   GET https://weibo.com/ajax/profile/info
 *   - 单条微博:   GET https://weibo.com/ajax/statuses/show
 *
 * 认证方式: 请求头中携带 Cookie (用户从 weibo.com 浏览器登录后复制)
 */

const https = require('https')

const WEIBO_HOST = 'weibo.com'

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
 * （用于提取 XSRF-TOKEN，微博 AJAX 接口要求在请求头中回传此 token）
 */
function extractCookieField(cookie, fieldName) {
  if (!cookie) return ''
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${fieldName}=([^;]*)`))
  return match ? decodeURIComponent(match[1].trim()) : ''
}

/** 发起 HTTPS GET 请求（带 Cookie） */
function httpsGet(path, cookie, host = WEIBO_HOST) {
  const cleanCookie = sanitizeCookie(cookie)
  // 微博部分 AJAX 接口（如 unreadfriendstimeline）要求在请求头中回传 XSRF-TOKEN，
  // 否则返回 ok=-100（认证失败）。XSRF-TOKEN 存储在 Cookie 中，需提取后放入 x-xsrf-token 头。
  const xsrfToken = extractCookieField(cleanCookie, 'XSRF-TOKEN')
  const headers = {
    'Cookie': cleanCookie,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    'Referer': `https://${host}/`
  }
  if (xsrfToken) {
    headers['x-xsrf-token'] = xsrfToken
  }
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: host,
        path,
        headers,
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
            if (json.ok === -100) {
              // 记录完整响应体，便于排查 XSRF / Cookie 问题
              console.warn(`[weibo-api] ${path} 返回 ok=-100, body=${body.slice(0, 300)}`)
              reject(new ApiError(-100, json.msg || 'Cookie 已过期或需要重新登录，请重新登录 weibo.com'))
              return
            }
            if (json.ok !== undefined && json.ok !== 1 && json.ok !== 0) {
              console.warn(`[weibo-api] ${path} 返回 ok=${json.ok}, body=${body.slice(0, 300)}`)
              reject(new ApiError(json.ok || -1, json.msg || 'API 返回未知错误'))
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

// ============================================================
// 自定义错误类
// ============================================================

class ApiError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'WeiboApiError'
    this.code = code
  }
}

// ============================================================
// weibo.com AJAX API
// ============================================================

/**
 * 获取关注时间线（首页关注信息流 - 未读微博）
 * GET https://weibo.com/ajax/feed/unreadfriendstimeline
 *
 * 一次调用即可获取整个关注流，无需逐个用户拉取。
 * 与浏览器实际调用一致，使用 list_id（"全部关注"分组 ID）。
 *
 * 注意: 此接口要求请求头携带有效的 x-xsrf-token，否则返回 ok=-100。
 *
 * @param {string} cookie    - weibo.com Cookie
 * @param {object} params
 * @param {number} [params.count]    - 单页条数 (默认 15)
 * @param {string} [params.since_id] - 返回 ID 大于此值的微博 (增量)
 * @param {string} [params.max_id]   - 返回 ID 小于此值的微博 (向下翻页)
 * @param {string} [params.list_id] - 分组 ID (默认 "全部关注")
 * @param {number} [params.refresh] - 刷新次数 (默认 4)
 */
function fetchFriendsTimeline(cookie, params) {
  const query = new URLSearchParams()
  if (params.list_id) query.set('list_id', params.list_id)
  if (params.count) query.set('count', params.count)
  if (params.since_id) query.set('since_id', params.since_id)
  if (params.max_id) query.set('max_id', params.max_id)
  if (params.refresh !== undefined) query.set('refresh', params.refresh)
  return httpsGet(`/ajax/feed/unreadfriendstimeline?${query.toString()}`, cookie)
}

/**
 * 获取关注时间线（备用方案）
 * GET https://weibo.com/ajax/statuses/friends_timeline
 *
 * 当 unreadfriendstimeline 因 XSRF / 接口变更失败时的回退接口。
 * 参数与 unreadfriendstimeline 类似，但不需要 list_id / refresh。
 *
 * @param {string} cookie    - weibo.com Cookie
 * @param {object} params
 * @param {number} [params.count]    - 单页条数
 * @param {string} [params.since_id] - 返回 ID 大于此值的微博 (增量)
 * @param {string} [params.max_id]   - 返回 ID 小于此值的微博 (向下翻页)
 * @param {number} [params.page]     - 页码
 */
function fetchFriendsTimelineFallback(cookie, params) {
  const query = new URLSearchParams()
  if (params.count) query.set('count', params.count)
  if (params.since_id) query.set('since_id', params.since_id)
  if (params.max_id) query.set('max_id', params.max_id)
  if (params.page) query.set('page', params.page)
  return httpsGet(`/ajax/statuses/friends_timeline?${query.toString()}`, cookie)
}

/**
 * 获取全部分组列表（含"全部关注"的 list_id）
 * GET https://weibo.com/ajax/feed/allGroups
 *
 * 返回结构: { groups: [{ title, group_type, group: [{ gid, uid, title }, ...] }] }
 * "全部关注" 的 gid 格式为 10001{uid}
 */
function fetchAllGroups(cookie) {
  return httpsGet('/ajax/feed/allGroups', cookie)
}

/**
 * 从 allGroups 响应中提取"全部关注"的 list_id
 */
function extractAllFollowListId(response) {
  const groups = response?.groups || []
  for (const g of groups) {
    if (g.group_type === 0 && g.group) {
      const allFollow = g.group.find(item => item.title === '全部关注' || (item.gid && item.gid.startsWith('10001')))
      if (allFollow) return allFollow.gid || allFollow.uid
    }
  }
  return null
}

/**
 * 获取用户发布的微博
 * GET https://weibo.com/ajax/statuses/mymblog
 */
function fetchUserBlogs(cookie, uid, page, count) {
  const query = new URLSearchParams({ uid })
  if (page) query.set('page', page)
  if (count) query.set('count', count)
  return httpsGet(`/ajax/statuses/mymblog?${query.toString()}`, cookie)
}

/**
 * 获取关注列表（用户关注的人）
 * GET https://weibo.com/ajax/profile/followContent?uid={uid}&page={page}
 *
 * 返回结构: { data: { follows: { users: [...], total_number: N } } }
 */
function fetchFollowingList(cookie, uid, page, count) {
  const query = new URLSearchParams({ uid })
  if (page) query.set('page', page)
  if (count) query.set('count', count)
  return httpsGet(`/ajax/profile/followContent?${query.toString()}`, cookie)
}

/**
 * 从 followContent 响应中提取用户列表
 */
function extractFollowingUsers(response) {
  return response?.data?.follows?.users || response?.data?.users || []
}

/**
 * 获取当前登录用户的基本信息（含 UID）
 * GET https://weibo.com/ajax/setting/getBasicInfo
 *
 * 返回: { data: { screen_name, domain, ... } }
 * UID 需从 tips_url 字段中提取 (格式: weibo.com/{UID}/...)
 */
function fetchBasicInfo(cookie) {
  return httpsGet('/ajax/setting/getBasicInfo', cookie)
}

/**
 * 从 getBasicInfo 响应中提取当前用户 UID
 *
 * getBasicInfo 不直接返回 id 字段，但 tips_url 中包含 UID。
 * 兜底方案: 从 profile/detail 响应中查找。
 */
function extractCurrentUid(response) {
  const str = JSON.stringify(response?.data || {})
  const match = str.match(/weibo\.com\/(\d+)/)
  return match ? match[1] : null
}

/**
 * 获取用户信息（验证 Cookie 有效性）
 * GET https://weibo.com/ajax/profile/info
 */
function fetchProfileInfo(cookie, uid) {
  const query = new URLSearchParams()
  if (uid) query.set('uid', uid)
  return httpsGet(`/ajax/profile/info?${query.toString()}`, cookie)
}

/**
 * 获取单条微博详情
 * GET https://weibo.com/ajax/statuses/show
 */
function fetchStatusById(cookie, id) {
  const query = new URLSearchParams({ id })
  return httpsGet(`/ajax/statuses/show?${query.toString()}`, cookie)
}

/**
 * 获取长微博的完整正文
 * GET https://m.weibo.cn/statuses/extend?id={mid}
 *
 * weibo.com 的 /ajax/statuses/show 对长文只返回截断的 text，
 * 完整正文在 m.weibo.cn 的 /statuses/extend 接口的 longTextContent 字段。
 *
 * @returns {Promise<{ok:number, data:{longTextContent:string}}>}
 */
function fetchLongTextById(cookie, id) {
  const query = new URLSearchParams({ id })
  return httpsGet(`/statuses/extend?${query.toString()}`, cookie, 'm.weibo.cn')
}

// ============================================================
// 响应解析辅助
// ============================================================

/**
 * 从 friends_timeline 响应中提取微博列表
 *
 * 响应结构:
 * {
 *   ok: 1,
 *   data: {
 *     list: [ {mblog 对象}, ... ],
 *     since_id: "...",
 *     next_cursor: "...",
 *     total_number: ...
 *   }
 * }
 */
function extractStatuses(response) {
  return response?.statuses || response?.data?.list || response?.data?.statuses || []
}

/**
 * 从关注列表响应中提取用户列表
 */
function extractUsers(response) {
  return response?.data?.users || response?.data?.list || []
}

/**
 * 从 followContent 响应中提取关注用户列表
 */
function extractFollowingUsers(response) {
  return response?.data?.follows?.users || response?.data?.users || []
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  ApiError,
  httpsGet,
  fetchFriendsTimeline,
  fetchFriendsTimelineFallback,
  fetchAllGroups,
  extractAllFollowListId,
  fetchUserBlogs,
  fetchFollowingList,
  fetchBasicInfo,
  extractCurrentUid,
  fetchProfileInfo,
  fetchStatusById,
  fetchLongTextById,
  extractStatuses,
  extractUsers,
  extractFollowingUsers
}
