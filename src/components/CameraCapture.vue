<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useARCamera } from '../composables/useARCamera.js'

const emit = defineEmits(['captured'])

const ar = useARCamera()

// ─── State ────────────────────────────────────────────────────────────────────
// 'checking' | 'ar-active' | 'capturing' | 'fb-ready' | 'error' | 'done'
const camState   = ref('checking')
const camError   = ref('')
const isFlashing = ref(false)

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const arOverlayRef = ref(null)
const fbVideoRef   = ref(null)
const hiddenCanvas = ref(null)
let   fbStream     = null

// ─── Fallback: fixed distance ─────────────────────────────────────────────────
const FB_DISTANCE_CM = 25   // typical phone-to-skin distance for a reference shot

/** pixelsPerCm using pinhole model at a fixed 25 cm */
function fbCalcPixelsPerCm(imageWidthPx) {
  const H_FOV_RAD = (65 * Math.PI) / 180
  const focalPx   = imageWidthPx / (2 * Math.tan(H_FOV_RAD / 2))
  return focalPx / FB_DISTANCE_CM
}

// ─── OS recovery hint ─────────────────────────────────────────────────────────
const recoveryInstructions = computed(() => {
  const ua = navigator.userAgent
  if (/iPhone|iPad/.test(ua)) return 'iPhone/iPad: Ajustes → Safari → Câmera → Permitir'
  if (/Android/.test(ua))     return 'Android: Configurações → Apps → Chrome → Permissões → Câmera'
  return 'Verifique as permissões de câmera nas configurações do navegador.'
})

// ─── Distance status (AR only) ────────────────────────────────────────────────
const distStatus = computed(() => {
  if (camState.value !== 'ar-active') return { ok: true }
  const d = ar.distanceCm.value
  if (d === null) return { text: 'Apontando para a área…', ok: false }
  if (d < 10)    return { text: 'Muito perto', ok: false }
  if (d > 80)    return { text: 'Muito longe', ok: false }
  return { text: null, ok: true }
})

// ─── Init ─────────────────────────────────────────────────────────────────────
onMounted(async () => {
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
  try {
    await nextTick()
    await ar.start(arOverlayRef.value)
    camState.value = 'ar-active'
  } catch {
    await startFallback()
  }
}

async function captureAR() {
  if (!distStatus.value.ok) return
  isFlashing.value = true
  setTimeout(() => { isFlashing.value = false }, 300)
  camState.value = 'capturing'

  try {
    const { lockedDistanceCm, pixelsPerCm: tempPpc } = await ar.lockAndRelease(1920)

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
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      camError.value = 'Permissão de câmera negada.'
    } else if (err.name === 'NotFoundError') {
      camError.value = 'Nenhuma câmera encontrada neste dispositivo.'
    } else {
      camError.value = 'Não foi possível acessar a câmera.'
    }
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
</script>

<template>
  <!-- ── AR overlay ─────────────────────────────────────────────────────────── -->
  <Teleport to="body">
    <div
      v-if="camState === 'ar-active' || camState === 'capturing'"
      ref="arOverlayRef"
      class="ar-overlay"
    >
      <div class="capture-flash" :class="{ flashing: isFlashing }" />

      <!-- Distance badge (top center) -->
      <div v-if="ar.distanceCm.value !== null" class="ar-dist-badge" :class="{ ok: distStatus.ok }">
        <span class="dist-num metric">{{ ar.distanceCm.value }}</span>
        <span class="dist-unit">cm</span>
        <span v-if="distStatus.text" class="dist-status">— {{ distStatus.text }}</span>
      </div>

      <!-- Instruction -->
      <div class="ar-instruction">
        Aponte o ponto para a área a ser tatuada
      </div>

      <!-- Reticle — centred on screen -->
      <div class="ar-reticle" :class="{ hit: ar.hasHit.value }">
        <span class="reticle-h" /><span class="reticle-v" />
        <span class="reticle-ring" />
      </div>

      <!-- Shutter -->
      <div class="ar-controls">
        <button
          class="shutter-btn"
          :disabled="!distStatus.ok || camState === 'capturing'"
          aria-label="Capturar foto"
          @click="captureAR"
        >
          <span class="shutter-inner" aria-hidden="true" />
        </button>
      </div>
    </div>
  </Teleport>

  <!-- ── Component shell ────────────────────────────────────────────────────── -->
  <div class="cam-wrap">

    <!-- Loading / capturing -->
    <div v-if="camState === 'checking' || camState === 'capturing' || camState === 'ar-active'" class="cam-state">
      <div class="spinner" />
      <p v-if="camState === 'checking'">Iniciando câmera…</p>
      <p v-else-if="camState === 'capturing'">Capturando…</p>
    </div>

    <!-- Error -->
    <div v-else-if="camState === 'error'" class="cam-state cam-error">
      <span class="cam-error-icon">📵</span>
      <p class="cam-error-msg">{{ camError }}</p>
      <p class="cam-recovery">📋 {{ recoveryInstructions }}</p>
      <button class="btn btn-amber" @click="retryCamera">Tentar Novamente</button>
    </div>

    <!-- Fallback: plain camera + reticle, no slider -->
    <template v-else-if="camState === 'fb-ready'">
      <video ref="fbVideoRef" class="cam-video" autoplay muted playsinline />

      <div class="capture-flash" :class="{ flashing: isFlashing }" />

      <!-- Same reticle as AR mode, but no distance badge -->
      <div class="cam-overlay">
        <div class="ar-instruction fb-instruction">
          Aponte o ponto para a área a ser tatuada e capture
        </div>

        <div class="ar-reticle hit">
          <span class="reticle-h" /><span class="reticle-v" />
          <span class="reticle-ring" />
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
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.ar-overlay .ar-controls,
.ar-overlay .shutter-btn { pointer-events: auto; }

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
.dist-unit   { font-size: 13px; font-weight: 600; color: var(--text-300); }
.dist-status { font-size: 12px; color: #fca5a5; transition: color 0.25s; }
.ar-dist-badge.ok .dist-status { color: #2EC4B6; }

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

/* ── Reticle ──────────────────────────────────────────────────────────────── */
.ar-reticle {
  position: relative;
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.15s;
}
.ar-reticle.hit { transform: scale(1.1); }

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
}

/* ── Fallback overlay ─────────────────────────────────────────────────────── */
.cam-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.fb-instruction {
  position: absolute;
  bottom: calc(130px + env(safe-area-inset-bottom, 0px));
  left: 16px;
  right: 16px;
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
