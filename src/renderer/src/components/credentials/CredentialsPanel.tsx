import { useState, useEffect } from 'react'
import { useStore } from '../../store'
import { Button } from '../common/Button'
import type { Credential } from '@shared/types'
import styles from './CredentialsPanel.module.css'

const EMPTY_FORM = { name: '', value: '', pluginId: '' }

/**
 * Credential management UI without a Dialog wrapper.
 * Suitable for embedding inside a settings page / tab.
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

  const [filterPluginId, setFilterPluginId] = useState<string>('all')
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

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setVerifyError(null)
    setVerifySuccess(null)
    setEditingId(null)
    setAdding(false)
  }

  const startAdd = () => {
    resetForm()
    // 若当前筛选了具体插件，默认带入；否则留空让用户在表单中选择
    setForm((f) => ({ ...f, pluginId: filterPluginId === 'all' ? '' : filterPluginId }))
    setAdding(true)
  }

  const startEdit = (cred: Credential) => {
    resetForm()
    setEditingId(cred.id)
    setForm({ name: cred.name, value: cred.value, pluginId: cred.pluginId })
  }

  const handleVerify = async () => {
    if (!form.pluginId) {
      setVerifyError('请先选择所属插件以验证凭据')
      return
    }
    if (!form.value.trim()) {
      setVerifyError('请先填写 Cookie')
      return
    }
    setVerifying(true)
    setVerifyError(null)
    setVerifySuccess(null)
    try {
      const result = await window.api.verifyCookie(form.pluginId, form.value)
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
    const pluginId = form.pluginId
    if (!pluginId) {
      setVerifyError('请选择所属插件')
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
        await addCredential({ pluginId, name: form.name.trim(), value: form.value, extra })
      }
      resetForm()
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (cred: Credential) => {
    const { count } = await window.api.countCredentialReferences(cred.pluginId, cred.id)
    const msg = count > 0
      ? `此凭据被 ${count} 个信息源使用，删除后这些信息源将无法刷新。确定删除「${cred.name}」？`
      : `确定删除凭据「${cred.name}」？`
    if (window.confirm(msg)) {
      await removeCredential(cred.id)
    }
  }

  const pluginName = (pluginId: string): string =>
    plugins.find((p) => p.id === pluginId)?.name ?? pluginId

  const filtered = filterPluginId === 'all'
    ? credentials
    : credentials.filter((c) => c.pluginId === filterPluginId)

  const canVerify = !!form.pluginId && !!form.value.trim()

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <select
          className={styles.select}
          value={filterPluginId}
          onChange={(e) => setFilterPluginId(e.target.value)}
        >
          <option value="all">全部插件</option>
          {plugins.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
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
            <label className={styles.label}>所属插件</label>
            {editingId ? (
              <input
                type="text"
                className={styles.input}
                value={pluginName(form.pluginId)}
                disabled
              />
            ) : (
              <select
                className={styles.select}
                value={form.pluginId}
                onChange={(e) => setForm((f) => ({ ...f, pluginId: e.target.value }))}
              >
                <option value="">请选择插件</option>
                {plugins.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
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
          <p className={styles.empty}>暂无凭据{filterPluginId === 'all' ? '' : '（该插件暂无凭据）'}</p>
        )}
        {filtered.map((cred) => (
          <div key={cred.id} className={styles.credCard}>
            <div className={styles.credInfo}>
              <span className={styles.credName}>{cred.name}</span>
              <span className={styles.credMeta}>
                {pluginName(cred.pluginId)}
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
