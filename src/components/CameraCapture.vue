<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useARCamera } from '../composables/useARCamera.js'

const emit = defineEmits(['captured'])

const ar = useARCamera()

// ─── States ───────────────────────────────────────────────────────────────────
// 'checking' | 'ar-active' | 'capturing' | 'fb-ready' | 'error' | 'done'
const camState   = ref('checking')
const camError   = ref('')
const isFlashing = ref(false)

// ─── DOM refs ─────────────────────────────────────────────────────────────────
// FIX: overlay always rendered via showAROverlay flag so arOverlayRef is
// populated BEFORE we call ar.start() — previously camState was 'checking'
// when start() was called, so v-if kept the element out of the DOM and
// dom-overlay received null, causing XR to take over without any UI.
const showAROverlay = ref(false)
const arOverlayRef  = ref(null)
const fbVideoRef    = ref(null)
const hiddenCanvas  = ref(null)
let   fbStream      = null

// ─── Draggable reticle position ───────────────────────────────────────────────
const reticleX = ref(0)   // set to center on mount
const reticleY = ref(0)
const isDragging = ref(false)

// ─── Fallback fixed distance ──────────────────────────────────────────────────
const FB_DISTANCE_CM = 25

function fbCalcPixelsPerCm(imageWidthPx) {
  const H_FOV_RAD = (65 * Math.PI) / 180
  return (imageWidthPx / (2 * Math.tan(H_FOV_RAD / 2))) / FB_DISTANCE_CM
}

// ─── OS recovery hint ─────────────────────────────────────────────────────────
const recoveryInstructions = computed(() => {
  const ua = navigator.userAgent
  if (/iPhone|iPad/.test(ua)) return 'iPhone/iPad: Ajustes → Safari → Câmera → Permitir'
  if (/Android/.test(ua))     return 'Android: Configurações → Apps → Chrome → Permissões → Câmera'
  return 'Verifique as permissões de câmera nas configurações do navegador.'
})

// ─── Distance status (AR) ─────────────────────────────────────────────────────
const distStatus = computed(() => {
  if (camState.value !== 'ar-active') return { ok: true, text: null }
  const d = ar.distanceCm.value
  if (d === null) return { ok: false, text: 'Apontando para a área…' }
  if (d < 10)    return { ok: false, text: 'Muito perto' }
  if (d > 80)    return { ok: false, text: 'Muito longe' }
  return { ok: true, text: null }
})

// ─── Watch XR session end ─────────────────────────────────────────────────────
// FIX: when the user presses Android back (or any other external XR end),
// ar.isActive goes false while camState is still 'ar-active' → spinner forever.
// Detect that and fall back to the regular camera.
watch(() => ar.isActive.value, (active) => {
  if (!active && camState.value === 'ar-active') {
    showAROverlay.value = false
    startFallback()
  }
})

// ─── Init ─────────────────────────────────────────────────────────────────────
onMounted(async () => {
  reticleX.value = window.innerWidth  / 2
  reticleY.value = window.innerHeight / 2

  await ar.checkSupport()
  if (ar.isSupported.value) {
    await startAR()
  } else {
    await startFallback()
  }
})

onUnmounted(() => {
  ar.stop().catch(() => {})
  stopFallback()
})

// ─── AR mode ──────────────────────────────────────────────────────────────────
async function startAR() {
  camState.value = 'checking'

  // FIX: render overlay first so arOverlayRef.value is not null
  showAROverlay.value = true
  await nextTick()   // let Vue mount the Teleported element

  try {
    await ar.start(arOverlayRef.value)
    camState.value = 'ar-active'
  } catch {
    // AR not available or dom-overlay not supported → plain camera fallback
    showAROverlay.value = false
    await startFallback()
  }
}

async function captureAR() {
  if (!distStatus.value.ok) return
  isFlashing.value = true
  setTimeout(() => { isFlashing.value = false }, 300)
  camState.value = 'capturing'

  try {
    const { lockedDistanceCm } = await ar.lockAndRelease(1920)
    showAROverlay.value = false

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    })
    const video = document.createElement('video')
    video.srcObject = stream; video.muted = true; video.playsInline = true
    await video.play()
    await new Promise(r => requestAnimationFrame(r))

    const W = video.videoWidth || 1920
    const H = video.videoHeight || 1080
    const canvas = hiddenCanvas.value
    canvas.width = W; canvas.height = H
    canvas.getContext('2d').drawImage(video, 0, 0, W, H)
    stream.getTracks().forEach(t => t.stop())

    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.92)
    const pixelsPerCm  = ar.calcPixelsPerCm(W, lockedDistanceCm)

    camState.value = 'done'
    emit('captured', { imageDataUrl, pixelsPerCm, distanceCm: lockedDistanceCm })
  } catch {
    camError.value = 'Não foi possível capturar a foto.'
    camState.value = 'error'
  }
}

