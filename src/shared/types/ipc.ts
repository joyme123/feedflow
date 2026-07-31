import type { Source, AddSourceInput } from './source'
import type { Item, DisplayItem, TimelineListParams, RefreshProgress } from './item'
import type { PluginMeta, ConfigField, ItemDetailResult } from './plugin'
import type { Credential, AddCredentialInput, UpdateCredentialInput } from './credential'

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
  'plugins:list-groups': { in: { pluginId: string; credentialId: string }; out: { label: string; value: string }[] }

  'credentials:list': { in: { provider?: string } | void; out: Credential[] }
  'credentials:add': { in: AddCredentialInput; out: Credential }
  'credentials:update': { in: { id: string; data: UpdateCredentialInput }; out: Credential }
  'credentials:remove': { in: string; out: void }
  'credentials:count-references': { in: { credentialId: string }; out: { count: number } }

  'timeline:list': { in: TimelineListParams; out: { items: Item[]; hasMore: boolean; nextCursor: string | null } }
  'timeline:refresh': { in: { sourceIds?: string[] }; out: { totalFetched: number } }
  'timeline:load-older': {
    in: { sourceId: string; maxId: string }
    out: {
      items: DisplayItem[]
      totalFetched: number
      nextMaxId: string
      hasMore: boolean
    }
  }
  'timeline:get-item-detail': {
    in: { itemId: string }
    out: ItemDetailResult
  }

  // Auto-updates
  'updates:check': { in: void; out: void }
  'updates:quit-and-install': { in: void; out: void }
}

/** 自动更新状态 */
export type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

/** 自动更新信息 */
export interface UpdateInfo {
  version: string
  releaseNotes?: string | null
}

/** 下载进度 */
export interface DownloadProgress {
  percent: number
  bytesPerSecond: number
  total: number
  transferred: number
}

/** Events pushed from main to renderer */
export interface MainToRendererEvents {
  'refresh:progress': RefreshProgress
  'refresh:complete': { sourceId: string; itemsFetched: number }
  'refresh:all-complete': { totalItems: number }

  // Auto-updates
  'update:checking': void
  'update:available': UpdateInfo
  'update:not-available': void
  'update:download-progress': DownloadProgress
  'update:downloaded': UpdateInfo
  'update:error': { message: string }
}
