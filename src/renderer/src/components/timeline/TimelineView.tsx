import { useEffect, useRef, useCallback, useState } from 'react'
import { useStore } from '../../store'
import { TimelineItem } from './TimelineItem'
import { TimelineSkeleton } from './TimelineSkeleton'
import { PullToRefreshIndicator } from './PullToRefreshIndicator'
import { EmptyState } from '../common/EmptyState'
import styles from './TimelineView.module.css'

const PULL_THRESHOLD = 120 // 触发刷新所需的最小拉动距离（px）
const PULL_MAX = 160 // 最大拉动距离（px）
const PULL_RELEASE_DELAY = 300 // 释放判定延迟（ms）
const TOP_THRESHOLD = 10 // 判定"在顶部"的 scrollTop 阈值（px）
const BOUNCE_DEAD_ZONE = 15 // 回弹死区：小于此值的回弹忽略（px）
const MIN_PULL_DURATION = 400 // 最小持续时间（ms），快速回弹通常 < 200ms，刻意下拉通常 > 400ms

export function TimelineView(): JSX.Element {
  const {
    items, timelineLoading, hasMore, loadItems, loadMoreItems,
    sources, plugins, selectedSourceId, selectSource,
    isRefreshing, refreshAll, refreshSource
  } = useStore()

  const sentinelRef = useRef<HTMLDivElement>(null)
  const initialLoaded = useRef(false)
  const timelineRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLElement | null>(null)

  // 下拉刷新状态
  const [pullState, setPullState] = useState<'idle' | 'pulling' | 'ready' | 'refreshing'>('idle')
  const [pullDistance, setPullDistance] = useState(0)

  // 用 ref 跟踪最新状态，避免事件监听器频繁重添
  const pullStateRef = useRef(pullState)
  const pullDistanceRef = useRef(pullDistance)
  const pullTimeoutRef = useRef<number | null>(null)
  const isRefreshingRef = useRef(isRefreshing)
  const selectedSourceIdRef = useRef(selectedSourceId)
  const wasPullingRef = useRef(false)
  const pullStartTimeRef = useRef(0) // 下拉开始时间，用于持续时间检测

  useEffect(() => { pullStateRef.current = pullState }, [pullState])
  useEffect(() => { pullDistanceRef.current = pullDistance }, [pullDistance])
  useEffect(() => { isRefreshingRef.current = isRefreshing }, [isRefreshing])
  useEffect(() => { selectedSourceIdRef.current = selectedSourceId }, [selectedSourceId])

  // 初始化加载
  useEffect(() => {
    if (!initialLoaded.current) {
      initialLoaded.current = true
      loadItems()
    }
  }, [loadItems])

  // 查找滚动容器（CSS Module 类名会被哈希，通过 closest('main') 找到）
  useEffect(() => {
    const el = timelineRef.current?.closest('main') as HTMLElement
    if (el) scrollContainerRef.current = el
  }, [])

  // 无限滚动
  const handleIntersect = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasMore && !timelineLoading) {
        loadMoreItems()
      }
    },
    [hasMore, timelineLoading, loadMoreItems]
  )

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(handleIntersect, { threshold: 0.1 })
    observer.observe(el)
    return () => observer.disconnect()
  }, [handleIntersect])

  // 刷新完成后重置下拉状态
  useEffect(() => {
    if (!isRefreshing && pullState === 'refreshing') {
      setPullState('idle')
      setPullDistance(0)
      wasPullingRef.current = false
    }
  }, [isRefreshing, pullState])

  // 触发刷新
  const triggerRefresh = useCallback(() => {
    setPullState('refreshing')
    setPullDistance(0)
    wasPullingRef.current = false
    const store = useStore.getState()
    if (selectedSourceIdRef.current) {
      store.refreshSource(selectedSourceIdRef.current)
    } else {
      store.refreshAll()
    }
  }, [])

  // 开始下拉（记录开始时间）
  const startPulling = useCallback(() => {
    if (!wasPullingRef.current) {
      pullStartTimeRef.current = Date.now()
    }
    wasPullingRef.current = true
  }, [])

  // 判定释放：距离和持续时间都达标才触发刷新
  const checkRelease = useCallback(() => {
    const pullDuration = Date.now() - pullStartTimeRef.current
    const distanceEnough = pullDistanceRef.current >= PULL_THRESHOLD
    const durationEnough = pullDuration >= MIN_PULL_DURATION

    if (distanceEnough && durationEnough) {
      triggerRefresh()
    } else {
      setPullState('idle')
      setPullDistance(0)
      wasPullingRef.current = false
    }
  }, [triggerRefresh])

  // scroll 事件：检测触控板回弹（scrollTop < 0），这是 macOS 触控板下拉的核心
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      if (isRefreshingRef.current || pullStateRef.current === 'refreshing') return

      const scrollTop = container.scrollTop

      // 向下滚动超过阈值：重置下拉状态
      if (scrollTop > TOP_THRESHOLD) {
        if (pullStateRef.current !== 'idle') {
          setPullState('idle')
          setPullDistance(0)
          wasPullingRef.current = false
        }
        return
      }

      // 触控板回弹：scrollTop 为负值且超过死区时，用其绝对值作为拉动距离
      if (scrollTop < -BOUNCE_DEAD_ZONE) {
        startPulling()
        // 减去死区，让小幅回弹不触发
        const distance = Math.min(Math.abs(scrollTop) - BOUNCE_DEAD_ZONE, PULL_MAX)
        setPullDistance(distance)

        // 只有距离和持续时间都达标才显示 "释放刷新"
        const pullDuration = Date.now() - pullStartTimeRef.current
        const canRelease = distance >= PULL_THRESHOLD && pullDuration >= MIN_PULL_DURATION
        setPullState(canRelease ? 'ready' : 'pulling')

        // 重置释放计时器
        if (pullTimeoutRef.current) clearTimeout(pullTimeoutRef.current)
        pullTimeoutRef.current = window.setTimeout(checkRelease, PULL_RELEASE_DELAY)
        return
      }

      // scrollTop 在 [-BOUNCE_DEAD_ZONE, TOP_THRESHOLD]：回弹结束，判定释放
      if (wasPullingRef.current && scrollTop >= -BOUNCE_DEAD_ZONE) {
        if (pullTimeoutRef.current) clearTimeout(pullTimeoutRef.current)
        pullTimeoutRef.current = window.setTimeout(checkRelease, PULL_RELEASE_DELAY)
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [checkRelease, startPulling])

  // wheel 事件：鼠标滚轮用户在顶部时上滚触发下拉
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      if (isRefreshingRef.current || pullStateRef.current === 'refreshing') return

      // 不在顶部时不处理
      if (container.scrollTop > TOP_THRESHOLD) return

      // 触控板回弹期间（scrollTop < 0）交给 scroll 事件处理
      if (container.scrollTop < 0) return

      // deltaY < 0 = 向上滚动 / 下拉手势
      if (e.deltaY < 0 && container.scrollTop >= 0) {
        startPulling()
        const newDistance = Math.min(pullDistanceRef.current + Math.abs(e.deltaY), PULL_MAX)
        setPullDistance(newDistance)

        const pullDuration = Date.now() - pullStartTimeRef.current
        const canRelease = newDistance >= PULL_THRESHOLD && pullDuration >= MIN_PULL_DURATION
        setPullState(canRelease ? 'ready' : 'pulling')

        // 重置释放计时器
        if (pullTimeoutRef.current) clearTimeout(pullTimeoutRef.current)
        pullTimeoutRef.current = window.setTimeout(checkRelease, PULL_RELEASE_DELAY)
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: true })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [checkRelease, startPulling])

  // 触摸事件：移动端下拉刷新
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    let touchStartY = 0
    let isTouchPulling = false

    const handleTouchStart = (e: TouchEvent) => {
      if (isRefreshingRef.current || pullStateRef.current === 'refreshing') return
      if (container.scrollTop <= TOP_THRESHOLD) {
        touchStartY = e.touches[0].clientY
        isTouchPulling = true
      }
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (!isTouchPulling || isRefreshingRef.current || pullStateRef.current === 'refreshing') return
      const deltaY = e.touches[0].clientY - touchStartY
      if (deltaY > 0) {
        e.preventDefault()
        startPulling()
        const newDistance = Math.min(deltaY, PULL_MAX)
        setPullDistance(newDistance)

        const pullDuration = Date.now() - pullStartTimeRef.current
        const canRelease = newDistance >= PULL_THRESHOLD && pullDuration >= MIN_PULL_DURATION
        setPullState(canRelease ? 'ready' : 'pulling')
      }
    }

    const handleTouchEnd = () => {
      if (!isTouchPulling) return
      isTouchPulling = false
      checkRelease()
    }

    container.addEventListener('touchstart', handleTouchStart, { passive: true })
    container.addEventListener('touchmove', handleTouchMove, { passive: false })
    container.addEventListener('touchend', handleTouchEnd)

    return () => {
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('touchend', handleTouchEnd)
    }
  }, [checkRelease, startPulling])

  // 清理释放计时器
  useEffect(() => {
    return () => {
      if (pullTimeoutRef.current) clearTimeout(pullTimeoutRef.current)
    }
  }, [])

  const hasSources = sources.length > 0
  const isEmpty = !timelineLoading && items.length === 0

  // 当前选中的信息源（null 表示聚合流）
  const selectedSource = selectedSourceId
    ? sources.find((s) => s.id === selectedSourceId)
    : null
  const selectedPlugin = selectedSource
    ? plugins.find((p) => p.id === selectedSource.pluginId)
    : null

  return (
    <div ref={timelineRef} className={styles.timeline}>
      {/* 下拉刷新指示器 */}
      <PullToRefreshIndicator state={pullState} distance={pullDistance} />

      {/* 当前浏览上下文标题 */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          {selectedSource ? (
            <>
              <span
                className={styles.headerDot}
                style={{ background: selectedPlugin?.color ?? '#888' }}
              />
              <h2 className={styles.headerTitle}>{selectedSource.name}</h2>
            </>
          ) : (
            <>
              <span className={styles.headerIcon}>🗂️</span>
              <h2 className={styles.headerTitle}>聚合流</h2>
            </>
          )}
        </div>
        {selectedSourceId && (
          <button
            className={styles.clearBtn}
            onClick={() => selectSource(null)}
            title="返回聚合流"
          >
            返回聚合流
          </button>
        )}
      </header>

      {timelineLoading && items.length === 0 && (
        <TimelineSkeleton count={5} />
      )}

      {isEmpty && !hasSources && (
        <EmptyState
          icon="📡"
          title="欢迎使用 FeedFlow"
          description="在左侧添加信息源，然后点击刷新按钮拉取内容"
        />
      )}

      {isEmpty && hasSources && (
        <EmptyState
          icon="📭"
          title="暂无内容"
          description={selectedSourceId
            ? "该信息源暂无内容，点击左侧刷新按钮获取最新内容"
            : "点击左侧刷新按钮获取最新内容"}
        />
      )}

      {items.map((item) => (
        <TimelineItem key={item.id} item={item} />
      ))}

      {hasMore && (
        <div ref={sentinelRef} className={styles.sentinel}>
          {timelineLoading && <TimelineSkeleton count={2} />}
        </div>
      )}

      {!hasMore && items.length > 0 && (
        <p className={styles.end}>— 已经到底了 —</p>
      )}
    </div>
  )
}
