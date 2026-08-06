/**
 * auth.js — Cookie 验证 (基于 weibo.com)
 *
 * 免费版无需 OAuth 流程，用户只需提供 weibo.com 的 Cookie。
 * 本模块负责验证 Cookie 有效性并获取用户基本信息。
 *
 * 获取 Cookie 的方法:
 *   1. 在浏览器中登录 https://weibo.com
 *   2. 按 F12 打开开发者工具 → Network (网络) 标签
 *   3. 刷新页面，点击任意一个 weibo.com 请求
 *   4. 在 Request Headers 中找到 Cookie 字段，复制完整值
 */

const { fetchBasicInfo, extractCurrentUid, fetchFriendsTimeline, fetchFriendsTimelineFallback } = require('./weibo-api')

/**
 * 验证 Cookie 是否有效，并获取当前登录用户信息
 *
 * 验证策略:
 *   1. 先调用 getBasicInfo 获取用户基本信息（screen_name / uid）
 *   2. 再实际调用关注时间线接口 (unreadfriendstimeline)，确认 Cookie 能真正拉到数据。
 *      仅 getBasicInfo 通过是不够的 —— 该接口可能不校验 XSRF-TOKEN，
 *      而 unreadfriendstimeline 要求有效的 x-xsrf-token，否则返回 ok=-100。
 *   3. 若主接口失败，回退到 friends_timeline 再试一次。
 *
 * @param {string} cookie - weibo.com 的 Cookie 字符串
 * @returns {Promise<{valid: boolean, uid?: string, screenName?: string, error?: string}>}
 */
async function verifyCookie(cookie) {
  if (!cookie || !cookie.trim()) {
    return { valid: false, error: 'Cookie 不能为空' }
  }

  // Step 1: 获取用户基本信息
  let uid = null
  let screenName = null
  try {
    const response = await fetchBasicInfo(cookie)
    const userData = response?.data
    if (userData && userData.screen_name) {
      uid = extractCurrentUid(response)
      screenName = userData.screen_name
    }
  } catch (err) {
    return { valid: false, error: `基本信息接口失败: ${err.message}` }
  }

  // Step 2: 实际调用关注时间线接口，确认 Cookie 能拉到数据
  try {
    await fetchFriendsTimeline(cookie, { count: 1, since_id: '0', refresh: 0 })
    return { valid: true, uid: uid || undefined, screenName: screenName || undefined }
  } catch (primaryErr) {
    // Step 3: 主接口失败，回退到旧版 friends_timeline
    try {
      await fetchFriendsTimelineFallback(cookie, { count: 1, since_id: '0' })
      return { valid: true, uid: uid || undefined, screenName: screenName || undefined }
    } catch (fallbackErr) {
      return {
        valid: false,
        error: `关注时间线接口不可用: ${primaryErr.message}` +
          (fallbackErr.message !== primaryErr.message ? `；回退接口也失败: ${fallbackErr.message}` : '')
      }
    }
  }
}

module.exports = {
  verifyCookie
}
