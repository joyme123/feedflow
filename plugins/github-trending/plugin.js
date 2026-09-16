/**
 * plugin.js — GitHub Trending 信息流插件
 *
 * 抓取 github.com/trending 页面的热门仓库，无需认证。
 * 支持按语言过滤（如 javascript、rust、python）和时间范围（今日/本周/本月）。
 *
 * 数据来源: https://github.com/trending
 * 认证方式: 无需认证（公开页面）
 *
 * 核心接口:
 *   - GET /trending              — 全部语言热门仓库
 *   - GET /trending/<language>   — 指定语言热门仓库
 *   - ?since=daily|weekly|monthly — 时间范围
 */

const https = require('https')

// ============================================================
// Plugin Metadata
// ============================================================

const meta = {
  id: 'feedflow-plugin-github-trending',
  name: 'GitHub Trending',
  version: '1.0.0',
  description: '获取 GitHub Trending 热门仓库（基于 github.com/trending 页面，无需认证）',
  author: 'FeedFlow',
  color: '#24292e',
  icon: '🔥',
  provider: 'github',
  providerName: 'GitHub'
}

// ============================================================
// Config Schema
// ============================================================

const configSchema = [
  {
    key: 'language',
    label: '编程语言',
    type: 'select',
    default: '',
    required: false,
    options: [
      { label: '全部语言', value: '' },
      { label: 'JavaScript', value: 'javascript' },
      { label: 'TypeScript', value: 'typescript' },
      { label: 'Python', value: 'python' },
      { label: 'Rust', value: 'rust' },
      { label: 'Go', value: 'go' },
      { label: 'Java', value: 'java' },
      { label: 'C++', value: 'c++' },
      { label: 'C', value: 'c' },
      { label: 'C#', value: 'c#' },
      { label: 'Ruby', value: 'ruby' },
      { label: 'PHP', value: 'php' },
      { label: 'Swift', value: 'swift' },
      { label: 'Kotlin', value: 'kotlin' },
      { label: 'Dart', value: 'dart' },
      { label: 'Shell', value: 'shell' },
      { label: 'HTML', value: 'html' },
      { label: 'CSS', value: 'css' },
      { label: 'Vue', value: 'vue' },
      { label: 'Jupyter Notebook', value: 'jupyter-notebook' }
    ],
    helpText: '选择要查看的编程语言。留空表示查看全部语言的热门仓库。'
  },
  {
    key: 'since',
    label: '时间范围',
    type: 'select',
    default: 'daily',
    required: true,
    options: [
      { label: '今日', value: 'daily' },
      { label: '本周', value: 'weekly' },
      { label: '本月', value: 'monthly' }
    ],
    helpText: 'Trending 的统计时间范围：今日、本周或本月。'
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
// HTTP 工具
// ============================================================

function fetchTrendingPage(language, since) {
  return new Promise((resolve, reject) => {
    let path = '/trending'
    if (language) {
      path += '/' + encodeURIComponent(language)
    }
    path += '?since=' + encodeURIComponent(since)

    const req = https.get(
      {
        hostname: 'github.com',
        path,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
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
            reject(new Error('GitHub 请求过于频繁，请稍后重试（429 Too Many Requests）'))
          } else {
            reject(new Error(`GitHub Trending 页面获取失败，HTTP ${res.statusCode}`))
          }
        })
      }
    )

    req.on('timeout', () => {
      req.destroy()
      reject(new Error('GitHub Trending 请求超时，请稍后重试'))
    })
    req.on('error', (err) => {
      reject(new Error(`GitHub Trending 请求失败: ${err.message}`))
    })
  })
}

// ============================================================
// HTML 解析
// ============================================================

/** 从 HTML 中提取所有 <article class="Box-row..."> 仓库块 */
function extractRepoBlocks(html) {
  const blocks = []
  const regex = /<article class="Box-row"[\s\S]*?<\/article>/g
  let match
  while ((match = regex.exec(html)) !== null) {
    blocks.push(match[0])
  }
  return blocks
}

