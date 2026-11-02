import type { GeoJSONFeatureCollection, GeoJSONFeature, SimplifyAlgorithm } from './types';

/**
 * 形状简化模块
 * 支持 Douglas-Peucker 和 Visvalingam-Whyatt 算法
 */

/**
 * 简化 GeoJSON FeatureCollection
 */
export function simplify(
  data: GeoJSONFeatureCollection,
  tolerance: number,
  algorithm: SimplifyAlgorithm
): GeoJSONFeatureCollection {
  if (tolerance <= 0) return data;

  const simplifyFn = algorithm === 'douglas-peucker'
    ? douglasPeucker
    : visvalingam;

  return {
    type: 'FeatureCollection',
    features: data.features.map((feature) => ({
      ...feature,
      geometry: simplifyGeometry(feature.geometry, tolerance, simplifyFn),
    })),
  };
}

type SimplifyFn = (coords: [number, number][], tolerance: number) => [number, number][];

/**
 * 简化几何体
 */
function simplifyGeometry(
  geometry: GeoJSONFeature['geometry'],
  tolerance: number,
  simplifyFn: SimplifyFn
): GeoJSONFeature['geometry'] {
  switch (geometry.type) {
    case 'LineString':
      return {
        type: 'LineString',
        coordinates: simplifyFn(geometry.coordinates, tolerance),
      };

    case 'MultiLineString':
      return {
        type: 'MultiLineString',
        coordinates: geometry.coordinates.map((line) => simplifyFn(line, tolerance)),
      };

    case 'Polygon':
      return {
        type: 'Polygon',
        coordinates: geometry.coordinates.map((ring) => {
          const simplified = simplifyFn(ring, tolerance);
          // 确保环至少有 4 个点（闭合环）
          return simplified.length >= 4 ? simplified : ring;
        }),
      };

    case 'MultiPolygon':
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map((polygon) =>
          polygon.map((ring) => {
            const simplified = simplifyFn(ring, tolerance);
            return simplified.length >= 4 ? simplified : ring;
          })
        ),
      };

    case 'GeometryCollection':
      return {
        type: 'GeometryCollection',
        geometries: geometry.geometries.map((g) =>
          simplifyGeometry(g as GeoJSONFeature['geometry'], tolerance, simplifyFn)
        ),
      };

    // Point 和 MultiPoint 不需要简化
    default:
      return geometry;
  }
}

/**
 * Douglas-Peucker 简化算法
 */
function douglasPeucker(
  coords: [number, number][],
  tolerance: number
): [number, number][] {
  if (coords.length <= 2) return coords;

  // 找到距离首尾连线最远的点
  let maxDist = 0;
  let maxIndex = 0;

  const first = coords[0];
  const last = coords[coords.length - 1];

  for (let i = 1; i < coords.length - 1; i++) {
    const dist = perpendicularDistance(coords[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  // 如果最大距离小于容差，则简化为首尾两点
  if (maxDist < tolerance) {
    return [first, last];
  }

  // 递归简化
  const left = douglasPeucker(coords.slice(0, maxIndex + 1), tolerance);
  const right = douglasPeucker(coords.slice(maxIndex), tolerance);

  // 合并结果（去掉重复的连接点）
  return [...left.slice(0, -1), ...right];
}

/**
 * 计算点到线段的垂直距离
 */
function perpendicularDistance(
  point: [number, number],
  lineStart: [number, number],
  lineEnd: [number, number]
): number {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];

  if (dx === 0 && dy === 0) {
    // 线段退化为点
    return Math.sqrt(
      Math.pow(point[0] - lineStart[0], 2) + Math.pow(point[1] - lineStart[1], 2)
    );
  }

  const t = ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) /
    (dx * dx + dy * dy);
  const clampedT = Math.max(0, Math.min(1, t));

  const projX = lineStart[0] + clampedT * dx;
  const projY = lineStart[1] + clampedT * dy;

  return Math.sqrt(
    Math.pow(point[0] - projX, 2) + Math.pow(point[1] - projY, 2)
  );
}

/**
 * Visvalingam-Whyatt 简化算法
 */
function visvalingam(
  coords: [number, number][],
  tolerance: number
): [number, number][] {
  if (coords.length <= 2) return coords;

  // 计算每个点的三角形面积
  type PointWithArea = { point: [number, number]; area: number; index: number };
  let points: PointWithArea[] = coords.map((point, index) => ({ point, area: Infinity, index }));

  // 计算每个三角形的面积
  for (let i = 1; i < points.length - 1; i++) {
    points[i].area = triangleArea(
      points[i - 1].point,
      points[i].point,
      points[i + 1].point
    );
  }

  // 迭代移除面积最小的点
  while (points.length > 2) {
    // 找到面积最小的点（排除首尾）
    let minArea = Infinity;
    let minIndex = -1;

    for (let i = 1; i < points.length - 1; i++) {
      if (points[i].area < minArea) {
        minArea = points[i].area;
        minIndex = i;
      }
    }

    // 如果最小面积大于容差，停止简化
    if (minArea >= tolerance * tolerance) break;

    // 移除该点
    points.splice(minIndex, 1);

    // 重新计算相邻点的面积
    if (minIndex > 0 && minIndex < points.length) {
      if (minIndex > 0 && minIndex < points.length - 1) {
        points[minIndex].area = triangleArea(
          points[minIndex - 1].point,
          points[minIndex].point,
          points[minIndex + 1].point
        );
      }
      if (minIndex > 1) {
        points[minIndex - 1].area = triangleArea(
          points[minIndex - 2].point,
          points[minIndex - 1].point,
          points[minIndex].point
        );
      }
    }
  }

  return points.map((p) => p.point);
}

/**
 * 计算三角形面积（使用行列式方法）
 */
function triangleArea(
  a: [number, number],
  b: [number, number],
  c: [number, number]
): number {
  return Math.abs(
    (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])) / 2
  );
}

/**
 * 根据简化比例计算容差
 * ratio: 0 (无简化) 到 1 (最大简化)
 */
export function ratioToTolerance(ratio: number, data: GeoJSONFeatureCollection): number {
  if (ratio <= 0) return 0;

  // 根据数据的 bbox 计算合理的容差范围
  let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;

  for (const feature of data.features) {
    collectBounds(feature.geometry, (lng, lat) => {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    });
  }

  const extent = Math.max(maxLng - minLng, maxLat - minLat);
  // 容差范围: extent * 0.001 ~ extent * 0.1
  return extent * (0.001 + ratio * 0.099);
}

function collectBounds(
  geometry: GeoJSONFeature['geometry'],
  callback: (lng: number, lat: number) => void
): void {
  if ('coordinates' in geometry) {
    processCoords(geometry.coordinates, callback);
  }
}

function processCoords(coords: unknown, callback: (lng: number, lat: number) => void): void {
  if (typeof coords[0] === 'number') {
    callback((coords as [number, number])[0], (coords as [number, number])[1]);
  } else if (Array.isArray(coords)) {
    for (const c of coords) processCoords(c, callback);
  }
}
