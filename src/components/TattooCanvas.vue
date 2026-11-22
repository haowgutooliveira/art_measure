<script setup>
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'

const props = defineProps({
  imageDataUrl: { type: String, required: true },
  pixelsPerCm:  { type: Number, default: 1 },
})

const emit = defineEmits(['complete', 'back'])

// ─── Refs ─────────────────────────────────────────────────────────────────
const wrapRef  = ref(null)
const canvasRef = ref(null)

// Drawing state
const strokes  = ref([])   // array of stroke arrays [Point[]]
const isClosed = ref(false)
const isDrawing = ref(false)
const lastPoint = ref(null)

// Magnifier state
const mag = ref({ visible: false, x: 0, y: 0, srcX: 0, srcY: 0 })

// Image
const bgImage = new Image()

// Canvas size (logical px)
const canvasW = ref(0)
const canvasH = ref(0)

// Magnifier constants
const MAG_SIZE   = 110   // px display diameter
const MAG_SCALE  = 2.2
const MAG_OFFSET = 130   // px above touch point

// All points flattened (for polygon close & area calc)
const allPoints = computed(() => strokes.value.flat())

// ─── Canvas setup ─────────────────────────────────────────────────────────
function resizeCanvas() {
  const wrap = wrapRef.value
  if (!wrap) return
  const rect = wrap.getBoundingClientRect()
  canvasW.value = rect.width
  canvasH.value = rect.height
  const canvas = canvasRef.value
  if (!canvas) return
  const dpr = window.devicePixelRatio || 1
  canvas.width  = rect.width  * dpr
  canvas.height = rect.height * dpr
  redraw()
}

// ─── Main draw ────────────────────────────────────────────────────────────
function redraw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const W = canvas.clientWidth
  const H = canvas.clientHeight

  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

  // Clear
  ctx.clearRect(0, 0, W, H)

  // Background image (cover-fit)
  if (bgImage.complete && bgImage.naturalWidth) {
    const scale = Math.max(W / bgImage.naturalWidth, H / bgImage.naturalHeight)
    const iw = bgImage.naturalWidth  * scale
    const ih = bgImage.naturalHeight * scale
    const ix = (W - iw) / 2
    const iy = (H - ih) / 2
    ctx.drawImage(bgImage, ix, iy, iw, ih)
  }

  // Draw all strokes
  strokes.value.forEach((pts, si) => {
    if (pts.length < 2) return
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2
      const my = (pts[i].y + pts[i + 1].y) / 2
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
    }
    const last = pts[pts.length - 1]
    ctx.lineTo(last.x, last.y)
    ctx.strokeStyle = '#ef4444'
    ctx.lineWidth = 2.5
    ctx.lineJoin = 'round'
    ctx.lineCap  = 'round'
    ctx.stroke()
  })

  // Closed fill + closing line
  if (isClosed.value && allPoints.value.length >= 3) {
    const pts = allPoints.value
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x, pts[i].y)
    }
    ctx.closePath()
    ctx.fillStyle = 'rgba(239,68,68,0.22)'
    ctx.fill()
    // Closing edge
    const last = pts[pts.length - 1]
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(pts[0].x, pts[0].y)
    ctx.strokeStyle = '#ef4444'
    ctx.lineWidth = 2.5
    ctx.setLineDash([6, 4])
    ctx.stroke()
    ctx.setLineDash([])
  }

  // Start point dot
  if (allPoints.value.length > 0 && !isClosed.value) {
    const p = allPoints.value[0]
    ctx.beginPath()
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2)
    ctx.fillStyle = '#22c55e'
    ctx.fill()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }

  ctx.restore()
}

