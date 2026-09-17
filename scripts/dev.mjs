#!/usr/bin/env node
/**
 * dev 启动器：macOS 下先确保改名后的 FeedFlow.app 就绪，再通过
 * ELECTRON_EXEC_PATH 让 electron-vite 用它启动（Dock/菜单栏显示 FeedFlow）。
 * 其余平台行为与直接执行 electron-vite dev 完全一致。
 *
 * dev 固定使用 ~/Library/Application Support/feedflow 作为 userData，
 * 避免开发版读写正式版（~/Library/Application Support/FeedFlow）的数据。
 */
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawn } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const env = { ...process.env }

if (process.platform === 'darwin') {
  execFileSync(process.execPath, [join(root, 'scripts/prepare-dev-electron.mjs')], {
    stdio: 'inherit',
    cwd: root
  })
  const appExec = join(root, 'node_modules/.dev-electron/FeedFlow.app/Contents/MacOS/Electron')
  if (existsSync(appExec)) {
    env.ELECTRON_EXEC_PATH = appExec
  }
}

const bin = join(root, 'node_modules/electron-vite/bin/electron-vite.js')
const child = spawn(process.execPath, [bin, 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: root,
  env
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
