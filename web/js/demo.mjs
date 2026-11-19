import { FaceLandmarker, FilesetResolver } from "../vendor/vision_bundle.mjs"
import { extractLipFeatures, syntheticLandmarks } from "./lip_geometry.mjs"
import { attributeLip, baselineFromSamples, describeShape, createShapeHold, bumpAttempt, COPY } from "./lip_classify.mjs"
import { drawMouthView, drawFacePip, fitCanvas } from "./lip_render.mjs"

const preview = new URLSearchParams(location.search).get("preview") === "1"
const sentenceEl = document.querySelector("#sentence")
const relEl = document.querySelector("#rel")
const countEl = document.querySelector("#count")
const baselineFlag = document.querySelector("#baseline-flag")
const glyph = document.querySelector("#glyph")
const mouthCanvas = document.querySelector("#mouth")
const faceCanvas = document.querySelector("#face")
const cameraHelp = document.querySelector("#camera-help")
const cameraHelpText = document.querySelector("#camera-help-text")
const openCameraButton = document.querySelector("#open-camera")
const mouthCtx = mouthCanvas.getContext("2d")
const faceCtx = faceCanvas.getContext("2d")

let target = null
let baseline = null
let attemptCount = 0
let hold = createShapeHold(4)
let smoothed = null
let miss = 0
let lastGood = null
let video = null
let landmarker = null
let lastTimestamp = 0
let framing = false
let modelReady = null
let capturing = false
let captureSamples = []
let captureUntil = 0
let previewStartedAt = 0

function setSentence(text) {
  sentenceEl.textContent = text
}

function selectTarget(next) {
  target = next
  document.querySelector("#pick-spread").classList.toggle("selected", next === "spread")
  document.querySelector("#pick-round").classList.toggle("selected", next === "round")
  glyph.className = `mouth-glyph ${next === "spread" ? "spread" : "round"}`
  hold.reset(null)
}

function recordAttempt() {
  attemptCount = bumpAttempt(attemptCount)
  countEl.textContent = `练习次数 ${attemptCount}`
}

function startBaseline() {
  capturing = true
  captureSamples = []
  captureUntil = performance.now() + 1500
  setSentence("保持自然口型")
}

function finishBaseline() {
  capturing = false
  const next = baselineFromSamples(captureSamples)
  baselineFlag.textContent = next ? "自然口型：已记下" : "自然口型：还没记下"
  if (!next) {
    baseline = null
    setSentence(COPY.baselineFail)
    return
  }
  baseline = next
  smoothed = null
  lastGood = null
  hold.reset(null)
}

function smoothFeature(next) {
  if (!next || !next.ok) {
    miss += 1
    if (miss < 8 && lastGood) return lastGood
    smoothed = null
    return next
  }
  miss = 0
  if (!smoothed || !smoothed.ok) smoothed = next
  else {
    const width = smoothed.width * 0.55 + next.width * 0.45
    const height = smoothed.height * 0.55 + next.height * 0.45
    smoothed = { ok: true, width, height, aspect: width / height }
  }
  lastGood = smoothed
  return smoothed
}

function render(landmarks, source) {
  fitCanvas(mouthCanvas)
  fitCanvas(faceCanvas)
  drawMouthView(mouthCtx, source, landmarks)
  drawFacePip(faceCtx, source, landmarks)
}

function applyFeatures(raw) {
  const features = smoothFeature(raw)
  if (capturing) {
    if (features && features.ok) captureSamples.push(features)
    const left = Math.max(1, Math.ceil((captureUntil - performance.now()) / 1000))
    setSentence(`保持自然口型 ${left}`)
    if (performance.now() >= captureUntil) finishBaseline()
    return
  }
  const shown = attributeLip({ features, baseline, target })
  if (shown.shape === "wait") {
    hold.reset("wait")
    setSentence(shown.prompt)
    relEl.textContent = ""
    return
  }
  const shape = hold.push(shown.shape)
  const described = describeShape(target, shape)
  setSentence(described.prompt)
  relEl.textContent = described.relation
}

function previewLandmarks(now) {
  const cycle = ((now - previewStartedAt) / 1000) % 6
  if (cycle <= 2) return syntheticLandmarks({ rx: 0.07, ry: 0.04 })
  if (cycle <= 4) return syntheticLandmarks({ rx: 0.105, ry: 0.035 })
  return syntheticLandmarks({ rx: 0.045, ry: 0.055 })
}

