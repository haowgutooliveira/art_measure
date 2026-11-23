<script setup>
import { ref } from 'vue'
import CameraCapture       from './components/CameraCapture.vue'
import CalibrationOverlay  from './components/CalibrationOverlay.vue'
import MeasureCanvas       from './components/MeasureCanvas.vue'
import { useShoelaceArea } from './composables/useShoelaceArea.js'

// ─── Global state ─────────────────────────────────────────────────────────
const step              = ref(0)   // 0=intro  1=camera  2=calibration  3=measure  4=summary
const showRestartModal  = ref(false)
const showTechDetails   = ref(false)
const imageDataUrl  = ref(null)
const snapshotUrl   = ref(null)
const pixelsPerCm   = ref(1)
const polygonPoints = ref([])
const measureMode   = ref('polygon')   // 'ruler' | 'polygon'
const rulerDistCm   = ref(null)        // used when mode=ruler

// ─── Summary form ─────────────────────────────────────────────────────────
const clientName    = ref('')
const observations  = ref('')
const tattooPhone   = ref('')

// ─── Area calculations ────────────────────────────────────────────────────
const { areaCm2, boundingBox, formatWhatsApp } = useShoelaceArea(polygonPoints, pixelsPerCm)

// ─── Handlers ─────────────────────────────────────────────────────────────
function onCaptured({ imageDataUrl: url }) {
  imageDataUrl.value = url
  step.value = 2   // go to calibration
}

function onCalibrated(ppc) {
  pixelsPerCm.value = ppc
  step.value = 3   // go to drawing
}

function onDrawingComplete({ mode, points, distanceCm, snapshotUrl: snap }) {
  measureMode.value   = mode
  polygonPoints.value = points ?? []
  rulerDistCm.value   = distanceCm ?? null
  snapshotUrl.value   = snap
  step.value = 4
}

function sendWhatsApp() {
  const msg   = formatWhatsApp(clientName.value, observations.value)
  const phone = tattooPhone.value.replace(/\D/g, '')
  const url   = phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
    : `https://wa.me/?text=${encodeURIComponent(msg)}`
  window.open(url, '_blank', 'noopener')
}

// UX #5 — confirmação antes de reiniciar
function confirmRestart() { showRestartModal.value = true }
function cancelRestart()  { showRestartModal.value = false }

function restart() {
  showRestartModal.value = false
  step.value = 0
  imageDataUrl.value  = null
  snapshotUrl.value   = null
  polygonPoints.value = []
  clientName.value    = ''
  observations.value  = ''
  tattooPhone.value   = ''
  pixelsPerCm.value   = 1
  measureMode.value   = 'polygon'
  rulerDistCm.value   = null
  showTechDetails.value = false
}

function goBack() {
  if (step.value === 4) { step.value = 3; polygonPoints.value = []; return }
  if (step.value > 0)   { step.value-- }
}

const STEPS = ['Câmera', 'Escala', 'Medir', 'Resultado']
</script>

