<template>
  <aside class="panel">
    <section class="block">
      <div class="block-head">
        <span>图片（{{ store.images.value.length }}）</span>
      </div>
      <div v-if="!store.images.value.length" class="empty-tip">尚未导入图片</div>
      <ul v-else class="img-list">
        <li
          v-for="img in store.images.value" :key="img.id"
          :class="{ active: img.id === store.activeImageId.value }"
          @click="store.selectImage(img.id)"
        >
          <img :src="img.meta.src" :alt="img.meta.name" />
          <div class="img-meta">
            <div class="img-name" :title="img.meta.name">{{ img.meta.name }}</div>
            <div class="img-size">{{ img.meta.width }}×{{ img.meta.height }}</div>
          </div>
          <span class="badge" :class="{ zero: !img.shapes.length }">{{ img.shapes.length }}</span>
          <button class="del" title="移除这张图" @click.stop="store.removeImage(img.id)">×</button>
        </li>
      </ul>
    </section>

    <section class="block">
      <div class="block-head">
        <span>标注（{{ store.shapes.value.length }}）</span>
        <span class="hint">点击定位</span>
      </div>
      <div v-if="!store.shapes.value.length" class="empty-tip">当前图片还没有标注</div>
      <ul v-else class="shape-list">
        <li
          v-for="(s, i) in store.shapes.value" :key="s.id"
          :class="{ active: s.id === store.selectedShapeId.value }"
          @click="store.selectedShapeId.value = s.id"
        >
          <span class="dot" :style="{ background: s.color }"></span>
          <span class="idx">{{ i + 1 }}</span>
          <span class="name">{{ s.label }}</span>
          <span class="type">{{ TYPE_TEXT[s.type] }}</span>
          <span class="size">{{ describe(s) }}</span>
          <button class="del" title="删除" @click.stop="store.removeShape(s.id)">×</button>
        </li>
      </ul>
    </section>

    <section v-if="Object.keys(store.counts.value).length" class="block">
      <div class="block-head"><span>当前图片类别分布</span></div>
      <ul class="stat-list">
        <li v-for="(n, label) in store.counts.value" :key="label">
          <span class="dot" :style="{ background: colorOfLabel(String(label)) }"></span>
          <span class="name">{{ label }}</span>
          <span class="bar"><i :style="{ width: pct(Number(n)) + '%', background: colorOfLabel(String(label)) }"></i></span>
          <span class="num">{{ n }}</span>
        </li>
      </ul>
    </section>
  </aside>
</template>

<script setup lang="ts">
import { annotationStore as store } from '@/composables/useAnnotation'
import { colorOfLabel, type Shape } from '@/types'

const TYPE_TEXT: Record<Shape['type'], string> = {
  rect: '矩形', polygon: '多边形', point: '关键点', text: '文本'
}

function describe(s: Shape) {
  if (s.type === 'rect') return `${Math.round(s.width)}×${Math.round(s.height)}`
  if (s.type === 'polygon') return `${s.points.length / 2} 点`
  if (s.type === 'text') return s.text.slice(0, 10)
  return `${Math.round(s.x)},${Math.round(s.y)}`
}

function pct(n: number) {
  const total = store.shapes.value.length || 1
  return Math.round((n / total) * 100)
}
</script>

<style scoped>
.panel {
  width: 300px; flex: none; height: 100%; overflow-y: auto;
  background: #fff; border-left: 1px solid #e5eaee;
}
.block { border-bottom: 1px solid #eef2f5; padding: 12px 14px; }
.block-head {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 12.5px; font-weight: 600; color: #2b3a47; margin-bottom: 8px;
}
.hint { font-weight: 400; font-size: 11px; color: #98a2ad; }
.empty-tip { font-size: 12px; color: #9aa5b0; padding: 6px 0; }

ul { list-style: none; margin: 0; padding: 0; }
.img-list li {
  position: relative; display: flex; align-items: center; gap: 9px;
  padding: 6px; border-radius: 8px; cursor: pointer; transition: background .14s;
}
.img-list li:hover { background: #f5f8fa; }
.img-list li.active { background: #eef5fa; }
.img-list img {
  width: 42px; height: 32px; object-fit: cover;
  border-radius: 5px; border: 1px solid #e3e9ee; flex: none;
}
.img-meta { min-width: 0; flex: 1; }
.img-name {
  font-size: 12px; color: #35444f;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.img-size { font-size: 10.5px; color: #9aa5b0; }
.badge {
  font-size: 10.5px; background: #1f5f8b; color: #fff;
  border-radius: 9px; padding: 1px 6px; flex: none;
}
.badge.zero { background: #d5dde4; color: #6b7885; }

.shape-list li {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 6px; border-radius: 6px; cursor: pointer; font-size: 12px;
}
.shape-list li:hover { background: #f5f8fa; }
.shape-list li.active { background: #eef5fa; box-shadow: inset 2px 0 0 #1f5f8b; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.idx { color: #9aa5b0; font-size: 11px; min-width: 14px; }
.name { color: #35444f; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.type { color: #9aa5b0; font-size: 11px; }
.size { color: #7b8794; font-size: 11px; min-width: 44px; text-align: right; }

.del {
  border: none; background: transparent; color: #b6bfc8;
  cursor: pointer; font-size: 14px; line-height: 1; padding: 0 2px;
}
.del:hover { color: #c0392b; }

.stat-list li { display: flex; align-items: center; gap: 7px; font-size: 12px; padding: 3px 0; }
.stat-list .name { flex: none; min-width: 52px; }
.bar { flex: 1; height: 6px; background: #eef2f5; border-radius: 3px; overflow: hidden; }
.bar i { display: block; height: 100%; border-radius: 3px; }
.num { min-width: 20px; text-align: right; color: #5f6b76; }
</style>
