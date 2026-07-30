---
name: feedflow-plugin-dev
description: |
  Develop a new FeedFlow plugin (信息源) for the Electron desktop feed aggregator.
  Use this skill whenever the user wants to add a new source/plugin to FeedFlow,
  create a plugin from scratch, scaffold a plugin directory, implement fetchItems,
  wire up cookie/credential auth, or fix/extend an existing plugin.
  Trigger on phrases like "新增 plugin", "添加信息源", "写一个 FeedFlow 插件",
  "scaffold a plugin", "接入 XX 信息流", "make a new source", even if "plugin"
  is not explicitly mentioned but the intent is to add a feed source to FeedFlow.
---

# FeedFlow Plugin Development

FeedFlow plugins are plain Node.js modules (CommonJS or ESM) that live in a
directory under `plugins/` (built-in, shipped with the app) or
`{userData}/plugins/` (user-installed). Each plugin implements the
`FeedFlowPlugin` interface: `meta`, `configSchema`, `fetchItems`, and optionally
`onRegister`/`onUnregister`.

The core contract is defined in `src/shared/types/plugin.ts`. Read it first if
you need the exact field shapes — but the summary below is enough to start.

## When to use this skill

- Adding a brand-new information source (微博, X, RSS, a forum, a chat group, …)
- Scaffolding the plugin directory + `package.json` + `plugin.js`
- Implementing `fetchItems` with cookie/API auth and pagination (cursor)
- Mapping raw API responses to `TimelineItem`
- Reusing credentials across multiple plugins of the same provider
- Debugging why a plugin isn't loading or fetching

## Quick start: 5 steps to a working plugin

1. **Create the directory** `plugins/<your-plugin-id>/` with a `package.json`
   (must have a `feedflow` field with `id`, `name`, `version`, `description`,
   `author`) and a `plugin.js` entry point.
2. **Define `meta`** — set `id`, `name`, `color`, and if the plugin needs a
   shared cookie, set `provider` + `providerName` so credentials can be reused.
3. **Define `configSchema`** — the form fields the user fills in. Use
   `type: 'credential'` for cookies/secrets so they're stored encrypted and
   reusable; use `number`/`select`/`text`/`boolean` for everything else.
4. **Implement `fetchItems(config, cursor?)`** — call the source API, map
   responses to `TimelineItem[]`, return `{ items, nextCursor }`. Throw a
   user-friendly `Error` on auth failure / rate limits.
5. **Export** `module.exports = { default: yourPlugin }` (CJS) or
   `export default yourPlugin` (ESM). Restart the app (or run `npm run dev`) —
   the loader auto-discovers the plugin.

See `references/file-structure.md` for the exact layout and
`templates/minimal/plugin.js` for a copy-paste starter.

## The `FeedFlowPlugin` interface (summary)

```ts
interface FeedFlowPlugin {
  meta: PluginMeta            // static metadata (id, name, color, provider, …)
  configSchema: ConfigField[] // form fields rendered in the UI
  fetchItems(config, cursor?): Promise<FetchResult>
  onRegister?(ctx): Promise<void>
  onUnregister?(): Promise<void>
}

interface FetchResult {
  items: TimelineItem[]
  nextCursor: string | null   // opaque string; use JSON for structured cursors
}
```

### `TimelineItem` — the shape every item must match

```ts
{
  externalId: string          // unique per source (used for dedup/upsert)
  author: { name: string; avatarUrl?: string; profileUrl?: string }
  content: { text: string; html?: string }   // text is required, html optional
  mediaUrls: string[]         // images/videos (use direct, playable URLs)
  permalink: string           // link back to the original post
  publishedAt: string         // ISO 8601 date string
  metadata?: Record<string, unknown>  // extra stats (likes, reposts, …)
}
```

## Key patterns (read the references for full detail)

- **Credentials**: mark a field `type: 'credential'`. The runner resolves the
  stored credential's raw value into `config[field.key]` *before* calling
  `fetchItems`, so your code just reads `config.cookie`. Plugins with the same
  `provider` share a credential picker. See `references/credentials.md`.
- **Cursor / pagination**: `nextCursor` is an opaque string. Use
  `JSON.stringify({ sinceId, maxId })` for structured pagination, or a raw
  API cursor string. On refresh the runner passes `undefined` (always fetch
  latest); `cursor` is only used for "load older". See
  `references/pagination.md`.
- **Error handling**: throw `new Error('human-readable message')` — the runner
  catches it, logs it, and shows it in the UI. Translate API error codes
  (401/403/429) into actionable messages ("Cookie 已过期", "请求过于频繁").
- **HTTP requests**: plugins run in Node.js (main process). Use the built-in
  `https` module (no extra deps needed) or `fetch` (Node 18+). See
  `references/http.md` for the `httpsGet` helper pattern used by existing
  plugins.
- **Caching**: in-memory module-level variables are fine for caching API
  responses across refreshes within one app session (e.g. list IDs, group
  lists). Use a TTL.
- **Extra exports**: you can export helpers like `verifyCookie` or
  `listGroups` alongside `default` — the registry stores the raw module so the
  UI can call them (e.g. to dynamically populate a `select` field's options).

## Common mistakes to avoid

- **Forgetting the `feedflow` field in `package.json`** — the loader skips
  directories without it.
- **Wrong export shape** — CJS must be `module.exports = { default: plugin }`.
  The loader normalizes `default.default` wrapping, but `module.exports = plugin`
  (no `default` key) also works; `module.exports = plugin` is fine too.
- **Missing `fetchItems`** — the loader rejects plugins without it.
- **Returning `nextCursor: undefined`** — always return `null` when there's no
  next page, or the runner may store `undefined` and break "load older".
- **`publishedAt` not ISO 8601** — must be `new Date(...).toISOString()`.
- **`externalId` not stable** — it's the dedup key; if it changes every fetch,
  items get duplicated. Use the source's native post ID.
- **`content.text` empty** — required. Strip HTML if you only have `html`.
- **Hardcoding secrets** — never put cookies/tokens in the plugin. Use the
  `credential` field type.

## Files in this skill

- `references/plugin-interface.md` — full `FeedFlowPlugin`, `ConfigField`,
  `TimelineItem`, `PluginMeta` reference.
- `references/file-structure.md` — directory layout, `package.json` format,
  how the loader discovers plugins, how packaging works.
- `references/credentials.md` — the `credential` field type, provider scoping,
  how the runner resolves credentials.
- `references/pagination.md` — cursor conventions, sinceId/maxId pattern,
  "load older" vs refresh.
- `references/http.md` — `httpsGet` helper, headers, error classes, timeouts.
- `references/cookbook.md` — copy-paste recipes: cookie auth, date parsing,
  HTML stripping, media URL extraction, retweet/quote handling.
- `templates/minimal/` — a minimal self-contained plugin (no network).
- `templates/cookie-based/` — a cookie-authenticated plugin starter with
  `httpsGet`, `verifyCookie`, and pagination.

## Workflow when building a plugin

1. Read `references/file-structure.md` and pick the template that fits.
2. Copy the template into `plugins/<id>/` and rename fields in `meta` +
   `package.json`.
3. Implement `fetchItems` — use `references/cookbook.md` recipes for mapping.
4. If the source needs auth, use the `credential` field type (see
   `references/credentials.md`).
5. Run `npm run dev`, add the source in the UI, and trigger a refresh. Check
   the main process console for `[PluginLoader] Loaded plugin: …` and any
   errors from `[Runner]`.
6. Iterate on the mapping until items render correctly.
