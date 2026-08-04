import { useState, useEffect } from 'react'
import { useStore } from '../../store'
import { Button } from '../common/Button'
import type { ExtensionStatus } from '../credentials/CookieSyncBanner'
import styles from './RefreshErrorBanner.module.css'

/** Shows a banner when source refresh fails, with cookie-sync guidance.
 *  If the extension is active, suggests re-login in the browser (auto-sync).
 *  Otherwise, suggests installing the extension or manually updating credentials. */
export function RefreshErrorBanner(): JSX.Element | null {
  const { refreshProgress } = useStore()
  const [extStatus, setExtStatus] = useState<ExtensionStatus>({
    status: 'unknown',
    lastSeen: null,
    serverRunning: false,
  })
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    window.api.getCookieSyncStatus()
      .then((s) => setExtStatus(s as ExtensionStatus))
      .catch(() => { /* ignore */ })
  }, [])

  // Reset dismissed when a new refresh starts
  useEffect(() => {
    if (refreshProgress.length === 0) setDismissed(false)
  }, [refreshProgress.length])

  const errors = refreshProgress.filter((p) => p.status === 'error')
  if (errors.length === 0 || dismissed) return null

  const error = errors[0]
  const extActive = extStatus.status === 'active'

  return (
    <div className={styles.banner}>
      <div className={styles.icon}>⚠️</div>
      <div className={styles.content}>
        <div className={styles.title}>刷新失败：{error.sourceName}</div>
        <div className={styles.desc}>{error.error}</div>
        {extActive ? (
          <div className={styles.hint}>
            Cookie 可能已过期。请在浏览器中重新登录该网站，Cookie 将自动同步到 FeedFlow。
          </div>
        ) : (
          <div className={styles.hint}>
            Cookie 可能已过期。可安装 FeedFlow Chrome 扩展实现自动同步，或在「设置 → 凭据」中手动更新。
          </div>
        )}
      </div>
      <div className={styles.actions}>
        {extActive && (
          <Button variant="ghost" size="sm" onClick={() => window.open('https://weibo.com')}>
            打开浏览器
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
          知道了
        </Button>
      </div>
    </div>
  )
}
