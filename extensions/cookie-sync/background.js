// FeedFlow Cookie Sync Extension — Service Worker (background.js)
//
// 同步机制（三层，保证 FeedFlow 里的 Cookie 始终与浏览器一致）：
//   1. 被动同步: chrome.cookies.onChanged 监听 cookie 变化，防抖后推送
//   2. 定期重同步: 每 RESYNC_INTERVAL_MIN 分钟强制重读所有已授权域名的 cookie
//      并推送，覆盖"App 关闭期间 cookie 轮换 / 轮换发生在安装扩展之前"等
//      被动监听漏掉的场景
//   3. 主动刷新兜底: 心跳响应中带 refreshProviders（App 侧抓取时检测到
//      Cookie 失效）时，后台打开一个隐藏标签页加载对应站点，触发服务端
//      Set-Cookie 轮换（如微博的 XSRF-TOKEN、SUB 续期），等待落地后重新
//      读取并同步，然后关闭标签页
//
// 注意：/sync 只负责落库，不再校验 Cookie；校验由桌面端「设置 → 凭据」
// 按需触发，网络问题不会再导致同步失败。

const SERVER_URL = 'http://127.0.0.1:33940'
const DEBOUNCE_MS = 5000
const HEARTBEAT_INTERVAL_MIN = 1 // 心跳间隔：及时响应 App 侧"Cookie 失效"标记
const RESYNC_INTERVAL_MIN = 10 // 定期强制重同步间隔
const ACTIVE_REFRESH_MIN_INTERVAL_MS = 10 * 60 * 1000 // 主动刷新节流：每域名 10 分钟最多一次
const TAB_LOAD_TIMEOUT_MS = 15000
const TAB_SETTLE_MS = 3000 // 等待 Set-Cookie 落地

// Per-domain debounce timers
const debounceTimers = new Map()
// domain -> 上次主动刷新时间戳（节流用）
const activeRefreshLast = new Map()

// ============================================================
// Server communication
// ============================================================

async function fetchProviders() {
  try {
    const res = await fetch(`${SERVER_URL}/providers`)
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

async function hasPermission(domain) {
  try {
    return await chrome.permissions.contains({ origins: [`https://*.${domain}/*`] })
  } catch {
    return false
  }
}

async function postSync(domain, cookieHeader) {
  try {
    const res = await fetch(`${SERVER_URL}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, cookie: cookieHeader }),
    })
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` }
    return await res.json()
  } catch (e) {
    // Desktop not running, silently ignore
    return { success: false, error: 'unreachable' }
  }
}

/**
 * 同步单个域名的 cookie 到 FeedFlow。
 * /sync 只落库不校验，因此这里只需读取并推送。
 */
async function syncDomain(domain) {
  try {
    const cookies = await chrome.cookies.getAll({ domain })
    if (!cookies.length) return { success: false, reason: 'no-cookie' }
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    return await postSync(domain, cookieHeader)
  } catch (e) {
    return { success: false, reason: 'unreachable' }
  }
}

/** 对指定 provider 列表立即主动刷新（隐藏标签页触发 Set-Cookie 轮换）并重同步 */
async function syncProvidersFor(providerNames) {
  if (!providerNames || !providerNames.length) return
  const providers = await fetchProviders()
  for (const p of providers) {
    if (providerNames.includes(p.provider) && p.domains.length) {
      await activeRefreshAndResync(p.domains[0])
    }
  }
}

/** 定期重同步：强制推送所有已授权域名的最新 cookie */
async function resyncAll() {
  const providers = await fetchProviders()
  for (const p of providers) {
    if (!p.domains.length) continue
    if (await hasPermission(p.domains[0])) {
      await syncDomain(p.domains[0])
    }
  }
}

async function sendHeartbeat() {
  try {
    const res = await fetch(`${SERVER_URL}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
      }),
    })
    if (!res.ok) return
    const data = await res.json()
    // App 侧抓取时检测到 Cookie 失效 → 后台开标签页触发轮换并重同步
    if (Array.isArray(data.refreshProviders) && data.refreshProviders.length) {
      await syncProvidersFor(data.refreshProviders)
    }
  } catch {
    // Desktop not running, silently ignore
  }
}

// ============================================================
// 主动刷新：隐藏标签页加载站点，触发服务端轮换 cookie
// ============================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function activeRefreshAndResync(domain) {
  const now = Date.now()
  const last = activeRefreshLast.get(domain) || 0
  if (now - last < ACTIVE_REFRESH_MIN_INTERVAL_MS) return // 节流
  activeRefreshLast.set(domain, now)

  const url = `https://${domain}/`
  let tab = null
  try {
    // 后台打开（不抢焦点），真实页面加载才会收到服务端的 Set-Cookie
    tab = await chrome.tabs.create({ url, active: false })
    await waitForTabLoad(tab.id)
    await sleep(TAB_SETTLE_MS) // 等 cookie 落地
    await syncDomain(domain)
  } catch (e) {
    console.warn('[FeedFlow] Active cookie refresh failed:', e)
  } finally {
    if (tab && tab.id != null) {
      chrome.tabs.remove(tab.id).catch(() => {})
    }
  }
}

async function waitForTabLoad(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId)
    if (tab.status === 'complete') return
  } catch {
    return // tab 已不存在，直接返回
  }
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      chrome.tabs.onUpdated.removeListener(listener)
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, TAB_LOAD_TIMEOUT_MS)
    const listener = (id, changeInfo) => {
      if (id === tabId && changeInfo.status === 'complete') finish()
    }
    chrome.tabs.onUpdated.addListener(listener)
  })
}

// ============================================================
// Auto-sync: listen for cookie changes on authorized domains
// ============================================================

chrome.cookies.onChanged.addListener((changeInfo) => {
  const domain = changeInfo.cookie.domain
  if (!domain) return

  // Only sync if auto-sync is enabled (default: true)
  chrome.storage.local.get(['autoSync'], (result) => {
    if (result.autoSync === false) return
    scheduleSync(domain)
  })
})

function scheduleSync(domain) {
  clearTimeout(debounceTimers.get(domain))
  debounceTimers.set(domain, setTimeout(() => syncDomain(domain), DEBOUNCE_MS))
}

// ============================================================
// Initial sync: on install/startup, sync all authorized providers
// ============================================================

async function initialSync() {
  const providers = await fetchProviders()
  for (const p of providers) {
    const origins = p.domains.map((d) => `https://*.${d}/*`)
    const granted = await chrome.permissions.contains({ origins })
    if (!granted) continue
    // Sync the primary domain
    if (p.domains.length) {
      await syncDomain(p.domains[0])
    }
  }
}

// ============================================================
// Alarms: heartbeat + periodic force re-sync
// ============================================================

function startHeartbeat() {
  sendHeartbeat()
  chrome.alarms.create('heartbeat', { periodInMinutes: HEARTBEAT_INTERVAL_MIN })
}

function startResync() {
  chrome.alarms.create('resync', { periodInMinutes: RESYNC_INTERVAL_MIN })
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'heartbeat') sendHeartbeat()
  else if (alarm.name === 'resync') resyncAll()
})

// ============================================================
// Lifecycle
// ============================================================

chrome.runtime.onInstalled.addListener(() => {
  // Default auto-sync to enabled
  chrome.storage.local.set({ autoSync: true })
  startHeartbeat()
  startResync()
  initialSync()
})

// Run on startup (service worker activation)
startHeartbeat()
startResync()
initialSync()

// Re-sync when permissions change (e.g. user authorizes a new domain)
chrome.permissions.onAdded.addListener(() => {
  initialSync()
})
