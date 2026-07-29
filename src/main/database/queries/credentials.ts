import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../connection'
import { encrypt, decrypt } from '../../plugin-system/encryption'
import type { Credential, AddCredentialInput, UpdateCredentialInput } from '@shared/types/credential'

function rowToCredential(row: Record<string, unknown>): Credential {
  let extra: Record<string, unknown> = {}
  try {
    extra = JSON.parse(row.extra as string) as Record<string, unknown>
  } catch {
    extra = {}
  }
  return {
    id: row.id as string,
    pluginId: row.plugin_id as string,
    name: row.name as string,
    value: decrypt(row.value as string),
    extra,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  }
}

export function listCredentials(pluginId?: string): Credential[] {
  const db = getDb()
  const rows = pluginId
    ? db.prepare(`
        SELECT id, plugin_id, name, value, extra, created_at, updated_at
        FROM credentials WHERE plugin_id = ? ORDER BY created_at ASC
      `).all(pluginId) as Record<string, unknown>[]
    : db.prepare(`
        SELECT id, plugin_id, name, value, extra, created_at, updated_at
        FROM credentials ORDER BY created_at ASC
      `).all() as Record<string, unknown>[]
  return rows.map(rowToCredential)
}

export function getCredentialById(id: string): Credential | undefined {
  const db = getDb()
  const row = db.prepare(`
    SELECT id, plugin_id, name, value, extra, created_at, updated_at
    FROM credentials WHERE id = ?
  `).get(id) as Record<string, unknown> | undefined
  return row ? rowToCredential(row) : undefined
}

export function addCredential(input: AddCredentialInput): Credential {
  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO credentials (id, plugin_id, name, value, extra, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.pluginId, input.name, encrypt(input.value), JSON.stringify(input.extra ?? {}), now, now)

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

/** Count how many enabled sources of a plugin reference a given credential.
 *  Used to warn before deleting a credential that is still in use. */
export function countSourcesByCredentialId(pluginId: string, credentialId: string): number {
  const db = getDb()
  const rows = db.prepare(`
    SELECT config FROM sources WHERE plugin_id = ? AND enabled = 1
  `).all(pluginId) as { config: string }[]

  let count = 0
  for (const row of rows) {
    try {
      const config = JSON.parse(row.config) as Record<string, unknown>
      // A credential-type field stores the credential id as its value.
      // Scan all values; any string equal to credentialId counts as a reference.
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
