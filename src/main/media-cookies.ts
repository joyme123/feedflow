import { session } from 'electron'
import { getDb } from './database/connection'
import { decrypt } from './plugin-system/encryption'

/** 微博相关域名，用于设置 Cookie 和 Referer */
export const WEIBO_DOMAINS = ['.upload.api.weibo.com', '.weibo.com', '.sinaimg.cn', '.sina.com.cn', '.api.weibo.com']

/** X (Twitter) 视频 CDN 域名，请求视频时需要携带 X Cookie 才能播放 */
export const X_VIDEO_DOMAINS = ['video.twimg.com']

/**
 * 清洗用户粘贴的 Cookie：剔除 CR/LF 等控制字符（保留 TAB 与 >= 0x80 的 obs-text）。
 * Cookie 来自凭据输入框，粘贴时很容易带入结尾换行；而 Chromium 的
 * net::HttpRequestHeaders::SetHeader 对非法 header value 有 CHECK，
 * 旧版 Electron（31）在 onBeforeSendHeaders 里设置含 CRLF 的头会直接原生崩溃。
 */
export function sanitizeCookie(raw: string): string {
  return raw.replace(/[\x00-\x08\x0A-\x1F\x7F]/g, '').trim()
}

/** 微博图片/视频请求所需的 Cookie，运行时可刷新 */
let weiboCookie = ''
/** X 视频请求所需的 Cookie，运行时可刷新 */
let xCookie = ''

/**
 * 从 DB 中加载某个插件被任一启用源引用的凭据（解密后的 Cookie 字符串）。
 * 用于在主进程为图片/视频请求注入 Cookie。返回空字符串表示未找到凭据。
 */
export function loadCookieForPlugin(pluginId: string): string {
  try {
    const db = getDb()
    const row = db.prepare(`
      SELECT c.value FROM credentials c
      JOIN sources s ON s.config LIKE '%' || c.id || '%'
      WHERE s.plugin_id = ?
      LIMIT 1
    `).get(pluginId) as { value: string } | undefined
    if (row) {
      return sanitizeCookie(decrypt(row.value))
    }
    console.log(`[main] No credential found for plugin ${pluginId}`)
  } catch (e) {
    console.error(`[main] Failed to load cookie for ${pluginId}:`, (e as Error).message)
  }
  return ''
}

/**
 * 将微博 Cookie 设置到 Electron session 中。
 * @param cookie - 完整的 Cookie 头（"name1=value1; name2=value2"）或单个 Cookie 值
 * @param cookieName - 当 cookie 是单个值时使用的名称（默认 'SUB'）
 */
export async function setWeiboCookies(cookie: string, cookieName = 'SUB'): Promise<void> {
  const pairs: { name: string; value: string }[] = []
  if (cookie.includes('=')) {
    // 完整 Cookie 头，解析所有键值对
    for (const pair of cookie.split(';')) {
      const eqIdx = pair.indexOf('=')
      if (eqIdx <= 0) continue
      const name = pair.substring(0, eqIdx).trim()
      const value = pair.substring(eqIdx + 1).trim()
      if (name && value) pairs.push({ name, value })
    }
  } else {
    // 单个 Cookie 值
    pairs.push({ name: cookieName, value: cookie })
  }

  for (const { name, value } of pairs) {
    for (const domain of WEIBO_DOMAINS) {
      session.defaultSession.cookies.set({
        url: `https://${domain.replace(/^\./, '')}`,
        name,
        value,
        domain,
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'no_restriction'
      }).catch(() => {})
    }
  }
}

/**
 * 从 DB 重新加载微博和 X 的 Cookie，更新到内存变量中。
 * 在应用启动、Cookie 同步/变更后调用，确保图片/视频请求能携带最新 Cookie。
 */
export function refreshMediaCookies(): void {
  // 优先从群聊插件加载，fallback 到微博关注流插件（两者共享同一套微博 Cookie）
  weiboCookie =
    loadCookieForPlugin('feedflow-plugin-weibo-group-chat') ||
    loadCookieForPlugin('feedflow-plugin-weibo')
  if (weiboCookie) {
    console.log('[main] Weibo cookie refreshed, length:', weiboCookie.length)
    setWeiboCookies(weiboCookie).catch((e) => console.error('[main] Failed to set weibo cookies:', e))
  }
  xCookie = loadCookieForPlugin('feedflow-plugin-x')
  if (xCookie) {
    console.log('[main] X cookie refreshed, length:', xCookie.length)
  }
}

/** 获取当前微博 Cookie（供 onBeforeSendHeaders 使用） */
export function getWeiboCookie(): string {
  return weiboCookie
}

/** 获取当前 X Cookie（供 onBeforeSendHeaders 使用） */
export function getXCookie(): string {
  return xCookie
}
