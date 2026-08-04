/** Tracks the Chrome extension's last heartbeat so the renderer can show
 *  appropriate guidance (install prompt vs "log in browser to auto-sync").
 *  State is kept in memory; optionally persisted to settings so it survives
 *  app restarts. */

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000 // 24 hours

let extensionLastSeen: number | null = null
let serverRunning = false

export function markExtensionHeartbeat(): void {
  extensionLastSeen = Date.now()
}

export function setServerRunning(running: boolean): void {
  serverRunning = running
}

export type ExtensionStatusState = 'unknown' | 'active' | 'stale'

export interface ExtensionStatus {
  status: ExtensionStatusState
  lastSeen: number | null
  serverRunning: boolean
}

export function getExtensionStatus(): ExtensionStatus {
  let status: ExtensionStatusState = 'unknown'
  if (extensionLastSeen !== null) {
    status = Date.now() - extensionLastSeen <= STALE_THRESHOLD_MS ? 'active' : 'stale'
  }
  return { status, lastSeen: extensionLastSeen, serverRunning }
}
