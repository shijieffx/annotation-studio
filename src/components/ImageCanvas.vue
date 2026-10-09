<template>
  <div class="canvas-wrap" :class="{ 'is-panning': panning }">
    <div ref="hostRef" class="stage-host"></div>

    <div v-if="!store.activeImage.value" class="empty">
      <div class="empty-inner">
        <div class="empty-title">还没有图片</div>
        <div class="empty-sub">拖拽图片到此处，或点击左侧「导入图片」开始标注</div>
      </div>
    </div>

    <div class="zoom-bar">
      <button title="缩小" @click="zoomBy(0.8)">−</button>
      <span class="zoom-val" @click="fitToContainer">{{ Math.round(scale * 100) }}%</span>
      <button title="放大" @click="zoomBy(1.25)">+</button>
      <button class="ghost" @click="fitToContainer">适应</button>
      <button class="ghost" @click="resetZoom">100%</button>
    </div>

    <div v-if="draftPoints.length" class="draft-tip">
      多边形绘制中：单击添加顶点 · 双击或 Enter 闭合 · Esc 取消（已有 {{ draftPoints.length / 2 }} 个顶点）
    </div>

    <div class="hint">
      滚轮缩放 · 按住空格拖拽平移 · Delete 删除选中 · Ctrl+Z 撤销 · Ctrl+Shift+Z 重做
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import Konva from 'konva'
import { annotationStore as store } from '@/composables/useAnnotation'
import type { Shape } from '@/types'

const emit = defineEmits<{
  (e: 'request-text', payload: { x: number; y: number }): void
  (e: 'shape-added', shape: Shape): void
  (e: 'notice', message: string): void
}>()

const hostRef = ref<HTMLDivElement>()
const scale = ref(1)
const panning = ref(false)
const draftPoints = ref<number[]>([])
/** 正在拖拽绘制中的矩形起点 */
let rectStart: { x: number; y: number } | null = null

let stage: Konva.Stage | null = null
let bgLayer: Konva.Layer | null = null
let shapeLayer: Konva.Layer | null = null
let draftLayer: Konva.Layer | null = null
let imageNode: Konva.Image | null = null
let resizeObserver: ResizeObserver | null = null

const spaceDown = ref(false)

/* ───────────────── 初始化 ───────────────── */

function initStage() {
  const host = hostRef.value
  if (!host) return
  stage = new Konva.Stage({
    container: host,
    width: host.clientWidth,
    height: host.clientHeight
  })
  bgLayer = new Konva.Layer({ listening: false })
  shapeLayer = new Konva.Layer()
  draftLayer = new Konva.Layer({ listening: false })
  stage.add(bgLayer)
  stage.add(shapeLayer)
  stage.add(draftLayer)

  stage.on('wheel', onWheel)
  stage.on('mousedown touchstart', onPointerDown)
  stage.on('mousemove touchmove', onPointerMove)
  stage.on('mouseup touchend', onPointerUp)
  stage.on('dblclick dbltap', onDoubleClick)

  resizeObserver = new ResizeObserver(() => {
    if (!stage || !host) return
    stage.width(host.clientWidth)
    stage.height(host.clientHeight)
    stage.draw()
  })
  resizeObserver.observe(host)
}

/* ───────────────── 视图操作 ───────────────── */

function onWheel(e: Konva.KonvaEventObject<WheelEvent>) {
  e.evt.preventDefault()
  if (!stage) return
  const oldScale = stage.scaleX()
  const pointer = stage.getPointerPosition()
  if (!pointer) return
  const pointTo = {
    x: (pointer.x - stage.x()) / oldScale,
    y: (pointer.y - stage.y()) / oldScale
  }
  const factor = e.evt.deltaY > 0 ? 0.9 : 1.1
  const next = clamp(oldScale * factor, 0.05, 12)
  stage.scale({ x: next, y: next })
  stage.position({
    x: pointer.x - pointTo.x * next,
    y: pointer.y - pointTo.y * next
  })
  scale.value = next
}

function zoomBy(factor: number) {
  if (!stage) return
  const next = clamp(stage.scaleX() * factor, 0.05, 12)
  const center = { x: stage.width() / 2, y: stage.height() / 2 }
  const pointTo = {
    x: (center.x - stage.x()) / stage.scaleX(),
    y: (center.y - stage.y()) / stage.scaleY()
  }
  stage.scale({ x: next, y: next })
  stage.position({ x: center.x - pointTo.x * next, y: center.y - pointTo.y * next })
  scale.value = next
}

