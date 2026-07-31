import { create } from 'zustand'
import { createSourceSlice, type SourceSlice } from './sourceSlice'
import { createCredentialSlice, type CredentialSlice } from './credentialSlice'
import { createUpdateSlice, type UpdateSlice } from './updateSlice'

export const useStore = create<SourceSlice & CredentialSlice & UpdateSlice>()((...a) => ({
  ...createSourceSlice(...a),
  ...createCredentialSlice(...a),
  ...createUpdateSlice(...a)
}))
