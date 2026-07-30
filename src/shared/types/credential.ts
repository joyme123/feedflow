// ============================================================
// Credential — a reusable secret (e.g. cookie) shared across sources
// ============================================================

/** A stored credential (e.g. a cookie) scoped to a service provider.
 *  Multiple plugins of the same provider (e.g. 微博关注流 + 微博群聊)
 *  can share the same credential. */
export interface Credential {
  id: string
  provider: string
  name: string
  value: string
  extra: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

/** Input for creating a new credential */
export interface AddCredentialInput {
  provider: string
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
