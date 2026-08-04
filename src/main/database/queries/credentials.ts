import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../connection'
import { encrypt, decrypt } from '../../plugin-system/encryption'
import type { Credential, AddCredentialInput, UpdateCredentialInput, CredentialSource, SyncStatus } from '@shared/types/credential'

function rowToCredential(row: Record<string, unknown>): Credential {
  let extra: Record<string, unknown> = {}
  try {
    extra = JSON.parse(row.extra as string) as Record<string, unknown>
  } catch {
    extra = {}
  }
  return {
    id: row.id as string,
    provider: row.provider as string,
    name: row.name as string,
    value: decrypt(row.value as string),
    extra,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    source: (row.source as CredentialSource) ?? 'manual',
    lastSyncedAt: row.last_synced_at != null ? Number(row.last_synced_at) : null,
    lastSyncStatus: (row.last_sync_status as SyncStatus) ?? null,
    lastSyncError: (row.last_sync_error as string) ?? null,
  }
}

const SELECT_COLS = `id, provider, name, value, extra, created_at, updated_at, source, last_synced_at, last_sync_status, last_sync_error`

export function listCredentials(provider?: string): Credential[] {
  const db = getDb()
  const rows = provider
    ? db.prepare(`
        SELECT ${SELECT_COLS}
        FROM credentials WHERE provider = ? ORDER BY created_at ASC
      `).all(provider) as Record<string, unknown>[]
    : db.prepare(`
        SELECT ${SELECT_COLS}
        FROM credentials ORDER BY created_at ASC
      `).all() as Record<string, unknown>[]
  return rows.map(rowToCredential)
}

export function getCredentialById(id: string): Credential | undefined {
  const db = getDb()
  const row = db.prepare(`
    SELECT ${SELECT_COLS}
    FROM credentials WHERE id = ?
  `).get(id) as Record<string, unknown> | undefined
  return row ? rowToCredential(row) : undefined
}

export function addCredential(input: AddCredentialInput): Credential {
  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO credentials (id, provider, name, value, extra, created_at, updated_at, source, last_synced_at, last_sync_status, last_sync_error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.provider,
    input.name,
    encrypt(input.value),
    JSON.stringify(input.extra ?? {}),
    now,
    now,
    input.source ?? 'manual',
    input.lastSyncedAt ?? null,
    input.lastSyncStatus ?? null,
    input.lastSyncError ?? null,
  )

  return getCredentialById(id)!
}

export function updateCredential(id: string, data: UpdateCredentialInput): Credential {
  const db = getDb()
  const now = new Date().toISOString()

  const fields: string[] = []
  const values: unknown[] = []

  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
  if (data.value !== undefined) { fields.push('value = ?'); values.push(encrypt(data.value)) }
  if (data.extra !== undefined) { fields.push('extra = ?'); values.push(JSON.stringify(data.extra)) }
  if (data.source !== undefined) { fields.push('source = ?'); values.push(data.source) }
  if (data.lastSyncedAt !== undefined) { fields.push('last_synced_at = ?'); values.push(data.lastSyncedAt) }
  if (data.lastSyncStatus !== undefined) { fields.push('last_sync_status = ?'); values.push(data.lastSyncStatus) }
  if (data.lastSyncError !== undefined) { fields.push('last_sync_error = ?'); values.push(data.lastSyncError) }

  if (fields.length === 0) {
    return getCredentialById(id)!
  }

  fields.push('updated_at = ?')
  values.push(now)
  values.push(id)
  db.prepare(`UPDATE credentials SET ${fields.join(', ')} WHERE id = ?`).run(...values)

  return getCredentialById(id)!
}

export function removeCredential(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM credentials WHERE id = ?').run(id)
}

/** Count how many enabled sources reference a given credential.
 *  A source references a credential if its config stores the credential id
 *  as the value of any field. Scanned across all sources (credentials are
 *  now provider-scoped, so a credential may be used by sources of any plugin
 *  sharing that provider). */
export function countSourcesByCredentialId(credentialId: string): number {
  const db = getDb()
  const rows = db.prepare(`
    SELECT config FROM sources WHERE enabled = 1
  `).all() as { config: string }[]

  let count = 0
  for (const row of rows) {
    try {
      const config = JSON.parse(row.config) as Record<string, unknown>
      for (const key of Object.keys(config)) {
        if (config[key] === credentialId) {
          count++
          break
        }
      }
    } catch {
      // ignore malformed config
    }
  }
  return count
}
