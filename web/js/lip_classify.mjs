const COPY = {
  roundNow: "现在嘴唇是圆的",
  roundMore: "嘴唇还可以再圆一点",
  notRound: "嘴唇没圆起来",
  spreadNow: "现在嘴唇是拉开的",
  spreadMore: "嘴角还可以再拉开一点",
  tooRound: "嘴唇太圆了，往两边拉开",
  notSpread: "嘴唇再往两边拉开",
  needBaseline: "先记下你的自然口型",
  needTarget: "先选一个字",
  openNow: "现在嘴张得比较大",
  openMore: "嘴还可以再张开一点",
  notOpen: "嘴张得不够大",
  closeNow: "现在上下嘴唇碰住了",
  closeMore: "上下嘴唇还可以再碰紧一点",
  notClose: "上下嘴唇没碰住",
  liftNow: "现在下唇抬起来了",
  liftMore: "下唇还可以再抬一点",
  notLift: "下嘴唇没碰到上牙",
  relOpen: "比你的自然口型张得更大",
  relClose: "比你的自然口型闭得更紧",
  relLift: "下唇比自然时抬得更高",
  noface: "请把整张脸放进画面",
  far: "请再靠近一点",
  close: "请稍微离远一点",
  turn: "请正对镜头",
  mouth: "请把嘴露出来",
  dark: "光线不够，请到亮一点的地方",
  clipMiss: "刚才那一下没留住，再跟一次",
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
  dark: COPY.dark,
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) return (sorted[mid - 1] + sorted[mid]) / 2
  return sorted[mid]
}

const FEATURE_KEYS = ["width", "height", "closure", "aspect", "jaw", "corner", "lipChin"]

function baselineFromSamples(samples) {
  const good = samples.filter((sample) => sample && sample.ok)
  if (good.length < 8) return null
  const baseline = {}
  for (const key of FEATURE_KEYS) baseline[key] = median(good.map((sample) => sample[key]))
  return baseline
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

function rel(current, base) {
  return current / base
}

function openShape(features, baseline) {
  const jawRel = rel(features.jaw, baseline.jaw)
  if (jawRel > 1.15) return "open"
  if (jawRel > 1.06) return "slight-open"
  return "shut"
}

function closeShape(features, baseline) {
  const closureRel = rel(features.closure, baseline.closure)
  if (closureRel > 1.45) return "apart"
  if (closureRel > 1.2) return "slight-closed"
  return "closed"
}

function liftShape(features, baseline) {
  const liftRel = rel(features.lipChin, baseline.lipChin)
  if (liftRel > 1.18) return "lifted"
  if (liftRel > 1.08) return "slight-lift"
  return "low"
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
  if (target === "open") {
    if (shape === "open") return COPY.openNow
    if (shape === "slight-open") return COPY.openMore
    return COPY.notOpen
  }
  if (target === "close") {
    if (shape === "closed") return COPY.closeNow
    if (shape === "slight-closed") return COPY.closeMore
    return COPY.notClose
  }
  if (target === "lift") {
    if (shape === "lifted") return COPY.liftNow
    if (shape === "slight-lift") return COPY.liftMore
    return COPY.notLift
  }
  throw new Error(`unknown target: ${target}`)
}

function relationText(shape) {
  if (shape === "round" || shape === "slight-round") return COPY.relRound
  if (shape === "spread" || shape === "slight-spread") return COPY.relSpread
  if (shape === "neutral") return COPY.relNear
  if (shape === "open" || shape === "slight-open") return COPY.relOpen
  if (shape === "closed" || shape === "slight-closed") return COPY.relClose
  if (shape === "lifted" || shape === "slight-lift") return COPY.relLift
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
  const known = target === "round" || target === "spread" || target === "open" || target === "close" || target === "lift"
  if (!known) return { prompt: COPY.needTarget, shape: "wait", relation: "" }
  const shape = shapeFor(target, features, baseline)
  return { prompt: promptFor(target, shape), shape, relation: relationText(shape) }
}

function shapeFor(target, features, baseline) {
  if (target === "open") return openShape(features, baseline)
  if (target === "close") return closeShape(features, baseline)
  if (target === "lift") return liftShape(features, baseline)
  return classifyShape(features, baseline)
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
