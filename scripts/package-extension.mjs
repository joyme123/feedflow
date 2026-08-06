import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

// 生成可直接上传 Chrome Web Store 的 ZIP：manifest.json 必须位于 ZIP 根目录，
// 因此从扩展目录内部打包，而不是压缩整个目录（后者会得到 cookie-sync/manifest.json）。
const root = process.cwd();
const extDir = resolve(root, 'extensions/cookie-sync');

const manifestPath = resolve(extDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`manifest.json not found at ${manifestPath}`);
  process.exit(1);
}

const { version } = JSON.parse(await readFile(manifestPath, 'utf8'));
const outFile = resolve(root, `feedflow-cookie-sync-v${version}.zip`);

await rm(outFile, { force: true });

// -r 递归，-X 去除多余的扩展文件属性以获得更稳定可复现的包；
// 排除 README、generate-icons.js 等开发期文件，它们不需要进入商店包。
const zip = spawn(
  'zip',
  [
    '-r',
    '-X',
    outFile,
    '.',
    '-x',
    'README.md',
    'generate-icons.js',
    '*.map',
    'node_modules/*',
    '.DS_Store'
  ],
  { cwd: extDir, stdio: 'inherit' }
);

zip.on('error', (error) => {
  console.error(`Failed to run zip: ${error.message}`);
  process.exit(1);
});

zip.on('close', (code) => {
  if (code !== 0) {
    process.exit(code ?? 1);
  }
  // 校验 ZIP 根目录确实存在 manifest.json，否则上传会被商店拒绝。
  const check = spawn('unzip', ['-l', outFile], { stdio: ['ignore', 'pipe', 'inherit'] });
  let listing = '';
  check.stdout.on('data', (chunk) => {
    listing += chunk.toString();
  });
  check.on('close', () => {
    const hasRootManifest = listing
      .split('\n')
      .some((line) => /\s manifest\.json$/.test(line) || /\bmanifest\.json$/.test(line.trim()));
    if (!hasRootManifest) {
      console.error('Packaged ZIP does not contain manifest.json at its root.');
      process.exit(1);
    }
    console.log(`Store package created: ${outFile}`);
  });
});
