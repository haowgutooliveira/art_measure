import { describe, it, expect } from 'vitest'
import {
  computeDistanceCm,
  computeSegmentDistances,
  polygonCentroid,
} from '../useMeasurement.js'

// ─── computeDistanceCm ──────────────────────────────────────────────────────

describe('computeDistanceCm — distância entre dois pontos', () => {

  // ── Caminhos felizes ─────────────────────────────────────────────────────

  it('CF-01: 50px horizontal com ppc=10 → 5.0 cm', () => {
    expect(computeDistanceCm({ x: 0, y: 0 }, { x: 50, y: 0 }, 10)).toBeCloseTo(5, 5)
  })

  it('CF-02: triângulo 3-4-5 → hipotenusa 500px, ppc=50 → 10.0 cm', () => {
    // 300² + 400² = 500² → dist = 500 / 50 = 10
    expect(computeDistanceCm({ x: 0, y: 0 }, { x: 300, y: 400 }, 50)).toBeCloseTo(10, 5)
  })

  it('CF-03: distância vertical 100px com ppc=20 → 5.0 cm', () => {
    expect(computeDistanceCm({ x: 0, y: 0 }, { x: 0, y: 100 }, 20)).toBeCloseTo(5, 5)
  })

  // ── Caminhos infelizes ───────────────────────────────────────────────────

  it('CI-01: pontos idênticos → 0 sem erro', () => {
    expect(computeDistanceCm({ x: 50, y: 50 }, { x: 50, y: 50 }, 10)).toBe(0)
  })

  it('CI-02: ppc=0 → 0 sem dividir por zero', () => {
    expect(computeDistanceCm({ x: 0, y: 0 }, { x: 100, y: 0 }, 0)).toBe(0)
  })

  it('CI-03: p1 null → 0 sem erro', () => {
    expect(computeDistanceCm(null, { x: 100, y: 0 }, 10)).toBe(0)
  })

  it('CI-04: p2 null → 0 sem erro', () => {
    expect(computeDistanceCm({ x: 0, y: 0 }, null, 10)).toBe(0)
  })

})

// ─── computeSegmentDistances ────────────────────────────────────────────────

describe('computeSegmentDistances — distâncias de cada segmento', () => {

  it('CF-04: quadrado 4 segmentos de 100px, ppc=10 → [10, 10, 10, 10] cm', () => {
    const pts = [
      { x: 0, y: 0 }, { x: 100, y: 0 },
      { x: 100, y: 100 }, { x: 0, y: 100 },
    ]
    const dists = computeSegmentDistances(pts, 10, false)
    expect(dists).toHaveLength(3) // 4 pontos → 3 segmentos abertos
    dists.forEach(d => expect(d).toBeCloseTo(10, 5))
  })

  it('CF-05: quadrado fechado → 4 segmentos', () => {
    const pts = [
      { x: 0, y: 0 }, { x: 100, y: 0 },
      { x: 100, y: 100 }, { x: 0, y: 100 },
    ]
    const dists = computeSegmentDistances(pts, 10, true)
    expect(dists).toHaveLength(4)
    dists.forEach(d => expect(d).toBeCloseTo(10, 5))
  })

  it('CF-06: modo ruler (2 pontos abertos) → 1 segmento', () => {
    const dists = computeSegmentDistances(
      [{ x: 0, y: 0 }, { x: 50, y: 0 }],
      10,
      false,
    )
    expect(dists).toHaveLength(1)
    expect(dists[0]).toBeCloseTo(5, 5)
  })

  it('CI-05: menos de 2 pontos → array vazio', () => {
    expect(computeSegmentDistances([{ x: 0, y: 0 }], 10)).toEqual([])
    expect(computeSegmentDistances([], 10)).toEqual([])
  })

  it('CI-06: ppc=0 → array vazio', () => {
    const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }]
    expect(computeSegmentDistances(pts, 0)).toEqual([])
  })

})

// ─── polygonCentroid ─────────────────────────────────────────────────────────

describe('polygonCentroid — centro geométrico do polígono', () => {

  it('CF-07: centroide de quadrado 0–100 × 0–100 é {50, 50}', () => {
    const pts = [
      { x: 0, y: 0 }, { x: 100, y: 0 },
      { x: 100, y: 100 }, { x: 0, y: 100 },
    ]
    const c = polygonCentroid(pts)
    expect(c.x).toBeCloseTo(50, 5)
    expect(c.y).toBeCloseTo(50, 5)
  })

  it('CF-08: centroide de triângulo', () => {
    const pts = [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 0, y: 60 }]
    const c = polygonCentroid(pts)
    expect(c.x).toBeCloseTo(30, 5)
    expect(c.y).toBeCloseTo(20, 5)
  })

  it('CI-07: lista vazia → {x:0, y:0} sem erro', () => {
    const c = polygonCentroid([])
    expect(c.x).toBe(0)
    expect(c.y).toBe(0)
  })

})