<template>
  <div class="app">

    <!-- ── Header ──────────────────────────────────────────────────────── -->
    <header class="app-header">
      <div class="header-left">
        <!-- UX #9 — área de toque maior via padding -->
        <button v-if="step > 0" class="back-btn" @click="goBack" aria-label="Voltar">←</button>
      </div>
      <div class="logo">
        <!-- Logo T/A oficial — Esquadro com agulha de escala -->
        <svg class="logo-ta" viewBox="6 10 52 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <g stroke="#FFB703" stroke-width="4" stroke-linecap="butt">
            <path d="M32 20V58.75M14.25 20H49.75"/>
          </g>
          <defs>
            <clipPath id="ta-logo">
              <path d="M29.42 20H34.58L50.08 58.75H13.92Z"/>
            </clipPath>
          </defs>
          <path clip-path="url(#ta-logo)" fill="none" stroke="#FFB703" stroke-width="4" d="M20.6 37.5A20.9 20.9 0 0 0 43.4 37.5"/>
          <path fill="#FFB703" d="M29.42 20H34.58L50.08 58.75H45.78L32 24.31L18.22 58.75H13.92Z"/>
          <rect x="8" y="12" width="48" height="48" stroke="#FFB703" stroke-width="3"/>
        </svg>
        <span class="logo-text">Tamanho <span class="logo-accent">da Arte</span></span>
      </div>
      <div class="header-right"></div>
    </header>

    <!-- ── Stepper (steps 1-3) ─────────────────────────────────────────── -->
    <div v-if="step >= 1" class="stepper">
      <template v-for="(label, i) in STEPS" :key="i">
        <div
          class="step-item"
          :class="{ active: step === i + 1, completed: step > i + 1 }"
        >
          <div class="step-dot">
            <span v-if="step > i + 1">✓</span>
            <span v-else>{{ i + 1 }}</span>
          </div>
          <span class="step-label">{{ label }}</span>
        </div>
        <div v-if="i < STEPS.length - 1" class="step-line" :class="{ done: step > i + 1 }" />
      </template>
    </div>

    <!-- ── Step 0 — Intro ──────────────────────────────────────────────── -->
    <div v-if="step === 0" class="page page-intro">
      <div class="intro-hero">
        <!-- Logo T/A expandido na tela de intro -->
        <div class="intro-icon-wrap">
          <svg viewBox="0 0 64 72" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="width:52px;height:58px">
            <g stroke="#FFB703" stroke-width="3.5" stroke-linecap="butt">
              <path d="M32 20V58.75M14.25 20H49.75"/>
            </g>
            <defs>
              <clipPath id="ta-intro">
                <path d="M29.74 20H34.26L49.76 58.75H14.24Z"/>
              </clipPath>
            </defs>
            <path clip-path="url(#ta-intro)" fill="none" stroke="#FFB703" stroke-width="3.5" d="M20.6 37.5A20.9 20.9 0 0 0 43.4 37.5"/>
            <path fill="#FFB703" d="M29.74 20H34.26L49.76 58.75H45.99L32 23.77L18.01 58.75H14.24Z"/>
            <rect x="8" y="12" width="48" height="48" stroke="#FFB703" stroke-width="2.5"/>
            <path d="M32 2V8M29 5H35M44 64V70M56 64V70M45 67H55M47 65.5L45 67L47 68.5M53 65.5L55 67L53 68.5" stroke="#FFB703" stroke-width="1.5"/>
          </svg>
        </div>
        <!-- UX #8 — título generalizado -->
        <h1 class="intro-title">Meça antes de criar</h1>
        <p class="intro-sub">
          Fotografe a superfície, risque a área da arte<br/>
          e envie o tamanho exato para o artista.
        </p>
      </div>

      <button class="btn btn-amber btn-full btn-lg" @click="step = 1">
        📷 Iniciar Medição
      </button>

      <!-- How it works -->
      <div class="how-list">
        <div class="how-item">
          <div class="how-num">1</div>
          <div>
            <strong>Câmera</strong>
            <p>Enquadre a área e capture a foto. Sem configurações — só apertar o botão.</p>
          </div>
        </div>
        <div class="how-item">
          <div class="how-num">2</div>
          <div>
            <strong>Escala</strong>
            <p>Na foto, toque em dois pontos cujo tamanho você conhece (ex.: largura do pulso = 6 cm). O app calcula a escala real automaticamente.</p>
          </div>
        </div>
        <div class="how-item">
          <div class="how-num">3</div>
          <div>
            <strong>Medir</strong>
            <p>Toque nos pontos do contorno da arte. Use o modo <strong>📏 Fita</strong> para uma distância ou <strong>📐 Área</strong> para o polígono completo.</p>
          </div>
        </div>
        <div class="how-item">
          <div class="how-num">4</div>
          <div>
            <strong>Resultado</strong>
            <p>Veja a área em cm² e as dimensões. Envie direto para o artista pelo WhatsApp.</p>
          </div>
        </div>
      </div>

      <p class="intro-note">
        🔒 Nenhuma foto é enviada para servidores — tudo fica no seu celular.
      </p>
    </div>

    <!-- ── Step 1 — Camera capture ─────────────────────────────────────── -->
    <CameraCapture
      v-if="step === 1"
      @captured="onCaptured"
    />

    <!-- ── Step 2 — Scale calibration ───────────────────────────────────── -->
    <CalibrationOverlay
      v-if="step === 2 && imageDataUrl"
      :imageDataUrl="imageDataUrl"
      @confirm="onCalibrated"
    />

    <!-- ── Step 3 — Measure ──────────────────────────────────────────── -->
    <MeasureCanvas
      v-if="step === 3 && imageDataUrl"
      :imageDataUrl="imageDataUrl"
      :pixelsPerCm="pixelsPerCm"
      @complete="onDrawingComplete"
    />

    <!-- ── Step 4 — Summary ────────────────────────────────────────────── -->
    <div v-if="step === 4" class="page page-summary">

      <!-- Snapshot preview -->
      <div v-if="snapshotUrl" class="snapshot-wrap">
        <!-- UX #7 — alt dinâmico com as métricas -->
        <img
          :src="snapshotUrl"
          class="snapshot-img"
          :alt="`Área marcada: ${areaCm2.toFixed(1)} cm², ${boundingBox.widthCm.toFixed(1)} × ${boundingBox.heightCm.toFixed(1)} cm`"
        />
        <div class="snapshot-caption">Confirme se a área marcada está correta</div>
      </div>

      <!-- Measurement card -->
      <div class="measure-card">
        <!-- Ruler mode: single distance -->
        <div v-if="measureMode === 'ruler'" class="measure-row">
          <div class="measure-block">
            <span class="measure-num">{{ rulerDistCm?.toFixed(1) ?? '—' }}</span>
            <span class="measure-unit">cm</span>
            <span class="measure-desc">Distância</span>
          </div>
        </div>
        <!-- Polygon mode: area + bounding box -->
        <div v-else class="measure-row">
          <div class="measure-block">
            <span class="measure-num">{{ areaCm2.toFixed(1) }}</span>
            <span class="measure-unit">cm²</span>
            <span class="measure-desc">Área total</span>
          </div>
          <div class="measure-divider"></div>
          <div class="measure-block">
            <span class="measure-num">{{ boundingBox.widthCm.toFixed(1) }}</span>
            <span class="measure-unit">cm</span>
            <span class="measure-desc">Largura</span>
          </div>
          <div class="measure-divider"></div>
          <div class="measure-block">
            <span class="measure-num">{{ boundingBox.heightCm.toFixed(1) }}</span>
            <span class="measure-unit">cm</span>
            <span class="measure-desc">Altura</span>
          </div>
        </div>
        <!-- UX #4 — detalhes técnicos colapsáveis -->
        <button
          class="tech-toggle"
          @click="showTechDetails = !showTechDetails"
          :aria-expanded="showTechDetails"
        >
          {{ showTechDetails ? '▲' : '▼' }} Detalhes técnicos
        </button>
        <div v-if="showTechDetails" class="measure-meta">
          Escala: <strong>{{ pixelsPerCm.toFixed(1) }} px/cm</strong>
        </div>
      </div>

      <!-- Form -->
      <div class="summary-form">
        <div class="form-group">
          <label for="clientName">Nome do cliente <span class="opt">(opcional)</span></label>
          <input id="clientName" v-model="clientName" class="input" type="text" placeholder="Ex.: João Silva" />
        </div>
        <div class="form-group">
          <label for="tattooPhone">Telefone do artista <span class="opt">(opcional)</span></label>
          <input id="tattooPhone" v-model="tattooPhone" class="input" type="tel" placeholder="Ex.: 5511999990000" />
          <!-- UX #13 — ajuda contextual abaixo do campo -->
          <span class="field-hint">Inclua DDI + DDD, sem espaços. Ex.: 5511999990000</span>
        </div>
        <div class="form-group">
          <label for="obs">Observações <span class="opt">(opcional)</span></label>
          <textarea id="obs" v-model="observations" class="input" placeholder="Ex.: Estilo Blackwork, antebraço direito…" />
        </div>
      </div>

      <!-- CTAs -->
      <div class="summary-actions">
        <button class="btn btn-green btn-full" @click="sendWhatsApp">
          📲 Enviar Medidas no WhatsApp
        </button>
        <button class="btn btn-ghost btn-full btn-sm" @click="goBack">
          ← Ajustar Desenho
        </button>
        <!-- UX #6 — separador visual antes de Nova Medição -->
        <div class="actions-separator"></div>
        <!-- UX #5 — dispara modal de confirmação -->
        <button class="btn btn-danger btn-full btn-sm" @click="confirmRestart">
          🔄 Nova Medição
        </button>
      </div>

      <!-- Modal de confirmação reiniciar -->
      <Teleport to="body">
        <div v-if="showRestartModal" class="modal-backdrop" @click.self="cancelRestart">
          <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <p id="modal-title" class="modal-title">Iniciar nova medição?</p>
            <p class="modal-body">A foto e o desenho atuais serão descartados.</p>
            <div class="modal-actions">
              <button class="btn btn-ghost" @click="cancelRestart">Cancelar</button>
              <button class="btn btn-danger" @click="restart">Sim, descartar</button>
            </div>
          </div>
        </div>
      </Teleport>
    </div>

  </div>
