/**
 * v2ex-api.js — V2EX API 封装
 *
 * 优先使用 V2EX 公开 API（无需认证）：
 *   - /api/topics/latest.json  — 最新主题
 *   - /api/topics/hot.json     — 热门主题
 *   - /api/topics/show.json    — 主题详情
 *
 * 可选 API 2.0（需 Personal Access Token，用于按节点订阅）：
 *   - /api/v2/nodes/:name/topics — 节点主题列表（支持分页）
 */

const https = require('https')

// ============================================================
// 自定义错误类
// ============================================================

class ApiError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}

// ============================================================
// HTTP GET 工具
// ============================================================

function httpsGet(host, path, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: host,
        path,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          ...extraHeaders
        },
        timeout: 15000
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          if (res.statusCode === 401) {
            reject(new ApiError(401, 'Token 无效或已过期，请重新创建 Personal Access Token'))
            return
          }
          if (res.statusCode === 403) {
            reject(new ApiError(403, '无访问权限，请检查 Token 权限'))
            return
          }
          if (res.statusCode === 429) {
            reject(new ApiError(429, '请求过于频繁，请稍后重试'))
            return
          }
          if (res.statusCode >= 400) {
            reject(new ApiError(res.statusCode, `API 返回错误 (${res.statusCode})`))
            return
          }
          try {
            const json = JSON.parse(body)
            resolve(json)
          } catch (e) {
            reject(new Error(`解析响应失败: ${body.slice(0, 200)}`))
          }
        })
      }
    )
    req.on('error', (err) => reject(err))
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('请求超时，请稍后重试'))
    })
  })
}

// ============================================================
// 公开 API（无需认证）
// ============================================================

/**
 * 获取最新主题列表
 * @returns {Promise<Array>} 主题数组
 */
function fetchLatestTopics() {
  return httpsGet('www.v2ex.com', '/api/topics/latest.json')
}

/**
 * 获取热门主题列表
 * @returns {Promise<Array>} 主题数组
 */
function fetchHotTopics() {
  return httpsGet('www.v2ex.com', '/api/topics/hot.json')
}

/**
 * 获取单个主题详情
 * @param {number|string} topicId - 主题 ID
 * @returns {Promise<Object>} 主题对象
 */
function fetchTopicById(topicId) {
  return httpsGet('www.v2ex.com', `/api/topics/show.json?id=${topicId}`)
}

// ============================================================
// API 2.0（需 Personal Access Token，用于按节点订阅）
// ============================================================

/**
 * 获取指定节点的主题列表（支持分页）
 * @param {string} nodeName - 节点英文名（如 rust、life）
 * @param {number} page - 页码，从 1 开始
 * @param {string} token - Personal Access Token
 * @returns {Promise<Array>} 主题数组
 */
function fetchNodeTopics(nodeName, page = 1, token) {
  if (!token) {
    throw new Error('按节点订阅需要 Personal Access Token')
  }
  const path = `/api/v2/nodes/${encodeURIComponent(nodeName)}/topics?p=${page}`
  return httpsGet('edge.v2ex.com', path, {
    Authorization: `Bearer ${token}`
  })
}

module.exports = {
  ApiError,
  fetchLatestTopics,
  fetchHotTopics,
  fetchTopicById,
  fetchNodeTopics
}
