/**
 * 生成一张示例图片（canvas 绘制，纯本地生成，不依赖任何外部资源）。
 * 作用有两个：打开页面即可上手体验；自动化冒烟测试可以据此模拟真实标注流程。
 */
export function createSampleImage(): { src: string; width: number; height: number } {
  const w = 1000
  const h = 640
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!

  // 背景
  const bg = ctx.createLinearGradient(0, 0, 0, h)
  bg.addColorStop(0, '#eef4f9')
  bg.addColorStop(1, '#dbe7f1')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  // 地面网格
  ctx.strokeStyle = 'rgba(31,95,139,0.10)'
  ctx.lineWidth = 1
  for (let x = 0; x <= w; x += 50) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke()
  }
  for (let y = 0; y <= h; y += 50) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke()
  }

  // 楼栋轮廓
  ctx.fillStyle = 'rgba(31,95,139,0.08)'
  ctx.strokeStyle = 'rgba(31,95,139,0.35)'
  ctx.lineWidth = 2
  const blocks = [
    [70, 90, 260, 180], [380, 60, 220, 210], [660, 100, 270, 170],
    [120, 340, 300, 200], [500, 330, 240, 210], [790, 360, 160, 180]
  ]
  blocks.forEach(([x, y, bw, bh]) => {
    ctx.fillRect(x, y, bw, bh)
    ctx.strokeRect(x, y, bw, bh)
  })

  // 设备（方形）
  const devices: [number, number][] = [
    [110, 130], [200, 210], [430, 110], [520, 220],
    [710, 150], [830, 230], [170, 400], [300, 490], [560, 380], [860, 430]
  ]
  devices.forEach(([x, y]) => {
    ctx.fillStyle = '#6b7c8c'
    ctx.fillRect(x, y, 26, 20)
    ctx.fillStyle = '#c9d6e2'
    ctx.fillRect(x + 4, y + 4, 18, 12)
  })

  // 人员（圆形，用不同颜色区分）
  const people: [number, number, string][] = [
    [340, 300, '#e2504a'], [620, 300, '#3b6d11'],
    [250, 580, '#e8912d'], [700, 560, '#1f5f8b'], [470, 460, '#993556']
  ]
  people.forEach(([x, y, color]) => {
    ctx.fillStyle = color
    ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.85)'
    ctx.beginPath(); ctx.arc(x, y - 4, 5, 0, Math.PI * 2); ctx.fill()
  })

  // 车辆（长条）
  ctx.fillStyle = '#4a5b6b'
  ctx.fillRect(380, 560, 70, 28)
  ctx.fillRect(560, 60, 74, 26)

  // 左上角说明
  ctx.fillStyle = 'rgba(31,95,139,0.75)'
  ctx.font = '600 20px system-ui, sans-serif'
  ctx.fillText('示例图：园区巡查画面', 32, 44)
  ctx.font = '13px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(31,95,139,0.55)'
  ctx.fillText('可用矩形 / 多边形 / 关键点 / 文本工具进行标注', 32, 68)

  return { src: c.toDataURL('image/png'), width: w, height: h }
}