</template>

<style scoped>
/* ── App shell ───────────────────────────────────────────────────────────── */
.app {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-900);
  overflow: hidden;
}

/* ── Header ──────────────────────────────────────────────────────────────── */
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  padding-top: calc(12px + env(safe-area-inset-top, 0px));
  background: var(--bg-800);
  border-bottom: 1px solid var(--bg-700);
  flex-shrink: 0;
  z-index: 10;
}

.header-left,
.header-right { width: 36px; }

.back-btn {
  background: none;
  border: none;
  color: var(--text-100);
  font-size: 20px;
  cursor: pointer;
  padding: 10px; /* UX #9 — área de toque mínima 44px */
  margin: -10px;
  -webkit-tap-highlight-color: transparent;
  line-height: 1;
}

.logo {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.logo-ta {
  width: 26px;
  height: 26px;
  flex-shrink: 0;
}
.logo-accent { color: var(--accent-amber); }

/* ── Stepper ──────────────────────────────────────────────────────────────── */
.stepper {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 16px;
  background: var(--bg-800);
  border-bottom: 1px solid var(--bg-700);
  flex-shrink: 0;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.step-dot {
  width: 24px; height: 24px;
  border-radius: 50%;
  background: var(--bg-700);
  border: 2px solid var(--bg-600);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-300);
  flex-shrink: 0;
  transition: all 0.2s;
}

.step-item.active .step-dot    { background: var(--accent-amber); border-color: var(--accent-amber); color: var(--bg-900); }
.step-item.completed .step-dot { background: var(--accent-green); border-color: var(--accent-green); color: #fff; }

.step-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-300);
  white-space: nowrap;
}
.step-item.active .step-label    { color: var(--accent-amber); }
.step-item.completed .step-label { color: var(--accent-green); }

