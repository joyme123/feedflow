/**
 * group-api.js — 微博群聊 API 封装
 *
 * 使用 api.weibo.com 的群聊 AJAX JSON API，无需 OAuth、无需 App Key/Secret，
 * 仅需用户提供 weibo.com 的浏览器 Cookie 即可访问群聊消息。
 *
 * 核心接口:
 *   - 已加入群列表: GET https://api.weibo.com/webim/groupchat/query_join_groups.json
 *   - 群聊消息:     GET https://api.weibo.com/webim/groupchat/query_messages.json
 *   - 群信息查询:   GET https://api.weibo.com/webim/groupchat/query.json
 *
 * 认证方式: 请求头中携带 Cookie (用户从 weibo.com 浏览器登录后复制)
 */

const https = require('https')

const API_HOST = 'api.weibo.com'
const DEFAULT_REFERER = 'https://api.weibo.com/chat/'

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

/** 发起 HTTPS GET 请求（带 Cookie） */
function httpsGet(path, cookie, referer) {
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
          'Referer': referer || DEFAULT_REFERER
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
            // 群聊 API 使用 result: false 表示错误
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

// ============================================================
// 自定义错误类
// ============================================================

class ApiError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'WeiboGroupApiError'
    this.code = code
  }
}

// ============================================================
// api.weibo.com 群聊 API
// ============================================================

/**
 * 获取已加入的群列表
 * GET https://api.weibo.com/webim/groupchat/query_join_groups.json
 *
 * @param {string} cookie - weibo.com Cookie
 * @returns {Promise<object>} { total, join_groups: [...] }
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
 * @param {string|number} params.id - 群 ID（从群列表接口获取）
 * @param {number} [params.count] - 单页条数
 * @param {string|number} [params.max_mid] - 翻页：返回此消息之前的历史消息
 * @returns {Promise<object>} { result, last_read_mid, messages: [...], ts }
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

/**
 * 查询群信息
 * GET https://api.weibo.com/webim/groupchat/query.json
 *
 * 注意：此接口需要 source 参数（appkey），仅供内部使用。
 * 群信息可从 query_join_groups 的响应中获取。
 *
 * @param {string} cookie - weibo.com Cookie
 * @param {string|number} groupId - 群 ID
 */
function fetchGroupInfo(cookie, groupId) {
  const query = new URLSearchParams({ id: groupId })
  return httpsGet(`/webim/groupchat/query.json?${query.toString()}`, cookie)
}

/**
 * 获取当前登录用户的基本信息（用于 Cookie 验证）
 * 复用 weibo.com 的 getBasicInfo 接口
 *
 * GET https://weibo.com/ajax/setting/getBasicInfo
 */
function fetchBasicInfo(cookie) {
  const cleanCookie = sanitizeCookie(cookie)
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: 'weibo.com',
        path: '/ajax/setting/getBasicInfo',
        headers: {
          'Cookie': cleanCookie,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': 'https://weibo.com/'
        },
        timeout: 15000
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          if (res.statusCode === 403) {
            reject(new ApiError(403, 'Cookie 已过期或无效'))
            return
          }
          try {
            const json = JSON.parse(body)
            if (json.ok === -100) {
              reject(new ApiError(-100, 'Cookie 已过期或需要重新登录'))
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

/**
 * 从 getBasicInfo 响应中提取当前用户 UID
 */
function extractCurrentUid(response) {
  const str = JSON.stringify(response?.data || {})
  const match = str.match(/weibo\.com\/(\d+)/)
  return match ? match[1] : null
}

// ============================================================
// 导出
// ============================================================

module.exports = {
  ApiError,
  httpsGet,
  fetchJoinGroups,
  fetchGroupMessages,
  fetchGroupInfo,
  fetchBasicInfo,
  extractCurrentUid
}
