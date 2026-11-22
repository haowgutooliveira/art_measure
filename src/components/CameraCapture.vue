<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'

const emit = defineEmits(['captured'])

const H_FOV_RAD = (65 * Math.PI) / 180

// ─── Camera state ─────────────────────────────────────────────────────────────
const camState    = ref('loading')   // loading | ready | error
const camError    = ref('')
const isFlashing  = ref(false)
const videoRef    = ref(null)
const hiddenCanvas = ref(null)
const overlayRef  = ref(null)
let   stream      = null

// ─── Reference ring ───────────────────────────────────────────────────────────
// The ring = 10 cm reference. pixelsPerCm = (ringR * 2 * scale) / 10.
// User moves it (1-finger drag) and resizes it (2-finger pinch).
const ringX = ref(0)   // centre x in CSS px — set on mount
const ringY = ref(0)   // centre y in CSS px
const ringR = ref(60)  // radius in CSS px

// Estimated distance from ring size using pinhole model:
//   distCm = focalLength_css * 10cm / ringDiamCss
//   focalLength_css = screenWidth / (2 * tan(H_FOV/2))
const estimatedDistCm = computed(() => {
  const sw = window.innerWidth
  const focalCss = sw / (2 * Math.tan(H_FOV_RAD / 2))
  const d = Math.round(focalCss * 10 / (ringR.value * 2))
  return d
})

const distDisplay = computed(() => {
  const d = estimatedDistCm.value
  if (d < 100) return `${d} cm`
  return `${(d / 100).toFixed(1)} m`
})

// drag / pinch bookkeeping
let dragActive    = false
let dragOffX = 0, dragOffY = 0
let pinchActive   = false
let pinchStartD   = 0
let pinchStartR   = 0

// ─── OS recovery ──────────────────────────────────────────────────────────────
function recoveryMsg() {
  const ua = navigator.userAgent
  if (/iPhone|iPad/.test(ua)) return 'Ajustes → Safari → Câmera → Permitir'
  if (/Android/.test(ua))     return 'Configurações → Apps → Chrome → Permissões → Câmera'
  return 'Verifique as permissões de câmera nas configurações do navegador.'
}

// ─── Camera init ──────────────────────────────────────────────────────────────
async function startCamera() {
  camState.value = 'loading'
  camError.value = ''
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    })
    camState.value = 'ready'
    await nextTick()
    videoRef.value.srcObject = stream
    await videoRef.value.play()
  } catch (err) {
    camState.value = 'error'
    camError.value = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
      ? 'Permissão de câmera negada.'
      : err.name === 'NotFoundError'
        ? 'Nenhuma câmera encontrada neste dispositivo.'
        : 'Não foi possível acessar a câmera.'
  }
}

function stopCamera() {
  stream?.getTracks().forEach(t => t.stop())
  stream = null
}

// ─── Capture ──────────────────────────────────────────────────────────────────
function capture() {
  isFlashing.value = true
  setTimeout(() => { isFlashing.value = false }, 300)

  const video  = videoRef.value
  const canvas = hiddenCanvas.value
  const W = video.videoWidth || 1920
  const H = video.videoHeight || 1080

  canvas.width = W; canvas.height = H
  canvas.getContext('2d').drawImage(video, 0, 0, W, H)

  // Map CSS ring diameter to actual image pixels.
  // object-fit:cover scales the video so it fills the screen;
  // the larger of (W/screenW, H/screenH) is the CSS→video scale factor.
  const sW = overlayRef.value?.clientWidth  || window.innerWidth
  const sH = overlayRef.value?.clientHeight || window.innerHeight
  const scale = Math.max(W / sW, H / sH)

  const diamPx      = ringR.value * 2 * scale   // ring diameter in real image pixels
  const pixelsPerCm = diamPx / 10               // ring = 10 cm

  setTimeout(() => {
    camState.value = 'done'
    stopCamera()
    emit('captured', { imageDataUrl: canvas.toDataURL('image/jpeg', 0.92), pixelsPerCm, distanceCm: null })
  }, 220)
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────
onMounted(() => {
  ringX.value = window.innerWidth  / 2
  ringY.value = window.innerHeight / 2
  ringR.value = Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.22)
  startCamera()
})
onUnmounted(stopCamera)

