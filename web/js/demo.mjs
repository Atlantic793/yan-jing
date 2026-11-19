import { FaceLandmarker, FilesetResolver } from "../vendor/vision_bundle.mjs"
import { extractLipFeatures, syntheticLandmarks } from "./lip_geometry.mjs"
import { attributeLip, baselineFromSamples, describeShape, createShapeHold, bumpAttempt, COPY } from "./lip_classify.mjs"
import { drawMouthView, drawFacePip, drawStill, fitCanvas } from "./lip_render.mjs"
import { demoPose, gateLight, lightFromLuma, loopUnit, meanLuma, sessionWrap } from "./session_flow.mjs"

const params = new URLSearchParams(location.search)
const preview = params.get("preview") === "1"
const previewDark = preview && params.get("dark") === "1"
const sentenceEl = document.querySelector("#sentence")
const relEl = document.querySelector("#rel")
const countEl = document.querySelector("#count")
const baselineFlag = document.querySelector("#baseline-flag")
const glyph = document.querySelector("#glyph")
const actionCol = document.querySelector("#action-col")
const childCol = document.querySelector("#child-col")
const actionLabel = document.querySelector("#action-label")
const childLabel = document.querySelector("#child-label")
const mouthCanvas = document.querySelector("#mouth")
const actionCanvas = document.querySelector("#action")
const faceCanvas = document.querySelector("#face")
const cameraHelp = document.querySelector("#camera-help")
const cameraHelpText = document.querySelector("#camera-help-text")
const openCameraButton = document.querySelector("#open-camera")
const slowButton = document.querySelector("#slow")
const followButton = document.querySelector("#follow")
const againButton = document.querySelector("#again")
const mouthCtx = mouthCanvas.getContext("2d")
const actionCtx = actionCanvas.getContext("2d")
const faceCtx = faceCanvas.getContext("2d")
const lightCanvas = document.createElement("canvas")
lightCanvas.width = 24
lightCanvas.height = 24
const lightCtx = lightCanvas.getContext("2d", { willReadFrequently: true })

let phase = "seat"
let target = null
let activeChar = ""
let baseline = null
let attemptCount = 0
let hold = createShapeHold(4)
let lightHold = createShapeHold(6)
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
let darkDuringCapture = false
let previewStartedAt = 0
let lastLightOk = !previewDark
let slow = false
let loopStart = 0
let ring = []
let clip = []
let lastSnap = 0
let log = []

lightHold.reset(previewDark ? "dark" : "ok")

function setSentence(text) {
  sentenceEl.textContent = text
}

function demoLine() {
  return `看${activeChar}，这一下会重复`
}

function paintLabels() {
  const pace = slow ? "慢放" : "1.5 秒"
  actionLabel.textContent = `要做的动作 · ${pace}`
  childLabel.textContent = phase === "pair" ? `刚才那一下 · ${pace}` : "你现在的口型"
}

function setPhase(next) {
  phase = next
  document.body.classList.remove("phase-seat", "phase-demo", "phase-follow", "phase-pair", "phase-wrap")
  document.body.classList.add(`phase-${next}`)
  document.querySelectorAll("[data-step]").forEach((item) => {
    item.classList.toggle("on", item.dataset.step === next)
  })
  actionCol.hidden = next !== "demo" && next !== "pair"
  childCol.hidden = next === "demo" || next === "wrap"
  slowButton.hidden = next !== "demo" && next !== "pair"
  followButton.hidden = next !== "demo"
  againButton.hidden = next !== "pair"
  if (next === "demo" || next === "pair") loopStart = performance.now()
  if (next === "follow") {
    ring = []
    lastSnap = 0
    smoothed = null
    lastGood = null
    miss = 0
    hold.reset(null)
  }
  if (next !== "pair") clip = []
  paintLabels()
  if (next === "wrap") {
    const summary = sessionWrap(log)
    setSentence(summary.headline)
    relEl.textContent = summary.prompt ? `最常出现的一句：${summary.prompt}` : ""
  }
}

function selectTarget(next, button) {
  if (capturing) {
    capturing = false
    captureSamples = []
  }
  target = next
  activeChar = button.dataset.char
  document.querySelectorAll("[data-lip]").forEach((item) => {
    item.classList.toggle("selected", item === button)
  })
  glyph.className = `mouth-glyph ${next === "spread" ? "spread" : "round"}`
  hold.reset(null)
  relEl.textContent = ""
  if (!lastLightOk) {
    setPhase("seat")
    setSentence(COPY.dark)
    return
  }
  if (!baseline) {
    setPhase("seat")
    setSentence(COPY.needBaseline)
    return
  }
  setPhase("demo")
  setSentence(demoLine())
}

