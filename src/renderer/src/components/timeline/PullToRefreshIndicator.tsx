import styles from './PullToRefreshIndicator.module.css'

interface PullToRefreshIndicatorProps {
  state: 'idle' | 'pulling' | 'ready' | 'refreshing'
  distance: number
}

export function PullToRefreshIndicator({ state, distance }: PullToRefreshIndicatorProps): JSX.Element | null {
  if (state === 'idle') return null

  // 指示器高度：刷新中保持固定高度，其余随拉动距离变化（最小 24px 保证可见）
  const height = state === 'refreshing' ? 48 : Math.max(Math.min(distance, 60), 24)
  const opacity = state === 'refreshing' ? 1 : Math.min(distance / 30, 1)

  return (
    <div
      className={styles.indicator}
      style={{ height: `${height}px`, opacity }}
    >
      {state === 'refreshing' ? (
        <div className={styles.content}>
          <span className={styles.spinner} />
          <span className={styles.text}>刷新中…</span>
        </div>
      ) : state === 'ready' ? (
        <div className={styles.content}>
          <span className={styles.arrowUp}>↑</span>
          <span className={styles.text}>释放刷新</span>
        </div>
      ) : (
        <div className={styles.content}>
          <span className={styles.arrowDown}>↓</span>
          <span className={styles.text}>下拉刷新</span>
        </div>
      )}
    </div>
  )
}
