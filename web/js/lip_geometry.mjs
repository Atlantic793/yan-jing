const OUTER_LIPS = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146]
const LEFT_EYE = 33
const RIGHT_EYE = 263
const NOSE = 1
const MOUTH_LEFT = 61
const MOUTH_RIGHT = 291
const LIP_TOP = 0
const LIP_BOTTOM = 17

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

  const width = dist(landmarks[MOUTH_LEFT], landmarks[MOUTH_RIGHT])
  const height = dist(landmarks[LIP_TOP], landmarks[LIP_BOTTOM])
  if (width < iod * 0.05 || height < iod * 0.02) {
    return { ok: false, reason: "mouth" }
  }
  return {
    ok: true,
    width: width / iod,
    height: height / iod,
    aspect: width / height,
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

function syntheticLandmarks({ rx = 0.07, ry = 0.04, noseX = 0.5 } = {}) {
  const landmarks = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }))
  landmarks[LEFT_EYE] = { x: 0.36, y: 0.4, z: 0 }
  landmarks[RIGHT_EYE] = { x: 0.64, y: 0.4, z: 0 }
  landmarks[NOSE] = { x: noseX, y: 0.52, z: 0 }
  const cx = 0.5
  const cy = 0.64
  placeArc(landmarks, [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291], Math.PI, Math.PI * 2, cx, cy, rx, ry)
  placeArc(landmarks, [291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61], 0, Math.PI, cx, cy, rx, ry)
  return landmarks
}

export { OUTER_LIPS, extractLipFeatures, syntheticLandmarks }
