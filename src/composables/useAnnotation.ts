/**
 * 标注状态管理（含撤销 / 重做）
 *
 * 撤销重做采用「快照栈」而非命令模式：
 * 标注数据量在千级以内，快照实现简单、不会出现命令回滚不彻底的问题，
 * 代价是内存占用随撤销步数线性增长，因此把栈深度限制在 50 步。
 */
import { ref, computed, shallowRef } from 'vue'
import { colorOfLabel, type Shape, type ImageMeta, type ToolName } from '@/types'

const MAX_HISTORY = 50

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

export interface ImageItem {
  id: string
  meta: ImageMeta
  shapes: Shape[]
}

/**
 * 分发式 Omit：对联合类型逐分支处理。
 * 直接用 Omit<Shape, K> 会把联合类型压成「公共属性」的单一对象类型，
 * 导致 x / points 这类分支特有字段在传参时报「不存在该属性」。
 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** 新增标注时的入参：id / 颜色 / 创建时间由 store 生成，类别可省略（默认取当前类别） */
export type NewShapeInput = DistributiveOmit<Shape, 'id' | 'color' | 'createdAt' | 'label'> & {
  label?: string
}

export function useAnnotation() {
  /** 已导入的图片列表 */
  const images = ref<ImageItem[]>([])
  const activeImageId = ref<string | null>(null)
  const selectedShapeId = ref<string | null>(null)
  const tool = ref<ToolName>('rect')
  const activeLabel = ref('人员')
  const customLabels = ref<string[]>([])

  /** 撤销 / 重做栈，只对「当前图片」的标注生效 */
  const past = shallowRef<string[]>([])
  const future = shallowRef<string[]>([])

  const activeImage = computed(() =>
    images.value.find((i) => i.id === activeImageId.value) || null)

  const shapes = computed<Shape[]>(() => activeImage.value?.shapes || [])

  const selectedShape = computed(() =>
    shapes.value.find((s) => s.id === selectedShapeId.value) || null)

  const labels = computed(() => {
    const used = new Set<string>()
    images.value.forEach((img) => img.shapes.forEach((s) => used.add(s.label)))
    customLabels.value.forEach((l) => used.add(l))
    return Array.from(used)
  })

  const counts = computed(() => {
    const map: Record<string, number> = {}
    shapes.value.forEach((s) => { map[s.label] = (map[s.label] || 0) + 1 })
    return map
  })

  /** 每张图片的标注数，用于左侧图片列表角标 */
  const shapeCountOf = (id: string) => images.value.find((i) => i.id === id)?.shapes.length || 0

  /* ---------------- 撤销 / 重做 ---------------- */

  function snapshot() {
    if (!activeImage.value) return
    past.value = [...past.value.slice(-(MAX_HISTORY - 1)), JSON.stringify(activeImage.value.shapes)]
    future.value = []
  }

  function undo() {
    if (!activeImage.value || !past.value.length) return false
    const stack = [...past.value]
    const prev = stack.pop() as string
    future.value = [JSON.stringify(activeImage.value.shapes), ...future.value].slice(0, MAX_HISTORY)
    past.value = stack
    activeImage.value.shapes = JSON.parse(prev)
    if (!activeImage.value.shapes.some((s) => s.id === selectedShapeId.value)) selectedShapeId.value = null
    return true
  }

  function redo() {
    if (!activeImage.value || !future.value.length) return false
    past.value = [...past.value, JSON.stringify(activeImage.value.shapes)]
    const next = future.value[0]
    future.value = future.value.slice(1)
    activeImage.value.shapes = JSON.parse(next)
    return true
  }

  const canUndo = computed(() => past.value.length > 0)
  const canRedo = computed(() => future.value.length > 0)

  /* ---------------- 增删改 ---------------- */

  function addShape(partial: NewShapeInput) {
    if (!activeImage.value) return null
    snapshot()
    const label = partial.label || activeLabel.value
    const shape = {
      ...partial,
      id: uid(),
      label,
      color: colorOfLabel(label),
      createdAt: Date.now()
    } as Shape
    activeImage.value.shapes.push(shape)
    selectedShapeId.value = shape.id
    return shape
  }

  function updateShape(id: string, patch: Partial<Shape>, withHistory = true) {
    if (!activeImage.value) return
    const idx = activeImage.value.shapes.findIndex((s) => s.id === id)
    if (idx < 0) return
    if (withHistory) snapshot()
    const merged = { ...activeImage.value.shapes[idx], ...patch } as Shape
    // 改类别时同步颜色
    if (patch.label) merged.color = colorOfLabel(patch.label)
    activeImage.value.shapes[idx] = merged
  }

  function removeShape(id: string) {
    if (!activeImage.value) return
    snapshot()
    activeImage.value.shapes = activeImage.value.shapes.filter((s) => s.id !== id)
    if (selectedShapeId.value === id) selectedShapeId.value = null
  }

  function clearShapes() {
    if (!activeImage.value?.shapes.length) return
    snapshot()
    activeImage.value.shapes = []
    selectedShapeId.value = null
  }

  /** 删除当前图片的全部标注属于破坏性操作，调用方需二次确认 */
  function resetHistory() {
    past.value = []
    future.value = []
  }

  /* ---------------- 图片 ---------------- */

  function addImage(meta: ImageMeta) {
    const item: ImageItem = { id: uid(), meta, shapes: [] }
    images.value.push(item)
    activeImageId.value = item.id
    selectedShapeId.value = null
    resetHistory()
    return item
  }

  function selectImage(id: string) {
    activeImageId.value = id
    selectedShapeId.value = null
    resetHistory()
  }

  function removeImage(id: string) {
    const idx = images.value.findIndex((i) => i.id === id)
    if (idx < 0) return
    images.value.splice(idx, 1)
    if (activeImageId.value === id) {
      activeImageId.value = images.value[0]?.id || null
      selectedShapeId.value = null
      resetHistory()
    }
  }

  /** 载入已有标注（导入 JSON 时使用） */
  function loadShapes(list: Shape[]) {
    if (!activeImage.value) return
    activeImage.value.shapes = list
    selectedShapeId.value = null
    resetHistory()
  }

  function addCustomLabel(name: string) {
    const n = name.trim()
    if (!n) return
    if (!customLabels.value.includes(n) && !labels.value.includes(n)) customLabels.value.push(n)
    activeLabel.value = n
  }

  return {
    images, activeImageId, activeImage, shapes, selectedShapeId, selectedShape,
    tool, activeLabel, labels, customLabels, counts, shapeCountOf,
    canUndo, canRedo,
    addShape, updateShape, removeShape, clearShapes,
    undo, redo, resetHistory,
    addImage, selectImage, removeImage, loadShapes, addCustomLabel,
    snapshot
  }
}

export type AnnotationStore = ReturnType<typeof useAnnotation>

/**
 * 应用内共享实例。
 * 这是单页应用，标注状态需要被工具栏、画布、标注列表三处共同读写，
 * 用模块单例比逐层 provide/inject 更直接，也避免误用导致的状态分裂。
 */
export const annotationStore = useAnnotation()
