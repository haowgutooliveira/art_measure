<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useARCamera } from '../composables/useARCamera.js'

const emit = defineEmits(['captured'])

const ar = useARCamera()

// ─── States ───────────────────────────────────────────────────────────────────
// 'checking' | 'ar-active' | 'capturing' | 'fb-ready' | 'error'
const camState   = ref('checking')
const camError   = ref('')
const isFlashing = ref(false)
const mode       = ref('ar')   // 'ar' | 'fallback'

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const showAROverlay = ref(false)
const arOverlayRef  = ref(null)
const fbVideoRef    = ref(null)
const hiddenCanvas  = ref(null)
let   fbStream      = null

// ─── Draggable reticle ────────────────────────────────────────────────────────
const reticleX   = ref(0)
const reticleY   = ref(0)
let dragActive   = false
let dragOffX = 0, dragOffY = 0

// ─── Fallback: ring calibration ───────────────────────────────────────────────
const FB_DISTANCE_CM = 25
const H_FOV_RAD      = (65 * Math.PI) / 180

// Ring calibration state (fallback only)
const ringR         = ref(60)
let pinchActive     = false
let pinchStartD     = 0
let pinchStartR     = 0

const ringDistCm = computed(() => {
  const sw = window.innerWidth
  const focalCss = sw / (2 * Math.tan(H_FOV_RAD / 2))
  return Math.round(focalCss * 10 / (ringR.value * 2))
})

function fbCalcPixelsPerCm(imageWidthPx) {
  const focalPx = imageWidthPx / (2 * Math.tan(H_FOV_RAD / 2))
  return focalPx / ringDistCm.value
}

// ─── Distance display ─────────────────────────────────────────────────────────
const activeDist = computed(() => {
  if (mode.value === 'ar') return ar.distanceCm.value
  return ringDistCm.value
})

const distDisplay = computed(() => {
  const d = activeDist.value
  if (!d) return null
  return d < 100 ? `${d} cm` : `${(d / 100).toFixed(1)} m`
})

// ─── OS recovery ──────────────────────────────────────────────────────────────
const recoveryMsg = computed(() => {
  const ua = navigator.userAgent
  if (/iPhone|iPad/.test(ua)) return 'Ajustes → Safari → Câmera → Permitir'
  if (/Android/.test(ua))     return 'Configurações → Apps → Chrome → Permissões → Câmera'
  return 'Verifique as permissões de câmera nas configurações do navegador.'
})

// ─── Watch XR session end (e.g. user pressed Android back) ───────────────────
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
  ringR.value    = Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.22)

  await ar.checkSupport()
  if (ar.isSupported.value) {
    await startAR()
  } else {
    mode.value = 'fallback'
    await startFallback()
  }
})
onUnmounted(() => { ar.stop().catch(() => {}); stopFallback() })

// ─── AR mode ──────────────────────────────────────────────────────────────────
async function startAR() {
  camState.value = 'checking'
  mode.value = 'ar'

  // Render overlay first so arOverlayRef is populated before requestSession
  showAROverlay.value = true
  await nextTick()

  try {
    await ar.start(arOverlayRef.value)
    camState.value = 'ar-active'
    // Sync reticle to AR composable
    ar.setReticle(reticleX.value / window.innerWidth, reticleY.value / window.innerHeight)
  } catch (err) {
    // depth-sensing not supported on this device → ring calibration fallback
    showAROverlay.value = false
    mode.value = 'fallback'
    await startFallback()
  }
}

async function captureAR() {
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

    emit('captured', {
      imageDataUrl: canvas.toDataURL('image/jpeg', 0.92),
      pixelsPerCm:  ar.calcPixelsPerCm(W, lockedDistanceCm),
      distanceCm:   lockedDistanceCm,
    })
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
        ? 'Nenhuma câmera encontrada.'
        : 'Não foi possível acessar a câmera.'
  }
}

function stopFallback() { fbStream?.getTracks().forEach(t => t.stop()); fbStream = null }

