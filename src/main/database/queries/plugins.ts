import { getDb } from '../connection'

interface PluginRow {
  id: string
  name: string
  version: string
  description: string
  entry_path: string
  enabled: number
  installed_at: string
  updated_at: string
}

export function listPlugins(): PluginRow[] {
  const db = getDb()
  return db.prepare(`
    SELECT id, name, version, description, entry_path, enabled, installed_at, updated_at
    FROM plugins ORDER BY name ASC
  `).all() as PluginRow[]
}

export function getPlugin(id: string): PluginRow | undefined {
  const db = getDb()
  return db.prepare(`
    SELECT id, name, version, description, entry_path, enabled, installed_at, updated_at
    FROM plugins WHERE id = ?
  `).get(id) as PluginRow | undefined
}

export function registerPlugin(plugin: {
  id: string
  name: string
  version: string
  description: string
  entryPath: string
}): void {
  const db = getDb()
  const now = new Date().toISOString()
  // 使用 INSERT OR IGNORE 避免 INSERT OR REPLACE 触发级联删除 (ON DELETE CASCADE)
  // 已存在的插件只更新 version/description/entry_path/updated_at，不删除记录
  const existing = db.prepare('SELECT id FROM plugins WHERE id = ?').get(plugin.id)
  if (existing) {
    db.prepare(`
      UPDATE plugins SET name = ?, version = ?, description = ?, entry_path = ?, updated_at = ?
      WHERE id = ?
    `).run(plugin.name, plugin.version, plugin.description, plugin.entryPath, now, plugin.id)
  } else {
    db.prepare(`
      INSERT INTO plugins (id, name, version, description, entry_path, enabled, installed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `).run(plugin.id, plugin.name, plugin.version, plugin.description, plugin.entryPath, now, now)
  }
}

export function setPluginEnabled(id: string, enabled: boolean): void {
  const db = getDb()
  const now = new Date().toISOString()
  db.prepare('UPDATE plugins SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, now, id)
}
