<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useDepthScale } from '../composables/useDepthScale.js'

const emit = defineEmits(['captured'])

const { distanceCm, distanceHint, calcPixelsPerCm, guideRingDiameter } = useDepthScale()

// ─── Camera state ─────────────────────────────────────────────────────────
const videoRef     = ref(null)
const hiddenCanvas = ref(null)
const overlayRef   = ref(null)
let   mediaStream  = null

const camState  = ref('idle')  // idle | loading | ready | error | captured
const camError  = ref('')
const isFlashing = ref(false)  // UX #1 — flash de captura

// ─── Guide ring ───────────────────────────────────────────────────────────
const ringDiameter = ref(100)

function updateRing() {
  if (!overlayRef.value) return
  ringDiameter.value = guideRingDiameter(overlayRef.value.clientWidth)
}

let ro = null

// ─── UX #12 — instruções de recovery específicas por SO ──────────────────
const recoveryInstructions = computed(() => {
  const ua = navigator.userAgent
  if (/iPhone|iPad/.test(ua))
    return 'iPhone/iPad: Ajustes → Safari → Câmera → Permitir'
  if (/Android/.test(ua))
    return 'Android: Configurações → Apps → Chrome → Permissões → Câmera'
  return 'Verifique as permissões de câmera nas configurações do navegador.'
})

// ─── Camera init ──────────────────────────────────────────────────────────
async function startCamera() {
  camState.value = 'loading'
  camError.value = ''
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    })
    camState.value = 'ready'
    await nextTick()
    videoRef.value.srcObject = mediaStream
    await videoRef.value.play()
    updateRing()
  } catch (err) {
    camState.value = 'error'
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      camError.value = 'Permissão de câmera negada.'
    } else if (err.name === 'NotFoundError') {
      camError.value = 'Nenhuma câmera encontrada neste dispositivo.'
    } else {
      camError.value = `Não foi possível acessar a câmera.`
    }
  }
}

function stopCamera() {
  mediaStream?.getTracks().forEach(t => t.stop())
  mediaStream = null
}

// ─── Capture com flash (UX #1) ────────────────────────────────────────────
function capture() {
  // Flash visual
  isFlashing.value = true
  setTimeout(() => { isFlashing.value = false }, 300)

  const video  = videoRef.value
  const canvas = hiddenCanvas.value
  const W = video.videoWidth, H = video.videoHeight
  canvas.width = W; canvas.height = H
  canvas.getContext('2d').drawImage(video, 0, 0, W, H)

  const imageDataUrl = canvas.toDataURL('image/jpeg', 0.92)
  const ppc          = calcPixelsPerCm(W)

  // Pequeno delay para o flash ser perceptível antes de trocar de tela
  setTimeout(() => {
    camState.value = 'captured'
    stopCamera()
    emit('captured', { imageDataUrl, pixelsPerCm: ppc, distanceCm: distanceCm.value })
  }, 220)
}

// ─── Lifecycle ────────────────────────────────────────────────────────────
onMounted(() => {
  startCamera()
  ro = new ResizeObserver(updateRing)
  if (overlayRef.value) ro.observe(overlayRef.value)
})
onUnmounted(() => { stopCamera(); ro?.disconnect() })
watch(distanceCm, updateRing)
</script>

