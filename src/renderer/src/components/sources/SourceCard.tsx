import { useState, useRef, type MouseEvent, type ChangeEvent, type KeyboardEvent } from 'react'
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
  const { toggleSource, removeSource, renameSource, refreshSource, plugins } = useStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(source.name)
  // 防止 Enter 同时触发 keydown 与 blur 导致重复提交
  const committingRef = useRef(false)
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

  const startRenaming = (e: MouseEvent) => {
    e.stopPropagation()
    setMenuOpen(false)
    setRenameValue(source.name)
    committingRef.current = false
    setRenaming(true)
  }

  const commitRename = async () => {
    if (committingRef.current) return
    committingRef.current = true
    const trimmed = renameValue.trim()
    setRenaming(false)
    if (trimmed && trimmed !== source.name) {
      await renameSource(source.id, trimmed)
    }
  }

  const cancelRename = () => {
    setRenaming(false)
    setRenameValue(source.name)
  }

  const handleRenameKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commitRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelRename()
    }
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
          {renaming ? (
            <input
              className={styles.renameInput}
              value={renameValue}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={handleRenameKeyDown}
              onBlur={commitRename}
            />
          ) : (
            <span className={styles.name}>{source.name}</span>
          )}
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
                  onClick={startRenaming}
                >
                  重命名
                </button>
                <button
                  className={`${styles.menuItem} ${styles.menuItemDanger}`}
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
