import type { SourceConfig } from './plugin'

/** A user-configured information source */
export interface Source {
  id: string
  pluginId: string
  name: string
  config: SourceConfig
  enabled: boolean
  sortOrder: number
  cursorValue: string | null
  createdAt: string
  updatedAt: string
}

/** Input for creating a new source */
export interface AddSourceInput {
  pluginId: string
  name: string
  config: SourceConfig
}
