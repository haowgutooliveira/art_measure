<script setup>
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'

const emit = defineEmits(['captured'])

const camState   = ref('checking')   // 'checking' | 'ready' | 'error'
const camError   = ref('')
const isFlashing = ref(false)

const videoRef    = ref(null)
const hiddenCanvas = ref(null)
let stream = null

const recoveryMsg = computed(() => {
  const ua = navigator.userAgent
  if (/iPhone|iPad/.test(ua)) return 'Ajustes → Safari → Câmera → Permitir'
  if (/Android/.test(ua))     return 'Configurações → Apps → Chrome → Permissões → Câmera'
  return 'Verifique as permissões de câmera nas configurações do navegador.'
})

onMounted(startCamera)
onUnmounted(stopCamera)

async function startCamera() {
  camState.value = 'checking'
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
    camError.value =
      err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError'
        ? 'Permissão de câmera negada.'
        : err.name === 'NotFoundError'
          ? 'Nenhuma câmera encontrada.'
          : 'Não foi possível acessar a câmera.'
  }
}

function stopCamera() { stream?.getTracks().forEach(t => t.stop()); stream = null }

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
      <video ref="videoRef" class="cam-video" autoplay muted playsinline />
      <div class="capture-flash" :class="{ flashing: isFlashing }" />

      <div class="cam-instruction">
        Enquadre a área · a escala será ajustada na próxima etapa
      </div>

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
.cam-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }

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

.capture-flash {
  position: fixed; inset: 0; background: #fff; opacity: 0;
  pointer-events: none; z-index: 9999; transition: opacity 0.08s ease-out;
}
.capture-flash.flashing { opacity: 0.85; }

.cam-instruction {
  position: absolute;
  bottom: calc(130px + env(safe-area-inset-bottom, 0px));
  left: 16px; right: 16px; text-align: center;
  background: rgba(2,30,45,0.80); backdrop-filter: blur(8px);
  border: 1px solid rgba(255,255,255,0.1); border-radius: 20px;
  padding: 8px 20px; font-size: 13px; line-height: 1.5; color: var(--text-100);
  pointer-events: none;
}

.cam-controls {
  position: absolute;
  bottom: 0; left: 0; right: 0;
  padding: 16px 24px calc(24px + env(safe-area-inset-bottom, 0px));
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(transparent, rgba(2,30,45,.88) 40%);
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
</style>
