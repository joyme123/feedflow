import styles from './AggregatedSourceItem.module.css'

interface AggregatedSourceItemProps {
  selected: boolean
  onClick: () => void
}

export function AggregatedSourceItem({ selected, onClick }: AggregatedSourceItemProps): JSX.Element {
  return (
    <div
      className={`${styles.item} ${selected ? styles.selected : ''}`}
      onClick={onClick}
    >
      <span className={styles.icon}>🗂️</span>
      <span className={styles.name}>聚合流</span>
    </div>
  )
}
