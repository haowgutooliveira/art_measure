<script setup>
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useDepthScale } from '../composables/useDepthScale.js'

const emit = defineEmits(['captured'])

// ─── Depth / scale composable ─────────────────────────────────────────────
const { distanceCm, distanceHint, calcPixelsPerCm, guideRingDiameter } = useDepthScale()

// ─── Camera state ─────────────────────────────────────────────────────────
const videoRef   = ref(null)
const hiddenCanvas = ref(null)
const overlayRef = ref(null)
let   mediaStream = null

const camState = ref('idle')   // idle | loading | ready | error | captured
const camError = ref('')

// ─── Guide ring ───────────────────────────────────────────────────────────
const ringDiameter = ref(100)  // css px; updated by ResizeObserver

function updateRing() {
  if (!overlayRef.value) return
  const w = overlayRef.value.clientWidth
  ringDiameter.value = guideRingDiameter(w)
}

let ro = null

// ─── Camera init ──────────────────────────────────────────────────────────
async function startCamera() {
  camState.value = 'loading'
  camError.value = ''
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width:  { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    })
    // Transition to 'ready' first so the <video> element renders,
    // then wait for the DOM update before setting srcObject.
    camState.value = 'ready'
    await nextTick()
    videoRef.value.srcObject = mediaStream
    await videoRef.value.play()
    updateRing()
  } catch (err) {
    camState.value = 'error'
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      camError.value = 'Permissão de câmera negada. Habilite nas configurações do navegador.'
    } else if (err.name === 'NotFoundError') {
      camError.value = 'Nenhuma câmera encontrada neste dispositivo.'
    } else {
      camError.value = `Erro ao acessar câmera: ${err.message}`
    }
  }
}

function stopCamera() {
  mediaStream?.getTracks().forEach(t => t.stop())
  mediaStream = null
}

// ─── Capture ──────────────────────────────────────────────────────────────
function capture() {
  const video  = videoRef.value
  const canvas = hiddenCanvas.value
  const W = video.videoWidth
  const H = video.videoHeight
  canvas.width  = W
  canvas.height = H
  canvas.getContext('2d').drawImage(video, 0, 0, W, H)

  const imageDataUrl  = canvas.toDataURL('image/jpeg', 0.92)
  const ppc           = calcPixelsPerCm(W)

  camState.value = 'captured'
  stopCamera()
  emit('captured', { imageDataUrl, pixelsPerCm: ppc, distanceCm: distanceCm.value })
}

// ─── Lifecycle ────────────────────────────────────────────────────────────
onMounted(() => {
  startCamera()
  ro = new ResizeObserver(updateRing)
  if (overlayRef.value) ro.observe(overlayRef.value)
})

onUnmounted(() => {
  stopCamera()
  ro?.disconnect()
})

watch(distanceCm, updateRing)
</script>

<template>
  <div class="cam-wrap">

    <!-- ── Loading ──────────────────────────────────────────────────── -->
    <div v-if="camState === 'loading'" class="cam-state">
      <div class="spinner"></div>
      <p>Abrindo câmera…</p>
    </div>

    <!-- ── Error ────────────────────────────────────────────────────── -->
    <div v-else-if="camState === 'error'" class="cam-state cam-error">
      <span class="cam-error-icon">📵</span>
      <p class="cam-error-msg">{{ camError }}</p>
      <button class="btn btn-amber" @click="startCamera">Tentar Novamente</button>
    </div>

    <!-- ── Camera ready ─────────────────────────────────────────────── -->
    <template v-else-if="camState === 'ready'">
      <!-- Live video -->
      <video
        ref="videoRef"
        class="cam-video"
        autoplay
        muted
        playsinline
      />

      <!-- Guide overlay -->
      <div class="cam-overlay" ref="overlayRef">
        <!-- Guide ring representing 10 cm at current distance -->
        <div
          class="guide-ring"
          :style="{
            width:  ringDiameter + 'px',
            height: ringDiameter + 'px',
          }"
        >
          <span class="guide-label">10 cm</span>
        </div>

        <!-- Crosshair lines -->
        <div class="crosshair-h"></div>
        <div class="crosshair-v"></div>

        <!-- Instruction banner -->
        <div class="cam-instruction">
          <span>📐 Aponte para a área da pele que receberá a tatuagem</span>
        </div>
      </div>

      <!-- Bottom controls -->
      <div class="cam-controls">

        <!-- Distance hint badge -->
        <div class="dist-hint" :class="{ ok: distanceHint.ok }">
          {{ distanceHint.text }}
        </div>

        <!-- Distance slider -->
        <div class="dist-row">
          <span class="dist-label">{{ distanceCm }} cm</span>
          <div class="dist-slider-wrap">
            <span class="dist-min">15</span>
            <input
              type="range"
              class="dist-slider"
              min="15"
              max="60"
              step="1"
              v-model.number="distanceCm"
            />
            <span class="dist-max">60 cm</span>
          </div>
          <span class="dist-desc">Distância celular ↔ pele</span>
        </div>

        <!-- Shutter -->
        <button class="shutter-btn" @click="capture" :disabled="!distanceHint.ok">
          <span class="shutter-inner"></span>
        </button>
      </div>
    </template>

    <!-- Hidden canvas for capture -->
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

/* ── Camera video ─────────────────────────────────────────────────────── */
.cam-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* ── Loading / error states ───────────────────────────────────────────── */
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

.cam-error { color: #fca5a5; }
.cam-error-icon { font-size: 48px; }
.cam-error-msg  { font-size: 15px; line-height: 1.5; }

.spinner {
  width: 40px; height: 40px;
  border: 3px solid var(--bg-700);
  border-top-color: var(--accent-amber);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Overlay ──────────────────────────────────────────────────────────── */
.cam-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}

/* Guide ring */
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

.guide-label {
  font-size: 11px;
  font-weight: 700;
  color: rgba(245,158,11,0.9);
  text-shadow: 0 1px 3px rgba(0,0,0,0.9);
  pointer-events: none;
}

/* Crosshair */
.crosshair-h,
.crosshair-v {
  position: absolute;
  background: rgba(255,255,255,0.25);
}
.crosshair-h { width: 100%; height: 1px; top: 50%; }
.crosshair-v { height: 100%; width: 1px; left: 50%; }

/* Instruction banner at top */
.cam-instruction {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  background: rgba(15,23,42,0.75);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 12px;
  color: var(--text-100);
  pointer-events: none;
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

/* Distance hint */
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

/* Distance slider row */
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

.dist-desc {
  font-size: 11px;
  color: var(--text-300);
}

.dist-slider-wrap {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
}

.dist-min, .dist-max {
  font-size: 11px;
  color: var(--text-300);
  white-space: nowrap;
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

/* Shutter button */
.shutter-btn {
  width: 68px;
  height: 68px;
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

.shutter-btn:active { transform: scale(0.9); }

.shutter-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.shutter-inner {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: rgba(255,255,255,0.9);
}
</style>
