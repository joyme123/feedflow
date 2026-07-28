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
| Main | `src/main/index.ts` | Node.js | DB, plugin system, IPC handlers, window management |
| Preload | `src/preload/index.ts` | Node (bridge) | Exposes `window.api` via `contextBridge`, plus event listeners for push events |
| Renderer | `src/renderer/src/main.tsx` → `App.tsx` | Chromium | React 18 UI, talks to main exclusively through the preload API |

### Plugin System (Core Abstraction)

Sources (信息源) are powered by **plugins**. Each plugin lives in a directory under `plugins/` and must:

1. Have a `package.json` with a `feedflow` field containing metadata (`id`, `name`, `version`, `description`, `author`, `color`)
2. Export a default object implementing the `FeedFlowPlugin` interface (`src/shared/types/plugin.ts`):
   - `meta` — static metadata
   - `configSchema` — form fields for configuring source instances
   - `fetchItems(config, cursor?)` → `FetchResult` — the core fetch logic
   - Optional `onRegister`/`onUnregister` lifecycle hooks

**Plugin lifecycle:**
- `src/main/plugin-system/loader.ts` scans `plugins/` and `{userData}/plugins/` at startup, imports each plugin module, and registers valid ones
- `src/main/plugin-system/registry.ts` holds plugins in an in-memory `Map<string, FeedFlowPlugin>` and persists metadata to the `plugins` SQLite table
- `src/main/plugin-system/runner.ts` calls `plugin.fetchItems()` for each enabled source during refresh, upserts results into the DB, and pushes progress events to the renderer

### Database

SQLite via `better-sqlite3` with WAL mode. The DB file is stored at `{userData}/feedflow.db`. Schema (`src/main/database/schema.ts`) has 5 tables: `plugins`, `sources`, `items`, `fetch_log`, `settings`. Queries are organized in `src/main/database/queries/` — each file is a standalone module that calls `getDb()` and runs prepared statements.

### IPC Pattern

All main↔renderer communication goes through typed `ipcMain.handle` / `ipcRenderer.invoke` channels defined in `src/shared/types/ipc.ts`. The preload script (`src/preload/index.ts`) wraps each channel in a method on `window.api`. The renderer never calls `ipcRenderer` directly — it always goes through `window.api`.

Main→renderer push events (refresh progress) use `webContents.send` and are wrapped as subscribe/unsubscribe helpers in preload.

### Renderer State

State management uses **zustand** with a single slice pattern. `src/renderer/src/store/sourceSlice.ts` defines the `SourceSlice` interface and creator, covering sources, plugins, timeline items, and refresh state. The store is created in `src/renderer/src/store/index.ts`.

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
