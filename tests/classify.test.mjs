import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import test from "node:test"
import { extractLipFeatures, syntheticLandmarks } from "../web/js/lip_geometry.mjs"
import { COPY, attributeLip, baselineFromSamples, bumpAttempt, classifyShape } from "../web/js/lip_classify.mjs"

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

test("练习次数与口型无关", () => {
  assert.equal(bumpAttempt(0), 1)
  assert.equal(bumpAttempt(4), 5)
})

test("页面和规则文案不越界", () => {
  const banned = ["相似度", "标准口型", "舌位", "得分", "分数", "正确", "错误", "通过", "失败", "模板", "乌", "奖励", "星星", "发音准", "无"]
  const files = sourceFiles(join(import.meta.dirname, "..", "web"))
  const blob = files.map((file) => readFileSync(file, "utf8")).join("\n")
  for (const word of banned) {
    assert.equal(blob.includes(word), false, word)
  }
  assert.equal(blob.includes("衣"), true)
  assert.equal(blob.includes("鱼"), true)
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
