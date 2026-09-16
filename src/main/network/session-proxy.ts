/**
 * session-proxy.ts — Chromium session 代理（渲染层图片/视频等媒体加载）
 *
 * 插件的 Node API 请求由 proxy-agent 的 https 补丁处理；而时间线里的
 * 图片/视频（如 pbs.twimg.com、video.twimg.com）由 Chromium net 栈加载，
 * 需要通过 session.defaultSession.setProxy 单独配置。
 */

import { session } from 'electron'
import { getProxyUrl, parseProxyUrl } from './proxy-agent'

const BYPASS_RULES = '<local>;127.0.0.1;localhost;::1'

/**
 * 把代理 URL 转换为 Chromium proxyRules 字符串；不支持的协议返回 null。
 *
 * 注意 Chromium 对 proxyRules 的解析：
 *   - `socks5=host:port` / `socks4=host:port` 这类 scheme=host 写法会被
 *     静默忽略（resolveProxy 回退 DIRECT，实测 Electron 44 如此）；
 *     SOCKS 只有 URI 写法 `socks5://host:port` 生效，且域名由代理解析
 *     （等价 socks5h，可规避本地 DNS 污染）。
 *   - HTTP 代理则用 `http=...;https=...` 写法（已验证生效）。
 */
function toChromiumProxyRules(rawUrl: string): string | null {
  const url = parseProxyUrl(rawUrl)
  if (!url) return null
  const hostPort = `${url.hostname}${url.port ? `:${url.port}` : ''}`

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    return `http=${hostPort};https=${hostPort}`
  }
  if (url.protocol === 'socks:' || url.protocol === 'socks5:' || url.protocol === 'socks5h:') {
    return `socks5://${hostPort}`
  }
  // socks4 / socks4a：Chromium 不支持
  console.warn(`[Proxy] Chromium 媒体加载不支持 ${url.protocol} 代理，仅插件 API 请求会走该代理`)
  return null
}

/**
 * 根据当前代理设置配置默认 session。设置保存后立即调用，无需重启。
 */
export async function applySessionProxy(): Promise<void> {
  const rawUrl = getProxyUrl()
  const rules = rawUrl ? toChromiumProxyRules(rawUrl) : null

  if (!rules) {
    await session.defaultSession.setProxy({ mode: 'system' })
    if (rawUrl) {
      // 已配置 SOCKS4 等 Chromium 不支持的情况：保持系统代理
      return
    }
    console.log('[Proxy] 媒体代理已关闭，session 使用系统代理')
    return
  }

  await session.defaultSession.setProxy({ proxyRules: rules, proxyBypassRules: BYPASS_RULES })
  console.log(`[Proxy] 媒体代理已生效: ${rules}`)
}
