/**
 * stale.ts — 失效 provider 标记
 *
 * 当某个 provider（weibo / x 等）的刷新因 Cookie 失效类错误失败时，
 * 在内存中标记该 provider 为 stale。cookie-sync 本地服务端通过
 * /heartbeat 响应把 stale 列表告诉 Chrome 扩展，扩展随即立即重同步
 * 浏览器中的最新 Cookie（必要时还会主动刷新 Cookie），Cookie 经 /sync
 * 成功落库后服务端清除标记（注意 /sync 只保存不校验），并自动重新拉取
 * 该 provider 的信息流；若新 Cookie 仍失效，刷新会再次失败并重新标记。
 *
 * 不持久化：应用重启后标记自然清空，下次刷新失败会重新标记。
 */

const staleProviders = new Set<string>()

/** 标记某 provider 的 Cookie 已失效（幂等） */
export function markProviderStale(provider: string): void {
  if (!provider) return
  staleProviders.add(provider)
  console.log(`[CookieSync] Marked provider stale: ${provider}`)
}

/**
 * 清除某 provider 的失效标记。
 * @returns 是否真的清除了一个已存在的标记（调用方可据此判断"刚刚自愈"）
 */
export function clearProviderStale(provider: string): boolean {
  if (!provider) return false
  const existed = staleProviders.delete(provider)
  if (existed) console.log(`[CookieSync] Cleared stale mark for provider: ${provider}`)
  return existed
}

/** 当前所有处于失效状态的 provider 列表 */
export function getStaleProviders(): string[] {
  return Array.from(staleProviders)
}
