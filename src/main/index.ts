import { app, BrowserWindow, shell, session, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { initializeDatabase } from './database/schema'
import { closeDb, getDb } from './database/connection'
import { registerIpcHandlers } from './ipc/handlers'
import { loadPlugins } from './plugin-system/loader'
import { decrypt } from './plugin-system/encryption'
import { startMcpServer } from './mcp-server'
import { initAutoUpdater } from './auto-updater'

/** 微博相关域名，用于设置 Cookie 和 Referer */
const WEIBO_DOMAINS = ['.upload.api.weibo.com', '.weibo.com', '.sinaimg.cn', '.sina.com.cn', '.api.weibo.com']

/** X (Twitter) 视频 CDN 域名，请求视频时需要携带 X Cookie 才能播放 */
const X_VIDEO_DOMAINS = ['video.twimg.com']

/**
 * 从 DB 中加载某个插件被任一启用源引用的凭据（解密后的 Cookie 字符串）。
 * 用于在主进程为图片/视频请求注入 Cookie。返回空字符串表示未找到凭据。
 */
function loadCookieForPlugin(pluginId: string): string {
  try {
    const db = getDb()
    const row = db.prepare(`
      SELECT c.value FROM credentials c
      JOIN sources s ON s.config LIKE '%' || c.id || '%'
      WHERE s.plugin_id = ?
      LIMIT 1
    `).get(pluginId) as { value: string } | undefined
    if (row) {
      return decrypt(row.value)
    }
    console.log(`[main] No credential found for plugin ${pluginId}`)
  } catch (e) {
    console.error(`[main] Failed to load cookie for ${pluginId}:`, (e as Error).message)
  }
  return ''
}

/**
 * 将微博 Cookie 设置到 Electron session 中。
 * @param cookie - 完整的 Cookie 头（"name1=value1; name2=value2"）或单个 Cookie 值
 * @param cookieName - 当 cookie 是单个值时使用的名称（默认 'SUB'）
 */
async function setWeiboCookies(cookie: string, cookieName = 'SUB'): Promise<void> {
  const pairs: { name: string; value: string }[] = []
  if (cookie.includes('=')) {
    // 完整 Cookie 头，解析所有键值对
    for (const pair of cookie.split(';')) {
      const eqIdx = pair.indexOf('=')
      if (eqIdx <= 0) continue
      const name = pair.substring(0, eqIdx).trim()
      const value = pair.substring(eqIdx + 1).trim()
      if (name && value) pairs.push({ name, value })
    }
  } else {
    // 单个 Cookie 值
    pairs.push({ name: cookieName, value: cookie })
  }

  for (const { name, value } of pairs) {
    for (const domain of WEIBO_DOMAINS) {
      session.defaultSession.cookies.set({
        url: `https://${domain.replace(/^\./, '')}`,
        name,
        value,
        domain,
        path: '/',
        secure: true,
        httpOnly: true,
        sameSite: 'no_restriction'
      }).catch(() => {})
    }
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'FeedFlow',
    show: false,
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
  // Initialize database
  initializeDatabase()

  // 为微博图片请求设置 Referer 和 Cookie，使图片能正常加载
  const weiboCookie = loadCookieForPlugin('feedflow-plugin-weibo-group-chat')
  if (weiboCookie) console.log('[main] Weibo cookie loaded, length:', weiboCookie.length)

  // 为 X 视频请求加载 Cookie（video.twimg.com 需要登录态才能播放）
  const xCookie = loadCookieForPlugin('feedflow-plugin-x')
  if (xCookie) console.log('[main] X cookie loaded, length:', xCookie.length)

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const url = details.url
    if (url.includes('upload.api.weibo.com')) {
      details.requestHeaders['Referer'] = 'https://api.weibo.com/'
      if (weiboCookie) {
        details.requestHeaders['Cookie'] = weiboCookie
      } else {
        console.log('[main] WARNING: weiboCookie is empty for image request')
      }
    } else if (url.includes('sinaimg.cn') || url.includes('sina.com.cn') || url.includes('weibo.com')) {
      details.requestHeaders['Referer'] = 'https://weibo.com/'
    } else if (X_VIDEO_DOMAINS.some((d) => url.includes(d))) {
      // X 视频 CDN 校验 Referer 和 Cookie，否则返回 403/404 导致视频黑屏
      details.requestHeaders['Referer'] = 'https://x.com/'
      if (xCookie) {
        details.requestHeaders['Cookie'] = xCookie
      }
    }
    callback({ requestHeaders: details.requestHeaders })
  })

  // 同时设置 Cookie（双保险）
  if (weiboCookie) {
    setWeiboCookies(weiboCookie)
  }

  // Load plugins
  await loadPlugins()

  // Register IPC handlers
  registerIpcHandlers()

  // Start MCP server (失败不影响 app 运行)
  startMcpServer()

  // 设置微博图片 Cookie 的 IPC handler
  ipcMain.handle('set-weibo-cookie', async (_event, cookie: string) => {
    if (!cookie) return
    try {
      await setWeiboCookies(cookie, 'SUB')
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
