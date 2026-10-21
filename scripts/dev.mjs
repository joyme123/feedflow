#!/usr/bin/env node
/**
 * dev 启动器：macOS 下先确保改名后的 FeedFlow.app 就绪，再通过
 * ELECTRON_EXEC_PATH 让 electron-vite 用它启动（Dock/菜单栏显示 FeedFlow）。
 * 其余平台行为与直接执行 electron-vite dev 完全一致。
 *
 * 注意：dev 的 userData（~/Library/Application Support/feedflow）与 safeStorage
 * 的 Keychain 身份（"feedflow Safe Storage"）都依赖 package.json 的 name
 * （小写 feedflow）。切勿添加 productName 或调用 app.setName()，否则历史
 * dev 凭据会因身份变化而全部无法解密。
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
  // fail-loud：副本缺失必须直接报错，否则会静默退回 stock Electron（Dock 显示 Electron），
  // 正是本方案要消除且极难排查的现象
  if (!existsSync(appExec)) {
    console.error(
      `[dev] 改名后的 Electron 副本不存在：${appExec}\n` +
        '[dev] 请删除 node_modules/.dev-electron 目录后重新执行 npm run dev'
    )
    process.exit(1)
  }
  env.ELECTRON_EXEC_PATH = appExec
}

const bin = join(root, 'node_modules/electron-vite/bin/electron-vite.js')
if (!existsSync(bin)) {
  console.error('[dev] 找不到 electron-vite，请先执行 npm install')
  process.exit(1)
}

const child = spawn(process.execPath, [bin, 'dev', ...process.argv.slice(2)], {
  stdio: 'inherit',
  cwd: root,
  env
})

// 转发结束信号：父进程被单独 SIGINT/SIGTERM（如任务管理器、kill）时，
// 避免 electron-vite / Electron 成为孤儿进程继续运行
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
child.on('error', (err) => {
  console.error('[dev] 启动 electron-vite 失败:', err)
  process.exit(1)
})
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
