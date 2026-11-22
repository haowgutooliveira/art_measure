import { ref, computed } from 'vue'

export const PRESETS = [
  { id: 'brl100',  label: 'Moeda R$ 1,00',      sizeCm: 2.70 },
  { id: 'brl050',  label: 'Moeda R$ 0,50',      sizeCm: 2.30 },
  { id: 'brl025',  label: 'Moeda R$ 0,25',      sizeCm: 2.50 },
  { id: 'card',    label: 'Cartão de Crédito',  sizeCm: 8.56 },
  { id: 'custom',  label: 'Personalizado',       sizeCm: null },
]

export function useCalibration() {
  const selectedPreset = ref(PRESETS[0])
  const customSizeCm   = ref(3.0)
  /** diameter of the on-screen calibration circle, in CSS/logical pixels */
  const markerPixelDiameter = ref(120)

  const realSizeCm = computed(() =>
    selectedPreset.value.sizeCm !== null
      ? selectedPreset.value.sizeCm
      : customSizeCm.value
  )

  /**
   * How many logical pixels represent 1 cm in reality.
   * pixelsPerCm = markerDiameter_px / realSize_cm
   */
  const pixelsPerCm = computed(() => {
    const ppc = markerPixelDiameter.value / realSizeCm.value
    return ppc > 0 ? ppc : 1
  })

  function setPreset(preset) {
    selectedPreset.value = preset
  }

  function setCustomSize(cm) {
    customSizeCm.value = Math.max(0.1, cm)
  }

  function setMarkerDiameter(px) {
    markerPixelDiameter.value = Math.max(10, px)
  }

  return {
    PRESETS,
    selectedPreset,
    customSizeCm,
    markerPixelDiameter,
    realSizeCm,
    pixelsPerCm,
    setPreset,
    setCustomSize,
    setMarkerDiameter,
  }
}
