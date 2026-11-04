/**
 * 右键菜单操作处理器
 * 处理所有右键菜单项对应的操作逻辑
 */

import type { GeoJSONFeature, GeoJSONFeatureCollection } from './types';
import maplibregl from 'maplibre-gl';

/**
 * 编辑顶点 - 进入顶点编辑模式
 */
export function handleEditVertices(
  renderer: any,
  layerId: string,
  featureIndex: number,
  feature: GeoJSON.Feature,
  data: GeoJSONFeatureCollection,
  onUpdate: (layerId: string, featureIndex: number, oldGeometry: any, newGeometry: any) => void,
  onDelete?: (vertexIndex: number) => void
): void {
  renderer.startVertexEditing(
    layerId,
    featureIndex,
    feature as unknown as GeoJSON.Feature,
    onUpdate,
    data as unknown as GeoJSON.FeatureCollection,
    onDelete
  );
}

/**
 * 停止编辑顶点
 */
export function handleStopEditing(renderer: any): void {
  renderer.stopVertexEditing();
}

/**
 * 移动要素到新位置
 */
export function handleMoveFeature(
  map: maplibregl.Map,
  layerId: string,
  featureIndex: number,
  feature: GeoJSON.Feature,
  highlightFeature: (feature: any) => void,
  recordEdit: (layerId: string, operation: any) => void,
  getLayerData: (layerId: string) => GeoJSONFeatureCollection | null
): void {
  // 高亮当前要素
  highlightFeature(feature as any);
  
  console.log('[handleMoveFeature] 开始移动模式');
  
  let isDragging = false;
  let startCoord: [number, number] | null = null;
  let originalGeometry: any = null;
  
  // 临时禁用地图拖拽
  map.dragPan.disable();
  map.getCanvas().style.cursor = 'move';
  
  const onMouseDown = (e: maplibregl.MapMouseEvent) => {
    // 检查是否点击在要素上
    const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
      [e.point.x - 5, e.point.y - 5],
      [e.point.x + 5, e.point.y + 5],
    ];
    
    // 使用正确的 MapLibre 图层 ID（fill/line/point）
    const layerIds = [
      `geo-fill-${layerId}`,
      `geo-line-${layerId}`,
      `geo-point-${layerId}`,
    ];
    const features = map.queryRenderedFeatures(bbox, { layers: layerIds });
    
    if (features.length > 0) {
      isDragging = true;
      startCoord = [e.lngLat.lng, e.lngLat.lat];
      originalGeometry = JSON.parse(JSON.stringify(feature.geometry));
      map.getCanvas().style.cursor = 'grabbing';
      console.log('[handleMoveFeature] 开始拖动', startCoord);
    }
  };
  
  const onMouseMove = (e: maplibregl.MapMouseEvent) => {
    if (!isDragging || !startCoord || !originalGeometry) return;
    
    const currentCoord = [e.lngLat.lng, e.lngLat.lat];
    const deltaLng = currentCoord[0] - startCoord[0];
    const deltaLat = currentCoord[1] - startCoord[1];
    
    // 平移几何体
    const newGeometry = translateGeometry(originalGeometry, deltaLng, deltaLat);
    
    // 获取图层数据
    const data = getLayerData(layerId);
    if (!data) return;
    
    // 深拷贝数据，避免引用问题
    const updatedData = JSON.parse(JSON.stringify(data));
    updatedData.features[featureIndex] = {
      ...updatedData.features[featureIndex],
      geometry: newGeometry,
    };
    
    // 更新地图源（传入完整的新数据）
    const sourceKey = `geo-source-${layerId}`;
    const source = map.getSource(sourceKey) as maplibregl.GeoJSONSource;
    if (source) {
      source.setData(updatedData);
    }
    
    // 更新高亮
    highlightFeature(updatedData.features[featureIndex] as any);
  };
  
  const onMouseUp = (e: maplibregl.MapMouseEvent) => {
    if (!isDragging || !startCoord || !originalGeometry) {
      cleanup();
      return;
    }
    
    isDragging = false;
    const endCoord = [e.lngLat.lng, e.lngLat.lat];
    const deltaLng = endCoord[0] - startCoord[0];
    const deltaLat = endCoord[1] - startCoord[1];
    
    console.log('[handleMoveFeature] 拖动结束', { deltaLng, deltaLat });
    
    // 如果有实际移动，记录历史
    if (Math.abs(deltaLng) > 0.0001 || Math.abs(deltaLat) > 0.0001) {
      const newGeometry = translateGeometry(originalGeometry, deltaLng, deltaLat);
      
      const data = getLayerData(layerId);
      if (data) {
        // 记录到编辑历史
        recordEdit(layerId, {
          type: 'modify',
          featureIndex,
          oldFeature: {
            ...data.features[featureIndex],
            geometry: originalGeometry,
          },
          newFeature: {
            ...data.features[featureIndex],
            geometry: newGeometry,
          },
          timestamp: Date.now(),
        });
      }
      
      console.log('[handleMoveFeature] 移动完成，已记录历史');
    } else {
      console.log('[handleMoveFeature] 移动距离太小，取消');
    }
    
    cleanup();
  };
  
  const cleanup = () => {
    map.off('mousedown', onMouseDown);
    map.off('mousemove', onMouseMove);
    map.off('mouseup', onMouseUp);
    map.dragPan.enable();
    map.getCanvas().style.cursor = '';
    isDragging = false;
    startCoord = null;
    originalGeometry = null;
    console.log('[handleMoveFeature] 清理完成');
  };
  
  // 绑定事件
  map.on('mousedown', onMouseDown);
  map.on('mousemove', onMouseMove);
  map.on('mouseup', onMouseUp);
  
  // ESC 取消
  const onEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      cleanup();
      document.removeEventListener('keydown', onEsc);
      console.log('[handleMoveFeature] ESC 取消');
    }
  };
  document.addEventListener('keydown', onEsc);
}

