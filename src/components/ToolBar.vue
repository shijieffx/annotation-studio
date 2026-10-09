<template>
  <header class="toolbar">
    <div class="group">
      <button class="primary" @click="$emit('import')">导入图片</button>
      <button @click="$emit('sample')" title="用内置示例图快速体验">示例图片</button>
      <label class="check">
        <input type="checkbox" :checked="autoNext" @change="onAutoNext" />
        标注后自动切回选择
      </label>
    </div>

    <div class="group tools">
      <button
        v-for="t in TOOLS" :key="t.name"
        class="tool" :class="{ active: store.tool.value === t.name }"
        :title="`${t.label}（${t.key}）`"
        @click="store.tool.value = t.name"
      >
        <span class="ico" v-html="t.icon"></span>
        <span class="txt">{{ t.label }}</span>
        <span class="kbd">{{ t.key }}</span>
      </button>
    </div>

    <div class="group">
      <span class="lbl">类别</span>
      <div class="labels">
        <button
          v-for="l in presetLabels" :key="l"
          class="tag" :class="{ active: store.activeLabel.value === l }"
          :style="{ '--c': colorOfLabel(l) }"
          @click="store.activeLabel.value = l"
        >{{ l }}</button>
        <button class="tag add" title="新增自定义类别" @click="$emit('add-label')">+</button>
      </div>
    </div>

    <div class="group right">
      <button :disabled="!store.canUndo.value" title="撤销 Ctrl+Z" @click="store.undo()">撤销</button>
      <button :disabled="!store.canRedo.value" title="重做 Ctrl+Shift+Z" @click="store.redo()">重做</button>
      <button class="danger" :disabled="!store.shapes.value.length" @click="$emit('clear')">清空</button>
      <button class="primary" @click="$emit('export')">导出标注</button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { annotationStore as store } from '@/composables/useAnnotation'
import { PRESET_LABELS, colorOfLabel, type ToolName } from '@/types'

const emit = defineEmits<{
  (e: 'import'): void
  (e: 'sample'): void
  (e: 'export'): void
  (e: 'clear'): void
  (e: 'add-label'): void
  (e: 'auto-next', value: boolean): void
}>()

/** 内联 SVG 图标，避免为一个图标库增加体积 */
const TOOLS: { name: ToolName; label: string; key: string; icon: string }[] = [
  {
    name: 'select', label: '选择', key: 'V',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M5 3l14 8-6 1.5L10 19z"/></svg>'
  },
  {
    name: 'pan', label: '平移', key: 'H',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/></svg>'
  },
  {
    name: 'rect', label: '矩形', key: 'R',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3.5" y="5.5" width="17" height="13" rx="1.5"/></svg>'
  },
  {
    name: 'polygon', label: '多边形', key: 'P',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l8 5-3 10H7L4 8z"/><circle cx="12" cy="3" r="1.6" fill="currentColor"/></svg>'
  },
  {
    name: 'point', label: '关键点', key: 'K',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg>'
  },
  {
    name: 'text', label: '文本', key: 'T',
    icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 6h14M12 6v13M8.5 19h7"/></svg>'
  }
]

const presetLabels = PRESET_LABELS
const autoNext = ref(false)

function onAutoNext(e: Event) {
  autoNext.value = (e.target as HTMLInputElement).checked
  emit('auto-next', autoNext.value)
}
</script>

<style scoped>
.toolbar {
  display: flex; align-items: center; gap: 16px;
  padding: 0 14px; height: 52px; flex: none;
  background: #fff; border-bottom: 1px solid #e5eaee;
  overflow-x: auto;
}
.group { display: flex; align-items: center; gap: 8px; }
.group.right { margin-left: auto; }
.lbl { font-size: 12px; color: #7b8794; }

button {
  height: 30px; padding: 0 12px; border-radius: 7px;
  border: 1px solid #d9e0e6; background: #fff; color: #3f4c58;
  font-size: 12.5px; cursor: pointer; white-space: nowrap;
  transition: all .14s;
}
button:hover:not(:disabled) { border-color: #b9c6d2; background: #f7f9fb; }
button:disabled { opacity: .45; cursor: not-allowed; }
button.primary { background: #1f5f8b; border-color: #1f5f8b; color: #fff; }
button.primary:hover:not(:disabled) { background: #1a5279; }
button.danger { color: #c0392b; }
button.danger:hover:not(:disabled) { background: #fdf3f2; border-color: #e8b4ad; }

.tools { gap: 2px; padding: 2px; background: #f2f5f8; border-radius: 9px; }
button.tool {
  border: none; background: transparent; display: flex; align-items: center; gap: 5px;
  padding: 0 9px;
}
button.tool.active { background: #fff; box-shadow: 0 1px 3px rgba(31, 95, 139, .18); color: #1f5f8b; }
button.tool .ico { display: inline-flex; }
button.tool .txt { font-size: 12.5px; }
button.tool .kbd {
  font-size: 10px; color: #9aa5b0; border: 1px solid #dde4ea;
  border-radius: 3px; padding: 0 3px; line-height: 14px;
}

.labels { display: flex; gap: 6px; flex-wrap: nowrap; }
button.tag {
  position: relative; padding-left: 18px;
  border-color: #e2e8ee; font-size: 12px;
}
button.tag::before {
  content: ''; position: absolute; left: 7px; top: 50%; transform: translateY(-50%);
  width: 7px; height: 7px; border-radius: 50%; background: var(--c, #999);
}
button.tag.active { border-color: var(--c); background: #f7fbfd; color: #22303c; }
button.tag.add { padding: 0 10px; color: #7b8794; }

.check { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #5f6b76; cursor: pointer; }
</style>
