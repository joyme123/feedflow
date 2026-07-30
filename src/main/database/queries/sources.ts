import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../connection'
import { get } from '../../plugin-system/registry'
import type { Source, AddSourceInput } from '@shared/types/source'

export function listSources(): Source[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT id, plugin_id as pluginId, name, config, enabled, sort_order as sortOrder,
           cursor_value as cursorValue, feed_type as feedType,
           created_at as createdAt, updated_at as updatedAt
    FROM sources ORDER BY sort_order ASC, created_at ASC
  `).all() as Source[]
  return rows
}

export function getSourceById(id: string): Source | undefined {
  const db = getDb()
  return db.prepare(`
    SELECT id, plugin_id as pluginId, name, config, enabled, sort_order as sortOrder,
           cursor_value as cursorValue, feed_type as feedType,
           created_at as createdAt, updated_at as updatedAt
    FROM sources WHERE id = ?
  `).get(id) as Source | undefined
}

export function addSource(input: AddSourceInput): Source {
  const db = getDb()
  const id = uuidv4()
  const now = new Date().toISOString()

  // Inherit feedType from the plugin's meta (default: 'timeline')
  const plugin = get(input.pluginId)
  const feedType = plugin?.meta.feedType || 'timeline'

  db.prepare(`
    INSERT INTO sources (id, plugin_id, name, config, sort_order, feed_type, created_at, updated_at)
    VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM sources), ?, ?, ?)
  `).run(id, input.pluginId, input.name, JSON.stringify(input.config), feedType, now, now)

  return getSourceById(id)!
}

export function removeSource(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM sources WHERE id = ?').run(id)
}

export function updateSource(id: string, data: Partial<Source>): Source {
  const db = getDb()
  const now = new Date().toISOString()

  const fields: string[] = []
  const values: unknown[] = []

  if (data.name !== undefined) { fields.push('name = ?'); values.push(data.name) }
  if (data.config !== undefined) { fields.push('config = ?'); values.push(JSON.stringify(data.config)) }
  if (data.enabled !== undefined) { fields.push('enabled = ?'); values.push(data.enabled ? 1 : 0) }
  if (data.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(data.sortOrder) }
  if (data.cursorValue !== undefined) { fields.push('cursor_value = ?'); values.push(data.cursorValue) }
  if (data.feedType !== undefined) { fields.push('feed_type = ?'); values.push(data.feedType) }

  if (fields.length > 0) {
    fields.push('updated_at = ?')
    values.push(now)
    values.push(id)
    db.prepare(`UPDATE sources SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  }

  return getSourceById(id)!
}

export function toggleSource(id: string): Source {
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare(`
    UPDATE sources SET enabled = CASE WHEN enabled = 1 THEN 0 ELSE 1 END, updated_at = ? WHERE id = ?
  `).run(now, id)
  return getSourceById(id)!
}

export function getEnabledSources(pluginId?: string): Source[] {
  const db = getDb()
  if (pluginId) {
    return db.prepare(`
      SELECT id, plugin_id as pluginId, name, config, enabled, sort_order as sortOrder,
             cursor_value as cursorValue, feed_type as feedType,
             created_at as createdAt, updated_at as updatedAt
      FROM sources WHERE enabled = 1 AND plugin_id = ? ORDER BY sort_order ASC
    `).all(pluginId) as Source[]
  }
  return db.prepare(`
    SELECT id, plugin_id as pluginId, name, config, enabled, sort_order as sortOrder,
           cursor_value as cursorValue, feed_type as feedType,
           created_at as createdAt, updated_at as updatedAt
    FROM sources WHERE enabled = 1 ORDER BY sort_order ASC
  `).all() as Source[]
}
