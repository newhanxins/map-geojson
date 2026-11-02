import type { GeoJSONFeatureCollection, GeoJSONFeature, LayerStats } from './types';

/**
 * 计算 GeoJSON 数据的统计信息
 */
export function computeStats(data: GeoJSONFeatureCollection): LayerStats {
  const typeDistribution: Record<string, number> = {};
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  let hasCoords = false;
  let totalArea = 0;
  let totalPerimeter = 0;

  for (const feature of data.features) {
    // 类型分布
    const type = feature.geometry.type;
    typeDistribution[type] = (typeDistribution[type] || 0) + 1;

    // 计算边界框
    collectBounds(feature.geometry, (lng, lat) => {
      hasCoords = true;
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    });

    // 面积和周长估算
    if (type === 'Polygon' || type === 'MultiPolygon') {
      const { area, perimeter } = estimatePolygonMetrics(feature.geometry);
      totalArea += area;
      totalPerimeter += perimeter;
    } else if (type === 'LineString' || type === 'MultiLineString') {
      totalPerimeter += estimateLineLength(feature.geometry);
    }
  }

  return {
    featureCount: data.features.length,
    typeDistribution,
    bbox: hasCoords ? [minLng, minLat, maxLng, maxLat] : null,
    estimatedArea: totalArea > 0 ? totalArea : null,
    estimatedPerimeter: totalPerimeter > 0 ? totalPerimeter : null,
  };
}

/**
 * 收集几何体中的所有坐标
 */
function collectBounds(
  geometry: GeoJSONFeature['geometry'],
  callback: (lng: number, lat: number) => void
): void {
  if ('coordinates' in geometry) {
    processCoords(geometry.coordinates, callback);
  } else if (geometry.type === 'GeometryCollection') {
    for (const geom of geometry.geometries) {
      collectBounds(geom, callback);
    }
  }
}

function processCoords(coords: unknown, callback: (lng: number, lat: number) => void): void {
  if (typeof coords[0] === 'number') {
    const [lng, lat] = coords as [number, number];
    callback(lng, lat);
  } else if (Array.isArray(coords)) {
    for (const c of coords) {
      processCoords(c, callback);
    }
  }
}

/**
 * 估算多边形面积和周长（使用球面近似）
 */
function estimatePolygonMetrics(geometry: GeoJSONFeature['geometry']): { area: number; perimeter: number } {
  let area = 0;
  let perimeter = 0;

  if (geometry.type === 'Polygon') {
    const ring = geometry.coordinates[0]; // 外环
    area += Math.abs(ringArea(ring));
    perimeter += ringLength(ring);
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of geometry.coordinates) {
      const ring = polygon[0];
      area += Math.abs(ringArea(ring));
      perimeter += ringLength(ring);
    }
  }

  return { area, perimeter };
}

/**
 * 估算线段长度（米）
 */
function estimateLineLength(geometry: GeoJSONFeature['geometry']): number {
  if (geometry.type === 'LineString') {
    return ringLength(geometry.coordinates);
  }
  if (geometry.type === 'MultiLineString') {
    return geometry.coordinates.reduce((sum, line) => sum + ringLength(line), 0);
  }
  return 0;
}

/**
 * 计算环的面积（平方米，球面近似）
 */
function ringArea(coords: [number, number][]): number {
  const EARTH_RADIUS = 6371008.8; // 米
  let total = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i];
    const [lng2, lat2] = coords[i + 1];
    total += toRad(lng2 - lng1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)));
  }

  return Math.abs((total * EARTH_RADIUS * EARTH_RADIUS) / 2);
}

/**
 * 计算环的长度（米）
 */
function ringLength(coords: [number, number][]): number {
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += haversineDistance(coords[i], coords[i + 1]);
  }
  return total;
}

/**
 * Haversine 距离公式（米）
 */
function haversineDistance(p1: [number, number], p2: [number, number]): number {
  const EARTH_RADIUS = 6371008.8;
  const dLat = toRad(p2[1] - p1[1]);
  const dLng = toRad(p2[0] - p1[0]);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(p1[1])) * Math.cos(toRad(p2[1])) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS * c;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * 格式化面积为可读字符串
 */
export function formatArea(sqMeters: number): string {
  if (sqMeters >= 1e12) return `${(sqMeters / 1e12).toFixed(2)} M km\u00B2`;
  if (sqMeters >= 1e6) return `${(sqMeters / 1e6).toFixed(2)} km\u00B2`;
  if (sqMeters >= 1e4) return `${(sqMeters / 1e4).toFixed(2)} ha`;
  return `${sqMeters.toFixed(2)} m\u00B2`;
}

/**
 * 格式化距离为可读字符串
 */
export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${meters.toFixed(2)} m`;
}

/**
 * 格式化 bbox
 */
export function formatBbox(bbox: [number, number, number, number]): string {
  return `[${bbox[0].toFixed(4)}, ${bbox[1].toFixed(4)}, ${bbox[2].toFixed(4)}, ${bbox[3].toFixed(4)}]`;
}
