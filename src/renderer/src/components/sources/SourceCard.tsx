import { useState, type MouseEvent, type ChangeEvent } from 'react'
import { useStore } from '../../store'
import { Button } from '../common/Button'
import type { Source } from '@shared/types/source'
import styles from './SourceCard.module.css'

interface SourceCardProps {
  source: Source
  selected?: boolean
  onSelect?: () => void
}

export function SourceCard({ source, selected, onSelect }: SourceCardProps): JSX.Element {
  const { toggleSource, removeSource, refreshSource, plugins } = useStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const plugin = plugins.find((p) => p.id === source.pluginId)

  const handleRefresh = async (e: MouseEvent) => {
    e.stopPropagation()
    if (refreshing) return
    setRefreshing(true)
    await refreshSource(source.id)
    setTimeout(() => setRefreshing(false), 1000)
  }

  const handleToggle = (e: ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation()
    toggleSource(source.id)
  }

  const handleMenuToggle = (e: MouseEvent) => {
    e.stopPropagation()
    setMenuOpen(!menuOpen)
  }

  const handleRemove = (e: MouseEvent) => {
    e.stopPropagation()
    setMenuOpen(false)
    removeSource(source.id)
  }

  return (
    <div
      className={`${styles.card} ${!source.enabled ? styles.disabled : ''} ${selected ? styles.selected : ''}`}
      onClick={onSelect}
    >
      <div className={styles.left}>
        <span
          className={styles.dot}
          style={{ background: plugin?.color ?? 'var(--color-text-secondary)' }}
        />
        <div className={styles.info}>
          <span className={styles.name}>{source.name}</span>
          <span className={styles.pluginName}>{plugin?.name ?? source.pluginId}</span>
        </div>
      </div>
      <div className={styles.right} onClick={(e) => e.stopPropagation()}>
        <Button
          variant="ghost"
          size="sm"
          className={`${styles.refreshBtn} ${refreshing ? styles.spinning : ''}`}
          onClick={handleRefresh}
          disabled={refreshing}
          title="刷新该信息源"
        >
          ↻
        </Button>
        <label className={styles.toggle}>
          <input
            type="checkbox"
            checked={source.enabled}
            onChange={handleToggle}
          />
          <span className={styles.slider} />
        </label>
        <div className={styles.menuWrapper}>
          <Button variant="ghost" size="sm" onClick={handleMenuToggle}>
            ···
          </Button>
          {menuOpen && (
            <>
              <div className={styles.backdrop} onClick={() => setMenuOpen(false)} />
              <div className={styles.menu}>
                <button
                  className={styles.menuItem}
                  onClick={handleRemove}
                >
                  删除
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
