import type { StateCreator } from 'zustand'
import type { UpdateStatus, UpdateInfo } from '@shared/types/ipc'

export interface UpdateSlice {
  updateStatus: UpdateStatus
  updateInfo: UpdateInfo | null
  downloadProgress: number
  updateError: string | null

  checkForUpdates: () => Promise<{ devMode?: boolean } | void>
  quitAndInstall: () => void
  dismissUpdate: () => void
}

export const createUpdateSlice: StateCreator<UpdateSlice, [], [], UpdateSlice> = (set) => ({
  updateStatus: 'idle',
  updateInfo: null,
  downloadProgress: 0,
  updateError: null,

  checkForUpdates: async () => {
    set({ updateStatus: 'checking', updateError: null })
    try {
      const result = (await window.api.checkForUpdates()) as { devMode?: boolean } | undefined
      if (result?.devMode) {
        // dev 模式不做真实检查，状态回到 idle（具体提示由调用方展示）
        set({ updateStatus: 'idle' })
        return { devMode: true }
      }
      // 生产环境结果通过 update:* 推送事件回传，这里无需处理
      return result ?? undefined
    } catch (e) {
      set({ updateStatus: 'error', updateError: (e as Error).message })
    }
  },

  quitAndInstall: () => {
    window.api.quitAndInstall().catch(() => {})
  },

  dismissUpdate: () => {
    set({ updateStatus: 'idle', updateInfo: null, downloadProgress: 0 })
  }
})
