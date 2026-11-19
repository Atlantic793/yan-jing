import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { extractLipFeatures, syntheticLandmarks } from "../web/js/lip_geometry.mjs"
import { COPY, attributeLip, baselineFromSamples, bumpAttempt, classifyShape } from "../web/js/lip_classify.mjs"
import { DARK_LUMA, LOOP_MS, demoPose, gateLight, lightFromLuma, loopUnit, meanLuma, sessionWrap } from "../web/js/session_flow.mjs"

function featuresOf(rx, ry, noseX = 0.5) {
  return extractLipFeatures(syntheticLandmarks({ rx, ry, noseX }))
}

function baselineOf(rx = 0.07, ry = 0.04) {
  const sample = featuresOf(rx, ry)
  assert.equal(sample.ok, true)
  return baselineFromSamples(Array.from({ length: 8 }, () => sample))
}

test("同一个人的自然口型保持自然", () => {
  const baseline = baselineOf()
  assert.equal(classifyShape(featuresOf(0.07, 0.04), baseline), "neutral")
})

test("拉开判展唇，收小判圆唇", () => {
  const baseline = baselineOf()
  const spread = featuresOf(0.105, 0.035)
  const round = featuresOf(0.045, 0.055)
  assert.equal(classifyShape(spread, baseline), "spread")
  assert.equal(classifyShape(round, baseline), "round")
  assert.equal(attributeLip({ features: spread, baseline, target: "spread" }).prompt, COPY.spreadNow)
  assert.equal(attributeLip({ features: round, baseline, target: "round" }).prompt, COPY.roundNow)
  assert.equal(attributeLip({ features: spread, baseline, target: "round" }).prompt, COPY.notRound)
  assert.equal(attributeLip({ features: round, baseline, target: "spread" }).prompt, COPY.tooRound)
})

test("只张嘴不拉开，不算展唇", () => {
  const baseline = baselineOf()
  assert.equal(classifyShape(featuresOf(0.07, 0.09), baseline), "neutral")
})

test("没看到脸时先提示摆正，不给口型结论", () => {
  const hidden = { ok: false, reason: "noface" }
  assert.equal(attributeLip({ features: hidden, baseline: null, target: null }).prompt, COPY.noface)
  assert.equal(attributeLip({ features: hidden, baseline: baselineOf(), target: "round" }).prompt, COPY.noface)
})

test("没有本人基线、没有目标时不给口型结论", () => {
  const features = featuresOf(0.045, 0.055)
  assert.equal(attributeLip({ features, baseline: null, target: "round" }).prompt, COPY.needBaseline)
  assert.equal(attributeLip({ features, baseline: baselineOf(), target: null }).prompt, COPY.needTarget)
})

test("脸转开时不判口型", () => {
  const turned = featuresOf(0.07, 0.04, 0.62)
  assert.equal(turned.ok, false)
  assert.equal(turned.reason, "turn")
  const result = attributeLip({ features: turned, baseline: baselineOf(), target: "round" })
  assert.equal(result.prompt, COPY.turn)
  assert.equal(result.shape, "wait")
})

test("啊看下颌，爸看闭合，发看下唇，乌和鱼同属圆唇", () => {
  const baseline = baselineOf()
  const open = extractLipFeatures(syntheticLandmarks({ chinY: 0.94 }))
  const shut = featuresOf(0.07, 0.04)
  assert.equal(attributeLip({ features: open, baseline, target: "open" }).prompt, COPY.openNow)
  assert.equal(attributeLip({ features: shut, baseline, target: "open" }).prompt, COPY.notOpen)

  const apart = extractLipFeatures(syntheticLandmarks({ innerGap: 0.08 }))
  const together = featuresOf(0.07, 0.04)
  assert.equal(attributeLip({ features: apart, baseline, target: "close" }).prompt, COPY.notClose)
  assert.equal(attributeLip({ features: together, baseline, target: "close" }).prompt, COPY.closeNow)

  const lifted = extractLipFeatures(syntheticLandmarks({ lowerLipY: 0.56 }))
  assert.equal(attributeLip({ features: lifted, baseline, target: "lift" }).prompt, COPY.liftNow)
  assert.equal(attributeLip({ features: together, baseline, target: "lift" }).prompt, COPY.notLift)

  const round = featuresOf(0.045, 0.055)
  assert.equal(attributeLip({ features: round, baseline, target: "round" }).prompt, COPY.roundNow)
})

test("练习次数与口型无关", () => {
  assert.equal(bumpAttempt(0), 1)
  assert.equal(bumpAttempt(4), 5)
})

test("页面和规则文案不越界", () => {
  const banned = ["相似度", "标准口型", "舌位", "得分", "分数", "正确", "错误", "通过", "失败", "模板", "奖励", "星星", "发音准", "无"]
  const files = sourceFiles(join(import.meta.dirname, "..", "web"))
  const blob = files.map((file) => readFileSync(file, "utf8")).join("\n")
  for (const word of banned) {
    assert.equal(blob.includes(word), false, word)
  }
  assert.equal(blob.includes("衣"), true)
  assert.equal(blob.includes("鱼"), true)
})

