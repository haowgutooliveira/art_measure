import { describe, it, expect } from 'vitest'
import { computePixelsPerCm } from '../useScaleCalibration.js'

describe('computePixelsPerCm — calibração por dois pontos', () => {

  // ── Caminhos felizes ───────────────────────────────────────────────────

  it('CF-07: 500px horizontais em display=500px, imagem natural=1920px, 10cm → 192 ppc', () => {
    // Escala: 1920/500 = 3.84 — distância real na imagem = 500 * 3.84 = 1920px — ppc = 1920/10 = 192
    const result = computePixelsPerCm({
      p1: { x: 0,   y: 0 },
      p2: { x: 500, y: 0 },
      displayWidth:  500,
      naturalWidth:  1920,
      realCm: 10,
    })
    expect(result).toBeCloseTo(192, 2)
  })

  it('CF-08: distância diagonal 3-4-5 — display=500px, natural=1000px, 10cm → 100 ppc', () => {
    // Triângulo 300-400-500 CSS px → scale=2 → 600-800-1000 px na imagem → ppc = 1000/10 = 100
    const result = computePixelsPerCm({
      p1: { x: 0,   y: 0 },
      p2: { x: 300, y: 400 },
      displayWidth:  500,
      naturalWidth:  1000,
      realCm: 10,
    })
    expect(result).toBeCloseTo(100, 2)
  })

  it('CF-09: realCm=1 retorna ppc igual à distância em pixels na imagem original', () => {
    // 100px display, scale=2 (natural=400, display=200), pxDist=200, realCm=1 → ppc=200
    const result = computePixelsPerCm({
      p1: { x: 0,   y: 0 },
      p2: { x: 100, y: 0 },
      displayWidth:  200,
      naturalWidth:  400,
      realCm: 1,
    })
    expect(result).toBeCloseTo(200, 2)
  })

  // CF-10: integração — ppc correto produz área correta
  it('CF-10: ppc=192 e polígono 1920×1920px na imagem → área ≈ 100 cm²  (1920/192=10cm por lado)', () => {
    // Com ppc=192 e quadrado de 10×10cm → 1920×1920px na imagem
    // Para verificar: se display=500px e natural=1920px, escala=3.84
    // Polígono em px de display: 500×500px → imagem = 1920×1920px
    // area px² = 1920² = 3686400 / (192²=36864) = 100 cm² ✓
    const ppc = computePixelsPerCm({
      p1: { x: 0,   y: 0 },
      p2: { x: 500, y: 0 },
      displayWidth: 500,
      naturalWidth: 1920,
      realCm: 10,
    })
    expect(ppc).toBeCloseTo(192, 2)

    // Área de um quadrado de 1920×1920px na imagem com esse ppc
    const areaImgPx2 = 1920 * 1920
    const areaCm2    = areaImgPx2 / (ppc * ppc)
    expect(areaCm2).toBeCloseTo(100, 1)
  })

  // ── Caminhos infelizes ─────────────────────────────────────────────────

  it('CI-04: pontos idênticos retornam ppc=0 sem lançar erro', () => {
    const result = computePixelsPerCm({
      p1: { x: 50, y: 50 },
      p2: { x: 50, y: 50 },
      displayWidth:  500,
      naturalWidth:  1920,
      realCm: 10,
    })
    expect(result).toBe(0)
  })

  it('CI-05: realCm=0 retorna 0 sem dividir por zero', () => {
    const result = computePixelsPerCm({
      p1: { x: 0,   y: 0 },
      p2: { x: 100, y: 0 },
      displayWidth:  500,
      naturalWidth:  1920,
      realCm: 0,
    })
    expect(result).toBe(0)
  })

})
