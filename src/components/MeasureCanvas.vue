<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { computeDistanceCm, computeSegmentDistances, polygonCentroid } from '../composables/useMeasurement.js'
import { useShoelaceArea } from '../composables/useShoelaceArea.js'

const props = defineProps({
  imageDataUrl: { type: String, required: true },
  pixelsPerCm:  { type: Number, default: 1 },
})
const emit = defineEmits(['complete'])

// ─── Image refs & display size ────────────────────────────────────────────
const imgRef  = ref(null)
const dispW   = ref(300)
const dispH   = ref(400)
// Scale from display-px → image-px (for distance calc)
const imgScale = ref(1)

function updateDispSize() {
  const img = imgRef.value
  if (!img) return
  dispW.value  = img.clientWidth
  dispH.value  = img.clientHeight
  imgScale.value = img.naturalWidth ? img.naturalWidth / img.clientWidth : 1
}
onMounted(async () => { await nextTick(); updateDispSize(); window.addEventListener('resize', updateDispSize) })
onUnmounted(() => window.removeEventListener('resize', updateDispSize))

// ─── Effective ppc in display-pixel space ─────────────────────────────────
// ppc prop is in image-px/cm → convert to display-px/cm so all our
// point coords (stored in display-px) feed directly into distance functions.
const effectivePpc = computed(() => props.pixelsPerCm / imgScale.value)

// ─── Mode ─────────────────────────────────────────────────────────────────
const mode = ref('polygon') // 'ruler' | 'polygon'

function setMode(m) {
  if (mode.value === m) return
  mode.value = m
  clearAll()
}

// ─── Points (display-px coords) ───────────────────────────────────────────
const points = ref([])   // [{ x, y }] in CSS display pixels
const isClosed = ref(false)

// ruler: max 2 points; polygon: unlimited, closed on confirm
const maxPoints = computed(() => mode.value === 'ruler' ? 2 : Infinity)
const canClose  = computed(() => mode.value === 'polygon' && points.value.length >= 3)
const canConfirm = computed(() =>
  mode.value === 'ruler'
    ? points.value.length === 2
    : points.value.length >= 3
)

// ─── Computed segments & area ─────────────────────────────────────────────
const segments = computed(() => {
  const pts = points.value
  const ppc = effectivePpc.value
  if (pts.length < 2) return []
  const dists = computeSegmentDistances(pts, ppc, isClosed.value)
  return dists.map((dist, i) => {
    const p1 = pts[i]
    const p2 = i < pts.length - 1 ? pts[i + 1] : pts[0]  // closing segment
    return {
      p1, p2,
      mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
      dist,
    }
  })
})

const rulerDist = computed(() => {
  if (mode.value !== 'ruler' || points.value.length < 2) return null
  return computeDistanceCm(points.value[0], points.value[1], effectivePpc.value)
})

const centroid = computed(() => polygonCentroid(points.value))

// Use shoelace composable for area (in display-px, with effectivePpc)
const { areaCm2 } = useShoelaceArea(points, effectivePpc)

// SVG polygon points string
const svgPolygonPoints = computed(() =>
  points.value.map(p => `${p.x},${p.y}`).join(' ')
)

// ─── Magnifier state ──────────────────────────────────────────────────────
const magRef    = ref(null)
const magActive = ref(false)
const magX      = ref(0)   // display-px: position of the circle on screen
const magY      = ref(0)
const MAG_SIZE   = 110
const MAG_OFFSET = 130