function fitToContainer() {
  if (!stage || !imageNode) return
  const iw = imageNode.width()
  const ih = imageNode.height()
  if (!iw || !ih) return
  const pad = 48
  const next = clamp(Math.min(
    (stage.width() - pad) / iw,
    (stage.height() - pad) / ih
  ), 0.05, 12)
  stage.scale({ x: next, y: next })
  stage.position({
    x: (stage.width() - iw * next) / 2,
    y: (stage.height() - ih * next) / 2
  })
  scale.value = next
}

function resetZoom() {
  if (!stage) return
  stage.scale({ x: 1, y: 1 })
  stage.position({ x: 0, y: 0 })
  scale.value = 1
}

/* ───────────────── 图片 ───────────────── */

function loadImage(src: string) {
  if (!bgLayer) return
  bgLayer.destroyChildren()
  imageNode = null
  const img = new window.Image()
  img.onload = () => {
    imageNode = new Konva.Image({
      image: img, x: 0, y: 0, width: img.width, height: img.height
    })
    bgLayer?.add(imageNode)
    bgLayer?.draw()
    fitToContainer()
  }
  img.src = src
}

/* ───────────────── 绘制交互 ───────────────── */

const isDrawTool = () => ['rect', 'polygon', 'point'].includes(store.tool.value)

function onPointerDown(e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) {
  if (!stage) return
  const evt = e.evt as MouseEvent

  // 平移：空格 / 中键 / 平移工具
  if (spaceDown.value || evt.button === 1 || store.tool.value === 'pan') {
    panning.value = true
    stage.draggable(true)
    return
  }

  const pos = stage.getRelativePointerPosition()
  if (!pos) return

  if (store.tool.value === 'rect') {
    rectStart = { x: pos.x, y: pos.y }
    return
  }

  if (store.tool.value === 'point') {
    const shape = store.addShape({ type: 'point', x: pos.x, y: pos.y })
    if (shape) emit('shape-added', shape)
    renderShapes()
    return
  }

  if (store.tool.value === 'polygon') {
    draftPoints.value.push(pos.x, pos.y)
    renderDraft()
    return
  }

  if (store.tool.value === 'text') {
    emit('request-text', { x: pos.x, y: pos.y })
    return
  }

  // 选择工具：点空白处取消选中
  if (e.target === stage) store.selectedShapeId.value = null
}

function onPointerMove() {
  if (!stage || !rectStart) return
  const pos = stage.getRelativePointerPosition()
  if (!pos) return
  renderDraft(rectStart, pos)
}

function onPointerUp() {
  if (panning.value && stage) {
    stage.draggable(false)
    panning.value = false
  }
  if (!rectStart || !stage) return
  const pos = stage.getRelativePointerPosition()
  const start = rectStart
  rectStart = null
  if (!pos) return

  const w = Math.abs(pos.x - start.x)
  const h = Math.abs(pos.y - start.y)
  // 过小的拖动视为误触，不产生标注
  if (w < 4 || h < 4) {
    draftLayer?.destroyChildren()
    draftLayer?.draw()
    return
  }
  const shape = store.addShape({
    type: 'rect',
    x: Math.min(start.x, pos.x),
    y: Math.min(start.y, pos.y),
    width: w,
    height: h
  })
  draftLayer?.destroyChildren()
  draftLayer?.draw()
  if (shape) emit('shape-added', shape)
  renderShapes()
}

function onDoubleClick() {
  if (store.tool.value !== 'polygon') return
  closePolygon()
}

function closePolygon() {
  const pts = draftPoints.value
  if (pts.length < 6) {
    // 顶点不足时**保留**已添加的顶点，只给出提示。
    // 画布库自带双击判定（默认 400ms 窗口），连续快速点顶点很容易被识别成双击，
    // 若此时直接清空，用户辛苦点出来的顶点会莫名消失。
    if (pts.length) emit('notice', '多边形至少需要 3 个顶点：继续点击添加，按 Enter 闭合，Esc 取消')
    return
  }
  const shape = store.addShape({ type: 'polygon', points: [...pts] })
  if (shape) emit('shape-added', shape)
  draftPoints.value = []
  draftLayer?.destroyChildren()
  draftLayer?.draw()
  renderShapes()
}

