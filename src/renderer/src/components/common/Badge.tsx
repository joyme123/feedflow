import styles from './Badge.module.css'

interface BadgeProps {
  label: string
  color?: string
  size?: 'sm' | 'md'
}

export function Badge({ label, color, size = 'sm' }: BadgeProps): JSX.Element {
  return (
    <span
      className={`${styles.badge} ${styles[size]}`}
      style={color ? { backgroundColor: color, color: '#fff' } : undefined}
    >
      {label}
    </span>
  )
}
