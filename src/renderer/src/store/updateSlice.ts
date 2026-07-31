import type { StateCreator } from 'zustand'
import type { UpdateStatus, UpdateInfo } from '@shared/types/ipc'

export interface UpdateSlice {
  updateStatus: UpdateStatus
  updateInfo: UpdateInfo | null
  downloadProgress: number
  updateError: string | null

  checkForUpdates: () => void
  quitAndInstall: () => void
  dismissUpdate: () => void
}

export const createUpdateSlice: StateCreator<UpdateSlice, [], [], UpdateSlice> = (set) => ({
  updateStatus: 'idle',
  updateInfo: null,
  downloadProgress: 0,
  updateError: null,

  checkForUpdates: () => {
    set({ updateStatus: 'checking', updateError: null })
    window.api.checkForUpdates().catch((e) => {
      set({ updateStatus: 'error', updateError: (e as Error).message })
    })
  },

  quitAndInstall: () => {
    window.api.quitAndInstall().catch(() => {})
  },

  dismissUpdate: () => {
    set({ updateStatus: 'idle', updateInfo: null, downloadProgress: 0 })
  }
})
