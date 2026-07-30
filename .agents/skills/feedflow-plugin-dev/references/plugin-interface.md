# Plugin Interface Reference

Full type definitions from `src/shared/types/plugin.ts`. Use this when you need
the exact shape of every field.

## `FeedFlowPlugin`

```ts
interface FeedFlowPlugin {
  meta: PluginMeta
  configSchema: ConfigField[]
  fetchItems(config: SourceConfig, cursor?: string): Promise<FetchResult>
  onRegister?(ctx: PluginContext): Promise<void>
  onUnregister?(): Promise<void>
}
```

- `meta` — static, never changes per source instance.
- `configSchema` — drives the UI form when the user adds/edits a source.
- `fetchItems` — called on refresh (cursor = `undefined`) and on "load older"
  (cursor = the `nextCursor` returned last time).
- `onRegister`/`onUnregister` — lifecycle hooks; `onRegister` receives a
  `PluginContext` with `db`, `logger`, `appDataPath`. Rarely needed.

## `PluginMeta`

```ts
interface PluginMeta {
  id: string            // unique, e.g. "feedflow-plugin-weibo"
  name: string          // display name, e.g. "微博关注流"
  version: string
  description: string
  author: string
  icon?: string         // emoji, e.g. "🔴"
  color?: string        // hex, e.g. "#E6162D" — used for UI accents
  homepage?: string
  feedType?: FeedType   // 'timeline' (default) | 'group-chat'
  provider?: string     // scopes credentials; defaults to id
  providerName?: string // human-readable provider label; defaults to name
}
```

- `feedType: 'group-chat'` excludes the source from the aggregated timeline
  and renders it in a separate conversational view (see weibo-group-chat).
- `provider` is the **key** for credential sharing. Two plugins with
  `provider: 'weibo'` (e.g. 微博关注流 + 微博群聊) share the same cookie
  picker. Set it whenever multiple plugins can use the same account.

## `ConfigField`

```ts
interface ConfigField {
  key: string
  label: string
  type: 'text' | 'number' | 'password' | 'select' | 'boolean' | 'text-area' | 'credential'
  required?: boolean
  default?: unknown
  placeholder?: string
  options?: { label: string; value: string }[]   // for 'select'
  min?: number
  max?: number
  helpText?: string
}
```

- `type: 'credential'` — special. The UI shows a credential picker scoped to
  the plugin's `provider`. The stored credential ID is saved in config; the
  runner swaps in the raw value before `fetchItems`. **Always use this for
  cookies/tokens** — never `password` for reusable secrets.
- `type: 'select'` with `options: []` — options can be loaded dynamically at
  runtime if the plugin exports a helper (e.g. `listGroups(cookie)`).

## `SourceConfig`

```ts
type SourceConfig = Record<string, unknown>
```

Just a map of `configSchema` key → value. Values come from the form. Numbers
may arrive as strings from the form — coerce with `Number(config.count)`.

## `TimelineItem`

```ts
interface TimelineItem {
  externalId: string
  author: {
    name: string
    avatarUrl?: string
    profileUrl?: string
  }
  content: {
    text: string
    html?: string
  }
  mediaUrls: string[]
  permalink: string
  publishedAt: string          // ISO 8601, e.g. new Date().toISOString()
  metadata?: Record<string, unknown>
}
```

- `externalId` — **dedup key**. Must be stable per post across fetches. Use
  the source's native ID.
- `content.text` — **required**. If you only have HTML, strip tags for `text`
  and put the original in `html`.
- `mediaUrls` — direct, hotlinkable URLs. For videos, pick an `.mp4` (not
  `.m3u8`) so the desktop `<video>` tag can play it.
- `publishedAt` — must be ISO 8601. Parse the source's date format.

## `FetchResult`

```ts
interface FetchResult {
  items: TimelineItem[]
  nextCursor: string | null
}
```

- Return `nextCursor: null` when there's definitely no older page.
- Return a string (often `JSON.stringify({...})`) when "load older" should
  work. The runner stores it and passes it back as `cursor` next time.

## `PluginContext` (for `onRegister`)

```ts
interface PluginContext {
  db: {
    getSourceConfig(sourceId: string): SourceConfig
    saveItem(sourceId: string, item: TimelineItem): Promise<void>
  }
  logger: { info(msg, ...args): void; warn(...): void; error(...): void }
  appDataPath: string
}
```

Most plugins don't need this. Use it if you need to write items outside the
normal refresh flow or access the file system.
