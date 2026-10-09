#!/usr/bin/env node
/**
 * 前端冒烟测试（含真实鼠标交互，零第三方依赖）
 *
 * 用系统 Edge 的无头模式 + CDP 协议：
 *   1. 检查页面骨架是否渲染
 *   2. 点击「示例图片」载入内置图
 *   3. 模拟鼠标拖拽，在画布上真实绘制一个矩形
 *   4. 校验标注数变化、撤销 / 重做
 *   5. 绘制多边形、切换工具
 *   6. 打开导出弹窗校验预览内容
 * 每步截图留档。
 *
 * 用法：node scripts/smoke.mjs [baseUrl]
 */
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = (process.argv[2] || 'http://127.0.0.1:5180').replace(/\/+$/, '')
const CDP_PORT = Number(process.env.CDP_PORT || 9224)
const EDGE = process.env.EDGE_PATH ||
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const HEADFUL = process.env.SMOKE_HEADFUL === '1'
const OUT_DIR = path.resolve('smoke-shots')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const C = {
  gray: (s) => `\x1b[90m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`
}

let pass = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ${C.green('[PASS]')} ${name}`)
  } else {
    failures.push(name)
    console.log(`  ${C.red('[FAIL]')} ${name}${detail ? C.gray(' — ' + detail) : ''}`)
  }
}

class Cdp {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pending = new Map()
    this.listeners = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pending.has(msg.id)) {
        const p = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(msg.error.message))
        else p.resolve(msg.result)
      } else if (msg.method) {
        const handlers = this.listeners.get(msg.method) || []
        handlers.forEach((fn) => fn(msg.params))
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, [])
    this.listeners.get(method).push(fn)
  }
  once(method, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('等待 ' + method + ' 超时')), timeout)
      const fn = (p) => {
        clearTimeout(timer)
        const arr = this.listeners.get(method) || []
        const i = arr.indexOf(fn)
        if (i >= 0) arr.splice(i, 1)
        resolve(p)
      }
      this.on(method, fn)
    })
  }
}

async function waitForCdp(timeoutMs = 25000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)
      if (r.ok) return true
    } catch { /* 尚未就绪 */ }
    await sleep(300)
  }
  throw new Error('CDP 端口未就绪，浏览器可能启动失败')
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise: true
  })
  if (r.exceptionDetails) {
    const d = r.exceptionDetails
    const detail = d.exception?.description || d.exception?.value || d.text
    throw new Error(String(detail).split('\n').slice(0, 3).join(' / '))
  }
  return r.result.value
}

async function main() {
  console.log(C.bold(`\n图像标注工作台 · 前端冒烟测试\n目标：${BASE}\n${'─'.repeat(56)}`))
  if (!fs.existsSync(EDGE)) throw new Error(`找不到浏览器：${EDGE}`)

  const userDataDir = path.join(os.tmpdir(), 'wb-anno-' + Date.now())
  const child = spawn(EDGE, [
    HEADFUL ? '' : '--headless=new',
    '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,900',
    'about:blank'
  ].filter(Boolean), { stdio: 'ignore' })

  let cdp = null
  try {
    await waitForCdp()
    const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
    const page = list.find((t) => t.type === 'page')
    if (!page) throw new Error('未找到可用页面')

    const ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true })
      ws.addEventListener('error', () => rej(new Error('WebSocket 连接失败')), { once: true })
    })
    cdp = new Cdp(ws)

    const errors = []
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Log.enable')
    cdp.on('Runtime.exceptionThrown', (p) =>
      errors.push('未捕获异常: ' + (p.exceptionDetails?.exception?.description || p.exceptionDetails?.text)))
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') errors.push('console.error: ' + (p.args || []).map((a) => a.value).join(' '))
    })
    cdp.on('Log.entryAdded', (p) => {
      if (p.entry?.level === 'error') errors.push('日志错误: ' + p.entry.text)
    })

    fs.mkdirSync(OUT_DIR, { recursive: true })
    const shot = async (name) => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' })
      fs.writeFileSync(path.join(OUT_DIR, name + '.png'), Buffer.from(r.data, 'base64'))
    }

    const loaded = cdp.once('Page.loadEventFired').catch(() => {})
    await cdp.send('Page.navigate', { url: BASE })
    await loaded
    await sleep(1200)

    /* ── 1. 页面骨架 ── */
    console.log(C.bold('\n▶ 页面渲染'))
    check('工具栏渲染', await evaluate(cdp, '!!document.querySelector(".toolbar")'))
    check('画布容器渲染', await evaluate(cdp, '!!document.querySelector(".stage-host canvas")'))
    check('右侧面板渲染', await evaluate(cdp, '!!document.querySelector(".panel")'))
    const toolCount = await evaluate(cdp, 'document.querySelectorAll(".toolbar .tool").length')
    check('六个绘制工具就位', toolCount === 6, `实际 ${toolCount} 个`)
    const tagCount = await evaluate(cdp, 'document.querySelectorAll(".toolbar .tag").length')
    check('预设类别渲染', tagCount >= 8, `实际 ${tagCount} 个`)
    await shot('01-initial')

    /* ── 2. 载入示例图片 ── */
    console.log(C.bold('\n▶ 载入示例图片'))
    const btnTexts = await evaluate(cdp, `[...document.querySelectorAll('.toolbar button')].map(b => b.textContent.trim())`)
    const sampleIdx = btnTexts.findIndex((t) => t.includes('示例'))
    if (sampleIdx < 0) throw new Error('未找到「示例图片」按钮，实际按钮：' + btnTexts.join(' | '))
    await evaluate(cdp, `document.querySelectorAll('.toolbar button')[${sampleIdx}].click()`)
    await sleep(1500)
    if (errors.length) console.log(C.gray('  页面错误：' + errors.slice(0, 3).join(' | ')))
    check('图片列表出现 1 项', (await evaluate(cdp, 'document.querySelectorAll(".img-list li").length')) === 1)
    check('画布已绘制底图', (await evaluate(cdp, 'document.querySelectorAll(".stage-host canvas").length')) >= 1)
    check('空状态提示消失', !(await evaluate(cdp, '!!document.querySelector(".empty")')))
    await shot('02-sample-loaded')

    /* ── 3. 真实鼠标拖拽绘制矩形 ── */
    console.log(C.bold('\n▶ 绘制矩形（真实鼠标事件）'))
    const rect = await evaluate(cdp, `(() => {
      const el = document.querySelector('.stage-host')
      const r = el.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    })()`)

    const x1 = Math.round(rect.x + rect.w * 0.28)
    const y1 = Math.round(rect.y + rect.h * 0.3)
    const x2 = Math.round(rect.x + rect.w * 0.55)
    const y2 = Math.round(rect.y + rect.h * 0.62)

    const mouse = (type, x, y, extra = {}) =>
      cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', ...extra })

    /**
     * 单击：必须先 mouseMoved 再 press。
     * 画布库依赖指针位置（Konva 的 getRelativePointerPosition），
     * 直接 press 而没有前置 move 时指针位置尚未初始化，点击会被丢弃。
     */
    async function clickAt(x, y, clickCount = 1) {
      await mouse('mouseMoved', x, y)
      await sleep(60)
      await mouse('mousePressed', x, y, { clickCount })
      await sleep(30)
      await mouse('mouseReleased', x, y, { clickCount })
      // 间隔需大于画布库的双击判定窗口（Konva 默认 400ms），
      // 否则连续点顶点会被识别成「双击」，从而触发闭合逻辑
      await sleep(520)
    }

    await mouse('mousePressed', x1, y1, { clickCount: 1 })
    await mouse('mouseMoved', Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2))
    await sleep(120)
    await mouse('mouseMoved', x2, y2)
    await sleep(120)
    await mouse('mouseReleased', x2, y2, { clickCount: 1 })
    await sleep(500)
    const shapeCount = await evaluate(cdp, 'document.querySelectorAll(".shape-list li").length')
    check('拖拽后产生 1 个标注', shapeCount === 1, `实际 ${shapeCount} 个`)
    const firstTag = await evaluate(cdp, 'document.querySelector(".shape-list li .name")?.textContent || ""')
    check('标注带上当前类别', firstTag === '人员', `实际「${firstTag}」`)
    check('撤销按钮变为可用', await evaluate(cdp, `!document.querySelector('.group.right button').disabled`))
    await shot('03-rect-drawn')

    /* ── 4. 撤销 / 重做 ── */
    console.log(C.bold('\n▶ 撤销与重做'))
    await evaluate(cdp, `[...document.querySelectorAll('.group.right button')].find(b => b.textContent === '撤销').click()`)
    await sleep(350)
    check('撤销后标注清空',
      (await evaluate(cdp, 'document.querySelectorAll(".shape-list li").length')) === 0)
    await evaluate(cdp, `[...document.querySelectorAll('.group.right button')].find(b => b.textContent === '重做').click()`)
    await sleep(350)
    check('重做后标注恢复',
      (await evaluate(cdp, 'document.querySelectorAll(".shape-list li").length')) === 1)
    await shot('04-undo-redo')

    /* ── 5. 多边形绘制 ── */
    console.log(C.bold('\n▶ 多边形绘制'))
    await evaluate(cdp, `[...document.querySelectorAll('.toolbar .tool')].find(b => b.textContent.includes('多边形')).click()`)
    await sleep(200)
    check('多边形工具已选中',
      await evaluate(cdp, `[...document.querySelectorAll('.toolbar .tool')].some(b => b.textContent.includes('多边形') && b.classList.contains('active'))`))

    const px = (fx, fy) => [Math.round(rect.x + rect.w * fx), Math.round(rect.y + rect.h * fy)]

    // 依次落下 4 个顶点
    for (const [fx, fy] of [[0.62, 0.28], [0.80, 0.32], [0.78, 0.52], [0.60, 0.5]]) {
      const [x, y] = px(fx, fy)
      await clickAt(x, y)
    }
    const draftOk = await evaluate(cdp, '!!document.querySelector(".draft-tip")')
    check('绘制中显示顶点提示', draftOk)
    await shot('05a-polygon-draft')

    // 用 Enter 闭合（比双击更可控，双击也是支持的）
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await sleep(500)
    const afterPoly = await evaluate(cdp, 'document.querySelectorAll(".shape-list li").length')
    check('闭合后生成多边形', afterPoly === 2, `实际 ${afterPoly} 个标注`)
    check('顶点提示已消失', !(await evaluate(cdp, '!!document.querySelector(".draft-tip")')))
    await shot('05-polygon')

    /* ── 6. 关键点 + 文本工具切换 ── */
    console.log(C.bold('\n▶ 其他工具与导出'))
    await evaluate(cdp, `[...document.querySelectorAll('.toolbar .tool')].find(b => b.textContent.includes('关键点')).click()`)
    const [kx, ky] = px(0.42, 0.72)
    await clickAt(kx, ky)
    await sleep(300)
    check('关键点工具可落点',
      (await evaluate(cdp, 'document.querySelectorAll(".shape-list li").length')) === 3)

    // 快捷键切换工具：按 R 应切回矩形
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'r', code: 'KeyR', windowsVirtualKeyCode: 82 })
    await sleep(250)
    check('快捷键 R 切换到矩形工具',
      await evaluate(cdp, `[...document.querySelectorAll('.toolbar .tool')].some(b => b.textContent.includes('矩形') && b.classList.contains('active'))`))

    // 导出弹窗
    await evaluate(cdp, `[...document.querySelectorAll('.toolbar button')].find(b => b.textContent.includes('导出标注')).click()`)
    await sleep(400)
    check('导出弹窗打开', await evaluate(cdp, '!!document.querySelector(".modal")'))
    const previewText = await evaluate(cdp, 'document.querySelector(".preview")?.textContent || ""')
    check('JSON 预览包含标注数据', previewText.includes('"shapes"'), previewText.slice(0, 60))
    check('预览中的标注数与实际一致',
      (previewText.match(/"type":/g) || []).length === 3,
      `预览 ${(previewText.match(/"type":/g) || []).length} 个`)
    await shot('06-export')

    // 切到 YOLO 预览
    await evaluate(cdp, `[...document.querySelectorAll('.fmt')].find(l => l.textContent.includes('YOLO')).click()`)
    await sleep(300)
    const yoloText = await evaluate(cdp, 'document.querySelector(".preview")?.textContent || ""')
    check('YOLO 预览为归一化数值行',
      /^0 \d\.\d+ \d\.\d+ \d\.\d+ \d\.\d+$/m.test(yoloText.trim()), yoloText.slice(0, 60))
    await shot('07-export-yolo')

    /* ── 7. 控制台错误 ── */
    console.log(C.bold('\n▶ 运行时错误'))
    check('无控制台报错', errors.length === 0, errors.slice(0, 2).join(' | '))

    console.log('\n' + '─'.repeat(56))
    console.log(`通过 ${C.green(pass)} 项，失败 ${C.red(failures.length)} 项`)
    console.log(C.gray(`截图已保存到 ${OUT_DIR}`))
    if (failures.length) process.exitCode = 1
  } finally {
    try { cdp?.ws.close() } catch { /* ignore */ }
    try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { /* ignore */ }
    await sleep(400)
    try { fs.rmSync(userDataDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

main().catch((e) => {
  console.error(C.red('\n[x] ' + (e?.message || e)))
  process.exitCode = 1
})
