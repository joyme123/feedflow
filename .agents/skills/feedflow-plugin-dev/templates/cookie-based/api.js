/**
 * api.js — API helper for the cookie-based plugin template
 *
 * Replace the endpoint and response parsing with your source's API.
 */

const https = require('https')

const API_HOST = 'api.example.com'

class ApiError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

function sanitizeCookie(cookie) {
  return (cookie || '').replace(/[\r\n\t]/g, '').trim()
}

function httpsGet(path, cookie) {
  const cleanCookie = sanitizeCookie(cookie)
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: API_HOST,
        path,
        headers: {
          'Cookie': cleanCookie,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*'
        },
        timeout: 15000
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          if (res.statusCode === 401 || res.statusCode === 403) {
            reject(new ApiError(res.statusCode, 'Cookie 已过期或无效，请重新登录'))
            return
          }
          try {
            resolve(JSON.parse(body))
          } catch (e) {
            reject(new Error(`解析响应失败: ${body.slice(0, 200)}`))
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

/** Fetch the timeline. Replace with your source's endpoint. */
function fetchTimeline(cookie, params) {
  const query = new URLSearchParams(params)
  return httpsGet(`/api/timeline?${query.toString()}`, cookie)
}

/** Extract items from the API response. Adapt to your response shape. */
function extractItems(response) {
  return response?.data?.items || response?.items || []
}

/** Extract the next-page cursor from the response. */
function extractNextCursor(response) {
  return response?.data?.next_cursor || response?.next_cursor || null
}

module.exports = {
  ApiError,
  fetchTimeline,
  extractItems,
  extractNextCursor
}
