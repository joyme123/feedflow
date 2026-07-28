import { useState } from 'react'
import { Button } from '../common/Button'
import type { ConfigField, SourceConfig } from '@shared/types'
import styles from './SourceConfigForm.module.css'

interface SourceConfigFormProps {
  schema: ConfigField[]
  onSubmit: (config: SourceConfig) => Promise<void>
  submitting: boolean
  pluginId?: string
}

export function SourceConfigForm({ schema, onSubmit, submitting, pluginId }: SourceConfigFormProps): JSX.Element {
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

  // 插件支持 Cookie 验证（配置中包含 cookie 字段）
  const supportsCookieVerify = !!pluginId && schema.some((f) => f.key === 'cookie')

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
            <select
              className={styles.input}
              value={(values[field.key] as string) ?? ''}
              onChange={(e) => handleChange(field.key, e.target.value)}
            >
              {field.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
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

          {/* 在 cookie 字段下方显示 Cookie 验证按钮 */}
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

          {field.helpText && !(field.key === 'cookie' && supportsCookieVerify) && (
            <span className={styles.help}>{field.helpText}</span>
          )}

          {/* Cookie 字段的帮助文本放在验证按钮下方 */}
          {field.key === 'cookie' && supportsCookieVerify && field.helpText && (
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
