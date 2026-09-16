/**
 * proxy-agent.ts — 主进程出站代理：配置加载 + node:https 补丁
 *
 * 所有内置插件都通过 node:https 的薄封装发请求（且都未显式传 agent）。
 * 这里在进程启动早期一次性包装 https.request / https.get：仅当调用栈处于
 * proxy-context 的"走代理"上下文（由 runner/IPC/cookie-sync/MCP 等调用点
 * 用 runWithProxyContext 包裹）时，才向请求注入代理 agent。
 *
 * 支持的代理协议（由设置中的 URL scheme 决定）：
 *   - http://  / https://   → HttpsProxyAgent（HTTP CONNECT 隧道）
 *   - socks:// / socks5(socks5h):// / socks4(socks4a):// → SocksProxyAgent
 *
 * 该补丁不影响：
 *   - 主进程自身的其它 https 流量（不在代理 ALS 上下文内）
 *   - agent 自身的建连（HttpsProxyAgent 用 node:http 发 CONNECT，
 *     SocksProxyAgent 直接用 net/tls，均不经过被 patch 的 https.request）
 */

import https from 'node:https'
import type { Agent as HttpsAgent, ClientRequest } from 'node:http'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { getSetting } from '../database/queries/settings'
import { listSources } from '../database/queries/sources'
import { get, getAll } from '../plugin-system/registry'
import { isProxyCallContext } from './proxy-context'
import type { FeedFlowPlugin, SourceConfig } from '@shared/types/plugin'

const SETTING_ENABLED = 'proxy.enabled'
const SETTING_URL = 'proxy.url'

const HTTP_SCHEMES = new Set(['http:', 'https:'])
const SOCKS_SCHEMES = new Set(['socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'])

let proxyAgent: HttpsAgent | null = null
let proxyUrl = ''
let patchInstalled = false

/** 解析并校验代理 URL，返回 URL 对象；非法时返回 null */
export function parseProxyUrl(raw: string | undefined | null): URL | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (HTTP_SCHEMES.has(url.protocol) || SOCKS_SCHEMES.has(url.protocol)) return url
    return null
  } catch {
    return null
  }
}

function createAgent(url: URL): HttpsAgent {
  if (SOCKS_SCHEMES.has(url.protocol)) {
    // SocksProxyAgent 接受完整 socks:// URL（含可选认证）
    return new SocksProxyAgent(url.href) as unknown as HttpsAgent
  }
  return new HttpsProxyAgent(url.href) as unknown as HttpsAgent
}

/** 当前生效的代理 agent（未启用/未配置时为 null） */
export function getProxyAgent(): HttpsAgent | null {
  return proxyAgent
}

/** 当前代理 URL（供 session-proxy 等模块消费） */
export function getProxyUrl(): string {
  return proxyUrl
}

/**
 * 从设置重新加载代理配置，重建 agent。设置保存后立即调用，无需重启。
 * @returns 配置后的启用状态
 */
export function reloadProxyConfig(): boolean {
  const enabled = getSetting(SETTING_ENABLED) !== 'false' // 默认（未设置）不启用
  const url = parseProxyUrl(getSetting(SETTING_URL))

  if (!enabled || !url) {
    proxyAgent = null
    proxyUrl = ''
    if (!enabled || !getSetting(SETTING_URL)?.trim()) return false
    console.warn('[Proxy] 代理已启用但 URL 非法，插件请求将保持直连')
    return false
  }

  if (url.href === proxyUrl && proxyAgent) return true

  try {
    proxyAgent = createAgent(url)
    proxyUrl = url.href
    console.log(`[Proxy] 出站代理已生效: ${url.protocol}//${url.host}`)
    return true
  } catch (err) {
    proxyAgent = null
    proxyUrl = ''
    console.error('[Proxy] 代理初始化失败，插件请求将保持直连:', err)
    return false
  }
}

// ============================================================
// 单个信息源 / provider 是否应走代理
// ============================================================

/**
 * 某次插件调用是否走代理：优先读源配置中的 useProxy（boolean），
 * 存量源没有该字段时回落到 configSchema 中 useProxy 的 default。
 */
export function sourceUsesProxy(plugin: FeedFlowPlugin, config: SourceConfig | undefined | null): boolean {
  if (!getProxyAgent()) return false
  const raw = config?.useProxy
  if (typeof raw === 'boolean') return raw
  if (raw === 'true') return true
  if (raw === 'false') return false
  const field = (plugin.configSchema ?? []).find((f) => f.key === 'useProxy')
  return field?.default === true
}