function frame(now) {
  if (preview) {
    const landmarks = previewLandmarks(now)
    render(landmarks, null)
    applyFeatures(extractLipFeatures(landmarks))
  } else if (landmarker && video && video.readyState >= 2) {
    let landmarks = null
    try {
      lastTimestamp = Math.max(lastTimestamp + 1, Math.round(now))
      const result = landmarker.detectForVideo(video, lastTimestamp)
      landmarks = result.faceLandmarks && result.faceLandmarks[0] ? result.faceLandmarks[0] : null
    } catch (error) {
      console.error(error)
    }
    render(landmarks, video)
    applyFeatures(landmarks ? extractLipFeatures(landmarks) : { ok: false, reason: "noface" })
  }
  requestAnimationFrame(frame)
}

async function loadModel() {
  const wasmBase = new URL("../vendor/wasm/", import.meta.url).href
  const modelPath = new URL("../models/face_landmarker.task", import.meta.url).href
  const fileset = await FilesetResolver.forVisionTasks(wasmBase)
  let lastError = null
  for (const delegate of ["GPU", "CPU"]) {
    try {
      landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath, delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: false,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })
      return
    } catch (error) {
      landmarker = null
      lastError = error
    }
  }
  throw lastError || new Error("model")
}

function ensureModel() {
  if (!modelReady) modelReady = loadModel().catch((error) => {
    modelReady = null
    throw error
  })
  return modelReady
}

async function cameraPermission() {
  try {
    const status = await navigator.permissions.query({ name: "camera" })
    return status.state
  } catch {
    return "prompt"
  }
}

function showCameraHelp(state) {
  cameraHelp.hidden = false
  cameraHelpText.textContent = state === "denied"
    ? "点地址栏左边的摄像头图标，改成允许，再点一次。"
    : "弹出询问时选允许。"
  setSentence("先打开摄像头")
}

async function openCamera() {
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach((track) => track.stop())
  }
  video = document.createElement("video")
  video.playsInline = true
  video.muted = true
  video.srcObject = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
  })
  await video.play()
}

function beginFraming() {
  cameraHelp.hidden = true
  setSentence(COPY.needBaseline)
  if (framing) return
  framing = true
  requestAnimationFrame(frame)
}

async function startCamera() {
  setSentence("正在准备摄像头")
  try {
    await ensureModel()
  } catch (error) {
    console.error(error)
    setSentence("模型没加载成功。请用启动脚本打开，不要直接双击网页")
    return
  }
  try {
    await openCamera()
  } catch (error) {
    console.error(error)
    const blocked = error && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")
    showCameraHelp(blocked ? "denied" : "prompt")
    return
  }
  beginFraming()
}

async function bootCamera() {
  const state = await cameraPermission()
  if (state === "granted") {
    await startCamera()
    return
  }
  showCameraHelp(state)
}

function toggleFull() {
  if (document.fullscreenElement) {
    document.exitFullscreen()
    return
  }
  document.documentElement.requestFullscreen()
}

document.querySelector("#pick-spread").addEventListener("click", () => selectTarget("spread"))
document.querySelector("#pick-round").addEventListener("click", () => selectTarget("round"))
document.querySelector("#baseline").addEventListener("click", startBaseline)
openCameraButton.addEventListener("click", () => { startCamera() })
document.querySelector("#attempt").addEventListener("click", recordAttempt)
document.querySelector("#full").addEventListener("click", toggleFull)

window.addEventListener("keydown", (event) => {
  if (event.key === "1") selectTarget("spread")
  if (event.key === "2") selectTarget("round")
  if (event.key === "b" || event.key === "B") startBaseline()
  if (event.key === "n" || event.key === "N") recordAttempt()
  if (event.key === "f" || event.key === "F") toggleFull()
})

if (preview) {
  document.body.classList.add("preview")
  const modeLink = document.querySelector("#mode-link")
  modeLink.textContent = "返回摄像头"
  modeLink.href = "./"
  previewStartedAt = performance.now()
  startBaseline()
  requestAnimationFrame(frame)
} else {
  bootCamera()
}
