import type { StateCreator } from 'zustand'
import type { Credential, AddCredentialInput, UpdateCredentialInput } from '@shared/types/credential'

export interface CredentialSlice {
  // Credentials
  credentials: Credential[]
  credentialsLoading: boolean
  loadCredentials: (pluginId?: string) => Promise<void>
  addCredential: (input: AddCredentialInput) => Promise<Credential>
  updateCredential: (id: string, data: UpdateCredentialInput) => Promise<Credential>
  removeCredential: (id: string) => Promise<void>
}

export const createCredentialSlice: StateCreator<CredentialSlice, [], [], CredentialSlice> = (set, get) => ({
  credentials: [],
  credentialsLoading: false,

  loadCredentials: async (pluginId?: string) => {
    set({ credentialsLoading: true })
    const credentials = await window.api.listCredentials(pluginId)
    set({ credentials: credentials as Credential[], credentialsLoading: false })
  },

  addCredential: async (input: AddCredentialInput) => {
    const credential = await window.api.addCredential(input)
    await get().loadCredentials()
    return credential as Credential
  },

  updateCredential: async (id: string, data: UpdateCredentialInput) => {
    const credential = await window.api.updateCredential(id, data)
    await get().loadCredentials()
    return credential as Credential
  },

  removeCredential: async (id: string) => {
    await window.api.removeCredential(id)
    await get().loadCredentials()
  }
})
