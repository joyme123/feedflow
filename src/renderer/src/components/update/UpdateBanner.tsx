import { useEffect } from 'react'
import { useStore } from '../../store'
import { Button } from '../common/Button'
import type { UpdateInfo, DownloadProgress } from '@shared/types/ipc'
import styles from './UpdateBanner.module.css'

export function UpdateBanner(): JSX.Element | null {
  const {
    updateStatus,
    updateInfo,
    downloadProgress,
    updateError,
    quitAndInstall,
    dismissUpdate
  } = useStore()

  // 订阅主进程推送的更新事件，同步到 store
  useEffect(() => {
    const unsubAvailable = window.api.onUpdateAvailable((data) => {
      const info = data as UpdateInfo
      useStore.setState({ updateStatus: 'available', updateInfo: info, downloadProgress: 0 })
    })

    const unsubNotAvailable = window.api.onUpdateNotAvailable(() => {
      useStore.setState({ updateStatus: 'idle', updateInfo: null, downloadProgress: 0 })
    })

    const unsubProgress = window.api.onUpdateDownloadProgress((data) => {
      const progress = data as DownloadProgress
      useStore.setState({ updateStatus: 'downloading', downloadProgress: progress.percent })
    })

    const unsubDownloaded = window.api.onUpdateDownloaded((data) => {
      const info = data as UpdateInfo
      useStore.setState({ updateStatus: 'downloaded', updateInfo: info, downloadProgress: 100 })
    })

    const unsubError = window.api.onUpdateError((data) => {
      const { message } = data as { message: string }
      useStore.setState({ updateStatus: 'error', updateError: message })
    })

    return () => {
      unsubAvailable()
      unsubNotAvailable()
      unsubProgress()
      unsubDownloaded()
      unsubError()
    }
  }, [])

  // idle / checking 时不显示 banner
  if (updateStatus === 'idle' || updateStatus === 'checking') {
    return null
  }

  return (
    <div className={styles.banner}>
      {updateStatus === 'available' && (
        <span className={styles.text}>
          发现新版本 {updateInfo?.version}，正在后台下载…
        </span>
      )}

      {updateStatus === 'downloading' && (
        <div className={styles.progressWrap}>
          <span className={styles.text}>
            正在下载新版本 {updateInfo?.version}（{Math.round(downloadProgress)}%）
          </span>
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${downloadProgress}%` }}
            />
          </div>
        </div>
      )}

      {updateStatus === 'downloaded' && (
        <div className={styles.actions}>
          <span className={styles.text}>
            新版本 {updateInfo?.version} 已下载完成，重启后即可安装
          </span>
          <div className={styles.btnGroup}>
            <Button size="sm" variant="primary" onClick={quitAndInstall}>
              立即重启安装
            </Button>
            <Button size="sm" variant="ghost" onClick={dismissUpdate}>
              稍后
            </Button>
          </div>
        </div>
      )}

      {updateStatus === 'error' && (
        <div className={styles.actions}>
          <span className={styles.errorText}>更新检查失败：{updateError}</span>
          <Button size="sm" variant="ghost" onClick={dismissUpdate}>
            关闭
          </Button>
        </div>
      )}
    </div>
  )
}
