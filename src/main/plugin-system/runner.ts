import { BrowserWindow } from 'electron'
import { get } from './registry'
import { resolveCredentialFields } from './credentials'
import { getEnabledSources, updateSource } from '../database/queries/sources'
import { upsertItem } from '../database/queries/items'
import { insertLog } from '../database/queries/fetch_log'
import { acquireRefreshLock, releaseRefreshLock } from './refresh-lock'
import { clearProviderStale, markProviderStale } from '../cookie-sync/stale'
import { runWithProxyContext } from '../network/proxy-context'
import { sourceUsesProxy } from '../network/proxy-agent'
import type { FeedFlowPlugin, SourceConfig } from '@shared/types/plugin'

/** 解析插件所属的 provider（凭据共享维度），用于失效标记 */
function providerOf(plugin: FeedFlowPlugin): string {
  return plugin.meta.provider ?? plugin.meta.id
}

/** 判断是否为 Cookie 失效类错误（各插件 ApiError 的 code 约定 + 文案兜底） */
function isCookieFailure(err: unknown, message: string): boolean {
  const code = (err as { code?: number } | null)?.code
  return code === -100 || code === 401 || code === 403 || message.includes('Cookie 已过期')
}

export async function refreshSources(sourceIds?: string[]): Promise<number> {
  const sources = getEnabledSources()
  const toRefresh = sourceIds
    ? sources.filter((s) => sourceIds.includes(s.id))
    : sources

  // 获取刷新锁，跳过正在刷新的源
  const lockedIds = acquireRefreshLock(toRefresh.map((s) => s.id))
  const sourcesToRefresh = toRefresh.filter((s) => lockedIds.includes(s.id))

  let totalFetched = 0
  const win = BrowserWindow.getAllWindows()[0]

  try {
    for (const source of sourcesToRefresh) {
    const plugin = get(source.pluginId)
    if (!plugin) {
      console.warn(`[Runner] Plugin ${source.pluginId} not found for source ${source.id}`)
      continue
    }

    const startedAt = new Date().toISOString()
    let config: SourceConfig = {}
    try {
      config = JSON.parse(source.config as unknown as string) as SourceConfig
    } catch {
      config = {}
    }

    // Resolve credential references into raw values before fetching
    config = resolveCredentialFields(config, source.pluginId)

    // Notify: fetching
    win?.webContents.send('refresh:progress', {
      sourceId: source.id,
      sourceName: source.name,
      status: 'fetching'
    })

    try {
      // 刷新时不传递游标，始终获取最新内容。
      // 游标（cursorValue）仅用于 loadOlderItems（加载更早内容），
      // 这样刷新时 upsertItem 会更新已有条目（修正作者名/头像等字段）。
      const result = await runWithProxyContext(sourceUsesProxy(plugin, config), () =>
        plugin.fetchItems(config, undefined)
      )

      // Notify: storing
      win?.webContents.send('refresh:progress', {
        sourceId: source.id,
        sourceName: source.name,
        status: 'storing'
      })

      // Upsert each item
      for (const item of result.items) {
        upsertItem(source.id, source.pluginId, item)
      }

      // Update cursor
      updateSource(source.id, { cursorValue: result.nextCursor })

      // 拉取成功：清除该 provider 的 Cookie 失效标记
      clearProviderStale(providerOf(plugin))

      // Log success
      insertLog({
        sourceId: source.id,
        status: 'success',
        itemsFetched: result.items.length,
        startedAt,
        finishedAt: new Date().toISOString()
      })

      totalFetched += result.items.length

      // Notify: done
      win?.webContents.send('refresh:complete', {
        sourceId: source.id,
        itemsFetched: result.items.length
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      console.error(`[Runner] Error refreshing source ${source.id}:`, errorMessage)

      // Cookie 失效类错误 → 标记 provider 为 stale，
      // cookie-sync 扩展会在下次心跳时自动重同步并触发自愈
      if (isCookieFailure(err, errorMessage)) {
        markProviderStale(providerOf(plugin))
      }

      // Log error
      insertLog({
        sourceId: source.id,
        status: 'error',
        itemsFetched: 0,
        errorMessage,
        startedAt,
        finishedAt: new Date().toISOString()
      })

      // Notify: error
      win?.webContents.send('refresh:progress', {
        sourceId: source.id,
        sourceName: source.name,
        status: 'error',
        error: errorMessage
      })

      win?.webContents.send('refresh:complete', {
        sourceId: source.id,
        itemsFetched: 0
      })
    }
  }

  // Notify: all complete
  win?.webContents.send('refresh:all-complete', { totalItems: totalFetched })

  return totalFetched
  } finally {
    releaseRefreshLock(lockedIds)
  }
}

/**
 * 刷新指定 provider（凭据共享维度）下所有启用来源。
 * 用于 Cookie 自愈后自动重新拉取该 provider 的信息流。
 */
export async function refreshSourcesForProvider(provider: string): Promise<number> {
  const sources = getEnabledSources()
  const ids = sources
    .filter((s) => {
      const p = get(s.pluginId)
      return p && providerOf(p) === provider
    })
    .map((s) => s.id)
  if (ids.length === 0) return 0
  return refreshSources(ids)
}
