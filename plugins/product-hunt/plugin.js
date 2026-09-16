/**
 * plugin.js — Product Hunt 信息流插件
 *
 * 双模式拉取：
 *   - 无 Token：使用公开 Atom Feed（https://www.producthunt.com/feed），返回产品名 + 一句话标语
 *   - 有 Token：使用 GraphQL API（https://api.producthunt.com/v2/api/graphql），返回完整描述、
 *               投票数、评论数、缩略图、主题标签、Maker 头像等丰富信息
 *
 * 数据来源:
 *   - Atom Feed: https://www.producthunt.com/feed （公开，无需认证）
 *   - GraphQL:   https://api.producthunt.com/v2/api/graphql （需 Developer Token）
 *
 * 核心接口:
 *   - GET  /feed?category=xxx        — Atom Feed，按分类过滤
 *   - POST /v2/api/graphql           — GraphQL 查询 posts
 */

const https = require('https')

// ============================================================
// Plugin Metadata
// ============================================================

const meta = {
  id: 'feedflow-plugin-product-hunt',
  name: 'Product Hunt',
  version: '1.0.0',
  description: '获取 Product Hunt 每日新产品发布（默认公开 Feed 无需认证；填写 Token 可获取更详细内容）',
  author: 'FeedFlow',
  color: '#DA552F',
  icon: '🚀',
  provider: 'producthunt',
  providerName: 'Product Hunt'
}

// ============================================================
// Config Schema
// ============================================================