// ─── Gesture handlers ─────────────────────────────────────────────────────────
function onTouchStart(e) {
  if (e.touches.length === 1) {
    dragActive = true
    pinchActive = false
    dragOffX = e.touches[0].clientX - ringX.value
    dragOffY = e.touches[0].clientY - ringY.value
  } else if (e.touches.length >= 2) {
    dragActive = false
    pinchActive = true
    const dx = e.touches[0].clientX - e.touches[1].clientX
    const dy = e.touches[0].clientY - e.touches[1].clientY
    pinchStartD = Math.sqrt(dx * dx + dy * dy)
    pinchStartR = ringR.value
  }
}

function onTouchMove(e) {
  e.preventDefault()
  if (dragActive && e.touches.length === 1) {
    ringX.value = e.touches[0].clientX - dragOffX
    ringY.value = e.touches[0].clientY - dragOffY
  } else if (pinchActive && e.touches.length >= 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX
    const dy = e.touches[0].clientY - e.touches[1].clientY
    const d   = Math.sqrt(dx * dx + dy * dy)
    ringR.value = Math.max(24, Math.round(pinchStartR * (d / pinchStartD)))
  }
}

function onTouchEnd(e) {
  if (e.touches.length === 0) {
    dragActive = false; pinchActive = false
  } else if (e.touches.length === 1) {
    pinchActive = false
    dragActive  = true
    dragOffX = e.touches[0].clientX - ringX.value
    dragOffY = e.touches[0].clientY - ringY.value
  }
}
</script>

<template>
  <div class="cam-wrap">

    <!-- Loading -->
    <div v-if="camState === 'loading'" class="cam-state">
      <div class="spinner" />
      <p>Abrindo câmera…</p>
    </div>

    <!-- Error -->
    <div v-else-if="camState === 'error'" class="cam-state cam-error">
      <span class="cam-error-icon">📵</span>
      <p class="cam-error-msg">{{ camError }}</p>
      <p class="cam-recovery">📋 {{ recoveryMsg() }}</p>
      <button class="btn btn-amber" @click="startCamera">Tentar Novamente</button>
    </div>

    <!-- Camera ready -->
    <template v-else-if="camState === 'ready'">
      <video ref="videoRef" class="cam-video" autoplay muted playsinline />

      <!-- Flash -->
      <div class="capture-flash" :class="{ flashing: isFlashing }" />

      <!-- Gesture overlay -->
      <div
        ref="overlayRef"
        class="cam-overlay"
        @touchstart.passive="onTouchStart"
        @touchmove.prevent="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
      >
        <!-- Instruction -->
        <div class="cam-instruction">
          Redimensione o círculo com dois dedos até cobrir <strong>10 cm</strong> de pele
        </div>

        <!-- Reference ring -->
        <div
          class="ref-ring"
          :style="{
            left:   ringX + 'px',
            top:    ringY + 'px',
            width:  ringR * 2 + 'px',
            height: ringR * 2 + 'px',
          }"
        >
          <span class="ring-label">10 cm</span>
          <!-- Resize handle hint -->
          <span class="ring-handle top-left"  />
          <span class="ring-handle top-right" />
          <span class="ring-handle bot-left"  />
          <span class="ring-handle bot-right" />
        </div>

        <!-- Distance badge anchored above the ring -->
        <div
          class="dist-badge"
          :style="{
            left: ringX + 'px',
            top:  (ringY - ringR - 18) + 'px',
          }"
        >
          <span class="dist-val metric">{{ distDisplay }}</span>
          <span class="dist-hint">da câmera</span>
        </div>
      </div>

      <!-- Bottom controls -->
      <div class="cam-controls">
        <button class="shutter-btn" aria-label="Capturar foto" @click="capture">
          <span class="shutter-inner" aria-hidden="true" />
        </button>
      </div>
    </template>

    <canvas ref="hiddenCanvas" style="display:none" />
  </div>