function beginFollow() {
  if (!target || !activeChar) {
    setSentence(COPY.needTarget)
    return
  }
  if (!lastLightOk) {
    setPhase("seat")
    setSentence(COPY.dark)
    return
  }
  if (!baseline) {
    setPhase("seat")
    setSentence(COPY.needBaseline)
    return
  }
  setPhase("follow")
}

function recordAttempt() {
  attemptCount = bumpAttempt(attemptCount)
  countEl.textContent = `练习次数 ${attemptCount}`
  if (phase !== "follow" || !target || !activeChar) return
  const prompt = sentenceEl.textContent
  const relation = relEl.textContent
  log.push({ char: activeChar, prompt })
  clip = ring.slice()
  setPhase("pair")
  if (clip.length) {
    setSentence(prompt)
    relEl.textContent = relation
  } else {
    setSentence(COPY.clipMiss)
    relEl.textContent = ""
  }
}

function toggleSlow() {
  slow = !slow
  slowButton.textContent = slow ? "原速" : "慢放"
  loopStart = performance.now()
  paintLabels()
}

function startBaseline() {
  if (!lastLightOk) {
    setPhase("seat")
    setSentence(COPY.dark)
    relEl.textContent = ""
    return
  }
  setPhase("seat")
  capturing = true
  captureSamples = []
  darkDuringCapture = false
  captureUntil = performance.now() + 1500
  relEl.textContent = ""
  setSentence("保持自然口型")
}

function finishBaseline() {
  capturing = false
  const next = baselineFromSamples(captureSamples)
  const failedDark = darkDuringCapture && !next
  darkDuringCapture = false
  baselineFlag.textContent = next ? "自然口型：已记下" : "自然口型：还没记下"
  if (!next) {
    baseline = null
    smoothed = null
    setSentence(failedDark ? COPY.dark : COPY.baselineFail)
    return
  }
  baseline = next
  smoothed = null
  lastGood = null
  hold.reset(null)
  if (target && activeChar && lastLightOk) {
    setPhase("demo")
    setSentence(demoLine())
    relEl.textContent = ""
  }
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
    const mix = (key) => smoothed[key] * 0.55 + next[key] * 0.45
    smoothed = {
      ok: true,
      width: mix("width"),
      height: mix("height"),
      closure: mix("closure"),
      aspect: mix("aspect"),
      jaw: mix("jaw"),
      corner: mix("corner"),
      lipChin: mix("lipChin"),
    }
  }
  lastGood = smoothed
  return smoothed
}

function faceBox(source, landmarks) {
  const width = source.videoWidth
  const height = source.videoHeight
  let minX = 0.3
  let minY = 0.2
  let maxX = 0.7
  let maxY = 0.7
  if (landmarks && landmarks.length >= 468) {
    minX = 1
    minY = 1
    maxX = 0
    maxY = 0
    for (const id of [10, 152, 234, 454]) {
      minX = Math.min(minX, landmarks[id].x)
      maxX = Math.max(maxX, landmarks[id].x)
      minY = Math.min(minY, landmarks[id].y)
      maxY = Math.max(maxY, landmarks[id].y)
    }
  }
  minX = Math.min(1, Math.max(0, minX))
  minY = Math.min(1, Math.max(0, minY))
  maxX = Math.min(1, Math.max(minX + 0.05, maxX))
  maxY = Math.min(1, Math.max(minY + 0.05, maxY))
  return {
    sx: minX * width,
    sy: minY * height,
    sw: Math.max(1, (maxX - minX) * width),
    sh: Math.max(1, (maxY - minY) * height),
  }
}

function readLight(source, landmarks) {
  if (previewDark) return lightFromLuma(10)
  if (!source || !source.videoWidth || !source.videoHeight) return { ok: true, skipped: true }
  const box = faceBox(source, landmarks)
  lightCtx.drawImage(source, box.sx, box.sy, box.sw, box.sh, 0, 0, 24, 24)
  return lightFromLuma(meanLuma(lightCtx.getImageData(0, 0, 24, 24).data))
}

function updateLight(light) {
  if (!light || light.skipped) return
  lastLightOk = lightHold.push(light.ok ? "ok" : "dark") !== "dark"
}

function render(landmarks, source) {
  fitCanvas(mouthCanvas)
  fitCanvas(faceCanvas)
  drawMouthView(mouthCtx, source, landmarks)
  drawFacePip(faceCtx, source, landmarks)
}

function rememberFrame(now) {
  if (mouthCanvas.width < 20) return
  if (now - lastSnap < 100) return
  lastSnap = now
  const snap = document.createElement("canvas")
  const width = Math.min(480, mouthCanvas.width)
  const height = Math.max(2, Math.round(width * (mouthCanvas.height / mouthCanvas.width)))
  snap.width = width
  snap.height = height
  snap.getContext("2d").drawImage(mouthCanvas, 0, 0, width, height)
  ring.push({ t: now, canvas: snap })
  while (ring.length && now - ring[0].t > 1500) ring.shift()
}

