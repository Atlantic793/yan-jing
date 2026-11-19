import { OUTER_LIPS } from "./lip_geometry.mjs"

function mouthRect(landmarks) {
  let minX = 1
  let minY = 1
  let maxX = 0
  let maxY = 0
  for (const index of OUTER_LIPS) {
    const point = landmarks[index]
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  let nw = Math.max(0.2, (maxX - minX) * 2.6)
  let nh = Math.max(0.2, (maxY - minY) * 3.4)
  const viewAspect = 4 / 3
  if (nw / nh < viewAspect) nw = nh * viewAspect
  else nh = nw / viewAspect
  nw = Math.min(1, nw)
  nh = Math.min(1, nh)
  let nx = cx - nw / 2
  let ny = cy - nh / 2
  if (nx < 0) nx = 0
  if (ny < 0) ny = 0
  if (nx + nw > 1) nx = Math.max(0, 1 - nw)
  if (ny + nh > 1) ny = Math.max(0, 1 - nh)
  return { nx, ny, nw, nh }
}

function mapPoint(point, rect, width, height) {
  return {
    x: ((point.x - rect.nx) / rect.nw) * width,
    y: ((point.y - rect.ny) / rect.nh) * height,
  }
}

function strokeLips(ctx, landmarks, rect) {
  const width = ctx.canvas.width
  const height = ctx.canvas.height
  ctx.beginPath()
  OUTER_LIPS.forEach((index, i) => {
    const point = mapPoint(landmarks[index], rect, width, height)
    if (i === 0) ctx.moveTo(point.x, point.y)
    else ctx.lineTo(point.x, point.y)
  })
  ctx.closePath()
  ctx.lineJoin = "round"
  ctx.lineWidth = Math.max(6, width * 0.012)
  ctx.strokeStyle = "#16303c"
  ctx.stroke()
  ctx.lineWidth = Math.max(3, width * 0.006)
  ctx.strokeStyle = "#c23b55"
  ctx.stroke()
}

function drawSketch(ctx, landmarks, rect) {
  const width = ctx.canvas.width
  const height = ctx.canvas.height
  ctx.fillStyle = "#e7d3bf"
  ctx.fillRect(0, 0, width, height)
  const left = mapPoint(landmarks[33], rect, width, height)
  const right = mapPoint(landmarks[263], rect, width, height)
  ctx.fillStyle = "#17211c"
  ctx.beginPath()
  ctx.arc(left.x, left.y, width * 0.02, 0, Math.PI * 2)
  ctx.arc(right.x, right.y, width * 0.02, 0, Math.PI * 2)
  ctx.fill()
}

function drawCover(ctx, source) {
  const width = ctx.canvas.width
  const height = ctx.canvas.height
  const scale = Math.max(width / source.videoWidth, height / source.videoHeight)
  const dw = source.videoWidth * scale
  const dh = source.videoHeight * scale
  ctx.drawImage(source, (width - dw) / 2, (height - dh) / 2, dw, dh)
}

function drawMouthView(ctx, source, landmarks) {
  const width = ctx.canvas.width
  const height = ctx.canvas.height
  ctx.clearRect(0, 0, width, height)
  if (!landmarks) {
    if (source && source.videoWidth) drawCover(ctx, source)
    else {
      ctx.fillStyle = "#d9d3c7"
      ctx.fillRect(0, 0, width, height)
    }
    return
  }
  const rect = mouthRect(landmarks)
  if (source && source.videoWidth) {
    ctx.drawImage(
      source,
      rect.nx * source.videoWidth,
      rect.ny * source.videoHeight,
      rect.nw * source.videoWidth,
      rect.nh * source.videoHeight,
      0,
      0,
      width,
      height,
    )
  } else {
    drawSketch(ctx, landmarks, rect)
  }
  strokeLips(ctx, landmarks, rect)
}

function drawFacePip(ctx, source, landmarks) {
  const width = ctx.canvas.width
  const height = ctx.canvas.height
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = "#d9d3c7"
  ctx.fillRect(0, 0, width, height)
  if (source && source.videoWidth) {
    ctx.drawImage(source, 0, 0, width, height)
  } else if (landmarks) {
    drawSketch(ctx, landmarks, { nx: 0, ny: 0, nw: 1, nh: 1 })
    strokeLips(ctx, landmarks, { nx: 0, ny: 0, nw: 1, nh: 1 })
  }
}

function fitCanvas(canvas) {
  const rect = canvas.getBoundingClientRect()
  const ratio = Math.min(window.devicePixelRatio || 1, 2)
  const width = Math.max(2, Math.round(rect.width * ratio))
  const height = Math.max(2, Math.round(rect.height * ratio))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
}

export { drawMouthView, drawFacePip, fitCanvas }
