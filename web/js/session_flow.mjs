import { syntheticLandmarks } from "./lip_geometry.mjs"

const LOOP_MS = 1500
const DARK_LUMA = 48

function clamp01(unit) {
  if (unit < 0) return 0
  if (unit > 1) return 1
  return unit
}

function meanLuma(pixels) {
  let sum = 0
  let count = 0
  for (let i = 0; i + 2 < pixels.length; i += 4) {
    sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]
    count += 1
  }
  if (!count) return 0
  return sum / count
}

function lightFromLuma(luma) {
  if (luma < DARK_LUMA) return { ok: false, reason: "dark", luma }
  return { ok: true, luma }
}

function gateLight(features, light) {
  if (light && light.ok === false) return { ok: false, reason: "dark" }
  return features
}

function loopUnit(elapsed, slow) {
  const period = slow ? LOOP_MS * 2 : LOOP_MS
  const wrapped = ((elapsed % period) + period) % period
  return wrapped / period
}

function demoPose(target, unit) {
  const wave = Math.sin(clamp01(unit) * Math.PI)
  const base = { rx: 0.07, ry: 0.04, innerGap: 0.012, chinY: 0.8 }
  switch (target) {
    case "spread":
      return syntheticLandmarks({ ...base, rx: 0.07 + 0.04 * wave, ry: 0.04 - 0.008 * wave })
    case "round":
      return syntheticLandmarks({ ...base, rx: 0.07 - 0.028 * wave, ry: 0.04 + 0.018 * wave })
    case "open":
      return syntheticLandmarks({
        ...base,
        chinY: 0.8 + 0.14 * wave,
        ry: 0.04 + 0.03 * wave,
        innerGap: 0.012 + 0.03 * wave,
      })
    case "close":
      return syntheticLandmarks({ ...base, innerGap: 0.05 - 0.04 * wave })
    case "lift":
      return syntheticLandmarks({ ...base, lowerLipY: 0.646 - 0.09 * wave })
    default: {
      const unknown = target
      throw new Error(`unknown target: ${unknown}`)
    }
  }
}

function sessionWrap(entries) {
  const list = Array.isArray(entries) ? entries.filter((item) => item && item.char && item.prompt) : []
  if (!list.length) return { chars: [], prompt: "", headline: "今天还没记过练习" }
  const chars = []
  const order = []
  const counts = new Map()
  for (const item of list) {
    if (!chars.includes(item.char)) chars.push(item.char)
    if (!counts.has(item.prompt)) order.push(item.prompt)
    counts.set(item.prompt, (counts.get(item.prompt) || 0) + 1)
  }
  let prompt = order[0]
  let best = 0
  for (const item of order) {
    const count = counts.get(item)
    if (count > best) {
      best = count
      prompt = item
    }
  }
  return { chars, prompt, headline: `今天练了 ${chars.join("、")}` }
}

export { LOOP_MS, DARK_LUMA, meanLuma, lightFromLuma, gateLight, loopUnit, demoPose, sessionWrap }
