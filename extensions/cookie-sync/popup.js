// FeedFlow Cookie Sync Extension — Popup logic (compact layout)

const SERVER_URL = 'http://127.0.0.1:33940'
const $ = (id) => document.getElementById(id)

let providers = []
let syncStatus = []
let autoSync = true

async function init() {
  const stored = await chrome.storage.local.get(['autoSync'])
  autoSync = stored.autoSync !== false
  $('autoSyncToggle').checked = autoSync
  $('autoSyncToggle').addEventListener('change', (e) => {
    autoSync = e.target.checked
    chrome.storage.local.set({ autoSync })
  })

  await checkConnection()
  await loadData()
  render()
}

async function checkConnection() {
  try {
    const res = await fetch(`${SERVER_URL}/health`)
    if (res.ok) {
      $('connDot').classList.add('online')
      $('connText').textContent = '已连接'
      return true
    }
  } catch { /* ignore */ }
  $('connDot').classList.remove('online')
  $('connText').textContent = '未连接'
  return false
}

async function loadData() {
  try {
    const [provRes, statusRes] = await Promise.all([
      fetch(`${SERVER_URL}/providers`),
      fetch(`${SERVER_URL}/sync-status`),
    ])
    providers = provRes.ok ? await provRes.json() : []
    syncStatus = statusRes.ok ? (await statusRes.json()).providers : []
  } catch {
    providers = []
    syncStatus = []
  }
}

function render() {
  const list = $('providerList')
  if (!providers.length) {
    list.innerHTML = '<div class="empty">未检测到 FeedFlow 桌面端<br/>请先打开 FeedFlow</div>'
    return
  }
  list.innerHTML = ''
  for (const p of providers) list.appendChild(renderRow(p))
}

function renderRow(p) {
  const row = document.createElement('div')
  row.className = 'row'

  const status = syncStatus.find((s) => s.provider === p.provider)

  // Name
  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = p.providerName
  row.appendChild(name)

  // Badges container
  const badges = document.createElement('div')
  badges.className = 'badges'
  row.appendChild(badges)

  // Button
  const btn = document.createElement('button')
  btn.className = 'btn'
  row.appendChild(btn)

  // Check permission, then populate badges + button
  const origins = p.domains.map((d) => `https://*.${d}/*`)
  chrome.permissions.contains({ origins }, (granted) => {
    // Permission badge
    const permBadge = document.createElement('span')
    permBadge.className = 'badge ' + (granted ? 'ok' : 'warn')
    permBadge.textContent = granted ? '已授权' : '未授权'
    badges.appendChild(permBadge)

    if (granted) {
      // Cookie detection
      chrome.cookies.getAll({ domain: p.domains[0] }, (cookies) => {
        const cookieBadge = document.createElement('span')
        if (cookies && cookies.length) {
          cookieBadge.className = 'badge ok'
          cookieBadge.textContent = `Cookie ${cookies.length}`
        } else {
          cookieBadge.className = 'badge warn'
          cookieBadge.textContent = '无 Cookie'
        }
        badges.appendChild(cookieBadge)

        // Sync status badge
        const syncBadge = document.createElement('span')
        if (!status || !status.hasCredential) {
          syncBadge.className = 'badge muted'
          syncBadge.textContent = '未同步'
        } else if (status.lastSyncStatus === 'failed') {
          syncBadge.className = 'badge err'
          syncBadge.textContent = '失败'
          syncBadge.title = status.lastSyncError || ''
        } else if (status.lastSyncedAt) {
          syncBadge.className = 'badge info'
          syncBadge.textContent = timeAgo(status.lastSyncedAt)
        } else {
          syncBadge.className = 'badge ok'
          syncBadge.textContent = '已同步'
        }
        badges.appendChild(syncBadge)

        // Button
        btn.textContent = '同步'
        btn.className = 'btn'
        btn.disabled = !(cookies && cookies.length)
        btn.onclick = () => manualSync(p)
      })
    } else {
      // Not authorized: show authorize button
      btn.textContent = '授权'
      btn.className = 'btn primary'
      btn.disabled = false
      btn.onclick = () => authorizeAndSync(p)
    }
  })

  return row
}

function timeAgo(ts) {
  const diff = Date.now() - ts
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}时前`
  return `${Math.floor(hr / 24)}天前`
}

async function authorizeAndSync(p) {
  const origins = p.domains.map((d) => `https://*.${d}/*`)
  try {
    const granted = await chrome.permissions.request({ origins })
    if (granted) {
      await manualSync(p)
      render()
    }
  } catch (e) {
    console.error('Authorization failed:', e)
  }
}

async function manualSync(p) {
  try {
    const cookies = await chrome.cookies.getAll({ domain: p.domains[0] })
    if (!cookies.length) {
      alert(`未检测到 ${p.providerName} 的 Cookie，请先在浏览器中登录`)
      return
    }
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
    const res = await fetch(`${SERVER_URL}/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: p.domains[0], cookie: cookieHeader }),
    })
    let result
    try {
      result = await res.json()
    } catch {
      result = { success: false, error: `HTTP ${res.status} ${res.statusText}` }
    }
    if (!result.success) {
      alert(`同步失败：${result.error || '未知错误'}`)
    }
    await loadData()
    render()
  } catch (e) {
    alert('无法连接 FeedFlow 桌面端，请确认已打开')
  }
}

init()
