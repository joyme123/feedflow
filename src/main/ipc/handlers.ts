import { ipcMain, BrowserWindow } from 'electron'
import * as sourceQueries from '../database/queries/sources'
import * as itemQueries from '../database/queries/items'
import * as credentialQueries from '../database/queries/credentials'
import { getAllMeta, getAll, get as getPlugin, getModule } from '../plugin-system/registry'
import { refreshSources } from '../plugin-system/runner'
import { resolveCredentialFields } from '../plugin-system/credentials'
import { upsertItem } from '../database/queries/items'
import { updateSource, getEnabledSources } from '../database/queries/sources'
import type { AddSourceInput } from '@shared/types/source'
import type { TimelineListParams, DisplayItem, Item } from '@shared/types/item'
import type { SourceConfig } from '@shared/types/plugin'
import type { AddCredentialInput, UpdateCredentialInput } from '@shared/types/credential'

function enrichItems(items: Item[]): DisplayItem[] {
  const pluginCache = new Map<string, { name: string; color: string }>()
  const sources = sourceQueries.listSources()
  const sourceMap = new Map(sources.map((s) => [s.id, s]))

  return items.map((item) => {
    const source = sourceMap.get(item.sourceId)
    const pluginId = item.pluginId

    if (!pluginCache.has(pluginId)) {
      const plugin = getPlugin(pluginId)
      pluginCache.set(pluginId, {
        name: plugin?.meta.name ?? pluginId,
        color: plugin?.meta.color ?? '#888888',
      })
    }

    const pi = pluginCache.get(pluginId)!

    return {
      id: item.id,
      sourceId: item.sourceId,
      pluginId: item.pluginId,
      pluginName: pi.name,
      pluginColor: pi.color,
      feedType: source?.feedType ?? 'timeline',
      externalId: item.externalId,
      authorName: item.authorName,
      authorAvatar: item.authorAvatar,
      contentText: item.contentText,
      contentHtml: item.contentHtml,
      mediaUrls: JSON.parse(item.mediaUrls || '[]'),
      permalink: item.permalink,
      publishedAt: item.publishedAt,
      fetchedAt: item.fetchedAt,
      metadata: item.metadata,
    }
  })
}

// Re-export Item type for use in this file

