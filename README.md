# FeedFlow

多源信息流聚合桌面应用 (multi-source feed aggregator desktop app).

FeedFlow is an Electron desktop app that aggregates feeds from multiple sources
(微博 / X / V2EX / GitHub Trending / Hacker News / Product Hunt / …) into a single timeline. Each source is powered by a
plugin, and the app also exposes an MCP server so local AI agents can query the
aggregated data.

## Features

- **Multi-source timeline** — unify 微博, X, V2EX, GitHub Trending, Hacker News, Product Hunt and custom sources into one feed
- **Plugin system** — sources are plugins; drop a new one into `plugins/` (or install a zip / `{userData}/plugins/`)
- **Companion Chrome extension** — auto-syncs browser cookies for cookie-based sources (微博, X), with self-healing re-sync
- **Encrypted credentials** — cookies/credentials are stored encrypted (Electron `safeStorage`) and shared across plugins of the same provider
- **MCP server** — exposes `list_sources`, `list_items`, `search_items`, `get_item`, `refresh_source` over the Model Context Protocol (HTTP) at `http://127.0.0.1:33939/mcp`
- **Truncated-item expansion** — long posts (e.g. long weibo) are auto-expanded inline
- **Cross-platform packaging** — macOS (dmg + zip), Windows (nsis), Linux (AppImage + deb)

## Download

Grab the latest installer from [GitHub Releases](https://github.com/joyme123/feedflow/releases/latest):

| Platform | Asset |
|----------|-------|
| macOS (Apple Silicon) | `*-arm64.dmg` |
| macOS (Intel) | `*-x64.dmg` |
| Windows (x64) | `*.exe` (NSIS installer) |
| Linux (x64) | `*.AppImage` or `*.deb` |

After install the app keeps itself up to date via `electron-updater`. Prefer
building yourself? See [Getting Started](#getting-started).

## Chrome Extension (Cookie Sync)

Sources that authenticate with **browser cookies** — currently 微博 and X —
need their cookies imported into FeedFlow. The companion extension
**FeedFlow Cookie Sync** does this automatically:

👉 **[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/akacicfiihjhcjeifgibmhkobcaehiii)**

- watches cookie changes and pushes the freshest cookies to the desktop app
  over localhost (debounced 5 s; no manual copy-paste)
- self-healing: when the desktop app detects an expired cookie, the extension
  re-syncs within a heartbeat and can rotate cookies via a hidden background
  tab; a forced re-sync runs every 10 minutes
- a popup showing per-source auth / cookie / sync status, with manual sync

Sources that use a token (V2EX, Product Hunt) or need no auth at all
(GitHub Trending, Hacker News) do **not** require the extension.
Extension source and development setup live in
[`extensions/cookie-sync/`](./extensions/cookie-sync/).

## Tech Stack

- **Runtime:** Electron 31 (Node.js main/preload + Chromium renderer)
- **Build:** [electron-vite](https://electron-vite.org/) (compiles main / preload / renderer)
- **UI:** React 18 + CSS Modules, state via [zustand](https://github.com/pmndrs/zustand)
- **Storage:** SQLite via `better-sqlite3` (WAL mode)
- **AI integration:** `@modelcontextprotocol/sdk` (StreamableHTTPServerTransport)

## Getting Started

```bash
# install dependencies
npm install

# start dev server with HMR
npm run dev
```

### Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server with HMR |
| `npm run build` | Production build (electron-vite build) |
| `npm run preview` | Preview production build locally |
| `npm run package:mac` | Build and package for macOS (dmg + zip) |
| `npm run package:win` | Build and package for Windows (nsis) |
| `npm run package:linux` | Build and package for Linux (AppImage + deb) |

## Project Structure

```
feedflow/
├── src/
│   ├── main/              # Electron main process (Node.js)
│   │   ├── index.ts       # entry: DB, plugins, IPC, MCP server, window mgmt
│   │   ├── database/      # SQLite schema + queries
│   │   ├── plugin-system/ # loader, registry, runner, credentials, refresh-lock
│   │   └── mcp-server/    # MCP server + tools
│   ├── preload/           # contextBridge → window.api
│   ├── renderer/          # React 18 UI (AppShell: Sidebar + TimelineView)
│   └── shared/            # cross-process types (FeedFlowPlugin, IPC channels, …)
├── plugins/               # built-in plugins (shipped with the app)
│   ├── weibo-home-timeline/
│   ├── weibo-group-chat/
│   ├── x-home-timeline/
│   ├── v2ex/
│   ├── github-trending/
│   ├── hacker-news/
│   ├── product-hunt/
│   └── mock-source/
├── extensions/cookie-sync/  # companion Chrome extension (cookie sync)
├── docs/                  # design docs for plugins / MCP server / signing
├── electron.vite.config.ts
├── electron-builder.yml
└── AGENTS.md              # detailed architecture & coding guidance
```

## Architecture Overview

FeedFlow uses Electron's three-process model:

| Process | Entry | Role |
|---------|-------|------|
| Main | `src/main/index.ts` | DB, plugin system, IPC handlers, MCP server, window management, cookie injection |
| Preload | `src/preload/index.ts` | Exposes `window.api` via `contextBridge`, plus push-event listeners |
| Renderer | `src/renderer/src/main.tsx` | React 18 UI; talks to main only through the preload API |

### Plugin System

Sources (信息源) are plugins. Each plugin lives under `plugins/` and must:

1. Have a `package.json` with a `feedflow` metadata field (`id`, `name`, `version`, `description`, `author`, `color`)
2. Default-export an object implementing `FeedFlowPlugin` (`src/shared/types/plugin.ts`):
   - `meta` — static metadata (incl. `provider`/`providerName` for credential sharing, `feedType` for timeline vs group-chat)
   - `configSchema` — form fields for configuring source instances (supports a `credential` field type)
   - `fetchItems(config, cursor?)` → `FetchResult` — core fetch logic
   - `fetchItemDetail?(config, externalId)` → `ItemDetailResult` — optional, inline-expands truncated items
   - Optional `onRegister` / `onUnregister` lifecycle hooks

See [`docs/`](./docs) for plugin design notes and [`AGENTS.md`](./AGENTS.md) for the full plugin lifecycle.

### MCP Server

`src/main/mcp-server/` exposes FeedFlow data to local AI agents over the
[Model Context Protocol](https://modelcontextprotocol.io/) via HTTP
(`StreamableHTTPServerTransport`), defaulting to
`http://127.0.0.1:33939/mcp`. Toggle / configure it in Settings (MCP tab) or
via the `mcp.enabled` / `mcp.port` settings.

## Documentation

- [`CHANGELOG.md`](./CHANGELOG.md) — per-version release notes (source of truth for GitHub Release bodies)
- [`AGENTS.md`](./AGENTS.md) — detailed architecture, coding conventions, release process, and agent guidance
- [`docs/`](./docs) — design docs for the MCP server, individual plugins, and macOS signing/notarization

## License

See `package.json` for author / repository info.
