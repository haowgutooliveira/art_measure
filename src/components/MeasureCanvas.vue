<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { computeDistanceCm, computeEffectivePpc, polygonCentroid } from '../composables/useMeasurement.js'
import { useShoelaceArea } from '../composables/useShoelaceArea.js'

const props = defineProps({
  imageDataUrl: { type: String, required: true },
  pixelsPerCm:  { type: Number, default: 1 },
})
const emit = defineEmits(['complete'])

// ─── Image ────────────────────────────────────────────────────────────────
const imgRef  = ref(null)
const dispW   = ref(300)
const dispH   = ref(400)
// ppc in display-px/cm, recomputed whenever img dimensions change
const displayPpc = ref(1)

function updateDisplayPpc() {
  if (mode.value === 'ruler') {
    const img = imgRef.value
    if (!img || !img.clientWidth || !img.naturalWidth) return
    dispW.value = img.clientWidth
    dispH.value = img.clientHeight
    displayPpc.value = computeEffectivePpc(props.pixelsPerCm, img.naturalWidth, img.clientWidth)
  } else {
    // Freehand: canvas uses cover-fit (Math.max scale) — match redraw() scaling
    const canvas = canvasRef.value
    const img    = imgRef.value          // hidden img — naturalWidth is correct regardless of CSS size
    if (!canvas || !img || !img.naturalWidth) return
    const W = canvas.clientWidth || 0
    const H = canvas.clientHeight || 0
    if (!W || !H) return
    const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight)
    displayPpc.value = props.pixelsPerCm * scale
  }
}

onMounted(async () => {
  await nextTick()
  updateDisplayPpc()
  window.addEventListener('resize', updateDisplayPpc)
})
onUnmounted(() => window.removeEventListener('resize', updateDisplayPpc))
watch(() => props.pixelsPerCm, updateDisplayPpc)

// ─── Mode ─────────────────────────────────────────────────────────────────
const mode = ref('freehand')   // 'ruler' | 'freehand'

// Re-compute ppc whenever mode changes (ruler uses imgRef.clientWidth, freehand uses canvas)
watch(mode, async () => { await nextTick(); updateDisplayPpc() })

function setMode(m) {
  if (mode.value === m) return
  mode.value = m
  clearAll()
}

// ══════════════════════════════════════════════════════════════════════════
// RULER MODE — tap A, drag B, live badge
// ══════════════════════════════════════════════════════════════════════════

const rulerA    = ref(null)   // { x, y } fixed
const rulerB    = ref(null)   // { x, y } fixed (after touchend)
const rulerLive = ref(null)   // { x, y } live while dragging (before touchend)

// The "active" B for display: live position while dragging, final otherwise
const rulerBActive = computed(() => rulerLive.value ?? rulerB.value)

const rulerDist = computed(() => {
  if (!rulerA.value || !rulerBActive.value || displayPpc.value <= 0) return null
  return computeDistanceCm(rulerA.value, rulerBActive.value, displayPpc.value)
})

const rulerMid = computed(() => {
  if (!rulerA.value || !rulerBActive.value) return null
  return {
    x: (rulerA.value.x + rulerBActive.value.x) / 2,
    y: (rulerA.value.y + rulerBActive.value.y) / 2,
  }
})

const rulerCanConfirm = computed(() => rulerA.value && rulerB.value)

// ══════════════════════════════════════════════════════════════════════════
// FREEHAND MODE — strokes + quadratic curves + magnifier
// ══════════════════════════════════════════════════════════════════════════

const canvasRef = ref(null)
const wrapRef   = ref(null)
const strokes   = ref([])      // array of Point[] arrays
const isClosed  = ref(false)
const isDrawing = ref(false)

// Magnifier state
const mag = ref({ visible: false, x: 0, y: 0 })
const MAG_SIZE   = 110
const MAG_OFFSET = 130
const MAG_SCALE  = 2.2

// All points flattened across strokes
const allPoints = computed(() => strokes.value.flat())

// Area calculation via shoelace (using displayPpc for display-px point space)
const { areaCm2, boundingBox } = useShoelaceArea(allPoints, displayPpc)

