import type { FeedFlowPlugin, PluginMeta } from '@shared/types/plugin'
import { registerPlugin, listPlugins as dbListPlugins } from '../database/queries/plugins'

const plugins = new Map<string, FeedFlowPlugin>()
/** 存储插件的原始模块导出（用于访问非标准导出如 authorize） */
const modules = new Map<string, Record<string, unknown>>()

export function register(plugin: FeedFlowPlugin, entryPath: string, rawModule?: Record<string, unknown>): void {
  const provider = plugin.meta.provider ?? plugin.meta.id
  plugins.set(plugin.meta.id, plugin)
  if (rawModule) {
    modules.set(plugin.meta.id, rawModule)
  }
  // Also persist to database
  registerPlugin({
    id: plugin.meta.id,
    name: plugin.meta.name,
    version: plugin.meta.version,
    description: plugin.meta.description,
    entryPath,
    provider
  })
  console.log(`[PluginRegistry] Registered: ${plugin.meta.id} (${plugin.meta.name}, provider=${provider})`)
}

export function get(id: string): FeedFlowPlugin | undefined {
  return plugins.get(id)
}

export function getModule(id: string): Record<string, unknown> | undefined {
  return modules.get(id)
}

export function getAll(): FeedFlowPlugin[] {
  return Array.from(plugins.values())
}

export function getAllMeta(): PluginMeta[] {
  return getAll().map((p) => {
    const provider = p.meta.provider ?? p.meta.id
    return {
      ...p.meta,
      // Default provider to plugin id so credentials can always be scoped,
      // even for plugins that don't declare an explicit provider.
      provider,
      // Default providerName to provider id for display.
      providerName: p.meta.providerName ?? provider
    }
  })
}

export function has(id: string): boolean {
  return plugins.has(id)
}

export function unregister(id: string): void {
  plugins.delete(id)
  modules.delete(id)
}