/**
 * 添加顶点到要素的边上
 */
export function handleAddVertex(
  map: maplibregl.Map,
  layerId: string,
  featureIndex: number,
  feature: GeoJSON.Feature,
  highlightFeature: (feature: any) => void,
  recordEdit: (layerId: string, operation: any) => void,
  getLayerData: (layerId: string) => GeoJSONFeatureCollection | null
): void {
  // 高亮当前要素
  highlightFeature(feature as any);
  
  console.log('[handleAddVertex] 开始添加顶点模式');
  
  let added = false;
  
  // 临时禁用地图拖拽
  map.dragPan.disable();
  map.getCanvas().style.cursor = 'crosshair';
  
  const onClick = (e: maplibregl.MapMouseEvent) => {
    if (added) return;
    
    const clickCoord = [e.lngLat.lng, e.lngLat.lat];
    const geometry = feature.geometry;
    
    console.log('[handleAddVertex] 点击位置', clickCoord);
    
    // 检查几何类型是否支持添加顶点
    if (!['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString'].includes(geometry.type)) {
      console.warn('[handleAddVertex] 不支持的几何类型', geometry.type);
      cleanup();
      return;
    }
    
    // 保存旧的几何（用于历史记录）
    const oldGeometry = JSON.parse(JSON.stringify(geometry));
    
    // 在最近的边上插入顶点
    const result = insertVertexOnEdge(geometry, clickCoord);
    if (!result) {
      console.warn('[handleAddVertex] 未找到可插入的边');
      cleanup();
      return;
    }
    
    console.log('[handleAddVertex] 找到插入点', result.insertIndex);
    
    // 获取图层数据
    const data = getLayerData(layerId);
    if (!data) {
      cleanup();
      return;
    }
    
    // 深拷贝数据，避免引用问题
    const updatedData = JSON.parse(JSON.stringify(data));
    const newGeometry = result.geometry;
    
    updatedData.features[featureIndex] = {
      ...updatedData.features[featureIndex],
      geometry: newGeometry,
    };
    
    // 更新地图源（传入完整的新数据）
    const sourceKey = `geo-source-${layerId}`;
    const source = map.getSource(sourceKey) as maplibregl.GeoJSONSource;
    if (source) {
      source.setData(updatedData);
    }
    
    // 更新高亮
    highlightFeature(updatedData.features[featureIndex] as any);
    
    // 记录到编辑历史
    recordEdit(layerId, {
      type: 'modify',
      featureIndex,
      oldFeature: {
        ...updatedData.features[featureIndex],
        geometry: oldGeometry,
      },
      newFeature: {
        ...updatedData.features[featureIndex],
        geometry: newGeometry,
      },
      timestamp: Date.now(),
    });
    
    added = true;
    console.log('[handleAddVertex] 顶点已添加并记录历史');
    cleanup();
  };
  
  const cleanup = () => {
    map.off('click', onClick);
    map.dragPan.enable();
    map.getCanvas().style.cursor = '';
    console.log('[handleAddVertex] 清理完成');
  };
  
  // 绑定事件
  map.on('click', onClick);
  
  // ESC 取消
  const onEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      cleanup();
      document.removeEventListener('keydown', onEsc);
      if (!added) {
        console.log('[handleAddVertex] ESC 取消');
      }
    }
  };
  document.addEventListener('keydown', onEsc);
}

