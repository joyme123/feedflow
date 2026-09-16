import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { getSetting } from '../database/queries/settings'
import * as credentialQueries from '../database/queries/credentials'
import { buildProviderMaps, matchProvider, type ProviderInfo } from './domain-map'
import { markExtensionHeartbeat, setServerRunning, getExtensionStatus, loadExtensionStatus } from './status'
import { refreshMediaCookies } from '../media-cookies'
import { clearProviderStale, getStaleProviders } from './stale'
import { refreshSourcesForProvider } from '../plugin-system/runner'
import type { CredentialSource, SyncStatus } from '@shared/types/credential'

const DEFAULT_PORT = 33940

interface SyncRequest {
  domain: string
  cookie: string
}

interface SyncResponse {
  success: boolean
  provider?: string
  action?: 'created' | 'updated'
  message?: string
  error?: string
}

interface SyncStatusResponse {
  providers: {
    provider: string
    providerName: string
    hasCredential: boolean
    source: CredentialSource | null
    lastSyncedAt: number | null
    lastSyncStatus: SyncStatus | null
    lastSyncError: string | null
  }[]
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

async function handleSync(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const bodyStr = await readBody(req)
    const body = JSON.parse(bodyStr) as SyncRequest
    const { domain, cookie } = body

    if (!domain || !cookie) {
      sendJson(res, 400, { success: false, error: 'domain and cookie are required' })
      return
    }

    console.log(`[CookieSync] /sync received: domain=${domain}, cookieLength=${cookie.length}`)

    const { domainToProvider } = buildProviderMaps()
    const provider = matchProvider(domain, domainToProvider)
    if (!provider) {
      console.log(`[CookieSync] No provider match for domain: ${domain}`)
      sendJson(res, 400, { success: false, error: `Unsupported domain: ${domain}` })
      return
    }

    // 同步只负责落库，不做校验。校验由用户在「设置 → 凭据」中按需触发
    //（credentials:verify）；网络问题（如 ECONNRESET）不再阻断 Cookie 保存。
    // Cookie 值更新后，上一次的校验结果作废（verify 三字段重置为 null）。
    const existing = credentialQueries.listCredentials(provider)[0]
    const now = Date.now()
    if (existing) {
      // 扩展会因定时 resync / 域名下任意 cookie 变动而重复推送相同内容，
      // 仅在 cookie 值真正变化时才作废旧的校验结果；否则保留 lastVerify*，
      // 避免「已验证」徽章被周期性的重复同步悄悄清空。
      const valueChanged = existing.value !== cookie
      credentialQueries.updateCredential(existing.id, {
        value: cookie,
        source: 'extension',
        lastSyncedAt: now,
        lastSyncStatus: 'success',
        lastSyncError: null,
        ...(valueChanged
          ? { lastVerifiedAt: null, lastVerifyStatus: null, lastVerifyError: null }
          : {}),
      })
      console.log(`[CookieSync] Credential updated for ${provider}`)
    } else {
      const info = getProviderInfo(provider)
      credentialQueries.addCredential({
        provider,
        name: `${info?.providerName ?? provider} Cookie（自动同步）`,
        value: cookie,
        source: 'extension',
        lastSyncedAt: now,
        lastSyncStatus: 'success',
        lastSyncError: null,
      })
      console.log(`[CookieSync] Credential created for ${provider}`)
    }

    // Cookie 已保存到 DB，刷新内存中的 Cookie 缓存，使图片/视频请求立即生效
    refreshMediaCookies()

    // 同步成功：清除失效标记；若该 provider 之前正处于"Cookie 失效"状态，
    // 说明这是一次自愈，立即自动重新拉取该 provider 的信息流。
    const healed = clearProviderStale(provider)
    if (healed) {
      console.log(`[CookieSync] Provider ${provider} healed by sync, auto-refreshing its sources`)
      refreshSourcesForProvider(provider).catch((e) =>
        console.error(`[CookieSync] Auto-refresh after heal failed: ${e instanceof Error ? e.message : String(e)}`)
      )
    }

    // 能成功同步 Cookie 说明扩展处于活跃状态，更新 lastSeen
    markExtensionHeartbeat()

    sendJson(res, 200, { success: true, provider, action: existing ? 'updated' : 'created', message: 'Cookie 已保存' })
  } catch (err) {
    console.error('[CookieSync] /sync error:', err)
    sendJson(res, 500, { success: false, error: err instanceof Error ? err.message : String(err) })
  }
}

