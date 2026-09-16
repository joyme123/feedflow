import type { FeedFlowPlugin, PluginMeta } from '@shared/types/plugin'
import { registerPlugin, removePlugin as dbRemovePlugin } from '../database/queries/plugins'
import type { PluginSource } from '../database/queries/plugins'

const plugins = new Map<string, FeedFlowPlugin>()
/** 存储插件的原始模块导出（用于访问非标准导出如 authorize） */
const modules = new Map<string, Record<string, unknown>>()
/** 存储插件来源（builtin / user） */
const sources = new Map<string, PluginSource>()

export function register(
  plugin: FeedFlowPlugin,
  entryPath: string,
  source: PluginSource,
  rawModule?: Record<string, unknown>
): void {
  const provider = plugin.meta.provider ?? plugin.meta.id
  plugins.set(plugin.meta.id, plugin)
  sources.set(plugin.meta.id, source)
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
    provider,
    source
  })
  console.log(`[PluginRegistry] Registered: ${plugin.meta.id} (${plugin.meta.name}, provider=${provider}, source=${source})`)
}

export function get(id: string): FeedFlowPlugin | undefined {
  return plugins.get(id)
}

export function getModule(id: string): Record<string, unknown> | undefined {
  return modules.get(id)
}

export function getSource(id: string): PluginSource | undefined {
  return sources.get(id)
}

export function getAll(): FeedFlowPlugin[] {
  return Array.from(plugins.values())
}

export function getAllMeta(): PluginMeta[] {
  return getAll().map((p) => {
    const provider = p.meta.provider ?? p.meta.id
    // Determine credential type from configSchema: if any credential field
    // is explicitly a token, the provider uses tokens; otherwise cookies.
    const hasTokenField = (p.configSchema ?? []).some(
      (f) => f.type === 'credential' && f.credentialType === 'token'
    )
    // Whether the plugin has any credential field at all (cookie or token).
    // Plugins without credentials (e.g. GitHub Trending, Hacker News) should
    // not appear in credential management UI.
    const hasCredential = (p.configSchema ?? []).some(
      (f) => f.type === 'credential'
    )
    // Whether the plugin's raw module exposes verifyCookie — drives the
    // per-credential "验证" button in the credentials panel.
    const rawModule = modules.get(p.meta.id)
    const hasVerify = typeof rawModule?.verifyCookie === 'function'
    return {
      ...p.meta,
      // Default provider to plugin id so credentials can always be scoped,
      // even for plugins that don't declare an explicit provider.
      provider,
      // Default providerName to the plugin's display name (human-readable)
      // rather than the provider id, so third-party plugins without an
      // explicit providerName still show a friendly label in credential UI.
      providerName: p.meta.providerName ?? p.meta.name,
      source: sources.get(p.meta.id) ?? 'builtin',
      credentialType: hasTokenField ? 'token' : 'cookie',
      hasCredential,
      hasVerify
    }
  })
}

export function has(id: string): boolean {
  return plugins.has(id)
}

export async function unregister(id: string): Promise<void> {
  const plugin = plugins.get(id)
  if (plugin && typeof plugin.onUnregister === 'function') {
    try {
      await plugin.onUnregister()
    } catch (err) {
      console.error(`[PluginRegistry] onUnregister hook failed for ${id}:`, err)
    }
  }
  plugins.delete(id)
  modules.delete(id)
  sources.delete(id)
  dbRemovePlugin(id)
  console.log(`[PluginRegistry] Unregistered: ${id}`)
}
