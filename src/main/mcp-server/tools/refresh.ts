import { getEnabledSources } from '../../database/queries/sources'
import { upsertItem } from '../../database/queries/items'
import { updateSource } from '../../database/queries/sources'
import { insertLog } from '../../database/queries/fetch_log'
import { get as getPlugin } from '../../plugin-system/registry'
import { resolveCredentialFields } from '../../plugin-system/credentials'
import { acquireRefreshLock, releaseRefreshLock } from '../../plugin-system/refresh-lock'
import type { SourceConfig } from '@shared/types/plugin'
import type { RefreshSourceParams, RefreshSourceResult, RefreshResultItem } from '../types'

export async function handleRefreshSource(params: RefreshSourceParams): Promise<RefreshSourceResult> {
  const allSources = getEnabledSources()
  const requestedIds = params.sourceIds

  // 确定要刷新的源
  let sourcesToRefresh = requestedIds
    ? allSources.filter((s) => requestedIds.includes(s.id))
    : allSources

  // 获取锁，跳过正在刷新的源
  const lockedIds = acquireRefreshLock(sourcesToRefresh.map((s) => s.id))
  const skippedIds = sourcesToRefresh
    .filter((s) => !lockedIds.includes(s.id))
    .map((s) => s.id)

  sourcesToRefresh = sourcesToRefresh.filter((s) => lockedIds.includes(s.id))

  const timeout = Math.min(Math.max(Number(params.timeout ?? 30), 5), 120)
  const results: RefreshResultItem[] = []
  let totalFetched = 0

  // 先记录被跳过的源
  for (const id of skippedIds) {
    const src = allSources.find((s) => s.id === id)
    results.push({
      sourceId: id,
      sourceName: src?.name ?? '未知源',
      status: 'skipped',
      itemsFetched: 0,
    })
  }

  try {
    for (const source of sourcesToRefresh) {
      const plugin = getPlugin(source.pluginId)
      const startedAt = new Date().toISOString()

      if (!plugin) {
        results.push({
          sourceId: source.id,
          sourceName: source.name,
          status: 'error',
          itemsFetched: 0,
          error: `Plugin ${source.pluginId} not found`,
        })
        continue
      }

      // 解析 config
      let config: SourceConfig = {}
      try {
        config = JSON.parse(source.config as unknown as string) as SourceConfig
      } catch {
        config = {}
      }
      config = resolveCredentialFields(config, source.pluginId)

      try {
        // 带超时调用 fetchItems
        const result = await withTimeout(
          plugin.fetchItems(config, undefined),
          timeout * 1000
        )

        // Upsert 条目
        for (const item of result.items) {
          upsertItem(source.id, source.pluginId, item)
        }

        // 更新 cursor
        updateSource(source.id, { cursorValue: result.nextCursor })

        // 记录日志
        insertLog({
          sourceId: source.id,
          status: 'success',
          itemsFetched: result.items.length,
          startedAt,
          finishedAt: new Date().toISOString(),
        })

        totalFetched += result.items.length
        results.push({
          sourceId: source.id,
          sourceName: source.name,
          status: 'success',
          itemsFetched: result.items.length,
        })
      } catch (err) {
        const isTimeout = err instanceof Error && err.message === 'timeout'
        const errorMessage = isTimeout ? 'Refresh timed out' : err instanceof Error ? err.message : String(err)

        insertLog({
          sourceId: source.id,
          status: 'error',
          itemsFetched: 0,
          errorMessage,
          startedAt,
          finishedAt: new Date().toISOString(),
        })

        results.push({
          sourceId: source.id,
          sourceName: source.name,
          status: isTimeout ? 'timeout' : 'error',
          itemsFetched: 0,
          error: errorMessage,
        })
      }
    }
  } finally {
    releaseRefreshLock(lockedIds)
  }

  return { refreshed: results, totalFetched }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    promise.then(
      (val) => {
        clearTimeout(timer)
        resolve(val)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}