const configSchema = [
  {
    key: 'token',
    label: 'Product Hunt Developer Token（可选）',
    type: 'credential',
    credentialType: 'token',
    required: false,
    helpText:
      '留空即可使用公开 Feed（仅产品名 + 一句话标语）。如需完整产品描述、投票数、评论数、缩略图等详细信息，请在 https://www.producthunt.com/v2/oauth/applications 创建应用并获取 Developer Token 填入。'
  },
  {
    key: 'category',
    label: '产品分类',
    type: 'select',
    default: '',
    required: false,
    options: [
      { label: '全部分类', value: '' },
      { label: 'Tech（科技）', value: 'tech' },
      { label: 'AI（人工智能）', value: 'ai' },
      { label: 'Design（设计）', value: 'design' },
      { label: 'Tools（工具）', value: 'tools' },
      { label: 'Productivity（效率）', value: 'productivity' },
      { label: 'Finance（金融）', value: 'finance' },
      { label: 'Games（游戏）', value: 'games' },
      { label: 'Education（教育）', value: 'education' },
      { label: 'Health（健康）', value: 'health' }
    ],
    helpText: '选择要查看的产品分类。留空表示查看全部分类的最新产品。（仅公开 Feed 模式生效）'
  },
  {
    key: 'order',
    label: '排序方式（仅 Token 模式）',
    type: 'select',
    default: 'RANKING',
    required: false,
    options: [
      { label: '今日热门（RANKING）', value: 'RANKING' },
      { label: '最新发布（CREATED_AT）', value: 'CREATED_AT' },
      { label: '最多投票（VOTES）', value: 'VOTES' },
      { label: '最多评论（COMMENTS）', value: 'COMMENTS' }
    ],
    helpText: '仅在填写了 Token（GraphQL 模式）时生效。选择产品列表的排序方式。'
  },
  {
    key: 'count',
    label: '每次获取条数（仅 Token 模式）',
    type: 'number',
    default: 20,
    min: 1,
    max: 50,
    required: false,
    helpText: '仅在填写了 Token（GraphQL 模式）时生效。单次刷新获取的产品数量（1-50）。'
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
// 通用工具函数
// ============================================================

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

/** 去除 HTML 标签，返回纯文本 */
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

/** 解码 HTML 实体 */
function decodeHtmlEntities(text) {
  if (!text) return ''
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

/** 解析日期为 ISO 8601 字符串 */
function parseDate(dateStr) {
  if (!dateStr) return new Date().toISOString()
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

// ============================================================
// 模式一：公开 Atom Feed（无需 Token）
// ============================================================

function fetchFeed(category) {
  return new Promise((resolve, reject) => {
    let path = '/feed'
    if (category) {
      path += '?category=' + encodeURIComponent(category)
    }

    const req = https.get(
      {
        hostname: 'www.producthunt.com',
        path,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/atom+xml, application/xml, text/xml, */*',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: 20000
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(body)
          } else if (res.statusCode === 429) {
            reject(new Error('Product Hunt 请求过于频繁，请稍后重试（429 Too Many Requests）'))
          } else {
            reject(new Error(`Product Hunt Feed 获取失败，HTTP ${res.statusCode}`))
          }
        })
      }
    )

    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Product Hunt Feed 请求超时，请稍后重试'))
    })
    req.on('error', (err) => {
      reject(new Error(`Product Hunt Feed 请求失败: ${err.message}`))
    })
  })
}

/** 从 Atom Feed 中提取所有 <entry> 块 */
function extractEntries(xml) {
  const entries = []
  const regex = /<entry>[\s\S]*?<\/entry>/g
  let match
  while ((match = regex.exec(xml)) !== null) {
    entries.push(match[0])
  }
  return entries
}

/** 解析单个 <entry>，返回结构化数据 */
function parseFeedEntry(entry) {
  const idMatch = entry.match(/<id>tag:www\.producthunt\.com,2005:Post\/(\d+)<\/id>/)
  if (!idMatch) return null
  const postId = idMatch[1]

  const publishedMatch = entry.match(/<published>([^<]+)<\/published>/)
  const publishedAt = publishedMatch ? publishedMatch[1].trim() : ''

  const linkMatch = entry.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/)
  const permalink = linkMatch ? linkMatch[1] : `https://www.producthunt.com/posts/${postId}`

  const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/)
  const name = titleMatch ? titleMatch[1].trim() : ''

  const authorMatch = entry.match(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/)
  const rawAuthor = authorMatch ? authorMatch[1].trim() : ''
  // Product Hunt 对匿名 maker 会返回 "[REDACTED]" 等占位符，过滤掉
  const authorName =
    !rawAuthor || /^\[.*\]$/.test(rawAuthor) || rawAuthor.toLowerCase() === 'redacted'
      ? 'Product Hunt'
      : rawAuthor

  let description = ''
  let productUrl = ''
  const contentMatch = entry.match(/<content[^>]*>([\s\S]*?)<\/content>/)
  if (contentMatch) {
    const decoded = decodeHtmlEntities(contentMatch[1])
    const descMatch = decoded.match(/<p>([\s\S]*?)<\/p>/)
    if (descMatch) description = stripHtml(descMatch[1])
    const linkUrls = decoded.match(/<a[^>]*href="([^"]+)"[^>]*>/g) || []
    if (linkUrls.length >= 2) {
      const urlMatch = linkUrls[linkUrls.length - 1].match(/href="([^"]+)"/)
      if (urlMatch) productUrl = urlMatch[1]
    }
  }

  return { postId, name, description, authorName, permalink, productUrl, publishedAt }
}

/** 将 Atom Feed 条目映射为 TimelineItem */
function mapFeedEntryToItem(entry) {
  const lines = [`🚀 ${entry.name}`]
  if (entry.description) lines.push(entry.description)
  const text = lines.join('\n')

  const htmlParts = ['<p>']
  htmlParts.push(
    `<a href="${escapeHtml(entry.permalink)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(
      entry.name
    )}</strong></a>`
  )
  if (entry.description) {
    htmlParts.push(`<br/>${escapeHtml(entry.description)}`)
  }
  if (entry.productUrl) {
    htmlParts.push(
      `<br/><a href="${escapeHtml(entry.productUrl)}" target="_blank" rel="noopener noreferrer" style="color:#DA552F">🔗 访问产品官网</a>`
    )
  }
  htmlParts.push('</p>')

  return {
    externalId: entry.postId,
    author: { name: entry.authorName, avatarUrl: '', profileUrl: '' },
    content: { text, html: htmlParts.join('') },
    mediaUrls: [],
    permalink: entry.permalink,
    publishedAt: parseDate(entry.publishedAt),
    metadata: { productUrl: entry.productUrl || null, description: entry.description || '' }
  }
}

// ============================================================
// 模式二：GraphQL API（需 Token，内容更丰富）
// ============================================================

function graphqlRequest(token, query, variables) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables })

    const req = https.request(
      {
        hostname: 'api.producthunt.com',
        path: '/v2/api/graphql',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Accept': 'application/json',
          'User-Agent': 'FeedFlow/1.0 (https://github.com/joyme123/feedflow)'
        },
        timeout: 20000
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          if (res.statusCode === 401 || res.statusCode === 403) {
            reject(new Error('Product Hunt Token 无效或已过期，请重新创建 Developer Token。'))
            return
          }
          if (res.statusCode === 429) {
            reject(new Error('Product Hunt 请求过于频繁，请稍后重试（429 Too Many Requests）。'))
            return
          }
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              const json = JSON.parse(data)
              if (json.errors && json.errors.length > 0) {
                reject(new Error(`Product Hunt API 错误: ${json.errors.map((e) => e.message).join('; ')}`))
                return
              }
              resolve(json)
            } catch (e) {
              reject(new Error(`Product Hunt 响应解析失败: ${e.message}`))
            }
          } else {
            reject(new Error(`Product Hunt API 请求失败，HTTP ${res.statusCode}: ${data.slice(0, 200)}`))
          }
        })
      }
    )

    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Product Hunt API 请求超时，请稍后重试。'))
    })
    req.on('error', (err) => {
      reject(new Error(`Product Hunt API 请求失败: ${err.message}`))
    })

    req.write(body)
    req.end()
  })
}

