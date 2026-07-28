/// <reference types="vite/client" />

import type { FeedFlowAPI } from '../../preload/index'

declare global {
  interface Window {
    api: FeedFlowAPI
  }
}
