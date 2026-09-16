/**
 * plugin.js — Hacker News 信息流插件
 *
 * 基于 Hacker News 官方公开 API（Firebase）获取热门/最新/最佳故事，无需认证。
 * 支持 Top / New / Best / Ask HN / Show HN / Jobs 多种信息流。
 *
 * 数据来源: https://news.ycombinator.com
 * API 文档: https://github.com/HackerNews/API
 * 认证方式: 无需认证（公开 API）
 *
 * 核心接口:
 *   - GET /v0/topstories.json   — 热门故事
 *   - GET /v0/newstories.json   — 最新故事
 *   - GET /v0/beststories.json  — 最佳故事
 *   - GET /v0/askstories.json   — Ask HN
 *   - GET /v0/showstories.json  — Show HN
 *   - GET /v0/jobstories.json   — 招聘信息
 *   - GET /v0/item/{id}.json    — 单条故事详情
 */

const { fetchStoryIds, fetchItemsByIds, ApiError } = require('./hn-api')

// ============================================================
// Plugin Metadata
// ============================================================

const meta = {
  id: 'feedflow-plugin-hacker-news',
  name: 'Hacker News',
  version: '1.0.0',
  description: '获取 Hacker News 热门/最新/最佳故事（基于官方公开 API，无需认证）',
  author: 'FeedFlow',
  color: '#ff6600',
  icon: '📰',
  provider: 'hacker-news',
  providerName: 'Hacker News'
}

// ============================================================
// Config Schema
// ============================================================

const configSchema = [
  {
    key: 'feedType',
    label: '信息流类型',
    type: 'select',
    default: 'top',
    required: true,
    options: [
      { label: '热门故事 (Top)', value: 'top' },
      { label: '最新故事 (New)', value: 'new' },
      { label: '最佳故事 (Best)', value: 'best' },
      { label: 'Ask HN', value: 'ask' },
      { label: 'Show HN', value: 'show' },
      { label: '招聘信息 (Jobs)', value: 'jobs' }
    ],
    helpText: '选择要获取的 Hacker News 信息流类型。'
  },
  {
    key: 'count',
    label: '每次获取条数',
    type: 'number',
    default: 30,
    min: 1,
    max: 50,
    helpText: '单次刷新获取的故事数量。'
  },
  {
    key: 'useProxy',
    label: '通过代理服务器访问',
    type: 'boolean',
    default: false,
    helpText: '开启后该信息源的请求将通过「设置 → 网络」中配置的代理服务器发送'
  }
]

// ============================================================
// 工具函数
// ============================================================

