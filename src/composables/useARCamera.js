import { ref, readonly } from 'vue'

/** Horizontal FOV assumed for typical smartphone rear camera */
const H_FOV_RAD = (65 * Math.PI) / 180

/**
 * WebXR hit-test composable.
 *
 * Usage:
 *   const ar = useARCamera()
 *   await ar.checkSupport()         // sets isSupported
 *   await ar.start(overlayEl)       // begins XR session
 *   // ar.distanceCm updates every frame
 *   const ppc = await ar.capture(imageWidthPx)  // ends session, returns ppc + lockedDistanceCm
 *   await ar.stop()                 // cleanup if capture wasn't called
 */
export function useARCamera() {
  const isSupported    = ref(false)
  const isActive       = ref(false)
  const distanceCm     = ref(null)   // live distance, null until first hit
  const hasHit         = ref(false)
  const errorMsg       = ref(null)

  let _session         = null
  let _localSpace      = null
  let _hitTestSource   = null
  let _lockedDistance  = null        // distance at capture moment
  let _rafHandle       = null

  // ── Support check ──────────────────────────────────────────────────────────
  async function checkSupport() {
    try {
      isSupported.value = !!(
        navigator.xr &&
        (await navigator.xr.isSessionSupported('immersive-ar'))
      )
    } catch {
      isSupported.value = false
    }
  }

  // ── Start XR session ───────────────────────────────────────────────────────
  async function start(overlayElement) {
    errorMsg.value = null
    _lockedDistance = null

    // dom-overlay is required (not optional): without it XR takes over the
    // screen completely and no DOM buttons are visible. If a device supports
    // immersive-ar but not dom-overlay, the session request throws and we fall
    // back gracefully to the regular camera.
    const opts = overlayElement
      ? { requiredFeatures: ['hit-test', 'dom-overlay'], domOverlay: { root: overlayElement } }
      : { requiredFeatures: ['hit-test'] }

    _session = await navigator.xr.requestSession('immersive-ar', opts)

    // Minimal WebGL layer (required even without custom rendering)
    const canvas = document.createElement('canvas')
    const gl     = canvas.getContext('webgl', { xrCompatible: true })
    await _session.updateRenderState({ baseLayer: new XRWebGLLayer(_session, gl) })

    _localSpace      = await _session.requestReferenceSpace('local')
    const viewerSpace = await _session.requestReferenceSpace('viewer')
    _hitTestSource   = await _session.requestHitTestSource({ space: viewerSpace })

    _session.addEventListener('end', _handleEnd)
    _rafHandle = _session.requestAnimationFrame(_frame)
    isActive.value = true
  }

  // ── XR frame loop ──────────────────────────────────────────────────────────
  function _frame(_, frame) {
    if (!_session) return
    _rafHandle = _session.requestAnimationFrame(_frame)

    if (!_hitTestSource) return   // source being replaced — skip frame

    const hits = frame.getHitTestResults(_hitTestSource)
    if (hits.length > 0) {
      const hitPose  = hits[0].getPose(_localSpace)
      const viewPose = frame.getViewerPose(_localSpace)
      if (hitPose && viewPose) {
        const h = hitPose.transform.position
        const v = viewPose.transform.position
        const dist = Math.sqrt((h.x - v.x) ** 2 + (h.y - v.y) ** 2 + (h.z - v.z) ** 2)
        distanceCm.value = Math.round(dist * 100)
        hasHit.value     = true
      }
    } else {
      hasHit.value = false
    }
  }

  // ── Update ray when reticle moves ──────────────────────────────────────────
  /**
   * Recreates the hit test source to fire a ray through the given screen
   * position rather than the viewer centre. Call this after the reticle
   * is dragged (debounced — requestHitTestSource is async).
   *
   * @param {number} screenX   – reticle x in CSS pixels
   * @param {number} screenY   – reticle y in CSS pixels
   * @param {number} screenW   – viewport width in CSS pixels
   * @param {number} screenH   – viewport height in CSS pixels
   */
  async function updateRay(screenX, screenY, screenW, screenH) {
    if (!_session || !_localSpace) return

    // Normalised device coordinates: centre = (0,0), range [-1, 1]
    const nx =  (screenX / screenW - 0.5) * 2
    const ny = -((screenY / screenH - 0.5) * 2)   // Y is flipped in NDC

    // Ray direction in camera/viewer space (camera looks along -Z)
    // We approximate a symmetric 65° FOV for both axes.
    const halfFov = H_FOV_RAD / 2
    const t = Math.tan(halfFov)
    const dx = nx * t, dy = ny * t, dz = -1
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz)

    const ray = new XRRay(
      { x: 0, y: 0, z: 0, w: 1 },                         // origin: viewer position
      { x: dx / len, y: dy / len, z: dz / len, w: 0 },    // direction
    )

    const viewerSpace = await _session.requestReferenceSpace('viewer').catch(() => null)
    if (!viewerSpace) return

    const oldSource = _hitTestSource
    _hitTestSource  = null    // pause frame loop usage during swap

    try {
      const newSource = await _session.requestHitTestSource({ space: viewerSpace, offsetRay: ray })
      oldSource?.cancel()
      _hitTestSource = newSource
    } catch {
      // If new source fails, restore old one to keep measuring something
      _hitTestSource = oldSource
    }
  }

  // ── End session ────────────────────────────────────────────────────────────
  function _handleEnd() {
    _hitTestSource?.cancel()
    _hitTestSource = null
    _localSpace    = null
    _session       = null
    isActive.value = false
  }

  async function stop() {
    _hitTestSource?.cancel()
    _hitTestSource = null
    if (_session) {
      await _session.end().catch(() => {})
    }
  }

  /**
   * Locks the current distance, ends XR session, waits for camera to be
   * released, then resolves with { lockedDistanceCm, pixelsPerCm }.
   *
   * The caller is responsible for calling getUserMedia + capturing the frame.
   * We return pixelsPerCm so the caller can stamp it on the captured photo.
   *
   * @param {number} imageWidthPx — width of the photo that will be captured
   * @returns {Promise<{ lockedDistanceCm: number, pixelsPerCm: number }>}
   */
  async function lockAndRelease(imageWidthPx) {
    _lockedDistance = distanceCm.value ?? 30   // fallback: 30 cm
    const ppc = calcPixelsPerCm(imageWidthPx, _lockedDistance)

    await stop()

    // Give the OS time to release the camera track before getUserMedia
    await new Promise(r => setTimeout(r, 450))

    return { lockedDistanceCm: _lockedDistance, pixelsPerCm: ppc }
  }

  // ── Scale conversion ───────────────────────────────────────────────────────
  /**
   * Converts image pixels to cm using pinhole camera model.
   * pixelsPerCm = focalLength_px / distanceCm
   * focalLength_px = imageWidthPx / (2 * tan(H_FOV / 2))
   */
  function calcPixelsPerCm(imageWidthPx, distOverride) {
    const dist = distOverride ?? distanceCm.value
    if (!dist || dist <= 0) return 1
    const focalPx = imageWidthPx / (2 * Math.tan(H_FOV_RAD / 2))
    return focalPx / dist
  }

  return {
    isSupported: readonly(isSupported),
    isActive:    readonly(isActive),
    distanceCm:  readonly(distanceCm),
    hasHit:      readonly(hasHit),
    errorMsg:    readonly(errorMsg),
    checkSupport,
    start,
    stop,
    lockAndRelease,
    calcPixelsPerCm,
    updateRay,
  }
}
