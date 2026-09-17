import { app, BrowserWindow, shell, session, ipcMain, nativeImage, Menu } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { initializeDatabase } from './database/schema'
import { closeDb } from './database/connection'
import { registerIpcHandlers } from './ipc/handlers'
import { loadPlugins } from './plugin-system/loader'
import { startMcpServer } from './mcp-server'
import { startCookieSyncServer } from './cookie-sync/server'
import { initAutoUpdater } from './auto-updater'
import { installHttpsProxyPatch, reloadProxyConfig } from './network/proxy-agent'
import { applySessionProxy } from './network/session-proxy'
import {
  X_VIDEO_DOMAINS,
  refreshMediaCookies,
  getWeiboCookie,
  getXCookie,
  setWeiboCookies,
} from './media-cookies'

/**
 * dev 下 macOS safeStorage 的 Keychain 条目（"<name> Safe Storage"）和 userData
 * 目录都按 app.getName()（小写 feedflow）区分，绝不能 setName/加 productName，
 * 否则历史凭据全部无法解密。Dock 名由 scripts/prepare-dev-electron.mjs 改名的
 * bundle 提供；这里只把默认菜单/关于面板的显示文字本地化为 FeedFlow。
 * 打包后 getName() 直接是 Info.plist 中的 FeedFlow，无需处理。
 */
