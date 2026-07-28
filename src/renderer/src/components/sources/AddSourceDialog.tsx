import { useState, useEffect } from 'react'
import { useStore } from '../../store'
import { Dialog } from '../common/Dialog'
import { Button } from '../common/Button'
import { SourceConfigForm } from './SourceConfigForm'
import type { PluginMeta, ConfigField, SourceConfig } from '@shared/types'
import styles from './AddSourceDialog.module.css'

interface AddSourceDialogProps {
  open: boolean
  onClose: () => void
}

export function AddSourceDialog({ open, onClose }: AddSourceDialogProps): JSX.Element {
  const { plugins, addSource, getPluginConfigSchema } = useStore()
  const [step, setStep] = useState<'pick' | 'config'>('pick')
  const [selectedPlugin, setSelectedPlugin] = useState<PluginMeta | null>(null)
  const [configSchema, setConfigSchema] = useState<ConfigField[]>([])
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setStep('pick')
      setSelectedPlugin(null)
      setConfigSchema([])
    }
  }, [open])

  const handlePickPlugin = async (plugin: PluginMeta) => {
    setSelectedPlugin(plugin)
    const schema = await getPluginConfigSchema(plugin.id)
    setConfigSchema(schema)
    setStep('config')
  }

  const handleSubmit = async (config: SourceConfig) => {
    if (!selectedPlugin) return
    setSubmitting(true)
    await addSource({
      pluginId: selectedPlugin.id,
      name: selectedPlugin.name,
      config
    })
    setSubmitting(false)
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} title={step === 'pick' ? '选择信息源类型' : '配置信息源'} width={520}>
      {step === 'pick' && (
        <div className={styles.pluginGrid}>
          {plugins.length === 0 && (
            <p className={styles.emptyText}>暂无可用插件，请先安装插件</p>
          )}
          {plugins.map((plugin) => (
            <button
              key={plugin.id}
              className={styles.pluginCard}
              onClick={() => handlePickPlugin(plugin)}
            >
              <span className={styles.pluginIcon}>{plugin.icon ?? '📡'}</span>
              <span className={styles.pluginName}>{plugin.name}</span>
              <span className={styles.pluginDesc}>{plugin.description}</span>
            </button>
          ))}
        </div>
      )}

      {step === 'config' && selectedPlugin && (
        <div>
          <div className={styles.backRow}>
            <Button variant="ghost" size="sm" onClick={() => setStep('pick')}>
              ← 返回选择
            </Button>
          </div>
          <SourceConfigForm
            schema={configSchema}
            onSubmit={handleSubmit}
            submitting={submitting}
            pluginId={selectedPlugin.id}
          />
        </div>
      )}
    </Dialog>
  )
}
