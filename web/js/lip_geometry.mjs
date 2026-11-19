const OUTER_LIPS = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146]
const LEFT_EYE = 33
const RIGHT_EYE = 263
const NOSE = 1
const NOSE_ROOT = 168
const FOREHEAD = 10
const CHIN = 152
const FACE_LEFT = 234
const FACE_RIGHT = 454
const MOUTH_LEFT = 61
const MOUTH_RIGHT = 291
const LIP_TOP = 0
const LIP_BOTTOM = 17
const INNER_TOP = 13
const INNER_BOTTOM = 14

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function extractLipFeatures(landmarks) {
  if (!landmarks || landmarks.length < 468) {
    return { ok: false, reason: "noface" }
  }
  const leftEye = landmarks[LEFT_EYE]
  const rightEye = landmarks[RIGHT_EYE]
  const nose = landmarks[NOSE]
  const iod = dist(leftEye, rightEye)
  if (iod < 0.05) return { ok: false, reason: "far" }
  if (iod > 0.72) return { ok: false, reason: "close" }
  const yaw = (nose.x - (leftEye.x + rightEye.x) / 2) / iod
  if (Math.abs(yaw) > 0.22) return { ok: false, reason: "turn" }

  const mouthWidth = dist(landmarks[MOUTH_LEFT], landmarks[MOUTH_RIGHT])
  const mouthHeight = dist(landmarks[LIP_TOP], landmarks[LIP_BOTTOM])
  const faceWidth = dist(landmarks[FACE_LEFT], landmarks[FACE_RIGHT])
  const faceHeight = dist(landmarks[FOREHEAD], landmarks[CHIN])
  if (mouthWidth < iod * 0.05 || mouthHeight < iod * 0.02 || faceWidth < 0.08 || faceHeight < 0.08) {
    return { ok: false, reason: "mouth" }
  }
  return {
    ok: true,
    width: mouthWidth / faceWidth,
    height: mouthHeight / faceHeight,
    closure: dist(landmarks[INNER_TOP], landmarks[INNER_BOTTOM]) / iod,
    aspect: mouthWidth / mouthHeight,
    jaw: dist(landmarks[CHIN], landmarks[NOSE_ROOT]) / iod,
    corner: mouthWidth / iod,
    lipChin: dist(landmarks[INNER_BOTTOM], landmarks[CHIN]) / iod,
  }
}

function placeArc(landmarks, indices, fromAngle, toAngle, cx, cy, rx, ry) {
  indices.forEach((index, i) => {
    const t = indices.length === 1 ? 0 : i / (indices.length - 1)
    const angle = fromAngle + (toAngle - fromAngle) * t
    landmarks[index] = {
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
      z: 0,
    }
  })
}

function syntheticLandmarks({
  rx = 0.07,
  ry = 0.04,
  noseX = 0.5,
  innerGap = 0.012,
  chinY = 0.8,
  lowerLipY = null,
} = {}) {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  landmarks[LEFT_EYE] = { x: 0.36, y: 0.4, z: 0 }
  landmarks[RIGHT_EYE] = { x: 0.64, y: 0.4, z: 0 }
  landmarks[NOSE] = { x: noseX, y: 0.52, z: 0 }
  landmarks[NOSE_ROOT] = { x: noseX, y: 0.46, z: 0 }
  landmarks[FOREHEAD] = { x: 0.5, y: 0.2, z: 0 }
  landmarks[CHIN] = { x: 0.5, y: chinY, z: 0 }
  landmarks[FACE_LEFT] = { x: 0.3, y: 0.55, z: 0 }
  landmarks[FACE_RIGHT] = { x: 0.7, y: 0.55, z: 0 }
  const cx = 0.5
  const cy = 0.64
  placeArc(landmarks, [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291], Math.PI, Math.PI * 2, cx, cy, rx, ry)
  placeArc(landmarks, [291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61], 0, Math.PI, cx, cy, rx, ry)
  landmarks[INNER_TOP] = { x: cx, y: cy - innerGap / 2, z: 0 }
  landmarks[INNER_BOTTOM] = { x: cx, y: lowerLipY ?? cy + innerGap / 2, z: 0 }
  return landmarks
}

export { OUTER_LIPS, extractLipFeatures, syntheticLandmarks }