function localizeDevMenu(): void {
  if (!is.dev || process.platform !== 'darwin') return
  const menu = Menu.getApplicationMenu()
  if (!menu) return
  const appMenuItem = menu.items[0]
  if (appMenuItem) {
    ;(appMenuItem as { label: string }).label = 'FeedFlow'
    const aboutItem = appMenuItem.submenu?.items[0]
    if (aboutItem) aboutItem.label = 'About FeedFlow'
    Menu.setApplicationMenu(menu)
  }
  app.setAboutPanelOptions({ applicationName: 'FeedFlow' })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'FeedFlow',
    show: false,
    // Windows/Linux 开发模式下的窗口图标（macOS 走 dock/.icns）
    ...(is.dev && process.platform !== 'darwin'
      ? { icon: join(__dirname, '../../resources/icon.png') }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 统一链接行为：所有外部链接都在系统浏览器中打开，禁止在应用内导航
  // 1) window.open() / target="_blank" → setWindowOpenHandler 拦截
  // 2) 普通 <a> 链接（target="_self" 或无 target）→ will-navigate 拦截
  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    // 允许应用自身的页面导航（如开发模式热更新），阻止所有外部链接在应用内打开
    const isInternal =
      url.startsWith('http://localhost:') ||
      url.startsWith('devtools://') ||
      url.startsWith('about:') ||
      url.startsWith('file://')
    if (!isInternal) {
      event.preventDefault()
      shell.openExternal(url)
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  localizeDevMenu()

  // 开发模式下手动设置 Dock 图标（打包后由 .icns 自动提供）
  if (is.dev && process.platform === 'darwin') {
    const devIcon = nativeImage.createFromPath(join(__dirname, '../../resources/icon.png'))
    if (!devIcon.isEmpty()) app.dock?.setIcon(devIcon)
  }

  // Initialize database
  initializeDatabase()

  // 出站代理：先安装 node:https 补丁（必须在任何插件发请求前），再加载设置，
  // 同时配置 Chromium session 代理（时间线图片/视频加载）
  installHttpsProxyPatch()
  reloadProxyConfig()
  // 仅记录不抛出：session 代理失败不应阻断插件加载与窗口创建（Node 侧 agent 已同步重建，不受影响）
  await applySessionProxy().catch((err) =>
    console.error('[Proxy] applySessionProxy at startup failed:', err)
  )

  // 为微博图片/X视频请求加载 Cookie（启动时加载一次，后续可通过刷新媒体 Cookie 刷新）
  refreshMediaCookies()

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const url = details.url
    // 微博图片/视频域名：需要注入 Referer 和 Cookie
    if (
      url.includes('upload.api.weibo.com') ||
      url.includes('weibocdn.com') ||
      url.includes('video.weibo.com') ||
      url.includes('v.weibo.com')
    ) {
      details.requestHeaders['Referer'] = 'https://api.weibo.com/'
      let cookie = getWeiboCookie()
      if (!cookie) {
        // Cookie 为空时尝试重新加载一次（处理启动时无 Cookie、后续同步的情况）
        refreshMediaCookies()
        cookie = getWeiboCookie()
      }
      if (cookie) {
        details.requestHeaders['Cookie'] = cookie
      } else {
        console.log('[main] WARNING: weiboCookie is empty for media request:', url.slice(0, 80))
      }
    } else if (url.includes('sinaimg.cn') || url.includes('sina.com.cn') || url.includes('weibo.com')) {
      details.requestHeaders['Referer'] = 'https://weibo.com/'
    } else if (X_VIDEO_DOMAINS.some((d) => url.includes(d))) {
      // X 视频 CDN 校验 Referer 和 Cookie，否则返回 403/404 导致视频黑屏
      details.requestHeaders['Referer'] = 'https://x.com/'
      let cookie = getXCookie()
      if (!cookie) {
        refreshMediaCookies()
        cookie = getXCookie()
      }
      if (cookie) {
        details.requestHeaders['Cookie'] = cookie
      }
    }
    callback({ requestHeaders: details.requestHeaders })
  })

  // 调试：打印 msget 接口响应的完整头信息
  session.defaultSession.webRequest.onCompleted((details) => {
    if (details.url.includes('upload.api.weibo.com/2/mss/msget')) {
      const ct = details.responseHeaders?.['content-type'] || details.responseHeaders?.['Content-Type'] || 'unknown'
      const acceptRanges = details.responseHeaders?.['accept-ranges'] || details.responseHeaders?.['Accept-Ranges'] || 'none'
      const contentLength = details.responseHeaders?.['content-length'] || details.responseHeaders?.['Content-Length'] || 'unknown'
      console.log('[main] msget response:', ct, '| accept-ranges:', acceptRanges, '| content-length:', contentLength, '| status:', details.statusCode)
    }
  })

  // 修正微博 msget 接口返回的视频 Content-Type：
  // 接口返回 video/mpeg4，但 <video> 标签需要 video/mp4 才能正常播放
  // 同时添加 Accept-Ranges 头，支持视频缓冲和拖动进度条
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (details.url.includes('upload.api.weibo.com/2/mss/msget')) {
      const headers = { ...details.responseHeaders }
      const ct = headers['content-type'] || headers['Content-Type']
      if (ct && ct.toString().includes('video')) {
        headers['content-type'] = ['video/mp4']
        headers['accept-ranges'] = ['bytes']
        delete headers['Content-Type']
        delete headers['Accept-Ranges']
        console.log('[main] Fixed video headers: content-type=video/mp4, accept-ranges=bytes')
      }
      callback({ responseHeaders: headers })
    } else {
      callback({ responseHeaders: details.responseHeaders })
    }
  })

  // Load plugins
  await loadPlugins()

  // Register IPC handlers
  registerIpcHandlers()

  // Start MCP server (失败不影响 app 运行)
  startMcpServer()

  // Start cookie-sync server (失败不影响 app 运行)
  startCookieSyncServer()

  // 设置微博图片 Cookie 的 IPC handler
  ipcMain.handle('set-weibo-cookie', async (_event, cookie: string) => {
    if (!cookie) return
    try {
      await setWeiboCookies(cookie, 'SUB')
      // 重新从 DB 加载最新 Cookie 到内存，确保图片请求携带最新值
      refreshMediaCookies()
      return { success: true }
    } catch (e: any) {
      return { success: false, error: e.message }
    }
  })

  createWindow()

  // 初始化自动更新（仅生产环境生效）
  initAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  closeDb()
})
