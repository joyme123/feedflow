/**
 * plugin.js — V2EX 信息流插件
 *
 * 基于 V2EX 公开 API 获取最新主题和热门主题，无需认证。
 * 可选支持按节点订阅（通过 API 2.0，需 Personal Access Token）。
 *
 * 数据来源: https://www.v2ex.com (公开 JSON API)
 * 认证方式: 无需认证（公开 API）/ 可选 Bearer Token（API 2.0）
 *
 * 核心接口:
 *   - GET /api/topics/latest.json  — 最新主题
 *   - GET /api/topics/hot.json     — 热门主题
 *   - GET /api/topics/show.json    — 主题详情（备用）
 *   - GET /api/v2/nodes/:name/topics — 节点主题（需 Token，可选）
 */

const {
  fetchLatestTopics,
  fetchHotTopics,
  fetchTopicById,
  fetchNodeTopics,
  ApiError
} = require('./v2ex-api')

// ============================================================
// Plugin Metadata
// ============================================================

const meta = {
  id: 'feedflow-plugin-v2ex',
  name: 'V2EX',
  version: '1.0.0',
  description: '获取 V2EX 最新主题和热门主题（基于 V2EX 公开 API，无需认证）',
  author: 'FeedFlow',
  color: '#333333',
  icon: '💬',
  provider: 'v2ex',
  providerName: 'V2EX'
}

// ============================================================
// Config Schema
// ============================================================

const configSchema = [
  {
    key: 'feedType',
    label: '信息流类型',
    type: 'select',
    default: 'latest',
    required: true,
    options: [
      { label: '最新主题', value: 'latest' },
      { label: '热门主题', value: 'hot' },
      { label: '按节点订阅（需 Token）', value: 'node' }
    ],
    helpText: '选择获取 V2EX 的最新主题、热门主题，或订阅特定节点的主题。'
  },
  {
    key: 'nodeName',
    label: '节点名称',
    type: 'text',
    required: false,
    placeholder: '如：rust、life、apple',
    helpText:
      '仅"按节点订阅"模式需要。输入节点的英文名称（URL 中 /go/ 后面的部分，如 https://www.v2ex.com/go/rust 中的 rust）。'
  },
  {
    key: 'token',
    label: 'V2EX Personal Access Token',
    type: 'credential',
    required: false,
    helpText:
      '仅"按节点订阅"模式需要。在 V2EX 设置 → 个人访问令牌中创建。可在多个 V2EX 信息源间复用。'
  },
  {
    key: 'count',
    label: '每次获取条数',
    type: 'number',
    default: 20,
    min: 1,
    max: 50,
    helpText:
      '单次刷新获取的主题数量。最新/热门主题模式由 API 固定返回约 20 条，此参数仅对按节点订阅模式有效。'
  }
]

// ============================================================
// 工具函数
// ============================================================

/** 从 HTML 中提取所有 <img> 的 src URL，并补全协议相对 URL */
function extractMediaUrls(html) {
  if (!html || typeof html !== 'string') return []
  const urls = []
  const regex = /<img[^>]+src=["']([^"']+)["']/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    let url = match[1]
    // 补全协议相对 URL (//example.com/... → https://example.com/...)
    if (url.startsWith('//')) {
      url = 'https:' + url
    }
    urls.push(url)
  }
  return urls
}

