/**
 * auth.js — Cookie 验证 (基于 x.com)
 *
 * 免费版无需 OAuth 流程，用户只需提供 x.com 的 Cookie。
 * 本模块负责验证 Cookie 有效性并获取用户基本信息。
 *
 * 获取 Cookie 的方法:
 *   1. 在浏览器中登录 https://x.com
 *   2. 按 F12 打开开发者工具 → Network (网络) 标签
 *   3. 刷新页面，点击任意一个 x.com 请求
 *   4. 在 Request Headers 中找到 Cookie 字段，复制完整值
 *
 *   或者:
 *   1. 按 F12 打开开发者工具 → Application (应用) 标签
 *   2. 左侧 Storage → Cookies → https://x.com
 *   3. 复制 auth_token 和 ct0 字段的值，
 *      拼接为: auth_token=xxx; ct0=yyy
 */

const { fetchViewer, extractViewerInfo, sanitizeCookie, getCookieValue } = require('./x-api')

/**
 * 验证 Cookie 是否有效，并获取当前登录用户信息
 *
 * @param {string} cookie - x.com 的 Cookie 字符串
 * @returns {Promise<{valid: boolean, uid?: string, screenName?: string, error?: string}>}
 */
async function verifyCookie(cookie) {
  if (!cookie || !cookie.trim()) {
    return { valid: false, error: 'Cookie 不能为空' }
  }

  // 检查 Cookie 中是否包含关键字段 auth_token
  const cleanCookie = sanitizeCookie(cookie)
  const authToken = getCookieValue(cleanCookie, 'auth_token')
  if (!authToken) {
    return {
      valid: false,
      error: 'Cookie 中缺少 auth_token 字段。请从已登录的 x.com 浏览器中复制完整 Cookie（F12 → Network → 复制请求头中的 Cookie 字段完整值）。'
    }
  }

  try {
    const response = await fetchViewer(cookie)
    const viewerInfo = extractViewerInfo(response)

    if (viewerInfo && viewerInfo.screenName) {
      return {
        valid: true,
        uid: viewerInfo.restId || undefined,
        screenName: viewerInfo.screenName
      }
    }

    // API 返回成功但没有用户数据（可能是 Cookie 权限不足）
    if (response?.data?.viewer) {
      return { valid: true, uid: null, screenName: null }
    }

    return { valid: false, error: 'Cookie 无效或已过期，请重新登录 x.com' }
  } catch (err) {
    return { valid: false, error: err.message }
  }
}

module.exports = {
  verifyCookie
}
