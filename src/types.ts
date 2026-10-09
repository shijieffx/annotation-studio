/** 标注数据的类型定义（坐标一律使用「图像坐标系」，与缩放平移无关） */

export type ShapeType = 'rect' | 'polygon' | 'point' | 'text'

export interface BaseShape {
  id: string
  type: ShapeType
  /** 标注类别 */
  label: string
  /** 显示颜色 */
  color: string
  createdAt: number
}

export interface RectShape extends BaseShape {
  type: 'rect'
  x: number
  y: number
  width: number
  height: number
}

export interface PolygonShape extends BaseShape {
  type: 'polygon'
  /** 扁平化点集：[x1, y1, x2, y2, ...] */
  points: number[]
}

export interface PointShape extends BaseShape {
  type: 'point'
  x: number
  y: number
}

export interface TextShape extends BaseShape {
  type: 'text'
  x: number
  y: number
  text: string
}

export type Shape = RectShape | PolygonShape | PointShape | TextShape

export interface ImageMeta {
  name: string
  width: number
  height: number
  src: string
}

export type ToolName = 'select' | 'pan' | 'rect' | 'polygon' | 'point' | 'text'

export const TOOL_LABELS: Record<ToolName, string> = {
  select: '选择 / 编辑',
  pan: '平移画布',
  rect: '矩形框',
  polygon: '多边形',
  point: '关键点',
  text: '文本'
}

/** 预置类别与配色：同一类别在不同图片上保持同色，便于跨图对照 */
export const PRESET_LABELS = [
  '人员', '车辆', '设备', '安全帽', '告警区域', '缺陷', '遮挡', '其他'
]

export const LABEL_COLORS = [
  '#e2504a', '#e8912d', '#3b6d11', '#1f5f8b',
  '#7f77dd', '#993556', '#0f6e56', '#5f5e5a'
]

export function colorOfLabel(label: string): string {
  const i = PRESET_LABELS.indexOf(label)
  if (i >= 0) return LABEL_COLORS[i % LABEL_COLORS.length]
  // 自定义类别：用名称哈希稳定映射到配色，避免每次刷新换色
  let h = 0
  for (let k = 0; k < label.length; k++) h = (h * 31 + label.charCodeAt(k)) >>> 0
  return LABEL_COLORS[h % LABEL_COLORS.length]
}
