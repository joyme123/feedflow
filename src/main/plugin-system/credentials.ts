// ============================================================
// Credential resolution — turn credential references in source config
// into their raw values before calling plugin.fetchItems().
//
// This keeps the plugin interface unchanged: plugins still read
// config.cookie etc. Resolution is transparent. If a reference doesn't
// resolve to a known credential (e.g. a legacy raw cookie string), the
// original value is left in place (backward compatibility).
// ============================================================

import { get as getPlugin } from './registry'
import { getCredentialById } from '../database/queries/credentials'
import type { SourceConfig } from '@shared/types/plugin'

export function resolveCredentialFields(config: SourceConfig, pluginId: string): SourceConfig {
  const plugin = getPlugin(pluginId)
  if (!plugin) return config

  const resolved = { ...config }
  for (const field of plugin.configSchema) {
    if (field.type !== 'credential') continue

    const ref = resolved[field.key]
    if (typeof ref !== 'string' || !ref) continue

    const cred = getCredentialById(ref)
    resolved[field.key] = cred ? cred.value : undefined
  }
  return resolved
}
