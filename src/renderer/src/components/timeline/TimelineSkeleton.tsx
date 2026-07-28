import styles from './TimelineSkeleton.module.css'

interface TimelineSkeletonProps {
  count?: number
}

export function TimelineSkeleton({ count = 3 }: TimelineSkeletonProps): JSX.Element {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={styles.card}>
          <div className={styles.header}>
            <div className={`${styles.shimmer} ${styles.avatar}`} />
            <div className={`${styles.shimmer} ${styles.name}`} />
            <div className={`${styles.shimmer} ${styles.badge}`} />
          </div>
          <div className={`${styles.shimmer} ${styles.line}`} />
          <div className={`${styles.shimmer} ${styles.lineShort}`} />
          <div className={`${styles.shimmer} ${styles.footer}`} />
        </div>
      ))}
    </>
  )
}
