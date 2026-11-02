/**
 * 坐标转换模块
 * 支持 WGS84 / GCJ-02 / BD-09 三种坐标系互相转换
 * 使用阿里 DataV 简化边界进行精确的中国区域判断
 */

import { CHINA_REGIONS, type ChinaRegion } from './china-regions';

// ===================== 坐标系类型 =====================

export type CoordSystem = 'wgs84' | 'gcj02' | 'bd09';

/** 坐标点 */
export interface CoordPoint {
  lng: number;
  lat: number;
}

// ===================== 椭球体常量 =====================

const PI = Math.PI;
const A = 6378245.0; // 克拉索夫斯基椭球体长半轴
const EE = 0.00669342162296594323; // 偏心率平方
const X_PI = (PI * 3000.0) / 180.0; // BD-09 常量

// ===================== 区域判断 =====================

/** 判断点是否在多边形内（射线法 / Ray-Casting） */
function pointInPolygon(lng: number, lat: number, polygon: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 判断点是否在 GeoJSON 几何体内 */
function pointInGeometry(lng: number, lat: number, geom: { type: string; coordinates: unknown } | null): boolean {
  if (!geom) return false;

  if (geom.type === 'Polygon') {
    const rings = geom.coordinates as number[][][];
    // 外环包含，内环（洞）排除
    for (let r = 0; r < rings.length; r++) {
      const inside = pointInPolygon(lng, lat, rings[r]);
      if (r === 0 && !inside) return false;
      if (r > 0 && inside) return false;
    }
    return true;
  }

  if (geom.type === 'MultiPolygon') {
    const polygons = geom.coordinates as number[][][][];
    for (const polygon of polygons) {
      let inPoly = true;
      for (let r = 0; r < polygon.length; r++) {
        const inside = pointInPolygon(lng, lat, polygon[r]);
        if (r === 0 && !inside) { inPoly = false; break; }
        if (r > 0 && inside) { inPoly = false; break; }
      }
      if (inPoly) return true;
    }
  }

  return false;
}

/** 精确判断坐标点所在区域 */
export function detectRegion(lng: number, lat: number): ChinaRegion {
  // 优先检查小区域（港澳台），因为它们在大陆边界内也可能被匹配
  if (pointInGeometry(lng, lat, CHINA_REGIONS.hk as any)) return 'hk';
  if (pointInGeometry(lng, lat, CHINA_REGIONS.mo as any)) return 'mo';
  if (pointInGeometry(lng, lat, CHINA_REGIONS.tw as any)) return 'tw';
  if (pointInGeometry(lng, lat, CHINA_REGIONS.mainland as any)) return 'mainland';
  return 'overseas';
}

/** 判断是否在中国大陆（需要 GCJ-02 偏移） */
export function isMainlandChina(lng: number, lat: number): boolean {
  return detectRegion(lng, lat) === 'mainland';
}

/** 判断是否在中国境内（大陆+港澳台） */
export function isInChina(lng: number, lat: number): boolean {
  const region = detectRegion(lng, lat);
  return region !== 'overseas';
}

// ===================== 偏移量计算 =====================

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin((y / 12.0) * PI) + 320.0 * Math.sin((y * PI) / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0 / 3.0;
  return ret;
}

/** 计算 WGS84 → GCJ-02 的偏移量 */
function calcDelta(lng: number, lat: number): [number, number] {
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return [dLng, dLat];
}

// ===================== WGS84 ↔ GCJ-02 =====================

/** WGS84 → GCJ-02 */
export function wgs84ToGcj02(lng: number, lat: number): CoordPoint {
  if (!isMainlandChina(lng, lat)) return { lng, lat };
  const [dLng, dLat] = calcDelta(lng, lat);
  return { lng: lng + dLng, lat: lat + dLat };
}

/** GCJ-02 → WGS84（逆向近似，精度约 1-2 米） */
export function gcj02ToWgs84(lng: number, lat: number): CoordPoint {
  if (!isMainlandChina(lng, lat)) return { lng, lat };
  const [dLng, dLat] = calcDelta(lng, lat);
  return { lng: lng - dLng, lat: lat - dLat };
}

// ===================== GCJ-02 ↔ BD-09 =====================

/** GCJ-02 → BD-09 */
export function gcj02ToBd09(lng: number, lat: number): CoordPoint {
  const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * X_PI);
  const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * X_PI);
  return {
    lng: z * Math.cos(theta) + 0.0065,
    lat: z * Math.sin(theta) + 0.006,
  };
}

