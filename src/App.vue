<template>
  <div class="app">
    <ToolBar
      @import="pickFiles"
      @sample="loadSample"
      @export="openExport"
      @clear="confirmClear"
      @add-label="openAddLabel"
      @auto-next="autoNext = $event"
    />

    <div class="body">
      <ImageCanvas
        ref="canvasRef"
        @request-text="onRequestText"
        @shape-added="onShapeAdded"
        @notice="showToast"
      />
      <LabelPanel />
    </div>

    <input ref="fileRef" type="file" accept="image/*" multiple hidden @change="onFiles" />

    <!-- 文本标注 -->
    <div v-if="textModal.show" class="mask" @click.self="textModal.show = false">
      <div class="modal">
        <div class="modal-title">添加文本标注</div>
        <input
          v-model="textModal.value" class="input" placeholder="输入标注内容"
          @keyup.enter="submitText"
        />
        <div class="modal-foot">
          <button @click="textModal.show = false">取消</button>
          <button class="primary" @click="submitText">确定</button>
        </div>
      </div>
    </div>

    <!-- 新增类别 -->
    <div v-if="labelModal" class="mask" @click.self="labelModal = false">
      <div class="modal">
        <div class="modal-title">新增标注类别</div>
        <input
          v-model="labelValue" class="input" placeholder="类别名称，如：脚手架"
          @keyup.enter="submitLabel"
        />
        <div class="modal-foot">
          <button @click="labelModal = false">取消</button>
          <button class="primary" @click="submitLabel">添加</button>
        </div>
      </div>
    </div>

    <!-- 导出 -->
    <div v-if="exportModal" class="mask" @click.self="exportModal = false">
      <div class="modal wide">
        <div class="modal-title">导出标注</div>
        <div class="fmt-list">
          <label
            v-for="f in FORMATS" :key="f.value"
            class="fmt" :class="{ active: exportFormat === f.value }"
          >
            <input v-model="exportFormat" type="radio" :value="f.value" />
            <div>
              <div class="fmt-name">{{ f.label }}</div>
              <div class="fmt-desc">{{ f.desc }}</div>
            </div>
          </label>
        </div>
        <div class="preview-head">预览（当前图片）</div>
        <pre class="preview">{{ preview }}</pre>
        <div class="modal-foot">
          <button @click="exportModal = false">取消</button>
          <button class="primary" @click="doExport">下载文件</button>
        </div>
      </div>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import ToolBar from '@/components/ToolBar.vue'
import ImageCanvas from '@/components/ImageCanvas.vue'
import LabelPanel from '@/components/LabelPanel.vue'
import { annotationStore as store } from '@/composables/useAnnotation'
import { toJson, toYolo, toCoco, download, type ExportBundle } from '@/utils/export'
import { createSampleImage } from '@/utils/sample'
import type { Shape, ToolName } from '@/types'

const fileRef = ref<HTMLInputElement>()
const canvasRef = ref<InstanceType<typeof ImageCanvas> | null>(null)
const autoNext = ref(false)
const toast = ref('')

const textModal = ref({ show: false, x: 0, y: 0, value: '' })
const labelModal = ref(false)
const labelValue = ref('')
const exportModal = ref(false)

const FORMATS = [
  { value: 'json', label: '自用 JSON', desc: '结构完整，可再次导入本工具继续编辑' },
  { value: 'yolo', label: 'YOLO txt', desc: '每行 classId cx cy w h，坐标已按图像尺寸归一化' },
  { value: 'coco', label: 'COCO json', desc: '含 bbox 与 segmentation，可直接用于训练框架' }
]
const exportFormat = ref<'json' | 'yolo' | 'coco'>('json')

function showToast(msg: string) {
  toast.value = msg
  setTimeout(() => { if (toast.value === msg) toast.value = '' }, 2200)
}

const bundle = computed<ExportBundle | null>(() => {
  const img = store.activeImage.value
  if (!img) return null
  return {
    image: { name: img.meta.name, width: img.meta.width, height: img.meta.height },
    shapes: img.shapes
  }
})

