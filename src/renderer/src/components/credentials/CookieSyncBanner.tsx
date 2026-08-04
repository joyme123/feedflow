import { Button } from '../common/Button'
import styles from './CookieSyncBanner.module.css'

export type ExtensionStatusState = 'unknown' | 'active' | 'stale'

export interface ExtensionStatus {
  status: ExtensionStatusState
  lastSeen: number | null
  serverRunning: boolean
}

interface CookieSyncBannerProps {
  status: ExtensionStatus
  onRefresh?: () => void
}

/** Login page URLs per provider, used by the "Open browser" button */
const PROVIDER_LOGIN_URLS: Record<string, string> = {
  weibo: 'https://weibo.com',
  x: 'https://x.com',
  v2ex: 'https://v2ex.com',
}

export function CookieSyncBanner({ status, onRefresh }: CookieSyncBannerProps): JSX.Element | null {
  if (status.status === 'unknown') {
    return (
      <div className={`${styles.banner} ${styles.bannerInfo}`}>
        <div className={styles.icon}>💡</div>
        <div className={styles.content}>
          <div className={styles.title}>更简单的方式：安装 FeedFlow Chrome 扩展</div>
          <div className={styles.desc}>
            安装后在浏览器中登录微博 / X，Cookie 会自动同步到此处，无需手动复制粘贴。
          </div>
        </div>
        <div className={styles.actions}>
          <Button variant="primary" size="sm" onClick={() => window.open('https://chrome.google.com/webstore')}>
            安装扩展
          </Button>
        </div>
      </div>
    )
  }

  if (status.status === 'stale') {
    return (
      <div className={`${styles.banner} ${styles.bannerWarn}`}>
        <div className={styles.icon}>⚠️</div>
        <div className={styles.content}>
          <div className={styles.title}>FeedFlow 扩展可能未运行，自动同步可能已停止</div>
          <div className={styles.desc}>请打开 Chrome 浏览器确认扩展已启用，然后刷新列表查看最新状态。</div>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="sm" onClick={onRefresh}>刷新列表</Button>
        </div>
      </div>
    )
  }

  // active
  return (
    <div className={`${styles.banner} ${styles.bannerSuccess}`}>
      <div className={styles.icon}>✅</div>
      <div className={styles.content}>
        <div className={styles.title}>检测到 FeedFlow 扩展已安装</div>
        <div className={styles.desc}>
          请在浏览器中登录对应的网站，Cookie 会自动同步到此处，无需手动操作。
        </div>
      </div>
      <div className={styles.actions}>
        <Button variant="ghost" size="sm" onClick={() => window.open('https://weibo.com')}>
          打开浏览器
        </Button>
        <Button variant="ghost" size="sm" onClick={onRefresh}>刷新列表</Button>
      </div>
    </div>
  )
}
