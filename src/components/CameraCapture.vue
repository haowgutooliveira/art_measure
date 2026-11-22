<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useARCamera } from '../composables/useARCamera.js'

const emit = defineEmits(['captured'])

const ar = useARCamera()

// ─── States ───────────────────────────────────────────────────────────────────
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

// ─── Draggable reticle (AR mode) ──────────────────────────────────────────────
const reticleX = ref(0)   // absolute px, initialised on mount
const reticleY = ref(0)

function initReticleCenter() {
  reticleX.value = window.innerWidth  / 2
  reticleY.value = window.innerHeight / 2
}

function onOverlayPointerDown(e) {
  // ignore taps on the control bar (bottom 130 px + safe area)
  const safeBottom = 130 + (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sab') || '0') || 0)
  if (e.clientY > window.innerHeight - safeBottom) return
  moveReticle(e.clientX, e.clientY)
}

function onOverlayPointerMove(e) {
  if (e.buttons === 0 && e.type === 'pointermove') return   // hover only, ignore
  const safeBottom = 130
  if (e.clientY > window.innerHeight - safeBottom) return
  moveReticle(e.clientX, e.clientY)
}

function moveReticle(x, y) {
  reticleX.value = Math.max(30, Math.min(window.innerWidth  - 30, x))
  reticleY.value = Math.max(30, Math.min(window.innerHeight - 30, y))
  ar.setReticle(reticleX.value / window.innerWidth, reticleY.value / window.innerHeight)
}

// ─── Fallback: ring calibration (one-hand: +/- buttons, no pinch) ────────────
const H_FOV_RAD = (65 * Math.PI) / 180
const ringR     = ref(60)   // radius in CSS px, default

const ringDistCm = computed(() => {
  const focalCss = window.innerWidth / (2 * Math.tan(H_FOV_RAD / 2))
  return Math.round(focalCss * 10 / (ringR.value * 2))
})

function ringStep(direction) {
  // ±10% per tap, clamped to 20–200px radius
  ringR.value = Math.round(Math.min(200, Math.max(20, ringR.value * (direction > 0 ? 1.12 : 0.89))))
}

// ─── Distance display ─────────────────────────────────────────────────────────
const activeDist = computed(() =>
  mode.value === 'ar' ? ar.distanceCm.value : ringDistCm.value
)
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

// ─── Watch XR session end (Android back button, etc.) ────────────────────────
watch(() => ar.isActive.value, (active) => {
  if (!active && camState.value === 'ar-active') {
    showAROverlay.value = false
    startFallback()
  }
})

// ─── Init ─────────────────────────────────────────────────────────────────────
onMounted(async () => {
  ringR.value = Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.22)
  initReticleCenter()

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
  initReticleCenter()
  showAROverlay.value = true
  await nextTick()

  try {
    await ar.start(arOverlayRef.value)
    ar.setReticle(0.5, 0.5)   // start at centre; user can drag
    camState.value = 'ar-active'
  } catch {
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

  const scale  = Math.max(W / (video.clientWidth || window.innerWidth), H / (video.clientHeight || window.innerHeight))
  const ppc    = (ringR.value * 2 * scale) / 10

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
</script>

<template>
  <!-- ── AR Overlay ────────────────────────────────────────────────────────── -->
  <Teleport to="body">
    <div
      v-if="showAROverlay"
      ref="arOverlayRef"
      class="ar-overlay"
      @pointerdown="onOverlayPointerDown"
      @pointermove="onOverlayPointerMove"
    >

      <div class="capture-flash" :class="{ flashing: isFlashing }" />

      <template v-if="camState === 'ar-active'">
        <!-- Draggable reticle — position driven by reticleX/Y -->
        <div
          class="reticle-wrap"
          :style="{ left: reticleX + 'px', top: reticleY + 'px' }"
        >
          <div class="reticle" :class="{ hit: ar.hasHit.value }">
            <span class="r-h" /><span class="r-v" /><span class="r-ring" />
          </div>
          <!-- Distance badge BELOW the reticle -->
          <div class="reticle-badge" :class="{ hit: ar.hasHit.value }">
            <span v-if="distDisplay" class="badge-dist metric">{{ distDisplay }}</span>
            <span v-else class="badge-scanning">medindo…</span>
          </div>
        </div>

        <!-- Instruction -->
        <div class="cam-instruction">
          Toque para mover o ponto · aponte para a área da tatuagem
        </div>

        <!-- Shutter — bottom right, thumb zone -->
        <div class="cam-controls" @pointerdown.stop @pointermove.stop>
          <button
            class="shutter-btn"
            :disabled="!ar.hasHit.value"
            aria-label="Capturar foto"
            @click.stop="captureAR"
          >
            <span class="shutter-inner" />
          </button>
        </div>
      </template>

      <div v-if="camState === 'capturing'" class="ar-capturing">
        <div class="spinner" /><p>Capturando…</p>
      </div>
    </div>
  </Teleport>

  <!-- ── Shell ─────────────────────────────────────────────────────────────── -->
  <div class="cam-wrap">

    <div v-if="camState === 'checking' || camState === 'capturing' || camState === 'ar-active'" class="cam-state">
      <div v-if="camState !== 'ar-active'" class="spinner" />
      <p v-if="camState === 'checking'">Iniciando câmera…</p>
      <p v-else-if="camState === 'capturing'">Capturando…</p>
    </div>

    <div v-else-if="camState === 'error'" class="cam-state cam-error">
      <span class="cam-error-icon">📵</span>
      <p class="cam-error-msg">{{ camError }}</p>
      <p class="cam-recovery">📋 {{ recoveryMsg }}</p>
      <button class="btn btn-amber" @click="retryCamera">Tentar Novamente</button>
    </div>

    <!-- Fallback: plain camera + fixed ring + one-hand +/- buttons -->
    <template v-else-if="camState === 'fb-ready'">
      <video ref="fbVideoRef" class="cam-video" autoplay muted playsinline />
      <div class="capture-flash" :class="{ flashing: isFlashing }" />

      <!-- Fixed centre ring + badge — no drag, user points the phone -->
      <div class="cam-overlay">
        <div class="reticle-wrap">
          <div class="reticle-badge hit">
            <span v-if="distDisplay" class="badge-dist metric">{{ distDisplay }}</span>
          </div>
          <div class="fb-ring" :style="{ width: ringR * 2 + 'px', height: ringR * 2 + 'px' }">
            <span class="ring-label">10 cm</span>
          </div>
        </div>

        <!-- Instruction -->
        <div class="cam-instruction">
          Aponte a câmera · use <strong>−</strong> e <strong>+</strong> até o círculo cobrir <strong>10 cm</strong>
        </div>
      </div>

      <!-- Bottom bar: − ring + shutter + ring − (one-hand friendly) -->
      <div class="cam-controls">
        <button class="size-btn" aria-label="Diminuir referência" @click="ringStep(-1)">−</button>
        <button class="shutter-btn" aria-label="Capturar foto" @click="captureFallback">
          <span class="shutter-inner" />
        </button>
        <button class="size-btn" aria-label="Aumentar referência" @click="ringStep(1)">+</button>
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
.ar-overlay { position: fixed; inset: 0; z-index: 1000; }
.ar-capturing {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 16px;
  color: var(--text-300); pointer-events: none;
}

/* ── Fallback overlay ─────────────────────────────────────────────────────── */
.cam-overlay { position: absolute; inset: 0; pointer-events: none; }

/* ── Reticle — position driven by JS (draggable) ─────────────────────────── */
.reticle-wrap {
  position: absolute;
  transform: translate(-50%, -50%);
  display: flex; flex-direction: column; align-items: center;
  pointer-events: none; gap: 8px;
}

/* ── Distance badge ───────────────────────────────────────────────────────── */
.reticle-badge {
  display: flex; align-items: center; gap: 4px;
  background: rgba(2, 30, 45, 0.85); backdrop-filter: blur(10px);
  border: 1.5px solid rgba(239, 68, 68, 0.6); border-radius: 20px;
  padding: 5px 14px; white-space: nowrap; transition: border-color 0.2s;
}
.reticle-badge.hit { border-color: rgba(255, 183, 3, 0.8); }

.badge-dist    { font-size: 22px; font-weight: 700; color: var(--accent-amber); line-height: 1; }
.badge-scanning { font-size: 12px; color: var(--text-300); }

/* ── Crosshair ────────────────────────────────────────────────────────────── */
.reticle {
  position: relative; width: 60px; height: 60px;
  display: flex; align-items: center; justify-content: center;
  transition: transform 0.15s;
}
.reticle.hit { transform: scale(1.1); }

.r-ring {
  position: absolute; inset: 0; border-radius: 50%;
  border: 2px solid rgba(255, 183, 3, 0.4); transition: border-color 0.2s;
}
.reticle.hit .r-ring { border-color: rgba(255, 183, 3, 0.9); }

.r-h, .r-v { position: absolute; border-radius: 1px; }
.r-h { width: 22px; height: 2px; background: rgba(255,183,3,0.8); }
.r-v { width: 2px; height: 22px; background: rgba(255,183,3,0.8); }
.reticle.hit .r-h, .reticle.hit .r-v { background: #FFB703; }

/* ── Fallback ring ────────────────────────────────────────────────────────── */
.fb-ring {
  border-radius: 50%;
  border: 2.5px solid rgba(251, 135, 0, 0.9);
  box-shadow: 0 0 0 1px rgba(0,0,0,.5), 0 0 20px rgba(251,135,0,.25);
  display: flex; align-items: center; justify-content: center;
  transition: width 0.1s, height 0.1s;
}
.ring-label { font-size: 12px; font-weight: 700; color: rgba(251,135,0,1); text-shadow: 0 1px 4px rgba(0,0,0,.9); }

/* ── Instruction ──────────────────────────────────────────────────────────── */
.cam-instruction {
  position: absolute;
  bottom: calc(130px + env(safe-area-inset-bottom, 0px));
  left: 16px; right: 16px; text-align: center;
  background: rgba(2, 30, 45, 0.80); backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.1); border-radius: 20px;
  padding: 8px 20px; font-size: 13px; line-height: 1.5; color: var(--text-100);
  pointer-events: none;
}
.cam-instruction strong { color: var(--accent-amber); }

/* ── Bottom controls ──────────────────────────────────────────────────────── */
.cam-controls {
  position: absolute;  /* AR: fixed via parent; fallback: absolute */
  bottom: 0; left: 0; right: 0;
  padding: 16px 24px calc(24px + env(safe-area-inset-bottom, 0px));
  display: flex; align-items: center; justify-content: center; gap: 20px;
  background: linear-gradient(transparent, rgba(2,30,45,.88) 40%);
  pointer-events: auto;
}

/* AR overlay controls need fixed positioning */
.ar-overlay .cam-controls { position: fixed; }

/* ── Size buttons (fallback, one-hand) ───────────────────────────────────── */
.size-btn {
  width: 52px; height: 52px; border-radius: 50%;
  background: rgba(255,255,255,.12); border: 2px solid rgba(255,255,255,.5);
  color: #fff; font-size: 28px; font-weight: 300; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
  transition: background 0.15s, transform 0.1s;
}
.size-btn:active { background: rgba(255,255,255,.25); transform: scale(.93); }

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