/** 去除 HTML 标签，返回纯文本 */
function stripTags(html) {
  if (!html) return ''
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
 * 解析单个仓库块，返回结构化数据
 */
function parseRepoBlock(block) {
  // 1. 仓库名: <h2 ...><a href="/owner/repo" ...>
  const nameMatch = block.match(/<h2[^>]*>\s*<a[^>]*href="\/([^"#?]+)"[^>]*>[\s\S]*?<\/a>\s*<\/h2>/)
  if (!nameMatch) return null
  const repoPath = nameMatch[1].trim().replace(/\/$/, '')
  const parts = repoPath.split('/')
  if (parts.length < 2) return null
  const owner = parts[0]
  const repo = parts.slice(1).join('/')
  const fullName = `${owner}/${repo}`

  // 2. 描述: <p class="col-9 ..."> ... </p>
  const descMatch = block.match(/<p class="col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/)
  const description = descMatch ? stripTags(descMatch[1]) : ''

  // 3. 语言: <span itemprop="programmingLanguage">Lang</span>
  const langMatch = block.match(/<span itemprop="programmingLanguage">([^<]+)<\/span>/)
  const language = langMatch ? stripTags(langMatch[1]) : ''

  // 4. Star 数: <a href="/owner/repo/stargazers" ...> 123 </a>
  const starMatch = block.match(/<a[^>]*href="\/[^"]*\/stargazers"[^>]*>([\s\S]*?)<\/a>/)
  const stars = starMatch ? stripTags(starMatch[1]).replace(/,/g, '') : ''

  // 5. Fork 数: <a href="/owner/repo/forks" ...> 45 </a>
  const forkMatch = block.match(/<a[^>]*href="\/[^"]*\/forks"[^>]*>([\s\S]*?)<\/a>/)
  const forks = forkMatch ? stripTags(forkMatch[1]).replace(/,/g, '') : ''

  // 6. 今日/本周/本月新增 stars: "1,234 stars today"
  const starsTodayMatch = block.match(/([\d,]+)\s*stars?\s*(today|this\s+week|this\s+month)/i)
  const starsToday = starsTodayMatch ? starsTodayMatch[1].replace(/,/g, '') : ''

  // 7. 作者头像: 从 "Built by" 区域的第一个 <img src="...">
  const avatarMatch = block.match(/Built by[\s\S]*?<img[^>]*src="([^"]+)"/)
  const avatarUrl = avatarMatch ? avatarMatch[1].replace(/&amp;/g, '&') : ''

  return {
    fullName,
    owner,
    repo,
    description,
    language,
    stars: stars ? parseInt(stars, 10) : 0,
    forks: forks ? parseInt(forks, 10) : 0,
    starsToday: starsToday ? parseInt(starsToday, 10) : 0,
    avatarUrl,
    permalink: `https://github.com/${owner}/${repo}`
  }
}

// ============================================================
// 数据映射: Repo → TimelineItem
// ============================================================

function mapRepoToItem(repo, since) {
  const sinceLabel = {
    daily: '今日',
    weekly: '本周',
    monthly: '本月'
  }
  const periodLabel = sinceLabel[since] || '今日'

  // 正文文本
  const lines = []
  lines.push(`⭐ ${repo.fullName}`)
  if (repo.description) lines.push(repo.description)
  const metaParts = []
  if (repo.language) metaParts.push(`🟣 ${repo.language}`)
  if (repo.stars) metaParts.push(`★ ${repo.stars.toLocaleString()}`)
  if (repo.forks) metaParts.push(`⑂ ${repo.forks.toLocaleString()}`)
  if (metaParts.length) lines.push(metaParts.join('  ·  '))
  const text = lines.join('\n')

  // HTML 正文（所有链接必须 target="_blank"）
  // 用单个 <p> + <br> 而非多个块级元素，避免占用过多行预算导致被 CSS line-clamp 折叠
  const htmlParts = []
  htmlParts.push('<p>')
  htmlParts.push(
    `<a href="${escapeHtml(repo.permalink)}" target="_blank" rel="noopener noreferrer"><strong>${escapeHtml(
      repo.fullName
    )}</strong></a>`
  )
  if (repo.description) {
    htmlParts.push(`<br/>${escapeHtml(repo.description)}`)
  }
  const htmlMetaParts = []
  if (repo.language) {
    htmlMetaParts.push(
      `<a href="https://github.com/trending/${encodeURIComponent(
        repo.language.toLowerCase()
      )}" target="_blank" rel="noopener noreferrer" style="color:#666">🟣 ${escapeHtml(repo.language)}</a>`
    )
  }
  if (repo.stars) {
    htmlMetaParts.push(
      `<a href="${escapeHtml(repo.permalink)}/stargazers" target="_blank" rel="noopener noreferrer" style="color:#666">★ ${repo.stars.toLocaleString()}</a>`
    )
  }
  if (repo.forks) {
    htmlMetaParts.push(
      `<a href="${escapeHtml(repo.permalink)}/forks" target="_blank" rel="noopener noreferrer" style="color:#666">⑂ ${repo.forks.toLocaleString()}</a>`
    )
  }
  if (repo.starsToday) {
    htmlMetaParts.push(
      `<span style="color:#666">★ ${repo.starsToday.toLocaleString()} ${periodLabel}新增</span>`
    )
  }
  if (htmlMetaParts.length) {
    htmlParts.push('<br/>' + htmlMetaParts.join(' · '))
  }
  htmlParts.push('</p>')
  const html = htmlParts.join('')

  return {
    externalId: `${repo.fullName}`,
    author: {
      name: repo.owner,
      avatarUrl: repo.avatarUrl || `https://github.com/${repo.owner}.png?size=80`,
      profileUrl: `https://github.com/${repo.owner}`
    },
    content: {
      text,
      html
    },
    mediaUrls: [],
    permalink: repo.permalink,
    publishedAt: new Date().toISOString(),
    metadata: {
      language: repo.language,
      stars: repo.stars,
      forks: repo.forks,
      starsToday: repo.starsToday,
      owner: repo.owner,
      repo: repo.repo
    }
  }
}

// ============================================================
// fetchItems — 核心拉取逻辑
// ============================================================

/**
 * 获取 GitHub Trending 热门仓库
 *
 * @param {SourceConfig} config - 用户配置
 * @param {string|null} cursor  - 分页游标（Trending 页面无分页，始终为 null）
 * @returns {Promise<FetchResult>}
 */
async function fetchItems(config, cursor) {
  const language = (config.language || '').trim()
  const since = config.since || 'daily'

  let html
  try {
    html = await fetchTrendingPage(language, since)
  } catch (err) {
    throw err
  }

  const blocks = extractRepoBlocks(html)
  if (blocks.length === 0) {
    throw new Error('未能从 GitHub Trending 页面解析到任何仓库，页面结构可能已变更。')
  }

  const items = []
  for (const block of blocks) {
    const repo = parseRepoBlock(block)
    if (!repo || !repo.fullName) continue
    const item = mapRepoToItem(repo, since)
    if (item.content.text) {
      items.push(item)
    }
  }

  // Trending 页面无分页，nextCursor 始终为 null
  return { items, nextCursor: null }
}

// ============================================================
// 生命周期
// ============================================================

async function onRegister(ctx) {
  ctx.logger.info('[github-trending] GitHub Trending 信息流插件已注册（基于公开页面，无需认证）')
}

// ============================================================
// 导出
// ============================================================

const githubTrendingPlugin = {
  meta,
  configSchema,
  fetchItems,
  onRegister
}

module.exports = {
  default: githubTrendingPlugin
}
