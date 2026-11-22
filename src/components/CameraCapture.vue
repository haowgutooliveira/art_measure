<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useARCamera } from '../composables/useARCamera.js'
import { useDepthScale } from '../composables/useDepthScale.js'

const emit = defineEmits(['captured'])

// ─── Composables ──────────────────────────────────────────────────────────────
const ar = useARCamera()
const fb = useDepthScale()   // fallback: manual slider

// ─── State machine ────────────────────────────────────────────────────────────
// States:  'checking' | 'ar-active' | 'capturing' | 'fb-loading' | 'fb-ready' | 'error' | 'done'
const camState   = ref('checking')
const camError   = ref('')
const isFlashing = ref(false)

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const arOverlayRef  = ref(null)   // full-screen AR overlay (<Teleport> target)
const fbVideoRef    = ref(null)   // fallback <video>
const hiddenCanvas  = ref(null)
let   fbStream      = null

// ─── OS-specific recovery instructions ───────────────────────────────────────
const recoveryInstructions = computed(() => {
  const ua = navigator.userAgent
  if (/iPhone|iPad/.test(ua)) return 'iPhone/iPad: Ajustes → Safari → Câmera → Permitir'
  if (/Android/.test(ua))     return 'Android: Configurações → Apps → Chrome → Permissões → Câmera'
  return 'Verifique as permissões de câmera nas configurações do navegador.'
})

// ─── Distance display ─────────────────────────────────────────────────────────
const displayDist = computed(() => {
  if (camState.value === 'ar-active') return ar.distanceCm.value
  return fb.distanceCm.value
})

const distStatus = computed(() => {
  const d = displayDist.value
  if (d === null || d === undefined) return { text: 'Apontando para a área…', ok: false }
  if (d < 10)  return { text: 'Muito perto', ok: false }
  if (d > 80)  return { text: 'Muito longe', ok: false }
  return { text: 'Distância ideal ✓', ok: true }
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
    // Ensure overlay element is in the DOM before XR session requests it
    await nextTick()
    await ar.start(arOverlayRef.value)
    camState.value = 'ar-active'
  } catch (err) {
    // AR failed — fall back to manual slider
    await startFallback()
  }
}

async function captureAR() {
  if (!distStatus.value.ok) return

  isFlashing.value = true
  setTimeout(() => { isFlashing.value = false }, 300)

  camState.value = 'capturing'

  try {
    // Lock distance and release XR camera
    // We'll capture the actual image width after getUserMedia
    const tempWidth = 1920
    const { lockedDistanceCm, pixelsPerCm: tempPpc } = await ar.lockAndRelease(tempWidth)

    // Now capture via getUserMedia
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    })

    const video = document.createElement('video')
    video.srcObject = stream
    video.muted = true
    video.playsInline = true
    await video.play()

    // Wait one more frame for video to have pixels
    await new Promise(r => requestAnimationFrame(r))

    const W = video.videoWidth || 1920
    const H = video.videoHeight || 1080

    const canvas = hiddenCanvas.value
    canvas.width  = W
    canvas.height = H
    canvas.getContext('2d').drawImage(video, 0, 0, W, H)

    stream.getTracks().forEach(t => t.stop())

    const imageDataUrl = canvas.toDataURL('image/jpeg', 0.92)
    // Recalculate ppc with actual image width
    const pixelsPerCm  = ar.calcPixelsPerCm(W, lockedDistanceCm)

    camState.value = 'done'
    emit('captured', { imageDataUrl, pixelsPerCm, distanceCm: lockedDistanceCm })
  } catch (err) {
    camError.value  = 'Não foi possível capturar a foto.'
    camState.value  = 'error'
  }
}

// ─── Fallback mode ────────────────────────────────────────────────────────────
async function startFallback() {
  camState.value = 'fb-loading'
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
  const pixelsPerCm  = fb.calcPixelsPerCm(W)

  setTimeout(() => {
    camState.value = 'done'
    stopFallback()
    emit('captured', { imageDataUrl, pixelsPerCm, distanceCm: fb.distanceCm.value })
  }, 220)
}

function retryCamera() {
  if (ar.isSupported.value) {
    startAR()
  } else {
    startFallback()
  }
}
</script>

