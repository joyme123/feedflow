import { useState, useEffect, useMemo } from 'react'
import { useStore } from '../../store'
import { Button } from '../common/Button'
import type { Credential } from '@shared/types'
import styles from './CredentialsPanel.module.css'

const EMPTY_FORM = { name: '', value: '', provider: '' }

/**
 * Credential management UI without a Dialog wrapper.
 * Suitable for embedding inside a settings page / tab.
 *
 * Credentials are scoped to a service *provider* rather than a single
 * plugin, so multiple plugins of the same provider (e.g. 微博关注流 +
 * 微博群聊) can share one cookie.
 */
export function CredentialsPanel(): JSX.Element {
  const {
    credentials,
    plugins,
    loadCredentials,
    loadPlugins,
    addCredential,
    updateCredential,
    removeCredential
  } = useStore()

  const [filterProvider, setFilterProvider] = useState<string>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [verifySuccess, setVerifySuccess] = useState<{ uid?: string; screenName?: string } | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    loadCredentials()
    loadPlugins()
  }, [loadCredentials, loadPlugins])

  // Distinct providers across all plugins, preserving first-seen order.
  const providers = useMemo(() => {
    const seen = new Set<string>()
    const list: { id: string; label: string }[] = []
    for (const p of plugins) {
      const id = p.provider
      if (seen.has(id)) continue
      seen.add(id)
      // Use the provider's display name (not the plugin name).
      list.push({ id, label: p.providerName ?? id })
    }
    return list
  }, [plugins])

  const providerLabel = (provider: string): string =>
    providers.find((p) => p.id === provider)?.label ?? provider

  // Pick any plugin of the given provider to delegate cookie verification.
  const pluginIdForProvider = (provider: string): string | undefined =>
    plugins.find((p) => p.provider === provider)?.id

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setVerifyError(null)
    setVerifySuccess(null)
    setEditingId(null)
    setAdding(false)
  }

  const startAdd = () => {
    resetForm()
    // 若当前筛选了具体服务提供方，默认带入；否则留空让用户在表单中选择
    setForm((f) => ({ ...f, provider: filterProvider === 'all' ? '' : filterProvider }))
    setAdding(true)
  }

  const startEdit = (cred: Credential) => {
    resetForm()
    setEditingId(cred.id)
    setForm({ name: cred.name, value: cred.value, provider: cred.provider })
  }

  const handleVerify = async () => {
    if (!form.provider) {
      setVerifyError('请先选择所属服务提供方以验证凭据')
      return
    }
    if (!form.value.trim()) {
      setVerifyError('请先填写 Cookie')
      return
    }
    const pluginId = pluginIdForProvider(form.provider)
    if (!pluginId) {
      setVerifyError('没有可用的插件来验证此 Cookie')
      return
    }
    setVerifying(true)
    setVerifyError(null)
    setVerifySuccess(null)
    try {
      const result = await window.api.verifyCookie(pluginId, form.value)
      if (result.valid) {
        setVerifySuccess({ uid: result.uid, screenName: result.screenName })
      } else {
        setVerifyError(result.error || 'Cookie 验证失败')
      }
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err))
    } finally {
      setVerifying(false)
    }
  }

  const handleSave = async () => {
    if (!form.name.trim()) {
      setVerifyError('请填写凭据名称')
      return
    }
    if (!form.value.trim()) {
      setVerifyError('请填写 Cookie')
      return
    }
    const provider = form.provider
    if (!provider) {
      setVerifyError('请选择所属服务提供方')
      return
    }
    setSaving(true)
    try {
      const extra: Record<string, unknown> = {}
      if (verifySuccess?.uid) extra.uid = verifySuccess.uid
      if (verifySuccess?.screenName) extra.screenName = verifySuccess.screenName
      if (editingId) {
        await updateCredential(editingId, { name: form.name.trim(), value: form.value, extra })
      } else {
        await addCredential({ provider, name: form.name.trim(), value: form.value, extra })
      }
      resetForm()
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (cred: Credential) => {
    const { count } = await window.api.countCredentialReferences(cred.id)
    const msg = count > 0
      ? `此凭据被 ${count} 个信息源使用，删除后这些信息源将无法刷新。确定删除「${cred.name}」？`
      : `确定删除凭据「${cred.name}」？`
    if (window.confirm(msg)) {
      await removeCredential(cred.id)
    }
  }

  const filtered = filterProvider === 'all'
    ? credentials
    : credentials.filter((c) => c.provider === filterProvider)

  const canVerify = !!form.provider && !!form.value.trim()

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <select
          className={styles.select}
          value={filterProvider}
          onChange={(e) => setFilterProvider(e.target.value)}
        >
          <option value="all">全部服务提供方</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>
        <Button variant="primary" size="sm" onClick={startAdd}>+ 添加凭据</Button>
      </div>

      {(adding || editingId) && (
        <div className={styles.formCard}>
          <h3 className={styles.formTitle}>{editingId ? '编辑凭据' : '添加凭据'}</h3>
          <div className={styles.field}>
            <label className={styles.label}>凭据名称</label>
            <input
              type="text"
              className={styles.input}
              placeholder="如「我的 X 账号」"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className={styles.field}>
            <label className={styles.label}>所属服务提供方</label>
            {editingId ? (
              <input
                type="text"
                className={styles.input}
                value={providerLabel(form.provider)}
                disabled
              />
            ) : (
              <select
                className={styles.select}
                value={form.provider}
                onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))}
              >
                <option value="">请选择服务提供方</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            )}
          </div>
          <div className={styles.field}>
            <label className={styles.label}>Cookie</label>
            <textarea
              className={styles.textarea}
              placeholder="粘贴 Cookie"
              value={form.value}
              rows={3}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
            />
          </div>
          <div className={styles.formActions}>
            <Button type="button" variant="ghost" size="sm" onClick={handleVerify} disabled={verifying || !canVerify}>
              {verifying ? '验证中...' : verifySuccess ? '✓ 已验证，重新验证' : '🔑 验证 Cookie'}
            </Button>
            <Button type="button" variant="primary" size="sm" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={resetForm} disabled={saving}>
              取消
            </Button>
          </div>
          {verifyError && <span className={styles.error}>{verifyError}</span>}
          {verifySuccess && (
            <span className={styles.success}>
              Cookie 有效{verifySuccess.screenName ? `，用户: ${verifySuccess.screenName}` : ''}
              {verifySuccess.uid ? ` (UID: ${verifySuccess.uid})` : ''}
            </span>
          )}
        </div>
      )}

      <div className={styles.list}>
        {filtered.length === 0 && (
          <p className={styles.empty}>暂无凭据{filterProvider === 'all' ? '' : '（该服务提供方暂无凭据）'}</p>
        )}
        {filtered.map((cred) => (
          <div key={cred.id} className={styles.credCard}>
            <div className={styles.credInfo}>
              <span className={styles.credName}>{cred.name}</span>
              <span className={styles.credMeta}>
                {providerLabel(cred.provider)}
                {cred.extra?.screenName ? ` · @${String(cred.extra.screenName)}` : ''}
                {cred.extra?.uid ? ` (UID: ${String(cred.extra.uid)})` : ''}
              </span>
            </div>
            <div className={styles.credActions}>
              <Button variant="ghost" size="sm" onClick={() => startEdit(cred)}>编辑</Button>
              <Button variant="danger" size="sm" onClick={() => handleDelete(cred)}>删除</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
