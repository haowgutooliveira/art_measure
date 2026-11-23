<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'

const emit = defineEmits(['captured'])

const camState   = ref('checking')   // 'checking' | 'ready' | 'error'
const camError   = ref('')
const isFlashing = ref(false)

const videoRef     = ref(null)
const hiddenCanvas = ref(null)
let stream      = null
let videoTrack  = null
let focusCaps   = null   // track.getCapabilities().focusDistance range

// ─── Distance measurement state ───────────────────────────────────────────
const supportsFocus = ref(false)   // browser + device supports focusDistance
const distCm        = ref(null)    // measured distance in cm, null = not yet
const distState     = ref('idle')  // 'idle' | 'measuring' | 'done'
const reticle       = ref(null)    // { px, py } percent (0–100) of viewfinder

// Zone derived from distance
const zone = computed(() => {
  const d = distCm.value
  if (d === null) return null
  if (d < 15)   return { ok: false, label: `${d} cm — Afaste a câmera`,    color: '#ef4444' }
  if (d <= 65)  return { ok: true,  label: `${d} cm — Distância ideal ✓`,  color: '#22c55e' }
  return         { ok: false, label: `${d} cm — Aproxime a câmera`,        color: '#f59e0b' }
})

const recoveryMsg = computed(() => {
  const ua = navigator.userAgent
  if (/iPhone|iPad/.test(ua)) return 'Ajustes → Safari → Câmera → Permitir'
  if (/Android/.test(ua))     return 'Configurações → Apps → Chrome → Permissões → Câmera'
  return 'Verifique as permissões de câmera nas configurações do navegador.'
})

// ─── Camera lifecycle ─────────────────────────────────────────────────────
onMounted(startCamera)
onUnmounted(stopCamera)

async function startCamera() {
  camState.value  = 'checking'
  camError.value  = ''
  supportsFocus.value = false
  distCm.value    = null
  distState.value = 'idle'
  reticle.value   = null

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    })
    videoTrack = stream.getVideoTracks()[0]

    // Detect focusDistance support
    if (videoTrack.getCapabilities) {
      const caps = videoTrack.getCapabilities()
      if (caps.focusDistance) {
        focusCaps = caps.focusDistance   // { min, max, step }
        supportsFocus.value = true
      }
    }

    camState.value = 'ready'
    await nextTick()
    videoRef.value.srcObject = stream
    await videoRef.value.play()
  } catch (err) {
    camState.value = 'error'
    camError.value =
      err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
        ? 'Permissão de câmera negada.'
        : err.name === 'NotFoundError'
          ? 'Nenhuma câmera encontrada.'
          : 'Não foi possível acessar a câmera.'
  }
}

function stopCamera() {
  stream?.getTracks().forEach(t => t.stop())
  stream = null; videoTrack = null; focusCaps = null
}

// ─── Tap-to-measure ──────────────────────────────────────────────────────
async function onViewfinderTap(e) {
  if (!supportsFocus.value || !videoTrack) return
  e.preventDefault()

  const rect = videoRef.value.getBoundingClientRect()
  const src  = e.touches?.[0] ?? e
  const relX = (src.clientX - rect.left) / rect.width
  const relY = (src.clientY - rect.top)  / rect.height
  const px   = relX * 100
  const py   = relY * 100

  reticle.value   = { px, py }
  distState.value = 'measuring'
  distCm.value    = null

  try {
    await videoTrack.applyConstraints({
      advanced: [{ pointsOfInterest: [{ x: relX, y: relY }] }],
    })
  } catch (_) { /* pointsOfInterest may not be supported even when focusDistance is */ }

  // AF needs ~600–900 ms to settle
  setTimeout(() => {
    if (!videoTrack) return
    const settings = videoTrack.getSettings()
    const raw = settings.focusDistance

    if (raw == null || raw === 0) {
      distState.value = 'idle'
      return
    }

    // Heuristic: values > 10 are likely diopters (1/m), convert to meters
    const meters = raw > 10 ? 1 / raw : raw
    distCm.value    = Math.round(meters * 100)
    distState.value = 'done'
  }, 850)
}

// ─── Capture ──────────────────────────────────────────────────────────────
function capture() {
  isFlashing.value = true
  setTimeout(() => { isFlashing.value = false }, 300)

  const video  = videoRef.value
  const canvas = hiddenCanvas.value
  const W = video.videoWidth, H = video.videoHeight
  canvas.width = W; canvas.height = H
  canvas.getContext('2d').drawImage(video, 0, 0, W, H)

  setTimeout(() => {
    stopCamera()
    emit('captured', { imageDataUrl: canvas.toDataURL('image/jpeg', 0.92) })
  }, 220)
}
</script>

