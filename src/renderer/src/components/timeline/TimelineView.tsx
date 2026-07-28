import { useEffect, useRef, useCallback } from 'react'
import { useStore } from '../../store'
import { TimelineItem } from './TimelineItem'
import { TimelineSkeleton } from './TimelineSkeleton'
import { EmptyState } from '../common/EmptyState'
import styles from './TimelineView.module.css'

export function TimelineView(): JSX.Element {
  const { items, timelineLoading, hasMore, loadItems, loadMoreItems, sources, plugins, selectedSourceId, selectSource } = useStore()
  const sentinelRef = useRef<HTMLDivElement>(null)
  const initialLoaded = useRef(false)

  useEffect(() => {
    if (!initialLoaded.current) {
      initialLoaded.current = true
      loadItems()
    }
  }, [loadItems])

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
    <div className={styles.timeline}>
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
