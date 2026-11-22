/**
 * Generates public/icon-192.png, public/icon-512.png and public/favicon.ico
 * using only Node built-ins.
 *
 * Logo: Esquadro T/A simplificado (legível em qualquer tamanho)
 *   - Fundo #023047
 *   - Frame interno centrado #FFB703 (borda, sem preenchimento)
 *   - Monograma T em traço grosso #FFB703
 *
 * Baseado no thumbnail do design system (viewBox 100×100):
 *   <rect x="32" y="32" width="36" height="36" stroke="#FFB703"/>
 *   <path d="M38 38H62M50 38V67" stroke="#FFB703" stroke-width="4"/>
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
  let c = 0xFFFFFFFF
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8)
  return (c ^ 0xFFFFFFFF) >>> 0
}
function pngChunk(type, data) {
  const tb = Buffer.from(type, 'ascii')
  const lb = Buffer.alloc(4); lb.writeUInt32BE(data.length)
  const cb = Buffer.alloc(4); cb.writeUInt32BE(crc32(Buffer.concat([tb, data])))
  return Buffer.concat([lb, tb, data, cb])
}

// ─── Pixel helpers ─────────────────────────────────────────────────────────
const BG = [0x02, 0x30, 0x47, 0xFF]
const FG = [0xFF, 0xB7, 0x03, 0xFF]

function renderIcon(size) {
  const px = new Uint8Array(size * size * 4)
  const s = size

  function set(x, y, c) {
    if (x < 0 || y < 0 || x >= s || y >= s) return
    const i = (y * s + x) * 4
    px[i]=c[0]; px[i+1]=c[1]; px[i+2]=c[2]; px[i+3]=c[3]
  }
  function hline(y, x0, x1, c) {
    for (let x = x0; x <= x1; x++) set(x, y, c)
  }
  function vline(x, y0, y1, c) {
    for (let y = y0; y <= y1; y++) set(x, y, c)
  }
  function fillRect(x0, y0, x1, y1, c) {
    for (let y = y0; y <= y1; y++) hline(y, x0, x1, c)
  }
  // Stroke a rectangle outline with thickness t
  function strokeRect(x0, y0, x1, y1, t, c) {
    for (let d = 0; d < t; d++) {
      hline(y0 + d, x0, x1, c)        // top
      hline(y1 - d, x0, x1, c)        // bottom
      vline(x0 + d, y0, y1, c)        // left
      vline(x1 - d, y0, y1, c)        // right
    }
  }

  // ── Background ─────────────────────────────────────────────────────────
  fillRect(0, 0, s-1, s-1, BG)

  // ── Frame interno centrado ─────────────────────────────────────────────
  // Design system: rect x=32%→68%, y=32%→68% sobre fundo de 100px
  const fx0 = Math.round(s * 0.28)
  const fy0 = Math.round(s * 0.28)
  const fx1 = Math.round(s * 0.72)
  const fy1 = Math.round(s * 0.72)
  const bt  = Math.max(1, Math.round(s * 0.045)) // espessura da borda
  strokeRect(fx0, fy0, fx1, fy1, bt, FG)

  // ── Monograma T ────────────────────────────────────────────────────────
  // Barra horizontal: y=38%, de x=36% a x=64%
  // Haste vertical:   x=50%, de y=38% a y=68%
  const th  = Math.max(1, Math.round(s * 0.055)) // espessura do traço T
  const tx0 = Math.round(s * 0.36)
  const tx1 = Math.round(s * 0.64)
  const ty  = Math.round(s * 0.38)
  const mx  = Math.round(s * 0.50)
  const by  = Math.round(s * 0.69)

  // Barra horizontal
  for (let d = 0; d < th; d++) hline(ty + d, tx0, tx1, FG)
  // Haste vertical (começa logo abaixo da barra horizontal)
  for (let d = 0; d < th; d++) vline(mx - Math.floor(th/2) + d, ty, by, FG)

  return px
}

// ─── Build PNG ─────────────────────────────────────────────────────────────
function buildPNG(size) {
  const pixels = renderIcon(size)
  const IHDR = Buffer.alloc(13)
  IHDR.writeUInt32BE(size,0); IHDR.writeUInt32BE(size,4)
  IHDR[8]=8; IHDR[9]=6; IHDR[10]=IHDR[11]=IHDR[12]=0

  const rows = []
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4)
    row[0] = 0
    for (let x = 0; x < size; x++) {
      const pi = (y * size + x) * 4
      row[1+x*4]=pixels[pi]; row[1+x*4+1]=pixels[pi+1]
      row[1+x*4+2]=pixels[pi+2]; row[1+x*4+3]=pixels[pi+3]
    }
    rows.push(row)
  }
  return Buffer.concat([
    Buffer.from([137,80,78,71,13,10,26,10]),
    pngChunk('IHDR', IHDR),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows), { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

// ─── Build ICO (16×16) ─────────────────────────────────────────────────────
function buildICO() {
  const png = buildPNG(16)
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0,0); header.writeUInt16LE(1,2); header.writeUInt16LE(1,4)
  const entry = Buffer.alloc(16)
  entry[0]=16; entry[1]=16; entry[2]=0; entry[3]=0
  entry.writeUInt16LE(1,4); entry.writeUInt16LE(32,6)
  entry.writeUInt32LE(png.length,8); entry.writeUInt32LE(6+16,12)
  return Buffer.concat([header, entry, png])
}

// ─── Write files ───────────────────────────────────────────────────────────
mkdirSync(PUB, { recursive: true })
for (const [file, size] of [['icon-192.png',192],['icon-512.png',512]]) {
  writeFileSync(join(PUB, file), buildPNG(size))
  console.log(`✔ ${file}`)
}
writeFileSync(join(PUB, 'favicon.ico'), buildICO())
console.log('✔ favicon.ico')
