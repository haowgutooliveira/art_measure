<script setup>
import { ref, watch, onMounted, onUnmounted, computed } from 'vue'
import { useCalibration, PRESETS } from '../composables/useCalibration.js'

const props = defineProps({
  imageDataUrl: { type: String, required: true },
})

const emit = defineEmits(['confirm'])

// ─── Calibration state ────────────────────────────────────────────────────
const {
  selectedPreset,
  customSizeCm,
  markerPixelDiameter,
  pixelsPerCm,
  realSizeCm,
  setPreset,
  setCustomSize,
  setMarkerDiameter,
} = useCalibration()

// ─── Canvas & image refs ──────────────────────────────────────────────────
const canvasRef  = ref(null)
const wrapRef    = ref(null)
const imgEl      = new Image()

// Circle state (logical CSS px, relative to the canvas display rect)
const circle = ref({ cx: 150, cy: 150, r: 60 })

// Interaction state
const dragState = ref(null) // null | { type: 'center'|'edge', startX, startY, startCx, startCy, startR }

// ─── Draw ─────────────────────────────────────────────────────────────────
function redraw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const W = canvas.clientWidth
  const H = canvas.clientHeight

  canvas.width  = W * dpr
  canvas.height = H * dpr
  ctx.scale(dpr, dpr)

  // Background image
  if (imgEl.complete && imgEl.naturalWidth) {
    const scale = Math.min(W / imgEl.naturalWidth, H / imgEl.naturalHeight)
    const iw = imgEl.naturalWidth  * scale
    const ih = imgEl.naturalHeight * scale
    const ix = (W - iw) / 2
    const iy = (H - ih) / 2
    ctx.drawImage(imgEl, ix, iy, iw, ih)
  }

  const { cx, cy, r } = circle.value

  // Outer dimming overlay (donut via compositing)
  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // Circle stroke
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.strokeStyle = '#f59e0b'
  ctx.lineWidth = 2.5
  ctx.setLineDash([6, 4])
  ctx.stroke()
  ctx.setLineDash([])

  // Centre crosshair
  ctx.strokeStyle = 'rgba(245,158,11,0.7)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy)
  ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10)
  ctx.stroke()

  // Resize handle (right edge)
  const hx = cx + r
  ctx.beginPath()
  ctx.arc(hx, cy, 10, 0, Math.PI * 2)
  ctx.fillStyle = '#f59e0b'
  ctx.fill()
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Diameter label
  const diameter = r * 2
  setMarkerDiameter(diameter)
  ctx.fillStyle = '#f59e0b'
  ctx.font = `bold 13px -apple-system, sans-serif`
  ctx.textAlign = 'center'
  const labelText = `⌀ ${(realSizeCm.value).toFixed(2)} cm`
  ctx.fillText(labelText, cx, cy + r + 22)
}

// ─── Load image, then draw ────────────────────────────────────────────────
function initCanvas() {
  const wrap = wrapRef.value
  if (!wrap) return
  const { width, height } = wrap.getBoundingClientRect()
  circle.value = { cx: width / 2, cy: height / 2, r: Math.min(width, height) * 0.2 }
  redraw()
}

imgEl.onload = () => redraw()

onMounted(() => {
  imgEl.src = props.imageDataUrl
  window.addEventListener('resize', initCanvas)
  initCanvas()
})

onUnmounted(() => {
  window.removeEventListener('resize', initCanvas)
})

watch(() => props.imageDataUrl, (src) => { imgEl.src = src })

watch([circle, selectedPreset, customSizeCm], redraw, { deep: true })

// ─── Pointer helpers ──────────────────────────────────────────────────────
function getCanvasXY(e) {
  const rect = canvasRef.value.getBoundingClientRect()
  const src  = e.touches ? e.touches[0] : e
  return { x: src.clientX - rect.left, y: src.clientY - rect.top }
}

function distanceTo(px, py, cx, cy) {
  return Math.hypot(px - cx, py - cy)
}

