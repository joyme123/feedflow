/**
 * proxy-context.ts — 代理调用上下文（AsyncLocalStorage）
 *
 * 插件代码运行在主进程 Node realm 中，统一使用 node:https 发请求。
 * https patch 层（./proxy-agent）借助 ALS 判断"当前请求是否来自一个
 * 开启了代理的信息源调用"，只在该上下文内注入代理 agent，
 * 从而不影响主进程自身的其它 https 流量（MCP SDK、electron-updater 等）。
 */

import { AsyncLocalStorage } from 'node:async_hooks'

const proxyAls = new AsyncLocalStorage<boolean>()

/** 在指定代理上下文中执行异步函数（useProxy=true 时其内部所有 node:https 请求走代理） */
export function runWithProxyContext<T>(useProxy: boolean, fn: () => Promise<T>): Promise<T> {
  return proxyAls.run(useProxy, fn)
}

/** 当前调用栈是否处于"走代理"上下文（未包裹时为 false） */
export function isProxyCallContext(): boolean {
  return proxyAls.getStore() === true
}
