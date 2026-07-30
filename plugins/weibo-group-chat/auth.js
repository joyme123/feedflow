/**
 * auth.js — Cookie 验证 (基于 weibo.com)
 *
 * 与 weibo-home-timeline 插件的验证逻辑一致，
 * 调用 weibo.com/ajax/setting/getBasicInfo 验证 Cookie 有效性。
 *
 * 获取 Cookie 的方法:
 *   1. 在浏览器中登录 https://weibo.com
 *   2. 按 F12 打开开发者工具 → Network (网络) 标签
 *   3. 刷新页面，点击任意一个 weibo.com 请求
 *   4. 在 Request Headers 中找到 Cookie 字段，复制完整值
 */

const { fetchBasicInfo, extractCurrentUid } = require('./group-api')

/**
 * 验证 Cookie 是否有效，并获取当前登录用户信息
 *
 * @param {string} cookie - weibo.com 的 Cookie 字符串
 * @returns {Promise<{valid: boolean, uid?: string, screenName?: string, error?: string}>}
 */
async function verifyCookie(cookie) {
  if (!cookie || !cookie.trim()) {
    return { valid: false, error: 'Cookie 不能为空' }
  }

  try {
    const response = await fetchBasicInfo(cookie)
    const userData = response?.data

    if (userData && userData.screen_name) {
      const uid = extractCurrentUid(response)
      return {
        valid: true,
        uid: uid || undefined,
        screenName: userData.screen_name
      }
    }

    // API 返回成功但没有用户数据
    return { valid: true, uid: null, screenName: null }
  } catch (err) {
    return { valid: false, error: err.message }
  }
}

module.exports = {
  verifyCookie
}
