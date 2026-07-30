# Cookbook: Common Recipes

Copy-paste building blocks used by existing plugins.

## Strip HTML to plain text

```js
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
```

Use `content.text = stripHtml(rawHtml)` and `content.html = rawHtml`.

## Parse relative date strings (微博 style)

微博 returns dates like "刚刚", "5分钟前", "今天 12:30", "昨天 09:15",
"7-27", or a full date string:

```js
function parseWeiboDate(dateStr) {
  if (!dateStr) return new Date().toISOString()
  if (dateStr === '刚刚') return new Date().toISOString()

  const minMatch = dateStr.match(/(\d+)分钟前/)
  if (minMatch) return new Date(Date.now() - parseInt(minMatch[1]) * 60000).toISOString()

  const hourMatch = dateStr.match(/(\d+)小时前/)
  if (hourMatch) return new Date(Date.now() - parseInt(hourMatch[1]) * 3600000).toISOString()

  const todayMatch = dateStr.match(/今天\s*(\d{1,2}):(\d{2})/)
  if (todayMatch) {
    const d = new Date()
    d.setHours(parseInt(todayMatch[1]), parseInt(todayMatch[2]), 0, 0)
    return d.toISOString()
  }

  const yesterdayMatch = dateStr.match(/昨天\s*(\d{1,2}):(\d{2})/)
  if (yesterdayMatch) {
    const d = new Date(Date.now() - 86400000)
    d.setHours(parseInt(yesterdayMatch[1]), parseInt(yesterdayMatch[2]), 0, 0)
    return d.toISOString()
  }

  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}
```

## Parse standard date (X / RSS style)

```js
function parseDate(dateStr) {
  if (!dateStr) return new Date().toISOString()
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}
```

## Extract best video URL from variants

X returns multiple video variants; pick the highest-bitrate mp4 (skip m3u8,
which the desktop `<video>` tag can't play natively):

```js
function pickBestVideoUrl(media) {
  const variants = media?.video_info?.variants
  if (!Array.isArray(variants) || variants.length === 0) return null
  const mp4s = variants
    .filter((v) => v && v.content_type === 'video/mp4' && typeof v.url === 'string')
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))
  return mp4s.length > 0 ? mp4s[0].url : null
}
```

## Handle retweets / quotes

Append the original post to the display text:

```js
let displayText = legacy.full_text || ''

const retweet = legacy.retweeted_status_result?.result
if (retweet) {
  const rtName = retweet.user?.screen_name ? `@${retweet.user.screen_name}` : ''
  displayText = `🔁 ${rtName}:\n${retweet.legacy?.full_text || ''}`
}

const quote = legacy.quoted_status_result?.result
if (quote && !retweet) {
  const qName = quote.user?.screen_name ? `@${quote.user.screen_name}` : ''
  displayText += `\n\n📎 ${qName}:\n${quote.legacy?.full_text || ''}`
}
```

## Filter out invalid items

APIs often return ads, recommendations, or empty objects. Filter before
returning:

```js
const items = []
for (const raw of rawItems) {
  const item = mapToItem(raw)
  const hasAuthor = item.author.name && item.author.name !== 'unknown'
  const hasContent = !!item.content.text
  const hasMedia = item.mediaUrls.length > 0
  if (hasAuthor && (hasContent || hasMedia)) {
    items.push(item)
  }
}
```

## Coerce number config values

Form fields may return numbers as strings:

```js
const count = Math.min(Number(config.count) || 20, 50)
```

## Cache API responses in memory

For things that don't change often (group lists, list IDs), cache with a TTL:

```js
let cachedValue = null
let cacheTime = 0
const CACHE_TTL = 60 * 60 * 1000  // 1 hour

async function getValue(cookie) {
  const now = Date.now()
  if (cachedValue && (now - cacheTime) < CACHE_TTL) return cachedValue
  cachedValue = await fetchValue(cookie)
  cacheTime = now
  return cachedValue
}
```

## Compare large IDs as strings

Some sources (微博, X) return IDs that exceed `Number.MAX_SAFE_INTEGER`.
Always compare as strings:

```js
function compareIds(a, b) {
  const left = String(a).replace(/^0+/, '') || '0'
  const right = String(b).replace(/^0+/, '') || '0'
  if (left.length !== right.length) return left.length - right.length
  return left.localeCompare(right)
}
```
