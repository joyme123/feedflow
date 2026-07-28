import { useStore } from '../../store'
import { Button } from '../common/Button'
import styles from './RefreshButton.module.css'

export function RefreshButton(): JSX.Element {
  const { isRefreshing, refreshAll, refreshProgress } = useStore()

  const completed = refreshProgress.filter((p) => p.status === 'done').length
  const total = refreshProgress.length

  return (
    <Button
      variant="primary"
      size="sm"
      onClick={refreshAll}
      disabled={isRefreshing}
    >
      <span className={styles.icon}>{isRefreshing ? '⟳' : '↻'}</span>
      {isRefreshing && total > 0
        ? `${completed}/${total}`
        : '刷新'}
    </Button>
  )
}
