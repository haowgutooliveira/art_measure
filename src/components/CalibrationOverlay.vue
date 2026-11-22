<script setup>
import { ref, onMounted, onUnmounted, nextTick } from 'vue'

const props = defineProps({ imageDataUrl: { type: String, required: true } })
const emit  = defineEmits(['confirm'])

// ─── Image display size (for SVG viewBox) ─────────────────────────────────
const imgRef = ref(null)
const dispW  = ref(300)
const dispH  = ref(400)

function updateDispSize() {
  if (!imgRef.value) return
  dispW.value = imgRef.value.clientWidth
  dispH.value = imgRef.value.clientHeight
}

onMounted(async () => { await nextTick(); updateDispSize(); window.addEventListener('resize', updateDispSize) })
onUnmounted(() => window.removeEventListener('resize', updateDispSize))

// ─── Two-point tap state ───────────────────────────────────────────────────
const phase  = ref('tap1')   // 'tap1' | 'tap2' | 'confirm'
const p1     = ref(null)     // { x, y } in CSS px relative to image
const p2     = ref(null)
const realCm = ref(10)

function onTap(e) {
  if (phase.value === 'confirm') return
  const rect = imgRef.value.getBoundingClientRect()
  // Use first touch or mouse pointer
  const src = e.changedTouches ? e.changedTouches[0] : e
  const x = src.clientX - rect.left
  const y = src.clientY - rect.top
  if (phase.value === 'tap1') {
    p1.value = { x, y }
    phase.value = 'tap2'
  } else {
    p2.value = { x, y }
    phase.value = 'confirm'
  }
}

function reset() {
  p1.value = null; p2.value = null; phase.value = 'tap1'
}

function confirm() {
  const img    = imgRef.value
  const scale  = img.naturalWidth / img.clientWidth
  const dx     = (p2.value.x - p1.value.x) * scale
  const dy     = (p2.value.y - p1.value.y) * scale
  const pxDist = Math.sqrt(dx * dx + dy * dy)
  emit('confirm', pxDist / realCm.value)
}
</script>

<template>
  <div class="calib-wrap">

    <!-- ── Photo + tap overlay ──────────────────────────────────────────── -->
    <div
      class="calib-img-wrap"
      @click="onTap"
      @touchend.prevent="onTap"
    >
      <img
        ref="imgRef"
        :src="imageDataUrl"
        class="calib-img"
        draggable="false"
        @load="updateDispSize"
      />

      <!-- SVG: dots A/B + dashed line -->
      <svg
        class="calib-svg"
        :viewBox="`0 0 ${dispW} ${dispH}`"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
      >
        <line
          v-if="p1 && p2"
          :x1="p1.x" :y1="p1.y" :x2="p2.x" :y2="p2.y"
          stroke="#FFB703" stroke-width="2.5" stroke-dasharray="10 5"
        />
        <g v-if="p1">
          <circle :cx="p1.x" :cy="p1.y" r="16" fill="#FFB703" stroke="white" stroke-width="2.5" />
          <text
            :x="p1.x" :y="p1.y"
            text-anchor="middle" dominant-baseline="central"
            fill="#023047" font-weight="bold" font-size="14" font-family="system-ui, sans-serif"
          >A</text>
        </g>
        <g v-if="p2">
          <circle :cx="p2.x" :cy="p2.y" r="16" fill="#FFB703" stroke="white" stroke-width="2.5" />
          <text
            :x="p2.x" :y="p2.y"
            text-anchor="middle" dominant-baseline="central"
            fill="#023047" font-weight="bold" font-size="14" font-family="system-ui, sans-serif"
          >B</text>
        </g>
      </svg>

      <!-- Floating instruction pill -->
      <div v-if="phase !== 'confirm'" class="calib-hint">
        <span v-if="phase === 'tap1'">Toque no <strong>ponto A</strong></span>
        <span v-else>Toque no <strong>ponto B</strong></span>
      </div>
    </div>

    <!-- ── Below-image copy (phases 1 & 2) ─────────────────────────────── -->
    <div v-if="phase !== 'confirm'" class="calib-bottom-hint">
      <p v-if="phase === 'tap1'">
        Toque em dois pontos cujo tamanho real você conhece.<br/>
        <span class="hint-ex">Ex.: as pontas de uma tatuagem existente, largura do pulso…</span>
      </p>
      <p v-else>
        Agora toque no <strong>segundo ponto</strong> (ponto B).
      </p>
    </div>

    <!-- ── Confirm panel ────────────────────────────────────────────────── -->
    <div v-if="phase === 'confirm'" class="calib-panel">
      <p class="panel-title">Distância real A → B</p>

      <div class="panel-stepper">
        <button
          class="step-btn"
          aria-label="Diminuir 1 cm"
          @click="realCm = Math.max(1, realCm - 1)"
        >−</button>
        <span class="step-val">{{ realCm }} <span class="step-unit">cm</span></span>
        <button
          class="step-btn"
          aria-label="Aumentar 1 cm"
          @click="realCm = Math.min(100, realCm + 1)"
        >+</button>
      </div>

      <p class="panel-hint">
        Pulso ~6 cm &nbsp;·&nbsp; Dedo ~2 cm &nbsp;·&nbsp; Nó do dedo ~2,5 cm
      </p>

      <div class="panel-actions">
        <button class="btn btn-ghost btn-sm" @click="reset">Refazer pontos</button>
        <button class="btn btn-amber" @click="confirm">Confirmar →</button>
      </div>
    </div>

  </div>
