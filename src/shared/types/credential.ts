// ============================================================
// Credential — a reusable secret (e.g. cookie) shared across sources
// ============================================================

/** Origin of a credential — who last wrote it.
 *  'manual' = user pasted it in the UI; 'extension' = synced from the
 *  Chrome cookie-sync extension. Extension-synced credentials are not
 *  manually editable in the UI (the extension owns them). */
export type CredentialSource = 'manual' | 'extension'

/** Result of the last cookie sync attempt for a credential */
export type SyncStatus = 'success' | 'failed'

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
  /** Who last wrote this credential (manual paste vs extension sync) */
  source: CredentialSource
  /** Timestamp (ms epoch) of the last successful or failed sync attempt,
   *  or null if this credential was never synced (manually created). */
  lastSyncedAt: number | null
  /** Result of the last sync attempt, or null if never synced */
  lastSyncStatus: SyncStatus | null
  /** Error message from the last failed sync, or null */
  lastSyncError: string | null
}

/** Input for creating a new credential */
export interface AddCredentialInput {
  provider: string
  name: string
  value: string
  extra?: Record<string, unknown>
  source?: CredentialSource
  lastSyncedAt?: number | null
  lastSyncStatus?: SyncStatus | null
  lastSyncError?: string | null
}

/** Input for updating an existing credential */
export interface UpdateCredentialInput {
  name?: string
  value?: string
  extra?: Record<string, unknown>
  source?: CredentialSource
  lastSyncedAt?: number | null
  lastSyncStatus?: SyncStatus | null
  lastSyncError?: string | null
}