function cancelPolygon() {
  draftPoints.value = []
  draftLayer?.destroyChildren()
  draftLayer?.draw()
}

/* ───────────────── 渲染 ───────────────── */

function renderDraft(rectFrom?: { x: number; y: number }, rectTo?: { x: number; y: number }) {
  if (!draftLayer) return
  draftLayer.destroyChildren()

  if (rectFrom && rectTo) {
    draftLayer.add(new Konva.Rect({
      x: Math.min(rectFrom.x, rectTo.x),
      y: Math.min(rectFrom.y, rectTo.y),
      width: Math.abs(rectTo.x - rectFrom.x),
      height: Math.abs(rectTo.y - rectFrom.y),
      stroke: store.activeLabel.value ? '#1f5f8b' : '#1f5f8b',
      strokeWidth: 1.5,
      dash: [6, 4],
      fill: 'rgba(31,95,139,0.08)'
    }))
  }

  if (draftPoints.value.length) {
    const pts = draftPoints.value
    // Konva 的 Line 至少需要 2 个点（4 个坐标值）：
    // 刚落下第一个顶点时只画顶点标记，否则这里会抛异常并中断后续绘制
    if (pts.length >= 4) {
      draftLayer.add(new Konva.Line({
        points: pts,
        stroke: '#1f5f8b',
        strokeWidth: 1.5,
        dash: [6, 4],
        closed: false
      }))
    }
    for (let i = 0; i < pts.length; i += 2) {
      draftLayer.add(new Konva.Circle({
        x: pts[i], y: pts[i + 1], radius: 3.5,
        fill: '#fff', stroke: '#1f5f8b', strokeWidth: 1.5,
        strokeScaleEnabled: false
      }))
    }
  }
  draftLayer.draw()
}

/** 把数据模型渲染成 Konva 节点（数据是唯一事实来源，节点每次重建） */
function renderShapes() {
  if (!shapeLayer) return
  shapeLayer.destroyChildren()

  for (const s of store.shapes.value) {
    const selected = s.id === store.selectedShapeId.value
    const common = {
      stroke: s.color,
      strokeWidth: selected ? 3 : 2,
      strokeScaleEnabled: false,
      name: 'shape',
      id: s.id
    }

    if (s.type === 'rect') {
      const node = new Konva.Rect({
        ...common, x: s.x, y: s.y, width: s.width, height: s.height,
        fill: hexToRgba(s.color, selected ? 0.2 : 0.12),
        draggable: store.tool.value === 'select'
      })
      bindDrag(node, s.id)
      shapeLayer.add(node)
      shapeLayer.add(makeLabelTag(s.x, s.y, s.label, s.color, selected))
    } else if (s.type === 'polygon') {
      const node = new Konva.Line({
        ...common, points: s.points, closed: true,
        fill: hexToRgba(s.color, selected ? 0.2 : 0.12)
      })
      node.on('click tap', (evt) => {
        evt.cancelBubble = true
        store.selectedShapeId.value = s.id
      })
      shapeLayer.add(node)
      const xs = s.points.filter((_, i) => i % 2 === 0)
      const ys = s.points.filter((_, i) => i % 2 === 1)
      if (xs.length) {
        shapeLayer.add(makeLabelTag(Math.min(...xs), Math.min(...ys), s.label, s.color, selected))
      }
    } else if (s.type === 'point') {
      const node = new Konva.Circle({
        x: s.x, y: s.y, radius: 6,
        fill: hexToRgba(s.color, 0.85),
        stroke: '#fff', strokeWidth: selected ? 3 : 1.5,
        strokeScaleEnabled: false,
        draggable: store.tool.value === 'select'
      })
      bindDrag(node, s.id)
      shapeLayer.add(node)
      shapeLayer.add(makeLabelTag(s.x + 8, s.y - 8, s.label, s.color, selected))
    } else if (s.type === 'text') {
      const node = new Konva.Text({
        x: s.x, y: s.y, text: s.text,
        fontSize: 14, fill: s.color, fontStyle: '500',
        draggable: store.tool.value === 'select'
      })
      bindDrag(node, s.id)
      shapeLayer.add(node)
    }
  }
  shapeLayer.draw()
}

