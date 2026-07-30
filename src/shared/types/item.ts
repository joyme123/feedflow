/** A timeline item as stored in the database */
export interface Item {
  id: string
  sourceId: string
  pluginId: string
  externalId: string
  authorName: string
  authorAvatar: string
  contentText: string
  contentHtml: string
  mediaUrls: string
  permalink: string
  publishedAt: string
  fetchedAt: string
  cursorValue: string
  metadata: string
}

/** Parameters for listing timeline items */
export interface TimelineListParams {
  limit?: number
  cursor?: string | null
  sourceIds?: string[]
}

/** A timeline item formatted for display */
export interface DisplayItem {
  id: string
  sourceId: string
  pluginId: string
  pluginName: string
  pluginColor: string
  feedType: string
  externalId: string
  authorName: string
  authorAvatar: string
  contentText: string
  contentHtml: string
  mediaUrls: string[]
  permalink: string
  publishedAt: string
  fetchedAt: string
  metadata: string
}

/** Fetch log entry */
export interface FetchLogEntry {
  id: number
  sourceId: string
  status: 'success' | 'partial' | 'error'
  itemsFetched: number
  errorMessage: string | null
  startedAt: string
  finishedAt: string | null
}

/** Refresh progress event payload */
export interface RefreshProgress {
  sourceId: string
  sourceName: string
  status: 'fetching' | 'storing' | 'done' | 'error'
  error?: string
}
