/**
 * Pinhole camera model for real-world scale estimation.
 *
 * Physics:
 *   objectSize_px = focalLength_px * objectSize_cm / distanceCm
 *   → pixelsPerCm  = focalLength_px / distanceCm
 *   → focalLength_px = imageWidth_px / (2 * tan(hFov / 2))
 *
 * Most smartphone rear cameras sit between 60–70° horizontal FOV.
 * We default to 65°, which gives ≈ 2–5% error on common devices.
 * Users can fine-tune the distance slider if the preview ring looks off.
 */
import { ref, computed } from 'vue'

const H_FOV_DEG = 65

function tanHalfFov() {
  return Math.tan((H_FOV_DEG * Math.PI) / 180 / 2)
}

export function useDepthScale() {
  /** Distance in cm from the camera lens to the skin surface */
  const distanceCm = ref(30)

  /**
   * Compute pixelsPerCm given the ACTUAL captured image width in pixels.
   * Call this once after capture; imageWidthPx is the full-resolution width.
   */
  function calcPixelsPerCm(imageWidthPx) {
    const focalPx = imageWidthPx / (2 * tanHalfFov())
    return focalPx / distanceCm.value
  }

  /**
   * Live preview guide ring:
   * Returns the diameter in CSS pixels of a 10 cm reference disc
   * as it would appear in a preview element of `previewWidthPx` wide.
   */
  function guideRingDiameter(previewWidthPx) {
    const focalPx = previewWidthPx / (2 * tanHalfFov())
    return (focalPx / distanceCm.value) * 10   // 10 cm reference diameter
  }

  const distanceHint = computed(() => {
    const d = distanceCm.value
    if (d < 15) return { text: 'Muito perto — afaste o celular', ok: false }
    if (d > 60) return { text: 'Muito longe — aproxime o celular', ok: false }
    return { text: 'Distância ideal ✓', ok: true }
  })

  return { distanceCm, distanceHint, calcPixelsPerCm, guideRingDiameter }
}