</template>

<style scoped>
/* ── Shell ────────────────────────────────────────────────────────────────── */
.cam-wrap {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #000;
}
.cam-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* ── Loading / error ──────────────────────────────────────────────────────── */
.cam-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-300);
  padding: 32px;
  text-align: center;
}
.cam-error      { color: #fca5a5; }
.cam-error-icon { font-size: 48px; }
.cam-error-msg  { font-size: 15px; line-height: 1.5; }
.cam-recovery {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-100);
  background: var(--bg-700);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  max-width: 280px;
  text-align: left;
}
.spinner {
  width: 40px; height: 40px;
  border: 3px solid var(--bg-700);
  border-top-color: var(--accent-amber);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Flash ────────────────────────────────────────────────────────────────── */
.capture-flash {
  position: absolute;
  inset: 0;
  background: #fff;
  opacity: 0;
  pointer-events: none;
  z-index: 50;
  transition: opacity 0.08s ease-out;
}
.capture-flash.flashing { opacity: 0.85; }

/* ── Overlay ──────────────────────────────────────────────────────────────── */
.cam-overlay {
  position: absolute;
  inset: 0;
  touch-action: none;
}

/* ── Instruction ──────────────────────────────────────────────────────────── */
.cam-instruction {
  position: absolute;
  top: 12px;
  left: 16px;
  right: 16px;
  text-align: center;
  background: rgba(2, 30, 45, 0.80);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  padding: 8px 16px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-100);
  pointer-events: none;
}
.cam-instruction strong { color: var(--accent-amber); }

/* ── Reference ring ───────────────────────────────────────────────────────── */
.ref-ring {
  position: absolute;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 2.5px solid rgba(251, 135, 0, 0.9);
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.5),
    inset 0 0 0 1px rgba(0, 0, 0, 0.3),
    0 0 16px rgba(251, 135, 0, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  transition: width 0.05s, height 0.05s;
}

.ring-label {
  font-size: 12px;
  font-weight: 700;
  color: rgba(251, 135, 0, 1);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.9);
  pointer-events: none;
  user-select: none;
}

/* Corner resize-handle dots — visual hint only */
.ring-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(251, 135, 0, 0.9);
  border: 1.5px solid rgba(255, 255, 255, 0.8);
}
.ring-handle.top-left  { top: -5px;  left: -5px;  }
.ring-handle.top-right { top: -5px;  right: -5px; }
.ring-handle.bot-left  { bottom: -5px; left: -5px; }
.ring-handle.bot-right { bottom: -5px; right: -5px; }

/* ── Distance badge ───────────────────────────────────────────────────────── */
.dist-badge {
  position: absolute;
  transform: translate(-50%, -100%);
  display: flex;
  align-items: baseline;
  gap: 4px;
  background: rgba(2, 30, 45, 0.82);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(251, 135, 0, 0.5);
  border-radius: 20px;
  padding: 4px 12px;
  pointer-events: none;
  white-space: nowrap;
}
.dist-val  { font-size: 18px; font-weight: 700; color: var(--accent-amber); line-height: 1; }
.dist-hint { font-size: 11px; color: var(--text-300); }

/* ── Bottom controls ──────────────────────────────────────────────────────── */
.cam-controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 16px 20px calc(24px + env(safe-area-inset-bottom, 0px));
  display: flex;
  justify-content: center;
  background: linear-gradient(transparent, rgba(2, 30, 45, 0.88) 40%);
}

/* ── Shutter ──────────────────────────────────────────────────────────────── */
.shutter-btn {
  width: 72px; height: 72px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.15);
  border: 3px solid rgba(255, 255, 255, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.1s, opacity 0.15s;
  -webkit-tap-highlight-color: transparent;
}
.shutter-btn:active { transform: scale(0.9); }
.shutter-inner {
  width: 54px; height: 54px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
}
</style>
