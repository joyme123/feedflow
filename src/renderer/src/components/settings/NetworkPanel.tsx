import { useEffect, useState } from 'react'
import styles from './NetworkPanel.module.css'

const SUPPORTED_PROTOCOLS = ['http:', 'https:', 'socks:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:']

interface DetectedProxy {
  url: string
  source: 'env' | 'system'
}

/** 校验代理地址；返回错误信息，合法时返回 null */
function validateProxyUrl(raw: string, enabled: boolean): string | null {
  const trimmed = raw.trim()
  if (!enabled) return null
  if (!trimmed) return '启用代理后必须填写代理地址'
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return '代理地址格式不正确'
  }
  if (!SUPPORTED_PROTOCOLS.includes(url.protocol)) {
    return '仅支持 http://、https://、socks://、socks5:// 代理'
  }
  if (!url.hostname) return '代理地址缺少主机名'
  return null
}

export function NetworkPanel(): JSX.Element {
  const [enabled, setEnabled] = useState(false)
  const [url, setUrl] = useState('http://127.0.0.1:7890')
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [detectHint, setDetectHint] = useState<string | null>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)

  // 加载当前设置；从未配置过代理地址时，自动探测系统代理并预填
  useEffect(() => {
    void (async () => {
      const [enabledVal, urlVal] = await Promise.all([
        window.api.getSetting('proxy.enabled'),
        window.api.getSetting('proxy.url'),
      ])
      setEnabled(enabledVal === 'true')
      if (urlVal) {
        setUrl(urlVal)
        return
      }
      // 未保存过代理地址：预填系统代理（不标记 dirty，用户启用开关后即可保存）
      const detected = (await window.api.detectSystemProxy()) as DetectedProxy | null
      if (detected) {
        setUrl(detected.url)
        setDetectHint(
          detected.source === 'env'
            ? `已根据代理环境变量预填：${detected.url}`
            : `已检测到系统代理并预填：${detected.url}`
        )
      } else {
        setDetectHint('未检测到系统代理，请手动填写')
      }
    })()
  }, [])

  const handleDetect = async (): Promise<void> => {
    setDetecting(true)
    setDetectHint(null)
    try {
      const detected = (await window.api.detectSystemProxy()) as DetectedProxy | null
      if (detected) {
        setUrl(detected.url)
        setDirty(true)
        setDetectHint(
          detected.source === 'env'
            ? `检测到代理环境变量：${detected.url}`
            : `检测到系统代理：${detected.url}`
        )
      } else {
        setDetectHint('未检测到系统代理（当前可能为直连），请手动填写')
      }
    } finally {
      setDetecting(false)
    }
  }

  const urlError = validateProxyUrl(url, enabled)

  const handleSave = async (): Promise<void> => {
    if (urlError) return
    // 两次写入按序处理；以第二次（url 写入后）的 session 代理应用结果为准
    await window.api.setSetting('proxy.enabled', String(enabled))
    const result = (await window.api.setSetting('proxy.url', url.trim())) as
      | { proxyMediaError?: string | null }
      | undefined
    setDirty(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
    setMediaError(
      result?.proxyMediaError
        ? `插件请求代理已生效，但图片/视频代理应用失败：${result.proxyMediaError}`
        : null
    )
  }
  return (
    <div className={styles.container}>
      <div className={styles.section}>
        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <label className={styles.settingLabel}>启用代理服务器</label>
            <p className={styles.settingDesc}>
              开启后，勾选了「通过代理服务器访问」的信息源请求，以及时间线中的图片/视频，
              都将通过此代理发送
            </p>
          </div>
          <button
            className={`${styles.toggle} ${enabled ? styles.toggleOn : ''}`}
            onClick={() => {
              setEnabled(!enabled)
              setDirty(true)
              setMediaError(null)
            }}
            role="switch"
            aria-checked={enabled}
          >
            <span className={styles.toggleThumb} />
          </button>
        </div>

        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <label className={styles.settingLabel}>代理地址</label>
            <p className={styles.settingDesc}>
              支持 HTTP/HTTPS 与 SOCKS5 代理，例如 http://127.0.0.1:7890 或 socks5://127.0.0.1:1080
            </p>
          </div>
          <div className={styles.urlField}>
            <input
              type="text"
              className={styles.urlInput}
              value={url}
              placeholder="http://127.0.0.1:7890"
              onChange={(e) => {
                setUrl(e.target.value)
                setDirty(true)
                setMediaError(null)
              }}
            />
            <button
              type="button"
              className={styles.detectBtn}
              onClick={() => void handleDetect()}
              disabled={detecting}
            >
              {detecting ? '检测中…' : '检测系统代理'}
            </button>
          </div>
        </div>

        {urlError && <p className={styles.error}>{urlError}</p>}
        {!urlError && mediaError && <p className={styles.error}>{mediaError}</p>}
        {!urlError && !mediaError && detectHint && <p className={styles.detectHint}>{detectHint}</p>}

        <div className={styles.actions}>
          <button
            className={styles.saveBtn}
            onClick={handleSave}
            disabled={!dirty || !!urlError}
          >
            保存设置
          </button>
          {saved && <span className={styles.savedHint}>已保存，立即生效</span>}
        </div>
      </div>

      <div className={styles.section}>
        <p className={styles.settingDesc}>
          代理为全局配置，但<strong>仅对开启了「通过代理服务器访问」的信息源生效</strong>
          （在添加/编辑信息源时设置，X 关注流默认开启）。本地服务（MCP、Cookie 同步扩展通信）
          始终绕过代理。「检测系统代理」会读取系统网络代理设置（macOS / Windows / Linux）
          及 HTTPS_PROXY 等环境变量，支持 PAC 自动代理脚本。
        </p>
      </div>
    </div>
  )
}
