import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useShoelaceArea } from '../useShoelaceArea.js'

describe('useShoelaceArea — cálculo de área', () => {

  // ── Caminhos felizes ───────────────────────────────────────────────────

  it('CF-01: quadrado 100×100px com ppc=10 resulta em 100 cm²', () => {
    const points = ref([{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}])
    const ppc    = ref(10)
    const { areaCm2 } = useShoelaceArea(points, ppc)
    expect(areaCm2.value).toBeCloseTo(100, 5)
  })

  it('CF-02: triângulo retângulo 100×100px com ppc=10 resulta em 50 cm²', () => {
    const points = ref([{x:0,y:0},{x:100,y:0},{x:0,y:100}])
    const ppc    = ref(10)
    const { areaCm2 } = useShoelaceArea(points, ppc)
    expect(areaCm2.value).toBeCloseTo(50, 5)
  })

  it('CF-03: área é convertida corretamente para qualquer ppc — quadrado 50×50px ppc=5 → 100 cm²', () => {
    const points = ref([{x:0,y:0},{x:50,y:0},{x:50,y:50},{x:0,y:50}])
    const ppc    = ref(5)
    const { areaCm2 } = useShoelaceArea(points, ppc)
    // 50×50 = 2500 px² / (5² = 25) = 100 cm²
    expect(areaCm2.value).toBeCloseTo(100, 5)
  })

  it('CF-04: boundingBox retorna dimensões corretas em cm — 200×50px ppc=10 → 20×5 cm', () => {
    const points = ref([{x:0,y:0},{x:200,y:0},{x:200,y:50},{x:0,y:50}])
    const ppc    = ref(10)
    const { boundingBox } = useShoelaceArea(points, ppc)
    expect(boundingBox.value.widthCm).toBeCloseTo(20, 5)
    expect(boundingBox.value.heightCm).toBeCloseTo(5, 5)
  })

  it('CF-05: formatWhatsApp inclui nome do cliente e observações quando fornecidos', () => {
    const points = ref([{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}])
    const ppc    = ref(10)
    const { formatWhatsApp } = useShoelaceArea(points, ppc)
    const msg = formatWhatsApp('Guto', 'Blackwork')
    expect(msg).toContain('👤 *Cliente:* Guto')
    expect(msg).toContain('📝 *Obs:* Blackwork')
    expect(msg).toContain('📐 *Área:* 100.0 cm²')
  })

  it('CF-06: formatWhatsApp omite linhas de cliente e obs quando não fornecidos', () => {
    const points = ref([{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}])
    const ppc    = ref(10)
    const { formatWhatsApp } = useShoelaceArea(points, ppc)
    const msg = formatWhatsApp('', '')
    expect(msg).not.toContain('*Cliente:*')
    expect(msg).not.toContain('*Obs:*')
  })

  // ── Caminhos infelizes ─────────────────────────────────────────────────

  it('CI-01: menos de 3 pontos retorna área zero', () => {
    const points = ref([{x:0,y:0},{x:100,y:0}])
    const ppc    = ref(10)
    const { areaCm2 } = useShoelaceArea(points, ppc)
    expect(areaCm2.value).toBe(0)
  })

  it('CI-02: ppc=0 retorna área zero sem dividir por zero', () => {
    const points = ref([{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}])
    const ppc    = ref(0)
    const { areaCm2 } = useShoelaceArea(points, ppc)
    expect(areaCm2.value).toBe(0)
  })

  it('CI-03: lista de pontos vazia retorna área zero e bounding box zero sem lançar erro', () => {
    const points = ref([])
    const ppc    = ref(10)
    const { areaCm2, boundingBox } = useShoelaceArea(points, ppc)
    expect(areaCm2.value).toBe(0)
    expect(boundingBox.value.widthCm).toBe(0)
    expect(boundingBox.value.heightCm).toBe(0)
  })

})
