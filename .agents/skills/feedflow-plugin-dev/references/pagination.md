# Pagination & Cursors

`fetchItems(config, cursor?)` receives a `cursor` only when the user clicks
"load older". On a normal refresh, the runner passes `undefined` — always
fetch the latest items, and let the DB upsert dedupe by `externalId`.

## Cursor is an opaque string

`nextCursor` in `FetchResult` is `string | null`. You decide the format. Two
conventions are used by existing plugins:

### 1. Raw API cursor (simplest)

If the source API returns a cursor string (e.g. X.com GraphQL cursor), pass it
through:

```js
const nextCursorValue = extractNextCursor(response)
return { items, nextCursor: nextCursorValue || null }
```

On "load older", `cursor` will be that same string — pass it back to the API.

### 2. JSON-structured cursor (sinceId / maxId)

Use this when the API uses ID-based pagination and you need to track both the
newest seen ID (for incremental) and oldest seen ID (for "load older"):

```js
// returning
const nextCursor = JSON.stringify({
  sinceId: newestId,   // highest ID seen — for incremental refresh
  maxId: oldestId      // lowest ID seen — for "load older"
})
return { items, nextCursor }
```

```js
// parsing
let sinceId = null, maxId = null
if (cursor) {
  try {
    const c = JSON.parse(cursor)
    sinceId = c.sinceId || null
    maxId = c.maxId || null
  } catch {
    sinceId = cursor  // backward compat: raw ID string
  }
}
```

## Refresh vs "load older"

- **Refresh** (runner): `cursor = undefined`. Fetch the latest page. Return
  `nextCursor` pointing to the oldest item you just fetched, so "load older"
  can continue from there.
- **Load older** (runner): `cursor = <last nextCursor>`. Use it to fetch the
  next page of older items. Return the new `nextCursor`.

## Important rules

- Always return `nextCursor: null` (not `undefined`) when there's no next page.
- If the API returns an empty page but says there might be more, keep the
  cursor so the next "load older" retries (see weibo-group-chat: returns
  `nextCursor: cursor` when `messages.length === 0`).
- Don't use the cursor on refresh — always fetch fresh latest, so that edits
  to existing posts (avatar changes, deleted posts) get picked up by upsert.