/**
 * 某 provider 下是否应走代理（provider 级调用：凭据验证、微博群组拉取等）。
 *
 * 判定顺序：
 *   1. 代理未启用/未配置 → 一律 false（直连）；
 *   2. 存在已启用且实际开启 useProxy 的同源信息源 → true；
 *   3. 该 provider 下存在信息源但都不满足（已禁用或显式关闭代理）→ false；
 *   4. 该 provider 下没有任何信息源（典型场景：只装了浏览器扩展、Cookie
 *      自动同步出凭据，但用户尚未添加信息源）→ 取已注册插件 configSchema
 *      中 useProxy 的默认值（X 关注流默认为 true），避免凭据验证被误判
 *      为直连导致 read ECONNRESET。
 */
export function providerUsesProxy(provider: string): boolean {
  if (!getProxyAgent()) return false
  let sourceExists = false
  for (const source of listSources()) {
    const plugin = get(source.pluginId)
    if (!plugin) continue
    if ((plugin.meta.provider ?? plugin.meta.id) !== provider) continue
    sourceExists = true
    if (!source.enabled) continue
    let config: SourceConfig = {}
    try {
      config = JSON.parse(source.config as unknown as string) as SourceConfig
    } catch {
      config = {}
    }
    if (sourceUsesProxy(plugin, config)) return true
  }
  if (sourceExists) return false

  // 该 provider 尚无信息源：以任一已注册同源插件的 schema 默认值为准
  for (const plugin of getAll()) {
    if ((plugin.meta.provider ?? plugin.meta.id) !== provider) continue
    const field = (plugin.configSchema ?? []).find((f) => f.key === 'useProxy')
    if (field?.default === true) return true
  }
  return false
}

// ============================================================
// node:https 补丁
// ============================================================

type RequestArgs =
  | [options: https.RequestOptions | string | URL, callback?: (res: unknown) => void]
  | [url: string | URL, options: https.RequestOptions, callback?: (res: unknown) => void]

interface NormalizedArgs {
  url?: string | URL
  options: https.RequestOptions
  callback?: (res: unknown) => void
}

function normalizeArgs(args: unknown[]): NormalizedArgs {
  const first = args[0]
  if (typeof first === 'string' || first instanceof URL) {
    const second = args[1]
    if (second && typeof second === 'object') {
      return { url: first, options: { ...(second as https.RequestOptions) }, callback: args[2] as never }
    }
    return {
      url: first,
      options: {},
      callback: typeof second === 'function' ? (second as never) : (args[2] as never)
    }
  }
  return {
    options: { ...((first as https.RequestOptions) ?? {}) },
    callback: typeof args[1] === 'function' ? (args[1] as never) : undefined
  }
}

/**
 * 安装 https 补丁（幂等）。必须在插件加载前于 app.whenReady 中调用一次。
 */
export function installHttpsProxyPatch(): void {
  if (patchInstalled) return
  patchInstalled = true

  const originalRequest = https.request.bind(https) as typeof https.request
  const originalGet = https.get.bind(https) as typeof https.get

  const patchedRequest = function patchedRequest(...args: unknown[]): ClientRequest {
    if (isProxyCallContext() && proxyAgent) {
      const normalized = normalizeArgs(args)
      // 尊重调用方显式传入的 agent，不覆盖
      if (normalized.options.agent === undefined) {
        normalized.options.agent = proxyAgent
      }
      if (normalized.url !== undefined) {
        return originalRequest(normalized.url, normalized.options, normalized.callback)
      }
      return originalRequest(normalized.options, normalized.callback)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, prefer-rest-params
    return originalRequest.apply(https, arguments as unknown as Parameters<typeof https.request>) as ClientRequest
  }

  const patchedGet = function patchedGet(...args: unknown[]): ClientRequest {
    if (isProxyCallContext() && proxyAgent) {
      const normalized = normalizeArgs(args)
      if (normalized.options.agent === undefined) {
        normalized.options.agent = proxyAgent
      }
      const req = normalized.url !== undefined
        ? originalRequest(normalized.url, normalized.options, normalized.callback)
        : originalRequest(normalized.options, normalized.callback)
      req.end()
      return req
    }
    return originalGet.apply(https, arguments as unknown as Parameters<typeof https.get>) as ClientRequest
  }

  https.request = patchedRequest as typeof https.request
  https.get = patchedGet as typeof https.get

  console.log('[Proxy] node:https 代理补丁已安装')
}
