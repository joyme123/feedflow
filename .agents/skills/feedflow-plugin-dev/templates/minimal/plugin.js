/**
 * plugin.js — Minimal FeedFlow plugin template
 *
 * Replace this with your source's fetch logic.
 * This template generates static items without any network calls.
 */

// ============================================================
// Plugin Metadata
// ============================================================
const meta = {
  id: 'feedflow-plugin-minimal',
  name: 'Minimal Template',
  version: '1.0.0',
  description: 'A minimal plugin template for FeedFlow',
  author: 'Your Name',
  color: '#6C5CE7',
  // Set provider + providerName if this plugin shares credentials with others
  // provider: 'myservice',
  // providerName: 'My Service'
}

// ============================================================
// Config Schema — form fields shown when adding a source
// ============================================================
const configSchema = [
  {
    key: 'count',
    label: '每次获取条数',
    type: 'number',
    default: 10,
    min: 1,
    max: 50,
    helpText: '单次刷新获取的条目数量'
  }
]

// ============================================================
// Data mapping — turn your raw API response into TimelineItem
// ============================================================
function mapToItem(raw, index) {
  return {
    externalId: `minimal-${index}-${Date.now()}`,
    author: {
      name: raw.author || 'unknown',
      avatarUrl: raw.avatar || '',
      profileUrl: raw.profile || ''
    },
    content: {
      text: raw.text || '',
      html: raw.html || undefined
    },
    mediaUrls: raw.media || [],
    permalink: raw.url || '',
    publishedAt: new Date().toISOString(),
    metadata: { index }
  }
}

// ============================================================
// fetchItems — core fetch logic
// ============================================================
async function fetchItems(config, _cursor) {
  const count = Math.min(Number(config.count) || 10, 50)
  const items = []

  for (let i = 0; i < count; i++) {
    items.push(mapToItem({
      author: 'Example Author',
      text: `这是第 ${i + 1} 条示例内容`,
      url: ''
    }, i))
  }

  // Return null when there's no older page to load
  return { items, nextCursor: null }
}

// ============================================================
// Export
// ============================================================
const plugin = { meta, configSchema, fetchItems }
module.exports = { default: plugin }
