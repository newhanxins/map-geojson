import type { GeoJSONFeatureCollection, GeoLayer } from './types';

/**
 * 导出模块
 * 将 GeoJSON 数据导出为各种格式
 */

/**
 * 导出为 GeoJSON 文件并下载
 */
export function exportGeoJSON(data: GeoJSONFeatureCollection, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  downloadBlob(new Blob([json], { type: 'application/geo+json' }), filename + '.geojson');
}

/**
 * 导出图层数据（可选择是否使用简化版本）
 */
export function exportLayer(layer: GeoLayer, useSimplified: boolean = false): void {
  const data = useSimplified && layer.simplifiedData ? layer.simplifiedData : layer.data;
  const filename = useSimplified ? `${layer.name}-simplified` : layer.name;
  exportGeoJSON(data, filename);
}

/**
 * 导出所有图层为合并的 GeoJSON
 */
export function exportAllLayers(layers: GeoLayer[], filename = 'all-layers'): void {
  const allFeatures = layers.flatMap((l) => (l.simplifiedData || l.data).features);
  const combined: GeoJSONFeatureCollection = {
    type: 'FeatureCollection',
    features: allFeatures,
  };
  exportGeoJSON(combined, filename);
}

/**
 * 导出为 TopoJSON 格式（简化版本）
 */
export function exportTopoJSON(data: GeoJSONFeatureCollection, filename: string): void {
  // 简化的 TopoJSON 转换
  const topoData = convertToTopoJSON(data);
  const json = JSON.stringify(topoData, null, 2);
  downloadBlob(new Blob([json], { type: 'application/json' }), filename + '.topojson');
}

/**
 * 将 GeoJSON 转换为简化的 TopoJSON
 */
function convertToTopoJSON(data: GeoJSONFeatureCollection): unknown {
  const arcs: number[][][] = [];
  const geometries: Array<{
    type: string;
    arcs?: number[][];
    properties?: Record<string, unknown>;
  }> = [];

  for (const feature of data.features) {
    const geom = feature.geometry;
    if (geom.type === 'Polygon') {
      const arcIndices: number[][] = [];
      for (const ring of geom.coordinates) {
        const arcIndex = arcs.length;
        // 转换为 delta 编码
        arcs.push(deltaEncode(ring));
        arcIndices.push([arcIndex]);
      }
      geometries.push({
        type: 'Polygon',
        arcs: arcIndices,
        properties: feature.properties || {},
      });
    } else if (geom.type === 'LineString') {
      const arcIndex = arcs.length;
      arcs.push(deltaEncode(geom.coordinates));
      geometries.push({
        type: 'LineString',
        arcs: [[arcIndex]],
        properties: feature.properties || {},
      });
    } else {
      // 其他类型保持原样（简化处理）
      geometries.push({
        type: geom.type,
        properties: feature.properties || {},
      });
    }
  }

  return {
    type: 'Topology',
    objects: {
      data: {
        type: 'GeometryCollection',
        geometries,
      },
    },
    arcs,
  };
}

/**
 * Delta 编码坐标序列
 */
function deltaEncode(coords: [number, number][]): number[][] {
  let prevX = 0, prevY = 0;
  return coords.map(([x, y]) => {
    const dx = Math.round((x - prevX) * 1e6);
    const dy = Math.round((y - prevY) * 1e6);
    prevX = x;
    prevY = y;
    return [dx, dy];
  });
}

/**
 * 复制 GeoJSON 到剪贴板
 */
export async function copyToClipboard(data: GeoJSONFeatureCollection): Promise<void> {
  const json = JSON.stringify(data, null, 2);
  await navigator.clipboard.writeText(json);
}

/**
 * 触发文件下载
 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 将 GeoJSON 格式化为漂亮的 JSON 字符串
 */
export function toPrettyJSON(data: GeoJSONFeatureCollection): string {
  return JSON.stringify(data, null, 2);
}
