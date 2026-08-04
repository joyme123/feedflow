// FeedFlow Cookie Sync Extension — Service Worker (background.js)

const SERVER_URL = 'http://127.0.0.1:33940'
const DEBOUNCE_MS = 5000
const HEARTBEAT_INTERVAL_MIN = 60

// Per-domain debounce timers
const debounceTimers = new Map()

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

async function syncDomain(domain) {
  try {
    const cookies = await chrome.cookies.getAll({ domain })
    if (!cookies.length) return
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    await fetch(`${SERVER_URL}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain, cookie: cookieHeader }),
    })
  } catch (e) {
    // Desktop not running, silently ignore
  }
}

async function sendHeartbeat() {
  try {
    await fetch(`${SERVER_URL}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        extensionId: chrome.runtime.id,
        version: chrome.runtime.getManifest().version,
      }),
    })
  } catch {
    // Desktop not running, silently ignore
  }
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
      syncDomain(p.domains[0])
    }
  }
}

// ============================================================
// Heartbeat
// ============================================================

function startHeartbeat() {
  sendHeartbeat()
  chrome.alarms.create('heartbeat', { periodInMinutes: HEARTBEAT_INTERVAL_MIN })
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'heartbeat') sendHeartbeat()
})

// ============================================================
// Lifecycle
// ============================================================

chrome.runtime.onInstalled.addListener(() => {
  // Default auto-sync to enabled
  chrome.storage.local.set({ autoSync: true })
  startHeartbeat()
  initialSync()
})

// Run on startup (service worker activation)
startHeartbeat()
initialSync()

// Re-sync when permissions change (e.g. user authorizes a new domain)
chrome.permissions.onAdded.addListener(() => {
  initialSync()
})
