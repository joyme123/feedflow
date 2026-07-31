import { useEffect, useState, type ReactNode } from 'react'
import { CredentialsPanel } from '../credentials/CredentialsPanel'
import { PluginList } from '../plugins/PluginList'
import { McpPanel } from './McpPanel'
import styles from './SettingsPage.module.css'

interface SettingsPageProps {
  open: boolean
  onClose: () => void
}

type TabId = 'credentials' | 'plugins' | 'mcp'

interface Tab {
  id: TabId
  label: string
  icon: string
  title: string
  description: string
  content: ReactNode
}

const TABS: Tab[] = [
  {
    id: 'credentials',
    label: '凭据',
    icon: '🔑',
    title: '凭据管理',
    description: '凭据可在多个信息源间复用，无需重复粘贴 Cookie',
    content: <CredentialsPanel />
  },
  {
    id: 'plugins',
    label: '插件',
    icon: '🔌',
    title: '插件',
    description: '插件放在 plugins/ 目录下即可自动加载',
    content: <PluginList />
  },
  {
    id: 'mcp',
    label: 'MCP Server',
    icon: '🤖',
    title: 'MCP Server',
    description: '为 AI agent 提供数据查询和刷新能力',
    content: <McpPanel />
  }
]

export function SettingsPage({ open, onClose }: SettingsPageProps): JSX.Element | null {
  const [tabId, setTabId] = useState<TabId>('credentials')

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const activeTab = TABS.find((t) => t.id === tabId) ?? TABS[0]

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.page} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <h2 className={styles.title}>设置</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>

        <div className={styles.body}>
          <nav className={styles.nav}>
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`${styles.navItem} ${tabId === t.id ? styles.navItemActive : ''}`}
                onClick={() => setTabId(t.id)}
              >
                <span className={styles.navIcon}>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </nav>

          <section className={styles.content}>
            <div className={styles.tabContent}>
              <div className={styles.tabHeader}>
                <h3 className={styles.tabTitle}>{activeTab.title}</h3>
                <p className={styles.tabDesc}>{activeTab.description}</p>
              </div>
              {activeTab.content}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