function makeLabelTag(x: number, y: number, label: string, color: string, selected: boolean) {
  const group = new Konva.Group({ x, y: Math.max(0, y - 18), listening: true, name: 'shape-tag' })
  const text = new Konva.Text({
    text: label, fontSize: 11, fill: '#fff', padding: 4,
    fontFamily: 'system-ui, sans-serif'
  })
  const w = text.width()
  const h = text.height()
  const bg = new Konva.Rect({
    width: w, height: h, fill: color,
    cornerRadius: [3, 3, 3, 0],
    opacity: selected ? 1 : 0.92
  })
  group.add(bg)
  group.add(text)
  return group
}

function bindDrag(node: Konva.Node, id: string) {
  node.on('click tap', (evt) => {
    evt.cancelBubble = true
    store.selectedShapeId.value = id
    renderShapes()
  })
  node.on('dragstart', () => { store.selectedShapeId.value = id })
  node.on('dragend', () => {
    // 拖拽结束后把节点位置写回数据模型（坐标即图像坐标）
    const s = store.shapes.value.find((x) => x.id === id)
    if (!s) return
    if (s.type === 'rect' || s.type === 'point' || s.type === 'text') {
      store.updateShape(id, { x: node.x(), y: node.y() } as Partial<Shape>)
    }
  })
}

/* ───────────────── 工具函数 ───────────────── */

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

function hexToRgba(hex: string, alpha: number) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/* ───────────────── 键盘 ───────────────── */

function onKeyDown(e: KeyboardEvent) {
  const target = e.target as HTMLElement
  if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) return

  if (e.code === 'Space' && !spaceDown.value) {
    spaceDown.value = true
    e.preventDefault()
  }
  if (e.key === 'Escape') cancelPolygon()
  if (e.key === 'Enter' && draftPoints.value.length) closePolygon()
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code === 'Space') {
    spaceDown.value = false
    if (panning.value && stage) {
      stage.draggable(false)
      panning.value = false
    }
  }
}

/* ───────────────── 生命周期 ───────────────── */

onMounted(async () => {
  await nextTick()
  initStage()
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  resizeObserver?.disconnect()
  stage?.destroy()
  stage = null
})

// 切换图片时重新载入底图并清空草稿
watch(() => store.activeImage.value?.id, (id) => {
  cancelPolygon()
  rectStart = null
  const item = store.images.value.find((i) => i.id === id)
  if (item) loadImage(item.meta.src)
  else if (bgLayer) { bgLayer.destroyChildren(); bgLayer.draw() }
})

// 标注数据或选中态变化时重绘
watch(() => [store.shapes.value, store.selectedShapeId.value], () => renderShapes(), { deep: true })
// 切换工具时重绘（决定节点是否可拖动）
watch(() => store.tool.value, () => renderShapes())

defineExpose({ fitToContainer, zoomBy, renderShapes })
</script>

<style scoped>
.canvas-wrap {
  position: relative;
  flex: 1;
  height: 100%;
  overflow: hidden;
  background: #eef1f4;
}
.canvas-wrap.is-panning { cursor: grab; }
.stage-host { width: 100%; height: 100%; }

.empty {
  position: absolute; inset: 0;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none;
}
.empty-inner { text-align: center; color: #8b95a0; }
.empty-title { font-size: 15px; font-weight: 500; margin-bottom: 6px; }
.empty-sub { font-size: 12px; }

.zoom-bar {
  position: absolute; left: 16px; bottom: 16px;
  display: flex; align-items: center; gap: 4px;
  background: #fff; border: 1px solid #dfe5ea; border-radius: 8px;
  padding: 4px 6px; box-shadow: 0 2px 8px rgba(0, 0, 0, .06);
}
.zoom-bar button {
  width: 26px; height: 26px; border: none; background: transparent;
  border-radius: 6px; cursor: pointer; font-size: 14px; color: #3f4c58;
}
.zoom-bar button:hover { background: #f0f3f6; }
.zoom-bar .ghost { width: auto; padding: 0 8px; font-size: 12px; }
.zoom-val {
  min-width: 46px; text-align: center; font-size: 12px;
  color: #3f4c58; cursor: pointer;
}

.draft-tip {
  position: absolute; left: 50%; top: 14px; transform: translateX(-50%);
  background: #1f5f8b; color: #fff; font-size: 12px;
  padding: 6px 12px; border-radius: 6px;
}
.hint {
  position: absolute; right: 16px; bottom: 16px;
  font-size: 11px; color: #8b95a0;
  background: rgba(255, 255, 255, .85);
  padding: 4px 8px; border-radius: 6px;
}
</style>
