import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { SourceList } from '../sources/SourceList'
import { AddSourceDialog } from '../sources/AddSourceDialog'
import { PluginList } from '../plugins/PluginList'
import { CredentialManager } from '../credentials/CredentialManager'
import { RefreshButton } from '../timeline/RefreshButton'
import { Button } from '../common/Button'
import styles from './Sidebar.module.css'

export function Sidebar(): JSX.Element {
  const { loadSources, loadPlugins, sources, plugins } = useStore()
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [credManagerOpen, setCredManagerOpen] = useState(false)

  useEffect(() => {
    loadSources()
    loadPlugins()
  }, [loadSources, loadPlugins])

  const hasSources = sources.length > 0

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

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>凭据</h2>
          <Button variant="ghost" size="sm" onClick={() => setCredManagerOpen(true)}>
            管理
          </Button>
        </div>
        <p className={styles.credHint}>凭据可在多个信息源间复用，无需重复粘贴 Cookie</p>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>插件</h2>
        </div>
        <PluginList />
      </section>

      <footer className={styles.footer}>
        <span className={styles.version}>FeedFlow v0.1.0</span>
      </footer>

      <AddSourceDialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} />
      <CredentialManager open={credManagerOpen} onClose={() => setCredManagerOpen(false)} />
    </div>
  )
}