const preview = computed(() => {
  if (!bundle.value) return '当前没有图片'
  const b = bundle.value
  if (exportFormat.value === 'json') return JSON.stringify(toJson(b), null, 2).slice(0, 1600)
  if (exportFormat.value === 'yolo') {
    const txt = toYolo(b, store.labels.value)
    return txt || '（当前图片没有矩形/多边形标注，YOLO 导出为空）'
  }
  return JSON.stringify(toCoco(b, store.labels.value), null, 2).slice(0, 1600)
})

/* ───────── 导入 ───────── */

function pickFiles() { fileRef.value?.click() }

/** 载入内置示例图：打开页面即可试，也供自动化测试使用 */
async function loadSample() {
  const s = createSampleImage()
  store.addImage({ name: '示例图-园区巡查.png', width: s.width, height: s.height, src: s.src })
  showToast('已载入示例图片')
  await nextTick()
  canvasRef.value?.fitToContainer()
  canvasRef.value?.renderShapes()
}

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = '' // 允许重复选择同一文件
  if (!files.length) return

  let ok = 0
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue
    const src = await readAsDataURL(file)
    const size = await getImageSize(src)
    store.addImage({ name: file.name, width: size.width, height: size.height, src })
    ok++
  }
  if (ok) {
    showToast(`已导入 ${ok} 张图片`)
    await nextTick()
    canvasRef.value?.fitToContainer()
  } else {
    showToast('没有可用的图片文件')
  }
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('读取文件失败'))
    r.readAsDataURL(file)
  })
}

function getImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('图片解析失败'))
    img.src = src
  })
}

/* ───────── 拖拽导入 ───────── */

function onDrop(e: DragEvent) {
  e.preventDefault()
  const files = Array.from(e.dataTransfer?.files || [])
  if (!files.length) return
  const dt = new DataTransfer()
  files.forEach((f) => dt.items.add(f))
  const fake = { target: { files: dt.files, value: '' } } as unknown as Event
  onFiles(fake)
}

function onDragOver(e: DragEvent) { e.preventDefault() }

/* ───────── 标注交互 ───────── */

function onRequestText(payload: { x: number; y: number }) {
  textModal.value = { show: true, x: payload.x, y: payload.y, value: '' }
}

function submitText() {
  const text = textModal.value.value.trim()
  if (!text) return (textModal.value.show = false)
  store.addShape({ type: 'text', x: textModal.value.x, y: textModal.value.y, text })
  textModal.value.show = false
  canvasRef.value?.renderShapes()
}

function onShapeAdded() {
  if (autoNext.value) store.tool.value = 'select'
}

function confirmClear() {
  if (!store.shapes.value.length) return
  if (window.confirm(`确定清空当前图片的 ${store.shapes.value.length} 个标注？此操作可用 Ctrl+Z 撤销。`)) {
    store.clearShapes()
    canvasRef.value?.renderShapes()
  }
}

function openAddLabel() {
  labelValue.value = ''
  labelModal.value = true
}

function submitLabel() {
  const v = labelValue.value.trim()
  if (!v) return (labelModal.value = false)
  store.addCustomLabel(v)
  labelModal.value = false
  showToast(`已新增类别「${v}」`)
}

/* ───────── 导出 ───────── */

function openExport() {
  if (!store.images.value.length) return showToast('请先导入图片')
  exportModal.value = true
}

function doExport() {
  const img = store.activeImage.value
  if (!img) return
  const b: ExportBundle = {
    image: { name: img.meta.name, width: img.meta.width, height: img.meta.height },
    shapes: img.shapes
  }
  const base = img.meta.name.replace(/\.[^.]+$/, '') || 'annotation'

  if (exportFormat.value === 'json') {
    download(`${base}.json`, JSON.stringify(toJson(b), null, 2))
  } else if (exportFormat.value === 'yolo') {
    download(`${base}.txt`, toYolo(b, store.labels.value), 'text/plain')
  } else {
    download(`${base}.coco.json`, JSON.stringify(toCoco(b, store.labels.value), null, 2))
  }
  exportModal.value = false
  showToast('已开始下载')
}

