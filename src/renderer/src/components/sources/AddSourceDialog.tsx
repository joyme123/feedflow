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

/**
 * 根据插件配置生成更具区分度的信息源名称。
 *
 * 默认情况下信息源名等于插件名，这会导致同一插件的多个实例（例如 X 的
 * 「关注」与「为你推荐」流）在侧边栏中显示成一样的名字，无法区分。
 * 这里把能标识流类型的配置项（如 feedType、group_id、topics 等 select
 * 字段）的选项 label 拼接到插件名后，让用户一眼能看出是哪个流。
 */
function buildSourceName(
  pluginName: string,
  schema: ConfigField[],
  config: SourceConfig,
  dynamicOptions: Record<string, { label: string; value: string }[]> = {}
): string {
  const parts: string[] = []

  for (const field of schema) {
    if (field.type !== 'select') continue
    const value = config[field.key]
    if (value === undefined || value === null || value === '') continue

    // 优先使用静态 options，其次使用运行时动态加载的 options（如群聊列表）
    const options = field.options ?? dynamicOptions[field.key] ?? []
    const matched = options.find((o) => String(o.value) === String(value))
    if (matched) {
      parts.push(matched.label)
    }
  }

  return parts.length > 0 ? `${pluginName} · ${parts.join(' / ')}` : pluginName
}

export function AddSourceDialog({ open, onClose }: AddSourceDialogProps): JSX.Element {
  const { plugins, addSource, getPluginConfigSchema } = useStore()
  const [step, setStep] = useState<'pick' | 'config'>('pick')
  const [selectedPlugin, setSelectedPlugin] = useState<PluginMeta | null>(null)
  const [configSchema, setConfigSchema] = useState<ConfigField[]>([])
  const [submitting, setSubmitting] = useState(false)
  // 运行时动态加载的选项（目前用于微博群聊的 group_id 列表），用于生成更准确的名称
  const [dynamicOptions, setDynamicOptions] = useState<Record<string, { label: string; value: string }[]>>({})

  useEffect(() => {
    if (open) {
      setStep('pick')
      setSelectedPlugin(null)
      setConfigSchema([])
      setDynamicOptions({})
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
    const name = buildSourceName(selectedPlugin.name, configSchema, config, dynamicOptions)
    await addSource({
      pluginId: selectedPlugin.id,
      name,
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
            onDynamicOptionsChange={(key, options) =>
              setDynamicOptions((prev) => ({ ...prev, [key]: options }))
            }
          />
        </div>
      )}
    </Dialog>
  )
}