// ─── Magnifier ────────────────────────────────────────────────────────────
function drawMagnifier(touchX, touchY) {
  if (!mag.value.visible) return
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const half  = MAG_SIZE / 2
  const capture = MAG_SIZE / MAG_SCALE  // logical px region to sample

  // Position: above finger
  const mx = touchX - half
  const my = touchY - MAG_OFFSET - half

  ctx.save()
  ctx.scale(dpr, dpr)

  // Clip to circle
  ctx.beginPath()
  ctx.arc(mx + half, my + half, half, 0, Math.PI * 2)
  ctx.clip()

  // Draw magnified slice from canvas itself
  ctx.drawImage(
    canvas,
    // source (physical px): area around touch
    (touchX - capture / 2) * dpr,
    (touchY - capture / 2) * dpr,
    capture * dpr,
    capture * dpr,
    // dest (logical px)
    mx, my,
    MAG_SIZE, MAG_SIZE,
  )

  // Border
  ctx.beginPath()
  ctx.arc(mx + half, my + half, half, 0, Math.PI * 2)
  ctx.strokeStyle = '#f59e0b'
  ctx.lineWidth = 2.5
  ctx.stroke()

  // Crosshair
  ctx.strokeStyle = 'rgba(239,68,68,0.9)'
  ctx.lineWidth = 1.2
  const cx = mx + half, cy = my + half
  ctx.beginPath()
  ctx.moveTo(cx - 12, cy); ctx.lineTo(cx + 12, cy)
  ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy + 12)
  ctx.stroke()

  ctx.restore()
}

// ─── Pointer helpers ──────────────────────────────────────────────────────
function getXY(e) {
  const rect = canvasRef.value.getBoundingClientRect()
  const src  = e.touches ? e.touches[0] : e
  return { x: src.clientX - rect.left, y: src.clientY - rect.top }
}

function onPointerDown(e) {
  if (isClosed.value) return
  e.preventDefault()
  isDrawing.value = true
  const { x, y } = getXY(e)
  lastPoint.value = { x, y }
  strokes.value.push([{ x, y }])
  mag.value = { visible: true, x, y }
  redraw()
  drawMagnifier(x, y)
}

function onPointerMove(e) {
  if (!isDrawing.value) return
  e.preventDefault()
  const { x, y } = getXY(e)

  const current = strokes.value[strokes.value.length - 1]
  const last = current[current.length - 1]
  // Throttle: only add point if moved enough
  if (Math.hypot(x - last.x, y - last.y) > 3) {
    current.push({ x, y })
    lastPoint.value = { x, y }
  }

  mag.value = { visible: true, x, y }
  redraw()
  drawMagnifier(x, y)
}

function onPointerUp(e) {
  if (!isDrawing.value) return
  e.preventDefault()
  isDrawing.value = false
  mag.value = { ...mag.value, visible: false }
  redraw()
}

// ─── Actions ──────────────────────────────────────────────────────────────
function closeArea() {
  if (allPoints.value.length < 3) return
  isClosed.value = true
  redraw()
}

function undo() {
  if (isClosed.value) {
    isClosed.value = false
  } else if (strokes.value.length > 0) {
    strokes.value.pop()
  }
  redraw()
}

function clear() {
  strokes.value = []
  isClosed.value = false
  redraw()
}

