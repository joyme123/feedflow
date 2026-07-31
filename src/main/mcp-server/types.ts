/**
 * MCP Server 工具的输入输出类型定义
 * 这些类型面向 agent，不暴露内部实现细节
 */

// ---- list_sources ----

export interface ListSourcesParams {
  enabled?: boolean
}

export interface SourceInfo {
  id: string
  name: string
  feedType: 'timeline' | 'group-chat'
  enabled: boolean
  itemCount: number
  lastFetchedAt: string | null
  createdAt: string
}

export interface ListSourcesResult {
  sources: SourceInfo[]
}

// ---- list_items ----

export interface ListItemsParams {
  sourceIds?: string[]
  limit?: number
  cursor?: string
  since?: string
  until?: string
}

export interface ItemSummary {
  id: string
  sourceId: string
  sourceName: string
  authorName: string
  contentText: string
  permalink: string
  publishedAt: string
  mediaUrls: string[]
}

export interface ListItemsResult {
  items: ItemSummary[]
  hasMore: boolean
  nextCursor: string | null
}

// ---- search_items ----

export interface SearchItemsParams {
  query: string
  sourceIds?: string[]
  limit?: number
  since?: string
  until?: string
}

// search 结果与 list_items 相同
export type SearchItemsResult = ListItemsResult

// ---- get_item ----

export interface GetItemParams {
  id: string
}

export interface ItemDetail {
  id: string
  sourceId: string
  sourceName: string
  authorName: string
  authorAvatar: string
  contentText: string
  contentHtml: string
  mediaUrls: string[]
  permalink: string
  publishedAt: string
  fetchedAt: string
  metadata: Record<string, unknown>
}

export interface GetItemResult {
  item: ItemDetail
  isTruncated: boolean
  expanded: boolean
}

// ---- refresh_source ----

export interface RefreshSourceParams {
  sourceIds?: string[]
  timeout?: number
}

export interface RefreshResultItem {
  sourceId: string
  sourceName: string
  status: 'success' | 'error' | 'skipped' | 'timeout'
  itemsFetched: number
  error?: string
}

export interface RefreshSourceResult {
  refreshed: RefreshResultItem[]
  totalFetched: number
}
