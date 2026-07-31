import { BrowserWindow } from 'electron'
import { get } from './registry'
import { resolveCredentialFields } from './credentials'
import { getEnabledSources, updateSource } from '../database/queries/sources'
import { upsertItem } from '../database/queries/items'
import { insertLog } from '../database/queries/fetch_log'
import { acquireRefreshLock, releaseRefreshLock } from './refresh-lock'
import type { SourceConfig } from '@shared/types/plugin'

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
      const result = await plugin.fetchItems(config, undefined)

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