// ─── Canvas setup ─────────────────────────────────────────────────────────
function resizeCanvas() {
  const wrap = wrapRef.value
  if (!wrap) return
  const rect = wrap.getBoundingClientRect()
  const canvas = canvasRef.value
  if (!canvas) return
  const dpr = window.devicePixelRatio || 1
  canvas.width  = rect.width  * dpr
  canvas.height = rect.height * dpr
  updateDisplayPpc()   // canvas dimensions just changed — recompute scale
  redraw()
}

function redraw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const W = canvas.clientWidth
  const H = canvas.clientHeight

  ctx.save()
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, W, H)

  // Background image
  const img = imgRef.value
  if (img && img.complete && img.naturalWidth) {
    const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight)
    const iw = img.naturalWidth  * scale
    const ih = img.naturalHeight * scale
    const ix = (W - iw) / 2
    const iy = (H - ih) / 2
    ctx.drawImage(img, ix, iy, iw, ih)
  }

  // Draw strokes
  strokes.value.forEach(pts => {
    if (pts.length < 2) return
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2
      const my = (pts[i].y + pts[i + 1].y) / 2
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
    ctx.strokeStyle = '#ef4444'
    ctx.lineWidth   = 2.5
    ctx.lineJoin    = 'round'
    ctx.lineCap     = 'round'
    ctx.stroke()
  })

  // Closed fill + closing edge
  if (isClosed.value && allPoints.value.length >= 3) {
    const pts = allPoints.value
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    pts.forEach(p => ctx.lineTo(p.x, p.y))
    ctx.closePath()
    ctx.fillStyle = 'rgba(239,68,68,0.22)'
    ctx.fill()
    const last = pts[pts.length - 1]
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(pts[0].x, pts[0].y)
    ctx.strokeStyle = '#ef4444'
    ctx.lineWidth   = 2.5
    ctx.setLineDash([6, 4])
    ctx.stroke()
    ctx.setLineDash([])

    // ── Live measurement annotations ──────────────────────────────────────
    const ppc = displayPpc.value
    if (ppc > 0) {
      const xs   = pts.map(p => p.x), ys = pts.map(p => p.y)
      const minX = Math.min(...xs), maxX = Math.max(...xs)
      const minY = Math.min(...ys), maxY = Math.max(...ys)
      const wCm  = ((maxX - minX) / ppc).toFixed(1)
      const hCm  = ((maxY - minY) / ppc).toFixed(1)
      let sum = 0
      pts.forEach((p, i) => { const j = (i + 1) % pts.length; sum += p.x * pts[j].y - pts[j].x * p.y })
      const aCm = (Math.abs(sum) / 2 / (ppc * ppc)).toFixed(1)

      const PAD = 24, TIP = 5
      const wyLine = Math.max(PAD, minY - PAD)
      const hxLine = Math.min(W - PAD, maxX + PAD)

      // Extension lines
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'
      ctx.lineWidth   = 0.8
      ctx.setLineDash([3, 4])
      ctx.beginPath()
      ctx.moveTo(minX, minY); ctx.lineTo(minX, wyLine)
      ctx.moveTo(maxX, minY); ctx.lineTo(maxX, wyLine)
      ctx.moveTo(maxX, minY); ctx.lineTo(hxLine, minY)
      ctx.moveTo(maxX, maxY); ctx.lineTo(hxLine, maxY)
      ctx.stroke()
      ctx.setLineDash([])

      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth   = 1.5

      // Width arrow (horizontal)
      ctx.beginPath()
      ctx.moveTo(minX, wyLine); ctx.lineTo(maxX, wyLine)
      ctx.moveTo(minX, wyLine); ctx.lineTo(minX + TIP, wyLine - TIP * 0.6)
      ctx.moveTo(minX, wyLine); ctx.lineTo(minX + TIP, wyLine + TIP * 0.6)
      ctx.moveTo(maxX, wyLine); ctx.lineTo(maxX - TIP, wyLine - TIP * 0.6)
      ctx.moveTo(maxX, wyLine); ctx.lineTo(maxX - TIP, wyLine + TIP * 0.6)
      ctx.stroke()

      // Height arrow (vertical)
      ctx.beginPath()
      ctx.moveTo(hxLine, minY); ctx.lineTo(hxLine, maxY)
      ctx.moveTo(hxLine, minY); ctx.lineTo(hxLine - TIP * 0.6, minY + TIP)
      ctx.moveTo(hxLine, minY); ctx.lineTo(hxLine + TIP * 0.6, minY + TIP)
      ctx.moveTo(hxLine, maxY); ctx.lineTo(hxLine - TIP * 0.6, maxY - TIP)
      ctx.moveTo(hxLine, maxY); ctx.lineTo(hxLine + TIP * 0.6, maxY - TIP)
      ctx.stroke()

      // Badge helper
      function liveBadge(text, x, y, big = false) {
        const fs = big ? 15 : 12
        ctx.font = `bold ${fs}px system-ui, sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        const tw = ctx.measureText(text).width
        const bw = tw + fs * 1.4, bh = fs * 1.9, br = bh * 0.35
        ctx.fillStyle = big ? 'rgba(15,23,42,0.90)' : 'rgba(15,23,42,0.84)'
        ctx.beginPath(); ctx.roundRect(x - bw / 2, y - bh / 2, bw, bh, br); ctx.fill()
        ctx.fillStyle = big ? '#fff' : '#f59e0b'
        ctx.fillText(text, x, y)
      }

      liveBadge(`${wCm} cm`,  (minX + maxX) / 2, wyLine)
      liveBadge(`${hCm} cm`,  hxLine + 28,        (minY + maxY) / 2)
      liveBadge(`${aCm} cm²`, (minX + maxX) / 2,  (minY + maxY) / 2, true)
    }
  }

  // Start-point dot (green)
  if (allPoints.value.length > 0 && !isClosed.value) {
    const p = allPoints.value[0]
    ctx.beginPath()
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2)
    ctx.fillStyle   = '#22c55e'
    ctx.fill()
    ctx.strokeStyle = '#fff'
    ctx.lineWidth   = 1.5
    ctx.stroke()
  }

  ctx.restore()
}

function drawMagnifier(touchX, touchY) {
  if (!mag.value.visible) return
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx  = canvas.getContext('2d')
  const dpr  = window.devicePixelRatio || 1
  const half = MAG_SIZE / 2
  const capture = MAG_SIZE / MAG_SCALE
  const mx = touchX - half
  const my = touchY - MAG_OFFSET - half

  ctx.save()
  ctx.scale(dpr, dpr)
  ctx.beginPath()
  ctx.arc(mx + half, my + half, half, 0, Math.PI * 2)
  ctx.clip()
  ctx.drawImage(
    canvas,
    (touchX - capture / 2) * dpr, (touchY - capture / 2) * dpr,
    capture * dpr, capture * dpr,
    mx, my, MAG_SIZE, MAG_SIZE,
  )
  ctx.beginPath()
  ctx.arc(mx + half, my + half, half, 0, Math.PI * 2)
  ctx.strokeStyle = '#f59e0b'
  ctx.lineWidth   = 2.5
  ctx.stroke()
  ctx.strokeStyle = 'rgba(239,68,68,0.9)'
  ctx.lineWidth   = 1.2
  const cx = mx + half, cy = my + half
  ctx.beginPath()
  ctx.moveTo(cx - 12, cy); ctx.lineTo(cx + 12, cy)
  ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy + 12)
  ctx.stroke()
  ctx.restore()
}

// ─── Shared pointer helpers ────────────────────────────────────────────────
function getXY(e, refEl) {
  const rect = refEl.getBoundingClientRect()
  const src  = (e.changedTouches || e.touches) ? (e.changedTouches?.[0] ?? e.touches[0]) : e
  return {
    x: Math.max(0, Math.min(src.clientX - rect.left, refEl.clientWidth)),
    y: Math.max(0, Math.min(src.clientY - rect.top,  refEl.clientHeight)),
  }
}

// ─── Ruler touch handlers ──────────────────────────────────────────────────
function onRulerTouchStart(e) {
  e.preventDefault()
  updateDisplayPpc()   // ensure latest scale before any calculation
  const { x, y } = getXY(e, imgRef.value)
  if (!rulerA.value) {
    rulerA.value    = { x, y }
    rulerB.value    = null
    rulerLive.value = null
  } else if (!rulerB.value) {
    rulerLive.value = { x, y }
  }
}

function onRulerTouchMove(e) {
  if (!rulerA.value || rulerB.value) return
  e.preventDefault()
  const { x, y } = getXY(e, imgRef.value)
  rulerLive.value = { x, y }
}

function onRulerTouchEnd(e) {
  if (!rulerA.value || rulerB.value) return
  e.preventDefault()
  const { x, y } = getXY(e, imgRef.value)
  rulerB.value    = { x, y }
  rulerLive.value = null
}

function onRulerClick(e) {
  updateDisplayPpc()
  const { x, y } = getXY(e, imgRef.value)
  if (!rulerA.value) {
    rulerA.value = { x, y }
  } else if (!rulerB.value) {
    rulerB.value = { x, y }
  }
}

// ─── Freehand touch handlers ───────────────────────────────────────────────
function freehandGetXY(e) { return getXY(e, canvasRef.value) }

function onPointerDown(e) {
  if (isClosed.value) return
  e.preventDefault()
  isDrawing.value = true
  const { x, y } = freehandGetXY(e)
  strokes.value.push([{ x, y }])
  mag.value = { visible: true, x, y }
  redraw(); drawMagnifier(x, y)
}

function onPointerMove(e) {
  if (!isDrawing.value) return
  e.preventDefault()
  const { x, y } = freehandGetXY(e)
  const current = strokes.value[strokes.value.length - 1]
  const last = current[current.length - 1]
  if (Math.hypot(x - last.x, y - last.y) > 3) current.push({ x, y })
  mag.value = { visible: true, x, y }
  redraw(); drawMagnifier(x, y)
}

function onPointerUp(e) {
  if (!isDrawing.value) return
  e.preventDefault()
  isDrawing.value = false
  mag.value = { ...mag.value, visible: false }
  redraw()
}

// ─── Actions ──────────────────────────────────────────────────────────────
function clearAll() {
  // ruler
  rulerA.value = null; rulerB.value = null; rulerLive.value = null
  // freehand
  strokes.value = []; isClosed.value = false
  redraw()
}

function undoRuler() {
  if (rulerB.value) { rulerB.value = null }
  else { rulerA.value = null }
}

function undoFreehand() {
  if (isClosed.value) { isClosed.value = false }
  else if (strokes.value.length > 0) { strokes.value.pop() }
  redraw()
}

function closeArea() {
  if (allPoints.value.length < 3) return
  isClosed.value = true
  redraw()
}

// ─── canConfirm ───────────────────────────────────────────────────────────
const canConfirm = computed(() =>
  mode.value === 'ruler'
    ? rulerCanConfirm.value
    : allPoints.value.length >= 3,
)

// ─── Snapshot ─────────────────────────────────────────────────────────────
function generateSnapshot() {
  const img = imgRef.value
  if (!img || !img.naturalWidth) return null

  const nw = img.naturalWidth
  const nh = img.naturalHeight
  const sc = nw / (img.clientWidth || 1)   // display-px → image-px

  const off = document.createElement('canvas')
  off.width = nw; off.height = nh
  const ctx = off.getContext('2d')
  ctx.drawImage(img, 0, 0, nw, nh)

  const ppc = props.pixelsPerCm   // image-px/cm

  if (mode.value === 'ruler' && rulerA.value && rulerB.value) {
    const A = { x: rulerA.value.x * sc, y: rulerA.value.y * sc }
    const B = { x: rulerB.value.x * sc, y: rulerB.value.y * sc }
    const dist = computeDistanceCm(A, B, ppc)

    // Line
    ctx.beginPath()
    ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y)
    ctx.strokeStyle = '#FFB703'
    ctx.lineWidth   = Math.max(3, nw / 300)
    ctx.stroke()

    // Endpoint dots
    ;[A, B].forEach(p => {
      ctx.beginPath()
      ctx.arc(p.x, p.y, Math.max(14, nw / 180), 0, Math.PI * 2)
      ctx.fillStyle = '#FFB703'; ctx.fill()
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke()
    })

    // Central badge
    const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2
    const lbl = `${dist.toFixed(1)} cm`
    const fs  = Math.max(18, nw / 130)
    ctx.font = `bold ${fs}px system-ui, sans-serif`
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    const tw = ctx.measureText(lbl).width
    const bw = tw + fs * 2, bh = fs * 2.6, br = bh / 2
    ctx.fillStyle = 'rgba(15,23,42,0.88)'
    ctx.beginPath(); ctx.roundRect(mx - bw/2, my - bh/2, bw, bh, br); ctx.fill()
    ctx.fillStyle = '#FFB703'; ctx.fillText(lbl, mx, my)

  } else if (mode.value === 'freehand') {
    const pts = allPoints.value.map(p => ({ x: p.x * sc, y: p.y * sc }))
    if (pts.length < 2) return off.toDataURL('image/jpeg', 0.92)

    // Polygon
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    pts.forEach(p => ctx.lineTo(p.x, p.y))
    ctx.closePath()
    ctx.fillStyle = 'rgba(239,68,68,0.20)'; ctx.fill()
    ctx.strokeStyle = '#ef4444'
    ctx.lineWidth = Math.max(2, nw / 400)
    ctx.stroke()

    // Bounding box + area badge
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const widthCm  = ((maxX - minX) / ppc).toFixed(1)
    const heightCm = ((maxY - minY) / ppc).toFixed(1)
    let sum = 0
    pts.forEach((p, i) => { const j = (i+1) % pts.length; sum += p.x*pts[j].y - pts[j].x*p.y })
    const areaVal = (Math.abs(sum) / 2 / (ppc * ppc)).toFixed(1)

    const PAD = Math.max(30, nw / 40)
    const TIP = 7
    const wyLine = Math.max(PAD, minY - PAD)
    const hxLine = Math.min(nw - PAD, maxX + PAD)

    // Extension lines
    ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 0.8; ctx.setLineDash([3,4])
    ctx.beginPath()
    ctx.moveTo(minX, minY); ctx.lineTo(minX, wyLine)
    ctx.moveTo(maxX, minY); ctx.lineTo(maxX, wyLine)
    ctx.moveTo(maxX, minY); ctx.lineTo(hxLine, minY)
    ctx.moveTo(maxX, maxY); ctx.lineTo(hxLine, maxY)
    ctx.stroke(); ctx.setLineDash([])

    function arrowH(x1, y, x2) {
      ctx.beginPath()
      ctx.moveTo(x1,y); ctx.lineTo(x2,y)
      ctx.moveTo(x1,y); ctx.lineTo(x1+TIP, y-TIP*0.55); ctx.moveTo(x1,y); ctx.lineTo(x1+TIP, y+TIP*0.55)
      ctx.moveTo(x2,y); ctx.lineTo(x2-TIP, y-TIP*0.55); ctx.moveTo(x2,y); ctx.lineTo(x2-TIP, y+TIP*0.55)
      ctx.stroke()
    }
    function arrowV(x, y1, y2) {
      ctx.beginPath()
      ctx.moveTo(x,y1); ctx.lineTo(x,y2)
      ctx.moveTo(x,y1); ctx.lineTo(x-TIP*0.55,y1+TIP); ctx.moveTo(x,y1); ctx.lineTo(x+TIP*0.55,y1+TIP)
      ctx.moveTo(x,y2); ctx.lineTo(x-TIP*0.55,y2-TIP); ctx.moveTo(x,y2); ctx.lineTo(x+TIP*0.55,y2-TIP)
      ctx.stroke()
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5
    arrowH(minX, wyLine, maxX); arrowV(hxLine, minY, maxY)

    function badge(text, x, y, big = false) {
      const fs = big ? Math.max(14, nw / 170) : Math.max(11, nw / 230)
      ctx.font = `bold ${fs}px system-ui, sans-serif`
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      const tw = ctx.measureText(text).width
      const bw = tw + fs*1.4, bh = fs*1.9, br = bh*0.35
      ctx.fillStyle = big ? 'rgba(15,23,42,0.88)' : 'rgba(15,23,42,0.84)'
      ctx.beginPath(); ctx.roundRect(x-bw/2,y-bh/2,bw,bh,br); ctx.fill()
      ctx.fillStyle = big ? '#fff' : '#f59e0b'
      ctx.fillText(text, x, y)
    }

    badge(`${widthCm} cm`, (minX+maxX)/2, wyLine)
    badge(`${heightCm} cm`, hxLine+22, (minY+maxY)/2)
    badge(`${areaVal} cm²`, (minX+maxX)/2, (minY+maxY)/2, true)
  }

  return off.toDataURL('image/jpeg', 0.92)
}

// ─── Confirm ──────────────────────────────────────────────────────────────
function complete() {
  if (mode.value === 'freehand') closeArea()
  const snapshotUrl = generateSnapshot()
  if (mode.value === 'ruler') {
    emit('complete', {
      mode: 'ruler',
      distanceCm: rulerDist.value,
      points: [rulerA.value, rulerB.value],
      snapshotUrl,
    })
  } else {
    emit('complete', { mode: 'polygon', points: allPoints.value, snapshotUrl })
  }
}

// ─── Lifecycle (freehand canvas) ──────────────────────────────────────────
const bgImage = new Image()
bgImage.onload = () => { if (mode.value === 'freehand') redraw() }

onMounted(async () => {
  bgImage.src = props.imageDataUrl
  await nextTick()
  resizeCanvas()
  window.addEventListener('resize', resizeCanvas)
})
watch(() => props.imageDataUrl, src => { bgImage.src = src })

// Redraw when strokes change; recompute ppc on close (needs displayPpc for annotations)
watch([strokes, isClosed], () => {
  if (mode.value !== 'freehand') return
  if (isClosed.value) updateDisplayPpc()
  redraw()
}, { deep: true })

// ─── Hint ─────────────────────────────────────────────────────────────────
const hintText = computed(() => {
  if (mode.value === 'ruler') {
    if (!rulerA.value) return 'Toque no ponto A'
    if (!rulerB.value) return 'Arraste ou toque no ponto B'
    return `${rulerDist.value?.toFixed(1) ?? '—'} cm — confirme abaixo`
  }
  if (allPoints.value.length === 0) return 'Risque o contorno da área'
  if (isClosed.value) return `Área: ${areaCm2.value.toFixed(1)} cm² — confirme abaixo`
  return 'Continue riscando — levante o dedo para reposicionar'
})
</script>

<template>
  <div class="mc-wrap">

    <!-- ── Mode tabs ─────────────────────────────────────────────────── -->
    <div class="mc-mode-bar">
      <button class="mode-tab" :class="{ active: mode === 'ruler' }"    @click="setMode('ruler')">📏 Fita métrica</button>
      <button class="mode-tab" :class="{ active: mode === 'freehand' }" @click="setMode('freehand')">✏️ Desenhar área</button>
    </div>

    <!-- ══ RULER MODE ════════════════════════════════════════════════════ -->
    <template v-if="mode === 'ruler'">
      <div
        class="mc-img-wrap"
        @mousedown="onRulerClick"
        @touchstart.prevent="onRulerTouchStart"
        @touchmove.prevent="onRulerTouchMove"
        @touchend.prevent="onRulerTouchEnd"
      >
        <img ref="imgRef" :src="imageDataUrl" class="mc-img" draggable="false" @load="updateDisplayPpc" alt="" />

        <svg
          class="mc-svg"
          :viewBox="`0 0 ${dispW} ${dispH}`"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
        >
          <!-- Line A→B (live while dragging) -->
          <line
            v-if="rulerA && rulerBActive"
            :x1="rulerA.x" :y1="rulerA.y"
            :x2="rulerBActive.x" :y2="rulerBActive.y"
            stroke="#FFB703" stroke-width="2.5" stroke-linecap="round"
          />

          <!-- Central distance badge (live) -->
          <g v-if="rulerMid && rulerDist !== null">
            <rect
              :x="rulerMid.x - 46" :y="rulerMid.y - 18"
              width="92" height="36" rx="18"
              fill="rgba(15,23,42,0.90)"
            />
            <text
              :x="rulerMid.x" :y="rulerMid.y"
              text-anchor="middle" dominant-baseline="central"
              fill="#FFB703" font-size="16" font-weight="bold" font-family="system-ui, sans-serif"
            >{{ rulerDist.toFixed(1) }} cm</text>
          </g>

          <!-- Point A -->
          <g v-if="rulerA">
            <circle :cx="rulerA.x" :cy="rulerA.y" r="16" fill="#FFB703" stroke="white" stroke-width="2.5"/>
            <text :x="rulerA.x" :y="rulerA.y" text-anchor="middle" dominant-baseline="central"
              fill="#023047" font-weight="bold" font-size="13" font-family="system-ui, sans-serif">A</text>
          </g>

          <!-- Point B (fixed) or live B -->
          <g v-if="rulerBActive">
            <circle :cx="rulerBActive.x" :cy="rulerBActive.y" r="16"
              :fill="rulerLive ? 'rgba(255,183,3,0.7)' : '#FFB703'"
              stroke="white" stroke-width="2.5"/>
            <text :x="rulerBActive.x" :y="rulerBActive.y" text-anchor="middle" dominant-baseline="central"
              fill="#023047" font-weight="bold" font-size="13" font-family="system-ui, sans-serif">B</text>
          </g>
        </svg>

        <div class="mc-hint">{{ hintText }}</div>
      </div>

      <!-- Bottom bar ruler -->
      <div class="mc-bar">
        <button class="btn btn-ghost btn-sm" :disabled="!rulerA" @click="undoRuler">↩ Desfazer</button>
        <button class="btn btn-danger btn-sm" :disabled="!rulerA" @click="clearAll">🗑 Limpar</button>
      </div>
    </template>

    <!-- ══ FREEHAND MODE ══════════════════════════════════════════════════ -->
    <template v-else>
      <div class="mc-wrap-inner" ref="wrapRef">
        <!-- Hidden img for snapshot (keeps proportions for drawImage) -->
        <img ref="imgRef" :src="imageDataUrl" class="mc-img-hidden" draggable="false" @load="() => { updateDisplayPpc(); redraw() }" alt="" />

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

        <!-- Hint when empty -->
        <div v-if="allPoints.length === 0 && !isDrawing" class="tc-hint">
          <div class="tc-hint-box">
            <span class="tc-hint-icon">✏️</span>
            <span>Risque o contorno da área da arte</span>
            <span class="tc-hint-sub">Levante o dedo para reposicionar</span>
          </div>
        </div>
      </div>

      <!-- Bottom bar freehand -->
      <div class="mc-bar">
        <button class="btn btn-ghost btn-sm" :disabled="allPoints.length === 0" @click="undoFreehand">↩ Desfazer traço</button>
        <button class="btn btn-danger btn-sm" :disabled="allPoints.length === 0" @click="clearAll">🗑 Limpar tudo</button>
      </div>
    </template>

    <!-- ── Floating CTA (both modes) ──────────────────────────────────── -->
    <transition name="cta-pop">
      <button v-if="canConfirm" class="mc-cta" @click="complete">
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
.mode-tab.active { color: var(--accent-amber); border-bottom-color: var(--accent-amber); }

/* ── Ruler: image wrapper ──────────────────────────────────────────────── */
.mc-img-wrap {
  flex: 1;
  position: relative;
  touch-action: none;
  -webkit-tap-highlight-color: transparent;
  cursor: crosshair;
  overflow: hidden;
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

/* ── Freehand: canvas wrapper ──────────────────────────────────────────── */
.mc-wrap-inner {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #000;
}
.mc-img-hidden {
  /* Hidden reference for drawImage in generateSnapshot */
  position: absolute;
  width: 1px; height: 1px;
  opacity: 0;
  pointer-events: none;
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
.tc-hint-sub  { font-size: 11px; color: var(--bg-600); margin-top: 2px; }

/* ── Shared: hint pill ─────────────────────────────────────────────────── */
.mc-hint {
  position: absolute;
  top: 12px;
  left: 50%; transform: translateX(-50%);
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
  left: 50%; transform: translateX(-50%);
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
