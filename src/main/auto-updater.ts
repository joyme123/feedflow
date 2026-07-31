import { app, BrowserWindow, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import { is } from '@electron-toolkit/utils'

/**
 * 向所有窗口推送主→渲染事件。
 */
function sendToAllWindows(channel: string, data?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, data)
  }
}

/**
 * 将 electron-updater 的 UpdateInfo 转换为渲染进程使用的精简结构。
 * releaseNotes 可能是字符串或结构化数组，这里统一取字符串形式。
 */
function toUpdateInfo(info: { version: string; releaseNotes?: unknown }): {
  version: string
  releaseNotes: string | null
} {
  return {
    version: info.version,
    releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
  }
}

/**
 * 初始化自动更新。
 *
 * - 仅在打包后的生产环境生效（dev 模式下没有可更新的安装包）
 * - 检测到新版本时自动下载，下载完成后通知渲染进程，由用户决定何时重启安装
 */
export function initAutoUpdater(): void {
  // 开发环境不启用自动更新
  if (is.dev) return

  // 自动下载新版本（下载完成后再提示用户重启）
  autoUpdater.autoDownload = true
  // 下载完成后不自动退出安装，等用户确认
  autoUpdater.autoInstallOnAppQuit = true

  // 从 GitHub Release 读取更新（latest*.yml）
  // 无需手动设置 feedURL，electron-updater 会根据 package.json 的 repository 字段自动拼接

  autoUpdater.on('checking-for-update', () => {
    sendToAllWindows('update:checking')
  })

  autoUpdater.on('update-available', (info) => {
    sendToAllWindows('update:available', toUpdateInfo(info))
  })

  autoUpdater.on('update-not-available', () => {
    sendToAllWindows('update:not-available')
  })

  autoUpdater.on('download-progress', (progress) => {
    sendToAllWindows('update:download-progress', {
      percent: progress.percent,
      bytesPerSecond: progress.bytesPerSecond,
      total: progress.total,
      transferred: progress.transferred
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    sendToAllWindows('update:downloaded', toUpdateInfo(info))
  })

  autoUpdater.on('error', (err: Error) => {
    sendToAllWindows('update:error', { message: err.message })
  })

  // 渲染进程主动检查更新
  ipcMain.handle('updates:check', () => {
    autoUpdater.checkForUpdates().catch((e) => {
      sendToAllWindows('update:error', { message: (e as Error).message })
    })
  })

  // 渲染进程请求重启并安装更新
  ipcMain.handle('updates:quit-and-install', () => {
    // 延迟退出，确保渲染进程有时间响应
    setTimeout(() => {
      autoUpdater.quitAndInstall(false, true)
    }, 500)
  })

  // 启动后延迟一段时间再检查，避免与启动流程争抢资源
  app.whenReady().then(() => {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(() => {
        /* 检查失败不影响应用运行 */
      })
    }, 10_000)
  })
}