/** BD-09 → GCJ-02 */
export function bd09ToGcj02(lng: number, lat: number): CoordPoint {
  const x = lng - 0.0065;
  const y = lat - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * X_PI);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * X_PI);
  return {
    lng: z * Math.cos(theta),
    lat: z * Math.sin(theta),
  };
}

// ===================== WGS84 ↔ BD-09 =====================

/** WGS84 → BD-09（仅大陆地区偏移，境外返回原始坐标） */
export function wgs84ToBd09(lng: number, lat: number): CoordPoint {
  if (!isMainlandChina(lng, lat)) return { lng, lat };
  const gcj = wgs84ToGcj02(lng, lat);
  return gcj02ToBd09(gcj.lng, gcj.lat);
}

/** BD-09 → WGS84（仅大陆地区偏移，境外返回原始坐标） */
export function bd09ToWgs84(lng: number, lat: number): CoordPoint {
  // BD-09 逆转换时无法精确判断原始区域，直接尝试逆转换
  const gcj = bd09ToGcj02(lng, lat);
  return gcj02ToWgs84(gcj.lng, gcj.lat);
}

// ===================== 通用转换函数 =====================

/** 坐标系之间任意转换（境外不偏移，直接返回原始坐标） */
export function convert(
  lng: number,
  lat: number,
  from: CoordSystem,
  to: CoordSystem,
): CoordPoint {
  if (from === to) return { lng, lat };

  // 境外不做任何偏移，三种坐标系等效
  const inMainland = isMainlandChina(lng, lat);
  if (!inMainland) return { lng, lat };

  // 先转到 GCJ-02 作为中间坐标系
  let gcj: CoordPoint;
  switch (from) {
    case 'wgs84': gcj = wgs84ToGcj02(lng, lat); break;
    case 'gcj02': gcj = { lng, lat }; break;
    case 'bd09': gcj = bd09ToGcj02(lng, lat); break;
  }

  // 再从 GCJ-02 转到目标坐标系
  switch (to) {
    case 'wgs84': return gcj02ToWgs84(gcj.lng, gcj.lat);
    case 'gcj02': return gcj;
    case 'bd09': return gcj02ToBd09(gcj.lng, gcj.lat);
  }
}

/** 坐标系中文名称 */
export const COORD_NAMES: Record<CoordSystem, string> = {
  wgs84: 'WGS-84 (GPS)',
  gcj02: 'GCJ-02 (国测局)',
  bd09: 'BD-09 (百度)',
};

// ===================== 批量转换（GeoJSON FeatureCollection） =====================

/** 将 GeoJSON FeatureCollection 中所有坐标从一种坐标系转换到另一种 */
export function convertFeatureCollection(
  data: GeoJSON.FeatureCollection,
  from: CoordSystem,
  to: CoordSystem,
): GeoJSON.FeatureCollection {
  if (from === to) return data;

  return {
    ...data,
    features: data.features.map(feature => ({
      ...feature,
      geometry: convertGeometry(feature.geometry, from, to),
    })),
  };
}

/** 转换单个几何体坐标 */
function convertGeometry(
  geometry: GeoJSON.Geometry,
  from: CoordSystem,
  to: CoordSystem,
): GeoJSON.Geometry {
  if (!geometry) return geometry;

  if (geometry.type === 'GeometryCollection') {
    return {
      type: 'GeometryCollection',
      geometries: (geometry as GeoJSON.GeometryCollection).geometries.map(
        g => convertGeometry(g, from, to)
      ),
    };
  }

  const coords = (geometry as { coordinates: unknown }).coordinates;
  return {
    ...geometry,
    coordinates: convertCoordsRecursive(coords, from, to),
  } as GeoJSON.Geometry;
}

/** 递归转换坐标数组 */
function convertCoordsRecursive(
  coords: unknown,
  from: CoordSystem,
  to: CoordSystem,
): unknown {
  if (typeof coords[0] === 'number') {
    // 单个坐标点 [lng, lat] 或 [lng, lat, alt]
    const [lng, lat] = coords as [number, number];
    const pt = convert(lng, lat, from, to);
    return (coords as number[]).length > 2
      ? [pt.lng, pt.lat, (coords as number[])[2]]
      : [pt.lng, pt.lat];
  }
  if (Array.isArray(coords)) {
    return coords.map(c => convertCoordsRecursive(c, from, to));
  }
  return coords;
}
