import { useEffect, useState } from 'react'
import styles from './McpPanel.module.css'

export function McpPanel(): JSX.Element {
  const [enabled, setEnabled] = useState(true)
  const [port, setPort] = useState('33939')
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)

  // 加载当前设置
  useEffect(() => {
    Promise.all([
      window.api.getSetting('mcp.enabled'),
      window.api.getSetting('mcp.port'),
    ]).then(([enabledVal, portVal]) => {
      setEnabled(enabledVal !== 'false')
      setPort(portVal || '33939')
    })
  }, [])

  const handleSave = () => {
    window.api.setSetting('mcp.enabled', String(enabled))
    window.api.setSetting('mcp.port', port)
    setDirty(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const portNum = Number(port)
  const portValid = portNum >= 1024 && portNum <= 65535

  return (
    <div className={styles.container}>
      <div className={styles.section}>
        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <label className={styles.settingLabel}>启用 MCP Server</label>
            <p className={styles.settingDesc}>
              开启后，本机 AI agent 可通过 MCP 协议查询信息流数据、触发刷新
            </p>
          </div>
          <button
            className={`${styles.toggle} ${enabled ? styles.toggleOn : ''}`}
            onClick={() => {
              setEnabled(!enabled)
              setDirty(true)
            }}
            role="switch"
            aria-checked={enabled}
          >
            <span className={styles.toggleThumb} />
          </button>
        </div>

        <div className={styles.settingRow}>
          <div className={styles.settingInfo}>
            <label className={styles.settingLabel}>监听端口</label>
            <p className={styles.settingDesc}>
              MCP Server 监听的本地端口，agent 通过此端口连接
            </p>
          </div>
          <input
            type="number"
            className={styles.portInput}
            value={port}
            min={1024}
            max={65535}
            onChange={(e) => {
              setPort(e.target.value)
              setDirty(true)
            }}
          />
        </div>

        {!portValid && (
          <p className={styles.error}>端口号需在 1024 - 65535 之间</p>
        )}

        <div className={styles.actions}>
          <button
            className={styles.saveBtn}
            onClick={handleSave}
            disabled={!dirty || !portValid}
          >
            保存设置
          </button>
          {saved && <span className={styles.savedHint}>已保存，需重启 app 生效</span>}
        </div>
      </div>

      <div className={styles.section}>
        <h4 className={styles.subTitle}>Agent 配置</h4>
        <p className={styles.settingDesc}>
          将以下配置添加到你的 MCP 客户端（如 Claude Code）的设置文件中：
        </p>
        <pre className={styles.codeBlock}>{`{
  "mcpServers": {
    "feedflow": {
      "url": "http://127.0.0.1:${port}/mcp"
    }
  }
}`}</pre>
      </div>

      <div className={styles.section}>
        <h4 className={styles.subTitle}>可用工具</h4>
        <ul className={styles.toolList}>
          <li><code>list_sources</code> — 获取信息源列表</li>
          <li><code>list_items</code> — 分页查询条目（翻页、时间段、按源过滤）</li>
          <li><code>search_items</code> — 关键词搜索</li>
          <li><code>get_item</code> — 单条详情（自动展开截断长文）</li>
          <li><code>refresh_source</code> — 主动刷新，获取最新数据</li>
        </ul>
      </div>
    </div>
  )
}
