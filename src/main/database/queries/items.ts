import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../connection'
import type { Item, TimelineListParams } from '@shared/types/item'
import type { TimelineItem } from '@shared/types/plugin'

export function listItems(params: TimelineListParams = {}): { items: Item[]; hasMore: boolean; nextCursor: string | null } {
  const db = getDb()
  const limit = params.limit ?? 20
  const cursor = params.cursor

  let query: string
  let queryParams: unknown[]

  if (params.sourceIds && params.sourceIds.length > 0) {
    const placeholders = params.sourceIds.map(() => '?').join(',')
    if (cursor) {
      query = `
        SELECT id, source_id as sourceId, plugin_id as pluginId, external_id as externalId,
               author_name as authorName, author_avatar as authorAvatar,
               content_text as contentText, content_html as contentHtml,
               media_urls as mediaUrls, permalink, published_at as publishedAt,
               fetched_at as fetchedAt, cursor_value as cursorValue, metadata
        FROM items
        WHERE published_at < ? AND source_id IN (${placeholders})
        ORDER BY published_at DESC
        LIMIT ?
      `
      queryParams = [cursor, ...params.sourceIds, limit + 1]
    } else {
      query = `
        SELECT id, source_id as sourceId, plugin_id as pluginId, external_id as externalId,
               author_name as authorName, author_avatar as authorAvatar,
               content_text as contentText, content_html as contentHtml,
               media_urls as mediaUrls, permalink, published_at as publishedAt,
               fetched_at as fetchedAt, cursor_value as cursorValue, metadata
        FROM items
        WHERE source_id IN (${placeholders})
        ORDER BY published_at DESC
        LIMIT ?
      `
      queryParams = [...params.sourceIds, limit + 1]
    }
  } else {
    // Aggregated feed: exclude group-chat sources (they are viewed separately)
    if (cursor) {
      query = `
        SELECT id, source_id as sourceId, plugin_id as pluginId, external_id as externalId,
               author_name as authorName, author_avatar as authorAvatar,
               content_text as contentText, content_html as contentHtml,
               media_urls as mediaUrls, permalink, published_at as publishedAt,
               fetched_at as fetchedAt, cursor_value as cursorValue, metadata
        FROM items
        WHERE published_at < ?
          AND source_id NOT IN (SELECT id FROM sources WHERE feed_type = 'group-chat')
        ORDER BY published_at DESC
        LIMIT ?
      `
      queryParams = [cursor, limit + 1]
    } else {
      query = `
        SELECT id, source_id as sourceId, plugin_id as pluginId, external_id as externalId,
               author_name as authorName, author_avatar as authorAvatar,
               content_text as contentText, content_html as contentHtml,
               media_urls as mediaUrls, permalink, published_at as publishedAt,
               fetched_at as fetchedAt, cursor_value as cursorValue, metadata
        FROM items
        WHERE source_id NOT IN (SELECT id FROM sources WHERE feed_type = 'group-chat')
        ORDER BY published_at DESC
        LIMIT ?
      `
      queryParams = [limit + 1]
    }
  }

  const rows = db.prepare(query).all(...queryParams) as Item[]
  const hasMore = rows.length > limit
  if (hasMore) rows.pop()

  const nextCursor = rows.length > 0 ? rows[rows.length - 1].publishedAt : null

  return { items: rows, hasMore, nextCursor }
}

export function upsertItem(sourceId: string, pluginId: string, item: TimelineItem): void {
  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString()

  db.prepare(`
    INSERT INTO items (id, source_id, plugin_id, external_id, author_name, author_avatar,
                       content_text, content_html, media_urls, permalink, published_at,
                       fetched_at, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, external_id) DO UPDATE SET
      author_name = excluded.author_name,
      author_avatar = excluded.author_avatar,
      content_text = excluded.content_text,
      content_html = excluded.content_html,
      media_urls = excluded.media_urls,
      permalink = excluded.permalink,
      metadata = excluded.metadata
  `).run(
    id,
    sourceId,
    pluginId,
    item.externalId,
    item.author.name,
    item.author.avatarUrl ?? '',
    item.content.text,
    item.content.html ?? '',
    JSON.stringify(item.mediaUrls),
    item.permalink,
    item.publishedAt,
    now,
    JSON.stringify(item.metadata ?? {})
  )
}

export function deleteItemsBySource(sourceId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM items WHERE source_id = ?').run(sourceId)
}

export function countItemsBySource(sourceId: string): number {
  const db = getDb()
  const row = db.prepare('SELECT COUNT(*) as count FROM items WHERE source_id = ?').get(sourceId) as { count: number }
  return row.count
}

export function getItemById(id: string): Item | undefined {
  const db = getDb()
  return db.prepare(`
    SELECT id, source_id as sourceId, plugin_id as pluginId, external_id as externalId,
           author_name as authorName, author_avatar as authorAvatar,
           content_text as contentText, content_html as contentHtml,
           media_urls as mediaUrls, permalink, published_at as publishedAt,
           fetched_at as fetchedAt, cursor_value as cursorValue, metadata
    FROM items
    WHERE id = ?
  `).get(id) as Item | undefined
}

export function getItemsByExternalIds(sourceId: string, externalIds: string[]): Item[] {
  if (externalIds.length === 0) return []

  const db = getDb()
  const placeholders = externalIds.map(() => '?').join(',')
  return db.prepare(`
    SELECT id, source_id as sourceId, plugin_id as pluginId, external_id as externalId,
           author_name as authorName, author_avatar as authorAvatar,
           content_text as contentText, content_html as contentHtml,
           media_urls as mediaUrls, permalink, published_at as publishedAt,
           fetched_at as fetchedAt, cursor_value as cursorValue, metadata
    FROM items
    WHERE source_id = ? AND external_id IN (${placeholders})
    ORDER BY published_at DESC
  `).all(sourceId, ...externalIds) as Item[]
}
