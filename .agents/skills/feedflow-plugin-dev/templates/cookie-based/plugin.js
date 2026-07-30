/**
 * plugin.js — Cookie-authenticated FeedFlow plugin template
 *
 * Replace the API calls and data mapping with your source's logic.
 * Uses the 'credential' field type so cookies are stored encrypted
 * and reusable across sources of the same provider.
 */

const { fetchTimeline, extractItems, extractNextCursor, ApiError } = require('./api')
const { verifyCookie } = require('./auth')

// ============================================================
// Plugin Metadata
// ============================================================
const meta = {
  id: 'feedflow-plugin-cookie-template',
  name: 'Cookie Template',
  version: '1.0.0',
  description: 'A cookie-authenticated plugin template for FeedFlow',
  author: 'Your Name',
  color: '#1DA1F2',
  // provider + providerName let this plugin share cookies with other plugins
  // of the same service (e.g. "关注流" + "群聊" both under "weibo")
  provider: 'example',
  providerName: 'Example'
}

// ============================================================
// Config Schema
// ============================================================
const configSchema = [
  {
    key: 'cookie',
    label: '凭据',
    type: 'credential',
    required: true,
    helpText: '选择一个已保存的 Cookie 凭据，或创建新凭据。凭据可在多个信息源间复用。'
  },
  {
    key: 'count',
    label: '每次获取条数',
    type: 'number',
    default: 20,
    min: 1,
    max: 50,
    helpText: '单次刷新获取的条目数量'
  }
]

// ============================================================
// Data mapping
// ============================================================
function mapToItem(raw) {
  return {
    externalId: String(raw.id || ''),
    author: {
      name: raw.user?.name || 'unknown',
      avatarUrl: raw.user?.avatar || '',
      profileUrl: raw.user?.url || ''
    },
    content: {
      text: stripHtml(raw.text || ''),
      html: raw.html || undefined
    },
    mediaUrls: raw.media || [],
    permalink: raw.url || '',
    publishedAt: parseDate(raw.created_at),
    metadata: {
      likes: raw.likes_count || 0,
      reposts: raw.reposts_count || 0
    }
  }
}

function stripHtml(html) {
  if (!html || typeof html !== 'string') return ''
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim()
}

function parseDate(dateStr) {
  if (!dateStr) return new Date().toISOString()
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

// ============================================================
// fetchItems
// ============================================================
async function fetchItems(config, cursor) {
  const cookie = config.cookie
  if (!cookie) {
    throw new Error('Cookie 未配置。请在源设置中选择或创建凭据。')
  }

  const count = Math.min(Number(config.count) || 20, 50)

  // Build API params. cursor is undefined on refresh, a string on "load older"
  const params = { count }
  if (cursor) {
    params.cursor = cursor
  }

  try {
    const response = await fetchTimeline(cookie, params)
    const rawItems = extractItems(response)

    const items = rawItems.map(mapToItem).filter(
      (item) => item.author.name && item.author.name !== 'unknown' && item.content.text
    )

    const nextCursor = extractNextCursor(response) || null

    return { items, nextCursor }
  } catch (err) {
    if (err instanceof ApiError && (err.code === 401 || err.code === 403)) {
      throw new Error('Cookie 已过期或无效，请重新登录获取新的 Cookie。')
    }
    if (err.code === 429) {
      throw new Error('请求过于频繁，请稍后重试。')
    }
    throw new Error(`获取失败: ${err.message}`)
  }
}

// ============================================================
// Lifecycle
// ============================================================
async function onRegister(ctx) {
  ctx.logger.info('[cookie-template] 插件已注册')
}

// ============================================================
// Export
// ============================================================
const plugin = { meta, configSchema, fetchItems, onRegister }
module.exports = { default: plugin, verifyCookie }
