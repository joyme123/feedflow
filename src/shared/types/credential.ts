// ============================================================
// Credential — a reusable secret (e.g. cookie) shared across sources
// ============================================================

/** A stored credential (e.g. a cookie) belonging to a plugin */
export interface Credential {
  id: string
  pluginId: string
  name: string
  value: string
  extra: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** Input for creating a new credential */
export interface AddCredentialInput {
  pluginId: string
  name: string
  value: string
  extra?: Record<string, unknown>
}

/** Input for updating an existing credential */
export interface UpdateCredentialInput {
  name?: string
  value?: string
  extra?: Record<string, unknown>
}