/** 转义 HTML 特殊字符 */
function escapeHtml(text) {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 清理 HTML 标签，返回纯文本 */
function stripHtml(html) {
  if (!html || typeof html !== 'string') return ''
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim()
}

/**
 * 处理 HTML 中的链接：
 * 1. 为所有 <a> 标签添加 target="_blank" 和 rel="noopener noreferrer"，确保在浏览器中打开
 * 2. 补全协议相对 URL (// → https://)
 */
function processHtmlLinks(html) {
  if (!html || typeof html !== 'string') return ''
  return html
    .replace(/<a\b/gi, '<a target="_blank" rel="noopener noreferrer"')
    .replace(/(href|src)="\/\//g, '$1="https://')
}

// ============================================================
// 数据映射: V2EX Topic → TimelineItem
// ============================================================

function mapTopicToItem(topic) {
  const member = topic.member || {}
  const node = topic.node || {}
  const topicId = String(topic.id)
  const title = topic.title || ''
  const content = topic.content || ''
  const contentRendered = topic.content_rendered || ''

  // 正文：标题 + 正文
  const text = content ? `${title}\n\n${stripHtml(content)}` : title
  // 处理链接：添加 target="_blank" 并补全协议相对 URL
  const rendered = processHtmlLinks(contentRendered)
  const html = `<h2>${escapeHtml(title)}</h2>\n${rendered}`

  // 媒体：从渲染后的 HTML 中提取图片
  const mediaUrls = extractMediaUrls(contentRendered)

  return {
    externalId: topicId,
    author: {
      name: member.username || 'unknown',
      avatarUrl: member.avatar_large || member.avatar_normal || '',
      profileUrl: member.url || (member.username ? `https://www.v2ex.com/u/${member.username}` : '')
    },
    content: {
      text,
      html
    },
    mediaUrls,
    permalink: topic.url || `https://www.v2ex.com/t/${topicId}`,
    publishedAt: topic.created ? new Date(topic.created * 1000).toISOString() : new Date().toISOString(),
    metadata: {
      nodeName: node.name || '',
      nodeTitle: node.title || '',
      nodeUrl: node.url || '',
      repliesCount: topic.replies || 0,
      lastReplyBy: topic.last_reply_by || '',
      lastTouched: topic.last_touched
        ? new Date(topic.last_touched * 1000).toISOString()
        : null
    }
  }
}

// ============================================================
// fetchItems — 核心拉取逻辑
// ============================================================

/**
 * 获取 V2EX 信息流
 *
 * @param {SourceConfig} config - 用户配置
 * @param {string|null} cursor  - 分页游标（仅按节点订阅模式使用，格式: {"page":2}）
 * @returns {Promise<FetchResult>}
 */
async function fetchItems(config, cursor) {
  const feedType = config.feedType || 'latest'

  let rawTopics = []
  let nextCursor = null

  try {
    if (feedType === 'hot') {
      // 热门主题
      rawTopics = await fetchHotTopics()
    } else if (feedType === 'node') {
      // 按节点订阅（需 Token + 节点名）
      const nodeName = (config.nodeName || '').trim()
      const token = config.token
      if (!nodeName) {
        throw new Error('请填写节点名称。节点名称是 URL 中 /go/ 后面的部分，如 rust、life。')
      }
      if (!token) {
        throw new Error('按节点订阅需要 Personal Access Token，请在 V2EX 设置中创建后填入。')
      }

      // 解析页码游标
      let page = 1
      if (cursor) {
        try {
          const c = JSON.parse(cursor)
          page = c.page || 1
        } catch {
          page = 1
        }
      }

      rawTopics = await fetchNodeTopics(nodeName, page, token)
      // API 2.0 支持分页，返回下一页游标
      if (Array.isArray(rawTopics) && rawTopics.length > 0) {
        nextCursor = JSON.stringify({ page: page + 1 })
      }
    } else {
      // 默认：最新主题
      rawTopics = await fetchLatestTopics()
    }
  } catch (err) {
    if (err instanceof ApiError) {
      // 直接抛出用户友好的错误信息
      throw new Error(err.message)
    }
    throw new Error(`获取 V2EX 主题失败: ${err.message}`)
  }

  // 过滤无效条目并映射
  const items = []
  if (Array.isArray(rawTopics)) {
    for (const topic of rawTopics) {
      if (!topic || !topic.id) continue
      const item = mapTopicToItem(topic)
      // 至少需要标题或正文
      if (item.content.text) {
        items.push(item)
      }
    }
  }

  return { items, nextCursor }
}

// ============================================================
// fetchItemDetail — 拉取单条主题完整正文（备用）
// ============================================================

/**
 * 获取单个主题的完整内容。
 *
 * 公开 API 已返回完整正文，通常不需要调用此函数。
 * 保留作为备用实现。
 *
 * @param {SourceConfig} config - 用户配置
 * @param {string} externalId - 主题 ID
 * @returns {Promise<ItemDetailResult>}
 */
async function fetchItemDetail(config, externalId) {
  if (!externalId) {
    throw new Error('缺少主题 ID，无法获取完整内容。')
  }

  const topic = await fetchTopicById(externalId)
  if (!topic || (!topic.content && !topic.content_rendered)) {
    throw new Error('获取主题完整内容失败，请稍后重试。')
  }

  const title = topic.title || ''
  const content = topic.content || ''
  const contentRendered = topic.content_rendered || ''

  return {
    content: {
      text: content ? `${title}\n\n${stripHtml(content)}` : title,
      html: `<h2>${escapeHtml(title)}</h2>\n${processHtmlLinks(contentRendered)}`
    },
    metadata: { isTruncated: false }
  }
}

// ============================================================
// 生命周期
// ============================================================

async function onRegister(ctx) {
  ctx.logger.info('[v2ex] V2EX 信息流插件已注册（基于公开 API，无需认证）')
}

// ============================================================
// 导出
// ============================================================

const v2exPlugin = {
  meta,
  configSchema,
  fetchItems,
  fetchItemDetail,
  onRegister
}

module.exports = {
  default: v2exPlugin
}
