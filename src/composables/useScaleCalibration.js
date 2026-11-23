/**
 * Scale calibration — two-point tap on a photo.
 *
 * Given two points tapped on the displayed image (in CSS px),
 * the natural image dimensions, and the real-world distance
 * between those points in cm, computes pixelsPerCm for the
 * original (full-resolution) image.
 *
 * Formula:
 *   scale      = naturalWidth / displayWidth
 *   imgPxDist  = sqrt((dx * scale)² + (dy * scale)²)
 *   ppc        = imgPxDist / realCm
 *
 * @param {{ p1, p2, displayWidth, naturalWidth, realCm }} opts
 * @returns {number} pixelsPerCm (0 if inputs are degenerate)
 */
export function computePixelsPerCm({ p1, p2, displayWidth, naturalWidth, realCm }) {
  if (!p1 || !p2 || realCm <= 0 || displayWidth <= 0) return 0

  const scale    = naturalWidth / displayWidth
  const dx       = (p2.x - p1.x) * scale
  const dy       = (p2.y - p1.y) * scale
  const imgPxDist = Math.sqrt(dx * dx + dy * dy)

  return imgPxDist / realCm
}