function captureFallback() {
  isFlashing.value = true
  setTimeout(() => { isFlashing.value = false }, 300)

  const video  = fbVideoRef.value
  const canvas = hiddenCanvas.value
  const W = video.videoWidth, H = video.videoHeight
  canvas.width = W; canvas.height = H
  canvas.getContext('2d').drawImage(video, 0, 0, W, H)

  const sW     = video.clientWidth  || window.innerWidth
  const sH     = video.clientHeight || window.innerHeight
  const scale  = Math.max(W / sW, H / sH)
  const diamPx = ringR.value * 2 * scale
  const ppc    = diamPx / 10

  setTimeout(() => {
    stopFallback()
    emit('captured', {
      imageDataUrl: canvas.toDataURL('image/jpeg', 0.92),
      pixelsPerCm:  ppc,
      distanceCm:   ringDistCm.value,
    })
  }, 220)
}

function retryCamera() {
  if (ar.isSupported.value) startAR()
  else startFallback()
}

// ─── Gesture handlers (shared drag + pinch) ───────────────────────────────────
function onTouchStart(e) {
  if (e.touches.length === 1) {
    dragActive  = true
    pinchActive = false
    dragOffX = e.touches[0].clientX - reticleX.value
    dragOffY = e.touches[0].clientY - reticleY.value
  } else if (e.touches.length >= 2 && mode.value === 'fallback') {
    dragActive  = false
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
    reticleX.value = e.touches[0].clientX - dragOffX
    reticleY.value = e.touches[0].clientY - dragOffY
    // Update AR depth sampling position
    if (mode.value === 'ar') {
      ar.setReticle(reticleX.value / window.innerWidth, reticleY.value / window.innerHeight)
    }
  } else if (pinchActive && e.touches.length >= 2 && mode.value === 'fallback') {
    const dx = e.touches[0].clientX - e.touches[1].clientX
    const dy = e.touches[0].clientY - e.touches[1].clientY
    ringR.value = Math.max(24, Math.round(pinchStartR * (Math.sqrt(dx * dx + dy * dy) / pinchStartD)))
  }
}

function onTouchEnd(e) {
  if (e.touches.length === 0) { dragActive = false; pinchActive = false }
  else if (e.touches.length === 1) {
    pinchActive = false; dragActive = true
    dragOffX = e.touches[0].clientX - reticleX.value
    dragOffY = e.touches[0].clientY - reticleY.value
  }
}
</script>