<template>
  <div class="cam-wrap">

    <!-- Loading / error states ──────────────────────────────────────────── -->
    <div v-if="camState === 'checking'" class="cam-state">
      <div class="spinner" />
      <p>Iniciando câmera…</p>
    </div>

    <div v-else-if="camState === 'error'" class="cam-state cam-error">
      <span class="cam-error-icon">📵</span>
      <p class="cam-error-msg">{{ camError }}</p>
      <p class="cam-recovery">📋 {{ recoveryMsg }}</p>
      <button class="btn btn-amber" @click="startCamera">Tentar Novamente</button>
    </div>

    <!-- Live viewfinder ─────────────────────────────────────────────────── -->
    <template v-else>
      <!-- Video: tap fires focus+distance when supported -->
      <video
        ref="videoRef"
        class="cam-video"
        autoplay muted playsinline
        @click="onViewfinderTap"
        @touchstart.prevent="onViewfinderTap"
      />

      <!-- Tap reticle + distance badge ───────────────────────────────── -->
      <transition name="reticle-fade">
        <div
          v-if="reticle"
          class="cam-reticle"
          :style="{ left: reticle.px + '%', top: reticle.py + '%' }"
        >
          <div class="reticle-ring" :class="{ measuring: distState === 'measuring', ok: zone?.ok === true, bad: zone?.ok === false }" />

          <!-- Distance badge, appears when done -->
          <transition name="badge-pop">
            <div v-if="distState === 'done' && zone" class="reticle-badge" :style="{ borderColor: zone.color }">
              <span :style="{ color: zone.color }">{{ zone.label }}</span>
            </div>
          </transition>

          <!-- Measuring spinner on reticle -->
          <div v-if="distState === 'measuring'" class="reticle-spinner" />
        </div>
      </transition>

      <!-- Distance guide bar ──────────────────────────────────────────── -->
      <div class="cam-dist-guide">
        <template v-if="supportsFocus">
          <span class="guide-label">
            {{ distState === 'idle'      ? 'Toque na tela para medir a distância' :
               distState === 'measuring' ? 'Medindo…' :
               distState === 'done'      ? zone?.label : '' }}
          </span>
        </template>
        <template v-else>
          <span class="guide-label">Mantenha a câmera a <strong>30–50 cm</strong> da pele</span>
        </template>
      </div>

      <div class="capture-flash" :class="{ flashing: isFlashing }" />

      <div class="cam-controls">
        <button class="shutter-btn" aria-label="Capturar foto" @click="capture">
          <span class="shutter-inner" />
        </button>
      </div>
    </template>

    <canvas ref="hiddenCanvas" style="display:none" />
  </div>
</template>

<style scoped>
.cam-wrap {
  flex: 1; position: relative; display: flex; flex-direction: column;
  overflow: hidden; background: #000;
}
.cam-video {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover;
  cursor: crosshair;
}

/* ── States ──────────────────────────────────────────────────────────────── */
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

/* ── Flash ───────────────────────────────────────────────────────────────── */
.capture-flash {
  position: fixed; inset: 0; background: #fff; opacity: 0;
  pointer-events: none; z-index: 9999; transition: opacity 0.08s ease-out;
}
.capture-flash.flashing { opacity: 0.85; }

/* ── Tap reticle ─────────────────────────────────────────────────────────── */
.cam-reticle {
  position: absolute;
  transform: translate(-50%, -50%);
  pointer-events: none;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.reticle-ring {
  width: 64px; height: 64px;
  border-radius: 50%;
  border: 2.5px solid rgba(255,255,255,0.9);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.4);
  transition: border-color 0.3s;
  position: relative;
}
.reticle-ring::before,
.reticle-ring::after {
  content: '';
  position: absolute;
  background: rgba(255,255,255,0.9);
}
/* Crosshair lines */
.reticle-ring::before { width: 1px; height: 10px; left: 50%; top: -13px; transform: translateX(-50%); }
.reticle-ring::after  { width: 10px; height: 1px; top: 50%; left: -13px; transform: translateY(-50%); }

.reticle-ring.measuring { border-color: #f59e0b; animation: ring-pulse 0.9s ease-in-out infinite; }
.reticle-ring.ok        { border-color: #22c55e; }
.reticle-ring.bad       { border-color: #ef4444; }

@keyframes ring-pulse {
  0%, 100% { transform: scale(1);    opacity: 1;   }
  50%       { transform: scale(1.1); opacity: 0.7; }
}

.reticle-spinner {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 2px solid transparent;
  border-top-color: #f59e0b;
  animation: spin 0.7s linear infinite;
}

.reticle-badge {
  background: rgba(2, 20, 38, 0.88);
  backdrop-filter: blur(8px);
  border: 1.5px solid;
  border-radius: 20px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  color: #fff;
}

/* ── Distance guide bar ──────────────────────────────────────────────────── */
.cam-dist-guide {
  position: absolute;
  top: 16px;
  left: 16px; right: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  pointer-events: none;
  z-index: 10;
}

.guide-label {
  display: block;
  background: rgba(2,30,45,0.80);
  backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 20px;
  padding: 8px 20px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-100);
  text-align: center;
}
.guide-label strong { color: var(--accent-amber); }

/* ── Shutter ─────────────────────────────────────────────────────────────── */
.cam-controls {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  padding: 16px 24px calc(24px + env(safe-area-inset-bottom, 0px));
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(transparent, rgba(2,30,45,.88) 40%);
  z-index: 10;
}
.shutter-btn {
  width: 72px; height: 72px; border-radius: 50%;
  background: rgba(255,255,255,.15); border: 3px solid rgba(255,255,255,.85);
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: transform .1s;
  -webkit-tap-highlight-color: transparent;
}
.shutter-btn:active { transform: scale(.9); }
.shutter-inner { width: 54px; height: 54px; border-radius: 50%; background: rgba(255,255,255,.9); }

/* ── Transitions ─────────────────────────────────────────────────────────── */
.reticle-fade-enter-active { transition: opacity 0.15s; }
.reticle-fade-leave-active { transition: opacity 0.3s; }
.reticle-fade-enter-from,
.reticle-fade-leave-to     { opacity: 0; }

.badge-pop-enter-active { transition: opacity 0.2s, transform 0.2s; }
.badge-pop-enter-from   { opacity: 0; transform: translateY(-6px) scale(0.9); }
</style>
