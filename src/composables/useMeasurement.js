/**
 * Measurement utilities — work in any consistent pixel coordinate space.
 *
 * All functions are pure (no Vue reactivity) so they are trivially testable.
 * The caller is responsible for ensuring point coordinates and ppc are in
 * the same pixel space (either both in display-CSS-px or both in image-px).
 */

/**
 * Euclidean distance between two points in cm.
 *
 * @param {{ x: number, y: number }} p1
 * @param {{ x: number, y: number }} p2
 * @param {number} ppc  pixels per cm
 * @returns {number} distance in cm (0 on degenerate input)
 */
export function computeDistanceCm(p1, p2, ppc) {
  if (!p1 || !p2 || ppc <= 0) return 0
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  return Math.sqrt(dx * dx + dy * dy) / ppc
}

/**
 * Distance in cm for each consecutive segment of a polyline.
 *
 * @param {{ x: number, y: number }[]} points
 * @param {number} ppc
 * @param {boolean} closed  if true, also includes closing segment (last → first)
 * @returns {number[]}
 */
export function computeSegmentDistances(points, ppc, closed = false) {
  if (!points || points.length < 2 || ppc <= 0) return []
  const dists = []
  for (let i = 0; i < points.length - 1; i++) {
    dists.push(computeDistanceCm(points[i], points[i + 1], ppc))
  }
  if (closed && points.length >= 3) {
    dists.push(computeDistanceCm(points[points.length - 1], points[0], ppc))
  }
  return dists
}

/**
 * Centroid (average position) of a set of vertices.
 * Good enough for label positioning; not the true polygon area centroid.
 *
 * @param {{ x: number, y: number }[]} points
 * @returns {{ x: number, y: number }}
 */
export function polygonCentroid(points) {
  if (!points || points.length === 0) return { x: 0, y: 0 }
  const x = points.reduce((s, p) => s + p.x, 0) / points.length
  const y = points.reduce((s, p) => s + p.y, 0) / points.length
  return { x, y }
}