<template>
  <!-- ── AR Overlay (Teleport so dom-overlay receives a body-child element) ── -->
  <Teleport to="body">
    <div
      v-if="showAROverlay"
      ref="arOverlayRef"
      class="ar-overlay"
      @touchstart.passive="onTouchStart"
      @touchmove.prevent="onTouchMove"
      @touchend="onTouchEnd"
      @touchcancel="onTouchEnd"
    >
      <div class="capture-flash" :class="{ flashing: isFlashing }" />

      <!-- Instruction -->
      <div v-if="camState === 'ar-active'" class="ar-instruction">
        Arraste o alvo para a área a ser tatuada
      </div>

      <!-- Draggable reticle + live distance badge -->
      <div
        v-if="camState === 'ar-active'"
        class="reticle-wrap"
        :style="{ left: reticleX + 'px', top: reticleY + 'px' }"
      >
        <!-- Distance badge above reticle -->
        <div class="reticle-badge" :class="{ hit: ar.hasHit.value }">
          <span v-if="distDisplay" class="badge-dist metric">{{ distDisplay }}</span>
          <span v-else class="badge-scanning">medindo…</span>
        </div>

        <!-- Crosshair -->
        <div class="reticle" :class="{ hit: ar.hasHit.value }">
          <span class="r-h" /><span class="r-v" />
          <span class="r-ring" />
        </div>
      </div>

      <!-- Shutter -->
      <div v-if="camState === 'ar-active'" class="ar-controls">
        <button
          class="shutter-btn"
          :disabled="!ar.hasHit.value"
          aria-label="Capturar foto"
          @click.stop="captureAR"
        >
          <span class="shutter-inner" />
        </button>
      </div>

      <!-- Capturing spinner -->
      <div v-if="camState === 'capturing'" class="ar-capturing">
        <div class="spinner" /><p>Capturando…</p>
      </div>
    </div>
  </Teleport>

  <!-- ── Component shell ───────────────────────────────────────────────────── -->
  <div class="cam-wrap">

    <!-- Checking / AR active / capturing -->
    <div
      v-if="camState === 'checking' || camState === 'capturing' || camState === 'ar-active'"
      class="cam-state"
    >
      <div v-if="camState !== 'ar-active'" class="spinner" />
      <p v-if="camState === 'checking'">Iniciando câmera…</p>
      <p v-else-if="camState === 'capturing'">Capturando…</p>
    </div>

    <!-- Error -->
    <div v-else-if="camState === 'error'" class="cam-state cam-error">
      <span class="cam-error-icon">📵</span>
      <p class="cam-error-msg">{{ camError }}</p>
      <p class="cam-recovery">📋 {{ recoveryMsg }}</p>
      <button class="btn btn-amber" @click="retryCamera">Tentar Novamente</button>
    </div>

    <!-- Fallback: plain camera + ring calibration -->
    <template v-else-if="camState === 'fb-ready'">
      <video ref="fbVideoRef" class="cam-video" autoplay muted playsinline />
      <div class="capture-flash" :class="{ flashing: isFlashing }" />

      <div
        class="cam-overlay"
        @touchstart.passive="onTouchStart"
        @touchmove.prevent="onTouchMove"
        @touchend="onTouchEnd"
        @touchcancel="onTouchEnd"
      >
        <!-- Instruction -->
        <div class="ar-instruction fb-instruction">
          Mova o círculo para a área · Ajuste o tamanho com 2 dedos até cobrir <strong>10 cm</strong>
        </div>

        <!-- Distance badge (from ring size) + ring -->
        <div
          class="reticle-wrap"
          :style="{ left: reticleX + 'px', top: reticleY + 'px' }"
        >
          <div class="reticle-badge hit">
            <span v-if="distDisplay" class="badge-dist metric">{{ distDisplay }}</span>
          </div>

          <!-- Ring (resize via pinch) -->
          <div
            class="fb-ring"
            :style="{ width: ringR * 2 + 'px', height: ringR * 2 + 'px' }"
          >
            <span class="ring-label">10 cm</span>
            <span class="ring-h top-left"  />
            <span class="ring-h top-right" />
            <span class="ring-h bot-left"  />
            <span class="ring-h bot-right" />
          </div>
        </div>
      </div>

      <div class="cam-controls">
        <button class="shutter-btn" aria-label="Capturar foto" @click="captureFallback">
          <span class="shutter-inner" />
        </button>
      </div>
    </template>

    <canvas ref="hiddenCanvas" style="display:none" />
  </div>
</template>

<style scoped>
/* ── Shell ────────────────────────────────────────────────────────────────── */
.cam-wrap {
  flex: 1; position: relative; display: flex; flex-direction: column;
  overflow: hidden; background: #000;
}
.cam-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }

/* ── States ───────────────────────────────────────────────────────────────── */
.cam-state {
  flex: 1; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 16px; color: var(--text-300);
  padding: 32px; text-align: center;
}
.cam-error      { color: #fca5a5; }
.cam-error-icon { font-size: 48px; }
.cam-error-msg  { font-size: 15px; line-height: 1.5; }
.cam-recovery {
  font-size: 13px; line-height: 1.6; color: var(--text-100);
  background: var(--bg-700); border-radius: var(--radius-sm);
  padding: 10px 14px; max-width: 280px; text-align: left;
}
.spinner {
  width: 40px; height: 40px; border: 3px solid var(--bg-700);
  border-top-color: var(--accent-amber); border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Flash ────────────────────────────────────────────────────────────────── */
.capture-flash {
  position: fixed; inset: 0; background: #fff; opacity: 0;
  pointer-events: none; z-index: 9999; transition: opacity 0.08s ease-out;
}
.capture-flash.flashing { opacity: 0.85; }

/* ── AR overlay ───────────────────────────────────────────────────────────── */
.ar-overlay {
  position: fixed; inset: 0; z-index: 1000; touch-action: none;
}
.ar-capturing {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px;
  color: var(--text-300); pointer-events: none;
}

/* ── Instruction ──────────────────────────────────────────────────────────── */
.ar-instruction {
  position: fixed; bottom: calc(140px + env(safe-area-inset-bottom, 0px));
  left: 16px; right: 16px; text-align: center;
  background: rgba(2, 30, 45, 0.80); backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.1); border-radius: 20px;
  padding: 8px 20px; font-size: 13px; line-height: 1.5; color: var(--text-100);
  pointer-events: none;
}
.ar-instruction strong { color: var(--accent-amber); }
.fb-instruction { bottom: calc(130px + env(safe-area-inset-bottom, 0px)); }

/* ── Reticle wrapper (absolute-positioned by JS) ─────────────────────────── */
.reticle-wrap {
  position: fixed;
  transform: translate(-50%, -50%);
  display: flex; flex-direction: column; align-items: center;
  pointer-events: none; gap: 6px;
}

/* ── Distance badge ───────────────────────────────────────────────────────── */
.reticle-badge {
  display: flex; align-items: center; gap: 4px;
  background: rgba(2, 30, 45, 0.82); backdrop-filter: blur(8px);
  border: 1px solid rgba(239, 68, 68, 0.5); border-radius: 20px;
  padding: 4px 12px; white-space: nowrap; transition: border-color 0.2s;
}
.reticle-badge.hit { border-color: rgba(255, 183, 3, 0.7); }

.badge-dist    { font-size: 20px; font-weight: 700; color: var(--accent-amber); line-height: 1; }
.badge-scanning { font-size: 12px; color: var(--text-300); }

/* ── Crosshair reticle ────────────────────────────────────────────────────── */
.reticle {
  position: relative; width: 56px; height: 56px;
  display: flex; align-items: center; justify-content: center;
  transition: transform 0.15s;
}
.reticle.hit { transform: scale(1.1); }

.r-ring {
  position: absolute; inset: 0; border-radius: 50%;
  border: 2px solid rgba(255, 183, 3, 0.4); transition: border-color 0.2s;
}
.reticle.hit .r-ring { border-color: rgba(255, 183, 3, 0.9); }

.r-h, .r-v { position: absolute; background: rgba(255, 183, 3, 0.75); border-radius: 1px; }
.r-h { width: 20px; height: 2px; }
.r-v { width: 2px;  height: 20px; }
.reticle.hit .r-h, .reticle.hit .r-v { background: #FFB703; }

/* ── Fallback ring ────────────────────────────────────────────────────────── */
.fb-ring {
  position: relative; border-radius: 50%;
  border: 2.5px solid rgba(251, 135, 0, 0.9);
  box-shadow: 0 0 0 1px rgba(0,0,0,.5), inset 0 0 0 1px rgba(0,0,0,.3), 0 0 16px rgba(251,135,0,.3);
  display: flex; align-items: center; justify-content: center;
}
.ring-label { font-size: 12px; font-weight: 700; color: rgba(251,135,0,1); text-shadow: 0 1px 4px rgba(0,0,0,.9); }
.ring-h { position: absolute; width: 10px; height: 10px; border-radius: 50%; background: rgba(251,135,0,.9); border: 1.5px solid rgba(255,255,255,.8); }
.ring-h.top-left  { top: -5px;    left: -5px;  }
.ring-h.top-right { top: -5px;    right: -5px; }
.ring-h.bot-left  { bottom: -5px; left: -5px;  }
.ring-h.bot-right { bottom: -5px; right: -5px; }

/* ── AR shutter ───────────────────────────────────────────────────────────── */
.ar-controls {
  position: fixed; bottom: 0; left: 0; right: 0;
  padding: 16px 20px calc(24px + env(safe-area-inset-bottom, 0px));
  display: flex; justify-content: center;
  background: linear-gradient(transparent, rgba(2,30,45,.88) 40%);
  pointer-events: auto;
}

/* ── Fallback overlay + shutter ───────────────────────────────────────────── */
.cam-overlay { position: absolute; inset: 0; touch-action: none; }
.cam-controls {
  position: absolute; bottom: 0; left: 0; right: 0;
  padding: 16px 20px calc(24px + env(safe-area-inset-bottom, 0px));
  display: flex; justify-content: center;
  background: linear-gradient(transparent, rgba(2,30,45,.88) 40%);
}

/* ── Shutter ──────────────────────────────────────────────────────────────── */
.shutter-btn {
  width: 72px; height: 72px; border-radius: 50%;
  background: rgba(255,255,255,.15); border: 3px solid rgba(255,255,255,.85);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: transform .1s, opacity .15s;
  -webkit-tap-highlight-color: transparent;
}
.shutter-btn:active   { transform: scale(.9); }
.shutter-btn:disabled { opacity: .35; cursor: not-allowed; }
.shutter-inner { width: 54px; height: 54px; border-radius: 50%; background: rgba(255,255,255,.9); }
</style>
