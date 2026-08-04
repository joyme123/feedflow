// Generate FeedFlow extension icons (16, 48, 128 px)
// Design: blue rounded-rectangle background + 3 white rounded bars (increasing length = "feed flow")

const zlib = require('zlib')
const fs = require('fs')
const path = require('path')

// ---- CRC32 ----
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ---- PNG encoder ----
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii')
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}
function createPNG(w, h, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// ---- Geometry ----
function inRoundedRect(x, y, rx, ry, rw, rh, r) {
  if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) return false
  const corner =
    (x < rx + r && y < ry + r) ||
    (x >= rx + rw - r && y < ry + r) ||
    (x < rx + r && y >= ry + rh - r) ||
    (x >= rx + rw - r && y >= ry + rh - r)
  if (!corner) return true
  let ccx, ccy
  if (x < rx + r && y < ry + r) { ccx = rx + r; ccy = ry + r }
  else if (x >= rx + rw - r && y < ry + r) { ccx = rx + rw - r; ccy = ry + r }
  else if (x < rx + r && y >= ry + rh - r) { ccx = rx + r; ccy = ry + rh - r }
  else { ccx = rx + rw - r; ccy = ry + rh - r }
  const dx = x - ccx, dy = y - ccy
  return dx * dx + dy * dy <= r * r
}

// ---- Icon drawing ----
function drawIcon(size) {
  const data = Buffer.alloc(size * size * 4)
  const bg = [59, 130, 246, 255]   // blue-500
  const fg = [255, 255, 255, 255]  // white
  const radius = size * 0.22

  // 3 white rounded bars, increasing length (feed flow metaphor)
  const barH = size * 0.11
  const gap = size * 0.09
  const totalH = barH * 3 + gap * 2
  const startY = (size - totalH) / 2
  const widths = [size * 0.34, size * 0.54, size * 0.74]
  const ys = [startY, startY + barH + gap, startY + 2 * (barH + gap)]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      if (!inRoundedRect(x, y, 0, 0, size, size, radius)) {
        data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0
        continue
      }
      let color = bg
      for (let b = 0; b < 3; b++) {
        const bw = widths[b], bx = (size - bw) / 2, by = ys[b]
        if (inRoundedRect(x, y, bx, by, bw, barH, barH / 2)) { color = fg; break }
      }
      data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; data[i + 3] = color[3]
    }
  }
  return data
}

// ---- Generate ----
const dir = path.join(__dirname, 'icons')
if (!fs.existsSync(dir)) fs.mkdirSync(dir)
for (const s of [16, 48, 128]) {
  fs.writeFileSync(path.join(dir, `icon${s}.png`), createPNG(s, s, drawIcon(s)))
  console.log(`Generated icon${s}.png (${s}x${s})`)
}
console.log('Done!')
