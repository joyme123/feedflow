#!/usr/bin/env node
/**
 * 开发模式下让 Dock/菜单栏显示「FeedFlow」而不是「Electron」。
 *
 * dev 启动的是 node_modules/electron/dist/Electron.app，其 Info.plist 里
 * CFBundleName/CFBundleDisplayName 都是 Electron，Dock 提示名由此而来，
 * app.setName() 改不了它。这里复制一份 bundle，改名并替换图标，
 * 再由 scripts/dev.mjs 通过 ELECTRON_EXEC_PATH 指向副本启动。
 *
 * 仅 macOS 需要；其他平台直接退出。按 electron 版本 + BUILD_REV + 图标哈希
 * 缓存，升级 electron 或替换图标后自动重建。
 *
 * 注意：必须保留原 bundle id（com.github.Electron）和原 adhoc 签名。
 * Electron 预编译包主二进制是「Info.plist=not bound / Sealed Resources=none」的
 * 松签名，改 plist/图标不破坏签名；一旦改 bundle id 或重签，macOS safeStorage
 * 存在 Keychain 里的密钥身份就变了，旧凭据全部无法解密。
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

if (process.platform !== 'darwin') process.exit(0)

const root = dirname(dirname(fileURLToPath(import.meta.url)))

const fail = (message) => {
  console.error(`[dev] ${message}`)
  process.exit(1)
}

const electronPkgPath = join(root, 'node_modules/electron/package.json')
if (!existsSync(electronPkgPath)) fail('未找到 node_modules/electron，请先执行 npm install')
const electronVersion = JSON.parse(readFileSync(electronPkgPath, 'utf8')).version

const srcApp = join(root, 'node_modules/electron/dist/Electron.app')
const iconSrc = join(root, 'resources/icon.icns')
if (!existsSync(join(srcApp, 'Contents/MacOS/Electron'))) {
  fail('Electron 二进制缺失（node_modules/electron/dist/Electron.app 不完整），请重新安装依赖')
}
if (!existsSync(iconSrc)) fail(`缺少应用图标：${iconSrc}`)

const cacheDir = join(root, 'node_modules/.dev-electron')
const appDir = join(cacheDir, 'FeedFlow.app')
// BUILD_REV：准备逻辑（plist 项、签名策略等）变更时递增，强制重建缓存
const BUILD_REV = '3'
const iconHash = createHash('sha256').update(readFileSync(iconSrc)).digest('hex').slice(0, 12)
const stampFile = join(cacheDir, 'electron-version.txt')
const stamp = `${electronVersion}|${BUILD_REV}|${iconHash}`

if (
  existsSync(join(appDir, 'Contents/MacOS/Electron')) &&
  existsSync(stampFile) &&
  readFileSync(stampFile, 'utf8').trim() === stamp
) {
  process.exit(0)
}

console.log(`[dev] 准备 FeedFlow.app（基于 Electron ${electronVersion}，仅首次/升级时执行）...`)

// 先复制到带 pid 的临时目录，完成后再整体替换，避免两个 `npm run dev` 并发时
// rmSync + ditto 交错产生半成品 bundle
const stageDir = join(cacheDir, `FeedFlow.app.tmp-${process.pid}`)
rmSync(stageDir, { recursive: true, force: true })
mkdirSync(cacheDir, { recursive: true })
// 必须用 ditto：Node cpSync 会把 framework 内的相对符号链接转成指向源 bundle
// 的绝对链接，破坏 codesign 的密封校验
execFileSync('ditto', [srcApp, stageDir], { stdio: 'inherit' })

const plist = join(stageDir, 'Contents/Info.plist')
const plutilReplace = (key, value) =>
  execFileSync('plutil', ['-replace', key, '-string', value, plist], { stdio: 'inherit' })

plutilReplace('CFBundleName', 'FeedFlow')
plutilReplace('CFBundleDisplayName', 'FeedFlow')
plutilReplace('LSApplicationCategoryType', 'public.app-category.news')

// Info.plist 中 CFBundleIconFile=electron.icns，直接用项目图标覆盖该文件
cpSync(iconSrc, join(stageDir, 'Contents/Resources/electron.icns'))

// 不重签、不改 bundle id：原 Electron 二进制为 adhoc 松签名（Info.plist 不绑定、
// 资源不密封），上述修改不会破坏签名；重签反而会使 safeStorage 的 Keychain 密钥失效。

rmSync(appDir, { recursive: true, force: true })
renameSync(stageDir, appDir)
writeFileSync(stampFile, `${stamp}\n`)
console.log('[dev] FeedFlow.app 就绪')
