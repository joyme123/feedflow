import { getDb } from '../connection'
import type { FetchLogEntry } from '@shared/types/item'

export function insertLog(entry: {
  sourceId: string
  status: 'success' | 'partial' | 'error'
  itemsFetched: number
  errorMessage?: string
  startedAt: string
  finishedAt?: string
}): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO fetch_log (source_id, status, items_fetched, error_message, started_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    entry.sourceId,
    entry.status,
    entry.itemsFetched,
    entry.errorMessage ?? null,
    entry.startedAt,
    entry.finishedAt ?? null
  )
}

export function listLogs(sourceId?: string, limit = 20): FetchLogEntry[] {
  const db = getDb()
  if (sourceId) {
    return db.prepare(`
      SELECT id, source_id as sourceId, status, items_fetched as itemsFetched,
             error_message as errorMessage, started_at as startedAt, finished_at as finishedAt
      FROM fetch_log WHERE source_id = ? ORDER BY started_at DESC LIMIT ?
    `).all(sourceId, limit) as FetchLogEntry[]
  }
  return db.prepare(`
    SELECT id, source_id as sourceId, status, items_fetched as itemsFetched,
           error_message as errorMessage, started_at as startedAt, finished_at as finishedAt
    FROM fetch_log ORDER BY started_at DESC LIMIT ?
  `).all(limit) as FetchLogEntry[]
}
