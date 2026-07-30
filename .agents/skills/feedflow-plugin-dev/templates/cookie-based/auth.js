/**
 * auth.js — Credential verification for the cookie-based template
 *
 * Export verifyCookie so the UI can validate a cookie before saving.
 */

const { httpsGet } = require('./api')

/**
 * Verify the cookie is valid by calling a lightweight endpoint.
 * @param {string} cookie
 * @returns {Promise<{valid: boolean, uid?: string, screenName?: string, error?: string}>}
 */
async function verifyCookie(cookie) {
  if (!cookie || !cookie.trim()) {
    return { valid: false, error: 'Cookie 不能为空' }
  }
  try {
    const response = await httpsGet('/api/me', cookie)
    const user = response?.data || response
    if (user && (user.id || user.screen_name)) {
      return {
        valid: true,
        uid: user.id ? String(user.id) : undefined,
        screenName: user.screen_name || user.name || undefined
      }
    }
    return { valid: false, error: '无法获取用户信息，Cookie 可能已过期' }
  } catch (err) {
    return { valid: false, error: err.message }
  }
}

module.exports = { verifyCookie }
