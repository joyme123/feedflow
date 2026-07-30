import { useStore } from '../../store'
import { SourceCard } from './SourceCard'
import { AggregatedSourceItem } from './AggregatedSourceItem'
import styles from './SourceList.module.css'

export function SourceList(): JSX.Element {
  const { sources, sourcesLoading, selectedSourceId, selectSource } = useStore()

  if (sourcesLoading) {
    return <div style={{ padding: 'var(--spacing-md)', color: 'var(--color-text-secondary)' }}>Loading...</div>
  }

  // Separate sources by feed type
  const timelineSources = sources.filter((s) => s.feedType !== 'group-chat')
  const groupChatSources = sources.filter((s) => s.feedType === 'group-chat')

  return (
    <div>
      <AggregatedSourceItem
        selected={selectedSourceId === null}
        onClick={() => selectSource(null)}
      />
      {timelineSources.map((source) => (
        <SourceCard
          key={source.id}
          source={source}
          selected={selectedSourceId === source.id}
          onSelect={() => selectSource(source.id)}
        />
      ))}

      {groupChatSources.length > 0 && (
        <div className={styles.groupSection}>
          <h3 className={styles.groupSectionTitle}>群聊</h3>
          {groupChatSources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              selected={selectedSourceId === source.id}
              onSelect={() => selectSource(source.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
