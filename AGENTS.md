# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev            # Start dev server with HMR
npm run build          # Production build (electron-vite build)
npm run preview        # Preview production build locally
npm run package:mac    # Build and package for macOS (dmg + zip)
npm run package:win    # Build and package for Windows (nsis)
npm run package:linux  # Build and package for Linux (AppImage + deb)
```

There is no test suite yet — no test framework or test files exist in the project.

## Architecture

FeedFlow is an **Electron desktop app** (multi-source feed aggregator). It uses `electron-vite` as the build tool, which compiles three targets from `src/` into `out/`: **main** (Node), **preload** (Node), and **renderer** (browser).

### Three-Process Model

| Process | Entry | Runtime | Role |
|---------|-------|---------|------|
| Main | `src/main/index.ts` | Node.js | DB, plugin system, IPC handlers, MCP server, window management, cookie injection |
| Preload | `src/preload/index.ts` | Node (bridge) | Exposes `window.api` via `contextBridge`, plus event listeners for push events |
| Renderer | `src/renderer/src/main.tsx` → `App.tsx` | Chromium | React 18 UI, talks to main exclusively through the preload API |

### Plugin System (Core Abstraction)

Sources (信息源) are powered by **plugins**. Each plugin lives in a directory under `plugins/` and must:

1. Have a `package.json` with a `feedflow` field containing metadata (`id`, `name`, `version`, `description`, `author`, `color`)
2. Export a default object implementing the `FeedFlowPlugin` interface (`src/shared/types/plugin.ts`):
   - `meta` — static metadata (includes `provider`/`providerName` for credential sharing, `feedType` for timeline vs group-chat)
   - `configSchema` — form fields for configuring source instances (supports a `credential` field type that references stored credentials)
   - `fetchItems(config, cursor?)` → `FetchResult` — the core fetch logic
   - `fetchItemDetail?(config, externalId)` → `ItemDetailResult` — optional, used to inline-expand truncated items (e.g. long weibo posts)
   - Optional `onRegister`/`onUnregister` lifecycle hooks

**Plugin lifecycle:**
- `src/main/plugin-system/loader.ts` scans `plugins/` and `{userData}/plugins/` at startup, imports each plugin module, and registers valid ones
- `src/main/plugin-system/registry.ts` holds plugins in an in-memory `Map<string, FeedFlowPlugin>` and persists metadata to the `plugins` SQLite table
- `src/main/plugin-system/runner.ts` calls `plugin.fetchItems()` for each enabled source during refresh, upserts results into the DB, and pushes progress events to the renderer
- `src/main/plugin-system/credentials.ts` resolves `credential`-type config fields into their raw (decrypted) values before `fetchItems`/`fetchItemDetail` is called — plugins never see credential IDs

### Credentials System

Credentials (e.g. cookies) are stored encrypted in the `credentials` table and scoped to a **provider** (e.g. "weibo", "x") rather than a single plugin, so multiple plugins of the same provider can share one cookie.

- `src/main/plugin-system/encryption.ts` wraps Electron's `safeStorage` (falls back to plaintext when unavailable)
- `src/main/database/queries/credentials.ts` — CRUD
- `src/main/plugin-system/credentials.ts` — resolves credential references in source config to raw values
- At startup, `src/main/index.ts` loads the cookie for the weibo and X plugins and injects it into the Electron session so images/videos load with auth

### Refresh Lock

`src/main/plugin-system/refresh-lock.ts` maintains an in-memory `Set` of source IDs currently being refreshed. Both the UI refresh path (`runner.ts`) and the MCP `refresh_source` tool acquire this lock, so the same source is never refreshed concurrently. Sources that are already refreshing are skipped.

### Database

SQLite via `better-sqlite3` with WAL mode. The DB file is stored at `{userData}/feedflow.db`. Schema (`src/main/database/schema.ts`) has 6 tables: `plugins`, `sources`, `items`, `fetch_log`, `settings`, `credentials`. Queries are organized in `src/main/database/queries/` — each file is a standalone module that calls `getDb()` and runs prepared statements.

`initializeDatabase()` runs idempotent `CREATE TABLE IF NOT EXISTS` statements plus migrations (e.g. adding `feed_type` to `sources`, `provider` to `plugins`, and rebuilding `credentials` to replace `plugin_id` with `provider`).

### Settings

Key-value store in the `settings` table. `src/main/database/queries/settings.ts` provides `getSetting`/`setSetting`/`getAllSettings`. Exposed over IPC (`settings:get`, `settings:set`, `settings:get-all`) and used by the MCP server to read `mcp.enabled` / `mcp.port`. The renderer Settings page (`SettingsPage.tsx`) has tabs for credentials, plugins, and MCP.

### MCP Server

`src/main/mcp-server/` exposes FeedFlow data to local AI agents over the **Model Context Protocol** via HTTP transport (StreamableHTTPServerTransport), listening on `http://127.0.0.1:33939/mcp` by default. Started in `index.ts` after plugins load; startup failure is non-fatal.