function drawMagnifier(displayX, displayY) {
  const img = imgRef.value
  const canvas = magRef.value
  if (!img || !canvas) return

  const zoom       = 2.5
  const sourceSize = MAG_SIZE / zoom          // display-px region to sample
  const sc         = imgScale.value

  const ctx = canvas.getContext('2d')
  ctx.clearRect(0, 0, MAG_SIZE, MAG_SIZE)

  // Draw cropped & zoomed section of the base image
  ctx.drawImage(
    img,
    (displayX - sourceSize / 2) * sc,   // src x in image-px
    (displayY - sourceSize / 2) * sc,   // src y in image-px
    sourceSize * sc,                     // src width in image-px
    sourceSize * sc,                     // src height in image-px
    0, 0, MAG_SIZE, MAG_SIZE,
  )

  // Crosshair
  const half = MAG_SIZE / 2
  ctx.strokeStyle = 'rgba(239,68,68,0.9)'
  ctx.lineWidth   = 1.5
  ctx.beginPath()
  ctx.moveTo(half - 14, half); ctx.lineTo(half + 14, half)
  ctx.moveTo(half, half - 14); ctx.lineTo(half, half + 14)
  ctx.stroke()

  // Ring border
  ctx.strokeStyle = '#FFB703'
  ctx.lineWidth   = 2.5
  ctx.beginPath()
  ctx.arc(half, half, half - 1.5, 0, Math.PI * 2)
  ctx.stroke()
}

// ─── Touch / mouse handlers ───────────────────────────────────────────────
let touchActive = false
let currentTouch = { x: 0, y: 0 }

function getDisplayXY(e) {
  const rect = imgRef.value.getBoundingClientRect()
  const src  = e.changedTouches ? e.changedTouches[0] : e
  return {
    x: Math.max(0, Math.min(src.clientX - rect.left, dispW.value)),
    y: Math.max(0, Math.min(src.clientY - rect.top,  dispH.value)),
  }
}

function onTouchStart(e) {
  if (points.value.length >= maxPoints.value) return
  e.preventDefault()
  touchActive = true
  const { x, y } = getDisplayXY(e)
  currentTouch = { x, y }
  magX.value = x
  magY.value = y
  magActive.value = true
  drawMagnifier(x, y)
}

function onTouchMove(e) {
  if (!touchActive) return
  e.preventDefault()
  const { x, y } = getDisplayXY(e)
  currentTouch = { x, y }
  magX.value = x
  magY.value = y
  drawMagnifier(x, y)
}

function onTouchEnd(e) {
  if (!touchActive) return
  e.preventDefault()
  touchActive = false
  magActive.value = false

  if (points.value.length >= maxPoints.value) return
  points.value = [...points.value, { ...currentTouch }]
  // Ruler: auto-close when 2nd point placed (no explicit close needed)
}

// Mouse (desktop) — click to place
function onMouseClick(e) {
  if (points.value.length >= maxPoints.value) return
  const { x, y } = getDisplayXY(e)
  points.value = [...points.value, { x, y }]
}

// ─── Actions ──────────────────────────────────────────────────────────────
function undo() {
  if (isClosed.value) { isClosed.value = false; return }
  if (points.value.length > 0) points.value = points.value.slice(0, -1)
}

function clearAll() {
  points.value  = []
  isClosed.value = false
}

