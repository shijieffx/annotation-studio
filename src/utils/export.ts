/**
 * 标注导出：JSON（自用可回读）/ YOLO txt / COCO json
 * 所有坐标在导出时按图像尺寸归一化或换算，与画布缩放无关。
 */
import type { Shape, ImageMeta } from '@/types'

export interface ExportBundle {
  image: { name: string; width: number; height: number }
  shapes: Shape[]
}

/** 取形状的外接框（用于 YOLO / COCO 的 bbox） */
export function bboxOf(s: Shape): [number, number, number, number] {
  if (s.type === 'rect') return [s.x, s.y, s.width, s.height]
  if (s.type === 'polygon') {
    const xs = s.points.filter((_, i) => i % 2 === 0)
    const ys = s.points.filter((_, i) => i % 2 === 1)
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    return [minX, minY, Math.max(...xs) - minX, Math.max(...ys) - minY]
  }
  // point / text 视作 0 尺寸框，加 1px 便于部分工具读取
  return [s.x, s.y, 1, 1]
}

/** 自用 JSON：结构最完整，可被本工具再次导入 */
export function toJson(bundle: ExportBundle) {
  return {
    version: '1.0',
    tool: 'annotation-studio',
    image: bundle.image,
    shapes: bundle.shapes
  }
}

/** YOLO 格式：每行 `classId cx cy w h`，坐标按图像尺寸归一化到 0~1 */
export function toYolo(bundle: ExportBundle, labels: string[]): string {
  return bundle.shapes
    .map((s) => {
      const cls = Math.max(0, labels.indexOf(s.label))
      const [x, y, w, h] = bboxOf(s)
      const cx = (x + w / 2) / bundle.image.width
      const cy = (y + h / 2) / bundle.image.height
      const nw = w / bundle.image.width
      const nh = h / bundle.image.height
      return `${cls} ${cx.toFixed(6)} ${cy.toFixed(6)} ${nw.toFixed(6)} ${nh.toFixed(6)}`
    })
    .join('\n')
}

/** COCO 格式：包含 bbox 与 segmentation，可直接喂给主流检测/分割训练框架 */
export function toCoco(bundle: ExportBundle, labels: string[]) {
  const categories = labels.map((name, i) => ({ id: i + 1, name, supercategory: 'none' }))
  const annotations = bundle.shapes.map((s, i) => {
    const [x, y, w, h] = bboxOf(s)
    const segmentation = s.type === 'polygon'
      ? [s.points.slice()]
      : [[x, y, x + w, y, x + w, y + h, x, y + h]]
    return {
      id: i + 1,
      image_id: 1,
      category_id: Math.max(1, labels.indexOf(s.label) + 1),
      bbox: [round(x), round(y), round(w), round(h)],
      area: round(w * h),
      iscrowd: 0,
      segmentation
    }
  })

  return {
    info: { description: 'exported by annotation-studio', version: '1.0' },
    licenses: [],
    images: [{
      id: 1,
      file_name: bundle.image.name,
      width: bundle.image.width,
      height: bundle.image.height
    }],
    categories,
    annotations
  }
}

const round = (n: number) => Math.round(n * 100) / 100

/** 触发浏览器下载 */
export function download(filename: string, content: string, mime = 'application/json') {
  const blob = new Blob([content], { type: mime + ';charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** 批量导出：把当前所有图片的标注打包成多文件（逐个下载） */
export function downloadAll(files: { name: string; content: string; mime?: string }[]) {
  files.forEach((f, i) => {
    // 浏览器同刻连续下载可能被拦截，间隔触发
    setTimeout(() => download(f.name, f.content, f.mime), i * 250)
  })
}

export type { ImageMeta }