/**
 * 移动整个图层的所有要素
 */
export function handleMoveLayer(
  map: maplibregl.Map,
  layerId: string,
  highlightFeature: (feature: any) => void,
  recordEdit: (layerId: string, operation: any) => void,
  getLayerData: (layerId: string) => GeoJSONFeatureCollection | null
): void {
  const data = getLayerData(layerId);
  if (!data || !data.features || data.features.length === 0) {
    console.warn('[handleMoveLayer] 图层没有要素');
    return;
  }
  
  console.log('[handleMoveLayer] 开始移动图层模式，共', data.features.length, '个要素');
  
  let isDragging = false;
  let startCoord: [number, number] | null = null;
  let originalGeometries: any[] = [];
  
  // 临时禁用地图拖拽
  map.dragPan.disable();
  map.getCanvas().style.cursor = 'move';
  
  const onMouseDown = (e: maplibregl.MapMouseEvent) => {
    // 检查是否点击在图层的任意要素上
    const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
      [e.point.x - 5, e.point.y - 5],
      [e.point.x + 5, e.point.y + 5],
    ];
    
    // 使用正确的 MapLibre 图层 ID（fill/line/point）
    const layerIds = [
      `geo-fill-${layerId}`,
      `geo-line-${layerId}`,
      `geo-point-${layerId}`,
    ];
    const features = map.queryRenderedFeatures(bbox, { layers: layerIds });
    
    if (features.length > 0) {
      isDragging = true;
      startCoord = [e.lngLat.lng, e.lngLat.lat];
      // 保存所有要素的原始几何
      originalGeometries = data.features.map(f => JSON.parse(JSON.stringify(f.geometry)));
      map.getCanvas().style.cursor = 'grabbing';
      console.log('[handleMoveLayer] 开始拖动', startCoord);
    }
  };
  
  const onMouseMove = (e: maplibregl.MapMouseEvent) => {
    if (!isDragging || !startCoord || originalGeometries.length === 0) return;
    
    const currentCoord = [e.lngLat.lng, e.lngLat.lat];
    const deltaLng = currentCoord[0] - startCoord[0];
    const deltaLat = currentCoord[1] - startCoord[1];
    
    // 平移所有要素
    const updatedData = JSON.parse(JSON.stringify(data));
    for (let i = 0; i < updatedData.features.length; i++) {
      updatedData.features[i].geometry = translateGeometry(originalGeometries[i], deltaLng, deltaLat);
    }
    
    // 更新地图源
    const sourceKey = `geo-source-${layerId}`;
    const source = map.getSource(sourceKey) as maplibregl.GeoJSONSource;
    if (source) {
      source.setData(updatedData);
    }
    
    // 高亮第一个要素（作为参考点）
    if (updatedData.features.length > 0) {
      highlightFeature(updatedData.features[0] as any);
    }
  };
  
  const onMouseUp = () => {
    if (!isDragging || !startCoord) return;
    
    const currentCoord = [(event as MouseEvent & { lngLat?: { lng: number; lat: number } })?.lngLat?.lng ?? 0, (event as MouseEvent & { lngLat?: { lng: number; lat: number } })?.lngLat?.lat ?? 0];
    const deltaLng = currentCoord[0] - startCoord[0];
    const deltaLat = currentCoord[1] - startCoord[1];
    
    // 如果没有移动，不记录
    if (Math.abs(deltaLng) < 0.0001 && Math.abs(deltaLat) < 0.0001) {
      cleanup();
      return;
    }
    
    // 获取最终数据
    const finalData = getLayerData(layerId);
    if (!finalData) {
      cleanup();
      return;
    }
    
    // 为每个要素记录编辑历史
    for (let i = 0; i < finalData.features.length; i++) {
      recordEdit(layerId, {
        type: 'modify',
        featureIndex: i,
        oldFeature: {
          ...finalData.features[i],
          geometry: originalGeometries[i],
        },
        newFeature: {
          ...finalData.features[i],
        },
        timestamp: Date.now(),
      });
    }
    
    console.log('[handleMoveLayer] 移动完成，共', finalData.features.length, '个要素');
    cleanup();
  };
  
  const cleanup = () => {
    map.off('mousedown', onMouseDown);
    map.off('mousemove', onMouseMove);
    map.off('mouseup', onMouseUp);
    map.dragPan.enable();
    map.getCanvas().style.cursor = '';
    isDragging = false;
    startCoord = null;
    originalGeometries = [];
    console.log('[handleMoveLayer] 清理完成');
  };
  
  // 绑定事件
  map.on('mousedown', onMouseDown);
  map.on('mousemove', onMouseMove);
  map.on('mouseup', onMouseUp);
  
  // ESC 取消
  const onEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      cleanup();
      document.removeEventListener('keydown', onEsc);
      console.log('[handleMoveLayer] ESC 取消');
    }
  };
  document.addEventListener('keydown', onEsc);
}

