# Credentials & Auth

The `credential` field type is how FeedFlow handles reusable secrets (cookies,
tokens) without hardcoding them or making users re-paste per source.

## How it works

1. In `configSchema`, declare a field with `type: 'credential'`:
   ```js
   { key: 'cookie', label: '微博凭据', type: 'credential', required: true,
     helpText: '选择一个已保存的微博 Cookie 凭据…' }
   ```
2. The UI renders a credential picker scoped to the plugin's `provider`
   (defaults to plugin `id` if not set). Users can pick an existing credential
   or create a new one (name + value).
3. The credential's **ID** is stored in the source's `config` (not the secret).
4. Before `fetchItems` is called, the runner (`resolveCredentialFields` in
   `credentials.ts`) looks up the credential by ID and replaces
   `config[field.key]` with the **raw value**.
5. Your plugin just reads `config.cookie` — it's already the raw cookie string.

**Backward compat**: if `config.cookie` is a raw string (not a credential ID),
`resolveCredentialFields` leaves it untouched. So old sources keep working.

## Provider scoping

Set `meta.provider` to a shared key when multiple plugins can use the same
account:

```js
// weibo-home-timeline
meta: { id: 'feedflow-plugin-weibo', provider: 'weibo', providerName: '微博' }

// weibo-group-chat
meta: { id: 'feedflow-plugin-weibo-group-chat', provider: 'weibo', providerName: '微博' }
```

Both plugins show the same list of saved "微博" credentials. A user saves their
weibo cookie once and uses it for both sources.

## Verifying credentials

If you want to validate a cookie before saving (or show the logged-in user),
export a `verifyCookie` function from your module:

```js
// auth.js
async function verifyCookie(cookie) {
  // call a lightweight API endpoint with the cookie
  // return { valid: boolean, uid?: string, screenName?: string, error?: string }
}
module.exports = { verifyCookie }
```

```js
// plugin.js
const { verifyCookie } = require('./auth')
// ...
module.exports = { default: plugin, verifyCookie }
```

The raw module is stored in the registry, so the UI can call
`getModule(id).verifyCookie(cookie)`.

## Cookie handling best practices

- **Sanitize**: strip `\r\n\t` from cookies before putting them in headers —
  control chars cause "Invalid character in header content" errors.
  ```js
  function sanitizeCookie(cookie) {
    return (cookie || '').replace(/[\r\n\t]/g, '').trim()
  }
  ```
- **Check required fields**: for x.com, verify `auth_token` is present before
  calling the API, and throw a clear error if missing.
- **Translate auth errors**: catch 401/403 and throw
  `new Error('Cookie 已过期或无效，请重新登录…')`.
- **Never log the full cookie** — it's a secret. Log a redacted version or
  just the presence/absence.