.step-line {
  width: 28px; height: 2px;
  background: var(--bg-600);
  margin: 0 4px;
  transition: background 0.2s;
  flex-shrink: 0;
}
.step-line.done { background: var(--accent-green); }

/* ── Page base ────────────────────────────────────────────────────────────── */
.page {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 24px 16px;
  gap: 20px;
  padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
}

/* ── Intro ────────────────────────────────────────────────────────────────── */
.page-intro { gap: 16px; }

.intro-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  text-align: center;
  padding: 12px 0 4px;
}

.intro-icon-wrap {
  width: 88px; height: 88px;
  background: rgba(255,183,3,0.1);
  border: 2px solid rgba(255,183,3,0.3);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.intro-title {
  font-size: 24px;
  font-weight: 800;
}

.intro-sub {
  font-size: 14px;
  color: var(--text-300);
  line-height: 1.6;
}

.btn-lg { padding: 16px 24px; font-size: 16px; }

.how-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.how-item {
  display: flex;
  gap: 12px;
  padding: 14px 12px;
  background: var(--bg-800);
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--bg-600);
  font-size: 13px;
}

.how-item strong { display: block; color: var(--text-100); margin-bottom: 4px; }
.how-item p      { color: var(--text-300); line-height: 1.4; margin: 0; }

