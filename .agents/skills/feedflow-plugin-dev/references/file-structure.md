# File Structure & Discovery

## Directory layout

A plugin is a directory containing at least `package.json` and an entry file
(`plugin.js` by convention, or whatever `main` points to):

```
plugins/
└── my-plugin/
    ├── package.json      # required — must have a "feedflow" field
    ├── plugin.js         # entry point (default name; override with "main")
    ├── api.js            # optional — API helpers (recommended for non-trivial plugins)
    └── auth.js           # optional — credential verification helper
```

Built-in plugins go in the repo's `plugins/` directory and are packaged into
the app (see `electron-builder.yml` `files: ["plugins/**/*"]`). User-installed
plugins go in `{userData}/plugins/` and are loaded the same way.

## `package.json` format

```json
{
  "name": "feedflow-plugin-my-plugin",
  "version": "1.0.0",
  "description": "One-line description",
  "main": "plugin.js",
  "feedflow": {
    "id": "feedflow-plugin-my-plugin",
    "name": "My Plugin",
    "version": "1.0.0",
    "description": "One-line description shown in UI",
    "author": "Your Name",
    "color": "#1DA1F2",
    "icon": "🐦"
  }
}
```

- The `feedflow` field is **mandatory**. Without `feedflow.id`, the loader
  skips the directory with a warning: `Skipping <name>: no "feedflow" field`.
- `name` (npm) and `feedflow.id` should match by convention but the loader
  only reads `feedflow.id`.
- `main` defaults to `plugin.js` if omitted.

## How the loader works (`src/main/plugin-system/loader.ts`)

1. Scans `plugins/` (app dir) and `{userData}/plugins/`.
2. For each subdirectory, reads `package.json` → `feedflow` field.
3. Skips if no `feedflow.id` or if that id is already registered.
4. Imports the entry file: tries ESM `import()` first, falls back to `require`.
5. Normalizes the export to find the plugin object (handles
   `{ default: { default: plugin } }` wrapping from CJS-via-ESM).
6. Validates `typeof plugin.fetchItems === 'function'` — else skips.
7. Calls `register(plugin, entryPath, rawModule)`.

**Implication**: both CJS (`module.exports = { default: plugin }`) and ESM
(`export default plugin`) work. The raw module is also stored, so any extra
named exports (e.g. `verifyCookie`, `listGroups`) are accessible via
`registry.getModule(id)`.

## Export shapes that work

```js
// CJS — recommended, matches existing plugins
const plugin = { meta, configSchema, fetchItems }
module.exports = { default: plugin }

// CJS — also works (loader normalizes)
module.exports = plugin

// ESM
export default { meta, configSchema, fetchItems }
```

## Restart to load changes

The loader runs at startup. After editing a plugin, restart the app (or let
`npm run dev`'s HMR reload the main process). Watch the main process console
for:
- `[PluginLoader] Loaded plugin: <name> (<id>)` — success
- `[PluginLoader] Skipping …` — missing `feedflow` field or duplicate id
- `[PluginLoader] Invalid plugin in …: missing fetchItems` — bad export
- `[PluginRegistry] Registered: <id> (<name>, provider=…)` — registered

## Packaging

Built-in plugins in `plugins/` are bundled into the app by
`electron-builder.yml`. If you add a new built-in plugin, no config change is
needed — the `plugins/**/*` glob already covers it. Community plugins in
`plugins-community/` are gitignored and not packaged.