export function registerIpcHandlers(): void {
  // ---- Sources ----
  ipcMain.handle('sources:list', () => {
    return sourceQueries.listSources()
  })

  ipcMain.handle('sources:add', (_e, input: AddSourceInput) => {
    return sourceQueries.addSource(input)
  })

  ipcMain.handle('sources:remove', (_e, id: string) => {
    sourceQueries.removeSource(id)
  })

  ipcMain.handle('sources:update', (_e, { id, data }: { id: string; data: Record<string, unknown> }) => {
    return sourceQueries.updateSource(id, data)
  })

  ipcMain.handle('sources:toggle', (_e, id: string) => {
    return sourceQueries.toggleSource(id)
  })

  // ---- Plugins ----
  ipcMain.handle('plugins:list', () => {
    return getAllMeta()
  })

  ipcMain.handle('plugins:get-config-schema', (_e, pluginId: string) => {
    const plugin = getPlugin(pluginId)
    return plugin?.configSchema ?? []
  })

  ipcMain.handle('plugins:verify-cookie', async (_e, { pluginId, cookie }: { pluginId: string; cookie: string }) => {
    const mod = getModule(pluginId)
    if (!mod || typeof mod.verifyCookie !== 'function') {
      throw new Error(`Plugin ${pluginId} does not support cookie verification`)
    }
    const verifyCookie = mod.verifyCookie as (cookie: string) => Promise<{ valid: boolean; uid?: string; screenName?: string; error?: string }>
    return await verifyCookie(cookie)
  })

  ipcMain.handle('plugins:list-groups', async (_e, { pluginId, credentialId }: { pluginId: string; credentialId: string }) => {
    const mod = getModule(pluginId)
    if (!mod || typeof mod.listGroups !== 'function') {
      throw new Error(`Plugin ${pluginId} does not support group listing`)
    }
    // Resolve credential to raw cookie value
    const cred = credentialQueries.getCredentialById(credentialId)
    if (!cred) {
      throw new Error('Credential not found')
    }
    const listGroups = mod.listGroups as (cookie: string) => Promise<{ label: string; value: string }[]>
    return await listGroups(cred.value)
  })

  // ---- Credentials ----
  ipcMain.handle('credentials:list', (_e, filter?: { provider?: string }) => {
    return credentialQueries.listCredentials(filter?.provider)
  })

  ipcMain.handle('credentials:add', (_e, input: AddCredentialInput) => {
    return credentialQueries.addCredential(input)
  })

  ipcMain.handle('credentials:update', (_e, { id, data }: { id: string; data: UpdateCredentialInput }) => {
    return credentialQueries.updateCredential(id, data)
  })

  ipcMain.handle('credentials:remove', (_e, id: string) => {
    credentialQueries.removeCredential(id)
  })

  ipcMain.handle('credentials:count-references', (_e, { credentialId }: { credentialId: string }) => {
    const count = credentialQueries.countSourcesByCredentialId(credentialId)
    return { count }
  })

  // ---- Timeline ----
  ipcMain.handle('timeline:list', (_e, params: TimelineListParams) => {
    const raw = itemQueries.listItems(params)
    return {
      items: enrichItems(raw.items),
      hasMore: raw.hasMore,
      nextCursor: raw.nextCursor,
    }
  })

  ipcMain.handle('timeline:refresh', async (_e, { sourceIds }: { sourceIds?: string[] }) => {
    const totalFetched = await refreshSources(sourceIds)
    return { totalFetched }
  })

  ipcMain.handle('timeline:load-older', async (_e, { sourceId, maxId }: { sourceId: string; maxId: string }) => {
    const sources = getEnabledSources()
    const source = sources.find((s) => s.id === sourceId)
    if (!source) return { items: [], totalFetched: 0, nextMaxId: maxId, hasMore: false }

    const plugin = getPlugin(source.pluginId)
    if (!plugin) return { items: [], totalFetched: 0, nextMaxId: maxId, hasMore: false }

    let config: SourceConfig = {}
    try {
      config = JSON.parse(source.config as unknown as string) as SourceConfig
    } catch {
      config = {}
    }

    // Resolve credential references into raw values before fetching
    config = resolveCredentialFields(config, source.pluginId)

    const win = BrowserWindow.getAllWindows()[0]
    win?.webContents.send('refresh:progress', {
      sourceId: source.id,
      sourceName: source.name,
      status: 'fetching'
    })

    try {
      const itemCountBefore = itemQueries.countItemsBySource(source.id)

      // 使用 maxId 游标加载更早的微博
      const cursor = JSON.stringify({ maxId })
      const result = await plugin.fetchItems(config, cursor)

      for (const item of result.items) {
        upsertItem(source.id, source.pluginId, item)
      }

      // 使用插件计算出的 API 边界更新游标。不能依赖 items 数组顺序，
      // 群聊 API 的返回顺序不稳定，且插件可能过滤掉系统消息。
      const existingCursor = source.cursorValue
      let sinceId = ''
      try {
        const parsed = JSON.parse(existingCursor || '{}')
        sinceId = parsed.sinceId || ''
      } catch { /* ignore */ }

      let nextMaxId = maxId
      try {
        const parsed = JSON.parse(result.nextCursor || '{}')
        nextMaxId = parsed.maxId || maxId
        sinceId = sinceId || parsed.sinceId || ''
      } catch { /* keep current boundary */ }

      updateSource(source.id, {
        cursorValue: JSON.stringify({ sinceId, maxId: nextMaxId })
      })

      const totalFetched = itemQueries.countItemsBySource(source.id) - itemCountBefore
      const hasMore = nextMaxId !== maxId
      const pageItems = itemQueries.getItemsByExternalIds(
        source.id,
        result.items.map((item) => item.externalId)
      )

      win?.webContents.send('refresh:complete', {
        sourceId: source.id,
        itemsFetched: totalFetched
      })

      return { items: enrichItems(pageItems), totalFetched, nextMaxId, hasMore }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      console.error(`[Runner] Error loading older for ${source.id}:`, errorMessage)
      return { items: [], totalFetched: 0, nextMaxId: maxId, hasMore: false }
    }
  })
}