<template>
  <!-- ── AR overlay (Teleport so XR dom-overlay works) ──────────────────────── -->
  <Teleport to="body">
    <div
      v-if="camState === 'ar-active' || camState === 'capturing'"
      ref="arOverlayRef"
      class="ar-overlay"
    >
      <!-- Flash -->
      <div class="capture-flash" :class="{ flashing: isFlashing }" />

      <!-- Reticle — centred crosshair pointing at the surface -->
      <div class="ar-reticle" :class="{ hit: ar.hasHit.value }">
        <span class="reticle-h" /><span class="reticle-v" />
        <span class="reticle-ring" />
      </div>

      <!-- Distance badge -->
      <div class="ar-dist-badge" :class="{ ok: distStatus.ok }">
        <span v-if="displayDist !== null" class="dist-num metric">{{ displayDist }}</span>
        <span v-if="displayDist !== null" class="dist-unit">cm</span>
        <span class="dist-status">{{ distStatus.text }}</span>
      </div>

      <!-- Instruction -->
      <div class="ar-instruction">
        Aponte a câmera para a área a ser tatuada
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

  <!-- ── Main component shell ───────────────────────────────────────────────── -->
  <div class="cam-wrap">

    <!-- ── Checking / AR active (placeholder while Teleport overlay runs) ───── -->
    <div v-if="camState === 'checking' || camState === 'ar-active' || camState === 'capturing'" class="cam-state">
      <div class="spinner" />
      <p v-if="camState === 'checking'">Iniciando câmera…</p>
      <p v-else-if="camState === 'capturing'">Capturando…</p>
      <!-- AR active: the Teleport overlay handles everything; show nothing here -->
    </div>

    <!-- ── Error ───────────────────────────────────────────────────────────── -->
    <div v-else-if="camState === 'error'" class="cam-state cam-error">
      <span class="cam-error-icon">📵</span>
      <p class="cam-error-msg">{{ camError }}</p>
      <p class="cam-recovery">📋 {{ recoveryInstructions }}</p>
      <button class="btn btn-amber" @click="retryCamera">Tentar Novamente</button>
    </div>

    <!-- ── Fallback: manual video + slider ────────────────────────────────── -->
    <template v-else-if="camState === 'fb-loading' || camState === 'fb-ready'">

      <div v-if="camState === 'fb-loading'" class="cam-state">
        <div class="spinner" />
        <p>Abrindo câmera…</p>
      </div>

      <template v-else>
        <video ref="fbVideoRef" class="cam-video" autoplay muted playsinline />

        <!-- Flash -->
        <div class="capture-flash" :class="{ flashing: isFlashing }" />

        <!-- Bottom controls -->
        <div class="cam-controls">
          <div
            class="dist-hint"
            :class="{ ok: fb.distanceHint.value.ok }"
            role="status"
            aria-live="polite"
          >
            {{ fb.distanceHint.value.text }}
          </div>

          <div class="dist-row">
            <span class="dist-label metric">{{ fb.distanceCm.value }} cm</span>
            <div class="dist-slider-wrap">
              <span class="dist-icon">📱</span>
              <input
                type="range"
                class="dist-slider"
                min="15"
                max="60"
                step="1"
                v-model.number="fb.distanceCm.value"
                aria-label="Distância do celular à superfície em centímetros"
                :aria-valuetext="`${fb.distanceCm.value} centímetros — ${fb.distanceHint.value.text}`"
              />
              <span class="dist-icon">🖐</span>
            </div>
            <span class="dist-desc">perto ←&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→ longe</span>
          </div>

          <button
            class="shutter-btn"
            @click="captureFallback"
            :disabled="!fb.distanceHint.value.ok"
            aria-label="Capturar foto"
          >
            <span class="shutter-inner" aria-hidden="true" />
          </button>
        </div>
      </template>
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
.cam-error         { color: #fca5a5; }
.cam-error-icon    { font-size: 48px; }
.cam-error-msg     { font-size: 15px; line-height: 1.5; }
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

/* ── Capture flash (shared) ───────────────────────────────────────────────── */
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
  /* transparent — XR camera passthrough is behind */
  pointer-events: none;
}
/* Re-enable pointer events only on interactive children */
.ar-overlay .ar-controls,
.ar-overlay .shutter-btn {
  pointer-events: auto;
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
  background: rgba(255, 183, 3, 0.85);
  border-radius: 1px;
}
.reticle-h { width: 24px; height: 2px; }
.reticle-v { width: 2px;  height: 24px; }
.ar-reticle.hit .reticle-h,
.ar-reticle.hit .reticle-v { background: #FFB703; }

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
  transition: border-color 0.25s, background 0.25s;
  pointer-events: none;
}
.ar-dist-badge.ok {
  border-color: rgba(46, 196, 182, 0.6);
  background: rgba(2, 30, 45, 0.82);
}

.dist-num {
  font-size: 24px;
  font-weight: 700;
  color: #fca5a5;
  line-height: 1;
  transition: color 0.25s;
}
.ar-dist-badge.ok .dist-num { color: var(--accent-amber); }

.dist-unit {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-300);
  margin-right: 6px;
}
.dist-status {
  font-size: 12px;
  font-weight: 600;
  color: #fca5a5;
  transition: color 0.25s;
}
.ar-dist-badge.ok .dist-status { color: #2EC4B6; }

/* ── AR instruction ───────────────────────────────────────────────────────── */
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

/* ── AR controls ──────────────────────────────────────────────────────────── */
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

/* ── Fallback bottom controls ─────────────────────────────────────────────── */
.cam-controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 12px 20px calc(20px + env(safe-area-inset-bottom, 0px));
  background: linear-gradient(transparent, rgba(2, 30, 45, 0.92) 30%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.dist-hint {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 14px;
  border-radius: 20px;
  background: rgba(239, 68, 68, 0.2);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #fca5a5;
  transition: all 0.2s;
}
.dist-hint.ok {
  background: rgba(46, 196, 182, 0.2);
  border-color: rgba(46, 196, 182, 0.4);
  color: #2EC4B6;
}

.dist-row {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.dist-label { font-size: 20px; font-weight: 800; color: var(--accent-amber); line-height: 1; }
.dist-icon  { font-size: 16px; }
.dist-desc  { font-size: 11px; color: var(--text-300); }

.dist-slider-wrap {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
}
.dist-slider {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 4px;
  border-radius: 2px;
  background: var(--bg-600);
  outline: none;
  cursor: pointer;
}
.dist-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 22px; height: 22px;
  border-radius: 50%;
  background: var(--accent-amber);
  cursor: pointer;
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.5);
}

/* ── Shutter button (shared) ──────────────────────────────────────────────── */
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