Tools (defined in `src/main/mcp-server/tools/`):
- `list_sources` — list configured sources with item counts and last-fetched time
- `list_items` — paginated item listing (filter by source, time range; cursor-based pagination)
- `search_items` — full-text search over item content
- `get_item` — single item detail; auto-expands truncated items via `fetchItemDetail` (with a 10s timeout) and writes the full content back to the DB
- `refresh_source` — triggers a refresh (uses the same refresh lock as the UI; per-source timeout)

Configurable via settings (`mcp.enabled`, `mcp.port`) and the `McpPanel` in Settings. The panel shows the JSON config snippet to add to an MCP client.

### IPC Pattern

All main↔renderer communication goes through typed `ipcMain.handle` / `ipcRenderer.invoke` channels defined in `src/shared/types/ipc.ts`. The preload script (`src/preload/index.ts`) wraps each channel in a method on `window.api`. The renderer never calls `ipcRenderer` directly — it always goes through `window.api`.

Channel groups: `sources:*`, `plugins:*` (including `verify-cookie`, `list-groups`), `credentials:*`, `timeline:*` (list, refresh, load-older, get-item-detail), `settings:*`.

Main→renderer push events (refresh progress) use `webContents.send` and are wrapped as subscribe/unsubscribe helpers in preload.

### Renderer State

State management uses **zustand** with a single slice pattern. `src/renderer/src/store/sourceSlice.ts` defines the `SourceSlice` interface and creator, covering sources, plugins, timeline items, and refresh state. The store is created in `src/renderer/src/store/index.ts`. There is also a `credentialSlice.ts`.

### Key Path Aliases

Defined in `electron.vite.config.ts` and mirrored in tsconfig files:

- `@shared/*` → `src/shared/*` (available in all three processes)
- `@renderer/*` → `src/renderer/src/*` (renderer only)

### Shared Types

`src/shared/types/` contains cross-process type definitions. The `plugin.ts` file defines the `FeedFlowPlugin` interface — this is the core contract that all plugins must satisfy. Types are re-exported from `src/shared/types/index.ts`.

### UI Layout

The renderer uses an **AppShell** layout: a fixed sidebar (`Sidebar`) on the left and a scrollable main area (`TimelineView`) on the right. The sidebar shows the source list, plugin list, and a refresh button. The timeline shows fetched items with infinite scroll (IntersectionObserver-based).

Styling uses CSS Modules (`*.module.css` co-located with components).

### Plugins Directory

- `plugins/` — built-in plugins shipped with the app (included in `electron-builder.yml` `files`)
- `plugins-community/` — gitignored; intended for user-installed community plugins

## Release & Changelog

`CHANGELOG.md` is the source of truth for per-version release notes. The
[Release workflow](.github/workflows/release.yml) reads the section for the
version being released (via `scripts/extract-changelog-section.sh`) and uses it
as the GitHub Release body — so the notes shown on the release page always
match `CHANGELOG.md`.

### Changelog format

Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) +
[Semantic Versioning](https://semver.org/spec/v2.0.0.html):

- A `## [Unreleased]` section at the top accumulates changes as they land.
- Each released version has a `## [X.Y.Z] - YYYY-MM-DD` section.
- Changes are grouped under `### Added` / `### Changed` / `### Deprecated` /
  `### Removed` / `### Fixed` / `### Security`.
- Link-reference comparison links live at the bottom of the file.

### How to maintain it

- As you develop, add entries to `## [Unreleased]` under the right category.
  This is part of the definition of done for a change — don't rely on memory at
  release time.

### Cutting a release

1. In `CHANGELOG.md`, rename `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`
   (use the actual release date) and add a fresh empty `## [Unreleased]` above
   it. Update the comparison links at the bottom.
2. Bump `version` in `package.json` to `X.Y.Z` (must match the tag you'll push).
3. Commit both changes (e.g. `chore: release vX.Y.Z`).
4. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`. The Release
   workflow triggers on the tag, verifies `package.json` matches, builds all
   platforms, extracts the `## [X.Y.Z]` section from `CHANGELOG.md`, and
   publishes it as the GitHub Release body.

If the `## [X.Y.Z]` section is missing from `CHANGELOG.md`, the extraction
script exits non-zero and the release fails — this enforces that changelog
entries are written before release.
