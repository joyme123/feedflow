/**
 * detect.ts — 跨平台系统代理探测（用于设置页预填代理地址）
 *
 * 探测顺序：
 *   1. 环境变量（三平台通用）：HTTPS_PROXY / https_proxy / HTTP_PROXY / ALL_PROXY。
 *      终端启动、开发者、Linux 桌面常见；Chromium 在 macOS/Windows 上通常不读这些变量。
 *   2. Chromium 系统代理解析：在一个从不 setProxy 的独立 session 分区上调用
 *      session.resolveProxy()。Chromium 会按各平台原生方式解析：
 *        - macOS：系统设置 → 网络 → 代理（含自动发现/PAC 脚本，PAC 由 Chromium 执行）
 *        - Windows：WinINET / 注册表 Internet Settings（含 PAC）
 *        - Linux：GNOME/KDE gsettings + 环境变量
 *
 * 注意：不能用 defaultSession 解析——用户在应用内启用代理后 defaultSession 已被
 * setProxy 覆盖，读到的是应用自身配置而非系统配置。独立分区始终保持 system 模式。
 */

import { session } from 'electron'

export interface DetectedProxy {
  /** 可直接填入设置的代理 URL，如 http://127.0.0.1:7890 */
  url: string
  /** 探测来源，用于 UI 提示 */
  source: 'env' | 'system'
}

const DETECT_PARTITION = 'sys-proxy-detect'
/** resolveProxy 的探测目标：插件请求的目标全是 https，用一个 https URL 解析即可；
 * PAC 脚本可能按 URL 返回不同代理，这里取常规外网 https 场景 */
const PROBE_URL = 'https://example.com'

/** 读取代理环境变量（大小写不敏感），返回原始值或 null */
function readProxyEnv(): string | null {
  const keys = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'ALL_PROXY', 'all_proxy']
  for (const key of keys) {
    const value = process.env[key]?.trim()
    if (value) return value
  }
  return null
}

/** 规范化环境变量中的代理值（允许省略 scheme，如 127.0.0.1:7890） */
function normalizeEnvProxy(raw: string): string | null {
  let value = raw
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) {
    value = `http://${value}`
  }
  try {
    const url = new URL(value)
    if (!url.hostname) return null
    return url.href
  } catch {
    return null
  }
}

/**
 * 解析 Chromium 的 PAC 风格结果字符串。
 * 形如 "DIRECT"、"PROXY 127.0.0.1:7890"、"SOCKS5 127.0.0.1:1080"、
 * "PROXY 127.0.0.1:7890; SOCKS 127.0.0.1:1081; DIRECT"。
 * 取第一个非 DIRECT 的条目。
 */
function parsePacResult(result: string): string | null {
  const entries = result.split(/[;,]/).map((s) => s.trim()).filter(Boolean)
  for (const entry of entries) {
    if (entry.toUpperCase() === 'DIRECT') continue
    const space = entry.indexOf(' ')
    if (space === -1) continue
    const scheme = entry.slice(0, space).trim().toLowerCase()
    const hostPort = entry.slice(space + 1).trim()
    if (!hostPort) continue
    switch (scheme) {
      case 'proxy':
      case 'http':
      case 'https':
        return `http://${hostPort}`
      case 'socks':
      case 'socks5':
      case 'socks5h':
        return `socks5://${hostPort}`
      case 'socks4':
      case 'socks4a':
        return `socks4://${hostPort}`
      default:
        continue
    }
  }
  return null
}

/**
 * 探测系统代理。检测不到（直连/未配置）时返回 null。
 * 必须在 app.whenReady 之后调用。
 */
export async function detectSystemProxy(): Promise<DetectedProxy | null> {
  // 1. 环境变量优先
  const envProxy = readProxyEnv()
  if (envProxy) {
    const normalized = normalizeEnvProxy(envProxy)
    if (normalized) return { url: normalized, source: 'env' }
  }

  // 2. Chromium 解析系统设置（独立分区，不受应用内代理配置影响）
  try {
    const detectSession = session.fromPartition(DETECT_PARTITION)
    const result = await detectSession.resolveProxy(PROBE_URL)
    const url = parsePacResult(result || '')
    if (url) return { url, source: 'system' }
  } catch (err) {
    console.warn('[Proxy] 系统代理探测失败:', err instanceof Error ? err.message : String(err))
  }

  return null
}
