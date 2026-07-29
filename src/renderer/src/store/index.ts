import { create } from 'zustand'
import { createSourceSlice, type SourceSlice } from './sourceSlice'
import { createCredentialSlice, type CredentialSlice } from './credentialSlice'

export const useStore = create<SourceSlice & CredentialSlice>()((...a) => ({
  ...createSourceSlice(...a),
  ...createCredentialSlice(...a)
}))
