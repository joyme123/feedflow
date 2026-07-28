import { create } from 'zustand'
import { createSourceSlice, type SourceSlice } from './sourceSlice'

export const useStore = create<SourceSlice>()((...a) => ({
  ...createSourceSlice(...a)
}))
