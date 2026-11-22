import { ref, readonly } from 'vue'

const H_FOV_RAD = (65 * Math.PI) / 180

/**
 * WebXR Depth-Sensing composable.
 *
 * Uses ARCore's computational depth (available on most modern Android phones
 * via Chrome + ARCore) to measure the real distance from camera to whatever
 * surface the reticle is pointing at — including skin, arm, wall, etc.
 *
 * API surface:
 *   await ar.checkSupport()              → sets isSupported
 *   await ar.start(overlayEl)            → begins XR session
 *   ar.setReticle(nx, ny)                → update normalised reticle coords [0–1]
 *   ar.distanceCm, ar.hasHit             → reactive live readings
 *   await ar.lockAndRelease(imageW)      → lock distance, end XR, return { lockedDistanceCm, pixelsPerCm }
 */
export function useARCamera() {
  const isSupported = ref(false)
  const isActive    = ref(false)
  const distanceCm  = ref(null)
  const hasHit      = ref(false)

  let _session    = null
  let _localSpace = null
  let _reticleNX  = 0.5   // normalised [0–1], set via setReticle()
  let _reticleNY  = 0.5
  let _locked     = null   // distance locked at capture moment

  // ── Support check ────────────────────────────────────────────────────────────
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

  // ── Start XR session ─────────────────────────────────────────────────────────
  async function start(overlayElement) {
    if (!overlayElement) throw new Error('overlay element required')

    // depth-sensing gives per-pixel real depth (works for skin, walls, anything)
    // dom-overlay shows our UI on top of the XR camera passthrough
    _session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['depth-sensing', 'dom-overlay'],
      depthSensing: {
        usagePreference:    ['cpu-optimized', 'gpu-optimized'],
        dataFormatPreference: ['luminance-alpha', 'float32'],
      },
      domOverlay: { root: overlayElement },
    })

    // Minimal GL layer (required by spec)
    const canvas = document.createElement('canvas')
    const gl     = canvas.getContext('webgl', { xrCompatible: true })
    await _session.updateRenderState({ baseLayer: new XRWebGLLayer(_session, gl) })

    _localSpace = await _session.requestReferenceSpace('local')
    _session.addEventListener('end', _onEnd)
    _session.requestAnimationFrame(_frame)
    isActive.value = true
  }

  // ── Update reticle position ───────────────────────────────────────────────────
  // nx, ny ∈ [0, 1] — normalised screen coordinates
  function setReticle(nx, ny) {
    _reticleNX = Math.max(0, Math.min(1, nx))
    _reticleNY = Math.max(0, Math.min(1, ny))
  }

  // ── Frame loop ───────────────────────────────────────────────────────────────
  function _frame(_, frame) {
    if (!_session) return
    _session.requestAnimationFrame(_frame)

    const viewerPose = frame.getViewerPose(_localSpace)
    if (!viewerPose) return

    // Use the first view (back camera in a phone AR session)
    const view = viewerPose.views[0]
    if (!view) return

    const depthInfo = frame.getDepthInformation(view)
    if (!depthInfo) { hasHit.value = false; return }

    // getDepthInMeters(x, y) — normalised view coordinates [0, 1]
    // For a portrait full-screen session this maps to screen coords directly.
    const depth = depthInfo.getDepthInMeters(_reticleNX, _reticleNY)

    if (depth > 0.01) {   // 0 = no data; ignore < 1 cm (too close for ARCore)
      distanceCm.value = Math.round(depth * 100)
      hasHit.value     = true
    } else {
      hasHit.value = false
    }
  }

  // ── End session ──────────────────────────────────────────────────────────────
  function _onEnd() {
    _localSpace   = null
    _session      = null
    isActive.value = false
  }

  async function stop() {
    if (_session) await _session.end().catch(() => {})
  }

  // ── Lock distance + release camera ───────────────────────────────────────────
  async function lockAndRelease(imageWidthPx) {
    _locked = distanceCm.value ?? 25
    const ppc = calcPixelsPerCm(imageWidthPx, _locked)
    await stop()
    // Give OS time to free the camera before getUserMedia
    await new Promise(r => setTimeout(r, 450))
    return { lockedDistanceCm: _locked, pixelsPerCm: ppc }
  }

  // ── Scale conversion (pinhole model) ─────────────────────────────────────────
  function calcPixelsPerCm(imageWidthPx, distOverride) {
    const dist = distOverride ?? distanceCm.value
    if (!dist || dist <= 0) return 1
    return (imageWidthPx / (2 * Math.tan(H_FOV_RAD / 2))) / dist
  }

  return {
    isSupported: readonly(isSupported),
    isActive:    readonly(isActive),
    distanceCm:  readonly(distanceCm),
    hasHit:      readonly(hasHit),
    checkSupport,
    start,
    stop,
    setReticle,
    lockAndRelease,
    calcPixelsPerCm,
  }
}