// ─── Annotation snapshot (offscreen canvas — não toca no canvas principal) ──
function generateSnapshot() {
  const main = canvasRef.value
  if (!main || !main.width || !main.height) return null

  // Dimensões físicas do canvas principal (já inclui DPR)
  const PW = main.width    // physical width  (ex: 780 num Retina 2×)
  const PH = main.height   // physical height

  const dpr = window.devicePixelRatio || 1
  // Dimensões lógicas (CSS px)
  const LW = PW / dpr
  const LH = PH / dpr

  // Canvas offscreen idêntico
  const off = document.createElement('canvas')
  off.width  = PW
  off.height = PH
  const ctx  = off.getContext('2d')

  // 1. Copia o conteúdo já desenhado (imagem + polígono)
  ctx.drawImage(main, 0, 0)

  // 2. Escala para trabalhar em coordenadas lógicas (CSS px)
  ctx.scale(dpr, dpr)

  const pts = allPoints.value
  const ppc = props.pixelsPerCm

  const xs = pts.map(p => p.x)
  const ys = pts.map(p => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const widthCm  = ((maxX - minX) / ppc).toFixed(1)
  const heightCm = ((maxY - minY) / ppc).toFixed(1)

  let sum = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  const areaCm2 = (Math.abs(sum) / 2 / (ppc * ppc)).toFixed(1)

  const PAD = 30
  const TIP = 7

  // ── Helpers ─────────────────────────────────────────────────────────
  function arrowH(x1, y, x2) {
    ctx.beginPath()
    ctx.moveTo(x1, y); ctx.lineTo(x2, y)
    ctx.moveTo(x1, y); ctx.lineTo(x1 + TIP, y - TIP * 0.55)
    ctx.moveTo(x1, y); ctx.lineTo(x1 + TIP, y + TIP * 0.55)
    ctx.moveTo(x2, y); ctx.lineTo(x2 - TIP, y - TIP * 0.55)
    ctx.moveTo(x2, y); ctx.lineTo(x2 - TIP, y + TIP * 0.55)
    ctx.stroke()
  }

  function arrowV(x, y1, y2) {
    ctx.beginPath()
    ctx.moveTo(x, y1); ctx.lineTo(x, y2)
    ctx.moveTo(x, y1); ctx.lineTo(x - TIP * 0.55, y1 + TIP)
    ctx.moveTo(x, y1); ctx.lineTo(x + TIP * 0.55, y1 + TIP)
    ctx.moveTo(x, y2); ctx.lineTo(x - TIP * 0.55, y2 - TIP)
    ctx.moveTo(x, y2); ctx.lineTo(x + TIP * 0.55, y2 - TIP)
    ctx.stroke()
  }

  function badge(text, x, y) {
    ctx.font = 'bold 12px -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const tw = ctx.measureText(text).width
    const bw = tw + 14, bh = 20, br = 5
    ctx.fillStyle = 'rgba(15,23,42,0.84)'
    ctx.beginPath()
    ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, br)
    ctx.fill()
    ctx.fillStyle = '#f59e0b'
    ctx.fillText(text, x, y)
  }

  function areaBadge(text, x, y) {
    ctx.font = 'bold 14px -apple-system, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const tw = ctx.measureText(text).width
    const bw = tw + 18, bh = 26, br = 7
    ctx.fillStyle = 'rgba(15,23,42,0.88)'
    ctx.beginPath()
    ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, br)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.fillText(text, x, y)
  }

  // ── Linhas de extensão (tracejadas, finas) ───────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'
  ctx.lineWidth   = 0.8
  ctx.setLineDash([3, 4])
  const wyLine = Math.max(PAD, minY - PAD)
  const hxLine = Math.min(LW - PAD, maxX + PAD)
  ctx.beginPath()
  ctx.moveTo(minX, minY); ctx.lineTo(minX, wyLine)
  ctx.moveTo(maxX, minY); ctx.lineTo(maxX, wyLine)
  ctx.moveTo(maxX, minY); ctx.lineTo(hxLine, minY)
  ctx.moveTo(maxX, maxY); ctx.lineTo(hxLine, maxY)
  ctx.stroke()
  ctx.setLineDash([])

  // ── Linhas de cota (sólidas) ─────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'
  ctx.lineWidth   = 1.5
  arrowH(minX, wyLine, maxX)
  arrowV(hxLine, minY, maxY)

  // ── Badges de dimensão ───────────────────────────────────────────────
  badge(`${widthCm} cm`,  (minX + maxX) / 2, wyLine)
  badge(`${heightCm} cm`, hxLine + 22,        (minY + maxY) / 2)

  // ── Badge de área no centro do polígono ──────────────────────────────
  areaBadge(`${areaCm2} cm²`, (minX + maxX) / 2, (minY + maxY) / 2)

  return off.toDataURL('image/jpeg', 0.92)
}

function complete() {
  closeArea()
  const snapshotUrl = generateSnapshot()
  emit('complete', { points: allPoints.value, snapshotUrl })
}

// ─── Lifecycle ────────────────────────────────────────────────────────────
bgImage.onload = () => redraw()

onMounted(() => {
  bgImage.src = props.imageDataUrl
  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
})

onUnmounted(() => {
  window.removeEventListener('resize', resizeCanvas)
})

watch(() => props.imageDataUrl, (src) => { bgImage.src = src })
</script>

