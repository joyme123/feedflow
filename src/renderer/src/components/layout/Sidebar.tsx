import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { SourceList } from '../sources/SourceList'
import { AddSourceDialog } from '../sources/AddSourceDialog'
import { RefreshButton } from '../timeline/RefreshButton'
import { Button } from '../common/Button'
import { SettingsPage } from '../settings/SettingsPage'
import styles from './Sidebar.module.css'

export function Sidebar(): JSX.Element {
  const { loadSources, loadPlugins } = useStore()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    loadSources()
    loadPlugins()
  }, [loadSources, loadPlugins])

  return (
    <div className={styles.sidebar}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <h1 className={styles.logo}>FeedFlow</h1>
          <span className={styles.subtitle}>信息流聚合</span>
        </div>
        <RefreshButton />
      </header>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>信息源</h2>
          <Button variant="ghost" size="sm" onClick={() => setAddDialogOpen(true)}>
            + 添加
          </Button>
        </div>
        <SourceList />
      </section>

      <footer className={styles.footer}>
        <Button variant="ghost" size="sm" className={styles.settingsBtn} onClick={() => setSettingsOpen(true)}>
          ⚙️ 设置
        </Button>
        <span className={styles.version}>FeedFlow v0.1.0</span>
      </footer>

      <AddSourceDialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} />
      <SettingsPage open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}