// ─── Snapshot (offscreen canvas for sharing) ──────────────────────────────
function generateSnapshot() {
  const img = imgRef.value
  if (!img || !img.naturalWidth) return null

  const nw = img.naturalWidth
  const nh = img.naturalHeight
  const sc = imgScale.value  // display-px → image-px

  const off = document.createElement('canvas')
  off.width  = nw
  off.height = nh
  const ctx  = off.getContext('2d')

  // 1. Draw original photo at full resolution
  ctx.drawImage(img, 0, 0, nw, nh)

  // 2. Work in image-px coordinates (scale all display-px points by sc)
  const pts = points.value.map(p => ({ x: p.x * sc, y: p.y * sc }))

  if (pts.length < 2) return off.toDataURL('image/jpeg', 0.92)

  const ppc = props.pixelsPerCm   // already in image-px/cm

  // ── Draw polygon / line ────────────────────────────────────────────────
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  if (mode.value === 'polygon') ctx.closePath()

  if (mode.value === 'polygon') {
    ctx.fillStyle = 'rgba(239,68,68,0.20)'
    ctx.fill()
  }
  ctx.strokeStyle = '#ef4444'
  ctx.lineWidth   = Math.max(2, nw / 400)
  ctx.lineJoin    = 'round'
  ctx.stroke()

  // ── Point dots (numbered) ──────────────────────────────────────────────
  const dotR    = Math.max(14, nw / 180)
  const fontSize = dotR * 1.1
  pts.forEach((p, i) => {
    ctx.beginPath()
    ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2)
    ctx.fillStyle   = '#FFB703'
    ctx.fill()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth   = dotR * 0.18
    ctx.stroke()

    ctx.fillStyle    = '#023047'
    ctx.font         = `bold ${fontSize}px system-ui, sans-serif`
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(String(i + 1), p.x, p.y)
  })

  // ── Segment distance badges ────────────────────────────────────────────
  const dists = computeSegmentDistances(pts, ppc, mode.value === 'polygon')
  dists.forEach((dist, i) => {
    const p1  = pts[i]
    const p2  = i < pts.length - 1 ? pts[i + 1] : pts[0]
    const mx  = (p1.x + p2.x) / 2
    const my  = (p1.y + p2.y) / 2
    const lbl = `${dist.toFixed(1)} cm`

    const bFont = Math.max(11, nw / 230)
    ctx.font      = `bold ${bFont}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const tw   = ctx.measureText(lbl).width
    const bw   = tw + bFont * 1.4
    const bh   = bFont * 1.9
    const br   = bh * 0.35

    ctx.fillStyle = 'rgba(15,23,42,0.84)'
    ctx.beginPath()
    ctx.roundRect(mx - bw / 2, my - bh / 2, bw, bh, br)
    ctx.fill()
    ctx.fillStyle = '#FFB703'
    ctx.fillText(lbl, mx, my)
  })

  // ── Area badge (polygon mode) ──────────────────────────────────────────
  if (mode.value === 'polygon' && pts.length >= 3) {
    const c    = polygonCentroid(pts)
    let areaVal = 0
    let sum = 0
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length
      sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y
    }
    areaVal = Math.abs(sum) / 2 / (ppc * ppc)

    const lbl  = `${areaVal.toFixed(1)} cm²`
    const aFont = Math.max(14, nw / 170)
    ctx.font = `bold ${aFont}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const tw = ctx.measureText(lbl).width
    const bw = tw + aFont * 1.6
    const bh = aFont * 2.2
    const br = bh * 0.35

    ctx.fillStyle = 'rgba(15,23,42,0.88)'
    ctx.beginPath()
    ctx.roundRect(c.x - bw / 2, c.y - bh / 2, bw, bh, br)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.fillText(lbl, c.x, c.y)
  }

  // ── Ruler: big central badge ───────────────────────────────────────────
  if (mode.value === 'ruler' && pts.length === 2) {
    const dist = computeDistanceCm(pts[0], pts[1], ppc)
    const mx   = (pts[0].x + pts[1].x) / 2
    const my   = (pts[0].y + pts[1].y) / 2
    const lbl  = `${dist.toFixed(1)} cm`
    const aFont = Math.max(16, nw / 150)
    ctx.font = `bold ${aFont}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const tw = ctx.measureText(lbl).width
    const bw = tw + aFont * 2
    const bh = aFont * 2.4
    const br = bh / 2

    ctx.fillStyle = 'rgba(15,23,42,0.88)'
    ctx.beginPath()
    ctx.roundRect(mx - bw / 2, my - bh / 2, bw, bh, br)
    ctx.fill()
    ctx.fillStyle = '#FFB703'
    ctx.fillText(lbl, mx, my)
  }

  return off.toDataURL('image/jpeg', 0.92)
}

// ─── Confirm ──────────────────────────────────────────────────────────────
function complete() {
  isClosed.value = true
  const snapshotUrl = generateSnapshot()
  if (mode.value === 'ruler') {
    emit('complete', {
      mode: 'ruler',
      distanceCm: rulerDist.value,
      points: points.value,
      snapshotUrl,
    })
  } else {
    emit('complete', {
      mode: 'polygon',
      points: points.value,
      snapshotUrl,
    })
  }
}

// ─── Hint text ────────────────────────────────────────────────────────────
const hintText = computed(() => {
  if (mode.value === 'ruler') {
    if (points.value.length === 0) return 'Toque no ponto inicial (A)'
    if (points.value.length === 1) return 'Toque no ponto final (B)'
    return 'Pronto! Confirme a medida abaixo'
  }
  if (points.value.length === 0) return 'Toque para marcar o 1º ponto'
  if (points.value.length < 3)   return `Ponto ${points.value.length + 1} — continue marcando`
  return 'Marque mais pontos ou calcule a área'
})
</script>

<template>
  <div class="mc-wrap">

    <!-- ── Mode selector tabs ─────────────────────────────────────────── -->
    <div class="mc-mode-bar">
      <button
        class="mode-tab"
        :class="{ active: mode === 'ruler' }"
        @click="setMode('ruler')"
      >
        📏 Fita métrica
      </button>
      <button
        class="mode-tab"
        :class="{ active: mode === 'polygon' }"
        @click="setMode('polygon')"
      >
        📐 Área
      </button>
    </div>

    <!-- ── Photo + SVG overlay ───────────────────────────────────────── -->
    <div
      class="mc-img-wrap"
      @mousedown="onMouseClick"
      @touchstart.passive="onTouchStart"
      @touchmove.passive="onTouchMove"
      @touchend.passive="onTouchEnd"
    >
      <img
        ref="imgRef"
        :src="imageDataUrl"
        class="mc-img"
        draggable="false"
        @load="updateDispSize"
        alt=""
      />

      <!-- SVG measurement overlay -->
      <svg
        class="mc-svg"
        :viewBox="`0 0 ${dispW} ${dispH}`"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
      >
        <!-- Polygon fill when closed -->
        <polygon
          v-if="mode === 'polygon' && isClosed && points.length >= 3"
          :points="svgPolygonPoints"
          fill="rgba(239,68,68,0.20)"
          stroke="none"
        />

        <!-- Closing edge dashed preview (polygon, 3+ pts, before confirm) -->
        <line
          v-if="mode === 'polygon' && points.length >= 3 && !isClosed"
          :x1="points[points.length - 1].x" :y1="points[points.length - 1].y"
          :x2="points[0].x" :y2="points[0].y"
          stroke="#ef4444" stroke-width="1.5" stroke-dasharray="8 5" opacity="0.5"
        />

        <!-- Segments + distance badges -->
        <g v-for="(seg, i) in segments" :key="`seg-${i}`">
          <line
            :x1="seg.p1.x" :y1="seg.p1.y"
            :x2="seg.p2.x" :y2="seg.p2.y"
            stroke="#ef4444" stroke-width="2.5"
            stroke-linecap="round"
          />
          <!-- Badge background -->
          <rect
            :x="seg.mid.x - 26" :y="seg.mid.y - 11"
            width="52" height="22" rx="6"
            fill="rgba(15,23,42,0.84)"
          />
          <text
            :x="seg.mid.x" :y="seg.mid.y"
            text-anchor="middle" dominant-baseline="central"
            fill="#FFB703" font-size="11" font-weight="bold" font-family="system-ui, sans-serif"
          >{{ seg.dist.toFixed(1) }} cm</text>
        </g>

        <!-- Area badge in centroid (polygon, 3+ pts) -->
        <g v-if="mode === 'polygon' && points.length >= 3">
          <rect
            :x="centroid.x - 38" :y="centroid.y - 14"
            width="76" height="28" rx="8"
            fill="rgba(15,23,42,0.88)"
          />
          <text
            :x="centroid.x" :y="centroid.y"
            text-anchor="middle" dominant-baseline="central"
            fill="#fff" font-size="13" font-weight="bold" font-family="system-ui, sans-serif"
          >{{ areaCm2.toFixed(1) }} cm²</text>
        </g>

        <!-- Ruler: big central badge -->
        <g v-if="mode === 'ruler' && rulerDist !== null">
          <rect
            :x="((points[0].x + points[1].x) / 2) - 44"
            :y="((points[0].y + points[1].y) / 2) - 17"
            width="88" height="34" rx="17"
            fill="rgba(15,23,42,0.88)"
          />
          <text
            :x="(points[0].x + points[1].x) / 2"
            :y="(points[0].y + points[1].y) / 2"
            text-anchor="middle" dominant-baseline="central"
            fill="#FFB703" font-size="15" font-weight="bold" font-family="system-ui, sans-serif"
          >{{ rulerDist.toFixed(1) }} cm</text>
        </g>

        <!-- Points (numbered circles) -->
        <g v-for="(pt, i) in points" :key="`pt-${i}`">
          <circle :cx="pt.x" :cy="pt.y" r="16" fill="#FFB703" stroke="white" stroke-width="2.5" />
          <text
            :x="pt.x" :y="pt.y"
            text-anchor="middle" dominant-baseline="central"
            fill="#023047" font-weight="bold" font-size="13" font-family="system-ui, sans-serif"
          >{{ i + 1 }}</text>
        </g>
      </svg>

      <!-- Magnifier -->
      <canvas
        v-show="magActive"
        ref="magRef"
        class="mc-magnifier"
        :width="MAG_SIZE"
        :height="MAG_SIZE"
        :style="{
          left: `${magX - MAG_SIZE / 2}px`,
          top:  `${magY - MAG_OFFSET - MAG_SIZE / 2}px`,
        }"
      />

      <!-- Floating hint pill -->
      <div class="mc-hint">{{ hintText }}</div>
    </div>

    <!-- ── Bottom action bar ─────────────────────────────────────────── -->
    <div class="mc-bar">
      <button
        class="btn btn-ghost btn-sm"
        :disabled="points.length === 0"
        @click="undo"
      >↩ Desfazer</button>
      <button
        class="btn btn-danger btn-sm"
        :disabled="points.length === 0"
        @click="clearAll"
      >🗑 Limpar</button>
    </div>

    <!-- ── Floating CTA ───────────────────────────────────────────────── -->
    <transition name="cta-pop">
      <button
        v-if="canConfirm"
        class="mc-cta"
        @click="complete"
      >
        {{ mode === 'ruler' ? '📏 Confirmar Distância →' : '📐 Calcular Área →' }}
      </button>
    </transition>

  </div>
</template>

<style scoped>
.mc-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #000;
  position: relative;
}

/* ── Mode bar ──────────────────────────────────────────────────────────── */
.mc-mode-bar {
  display: flex;
  background: var(--bg-800);
  border-bottom: 1px solid var(--bg-700);
  flex-shrink: 0;
}

.mode-tab {
  flex: 1;
  padding: 12px 8px;
  background: none;
  border: none;
  border-bottom: 3px solid transparent;
  color: var(--text-300);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
  -webkit-tap-highlight-color: transparent;
}

.mode-tab.active {
  color: var(--accent-amber);
  border-bottom-color: var(--accent-amber);
}

/* ── Image area ────────────────────────────────────────────────────────── */
.mc-img-wrap {
  flex: 1;
  position: relative;
  overflow: hidden;
  cursor: crosshair;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  display: flex;
  align-items: flex-start;
}

.mc-img {
  display: block;
  width: 100%;
  height: auto;
  user-select: none;
  pointer-events: none;
}

.mc-svg {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  pointer-events: none;
  overflow: visible;
}

/* ── Magnifier ─────────────────────────────────────────────────────────── */
.mc-magnifier {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
}

/* ── Floating hint ─────────────────────────────────────────────────────── */
.mc-hint {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(2,30,45,0.88);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255,183,3,0.5);
  border-radius: 24px;
  padding: 8px 20px;
  font-size: 13px;
  color: var(--text-100);
  white-space: nowrap;
  pointer-events: none;
  z-index: 10;
}

/* ── Bottom bar ────────────────────────────────────────────────────────── */
.mc-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px 16px;
  padding-bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  background: var(--bg-800);
  border-top: 1px solid var(--bg-700);
  flex-shrink: 0;
}

/* ── Floating CTA ──────────────────────────────────────────────────────── */
.mc-cta {
  position: absolute;
  bottom: 72px;
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
.mc-cta:active { transform: translateX(-50%) scale(0.95); }

@keyframes pulse-cta {
  0%, 100% { box-shadow: 0 4px 24px rgba(34,197,94,0.5); }
  50%       { box-shadow: 0 4px 36px rgba(34,197,94,0.85); }
}

.cta-pop-enter-active { transition: opacity 0.25s, transform 0.25s; }
.cta-pop-leave-active { transition: opacity 0.15s; }
.cta-pop-enter-from  { opacity: 0; transform: translateX(-50%) translateY(12px); }
.cta-pop-leave-to    { opacity: 0; }
</style>
