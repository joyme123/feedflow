import { listSources } from '../../database/queries/sources'
import { countItemsBySource } from '../../database/queries/items'
import { getDb } from '../../database/connection'
import type { ListSourcesParams, ListSourcesResult, SourceInfo } from '../types'

export function handleListSources(params: ListSourcesParams): ListSourcesResult {
  let sources = listSources()

  if (params.enabled !== undefined) {
    sources = sources.filter((s) => s.enabled === params.enabled)
  }

  const db = getDb()
  const result: SourceInfo[] = sources.map((s) => {
    // 获取该源最近一次刷新时间
    const logRow = db
      .prepare(
        `SELECT started_at FROM fetch_log WHERE source_id = ? ORDER BY started_at DESC LIMIT 1`
      )
      .get(s.id) as { started_at: string } | undefined

    return {
      id: s.id,
      name: s.name,
      feedType: s.feedType,
      enabled: s.enabled,
      itemCount: countItemsBySource(s.id),
      lastFetchedAt: logRow?.started_at ?? null,
      createdAt: s.createdAt,
    }
  })

  return { sources: result }
}
