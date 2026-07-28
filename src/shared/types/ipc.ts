import type { Source, AddSourceInput } from './source'
import type { Item, TimelineListParams, RefreshProgress } from './item'
import type { PluginMeta, ConfigField } from './plugin'

/** Typed IPC channel map */
export interface IpcChannelMap {
  'sources:list': { in: void; out: Source[] }
  'sources:add': { in: AddSourceInput; out: Source }
  'sources:remove': { in: string; out: void }
  'sources:update': { in: { id: string; data: Partial<Source> }; out: Source }
  'sources:toggle': { in: string; out: Source }

  'plugins:list': { in: void; out: PluginMeta[] }
  'plugins:get-config-schema': { in: string; out: ConfigField[] }
  'plugins:verify-cookie': { in: { pluginId: string; cookie: string }; out: { valid: boolean; uid?: string; screenName?: string; error?: string } }

  'timeline:list': { in: TimelineListParams; out: { items: Item[]; hasMore: boolean; nextCursor: string | null } }
  'timeline:refresh': { in: { sourceIds?: string[] }; out: { totalFetched: number } }
  'timeline:load-older': { in: { sourceId: string; maxId: string }; out: { totalFetched: number } }
}

/** Events pushed from main to renderer */
export interface MainToRendererEvents {
  'refresh:progress': RefreshProgress
  'refresh:complete': { sourceId: string; itemsFetched: number }
  'refresh:all-complete': { totalItems: number }
}
