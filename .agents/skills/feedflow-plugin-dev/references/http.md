# HTTP Requests

Plugins run in the **main process** (Node.js), not the renderer. You can use
Node's built-in `https` module (no dependencies) or `fetch` (Node 18+, available
in modern Electron). Existing plugins use `https` for full control over headers
and timeouts.

## The `httpsGet` helper pattern

This is the pattern used by weibo-api.js and x-api.js. Copy it and adapt:

```js
const https = require('https')

function httpsGet(host, path, cookie, extraHeaders = {}) {
  const cleanCookie = (cookie || '').replace(/[\r\n\t]/g, '').trim()
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: host,
        path,
        headers: {
          'Cookie': cleanCookie,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json, text/plain, */*',
          ...extraHeaders
        },
        timeout: 15000
      },
      (res) => {
        let body = ''
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => {
          if (res.statusCode === 403) {
            reject(new ApiError(403, 'Cookie 已过期或无效，请重新登录'))
            return
          }
          try {
            const json = JSON.parse(body)
            resolve(json)
          } catch (e) {
            reject(new Error(`解析响应失败: ${body.slice(0, 200)}`))
          }
        })
      }
    )
    req.on('error', (err) => reject(err))
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('请求超时'))
    })
  })
}
```

## POST requests (e.g. X.com GraphQL)

```js
function httpsPost(host, path, body, cookie, extraHeaders = {}) {
  const cleanCookie = (cookie || '').replace(/[\r\n\t]/g, '').trim()
  const postData = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        path,
        method: 'POST',
        headers: {
          'Cookie': cleanCookie,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          ...extraHeaders
        },
        timeout: 20000
      },
      (res) => { /* same as GET */ }
    )
    req.write(postData)
    req.end()
  })
}
```

## Custom error class

Use a custom error with a `code` field so `fetchItems` can translate API
failures into user-friendly messages:

```js
class ApiError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ApiError'
    this.code = code
  }
}
```

Then in `fetchItems`:

```js
try {
  const response = await fetchSomething(cookie, params)
  // ...
} catch (err) {
  if (err.code === 401 || err.code === 403) {
    throw new Error('Cookie 已过期或无效，请重新登录获取新的 Cookie。')
  }
  if (err.code === 429) {
    throw new Error('请求过于频繁，请稍后重试。')
  }
  throw new Error(`获取失败: ${err.message}`)
}
```

## Tips

- Set a `User-Agent` that mimics a real browser — many sites block or return
  different content for non-browser UAs.
- Set `Referer` and `X-Requested-With: XMLHttpRequest` for AJAX APIs that
  check them.
- Always set a `timeout` (10–20s) and destroy the request on timeout.
- Sanitize cookies before putting them in headers.
- Don't use `console.log` for secrets. Use `ctx.logger` in `onRegister`, and
  `console.warn`/`console.error` with redacted info in `fetchItems`.
