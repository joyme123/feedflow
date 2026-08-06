import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';

// 使用 Google 服务账号将扩展包上传并发布到 Chrome Web Store（V2 API）。
// 仅依赖 Node 内置模块：手动签发 JWT，换取短期 access token，再调用 V2 端点。
//
// 需要的环境变量：
//   CWS_SERVICE_ACCOUNT_KEY  服务账号 JSON（整段内容）
//   CWS_PUBLISHER_ID         发布商 ID
//   CWS_EXTENSION_ID         已存在商品的扩展 ID
//   CWS_ZIP_PATH             待上传的 ZIP 路径
//   CWS_PUBLISH_TARGET       发布类型，默认 DEFAULT_PUBLISH（也可 STAGED_PUBLISH）

const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://chromewebstore.googleapis.com';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return value;
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// 用服务账号私钥签发 JWT，走标准的 assertion 授权流换取 access token。
async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: SCOPE,
      aud: TOKEN_URI,
      iat: now,
      exp: now + 3600
    })
  );
  const signingInput = `${header}.${claim}`;
  const signature = createSign('RSA-SHA256')
    .update(signingInput)
    .sign(serviceAccount.private_key)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const assertion = `${signingInput}.${signature}`;

  const response = await fetch(TOKEN_URI, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`Token exchange failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body.access_token;
}

async function apiFetch(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {})
    }
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  return { ok: response.ok, status: response.status, body: parsed };
}

async function main() {
  const serviceAccount = JSON.parse(requireEnv('CWS_SERVICE_ACCOUNT_KEY'));
  const publisherId = requireEnv('CWS_PUBLISHER_ID');
  const extensionId = requireEnv('CWS_EXTENSION_ID');
  const zipPath = requireEnv('CWS_ZIP_PATH');
  const publishTarget = process.env.CWS_PUBLISH_TARGET || 'DEFAULT_PUBLISH';

  const itemName = `publishers/${publisherId}/items/${extensionId}`;
  const token = await getAccessToken(serviceAccount);
  const zip = await readFile(zipPath);

  console.log(`Uploading ${zipPath} to ${itemName} ...`);
  const upload = await apiFetch(
    `${API_BASE}/upload/v2/${itemName}:upload`,
    token,
    { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: zip }
  );
  if (!upload.ok) {
    throw new Error(`Upload failed (${upload.status}): ${JSON.stringify(upload.body)}`);
  }
  console.log(`Upload accepted: ${JSON.stringify(upload.body)}`);

  console.log(`Submitting for review with ${publishTarget} ...`);
  const publish = await apiFetch(`${API_BASE}/v2/${itemName}:publish`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ publishType: publishTarget })
  });
  if (!publish.ok) {
    throw new Error(`Publish failed (${publish.status}): ${JSON.stringify(publish.body)}`);
  }
  console.log(`Publish submitted: ${JSON.stringify(publish.body)}`);

  const status = await apiFetch(`${API_BASE}/v2/${itemName}:fetchStatus`, token, { method: 'GET' });
  console.log(`Current status (${status.status}): ${JSON.stringify(status.body)}`);
  console.log('Submission complete. Chrome Web Store review is asynchronous and cannot be bypassed by CI.');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
