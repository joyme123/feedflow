import { useStore } from '../../store'
import { EmptyState } from '../common/EmptyState'
import styles from './PluginList.module.css'

export function PluginList(): JSX.Element {
  const { plugins, pluginsLoading } = useStore()

  if (pluginsLoading) {
    return <div style={{ padding: 'var(--spacing-sm) var(--spacing-md)', color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-sm)' }}>Loading...</div>
  }

  if (plugins.length === 0) {
    return (
      <EmptyState
        icon="🔌"
        title="暂无插件"
        description="插件放在 plugins/ 目录下即可自动加载"
      />
    )
  }

  return (
    <div className={styles.list}>
      {plugins.map((plugin) => (
        <div key={plugin.id} className={styles.item}>
          <span className={styles.icon}>{plugin.icon ?? '📡'}</span>
          <div className={styles.info}>
            <span className={styles.name}>{plugin.name}</span>
            <span className={styles.version}>v{plugin.version}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
