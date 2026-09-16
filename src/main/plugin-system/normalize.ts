/**
 * normalize.ts — 插件模块归一化
 *
 * 磁盘上的插件通过 ESM `import()` 或 CJS `require()` 加载，两种路径的
 * 模块形状不一致：
 *   - require(CJS)            → 直接得到 module.exports（插件对象本身）
 *   - import(CJS)             → { default: 插件对象, ...命名导出 }
 *   - CJS 中 module.exports =
 *       { default: 插件 }     → import() 后多包一层：mod.default.default
 *
 * 统一剥掉 interop 的 default 包装，返回真正的插件对象；不是合法插件时
 * 返回 null（调用方据此跳过/报「插件无效」）。
 */

import type { FeedFlowPlugin } from '@shared/types/plugin'

function isPlugin(value: unknown): value is FeedFlowPlugin {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as FeedFlowPlugin).fetchItems === 'function'
  )
}

export function unwrapPlugin(module: unknown): FeedFlowPlugin | null {
  const candidates: unknown[] = [
    (module as { default?: { default?: unknown } } | null | undefined)?.default?.default,
    (module as { default?: unknown } | null | undefined)?.default,
    module
  ]
  for (const candidate of candidates) {
    if (isPlugin(candidate)) return candidate
  }
  return null
}