<template>
  <div class="tc-wrap" ref="wrapRef">
    <canvas
      ref="canvasRef"
      class="tc-canvas"
      @mousedown="onPointerDown"
      @mousemove="onPointerMove"
      @mouseup="onPointerUp"
      @mouseleave="onPointerUp"
      @touchstart.prevent="onPointerDown"
      @touchmove.prevent="onPointerMove"
      @touchend.prevent="onPointerUp"
      @touchcancel.prevent="onPointerUp"
    />

    <!-- Hint: no drawing yet -->
    <div v-if="allPoints.length === 0 && !isDrawing" class="tc-hint">
      <div class="tc-hint-box">
        <span class="tc-hint-icon">✏️</span>
        <!-- UX #8 — texto generalizado -->
        <span>Risque o contorno da área da arte</span>
        <span class="tc-hint-sub">Levante o dedo para reposicionar</span>
      </div>
    </div>

    <!-- UX #11 — contador de traços, visível após o 1º traço -->
    <div v-if="strokes.length > 0 && !isDrawing && allPoints.length < 3" class="tc-stroke-hint">
      {{ strokes.length }} {{ strokes.length === 1 ? 'traço' : 'traços' }} — continue riscando ou
      <strong>levante o dedo para reposicionar</strong>
    </div>

    <!-- CTA flutuante: aparece depois de riscar -->
    <transition name="cta-pop">
      <button
        v-if="allPoints.length >= 3 && !isDrawing"
        class="tc-cta"
        @click="complete"
      >
        📐 Calcular Área →
      </button>
    </transition>

    <!-- Bottom action bar -->
    <div class="tc-bar">
      <!-- UX #3 — label explícito "traço" para desfazer -->
      <button class="btn btn-ghost btn-sm" :disabled="allPoints.length === 0" @click="undo">
        ↩ Desfazer traço
      </button>
      <button class="btn btn-danger btn-sm" :disabled="allPoints.length === 0" @click="clear">
        🗑 Limpar tudo
      </button>
    </div>
  </div>
</template>

<style scoped>
.tc-wrap {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #000;
}

.tc-canvas {
  flex: 1;
  width: 100%;
  display: block;
  touch-action: none;
  cursor: crosshair;
}

.tc-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.tc-hint-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 24px;
  background: rgba(15,23,42,0.75);
  border-radius: var(--radius-lg);
  border: 1px solid var(--bg-600);
  backdrop-filter: blur(8px);
  font-size: 14px;
  color: var(--text-300);
  text-align: center;
  max-width: 220px;
}

.tc-hint-icon { font-size: 28px; }

.tc-hint-sub {
  font-size: 11px;
  color: var(--bg-600);
  margin-top: 2px;
}

/* UX #11 — contador de traços */
.tc-stroke-hint {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  background: rgba(15,23,42,0.75);
  backdrop-filter: blur(6px);
  border: 1px solid var(--bg-600);
  border-radius: 20px;
  padding: 5px 14px;
  font-size: 12px;
  color: var(--text-300);
  pointer-events: none;
  z-index: 10;
}

/* ── Floating CTA ─────────────────────────────────────────────────────── */
.tc-cta {
  position: absolute;
  bottom: 72px;         /* fica acima da barra */
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  padding: 16px 32px;
  background: var(--accent-green);
  color: #fff;
  border: none;
  border-radius: 50px;
  font-size: 17px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 24px rgba(34,197,94,0.5);
  animation: pulse-cta 1.8s ease-in-out infinite;
  -webkit-tap-highlight-color: transparent;
  z-index: 20;
}

.tc-cta:active { transform: translateX(-50%) scale(0.95); }

@keyframes pulse-cta {
  0%, 100% { box-shadow: 0 4px 24px rgba(34,197,94,0.5); }
  50%       { box-shadow: 0 4px 36px rgba(34,197,94,0.85); }
}

/* Transition */
.cta-pop-enter-active { transition: opacity 0.25s, transform 0.25s; }
.cta-pop-leave-active { transition: opacity 0.15s; }
.cta-pop-enter-from  { opacity: 0; transform: translateX(-50%) translateY(12px); }
.cta-pop-leave-to    { opacity: 0; }

/* ── Bottom bar ─────────────────────────────────────────────────────────── */
.tc-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px 16px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  background: var(--bg-800);
  border-top: 1px solid var(--bg-700);
}
</style>