test("光线不够时拦住，不给口型结论", () => {
  const dark = gateLight(featuresOf(0.105, 0.035), lightFromLuma(10))
  const result = attributeLip({ features: dark, baseline: baselineOf(), target: "spread" })
  assert.equal(dark.reason, "dark")
  assert.equal(result.shape, "wait")
  assert.equal(result.prompt, COPY.dark)
  assert.equal(lightFromLuma(DARK_LUMA).ok, true)
  assert.equal(lightFromLuma(DARK_LUMA - 1).ok, false)
  const bright = lightFromLuma(meanLuma(new Uint8ClampedArray([180, 180, 180, 255])))
  assert.equal(bright.ok, true)
  assert.equal(gateLight(featuresOf(0.07, 0.04), bright).ok, true)
  assert.equal(lightFromLuma(meanLuma(new Uint8ClampedArray([10, 10, 10, 255]))).ok, false)
})

test("示范一圈走到中段就是这个字要的口型，慢放把 1.5 秒拉成 3 秒", () => {
  const baseline = baselineOf()
  const peak = (kind) => extractLipFeatures(demoPose(kind, 0.5))
  assert.equal(attributeLip({ features: peak("spread"), baseline, target: "spread" }).prompt, COPY.spreadNow)
  assert.equal(attributeLip({ features: peak("round"), baseline, target: "round" }).prompt, COPY.roundNow)
  assert.equal(attributeLip({ features: peak("open"), baseline, target: "open" }).prompt, COPY.openNow)
  assert.equal(attributeLip({ features: peak("close"), baseline, target: "close" }).prompt, COPY.closeNow)
  assert.equal(attributeLip({ features: peak("lift"), baseline, target: "lift" }).prompt, COPY.liftNow)
  assert.equal(LOOP_MS, 1500)
  assert.equal(loopUnit(0, false), 0)
  assert.equal(loopUnit(750, false), 0.5)
  assert.equal(loopUnit(1500, false), 0)
  assert.equal(loopUnit(1500, true), 0.5)
})

test("收尾列出练过的字，并留下出现最多的那一句", () => {
  const summary = sessionWrap([
    { char: "衣", prompt: COPY.notSpread },
    { char: "鱼", prompt: COPY.notRound },
    { char: "衣", prompt: COPY.notRound },
  ])
  assert.deepEqual(summary.chars, ["衣", "鱼"])
  assert.equal(summary.prompt, COPY.notRound)
  assert.equal(summary.headline, "今天练了 衣、鱼")
  const tie = sessionWrap([
    { char: "啊", prompt: COPY.notOpen },
    { char: "爸", prompt: COPY.notClose },
  ])
  assert.equal(tie.prompt, COPY.notOpen)
  const empty = sessionWrap([])
  assert.equal(empty.headline, "今天还没记过练习")
  assert.equal(empty.prompt, "")
})

test("练习流程按计划走五步", () => {
  const html = readFileSync(join(import.meta.dirname, "..", "web", "index.html"), "utf8")
  const steps = [...html.matchAll(/data-step="([^"]+)"/g)].map((match) => match[1])
  assert.deepEqual(steps, ["seat", "demo", "follow", "pair", "wrap"])
  const flow = `${html}\n${readFileSync(join(import.meta.dirname, "..", "web", "js", "demo.mjs"), "utf8")}`
  for (const word of ["就位", "示范", "跟练", "并排", "收尾", "要做的动作", "刚才那一下", "慢放", "我来跟", "今天练完了", "1.5 秒"]) {
    assert.equal(flow.includes(word), true, word)
  }
})

test("练习字按计划归类，鱼和乌都只记圆唇", () => {
  const html = readFileSync(join(import.meta.dirname, "..", "web", "index.html"), "utf8")
  const pairs = [...html.matchAll(/data-lip="([^"]+)" data-char="([^"]+)"/g)].map((match) => [match[2], match[1]])
  const kind = Object.fromEntries(pairs)
  assert.equal(kind["衣"], "spread")
  assert.equal(kind["叶"], "spread")
  assert.equal(kind["鱼"], "round")
  assert.equal(kind["乌"], "round")
  assert.equal(kind["波"], "round")
  assert.equal(kind["啊"], "open")
  assert.equal(kind["爸"], "close")
  assert.equal(kind["拍"], "close")
  assert.equal(kind["妈"], "close")
  assert.equal(kind["发"], "lift")
  assert.equal(html.includes("舌"), false)
})

function sourceFiles(dir) {
  const found = []
  for (const name of readdirSync(dir)) {
    if (name === "vendor" || name === "models") continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) found.push(...sourceFiles(path))
    else if (name.endsWith(".html") || name.endsWith(".mjs") || name.endsWith(".css")) found.push(path)
  }
  return found
}