function frameAt(frames, unit) {
  if (!frames.length) return null
  const index = Math.min(frames.length - 1, Math.floor(Math.min(0.9999, Math.max(0, unit)) * frames.length))
  return frames[index]
}

function drawAction(unit) {
  if (!target) return
  fitCanvas(actionCanvas)
  drawMouthView(actionCtx, null, demoPose(target, unit))
}

function drawPlayback(unit) {
  fitCanvas(mouthCanvas)
  const item = frameAt(clip, unit)
  drawStill(mouthCtx, item ? item.canvas : null)
}

function applyFeatures(raw, light) {
  if (phase === "wrap" || phase === "demo" || phase === "pair") return
  const gated = gateLight(raw, light)
  if (capturing) {
    if (gated && gated.ok) captureSamples.push(gated)
    else if (gated && gated.reason === "dark") darkDuringCapture = true
    if (performance.now() >= captureUntil) {
      finishBaseline()
      return
    }
    if (!lastLightOk) setSentence(COPY.dark)
    else {
      const left = Math.max(1, Math.ceil((captureUntil - performance.now()) / 1000))
      setSentence(`保持自然口型 ${left}`)
    }
    return
  }
  if (!lastLightOk) {
    hold.reset("wait")
    setSentence(COPY.dark)
    relEl.textContent = ""
    return
  }
  const features = smoothFeature(gated)
  const shown = attributeLip({ features, baseline, target: phase === "follow" ? target : null })
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

function see(now) {
  if (preview) return { landmarks: previewLandmarks(now), source: null }
  if (!landmarker || !video || video.readyState < 2) return null
  let landmarks = null
  try {
    lastTimestamp = Math.max(lastTimestamp + 1, Math.round(now))
    const result = landmarker.detectForVideo(video, lastTimestamp)
    landmarks = result.faceLandmarks && result.faceLandmarks[0] ? result.faceLandmarks[0] : null
  } catch (error) {
    console.error(error)
  }
  return { landmarks, source: video }
}

function frame(now) {
  const seen = see(now)
  if (!seen && phase !== "demo" && phase !== "pair" && phase !== "wrap") {
    requestAnimationFrame(frame)
    return
  }
  const landmarks = seen ? seen.landmarks : null
  const source = seen ? seen.source : null
  const light = seen || previewDark ? readLight(source, landmarks) : { ok: true, skipped: true }
  updateLight(light)
  if (!lastLightOk && phase !== "seat" && phase !== "wrap" && !capturing) setPhase("seat")
  const unit = loopUnit(now - loopStart, slow)
  if (phase === "demo" || phase === "pair") drawAction(unit)
  if (phase === "pair") {
    drawPlayback(unit)
    fitCanvas(faceCanvas)
    drawFacePip(faceCtx, source, landmarks)
  } else if (phase === "demo" || phase === "wrap") {
    fitCanvas(faceCanvas)
    drawFacePip(faceCtx, source, landmarks)
  } else if (seen) {
    render(landmarks, source)
    const raw = landmarks ? extractLipFeatures(landmarks) : { ok: false, reason: "noface" }
    applyFeatures(raw, light)
    if (phase === "follow") rememberFrame(now)
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
  if (phase === "seat" && !capturing) setSentence(baseline ? COPY.needTarget : COPY.needBaseline)
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

document.querySelectorAll("[data-lip]").forEach((button) => {
  button.addEventListener("click", () => selectTarget(button.dataset.lip, button))
})
document.querySelector("#baseline").addEventListener("click", startBaseline)
openCameraButton.addEventListener("click", () => { startCamera() })
document.querySelector("#attempt").addEventListener("click", recordAttempt)
followButton.addEventListener("click", beginFollow)
againButton.addEventListener("click", beginFollow)
slowButton.addEventListener("click", toggleSlow)
document.querySelector("#done").addEventListener("click", () => { setPhase("wrap") })
document.querySelector("#full").addEventListener("click", toggleFull)

window.addEventListener("keydown", (event) => {
  if (event.repeat) return
  if (event.key === "1") document.querySelector('[data-char="衣"]').click()
  if (event.key === "2") document.querySelector('[data-char="鱼"]').click()
  if (event.key === "b" || event.key === "B") startBaseline()
  if (event.key === "n" || event.key === "N") recordAttempt()
  if (event.key === "s" || event.key === "S") toggleSlow()
  if (event.key === "f" || event.key === "F") toggleFull()
})

if (preview) {
  document.body.classList.add("preview")
  const modeLink = document.querySelector("#mode-link")
  modeLink.textContent = "返回摄像头"
  modeLink.href = "./"
  previewStartedAt = performance.now()
  requestAnimationFrame(frame)
  if (previewDark) setSentence(COPY.dark)
  else startBaseline()
} else {
  bootCamera()
}
