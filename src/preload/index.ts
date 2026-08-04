import { contextBridge, ipcRenderer } from 'electron'

const api = {
  // Sources
  listSources: () => ipcRenderer.invoke('sources:list'),
  addSource: (input: unknown) => ipcRenderer.invoke('sources:add', input),
  removeSource: (id: string) => ipcRenderer.invoke('sources:remove', id),
  updateSource: (id: string, data: unknown) => ipcRenderer.invoke('sources:update', { id, data }),
  toggleSource: (id: string) => ipcRenderer.invoke('sources:toggle', id),

  // Plugins
  listPlugins: () => ipcRenderer.invoke('plugins:list'),
  getPluginConfigSchema: (pluginId: string) => ipcRenderer.invoke('plugins:get-config-schema', pluginId),
  verifyCookie: (pluginId: string, cookie: string) =>
    ipcRenderer.invoke('plugins:verify-cookie', { pluginId, cookie }),
  listGroups: (pluginId: string, credentialId: string) =>
    ipcRenderer.invoke('plugins:list-groups', { pluginId, credentialId }),

  // Credentials
  listCredentials: (provider?: string) => ipcRenderer.invoke('credentials:list', { provider }),
  addCredential: (input: unknown) => ipcRenderer.invoke('credentials:add', input),
  updateCredential: (id: string, data: unknown) => ipcRenderer.invoke('credentials:update', { id, data }),
  removeCredential: (id: string) => ipcRenderer.invoke('credentials:remove', id),
  countCredentialReferences: (credentialId: string) =>
    ipcRenderer.invoke('credentials:count-references', { credentialId }),

  // Weibo
  setWeiboCookie: (cookie: string) => ipcRenderer.invoke('set-weibo-cookie', cookie),

  // Settings
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', { key, value }),
  getAllSettings: () => ipcRenderer.invoke('settings:get-all'),

  // Cookie Sync
  getCookieSyncStatus: () => ipcRenderer.invoke('cookie-sync:get-status'),

  // Timeline
  listItems: (params: unknown) => ipcRenderer.invoke('timeline:list', params),
  refresh: (sourceIds?: string[]) => ipcRenderer.invoke('timeline:refresh', { sourceIds }),
  loadOlderItems: (sourceId: string, maxId: string) =>
    ipcRenderer.invoke('timeline:load-older', { sourceId, maxId }),
  getItemDetail: (itemId: string) =>
    ipcRenderer.invoke('timeline:get-item-detail', { itemId }),

  // Auto-updates
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  quitAndInstall: () => ipcRenderer.invoke('updates:quit-and-install'),

  // Events (main -> renderer)
  onRefreshProgress: (cb: (data: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, d: unknown) => cb(d)
    ipcRenderer.on('refresh:progress', handler)
    return () => ipcRenderer.removeListener('refresh:progress', handler)
  },
  onRefreshComplete: (cb: (data: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, d: unknown) => cb(d)
    ipcRenderer.on('refresh:complete', handler)
    return () => ipcRenderer.removeListener('refresh:complete', handler)
  },
  onRefreshAllComplete: (cb: (data: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, d: unknown) => cb(d)
    ipcRenderer.on('refresh:all-complete', handler)
    return () => ipcRenderer.removeListener('refresh:all-complete', handler)
  },

  // Auto-update events (main -> renderer)
  onUpdateChecking: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('update:checking', handler)
    return () => ipcRenderer.removeListener('update:checking', handler)
  },
  onUpdateAvailable: (cb: (data: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, d: unknown) => cb(d)
    ipcRenderer.on('update:available', handler)
    return () => ipcRenderer.removeListener('update:available', handler)
  },
  onUpdateNotAvailable: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('update:not-available', handler)
    return () => ipcRenderer.removeListener('update:not-available', handler)
  },
  onUpdateDownloadProgress: (cb: (data: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, d: unknown) => cb(d)
    ipcRenderer.on('update:download-progress', handler)
    return () => ipcRenderer.removeListener('update:download-progress', handler)
  },
  onUpdateDownloaded: (cb: (data: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, d: unknown) => cb(d)
    ipcRenderer.on('update:downloaded', handler)
    return () => ipcRenderer.removeListener('update:downloaded', handler)
  },
  onUpdateError: (cb: (data: unknown) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, d: unknown) => cb(d)
    ipcRenderer.on('update:error', handler)
    return () => ipcRenderer.removeListener('update:error', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type FeedFlowAPI = typeof api
