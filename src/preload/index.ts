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

  // Credentials
  listCredentials: (pluginId?: string) => ipcRenderer.invoke('credentials:list', { pluginId }),
  addCredential: (input: unknown) => ipcRenderer.invoke('credentials:add', input),
  updateCredential: (id: string, data: unknown) => ipcRenderer.invoke('credentials:update', { id, data }),
  removeCredential: (id: string) => ipcRenderer.invoke('credentials:remove', id),
  countCredentialReferences: (pluginId: string, credentialId: string) =>
    ipcRenderer.invoke('credentials:count-references', { pluginId, credentialId }),

  // Timeline
  listItems: (params: unknown) => ipcRenderer.invoke('timeline:list', params),
  refresh: (sourceIds?: string[]) => ipcRenderer.invoke('timeline:refresh', { sourceIds }),
  loadOlderItems: (sourceId: string, maxId: string) =>
    ipcRenderer.invoke('timeline:load-older', { sourceId, maxId }),

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
  }
}

contextBridge.exposeInMainWorld('api', api)

export type FeedFlowAPI = typeof api