const POSTS_QUERY = `
  query Posts($order: PostsOrder, $first: Int, $after: String) {
    posts(order: $order, first: $first, after: $after) {
      edges {
        node {
          id
          name
          tagline
          description
          url
          votesCount
          commentsCount
          createdAt
          featuredAt
          thumbnail {
            url
          }
          makers {
            name
            username
            profileImage
            url
          }
          topics(first: 5) {
            edges {
              node {
                name
              }
            }
          }
        }
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
`

/** 将 GraphQL Post 映射为 TimelineItem（内容更丰富） */
function mapGraphQLPostToItem(post) {
  // makers 是 [User] 数组（非连接类型），取第一个作为作者；空数组/缺失/非对象时回退到 {}
  const rawMaker = Array.isArray(post.makers) ? post.makers[0] : post.makers
  const maker = rawMaker && typeof rawMaker === 'object' ? rawMaker : {}
  // Product Hunt 对匿名 maker 会返回 "[REDACTED]" 等占位符，过滤掉
  const rawName = maker.name
  const isRedacted = !rawName || /^\[.*\]$/.test(rawName.trim()) || rawName.trim().toLowerCase() === 'redacted'
  const authorName = isRedacted ? 'Product Hunt' : rawName
  const avatarUrl = isRedacted ? '' : (maker.profileImage || '')
  const profileUrl =
    isRedacted ? '' : (maker.url || (maker.username ? `https://www.producthunt.com/@${maker.username}` : ''))

  const topics = (post.topics?.edges || []).map((e) => e.node?.name).filter(Boolean)

  // 正文：名称 + 标语 + 完整描述
  const lines = [`🚀 ${post.name}`]
  if (post.tagline) lines.push(post.tagline)
  if (post.description) lines.push(stripHtml(post.description))
  const metaParts = []
  metaParts.push(`▲ ${post.votesCount || 0} 投票`)
  metaParts.push(`💬 ${post.commentsCount || 0} 评论`)
  if (topics.length) metaParts.push(`🏷️ ${topics.join(', ')}`)
  lines.push(metaParts.join('  ·  '))
  const text = lines.join('\n')

  // HTML 正文
  const htmlParts = ['<p>']
  htmlParts.push(
    `<a href="${escapeHtml(post.url)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(
      post.name
    )}</strong></a>`
  )
  if (post.tagline) {
    htmlParts.push(`<br/><em>${escapeHtml(post.tagline)}</em>`)
  }
  if (post.description) {
    htmlParts.push(`<br/>${escapeHtml(stripHtml(post.description))}`)
  }
  const htmlMetaParts = []
  htmlMetaParts.push(
    `<a href="${escapeHtml(post.url)}" target="_blank" rel="noopener noreferrer" style="color:#DA552F">▲ ${post.votesCount || 0}</a>`
  )
  htmlMetaParts.push(
    `<a href="${escapeHtml(post.url)}#comments" target="_blank" rel="noopener noreferrer" style="color:#666">💬 ${post.commentsCount || 0}</a>`
  )
  if (topics.length) {
    htmlMetaParts.push(`<span style="color:#666">🏷️ ${escapeHtml(topics.join(', '))}</span>`)
  }
  htmlParts.push('<br/>' + htmlMetaParts.join(' · '))
  htmlParts.push('</p>')

  const mediaUrls = post.thumbnail?.url ? [post.thumbnail.url] : []

  return {
    externalId: String(post.id),
    author: { name: authorName, avatarUrl, profileUrl },
    content: { text, html: htmlParts.join('') },
    mediaUrls,
    permalink: post.url,
    publishedAt: parseDate(post.createdAt),
    metadata: {
      votesCount: post.votesCount || 0,
      commentsCount: post.commentsCount || 0,
      tagline: post.tagline || '',
      topics,
      featuredAt: post.featuredAt || null
    }
  }
}