// ─── Fallback mode ────────────────────────────────────────────────────────────
async function startFallback() {
  camState.value = 'checking'
  camError.value = ''
  try {
    fbStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    })
    camState.value = 'fb-ready'
    await nextTick()
    fbVideoRef.value.srcObject = fbStream
    await fbVideoRef.value.play()
  } catch (err) {
    camState.value = 'error'
    camError.value = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
      ? 'Permissão de câmera negada.'
      : err.name === 'NotFoundError'
        ? 'Nenhuma câmera encontrada neste dispositivo.'
        : 'Não foi possível acessar a câmera.'
  }
}

function stopFallback() {
  fbStream?.getTracks().forEach(t => t.stop())
  fbStream = null
}

function captureFallback() {
  isFlashing.value = true
  setTimeout(() => { isFlashing.value = false }, 300)

  const video  = fbVideoRef.value
  const canvas = hiddenCanvas.value
  const W = video.videoWidth, H = video.videoHeight
  canvas.width = W; canvas.height = H
  canvas.getContext('2d').drawImage(video, 0, 0, W, H)

  const imageDataUrl = canvas.toDataURL('image/jpeg', 0.92)
  const pixelsPerCm  = fbCalcPixelsPerCm(W)

  setTimeout(() => {
    camState.value = 'done'
    stopFallback()
    emit('captured', { imageDataUrl, pixelsPerCm, distanceCm: FB_DISTANCE_CM })
  }, 220)
}

function retryCamera() {
  if (ar.isSupported.value) startAR()
  else startFallback()
}

// ─── Draggable reticle ────────────────────────────────────────────────────────
function onPointerDown(e) {
  isDragging.value = true
  moveReticle(e)
}
function onPointerMove(e) {
  if (!isDragging.value) return
  e.preventDefault()
  moveReticle(e)
}
function onPointerUp() {
  isDragging.value = false
}
function moveReticle(e) {
  const src = e.touches ? e.touches[0] : e
  reticleX.value = src.clientX
  reticleY.value = src.clientY
}
</script>

<template>
  <!-- ── AR overlay — always rendered when showAROverlay so ref is set before start() ── -->
  <Teleport to="body">
    <div
      v-if="showAROverlay"
      ref="arOverlayRef"
      class="ar-overlay"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @touchstart.passive="onPointerDown"
      @touchmove.prevent="onPointerMove"
      @touchend="onPointerUp"
    >
      <div class="capture-flash" :class="{ flashing: isFlashing }" />

      <!-- Distance badge -->
      <div
        v-if="camState === 'ar-active'"
        class="ar-dist-badge"
        :class="{ ok: distStatus.ok }"
      >
        <template v-if="ar.distanceCm.value !== null">
          <span class="dist-num metric">{{ ar.distanceCm.value }}</span>
          <span class="dist-unit">cm</span>
        </template>
        <span v-if="distStatus.text" class="dist-status">{{ distStatus.text }}</span>
        <span v-else-if="ar.distanceCm.value !== null" class="dist-status ok-text">ideal ✓</span>
      </div>

      <!-- Instruction -->
      <div v-if="camState === 'ar-active'" class="ar-instruction">
        Arraste o alvo para a área a ser tatuada
      </div>

      <!-- Draggable reticle -->
      <div
        v-if="camState === 'ar-active'"
        class="ar-reticle"
        :class="{ hit: ar.hasHit.value }"
        :style="{ left: reticleX + 'px', top: reticleY + 'px' }"
      >
        <span class="reticle-h" /><span class="reticle-v" />
        <span class="reticle-ring" />
        <span class="reticle-drag-hint">✥</span>
      </div>

      <!-- Shutter -->
      <div v-if="camState === 'ar-active'" class="ar-controls">
        <button
          class="shutter-btn"
          :disabled="!distStatus.ok"
          aria-label="Capturar foto"
          @click.stop="captureAR"
        >
          <span class="shutter-inner" aria-hidden="true" />
        </button>
      </div>

      <!-- Capturing spinner inside overlay -->
      <div v-if="camState === 'capturing'" class="ar-capturing">
        <div class="spinner" />
        <p>Capturando…</p>
      </div>
    </div>
  </Teleport>

  <!-- ── Component shell ────────────────────────────────────────────────────── -->
  <div class="cam-wrap">

    <!-- Loading -->
    <div v-if="camState === 'checking' || camState === 'capturing'" class="cam-state">
      <div class="spinner" />
      <p>{{ camState === 'capturing' ? 'Capturando…' : 'Iniciando câmera…' }}</p>
    </div>

    <!-- AR active: XR handles display, shell shows nothing -->
    <div v-else-if="camState === 'ar-active'" class="cam-state" />

    <!-- Error -->
    <div v-else-if="camState === 'error'" class="cam-state cam-error">
      <span class="cam-error-icon">📵</span>
      <p class="cam-error-msg">{{ camError }}</p>
      <p class="cam-recovery">📋 {{ recoveryInstructions }}</p>
      <button class="btn btn-amber" @click="retryCamera">Tentar Novamente</button>
    </div>

    <!-- Fallback: plain camera + fixed reticle -->
    <template v-else-if="camState === 'fb-ready'">
      <video ref="fbVideoRef" class="cam-video" autoplay muted playsinline />

      <div class="capture-flash" :class="{ flashing: isFlashing }" />

      <!-- Overlay: draggable reticle -->
      <div
        class="cam-overlay"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @touchstart.passive="onPointerDown"
        @touchmove.prevent="onPointerMove"
        @touchend="onPointerUp"
      >
        <div class="ar-instruction fb-instruction">
          Arraste o alvo para a área a ser tatuada
        </div>

        <div
          class="ar-reticle hit"
          :style="{ left: reticleX + 'px', top: reticleY + 'px' }"
        >
          <span class="reticle-h" /><span class="reticle-v" />
          <span class="reticle-ring" />
          <span class="reticle-drag-hint">✥</span>
        </div>
      </div>

      <div class="cam-controls">
        <button class="shutter-btn" aria-label="Capturar foto" @click="captureFallback">
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
  position: fixed;
  inset: 0;
  background: #fff;
  opacity: 0;
  pointer-events: none;
  z-index: 9999;
  transition: opacity 0.08s ease-out;
}
.capture-flash.flashing { opacity: 0.85; }