function onPointerDown(e) {
  e.preventDefault()
  const { x, y } = getCanvasXY(e)
  const { cx, cy, r } = circle.value
  const dist = distanceTo(x, y, cx, cy)

  // Inside resize handle?
  const hx = cx + r
  if (Math.hypot(x - hx, y - cy) < 16) {
    dragState.value = { type: 'edge', startX: x, startY: y, startR: r, startCx: cx, startCy: cy }
    return
  }
  // Inside circle centre area?
  if (dist < r * 0.6) {
    dragState.value = { type: 'center', startX: x, startY: y, startCx: cx, startCy: cy }
    return
  }
  // On circle boundary → resize
  if (Math.abs(dist - r) < 20) {
    dragState.value = { type: 'edge', startX: x, startY: y, startR: r, startCx: cx, startCy: cy }
  }
}

function onPointerMove(e) {
  if (!dragState.value) return
  e.preventDefault()
  const { x, y } = getCanvasXY(e)
  const ds = dragState.value

  if (ds.type === 'center') {
    circle.value = {
      ...circle.value,
      cx: ds.startCx + (x - ds.startX),
      cy: ds.startCy + (y - ds.startY),
    }
  } else {
    const newR = distanceTo(x, y, ds.startCx, ds.startCy)
    circle.value = { ...circle.value, r: Math.max(20, newR) }
  }
}

function onPointerUp() {
  dragState.value = null
}

// ─── Confirm ──────────────────────────────────────────────────────────────
function confirm() {
  emit('confirm', pixelsPerCm.value)
}
</script>

<template>
  <div class="cal-wrap" ref="wrapRef">
    <!-- Canvas overlay -->
    <canvas
      ref="canvasRef"
      class="cal-canvas"
      @mousedown="onPointerDown"
      @mousemove="onPointerMove"
      @mouseup="onPointerUp"
      @mouseleave="onPointerUp"
      @touchstart.passive="onPointerDown"
      @touchmove.prevent="onPointerMove"
      @touchend="onPointerUp"
    />

    <!-- Bottom control panel -->
    <div class="cal-panel">
      <p class="cal-hint">
        Arraste o círculo sobre o objeto de referência e ajuste a borda para coincidir.
      </p>

      <!-- Preset selector -->
      <div class="preset-grid">
        <button
          v-for="preset in PRESETS"
          :key="preset.id"
          class="preset-btn"
          :class="{ active: selectedPreset.id === preset.id }"
          @click="setPreset(preset)"
        >
          {{ preset.label }}
        </button>
      </div>

      <!-- Custom size input -->
      <div v-if="selectedPreset.id === 'custom'" class="custom-row">
        <label for="customCm">Tamanho real (cm)</label>
        <input
          id="customCm"
          class="input"
          type="number"
          min="0.1"
          step="0.1"
          :value="customSizeCm"
          @input="setCustomSize(Number($event.target.value))"
        />
      </div>

      <!-- Scale info -->
      <div class="scale-info">
        <span class="scale-label">Escala calculada:</span>
        <span class="scale-val">{{ pixelsPerCm.toFixed(1) }} px/cm</span>
      </div>

      <button class="btn btn-green btn-full" @click="confirm">
        ✓ Confirmar Escala
      </button>
    </div>
  </div>
</template>

<style scoped>
.cal-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  background: #000;
}

.cal-canvas {
  flex: 1;
  width: 100%;
  display: block;
  touch-action: none;
  cursor: crosshair;
}

.cal-panel {
  background: var(--bg-800);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-top: 1px solid var(--bg-700);
}

.cal-hint {
  font-size: 12px;
  color: var(--text-300);
  text-align: center;
  line-height: 1.4;
}

.preset-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.preset-btn {
  flex: 1;
  min-width: 110px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--bg-600);
  background: var(--bg-700);
  color: var(--text-300);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  -webkit-tap-highlight-color: transparent;
}

.preset-btn.active {
  border-color: var(--accent-amber);
  color: var(--accent-amber);
  background: rgba(245,158,11,0.1);
}

.custom-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.scale-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: var(--bg-700);
  border-radius: var(--radius-sm);
}

.scale-label { font-size: 12px; color: var(--text-300); }
.scale-val   { font-size: 14px; font-weight: 700; color: var(--accent-green); }
</style>
