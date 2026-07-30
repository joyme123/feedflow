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
      provider    TEXT NOT NULL DEFAULT '',
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
  `)

  // Migration: add feed_type column to existing sources table if not present
  try {
    db.exec(`ALTER TABLE sources ADD COLUMN feed_type TEXT NOT NULL DEFAULT 'timeline'`)
  } catch {
    // Column already exists, ignore
  }

  // Migration: add provider column to existing plugins table if not present
  try {
    const cols = db.prepare("PRAGMA table_info(plugins)").all() as { name: string }[]
    if (!cols.some((c) => c.name === 'provider')) {
      db.exec(`ALTER TABLE plugins ADD COLUMN provider TEXT NOT NULL DEFAULT ''`)
    }
  } catch (err) {
    console.error('[Schema] plugins provider migration failed:', err)
  }

  // Migration: credentials.plugin_id -> credentials.provider
  // Existing credentials were scoped to a plugin; re-scope them to the
  // plugin's provider so they can be shared across plugins of the same
  // service provider (e.g. 微博关注流 + 微博群聊 -> "weibo").
  //
  // We rebuild the table to also drop the old plugin_id column and its
  // FOREIGN KEY ... ON DELETE CASCADE constraint (which would otherwise
  // cascade-delete credentials when a plugin is removed).
  //
  // Handles all starting states:
  //   - old DB: credentials has plugin_id, no provider
  //   - intermediate DB (previous migration): credentials has both
  //   - new DB: credentials has provider only (skip)
  // Also cleans up a leftover credentials_new from a failed prior run.
  try {
    const credCols = db.prepare("PRAGMA table_info(credentials)").all() as { name: string }[]
    const hasPluginId = credCols.some((c) => c.name === 'plugin_id')
    if (!hasPluginId) {
      // Already migrated (or fresh). Just ensure no leftover temp table.
      db.exec(`DROP TABLE IF EXISTS credentials_new`)
    } else {
      db.exec(`DROP TABLE IF EXISTS credentials_new`)
      db.exec(`
        CREATE TABLE credentials_new (
          id          TEXT PRIMARY KEY,
          provider    TEXT NOT NULL,
          name        TEXT NOT NULL,
          value       TEXT NOT NULL,
          extra       TEXT NOT NULL DEFAULT '{}',
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `)
      // Backfill provider from the plugins table (real provider if set,
      // else fall back to the plugin id so the credential isn't lost).
      // The plugins migration above guarantees p.provider exists.
      db.exec(`
        INSERT INTO credentials_new (id, provider, name, value, extra, created_at, updated_at)
        SELECT c.id,
               COALESCE(NULLIF(p.provider, ''), c.plugin_id),
               c.name, c.value, c.extra, c.created_at, c.updated_at
        FROM credentials c
        LEFT JOIN plugins p ON p.id = c.plugin_id
      `)
      db.exec(`DROP TABLE credentials`)
      db.exec(`ALTER TABLE credentials_new RENAME TO credentials`)
      db.exec(`CREATE INDEX idx_credentials_provider ON credentials(provider)`)
    }
  } catch (err) {
    console.error('[Schema] credentials provider migration failed:', err)
  }

  // By now credentials always has a provider column (fresh or migrated).
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_credentials_provider ON credentials(provider)`)
  } catch (err) {
    console.error('[Schema] credentials index creation failed:', err)
  }
}