/* ── AR overlay ───────────────────────────────────────────────────────────── */
.ar-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  /* touch-action: none allows preventDefault on touchmove (drag) */
  touch-action: none;
}

/* ── Capturing inside overlay ─────────────────────────────────────────────── */
.ar-capturing {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-300);
  pointer-events: none;
}

/* ── Distance badge ───────────────────────────────────────────────────────── */
.ar-dist-badge {
  position: fixed;
  top: max(24px, env(safe-area-inset-top, 24px));
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: baseline;
  gap: 4px;
  background: rgba(2, 30, 45, 0.82);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(239, 68, 68, 0.5);
  border-radius: 20px;
  padding: 6px 16px;
  transition: border-color 0.25s;
  pointer-events: none;
  white-space: nowrap;
}
.ar-dist-badge.ok { border-color: rgba(46, 196, 182, 0.6); }

.dist-num {
  font-size: 24px;
  font-weight: 700;
  color: #fca5a5;
  line-height: 1;
  transition: color 0.25s;
}
.ar-dist-badge.ok .dist-num { color: var(--accent-amber); }
.dist-unit   { font-size: 13px; font-weight: 600; color: var(--text-300); margin-right: 4px; }
.dist-status { font-size: 12px; color: #fca5a5; }
.ok-text     { color: #2EC4B6; }

/* ── Instruction ──────────────────────────────────────────────────────────── */
.ar-instruction {
  position: fixed;
  bottom: calc(140px + env(safe-area-inset-bottom, 0px));
  left: 16px;
  right: 16px;
  text-align: center;
  background: rgba(2, 30, 45, 0.78);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 20px;
  padding: 8px 20px;
  font-size: 14px;
  line-height: 1.4;
  color: var(--text-100);
  pointer-events: none;
}

/* ── Reticle — draggable, positioned absolutely ───────────────────────────── */
.ar-reticle {
  position: fixed;
  transform: translate(-50%, -50%);
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  /* pointer-events: none so drag events go to the overlay, not the reticle */
  pointer-events: none;
}

.reticle-ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px solid rgba(255, 183, 3, 0.4);
  transition: border-color 0.2s;
}
.ar-reticle.hit .reticle-ring { border-color: rgba(255, 183, 3, 0.9); }

.reticle-h, .reticle-v {
  position: absolute;
  background: rgba(255, 183, 3, 0.75);
  border-radius: 1px;
}
.reticle-h { width: 24px; height: 2px; }
.reticle-v { width: 2px;  height: 24px; }
.ar-reticle.hit .reticle-h,
.ar-reticle.hit .reticle-v { background: #FFB703; }

/* Drag handle indicator — small arrows icon below the crosshair */
.reticle-drag-hint {
  position: absolute;
  bottom: -20px;
  font-size: 14px;
  color: rgba(255, 183, 3, 0.7);
  line-height: 1;
  pointer-events: none;
  user-select: none;
}

/* ── AR shutter bar ───────────────────────────────────────────────────────── */
.ar-controls {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 16px 20px calc(24px + env(safe-area-inset-bottom, 0px));
  display: flex;
  justify-content: center;
  background: linear-gradient(transparent, rgba(2, 30, 45, 0.88) 40%);
  pointer-events: auto;
}

/* ── Fallback overlay ─────────────────────────────────────────────────────── */
.cam-overlay {
  position: absolute;
  inset: 0;
  touch-action: none;
}
.fb-instruction {
  bottom: calc(130px + env(safe-area-inset-bottom, 0px));
}

/* ── Fallback shutter bar ─────────────────────────────────────────────────── */
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

/* ── Shutter button ───────────────────────────────────────────────────────── */
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
.shutter-btn:active   { transform: scale(0.9); }
.shutter-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.shutter-inner {
  width: 54px; height: 54px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
}
</style>
