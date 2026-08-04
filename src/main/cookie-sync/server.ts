import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { getSetting } from '../database/queries/settings'
import * as credentialQueries from '../database/queries/credentials'
import { getAll, getModule } from '../plugin-system/registry'
import { buildProviderMaps, matchProvider, type ProviderInfo } from './domain-map'
import { markExtensionHeartbeat, setServerRunning, getExtensionStatus } from './status'
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
  verified?: boolean
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

/** Find a plugin for a provider that supports cookie verification */
function findVerifyPlugin(provider: string): { pluginId: string; verifyCookie: (cookie: string) => Promise<{ valid: boolean; error?: string }> } | null {
  for (const plugin of getAll()) {
    const p = plugin.meta.provider ?? plugin.meta.id
    if (p !== provider) continue
    const mod = getModule(plugin.meta.id)
    if (mod && typeof mod.verifyCookie === 'function') {
      return { pluginId: plugin.meta.id, verifyCookie: mod.verifyCookie as (cookie: string) => Promise<{ valid: boolean; error?: string }> }
    }
  }
  return null
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

    // Verify cookie if the provider supports it
    let verified = true
    const verifyPlugin = findVerifyPlugin(provider)
    if (verifyPlugin) {
      const result = await verifyPlugin.verifyCookie(cookie)
      console.log(`[CookieSync] verifyCookie for ${provider}: valid=${result.valid}${result.error ? `, error=${result.error}` : ''}`)
      if (!result.valid) {
        // Verification failed: reject write, record failure status on existing credential if any
        const existing = credentialQueries.listCredentials(provider)[0]
        if (existing) {
          credentialQueries.updateCredential(existing.id, {
            lastSyncStatus: 'failed',
            lastSyncError: result.error ?? 'Cookie 验证失败',
            lastSyncedAt: Date.now(),
          })
        }
        sendJson(res, 200, { success: false, verified: false, provider, error: result.error ?? 'Cookie 验证失败' })
        return
      }
    }

    // One credential per provider: find existing, else create
    const existing = credentialQueries.listCredentials(provider)[0]
    const now = Date.now()
    if (existing) {
      credentialQueries.updateCredential(existing.id, {
        value: cookie,
        source: 'extension',
        lastSyncedAt: now,
        lastSyncStatus: 'success',
        lastSyncError: null,
      })
      console.log(`[CookieSync] Credential updated for ${provider}`)
      sendJson(res, 200, { success: true, provider, action: 'updated', verified, message: 'Cookie 已更新' })
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
      sendJson(res, 200, { success: true, provider, action: 'created', verified, message: 'Cookie 已保存' })
    }
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

function handleHeartbeat(_req: IncomingMessage, res: ServerResponse): void {
  markExtensionHeartbeat()
  sendJson(res, 200, { success: true })
}

function handleHealth(_req: IncomingMessage, res: ServerResponse): void {
  sendJson(res, 200, { status: 'ok' })
}

/** Start the cookie-sync HTTP server. Failure does not crash the app. */
export function startCookieSyncServer(): void {
  try {
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
          handleHeartbeat(req, res)
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
