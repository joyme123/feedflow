import { join } from 'path'
import { readdirSync, existsSync } from 'fs'
import { app } from 'electron'
import { createRequire } from 'module'
import { register, has } from './registry'
import { unwrapPlugin } from './normalize'
import type { PluginSource } from '../database/queries/plugins'

const PLUGIN_DIRS: { path: string; source: PluginSource }[] = [
  { path: join(app.getAppPath(), 'plugins'), source: 'builtin' },
  { path: join(app.getPath('userData'), 'plugins'), source: 'user' }
]

export async function loadPlugins(): Promise<void> {
  for (const { path: pluginDir, source } of PLUGIN_DIRS) {
    if (!existsSync(pluginDir)) continue

    try {
      const entries = readdirSync(pluginDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue

        const entryDir = join(pluginDir, entry.name)
        const pkgPath = join(entryDir, 'package.json')

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
          const indexPath = join(entryDir, indexFile)

          let pluginModule: unknown
          try {
            pluginModule = await import(indexPath)
          } catch {
            const pluginRequire = createRequire(import.meta.url)
            pluginModule = pluginRequire(indexPath)
          }

          // CJS modules that do `module.exports = { default: plugin }` get wrapped
          // one level deeper when imported via ESM `import()`: mod.default.default.
          // Normalize to find the actual plugin object regardless of module format.
          const plugin = unwrapPlugin(pluginModule)

          if (!plugin) {
            console.warn(`[PluginLoader] Invalid plugin in ${entry.name}: missing fetchItems`)
            continue
          }

          register(plugin, indexPath, source, pluginModule as Record<string, unknown>)
          console.log(`[PluginLoader] Loaded plugin: ${plugin.meta.name} (${plugin.meta.id}, source=${source})`)
        } catch (err) {
          console.error(`[PluginLoader] Failed to load plugin ${entry.name}:`, err)
        }
      }
    } catch (err) {
      console.error(`[PluginLoader] Failed to scan directory ${pluginDir}:`, err)
    }
  }
}