<template>
  <div class="cam-wrap">

    <!-- ── Loading ──────────────────────────────────────────────────────── -->
    <div v-if="camState === 'loading'" class="cam-state">
      <div class="spinner"></div>
      <p>Abrindo câmera…</p>
    </div>

    <!-- ── Error ────────────────────────────────────────────────────────── -->
    <div v-else-if="camState === 'error'" class="cam-state cam-error">
      <span class="cam-error-icon">📵</span>
      <p class="cam-error-msg">{{ camError }}</p>
      <!-- UX #12 — instrução específica por SO -->
      <p class="cam-recovery">📋 {{ recoveryInstructions }}</p>
      <button class="btn btn-amber" @click="startCamera">Tentar Novamente</button>
    </div>

    <!-- ── Camera ready ──────────────────────────────────────────────────── -->
    <template v-else-if="camState === 'ready'">
      <video ref="videoRef" class="cam-video" autoplay muted playsinline />

      <!-- UX #1 — flash de captura -->
      <div class="capture-flash" :class="{ flashing: isFlashing }" />

      <!-- Guide overlay — UX #2 crosshair removido -->
      <div class="cam-overlay" ref="overlayRef">
        <div
          class="guide-ring"
          :style="{ width: ringDiameter + 'px', height: ringDiameter + 'px' }"
        >
          <span class="guide-label">≈ moeda R$1</span>
        </div>

        <!-- UX #3 — instrução com âncora concreta -->
        <div class="cam-instruction">
          Encaixe o anel ao redor de uma moeda R$1, depois capture
        </div>
      </div>

      <!-- Bottom controls -->
      <div class="cam-controls">
        <!-- UX #10 — role="status" aria-live no hint de distância -->
        <div
          class="dist-hint"
          :class="{ ok: distanceHint.ok }"
          role="status"
          aria-live="polite"
        >
          {{ distanceHint.text }}
        </div>

        <div class="dist-row">
          <span class="dist-label">{{ distanceCm }} cm</span>
          <div class="dist-slider-wrap">
            <span class="dist-icon">📱</span>
            <input
              type="range"
              class="dist-slider"
              min="15"
              max="60"
              step="1"
              v-model.number="distanceCm"
              aria-label="Distância do celular à superfície em centímetros"
              :aria-valuetext="`${distanceCm} centímetros — ${distanceHint.text}`"
            />
            <span class="dist-icon">🖐</span>
          </div>
          <!-- UX #3 — âncoras de distância descritivas -->
          <span class="dist-desc">perto ←&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;→ longe</span>
        </div>

        <!-- UX #10 — aria-label no shutter -->
        <button
          class="shutter-btn"
          @click="capture"
          :disabled="!distanceHint.ok"
          aria-label="Capturar foto"
        >
          <span class="shutter-inner" aria-hidden="true"></span>
        </button>
      </div>
    </template>

    <canvas ref="hiddenCanvas" style="display:none" />
  </div>
</template>

<style scoped>
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

/* ── UX #1 — Flash de captura ─────────────────────────────────────────── */
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

/* ── Loading / error ──────────────────────────────────────────────────── */
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

.cam-error     { color: #fca5a5; }
.cam-error-icon { font-size: 48px; }
.cam-error-msg  { font-size: 15px; line-height: 1.5; }

/* UX #12 — caixa de recovery */
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

/* ── Overlay — UX #2 crosshair removido ──────────────────────────────── */
.cam-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

.guide-ring {
  position: relative;
  border-radius: 50%;
  border: 2px dashed rgba(245,158,11,0.85);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(0,0,0,0.3);
  transition: width 0.15s, height 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* UX #3 — label mais descritivo */
.guide-label {
  font-size: 11px;
  font-weight: 700;
  color: rgba(245,158,11,0.95);
  text-shadow: 0 1px 4px rgba(0,0,0,0.95);
}

/* UX #3 — instrução com âncora concreta, sem whitespace:nowrap */
.cam-instruction {
  position: absolute;
  top: 12px;
  left: 16px;
  right: 16px;
  text-align: center;
  background: rgba(15,23,42,0.78);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 20px;
  padding: 7px 16px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--text-100);
}

/* ── Bottom controls ──────────────────────────────────────────────────── */
.cam-controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 12px 20px calc(20px + env(safe-area-inset-bottom, 0px));
  background: linear-gradient(transparent, rgba(15,23,42,0.92) 30%);
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
  background: rgba(239,68,68,0.2);
  border: 1px solid rgba(239,68,68,0.4);
  color: #fca5a5;
  transition: all 0.2s;
}
.dist-hint.ok {
  background: rgba(34,197,94,0.2);
  border-color: rgba(34,197,94,0.4);
  color: #86efac;
}

.dist-row {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.dist-label {
  font-size: 20px;
  font-weight: 800;
  color: var(--accent-amber);
  line-height: 1;
}

/* UX #3 — ícones de âncora no lugar de "15" / "60 cm" */
.dist-icon { font-size: 16px; }

.dist-slider-wrap {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
}

.dist-desc {
  font-size: 11px;
  color: var(--text-300);
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

.shutter-btn {
  width: 68px; height: 68px;
  border-radius: 50%;
  background: rgba(255,255,255,0.15);
  border: 3px solid rgba(255,255,255,0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.1s, opacity 0.15s;
  -webkit-tap-highlight-color: transparent;
  margin-top: 4px;
}
.shutter-btn:active   { transform: scale(0.9); }
.shutter-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.shutter-inner {
  width: 50px; height: 50px;
  border-radius: 50%;
  background: rgba(255,255,255,0.9);
}
</style>
