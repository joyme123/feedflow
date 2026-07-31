import { getDb } from '../../database/connection'
import { getItemById } from '../../database/queries/items'
import { listSources } from '../../database/queries/sources'
import { get as getPlugin } from '../../plugin-system/registry'
import { resolveCredentialFields } from '../../plugin-system/credentials'
import { upsertItem } from '../../database/queries/items'
import type { SourceConfig } from '@shared/types/plugin'
import type { Item } from '@shared/types/item'
import type {
  ListItemsParams,
  ListItemsResult,
  ItemSummary,
  SearchItemsParams,
  GetItemParams,
  GetItemResult,
  ItemDetail,
} from '../types'

// ---- list_items ----

export function handleListItems(params: ListItemsParams): ListItemsResult {
  const db = getDb()
  const limit = Math.min(Math.max(Number(params.limit ?? 20), 1), 100)
  const cursor = params.cursor
  const sourceIds = params.sourceIds
  const since = params.since
  const until = params.until

  // 构建 WHERE 条件
  const conditions: string[] = []
  const queryParams: unknown[] = []

  if (sourceIds && sourceIds.length > 0) {
    const placeholders = sourceIds.map(() => '?').join(',')
    conditions.push(`source_id IN (${placeholders})`)
    queryParams.push(...sourceIds)
  } else {
    // 聚合流：排除 group-chat 源
    conditions.push(`source_id NOT IN (SELECT id FROM sources WHERE feed_type = 'group-chat')`)
  }

  if (cursor) {
    conditions.push(`published_at < ?`)
    queryParams.push(cursor)
  }
  if (since) {
    conditions.push(`published_at >= ?`)
    queryParams.push(since)
  }
  if (until) {
    conditions.push(`published_at <= ?`)
    queryParams.push(until)
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const query = `
    SELECT id, source_id as sourceId, author_name as authorName,
           content_text as contentText, permalink, published_at as publishedAt,
           media_urls as mediaUrls
    FROM items
    ${whereClause}
    ORDER BY published_at DESC
    LIMIT ?
  `
  queryParams.push(limit + 1)

  const rows = db.prepare(query).all(...queryParams) as Array<{
    id: string
    sourceId: string
    authorName: string
    contentText: string
    permalink: string
    publishedAt: string
    mediaUrls: string
  }>

  const hasMore = rows.length > limit
  if (hasMore) rows.pop()
  const nextCursor = rows.length > 0 ? rows[rows.length - 1].publishedAt : null

  // 附加 sourceName
  const sourceMap = new Map(listSources().map((s) => [s.id, s.name]))

  const items: ItemSummary[] = rows.map((row) => ({
    id: row.id,
    sourceId: row.sourceId,
    sourceName: sourceMap.get(row.sourceId) ?? '未知源',
    authorName: row.authorName,
    contentText: row.contentText,
    permalink: row.permalink,
    publishedAt: row.publishedAt,
    mediaUrls: JSON.parse(row.mediaUrls || '[]'),
  }))

  return { items, hasMore, nextCursor }
}

// ---- search_items ----

export function handleSearchItems(params: SearchItemsParams): ListItemsResult {
  const query = (params.query ?? '').trim()
  if (!query) {
    return { items: [], hasMore: false, nextCursor: null }
  }

  const db = getDb()
  const limit = Math.min(Math.max(Number(params.limit ?? 20), 1), 100)
  const sourceIds = params.sourceIds
  const since = params.since
  const until = params.until

  const conditions: string[] = ['content_text LIKE ?']
  const queryParams: unknown[] = [`%${query}%`]

  if (sourceIds && sourceIds.length > 0) {
    const placeholders = sourceIds.map(() => '?').join(',')
    conditions.push(`source_id IN (${placeholders})`)
    queryParams.push(...sourceIds)
  }

  if (since) {
    conditions.push(`published_at >= ?`)
    queryParams.push(since)
  }
  if (until) {
    conditions.push(`published_at <= ?`)
    queryParams.push(until)
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`

  const sql = `
    SELECT id, source_id as sourceId, author_name as authorName,
           content_text as contentText, permalink, published_at as publishedAt,
           media_urls as mediaUrls
    FROM items
    ${whereClause}
    ORDER BY published_at DESC
    LIMIT ?
  `
  queryParams.push(limit)

  const rows = db.prepare(sql).all(...queryParams) as Array<{
    id: string
    sourceId: string
    authorName: string
    contentText: string
    permalink: string
    publishedAt: string
    mediaUrls: string
  }>

  const sourceMap = new Map(listSources().map((s) => [s.id, s.name]))

  const items: ItemSummary[] = rows.map((row) => ({
    id: row.id,
    sourceId: row.sourceId,
    sourceName: sourceMap.get(row.sourceId) ?? '未知源',
    authorName: row.authorName,
    contentText: row.contentText,
    permalink: row.permalink,
    publishedAt: row.publishedAt,
    mediaUrls: JSON.parse(row.mediaUrls || '[]'),
  }))

  return { items, hasMore: false, nextCursor: null }
}

// ---- get_item ----

const EXPAND_TIMEOUT_MS = 10_000

export async function handleGetItem(params: GetItemParams): Promise<GetItemResult> {
  const item = getItemById(params.id)
  if (!item) {
    throw new Error(`Item not found: ${params.id}`)
  }

  const sourceMap = new Map(listSources().map((s) => [s.id, s]))
  const source = sourceMap.get(item.sourceId)

  // 解析 metadata
  let metadata: Record<string, unknown> = {}
  try {
    metadata = JSON.parse(item.metadata || '{}')
  } catch {
    metadata = {}
  }

  const isTruncated = metadata.isTruncated === true

  // 未截断，直接返回
  if (!isTruncated) {
    return {
      item: toItemDetail(item, source?.name ?? '未知源'),
      isTruncated: false,
      expanded: false,
    }
  }

  // 被截断，尝试展开
  if (!source) {
    return {
      item: toItemDetail(item, '未知源'),
      isTruncated: true,
      expanded: false,
    }
  }

  const plugin = getPlugin(source.pluginId)
  if (!plugin || typeof plugin.fetchItemDetail !== 'function') {
    return {
      item: toItemDetail(item, source.name),
      isTruncated: true,
      expanded: false,
    }
  }

  // 解析 config
  let config: SourceConfig = {}
  try {
    config = JSON.parse(source.config as unknown as string) as SourceConfig
  } catch {
    config = {}
  }
  config = resolveCredentialFields(config, source.pluginId)

  // 带超时调用 fetchItemDetail
  try {
    const result = await withTimeout(
      plugin.fetchItemDetail(config, item.externalId),
      EXPAND_TIMEOUT_MS
    )

    if (result?.content?.text) {
      // 更新 DB：写回完整内容
      const db = getDb()
      const updatedMetadata = { ...metadata, isTruncated: false }
      db.prepare(
        `UPDATE items SET content_text = ?, content_html = ?, metadata = ? WHERE id = ?`
      ).run(
        result.content.text,
        result.content.html ?? item.contentHtml,
        JSON.stringify(updatedMetadata),
        item.id
      )

      // 返回更新后的内容
      return {
        item: {
          ...toItemDetail(item, source.name),
          contentText: result.content.text,
          contentHtml: result.content.html ?? item.contentHtml,
          metadata: updatedMetadata,
        },
        isTruncated: false,
        expanded: true,
      }
    }

    // 插件返回了但没有内容
    return {
      item: toItemDetail(item, source.name),
      isTruncated: true,
      expanded: false,
    }
  } catch {
    // 超时或出错，返回现有内容
    return {
      item: toItemDetail(item, source.name),
      isTruncated: true,
      expanded: false,
    }
  }
}

function toItemDetail(item: Item, sourceName: string): ItemDetail {
  return {
    id: item.id,
    sourceId: item.sourceId,
    sourceName,
    authorName: item.authorName,
    authorAvatar: item.authorAvatar,
    contentText: item.contentText,
    contentHtml: item.contentHtml,
    mediaUrls: JSON.parse(item.mediaUrls || '[]'),
    permalink: item.permalink,
    publishedAt: item.publishedAt,
    fetchedAt: item.fetchedAt,
    metadata: (() => {
      try {
        return JSON.parse(item.metadata || '{}')
      } catch {
        return {}
      }
    })(),
  }
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
