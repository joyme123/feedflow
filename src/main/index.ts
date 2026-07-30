import { app, BrowserWindow, shell, session, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { initializeDatabase } from './database/schema'
import { closeDb, getDb } from './database/connection'
import { registerIpcHandlers } from './ipc/handlers'
import { loadPlugins } from './plugin-system/loader'
import { decrypt } from './plugin-system/encryption'

/** 微博相关域名，用于设置 Cookie 和 Referer */
const WEIBO_DOMAINS = ['.upload.api.weibo.com', '.weibo.com', '.sinaimg.cn', '.sina.com.cn', '.api.weibo.com']

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

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
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
  let weiboCookie = ''
  try {
    const db = getDb()
    const credRow = db.prepare(`
      SELECT c.value FROM credentials c
      JOIN sources s ON s.config LIKE '%' || c.id || '%'
      WHERE s.plugin_id = 'feedflow-plugin-weibo-group-chat'
      LIMIT 1
    `).get()
    if (credRow) {
      weiboCookie = decrypt(credRow.value)
      console.log('[main] Weibo cookie loaded, length:', weiboCookie.length)
    } else {
      console.log('[main] No weibo credential found')
    }
  } catch (e) {
    console.error('[main] Failed to load weibo cookie:', e.message)
  }

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
