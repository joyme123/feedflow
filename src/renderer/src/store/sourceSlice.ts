import type { StateCreator } from 'zustand'
import type { Source, AddSourceInput } from '@shared/types/source'
import type { PluginMeta, ConfigField } from '@shared/types/plugin'
import type { DisplayItem, RefreshProgress } from '@shared/types/item'

export interface SourceSlice {
  // Sources
  sources: Source[]
  sourcesLoading: boolean
  loadSources: () => Promise<void>
  addSource: (input: AddSourceInput) => Promise<Source>
  removeSource: (id: string) => Promise<void>
  toggleSource: (id: string) => Promise<void>

  // Selected source (null = aggregated view of all sources)
  selectedSourceId: string | null
  selectSource: (sourceId: string | null) => void

  // Plugins
  plugins: PluginMeta[]
  pluginsLoading: boolean
  loadPlugins: () => Promise<void>
  getPluginConfigSchema: (pluginId: string) => Promise<ConfigField[]>

  // Timeline
  items: DisplayItem[]
  hasMore: boolean
  nextCursor: string | null
  timelineLoading: boolean
  loadItems: () => Promise<void>
  loadMoreItems: () => Promise<void>

  // Refresh
  isRefreshing: boolean
  refreshProgress: RefreshProgress[]
  refreshAll: () => Promise<void>
  refreshSource: (sourceId: string) => Promise<void>
  loadOlderItems: (sourceId: string, maxId: string) => Promise<void>
}

export const createSourceSlice: StateCreator<SourceSlice, [], [], SourceSlice> = (set, get) => ({
  sources: [],
  sourcesLoading: false,
  selectedSourceId: null,
  plugins: [],
  pluginsLoading: false,
  items: [],
  hasMore: false,
  nextCursor: null,
  timelineLoading: false,
  isRefreshing: false,
  refreshProgress: [],

  selectSource: (sourceId: string | null) => {
    set({ selectedSourceId: sourceId })
    get().loadItems()
  },

  loadSources: async () => {
    set({ sourcesLoading: true })
    const sources = await window.api.listSources()
    set({ sources: sources as Source[], sourcesLoading: false })
  },

  addSource: async (input: AddSourceInput) => {
    const source = await window.api.addSource(input)
    await get().loadSources()
    return source as Source
  },

  removeSource: async (id: string) => {
    await window.api.removeSource(id)
    // 如果删除的是当前选中的信息源，回到聚合流
    if (get().selectedSourceId === id) {
      set({ selectedSourceId: null })
    }
    await get().loadSources()
  },

  toggleSource: async (id: string) => {
    await window.api.toggleSource(id)
    await get().loadSources()
  },

  loadPlugins: async () => {
    set({ pluginsLoading: true })
    const plugins = await window.api.listPlugins()
    set({ plugins: plugins as PluginMeta[], pluginsLoading: false })
  },

  getPluginConfigSchema: async (pluginId: string) => {
    return (await window.api.getPluginConfigSchema(pluginId)) as ConfigField[]
  },

  loadItems: async () => {
    set({ timelineLoading: true })
    const { selectedSourceId } = get()
    const params = selectedSourceId
      ? { limit: 20, sourceIds: [selectedSourceId] }
      : { limit: 20 }
    const result = (await window.api.listItems(params)) as {
      items: DisplayItem[]
      hasMore: boolean
      nextCursor: string | null
    }
    set({
      items: result.items,
      hasMore: result.hasMore,
      nextCursor: result.nextCursor,
      timelineLoading: false
    })
  },

  loadMoreItems: async () => {
    const { nextCursor, hasMore, timelineLoading, items, sources, selectedSourceId } = get()
    if (timelineLoading) return

    // 如果 DB 中还有更多，先从 DB 加载
    if (hasMore) {
      set({ timelineLoading: true })
      const params = selectedSourceId
        ? { limit: 20, cursor: nextCursor, sourceIds: [selectedSourceId] }
        : { limit: 20, cursor: nextCursor }
      const result = (await window.api.listItems(params)) as {
        items: DisplayItem[]
        hasMore: boolean
        nextCursor: string | null
      }
      set((state) => ({
        items: [...state.items, ...result.items],
        hasMore: result.hasMore,
        nextCursor: result.nextCursor,
        timelineLoading: false
      }))
      return
    }

    // DB 中没有更多了，尝试从微博源加载更早的内容
    // 聚合视图下找任意启用的微博源；单源视图下仅当该源是微博时才加载
    const weiboSource = selectedSourceId
      ? sources.find((s) => s.id === selectedSourceId && s.pluginId === 'feedflow-plugin-weibo' && s.enabled)
      : sources.find((s) => s.pluginId === 'feedflow-plugin-weibo' && s.enabled)
    if (weiboSource && items.length > 0) {
      // 找到最旧的微博条目的 externalId 作为 maxId
      const oldestItem = items[items.length - 1]
      const maxId = oldestItem.externalId
      if (maxId) {
        await get().loadOlderItems(weiboSource.id, maxId)
      }
    }
  },

  refreshAll: async () => {
    set({ isRefreshing: true, refreshProgress: [] })

    // Listen for progress events
    const unsubProgress = window.api.onRefreshProgress((data: unknown) => {
      const progress = data as RefreshProgress
      set((state) => ({
        refreshProgress: [...state.refreshProgress.filter((p) => p.sourceId !== progress.sourceId), progress]
      }))
    })

    const unsubAllComplete = window.api.onRefreshAllComplete(() => {
      set({ isRefreshing: false })
      unsubProgress()
      unsubAllComplete()
      // Reload timeline
      get().loadItems()
    })

    await window.api.refresh()
  },

  refreshSource: async (sourceId: string) => {
    set({ isRefreshing: true, refreshProgress: [] })

    const unsubProgress = window.api.onRefreshProgress((data: unknown) => {
      const progress = data as RefreshProgress
      set((state) => ({
        refreshProgress: [...state.refreshProgress.filter((p) => p.sourceId !== progress.sourceId), progress]
      }))
    })

    const unsubAllComplete = window.api.onRefreshAllComplete(() => {
      set({ isRefreshing: false })
      unsubProgress()
      unsubAllComplete()
      get().loadItems()
    })

    await window.api.refresh([sourceId])
  },

  loadOlderItems: async (sourceId: string, maxId: string) => {
    if (!maxId) return
    set({ isRefreshing: true })

    const unsubAllComplete = window.api.onRefreshAllComplete(() => {
      set({ isRefreshing: false })
      unsubAllComplete()
      get().loadItems()
    })

    await window.api.loadOlderItems(sourceId, maxId)
  }
})