// ============================================================
// fetchItems — 核心拉取逻辑（自动选择模式）
// ============================================================

async function fetchItems(config, cursor) {
  const token = config.token

  // 有 Token → GraphQL 模式（内容丰富）
  if (token) {
    return fetchViaGraphQL(token, config, cursor)
  }

  // 无 Token → Atom Feed 模式（免费，内容精简）
  return fetchViaFeed(config)
}

/** Atom Feed 模式 */
async function fetchViaFeed(config) {
  const category = (config.category || '').trim()

  let xml
  try {
    xml = await fetchFeed(category)
  } catch (err) {
    throw err
  }

  const entries = extractEntries(xml)
  if (entries.length === 0) {
    throw new Error('未能从 Product Hunt Feed 解析到任何产品，Feed 结构可能已变更。')
  }

  const items = entries
    .map(parseFeedEntry)
    .filter((e) => e && e.postId && e.name)
    .map(mapFeedEntryToItem)
    .filter((item) => item.content.text)

  return { items, nextCursor: null }
}

/** GraphQL 模式 */
async function fetchViaGraphQL(token, config, cursor) {
  const order = config.order || 'RANKING'
  const count = Math.min(Math.max(Number(config.count) || 20, 1), 50)

  const variables = { order, first: count }
  if (cursor) variables.after = cursor

  let response
  try {
    response = await graphqlRequest(token, POSTS_QUERY, variables)
  } catch (err) {
    throw err
  }

  const connection = response?.data?.posts
  if (!connection || !Array.isArray(connection.edges)) {
    throw new Error('未能从 Product Hunt API 获取产品数据，响应结构异常。')
  }

  const items = connection.edges
    .map((edge) => edge.node)
    .filter((node) => node && node.id && node.name)
    .map(mapGraphQLPostToItem)
    .filter((item) => item.content.text)

  const nextCursor =
    connection.pageInfo?.hasNextPage && connection.pageInfo?.endCursor
      ? connection.pageInfo.endCursor
      : null

  return { items, nextCursor }
}

// ============================================================
// 生命周期
// ============================================================

async function onRegister(ctx) {
  ctx.logger.info('[product-hunt] Product Hunt 信息流插件已注册（无 Token 用公开 Feed，有 Token 用 GraphQL API）')
}

// ============================================================
// 导出
// ============================================================

const productHuntPlugin = {
  meta,
  configSchema,
  fetchItems,
  onRegister
}

module.exports = {
  default: productHuntPlugin
}