/* ───────── 快捷键 ───────── */

const TOOL_KEYS: Record<string, ToolName> = {
  v: 'select', h: 'pan', r: 'rect', p: 'polygon', k: 'point', t: 'text'
}

function onKeyDown(e: KeyboardEvent) {
  const t = e.target as HTMLElement
  if (t && ['INPUT', 'TEXTAREA'].includes(t.tagName)) return

  const mod = e.ctrlKey || e.metaKey
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    if (e.shiftKey) store.redo(); else store.undo()
    canvasRef.value?.renderShapes()
    return
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault()
    store.redo()
    canvasRef.value?.renderShapes()
    return
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (store.selectedShapeId.value) {
      e.preventDefault()
      store.removeShape(store.selectedShapeId.value)
      canvasRef.value?.renderShapes()
    }
    return
  }
  if (!mod && TOOL_KEYS[e.key.toLowerCase()]) {
    store.tool.value = TOOL_KEYS[e.key.toLowerCase()]
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('drop', onDrop)
  window.addEventListener('dragover', onDragOver)
  // 暴露状态给自动化冒烟测试读取（只读用途，不参与业务逻辑）
  ;(window as unknown as Record<string, unknown>).__annotation = store
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('drop', onDrop)
  window.removeEventListener('dragover', onDragOver)
})

// 便于调试与自动化测试：暴露少量只读状态
defineExpose({ store, preview })
void ({} as Shape)
</script>

<style scoped>
.app { display: flex; flex-direction: column; height: 100vh; background: #f7f9fb; }
.body { flex: 1; display: flex; min-height: 0; }

.mask {
  position: fixed; inset: 0; background: rgba(24, 32, 40, .38);
  display: flex; align-items: center; justify-content: center; z-index: 50;
}
.modal {
  width: 380px; background: #fff; border-radius: 12px; padding: 18px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, .18);
}
.modal.wide { width: 560px; }
.modal-title { font-size: 14px; font-weight: 600; color: #22303c; margin-bottom: 14px; }
.input {
  width: 100%; height: 34px; border: 1px solid #d9e0e6; border-radius: 7px;
  padding: 0 10px; font-size: 13px; outline: none;
}
.input:focus { border-color: #1f5f8b; box-shadow: 0 0 0 3px rgba(31, 95, 139, .1); }
.modal-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
.modal-foot button {
  height: 32px; padding: 0 14px; border-radius: 7px;
  border: 1px solid #d9e0e6; background: #fff; cursor: pointer; font-size: 13px;
}
.modal-foot button.primary { background: #1f5f8b; border-color: #1f5f8b; color: #fff; }

.fmt-list { display: flex; flex-direction: column; gap: 8px; }
.fmt {
  display: flex; gap: 10px; align-items: flex-start;
  border: 1px solid #e3e9ee; border-radius: 8px; padding: 10px;
  cursor: pointer; transition: all .14s;
}
.fmt.active { border-color: #1f5f8b; background: #f6fafd; }
.fmt input { margin-top: 2px; }
.fmt-name { font-size: 13px; color: #22303c; font-weight: 500; }
.fmt-desc { font-size: 11.5px; color: #8b95a0; margin-top: 2px; }

.preview-head { font-size: 12px; color: #5f6b76; margin: 14px 0 6px; }
.preview {
  max-height: 190px; overflow: auto; background: #f5f7f9;
  border: 1px solid #e8edf1; border-radius: 8px; padding: 10px;
  font-size: 11px; line-height: 1.6; color: #3f4c58; margin: 0;
  font-family: ui-monospace, Menlo, Consolas, monospace;
}

.toast {
  position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%);
  background: rgba(24, 32, 40, .88); color: #fff; font-size: 12.5px;
  padding: 8px 16px; border-radius: 8px; z-index: 60;
}
</style>
