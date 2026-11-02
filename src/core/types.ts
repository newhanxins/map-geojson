import type { Map, LngLatBoundsLike } from 'maplibre-gl';

/** GeoJSON 几何类型 */
export type GeoJSONGeometryType =
  | 'Point'
  | 'MultiPoint'
  | 'LineString'
  | 'MultiLineString'
  | 'Polygon'
  | 'MultiPolygon'
  | 'GeometryCollection';

/** GeoJSON Feature */
export interface GeoJSONFeature {
  type: 'Feature';
  geometry: GeoJSONGeometry;
  properties: Record<string, unknown> | null;
  id?: string | number;
}

/** GeoJSON Geometry */
export type GeoJSONGeometry =
  | { type: 'Point'; coordinates: [number, number] }
  | { type: 'MultiPoint'; coordinates: [number, number][] }
  | { type: 'LineString'; coordinates: [number, number][] }
  | { type: 'MultiLineString'; coordinates: [number, number][][] }
  | { type: 'Polygon'; coordinates: [number, number][][] }
  | { type: 'MultiPolygon'; coordinates: [number, number][][][] }
  | { type: 'GeometryCollection'; geometries: GeoJSONGeometry[] };

/** GeoJSON FeatureCollection */
export interface GeoJSONFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
}

/** 图层数据 */
export interface GeoLayer {
  id: string;
  name: string;
  data: GeoJSONFeatureCollection;
  visible: boolean;
  color: string;
  /** 简化后的数据缓存 */
  simplifiedData?: GeoJSONFeatureCollection;
  /** 当前简化比例 (0-1, 0=无简化) */
  simplifyRatio?: number;
}

/** 图层统计信息 */
export interface LayerStats {
  featureCount: number;
  typeDistribution: Record<string, number>;
  bbox: [number, number, number, number] | null;
  estimatedArea: number | null;
  estimatedPerimeter: number | null;
}

/** 简化算法类型 */
export type SimplifyAlgorithm = 'douglas-peucker' | 'visvalingam';

/** 图层样式配置 */
export interface LayerStyle {
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeWidth: number;
  strokeOpacity: number;
  pointRadius: number;
  pointColor: string;
}

/** 要素选中状态 */
export interface SelectedFeature {
  layerId: string;
  featureIndex: number;
  feature: GeoJSONFeature;
}

/** 应用状态 */
export interface AppState {
  map: Map | null;
  layers: GeoLayer[];
  activeLayerId: string | null;
  selectedFeature: SelectedFeature | null;
  simplifyActive: boolean;
  simplifyAlgorithm: SimplifyAlgorithm;
  simplifyRatio: number;
}

/** 事件类型定义 */
export type AppEventMap = {
  'layer:add': { layer: GeoLayer };
  'layer:remove': { layerId: string };
  'layer:toggle': { layerId: string; visible: boolean };
  'layer:select': { layerId: string };
  'feature:select': { feature: SelectedFeature | null };
  'simplify:change': { algorithm: SimplifyAlgorithm; ratio: number };
  'data:loaded': { layerId: string };
};

/** 默认图层颜色调色板 */
export const LAYER_COLORS = [
  '#4f8cff',
  '#36cfcf',
  '#ff6b6b',
  '#ffc107',
  '#52c41a',
  '#9c27b0',
  '#ff9800',
  '#e91e63',
  '#00bcd4',
  '#795548',
];

/** 默认图层样式 */
export const DEFAULT_LAYER_STYLE: LayerStyle = {
  fillColor: '#4f8cff',
  fillOpacity: 0.25,
  strokeColor: '#4f8cff',
  strokeWidth: 2,
  strokeOpacity: 1,
  pointRadius: 5,
  pointColor: '#4f8cff',
};
