import { useState } from 'react'
import { useStore } from '../../store'
import { Button } from '../common/Button'
import styles from './AboutPanel.module.css'

export function AboutPanel(): JSX.Element {
  const { updateStatus, updateError, checkForUpdates } = useStore()
  const version = __APP_VERSION__
  const [devNotice, setDevNotice] = useState(false)

  const handleCheck = async (): Promise<void> => {
    setDevNotice(false)
    const result = await checkForUpdates()
    if (result?.devMode) setDevNotice(true)
  }

  return (
    <div className={styles.panel}>
      <div className={styles.versionRow}>
        <span className={styles.label}>当前版本</span>
        <span className={styles.version}>v{version}</span>
      </div>

      <div className={styles.versionRow}>
        <span className={styles.label}>更新状态</span>
        <span className={styles.status}>
          {statusLabel(updateStatus)}
        </span>
      </div>

      <div className={styles.actions}>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleCheck()}
          disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
        >
          {updateStatus === 'checking' ? '检查中…' : '检查更新'}
        </Button>
      </div>

      {devNotice && (
        <p className={styles.hint}>
          开发模式下不检查更新。如需测试自动更新流程，请使用打包后的应用（npm run package:mac）。
        </p>
      )}
      {!devNotice && updateStatus === 'error' && updateError && (
        <p className={styles.errorHint}>{updateError}</p>
      )}

      <p className={styles.hint}>
        应用启动后会自动检查更新。发现新版本时会在顶部显示提示条，下载完成后可一键重启安装。
      </p>
    </div>
  )
}

function statusLabel(status: string): string {
  switch (status) {
    case 'idle': return '—'
    case 'checking': return '正在检查…'
    case 'available': return '发现新版本'
    case 'downloading': return '正在下载…'
    case 'downloaded': return '已下载，等待安装'
    case 'error': return '检查失败'
    default: return '—'
  }
}
