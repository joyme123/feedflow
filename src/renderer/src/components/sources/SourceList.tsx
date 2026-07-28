import { useStore } from '../../store'
import { SourceCard } from './SourceCard'
import { AggregatedSourceItem } from './AggregatedSourceItem'
import { EmptyState } from '../common/EmptyState'

export function SourceList(): JSX.Element {
  const { sources, sourcesLoading, selectedSourceId, selectSource } = useStore()

  if (sourcesLoading) {
    return <div style={{ padding: 'var(--spacing-md)', color: 'var(--color-text-secondary)' }}>Loading...</div>
  }

  return (
    <div>
      <AggregatedSourceItem
        selected={selectedSourceId === null}
        onClick={() => selectSource(null)}
      />
      {sources.map((source) => (
        <SourceCard
          key={source.id}
          source={source}
          selected={selectedSourceId === source.id}
          onSelect={() => selectSource(source.id)}
        />
      ))}
    </div>
  )
}
