/// <reference types="vite/client" />

import type { FeedFlowAPI } from '../../preload/index'

declare global {
  interface Window {
    api: FeedFlowAPI
  }

  /** 由 electron-vite 在构建时注入的应用版本号 */
  const __APP_VERSION__: string
}
