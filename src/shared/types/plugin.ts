// ============================================================
// Plugin Interface — the core contract every plugin must satisfy
// ============================================================

/** Feed type determines how a source's items are displayed.
 *  'timeline' = regular feed (default, included in aggregated feed)
 *  'group-chat' = conversational group chat (excluded from aggregated feed, viewed separately) */
export type FeedType = 'timeline' | 'group-chat'

/** Static metadata describing a plugin */
export interface PluginMeta {
  id: string
  name: string
  version: string
  description: string
  author: string
  icon?: string
  color?: string
  homepage?: string
  feedType?: FeedType
}

/** A single configuration field rendered as a form input */
export interface ConfigField {
  key: string
  label: string
  type: 'text' | 'number' | 'password' | 'select' | 'boolean' | 'text-area' | 'credential'
  required?: boolean
  default?: unknown
  placeholder?: string
  options?: { label: string; value: string }[]
  min?: number
  max?: number
  helpText?: string
}

/** User-provided config for a source instance */
export type SourceConfig = Record<string, unknown>

/** One item fetched from a source */
export interface TimelineItem {
  externalId: string
  author: {
    name: string
    avatarUrl?: string
    profileUrl?: string
  }
  content: {
    text: string
    html?: string
  }
  mediaUrls: string[]
  permalink: string
  publishedAt: string
  metadata?: Record<string, unknown>
}

/** Returned by plugin.fetchItems() */
export interface FetchResult {
  items: TimelineItem[]
  nextCursor: string | null
}

/** Context injected into plugin lifecycle hooks */
export interface PluginContext {
  db: {
    getSourceConfig(sourceId: string): SourceConfig
    saveItem(sourceId: string, item: TimelineItem): Promise<void>
  }
  logger: {
    info(msg: string, ...args: unknown[]): void
    warn(msg: string, ...args: unknown[]): void
    error(msg: string, ...args: unknown[]): void
  }
  appDataPath: string
}

/** The core plugin interface. Each plugin exports this as its default. */
export interface FeedFlowPlugin {
  meta: PluginMeta
  configSchema: ConfigField[]
  fetchItems(config: SourceConfig, cursor?: string): Promise<FetchResult>
  onRegister?(ctx: PluginContext): Promise<void>
  onUnregister?(): Promise<void>
}
