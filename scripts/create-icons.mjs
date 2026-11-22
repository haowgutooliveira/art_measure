/**
 * Generates public/icon-192.png and public/icon-512.png
 * and public/favicon.ico (16×16 ICO) using only Node built-ins.
 *
 * Logo: Esquadro T/A — Tamanho da Arte
 * Paleta: fundo #023047, logo #FFB703
 *
 * Run: node scripts/create-icons.mjs
 */
import { deflateSync }  from 'zlib'
import { writeFileSync, mkdirSync } from 'fs'
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

// ─── Color helper ─────────────────────────────────────────────────────────
function hex2rgba(hex) {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xFF, (n >> 8) & 0xFF, n & 0xFF, 0xFF]
}

// ─── PNG renderer — Esquadro T/A ──────────────────────────────────────────
/**
 * Draws the T/A logo:
 *   - #023047 background
 *   - #FFB703 outer square border frame
 *   - #FFB703 horizontal T-bar
 *   - #FFB703 filled inverted-V (the A/triangle body)
 *
 * Based on SVG viewBox="6 10 52 52":
 *   pixel(x) = (svgX - 6) / 52 * size
 *   pixel(y) = (svgY - 10) / 52 * size
 */
function renderIcon(size) {
  const pixels = new Uint8Array(size * size * 4)
  const BG = hex2rgba('#023047')
  const FG = hex2rgba('#FFB703')

  function sp(x, y) {  // svgX,svgY → pixel
    return [Math.round((x - 6) / 52 * size), Math.round((y - 10) / 52 * size)]
  }

  function set(x, y, c) {
    if (x < 0 || y < 0 || x >= size || y >= size) return
    const i = (y * size + x) * 4
    pixels[i] = c[0]; pixels[i+1] = c[1]; pixels[i+2] = c[2]; pixels[i+3] = c[3]
  }

  function fillRect(x0, y0, x1, y1, c) {
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        set(x, y, c)
  }

  function strokeRect(x0, y0, x1, y1, t, c) {
    fillRect(x0, y0, x1, y0 + t - 1, c)      // top
    fillRect(x0, y1 - t + 1, x1, y1, c)      // bottom
    fillRect(x0, y0, x0 + t - 1, y1, c)      // left
    fillRect(x1 - t + 1, y0, x1, y1, c)      // right
  }

  // Fill background
  fillRect(0, 0, size - 1, size - 1, BG)

  // Outer square border frame: SVG rect x=8,y=12 w=48 h=48, stroke=3
  const [fx0, fy0] = sp(8, 12)
  const [fx1, fy1] = sp(56, 60)
  const bt = Math.max(1, Math.round(3 * size / 52))
  strokeRect(fx0, fy0, fx1, fy1, bt, FG)

  // T-bar horizontal: SVG x=14.25→49.75, y=20, stroke-width=4
  const [tx0, ty0] = sp(14.25, 18)
  const [tx1, ty1] = sp(49.75, 22)
  fillRect(tx0, ty0, tx1, ty1, FG)

  // Filled triangle (A body): SVG points (29.42,20)→(34.58,20)→(50.08,58.75)→(13.92,58.75)
  // Top-left and top-right of the narrow tip:
  const [triTopX0] = sp(29.42, 20)
  const [triTopX1] = sp(34.58, 20)
  const [, triY0] = sp(32, 20)
  const [, triY1] = sp(32, 58.75)
  const [triBot0] = sp(13.92, 58.75)
  const [triBot1] = sp(50.08, 58.75)

  for (let py = triY0; py <= triY1; py++) {
    const t = (py - triY0) / (triY1 - triY0)
    const xl = Math.round(triTopX0 + (triBot0 - triTopX0) * t)
    const xr = Math.round(triTopX1 + (triBot1 - triTopX1) * t)
    for (let px = xl; px <= xr; px++) set(px, py, FG)
  }

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
    Buffer.from([137,80,78,71,13,10,26,10]),
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
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)

  const entry = Buffer.alloc(16)
  entry[0] = size; entry[1] = size
  entry[2] = 0; entry[3] = 0
  entry.writeUInt16LE(1, 4)
  entry.writeUInt16LE(32, 6)
  entry.writeUInt32LE(png.length, 8)
  entry.writeUInt32LE(6 + 16, 12)

  return Buffer.concat([header, entry, png])
}

// ─── Write files (always regenerate) ──────────────────────────────────────
mkdirSync(PUB, { recursive: true })

for (const [filename, size] of [['icon-192.png', 192], ['icon-512.png', 512]]) {
  writeFileSync(join(PUB, filename), buildPNG(size))
  console.log(`✔ Generated ${filename}`)
}

writeFileSync(join(PUB, 'favicon.ico'), buildICO())
console.log('✔ Generated favicon.ico')
