import { join, basename } from 'path'
import { existsSync, readdirSync, copyFileSync, mkdirSync, rmSync, readFileSync } from 'fs'
import { app } from 'electron'
import { createRequire } from 'module'
import extract from 'extract-zip'
import { register, has, get as getPlugin, unregister, getSource } from './registry'
import { unwrapPlugin } from './normalize'
import type { PluginMeta } from '@shared/types/plugin'

/**
 * Get the user plugins directory ({userData}/plugins).
 */
export function getUserPluginsDir(): string {
  return join(app.getPath('userData'), 'plugins')
}

/**
 * Recursively copy a directory.
 */
function copyDir(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * Find the plugin root directory inside an extracted zip.
 * The zip may either contain the plugin files directly at the top level,
 * or wrap them in a single directory.
 */
function findPluginRoot(extractDir: string): string {
  const entries = readdirSync(extractDir, { withFileTypes: true })
  // If there's a single directory and no package.json at the top level,
  // assume the plugin is inside that directory.
  const hasPkgJson = entries.some((e) => e.isFile() && e.name === 'package.json')
  if (hasPkgJson) return extractDir

  const dirs = entries.filter((e) => e.isDirectory())
  if (dirs.length === 1) {
    const inner = join(extractDir, dirs[0].name)
    if (existsSync(join(inner, 'package.json'))) return inner
  }

  return extractDir
}

/**
 * Validate that a directory contains a valid FeedFlow plugin and return its
 * parsed package.json feedflow metadata.
 */
function validatePlugin(pluginDir: string): { meta: PluginMeta; main: string } {
  const pkgPath = join(pluginDir, 'package.json')
  if (!existsSync(pkgPath)) {
    throw new Error('插件缺少 package.json')
  }

  let pkg: { feedflow?: PluginMeta; main?: string }
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  } catch {
    throw new Error('package.json 不是合法的 JSON')
  }

  const meta = pkg.feedflow
  if (!meta || !meta.id) {
    throw new Error('package.json 缺少 feedflow.id 字段')
  }

  const main = pkg.main || 'plugin.js'
  const mainPath = join(pluginDir, main)
  if (!existsSync(mainPath)) {
    throw new Error(`插件入口文件 ${main} 不存在`)
  }

  return { meta, main }
}

/**
 * Install a plugin from a zip file.
 *
 * Steps:
 * 1. Extract the zip to a temp directory.
 * 2. Locate the plugin root and validate it.
 * 3. Copy it to {userData}/plugins/{pluginId}.
 * 4. Register it in the in-memory registry and DB.
 *
 * Returns the installed plugin's metadata.
 */
export async function installPluginFromZip(zipPath: string): Promise<PluginMeta> {
  const tmpDir = join(app.getPath('temp'), `feedflow-plugin-install-${Date.now()}`)

  try {
    // 1. Extract
    try {
      await extract(zipPath, { dir: tmpDir })
    } catch (err) {
      throw new Error(`解压失败: ${err instanceof Error ? err.message : String(err)}`)
    }

    // 2. Locate plugin root & validate
    const pluginRoot = findPluginRoot(tmpDir)
    const { meta, main } = validatePlugin(pluginRoot)

    // 3. Copy to user plugins dir
    const userPluginsDir = getUserPluginsDir()
    mkdirSync(userPluginsDir, { recursive: true })
    const targetDir = join(userPluginsDir, meta.id)

    // If a plugin with the same id already exists, remove it first (reinstall).
    if (existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true })
    }
    copyDir(pluginRoot, targetDir)

    // 4. Load & register the plugin
    const indexPath = join(targetDir, main)

    let pluginModule: unknown
    try {
      pluginModule = await import(indexPath)
    } catch {
      const pluginRequire = createRequire(import.meta.url)
      pluginModule = pluginRequire(indexPath)
    }

    const plugin = unwrapPlugin(pluginModule)

    if (!plugin) {
      // Clean up the copied directory since the plugin is invalid.
      rmSync(targetDir, { recursive: true, force: true })
      throw new Error('插件无效：缺少 fetchItems 方法')
    }

    // If the plugin was already registered, check its source.
    // - Built-in plugins cannot be overwritten by user installs.
    // - User plugins can be reinstalled (overwrite).
    if (has(meta.id)) {
      const existingSource = getSource(meta.id)
      if (existingSource === 'builtin') {
        rmSync(targetDir, { recursive: true, force: true })
        throw new Error(`插件 ID「${meta.id}」与内置插件冲突，无法安装`)
      }
      const existing = getPlugin(meta.id)
      if (existing && typeof existing.onUnregister === 'function') {
        try {
          await existing.onUnregister()
        } catch (err) {
          console.error(`[Installer] onUnregister failed for ${meta.id}:`, err)
        }
      }
    }

    register(plugin, indexPath, 'user', pluginModule as Record<string, unknown>)

    console.log(`[Installer] Installed plugin: ${meta.name} (${meta.id}) from ${basename(zipPath)}`)
    return {
      ...meta,
      provider: meta.provider ?? meta.id,
      providerName: meta.providerName ?? meta.name,
      source: 'user'
    }
  } finally {
    // Clean up temp directory
    try {
      rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  }
}

/**
 * Uninstall a user-installed plugin.
 * Removes it from the registry, DB, and deletes its directory.
 * Built-in plugins cannot be uninstalled.
 */
export async function uninstallPlugin(pluginId: string): Promise<void> {
  const plugin = getPlugin(pluginId)
  if (!plugin) {
    throw new Error(`插件 ${pluginId} 不存在`)
  }

  const source = getSource(pluginId)
  if (source !== 'user') {
    throw new Error('内置插件不可删除')
  }

  // Remove from registry & DB (calls onUnregister hook)
  await unregister(pluginId)

  // Delete the plugin directory
  const targetDir = join(getUserPluginsDir(), pluginId)
  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true })
  }

  console.log(`[Installer] Uninstalled plugin: ${pluginId}`)
}
