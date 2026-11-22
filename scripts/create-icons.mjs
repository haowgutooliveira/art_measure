/**
 * Generates public/icon-192.png and public/icon-512.png
 * and public/favicon.ico (16×16 ICO) using only Node built-ins.
 * Run: node scripts/create-icons.mjs
 */
import { deflateSync }  from 'zlib'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT  = join(__dir, '..')
const PUB   = join(ROOT, 'public')

// ─── CRC-32 ────────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let crc = 0xFFFFFFFF
  for (const b of buf) crc = CRC_TABLE[(crc ^ b) & 0xFF] ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

// ─── PNG chunk helper ──────────────────────────────────────────────────────
function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf  = Buffer.alloc(4); lenBuf.writeUInt32BE(data.length)
  const crcBuf  = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

// ─── PNG renderer ─────────────────────────────────────────────────────────
/**
 * Draws a simple TattMeasure icon:
 *   - solid #0f172a background
 *   - amber rounded square
 *   - white pen glyph
 */
function renderIcon(size) {
  const pixels = new Uint8Array(size * size * 4)

  const BG   = [0x0f, 0x17, 0x2a, 0xFF]
  const CARD = [0xf5, 0x9e, 0x0b, 0xFF]  // amber
  const WHITE = [0xFF, 0xFF, 0xFF, 0xFF]

  function setPixel(x, y, rgba) {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    pixels[i]   = rgba[0]; pixels[i+1] = rgba[1]
    pixels[i+2] = rgba[2]; pixels[i+3] = rgba[3]
  }

  function fillRect(x0, y0, x1, y1, rgba) {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        setPixel(x, y, rgba)
  }

  function circle(cx, cy, r, rgba) {
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r)
          setPixel(x, y, rgba)
  }

  const s = size

  // Background
  fillRect(0, 0, s - 1, s - 1, BG)

  // Amber rounded rect (card)
  const pad  = Math.round(s * 0.15)
  const rad  = Math.round(s * 0.18)
  const cx0 = pad, cy0 = pad, cx1 = s - 1 - pad, cy1 = s - 1 - pad

  for (let y = cy0; y <= cy1; y++) {
    for (let x = cx0; x <= cx1; x++) {
      // Check if inside rounded rect
      const dx = Math.max(cx0 + rad - x, x - (cx1 - rad), 0)
      const dy = Math.max(cy0 + rad - y, y - (cy1 - rad), 0)
      if (dx * dx + dy * dy <= rad * rad) setPixel(x, y, CARD)
    }
  }

  // Simple pen nib (white triangle + rectangle)
  const mid  = Math.floor(s / 2)
  const ph   = Math.round(s * 0.25)
  const pw   = Math.round(s * 0.07)

  // Pen body (rectangle)
  fillRect(mid - pw, cy0 + pad, mid + pw, mid + ph / 2, WHITE)

  // Pen nib tip (triangle)
  for (let row = 0; row < ph; row++) {
    const halfW = Math.round(pw * (1 - row / ph))
    fillRect(mid - halfW, mid + ph / 2 + row, mid + halfW, mid + ph / 2 + row, WHITE)
  }

  // Dot under nib
  circle(mid, mid + ph / 2 + ph + Math.round(s * 0.02), Math.round(s * 0.025), WHITE)

  return pixels
}

// ─── Build PNG binary ──────────────────────────────────────────────────────
function buildPNG(size) {
  const pixels = renderIcon(size)
  const IHDR = Buffer.alloc(13)
  IHDR.writeUInt32BE(size, 0)
  IHDR.writeUInt32BE(size, 4)
  IHDR[8] = 8   // bit depth
  IHDR[9] = 6   // RGBA
  IHDR[10] = 0; IHDR[11] = 0; IHDR[12] = 0

  // Build raw scanlines (filter byte 0 per row)
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4)
    row[0] = 0
    for (let x = 0; x < size; x++) {
      const pi = (y * size + x) * 4
      row[1 + x * 4]     = pixels[pi]
      row[1 + x * 4 + 1] = pixels[pi + 1]
      row[1 + x * 4 + 2] = pixels[pi + 2]
      row[1 + x * 4 + 3] = pixels[pi + 3]
    }
    rows.push(row)
  }
  const raw = Buffer.concat(rows)
  const compressed = deflateSync(raw, { level: 6 })

  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),  // PNG signature
    pngChunk('IHDR', IHDR),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ─── Build a minimal ICO (16×16) ──────────────────────────────────────────
function buildICO() {
  const size = 16
  const png  = buildPNG(size)

  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)   // reserved
  header.writeUInt16LE(1, 2)   // type: ICO
  header.writeUInt16LE(1, 4)   // count

  const entry = Buffer.alloc(16)
  entry[0] = size; entry[1] = size
  entry[2] = 0     // palette
  entry[3] = 0     // reserved
  entry.writeUInt16LE(1, 4)    // planes
  entry.writeUInt16LE(32, 6)   // bit count
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(6 + 16, 12)  // offset = header + 1 entry

  return Buffer.concat([header, entry, png])
}

// ─── Write files ──────────────────────────────────────────────────────────
mkdirSync(PUB, { recursive: true })

for (const [filename, size] of [['icon-192.png', 192], ['icon-512.png', 512]]) {
  const dest = join(PUB, filename)
  if (!existsSync(dest)) {
    writeFileSync(dest, buildPNG(size))
    console.log(`✔ Generated ${filename}`)
  } else {
    console.log(`· ${filename} already exists, skipping`)
  }
}

const faviconDest = join(PUB, 'favicon.ico')
if (!existsSync(faviconDest)) {
  writeFileSync(faviconDest, buildICO())
  console.log('✔ Generated favicon.ico')
} else {
  console.log('· favicon.ico already exists, skipping')
}
