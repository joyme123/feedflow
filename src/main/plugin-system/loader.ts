import { join } from 'path'
import { readdirSync, existsSync } from 'fs'
import { app } from 'electron'
import { createRequire } from 'module'
import { register, has } from './registry'
import type { FeedFlowPlugin } from '@shared/types/plugin'

const PLUGIN_DIRS = [
  join(app.getAppPath(), 'plugins'),
  join(app.getPath('userData'), 'plugins')
]

export async function loadPlugins(): Promise<void> {
  for (const dir of PLUGIN_DIRS) {
    if (!existsSync(dir)) continue

    try {
      const entries = readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const pluginDir = join(dir, entry.name)
        const pkgPath = join(pluginDir, 'package.json')

        if (!existsSync(pkgPath)) continue

        try {
          const pkgRequire = createRequire(import.meta.url)
          const pkg = pkgRequire(pkgPath)
          const meta = pkg.feedflow

          if (!meta?.id) {
            console.warn(`[PluginLoader] Skipping ${entry.name}: no "feedflow" field in package.json`)
            continue
          }

          // Skip if already registered
          if (has(meta.id)) {
            console.log(`[PluginLoader] Plugin ${meta.id} already registered, skipping`)
            continue
          }

          // Try ESM import first, fall back to require
          const indexFile = pkg.main || 'plugin.js'
          const indexPath = join(pluginDir, indexFile)

          let pluginModule: { default?: FeedFlowPlugin | { default?: FeedFlowPlugin } }
          try {
            pluginModule = await import(indexPath)
          } catch {
            const pluginRequire = createRequire(import.meta.url)
            pluginModule = pluginRequire(indexPath)
          }

          // CJS modules that do `module.exports = { default: plugin }` get wrapped
          // one level deeper when imported via ESM `import()`: mod.default.default.
          // Normalize to find the actual plugin object regardless of module format.
          const plugin =
            (pluginModule.default as { default?: FeedFlowPlugin })?.default ??
            pluginModule.default ??
            (pluginModule as FeedFlowPlugin)

          if (!plugin || typeof plugin.fetchItems !== 'function') {
            console.warn(`[PluginLoader] Invalid plugin in ${entry.name}: missing fetchItems`)
            continue
          }

          register(plugin, indexPath, pluginModule as Record<string, unknown>)
          console.log(`[PluginLoader] Loaded plugin: ${plugin.meta.name} (${plugin.meta.id})`)
        } catch (err) {
          console.error(`[PluginLoader] Failed to load plugin ${entry.name}:`, err)
        }
      }
    } catch (err) {
      console.error(`[PluginLoader] Failed to scan directory ${dir}:`, err)
    }
  }
}