.how-num {
  width: 26px; height: 26px; flex-shrink: 0;
  background: var(--bg-700);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 12px;
  color: var(--accent-amber);
}

.intro-note {
  font-size: 12px;
  color: var(--text-300);
  text-align: center;
  line-height: 1.5;
  padding: 10px;
  background: var(--bg-800);
  border-radius: var(--radius-sm);
}

/* ── Summary ──────────────────────────────────────────────────────────────── */
.page-summary { gap: 16px; }

.snapshot-wrap {
  border-radius: var(--radius-lg);
  border: 1px solid var(--bg-700);
  background: #000;
}

.snapshot-img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
}

.snapshot-caption {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--text-300);
  text-align: center;
  background: var(--bg-800);
  border-top: 1px solid var(--bg-700);
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
}

.measure-card {
  background: var(--bg-800);
  border-radius: var(--radius-lg);
  border: 1px solid var(--bg-700);
  padding: 20px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.measure-row {
  display: flex;
  justify-content: space-around;
  align-items: center;
}

.measure-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.measure-num  { font-size: 32px; font-weight: 800; color: var(--accent-amber); line-height: 1; }
.measure-unit { font-size: 13px; font-weight: 700; color: var(--text-300); }
.measure-desc { font-size: 10px; color: var(--bg-600); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 2px; }

.measure-divider { width: 1px; height: 50px; background: var(--bg-700); }

.measure-meta {
  font-size: 11px;
  color: var(--text-300);
  text-align: center;
  padding-top: 6px;
  border-top: 1px solid var(--bg-700);
}

.summary-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-group { display: flex; flex-direction: column; gap: 6px; }

.opt { font-weight: 400; opacity: 0.6; text-transform: none; letter-spacing: 0; }

.summary-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-bottom: 8px;
}

/* UX #6 — separador visual antes de Nova Medição */
.actions-separator {
  height: 1px;
  background: var(--bg-700);
  margin: 2px 0;
}

/* UX #4 — toggle de detalhes técnicos */
.tech-toggle {
  background: none;
  border: none;
  color: var(--text-300);
  font-size: 11px;
  cursor: pointer;
  padding: 4px 0;
  text-align: center;
  width: 100%;
  -webkit-tap-highlight-color: transparent;
}
.tech-toggle:hover { color: var(--text-100); }

/* UX #13 — ajuda abaixo do campo */
.field-hint {
  font-size: 11px;
  color: var(--text-300);
  line-height: 1.4;
}

/* UX #5 — modal de confirmação */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
  padding: 24px;
}

.modal {
  background: var(--bg-800);
  border: 1px solid var(--bg-700);
  border-radius: var(--radius-lg);
  padding: 24px 20px 20px;
  width: 100%;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.modal-title {
  font-size: 17px;
  font-weight: 700;
  color: var(--text-100);
  margin: 0;
}

.modal-body {
  font-size: 14px;
  color: var(--text-300);
  line-height: 1.5;
  margin: 0;
}

.modal-actions {
  display: flex;
  gap: 10px;
  margin-top: 6px;
}

.modal-actions .btn {
  flex: 1;
}
</style>