function getProviderInfo(provider: string): ProviderInfo | undefined {
  const { providerInfo } = buildProviderMaps()
  return providerInfo.get(provider)
}

function handleProviders(_req: IncomingMessage, res: ServerResponse): void {
  const { providerInfo } = buildProviderMaps()
  const list = Array.from(providerInfo.values()).filter((p) => p.domains.length > 0)
  sendJson(res, 200, list)
}

function handleSyncStatus(_req: IncomingMessage, res: ServerResponse): void {
  const { providerInfo } = buildProviderMaps()
  const providers = Array.from(providerInfo.values())
    .filter((p) => p.domains.length > 0)
    .map((p) => {
      const cred = credentialQueries.listCredentials(p.provider)[0]
      return {
        provider: p.provider,
        providerName: p.providerName,
        hasCredential: !!cred,
        source: cred?.source ?? null,
        lastSyncedAt: cred?.lastSyncedAt ?? null,
        lastSyncStatus: cred?.lastSyncStatus ?? null,
        lastSyncError: cred?.lastSyncError ?? null,
      }
    })
  sendJson(res, 200, { providers } satisfies SyncStatusResponse)
}

async function handleHeartbeat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // 消费请求体，避免 keep-alive 连接下未读数据影响后续请求
  await readBody(req).catch(() => {})
  markExtensionHeartbeat()
  // 把处于"Cookie 失效"状态的 provider 告诉扩展，扩展会立即重同步（并主动刷新）
  sendJson(res, 200, { success: true, refreshProviders: getStaleProviders() })
}

function handleHealth(_req: IncomingMessage, res: ServerResponse): void {
  sendJson(res, 200, { status: 'ok' })
}

/** Start the cookie-sync HTTP server. Failure does not crash the app. */
export function startCookieSyncServer(): void {
  try {
    // 加载持久化的扩展最后活跃时间，避免 App 重启后状态丢失
    loadExtensionStatus()

    const enabled = getSetting('cookie-sync.enabled')
    if (enabled === 'false') {
      console.log('[CookieSync] Server disabled in settings, skipping start')
      return
    }

    const portSetting = getSetting('cookie-sync.port')
    const port = Number(portSetting || process.env.FEEDFLOW_COOKIE_SYNC_PORT || DEFAULT_PORT)

    const httpServer = createServer(async (req, res) => {
      console.log(`[CookieSync] ${req.method} ${req.url}`)
      setCorsHeaders(res)

      // Handle CORS preflight
      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.end()
        return
      }

      const url = req.url?.split('?')[0] ?? ''

      try {
        if (url === '/health' && req.method === 'GET') {
          handleHealth(req, res)
        } else if (url === '/sync' && req.method === 'POST') {
          await handleSync(req, res)
        } else if (url === '/providers' && req.method === 'GET') {
          handleProviders(req, res)
        } else if (url === '/sync-status' && req.method === 'GET') {
          handleSyncStatus(req, res)
        } else if (url === '/heartbeat' && req.method === 'POST') {
          await handleHeartbeat(req, res)
        } else {
          sendJson(res, 404, { error: 'Not Found' })
        }
      } catch (err) {
        console.error('[CookieSync] Handler error:', err)
        if (!res.headersSent) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
        }
      }
    })

    httpServer.on('error', (err) => {
      console.error(`[CookieSync] Server error: ${err.message}`)
      setServerRunning(false)
    })

    httpServer.listen(port, '127.0.0.1', () => {
      setServerRunning(true)
      console.log(`[CookieSync] Server listening on http://127.0.0.1:${port}`)
    })
  } catch (err) {
    console.error('[CookieSync] Failed to start server:', err)
    setServerRunning(false)
  }
}

export { getExtensionStatus }
