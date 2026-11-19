const COPY = {
  roundNow: "现在嘴唇是圆的",
  roundMore: "嘴唇还可以再圆一点",
  notRound: "嘴唇没圆起来",
  spreadNow: "现在嘴唇是拉开的",
  spreadMore: "嘴角还可以再拉开一点",
  tooRound: "嘴唇太圆了，往两边拉开",
  notSpread: "嘴唇再往两边拉开",
  needBaseline: "先记下你的自然口型",
  needTarget: "先选「衣」或「鱼」",
  noface: "请把整张脸放进画面",
  far: "请再靠近一点",
  close: "请稍微离远一点",
  turn: "请正对镜头",
  mouth: "请把嘴露出来",
  relRound: "比你的自然口型更圆",
  relSpread: "比你的自然口型更宽",
  relNear: "接近你的自然口型",
  baselineOk: "自然口型已记下",
  baselineFail: "没看清，请正对镜头再记一次",
}

const REASON_COPY = {
  noface: COPY.noface,
  far: COPY.far,
  close: COPY.close,
  turn: COPY.turn,
  mouth: COPY.mouth,
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2
  return sorted[mid]
}

function baselineFromSamples(samples) {
  const good = samples.filter((sample) => sample && sample.ok)
  if (good.length < 8) return null
  return {
    width: median(good.map((sample) => sample.width)),
    height: median(good.map((sample) => sample.height)),
    aspect: median(good.map((sample) => sample.aspect)),
  }
}

function classifyShape(features, baseline) {
  const widthRel = features.width / baseline.width
  const aspectRel = features.aspect / baseline.aspect
  if (widthRel < 0.9) return "round"
  if (widthRel > 1.12 && aspectRel > 0.95) return "spread"
  if (widthRel < 0.95) return "slight-round"
  if (widthRel > 1.06 && aspectRel > 0.95) return "slight-spread"
  return "neutral"
}

function promptFor(target, shape) {
  if (target === "round") {
    if (shape === "round") return COPY.roundNow
    if (shape === "slight-round") return COPY.roundMore
    return COPY.notRound
  }
  if (target === "spread") {
    if (shape === "spread") return COPY.spreadNow
    if (shape === "slight-spread") return COPY.spreadMore
    if (shape === "round" || shape === "slight-round") return COPY.tooRound
    return COPY.notSpread
  }
  throw new Error(`unknown target: ${target}`)
}

function relationText(shape) {
  if (shape === "round" || shape === "slight-round") return COPY.relRound
  if (shape === "spread" || shape === "slight-spread") return COPY.relSpread
  if (shape === "neutral") return COPY.relNear
  return ""
}

function describeShape(target, shape) {
  return { prompt: promptFor(target, shape), relation: relationText(shape) }
}

function attributeLip({ features, baseline, target }) {
  if (!features || !features.ok) {
    const reason = features && features.reason ? features.reason : "noface"
    return { prompt: REASON_COPY[reason] || COPY.noface, shape: "wait", relation: "" }
  }
  if (!baseline) return { prompt: COPY.needBaseline, shape: "wait", relation: "" }
  if (target !== "round" && target !== "spread") {
    return { prompt: COPY.needTarget, shape: "wait", relation: "" }
  }
  const shape = classifyShape(features, baseline)
  return { prompt: promptFor(target, shape), shape, relation: relationText(shape) }
}

function createShapeHold(frames = 4) {
  let stable = null
  let pending = null
  let count = 0
  return {
    reset(next) {
      stable = next
      pending = null
      count = 0
    },
    push(shape) {
      if (stable === null || shape === "wait") {
        stable = shape
        pending = null
        count = 0
        return stable
      }
      if (shape === stable) {
        pending = null
        count = 0
        return stable
      }
      if (shape !== pending) {
        pending = shape
        count = 1
      } else {
        count += 1
      }
      if (count >= frames) {
        stable = pending
        pending = null
        count = 0
      }
      return stable
    },
  }
}

function bumpAttempt(count) {
  return count + 1
}

export { COPY, baselineFromSamples, classifyShape, attributeLip, describeShape, relationText, createShapeHold, bumpAttempt }
