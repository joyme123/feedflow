import { useState, useEffect } from 'react'
import { useStore } from '../../store'
import { Button } from '../common/Button'
import type { ConfigField, SourceConfig, Credential } from '@shared/types'
import styles from './SourceConfigForm.module.css'

interface SourceConfigFormProps {
  schema: ConfigField[]
  onSubmit: (config: SourceConfig) => Promise<void>
  submitting: boolean
  pluginId?: string
  /** 运行时动态加载的选项变化时通知父组件（用于生成更准确的信息源名称） */
  onDynamicOptionsChange?: (key: string, options: { label: string; value: string }[]) => void
}

export function SourceConfigForm({ schema, onSubmit, submitting, pluginId, onDynamicOptionsChange }: SourceConfigFormProps): JSX.Element {
  const { credentials, loadCredentials } = useStore()
  const [values, setValues] = useState<SourceConfig>(() => {
    const defaults: SourceConfig = {}
    for (const field of schema) {
      defaults[field.key] = field.default ?? ''
    }
    return defaults
  })
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [verifySuccess, setVerifySuccess] = useState<{ uid?: string; screenName?: string } | null>(null)

  // Inline credential form state
  const [addingCredFor, setAddingCredFor] = useState<string | null>(null)
  const [newCredName, setNewCredName] = useState('')
  const [newCredValue, setNewCredValue] = useState('')
  const [credVerifying, setCredVerifying] = useState(false)
  const [credVerifyError, setCredVerifyError] = useState<string | null>(null)
  const [credVerifySuccess, setCredVerifySuccess] = useState<{ uid?: string; screenName?: string } | null>(null)
  const [credSaving, setCredSaving] = useState(false)

  // Dynamic group options for weibo-group-chat plugin
  const [groupOptions, setGroupOptions] = useState<{ label: string; value: string }[]>([])
  const [groupLoading, setGroupLoading] = useState(false)

  // Load credentials for the current plugin so the dropdown can list them
  useEffect(() => {
    loadCredentials()
  }, [loadCredentials])

  // Load group options when a credential is selected for weibo-group-chat
  useEffect(() => {
    const credId = values['cookie'] as string | undefined
    if (pluginId === 'feedflow-plugin-weibo-group-chat' && credId) {
      setGroupLoading(true)
      window.api.listGroups(pluginId, credId)
        .then((groups) => {
          const opts = groups as { label: string; value: string }[]
          setGroupOptions(opts)
          onDynamicOptionsChange?.('group_id', opts)
        })
        .catch((err) => {
          console.error('Failed to load groups:', err)
          setGroupOptions([])
          onDynamicOptionsChange?.('group_id', [])
        })
        .finally(() => setGroupLoading(false))
    } else {
      setGroupOptions([])
    }
  }, [pluginId, values['cookie']])

  // 插件支持 Cookie 验证（配置中包含 cookie 字段，且不是 credential 类型）
  const supportsCookieVerify = !!pluginId && schema.some((f) => f.key === 'cookie' && f.type !== 'credential')

  // Show credentials from all plugins so cookies can be shared across
  // plugins that use the same auth (e.g. weibo.com cookie works for both
  // 微博关注流 and 微博群聊)
  const pluginCredentials = credentials

  const handleChange = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  const handleVerifyCookie = async () => {
    if (!pluginId) return
    const cookie = (values['cookie'] as string) ?? ''
    if (!cookie.trim()) {
      setVerifyError('请先填写 Cookie')
      return
    }

    setVerifying(true)
    setVerifyError(null)
    setVerifySuccess(null)
    try {
      const result = await window.api.verifyCookie(pluginId, cookie)
      if (result.valid) {
        setVerifySuccess({ uid: result.uid, screenName: result.screenName })
        // 如果返回了 UID 且配置中有 uid 字段，自动填入
        if (result.uid && schema.some((f) => f.key === 'uid')) {
          handleChange('uid', result.uid)
        }
      } else {
        setVerifyError(result.error || 'Cookie 验证失败')
      }
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err))
    } finally {
      setVerifying(false)
    }
  }

  // ---- Inline credential form handlers ----

  const openCredForm = (fieldKey: string) => {
    setAddingCredFor(fieldKey)
    setNewCredName('')
    setNewCredValue('')
    setCredVerifyError(null)
    setCredVerifySuccess(null)
  }

  const handleVerifyCred = async () => {
    if (!pluginId) return
    if (!newCredValue.trim()) {
      setCredVerifyError('请先填写 Cookie')
      return
    }
    setCredVerifying(true)
    setCredVerifyError(null)
    setCredVerifySuccess(null)
    try {
      const result = await window.api.verifyCookie(pluginId, newCredValue)
      if (result.valid) {
        setCredVerifySuccess({ uid: result.uid, screenName: result.screenName })
      } else {
        setCredVerifyError(result.error || 'Cookie 验证失败')
      }
    } catch (err) {
      setCredVerifyError(err instanceof Error ? err.message : String(err))
    } finally {
      setCredVerifying(false)
    }
  }

  const handleSaveCred = async (fieldKey: string) => {
    if (!pluginId) return
    if (!newCredName.trim()) {
      setCredVerifyError('请填写凭据名称')
      return
    }
    if (!newCredValue.trim()) {
      setCredVerifyError('请填写 Cookie')
      return
    }
    setCredSaving(true)
    try {
      const extra: Record<string, unknown> = {}
      if (credVerifySuccess?.uid) extra.uid = credVerifySuccess.uid
      if (credVerifySuccess?.screenName) extra.screenName = credVerifySuccess.screenName
      const cred = await window.api.addCredential({
        pluginId,
        name: newCredName.trim(),
        value: newCredValue,
        extra
      }) as Credential
      // Select the newly created credential in the dropdown
      handleChange(fieldKey, cred.id)
      setAddingCredFor(null)
    } catch (err) {
      setCredVerifyError(err instanceof Error ? err.message : String(err))
    } finally {
      setCredSaving(false)
    }
  }

  const credLabel = (cred: Credential): string => {
    const screenName = cred.extra?.screenName as string | undefined
    return screenName ? `${cred.name}（@${screenName}）` : cred.name
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(values)
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      {schema.map((field) => (
        <div key={field.key} className={styles.field}>
          <label className={styles.label}>
            {field.label}
            {field.required && <span className={styles.required}> *</span>}
          </label>

          {field.type === 'credential' && (
            <div>
              <select
                className={styles.input}
                value={(values[field.key] as string) ?? ''}
                onChange={(e) => handleChange(field.key, e.target.value)}
              >
                <option value="">请选择凭据{pluginCredentials.length === 0 ? '（暂无凭据，请先添加）' : ''}</option>
                {pluginCredentials.map((cred) => (
                  <option key={cred.id} value={cred.id}>
                    {credLabel(cred)}
                  </option>
                ))}
              </select>

              {addingCredFor !== field.key && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => openCredForm(field.key)}
                  style={{ marginTop: 8 }}
                >
                  + 添加新凭据
                </Button>
              )}

              {addingCredFor === field.key && (
                <div className={styles.authSection} style={{ marginTop: 8 }}>
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="凭据名称，如「我的 X 账号」"
                    value={newCredName}
                    onChange={(e) => setNewCredName(e.target.value)}
                  />
                  <textarea
                    className={styles.textarea}
                    placeholder="粘贴 Cookie"
                    value={newCredValue}
                    rows={3}
                    onChange={(e) => setNewCredValue(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Button type="button" variant="ghost" size="sm" onClick={handleVerifyCred} disabled={credVerifying}>
                      {credVerifying ? '验证中...' : credVerifySuccess ? '✓ 已验证，重新验证' : '🔑 验证 Cookie'}
                    </Button>
                    <Button type="button" variant="primary" size="sm" onClick={() => handleSaveCred(field.key)} disabled={credSaving}>
                      {credSaving ? '保存中...' : '保存凭据'}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setAddingCredFor(null)} disabled={credSaving}>
                      取消
                    </Button>
                  </div>
                  {credVerifyError && <span className={styles.authError}>{credVerifyError}</span>}
                  {credVerifySuccess && (
                    <span className={styles.authSuccess}>
                      Cookie 有效{credVerifySuccess.screenName ? `，用户: ${credVerifySuccess.screenName}` : ''}
                      {credVerifySuccess.uid ? ` (UID: ${credVerifySuccess.uid})` : ''}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {field.type === 'text' && (
            <input
              type="text"
              className={styles.input}
              value={(values[field.key] as string) ?? ''}
              placeholder={field.placeholder}
              onChange={(e) => handleChange(field.key, e.target.value)}
            />
          )}

          {field.type === 'password' && (
            <input
              type="password"
              className={styles.input}
              value={(values[field.key] as string) ?? ''}
              placeholder={field.placeholder}
              onChange={(e) => handleChange(field.key, e.target.value)}
            />
          )}

          {field.type === 'number' && (
            <input
              type="number"
              className={styles.input}
              value={(values[field.key] as number) ?? ''}
              min={field.min}
              max={field.max}
              onChange={(e) => handleChange(field.key, Number(e.target.value))}
            />
          )}

          {field.type === 'text-area' && (
            <textarea
              className={styles.textarea}
              value={(values[field.key] as string) ?? ''}
              placeholder={field.placeholder}
              rows={3}
              onChange={(e) => handleChange(field.key, e.target.value)}
            />
          )}

          {field.type === 'select' && (
            <div>
              <select
                className={styles.input}
                value={(values[field.key] as string) ?? ''}
                onChange={(e) => handleChange(field.key, e.target.value)}
              >
                <option value="">
                  {field.key === 'group_id'
                    ? (groupLoading ? '加载群聊列表中...' : '请选择群聊' + (groupOptions.length === 0 ? '（请先选择凭据）' : ''))
                    : '请选择'}
                </option>
                {(field.key === 'group_id' && groupOptions.length > 0
                  ? groupOptions
                  : (field.options ?? [])
                ).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              {field.key === 'group_id' && groupOptions.length === 0 && !groupLoading && (
                <span className={styles.help}>
                  请先选择上方的微博凭据，群聊列表将自动加载。
                </span>
              )}
            </div>
          )}

          {field.type === 'boolean' && (
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={(values[field.key] as boolean) ?? false}
                onChange={(e) => handleChange(field.key, e.target.checked)}
              />
              <span>启用</span>
            </label>
          )}

          {/* 在 cookie 字段下方显示 Cookie 验证按钮（仅非 credential 类型） */}
          {field.key === 'cookie' && supportsCookieVerify && (
            <div className={styles.authSection}>
              <Button type="button" variant="ghost" size="sm" onClick={handleVerifyCookie} disabled={verifying}>
                {verifying ? '验证中...' : verifySuccess ? '✓ 验证通过，重新验证' : '🔑 验证 Cookie'}
              </Button>
              {verifyError && <span className={styles.authError}>{verifyError}</span>}
              {verifySuccess && (
                <span className={styles.authSuccess}>
                  Cookie 有效{verifySuccess.screenName ? `，用户: ${verifySuccess.screenName}` : ''}
                  {verifySuccess.uid ? ` (UID: ${verifySuccess.uid})` : ''}
                </span>
              )}
            </div>
          )}

          {field.helpText && !(field.key === 'cookie' && supportsCookieVerify) && field.type !== 'credential' && (
            <span className={styles.help}>{field.helpText}</span>
          )}

          {/* Cookie 字段的帮助文本放在验证按钮下方 */}
          {field.key === 'cookie' && supportsCookieVerify && field.helpText && (
            <span className={styles.help}>{field.helpText}</span>
          )}

          {/* credential 字段的帮助文本放在下拉框下方 */}
          {field.type === 'credential' && field.helpText && (
            <span className={styles.help}>{field.helpText}</span>
          )}
        </div>
      ))}

      <div className={styles.actions}>
        <Button type="submit" disabled={submitting}>
          {submitting ? '添加中...' : '添加信息源'}
        </Button>
      </div>
    </form>
  )
}
