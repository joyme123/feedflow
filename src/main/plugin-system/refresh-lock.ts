/**
 * 刷新并发锁：防止 UI 和 MCP 同时刷新同一源
 */
const refreshingSources = new Set<string>()

export function isRefreshing(sourceId: string): boolean {
  return refreshingSources.has(sourceId)
}

export function acquireRefreshLock(sourceIds: string[]): string[] {
  const acquired: string[] = []
  for (const id of sourceIds) {
    if (!refreshingSources.has(id)) {
      refreshingSources.add(id)
      acquired.push(id)
    }
  }
  return acquired
}

export function releaseRefreshLock(sourceIds: string[]): void {
  for (const id of sourceIds) {
    refreshingSources.delete(id)
  }
}