/** 清理 HTML 标签，返回纯文本 */
function stripHtml(html) {
  if (!html || typeof html !== 'string') return ''
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** 转义 HTML 特殊字符 */
function escapeHtml(text) {
  if (!text) return ''
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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

/** 从 HTML 中提取所有 <img> 的 src URL */
function extractMediaUrls(html) {
  if (!html || typeof html !== 'string') return []
  const urls = []
  const regex = /<img[^>]+src=["']([^"']+)["']/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    let url = match[1]
    if (url.startsWith('//')) url = 'https:' + url
    urls.push(url)
  }
  return urls
}

// ============================================================
// 数据映射: HN Story → TimelineItem
// ============================================================

function mapStoryToItem(story) {
  const id = String(story.id)
  const title = story.title || ''
  const url = story.url || ''
  const text = story.text || ''
  const author = story.by || 'unknown'
  const score = story.score || 0
  const comments = story.descendants || 0
  const type = story.type || 'story'
  const time = story.time
    ? new Date(story.time * 1000).toISOString()
    : new Date().toISOString()

  const permalink = `https://news.ycombinator.com/item?id=${id}`
  const authorUrl = `https://news.ycombinator.com/user?id=${encodeURIComponent(author)}`
  const commentsUrl = permalink

  // ---- 纯文本正文 ----
  const textParts = [title]
  if (url) textParts.push(url)
  if (text) {
    const plainText = stripHtml(text)
    if (plainText) textParts.push('\n' + plainText)
  }
  const textContent = textParts.join('\n')

  // ---- HTML 正文（所有链接必须 target="_blank"）----
  // 用单个 <p> + <br> 避免占用过多行预算导致被 CSS line-clamp 折叠
  const htmlParts = ['<p>']

  // 标题：链接帖链向原文，自发帖链向 HN 讨论页
  const titleHref = url || permalink
  htmlParts.push(
    `<a href="${escapeHtml(titleHref)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(
      title
    )}</strong></a>`
  )

  // 元信息：分数 + 评论数
  const metaParts = []
  metaParts.push(`<span style="color:#666">▲ ${score} points</span>`)
  metaParts.push(
    `<a href="${escapeHtml(commentsUrl)}" target="_blank" rel="noopener noreferrer" style="color:#666">${comments} comments</a>`
  )
  metaParts.push(
    `<a href="${escapeHtml(authorUrl)}" target="_blank" rel="noopener noreferrer" style="color:#666">${escapeHtml(
      author
    )}</a>`
  )
  htmlParts.push('<br/>' + metaParts.join(' · '))

  // 自发帖正文（Ask HN / Show HN 等）
  if (text) {
    const processedText = processHtmlLinks(text)
    htmlParts.push('<br/>' + processedText)
  }

  htmlParts.push('</p>')
  const htmlContent = htmlParts.join('')

  // 媒体：自发帖正文中可能包含图片
  const mediaUrls = extractMediaUrls(text)

  return {
    externalId: id,
    author: {
      name: author,
      profileUrl: authorUrl
    },
    content: {
      text: textContent,
      html: htmlContent
    },
    mediaUrls,
    permalink,
    publishedAt: time,
    metadata: {
      score,
      comments,
      type,
      domain: url ? (() => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' } })() : ''
    }
  }
}

// ============================================================
// fetchItems — 核心拉取逻辑
// ============================================================

/**
 * 获取 Hacker News 信息流
 *
 * @param {SourceConfig} config - 用户配置
 * @param {string|null} cursor  - 分页游标，格式: {"offset":30}
 * @returns {Promise<FetchResult>}
 */
async function fetchItems(config, cursor) {
  const feedType = config.feedType || 'top'
  const count = Math.min(Math.max(parseInt(config.count, 10) || 30, 1), 50)

  // 解析分页游标
  let offset = 0
  if (cursor) {
    try {
      const c = JSON.parse(cursor)
      offset = c.offset || 0
    } catch {
      offset = 0
    }
  }

  // 1. 获取故事 ID 列表
  let ids
  try {
    ids = await fetchStoryIds(feedType)
  } catch (err) {
    if (err instanceof ApiError) {
      throw new Error(err.message)
    }
    throw new Error(`获取 Hacker News 故事列表失败: ${err.message}`)
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return { items: [], nextCursor: null }
  }

  // 2. 截取当前页的 ID 并批量获取详情
  const pageIds = ids.slice(offset, offset + count)
  const stories = await fetchItemsByIds(pageIds)

  // 3. 过滤无效条目并映射
  const items = []
  for (const story of stories) {
    if (!story || !story.id) continue
    // 跳过评论（理论上故事列表不会返回评论，但做个防御）
    if (story.type === 'comment') continue
    // 跳过已删除/死亡的故事
    if (story.deleted || story.dead) continue
    const item = mapStoryToItem(story)
    if (item.content.text) {
      items.push(item)
    }
  }

  // 4. 计算下一页游标
  let nextCursor = null
  if (offset + count < ids.length) {
    nextCursor = JSON.stringify({ offset: offset + count })
  }

  return { items, nextCursor }
}

// ============================================================
// 生命周期
// ============================================================

async function onRegister(ctx) {
  ctx.logger.info('[hacker-news] Hacker News 信息流插件已注册（基于官方公开 API，无需认证）')
}

// ============================================================
// 导出
// ============================================================

const hackerNewsPlugin = {
  meta,
  configSchema,
  fetchItems,
  onRegister
}

module.exports = {
  default: hackerNewsPlugin
}