</template>

<style scoped>
.calib-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  background: #000;
}

/* ── Image area ────────────────────────────────────────────────────────── */
.calib-img-wrap {
  position: relative;
  flex-shrink: 0;
  cursor: crosshair;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}

.calib-img {
  display: block;
  width: 100%;
  height: auto;
  user-select: none;
  pointer-events: none;   /* taps go to the wrapper */
}

.calib-svg {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  pointer-events: none;
  overflow: visible;
}

/* Floating pill */
.calib-hint {
  position: absolute;
  top: 12px; left: 50%; transform: translateX(-50%);
  background: rgba(2,30,45,0.88); backdrop-filter: blur(10px);
  border: 1px solid rgba(255,183,3,0.5);
  border-radius: 24px;
  padding: 8px 20px;
  font-size: 14px;
  color: var(--text-100);
  white-space: nowrap;
  pointer-events: none;
}
.calib-hint strong { color: var(--accent-amber); }

/* ── Below-image copy ──────────────────────────────────────────────────── */
.calib-bottom-hint {
  padding: 14px 20px;
  background: var(--bg-900);
  text-align: center;
  font-size: 13px;
  color: var(--text-300);
  line-height: 1.6;
}
.calib-bottom-hint strong { color: var(--accent-amber); }
.hint-ex {
  display: block;
  font-size: 11px;
  color: var(--bg-600);
  margin-top: 4px;
}

/* ── Confirm panel ─────────────────────────────────────────────────────── */
.calib-panel {
  background: var(--bg-800);
  border-top: 1px solid var(--bg-700);
  padding: 20px 20px calc(24px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-100);
  text-align: center;
  margin: 0;
}

.panel-stepper {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 20px;
}

.step-btn {
  width: 60px; height: 60px; border-radius: 50%;
  background: var(--bg-700);
  border: 2px solid var(--bg-600);
  color: var(--text-100);
  font-size: 30px; font-weight: 300; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.12s, transform 0.1s;
}
.step-btn:active { background: var(--bg-600); transform: scale(0.92); }

.step-val {
  font-size: 40px;
  font-weight: 800;
  color: var(--accent-amber);
  min-width: 110px;
  text-align: center;
  line-height: 1;
}
.step-unit { font-size: 18px; font-weight: 400; }

.panel-hint {
  font-size: 11px;
  color: var(--text-300);
  text-align: center;
  line-height: 1.5;
  margin: 0;
}

.panel-actions {
  display: flex;
  gap: 10px;
}
.panel-actions .btn { flex: 1; }
</style>
