import { computed } from 'vue'

/**
 * Computes polygon area, bounding box, and WhatsApp message.
 *
 * @param {import('vue').Ref<{x:number,y:number}[]>} points  – polygon vertices (logical px)
 * @param {import('vue').Ref<number>}                pixelsPerCm – scale factor
 */
export function useShoelaceArea(points, pixelsPerCm) {
  /** Raw area in pixels² via the Shoelace (Gauss) formula */
  const areaPixels2 = computed(() => {
    const pts = points.value
    if (pts.length < 3) return 0
    let sum = 0
    const n = pts.length
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      sum += pts[i].x * pts[j].y
      sum -= pts[j].x * pts[i].y
    }
    return Math.abs(sum) / 2
  })

  /** Area converted to cm² */
  const areaCm2 = computed(() => {
    const ppc = pixelsPerCm.value
    if (ppc <= 0) return 0
    return areaPixels2.value / (ppc * ppc)
  })

  /** Bounding box of the polygon in cm */
  const boundingBox = computed(() => {
    const pts = points.value
    const ppc = pixelsPerCm.value
    if (pts.length === 0 || ppc <= 0) return { widthCm: 0, heightCm: 0 }
    const xs = pts.map(p => p.x)
    const ys = pts.map(p => p.y)
    const widthCm  = (Math.max(...xs) - Math.min(...xs)) / ppc
    const heightCm = (Math.max(...ys) - Math.min(...ys)) / ppc
    return { widthCm, heightCm }
  })

  /**
   * Returns a pre-formatted WhatsApp message string.
   * @param {string} clientName
   * @param {string} observations
   */
  function formatWhatsApp(clientName, observations) {
    const area = areaCm2.value.toFixed(1)
    const { widthCm, heightCm } = boundingBox.value
    const w = widthCm.toFixed(1)
    const h = heightCm.toFixed(1)

    let msg = `🎨 *TattMeasure — Medidas da Tatuagem*\n\n`
    if (clientName?.trim()) msg += `👤 *Cliente:* ${clientName.trim()}\n`
    msg += `📐 *Área:* ${area} cm²\n`
    msg += `📏 *Dimensões:* ${w} cm × ${h} cm\n`
    if (observations?.trim()) msg += `\n📝 *Obs:* ${observations.trim()}\n`
    msg += `\n_Medido com TattMeasure_ 📲`
    return msg
  }

  return { areaPixels2, areaCm2, boundingBox, formatWhatsApp }
}