/**
 * 重置要素到源数据
 */
export function handleResetFeature(
  layerId: string,
  featureIndex: number,
  originalData: GeoJSONFeatureCollection,
  editManager: any,
  refreshLayerRendering: (layer: any) => void,
  getLayer: (layerId: string) => any
): void {
  const layer = getLayer(layerId);
  if (!layer) return;
  
  const updatedData = editManager.resetFeature(layerId, layer, featureIndex, originalData);
  if (updatedData) {
    refreshLayerRendering(layer);
  }
}

// ==================== 辅助函数 ====================

/**
 * 平移几何体
 */
function translateGeometry(geometry: any, deltaLng: number, deltaLat: number): any {
  const newGeometry = JSON.parse(JSON.stringify(geometry));
  
  if (geometry.type === 'Point') {
    newGeometry.coordinates[0] += deltaLng;
    newGeometry.coordinates[1] += deltaLat;
  } else if (geometry.type === 'LineString' || geometry.type === 'MultiPoint') {
    for (const coord of newGeometry.coordinates) {
      coord[0] += deltaLng;
      coord[1] += deltaLat;
    }
  } else if (geometry.type === 'Polygon' || geometry.type === 'MultiLineString') {
    for (const ring of newGeometry.coordinates) {
      for (const coord of ring) {
        coord[0] += deltaLng;
        coord[1] += deltaLat;
      }
    }
  } else if (geometry.type === 'MultiPolygon') {
    for (const polygon of newGeometry.coordinates) {
      for (const ring of polygon) {
        for (const coord of ring) {
          coord[0] += deltaLng;
          coord[1] += deltaLat;
        }
      }
    }
  }
  
  return newGeometry;
}

/**
 * 在最近的边上插入顶点
 */
function insertVertexOnEdge(geometry: any, clickCoord: number[]): { geometry: any; insertIndex: number } | null {
  let minDist = Infinity;
  let bestRing: number[][] | null = null;
  let bestInsertIndex = -1;
  
  const rings = getRingsFromGeometry(geometry);
  
  for (const ring of rings) {
    for (let i = 0; i < ring.length - 1; i++) {
      const p1 = ring[i];
      const p2 = ring[i + 1];
      const dist = pointToSegmentDistance(clickCoord, p1, p2);
      if (dist < minDist) {
        minDist = dist;
        bestRing = ring;
        bestInsertIndex = i + 1;
      }
    }
  }
  
  // 距离阈值：0.5 度（约 50 公里）
  if (bestRing && minDist < 0.5) {
    // 投影点到线段上
    const newPoint = projectPointOnSegment(clickCoord, bestRing[bestInsertIndex - 1], bestRing[bestInsertIndex]);
    bestRing.splice(bestInsertIndex, 0, newPoint);
    return { geometry, insertIndex: bestInsertIndex };
  }
  
  return null;
}

/**
 * 获取几何体的所有环
 */
function getRingsFromGeometry(geometry: any): number[][][] {
  if (geometry.type === 'Polygon') {
    return geometry.coordinates;
  } else if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flat();
  } else if (geometry.type === 'LineString') {
    return [geometry.coordinates];
  } else if (geometry.type === 'MultiLineString') {
    return geometry.coordinates;
  }
  return [];
}

/**
 * 点到线段的距离
 */
function pointToSegmentDistance(p: number[], a: number[], b: number[]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const projX = a[0] + t * dx;
  const projY = a[1] + t * dy;
  return Math.hypot(p[0] - projX, p[1] - projY);
}

/**
 * 投影点到线段上
 */
function projectPointOnSegment(p: number[], a: number[], b: number[]): number[] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return [...a];
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return [a[0] + t * dx, a[1] + t * dy];
}
