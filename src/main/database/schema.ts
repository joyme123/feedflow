import { getDb } from './connection'

export function initializeDatabase(): void {
  const db = getDb()

  db.exec(`
    CREATE TABLE IF NOT EXISTS plugins (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      version     TEXT NOT NULL,
      description TEXT DEFAULT '',
      entry_path  TEXT NOT NULL,
      enabled     INTEGER NOT NULL DEFAULT 1,
      installed_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sources (
      id            TEXT PRIMARY KEY,
      plugin_id     TEXT NOT NULL,
      name          TEXT NOT NULL,
      config        TEXT NOT NULL DEFAULT '{}',
      enabled       INTEGER NOT NULL DEFAULT 1,
      sort_order    INTEGER NOT NULL DEFAULT 0,
      cursor_value  TEXT,
      feed_type     TEXT NOT NULL DEFAULT 'timeline',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (plugin_id) REFERENCES plugins(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS items (
      id            TEXT PRIMARY KEY,
      source_id     TEXT NOT NULL,
      plugin_id     TEXT NOT NULL,
      external_id   TEXT NOT NULL,
      author_name   TEXT DEFAULT '',
      author_avatar TEXT DEFAULT '',
      content_text  TEXT DEFAULT '',
      content_html  TEXT DEFAULT '',
      media_urls    TEXT NOT NULL DEFAULT '[]',
      permalink     TEXT DEFAULT '',
      published_at  TEXT DEFAULT '',
      fetched_at    TEXT NOT NULL DEFAULT (datetime('now')),
      cursor_value  TEXT DEFAULT '',
      metadata      TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE,
      UNIQUE(source_id, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_items_source ON items(source_id);
    CREATE INDEX IF NOT EXISTS idx_items_published ON items(published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_items_fetched ON items(fetched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_items_source_published ON items(source_id, published_at DESC);

    CREATE TABLE IF NOT EXISTS fetch_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id     TEXT NOT NULL,
      status        TEXT NOT NULL CHECK(status IN ('success','partial','error')),
      items_fetched INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      started_at    TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at   TEXT,
      FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_fetch_log_source ON fetch_log(source_id, started_at DESC);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS credentials (
      id          TEXT PRIMARY KEY,
      provider    TEXT NOT NULL,
      name        TEXT NOT NULL,
      value       TEXT NOT NULL,
      extra       TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_credentials_provider ON credentials(provider);
  `)

  // Migration: add feed_type column to existing sources table if not present
  try {
    db.exec(`ALTER TABLE sources ADD COLUMN feed_type TEXT NOT NULL DEFAULT 'timeline'`)
  } catch {
    // Column already exists, ignore
  }

  // Migration: credentials.plugin_id -> credentials.provider
  // Existing credentials were scoped to a plugin; re-scope them to the
  // plugin's provider (defaulting to the plugin id) so they can be shared
  // across plugins of the same service provider.
  try {
    const cols = db.prepare("PRAGMA table_info(credentials)").all() as { name: string }[]
    const hasPluginId = cols.some((c) => c.name === 'plugin_id')
    const hasProvider = cols.some((c) => c.name === 'provider')
    if (hasPluginId && !hasProvider) {
      db.exec(`ALTER TABLE credentials ADD COLUMN provider TEXT`)
      // Backfill: use the plugin's provider if known, else the plugin id.
      // (plugins table doesn't store provider yet; fall back to plugin_id.)
      db.exec(`UPDATE credentials SET provider = plugin_id WHERE provider IS NULL`)
      db.exec(`CREATE INDEX IF NOT EXISTS idx_credentials_provider ON credentials(provider)`)
    }
  } catch (err) {
    console.error('[Schema] credentials provider migration failed:', err)
  }
}
