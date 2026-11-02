/**
 * 下钻管理器
 * 实现 DataV 风格的地图下钻功能：省→市→区县
 * 
 * 使用阿里 DataV 的 adcode 体系：
 * - XX0000 → 省级
 * - XXYY00 → 市级
 * - XXYYZZ → 区县级
 */

import type { GeoJSONFeatureCollection } from './types';
import { convertFeatureCollection } from './coord-transform';

/** 下钻层级 */
export type DrillLevel = 'country' | 'province' | 'city' | 'district';

/** 面包屑路径节点 */
export interface BreadcrumbNode {
  name: string;
  adcode: number;
  level: DrillLevel;
}

/** 下钻状态变更回调 */
export interface DrillDownCallbacks {
  onDrillDown: (data: GeoJSONFeatureCollection, name: string, level: DrillLevel) => void;
  onDrillUp: (data: GeoJSONFeatureCollection | null) => void;
  onBreadcrumbChange: (path: BreadcrumbNode[]) => void;
}

/** adcode 分类：判断属于哪个层级 */
export function classifyAdcode(code: number): DrillLevel | null {
  const s = String(code);
  if (s.length !== 6) return null;
  const city = parseInt(s.slice(2, 4));
  const dist = parseInt(s.slice(4, 6));
  if (city === 0 && dist === 0) return 'province';
  if (dist === 0) return 'city';
  return 'district';
}

/** 根据 adcode 获取 GeoJSON 文件 URL */
function getGeoUrl(adcode: number, level: DrillLevel): string {
  const dirMap: Record<DrillLevel, string> = { country: 'country', province: 'province', city: 'city', district: 'district' };
  return `/geo/${dirMap[level]}/${adcode}.json`;
}

/** 根据 adcode 获取完整 GeoJSON 文件 URL（用于进一步下钻） */
function getGeoFullUrl(adcode: number, level: DrillLevel): string {
  const dirMap: Record<DrillLevel, string> = { country: 'country', province: 'province', city: 'city', district: 'district' };
  return `/geo/${dirMap[level]}/${adcode}_full.json`;
}

/**
 * 下钻管理器
 */
export class DrillDownManager {
  private callbacks: DrillDownCallbacks;
  private breadcrumb: BreadcrumbNode[] = [];
  private currentLevel: DrillLevel = 'country';
  private currentAdcode = 100000;
  private cache = new Map<string, GeoJSONFeatureCollection>();

  constructor(callbacks: DrillDownCallbacks) {
    this.callbacks = callbacks;
  }

  /** 获取当前面包屑路径 */
  getBreadcrumb(): BreadcrumbNode[] {
    return [...this.breadcrumb];
  }

  /** 获取当前层级 */
  getCurrentLevel(): DrillLevel {
    return this.currentLevel;
  }

  /** 获取当前 adcode */
  getCurrentAdcode(): number {
    return this.currentAdcode;
  }

  /** 初始化：加载全国数据 */
  async init(): Promise<void> {
    const data = await this.fetchGeo(100000, 'country', true);
    if (data) {
      this.breadcrumb = [{ name: '中国', adcode: 100000, level: 'country' }];
      this.currentLevel = 'country';
      this.currentAdcode = 100000;
      this.callbacks.onDrillDown(data, '中国', 'country');
      this.callbacks.onBreadcrumbChange(this.breadcrumb);
    }
  }

  /** 尝试下钻到指定要素（如果是要行政区划） */
  async tryDrillDown(feature: GeoJSONFeatureCollection['features'][0]): Promise<boolean> {
    const props = feature.properties;
    if (!props) return false;

    const adcode = props.adcode as number;
    const name = (props.name || props.NAME || '') as string;
    if (!adcode || !name) return false;

    // 判断目标层级
    const targetLevel = classifyAdcode(adcode);
    if (!targetLevel) return false;

    // 只能下钻到当前层级的子级
    const levelOrder: DrillLevel[] = ['country', 'province', 'city', 'district'];
    const currentIdx = levelOrder.indexOf(this.currentLevel);
    const targetIdx = levelOrder.indexOf(targetLevel);

    // 允许下钻到当前层级的下一级，或者跳级（如从全国直接到市）
    if (targetIdx <= currentIdx) return false;
    if (targetLevel === 'district' && this.currentLevel === 'country') return false;

    // 加载目标数据（优先使用 _full 版本以支持进一步下钻）
    const data = await this.fetchGeo(adcode, targetLevel, true);
    if (!data || data.features.length === 0) {
      // 尝试简化版
      const simpleData = await this.fetchGeo(adcode, targetLevel, false);
      if (!simpleData) return false;
      // 简化版没有子区域，不能继续下钻，但仍然可以显示
      this.pushBreadcrumb(name, adcode, targetLevel);
      this.callbacks.onDrillDown(simpleData, name, targetLevel);
      return true;
    }

    this.pushBreadcrumb(name, adcode, targetLevel);
    this.callbacks.onDrillDown(data, name, targetLevel);
    return true;
  }

  /** 上钻到指定层级 */
  async drillUp(targetIndex: number): Promise<void> {
    if (targetIndex >= this.breadcrumb.length - 1) return;

    const target = this.breadcrumb[targetIndex];
    this.breadcrumb = this.breadcrumb.slice(0, targetIndex + 1);
    this.currentLevel = target.level;
    this.currentAdcode = target.adcode;

    // 重新加载目标层级数据
    const data = await this.fetchGeo(target.adcode, target.level, target.level !== 'district');
    this.callbacks.onDrillUp(data);
    this.callbacks.onBreadcrumbChange(this.breadcrumb);
  }

  /** 重置到全国视图 */
  async resetToCountry(): Promise<void> {
    await this.drillUp(0);
  }

  /** 推送面包屑节点 */
  private pushBreadcrumb(name: string, adcode: number, level: DrillLevel): void {
    this.breadcrumb.push({ name, adcode, level });
    this.currentLevel = level;
    this.currentAdcode = adcode;
    this.callbacks.onBreadcrumbChange(this.breadcrumb);
  }

  /** 获取 GeoJSON 数据（带缓存） */
  private async fetchGeo(adcode: number, level: DrillLevel, useFull: boolean): Promise<GeoJSONFeatureCollection | null> {
    const url = useFull ? getGeoFullUrl(adcode, level) : getGeoUrl(adcode, level);
    const cacheKey = url;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      const res = await fetch(url);
      if (!res.ok) {
        // 如果 _full 版本不存在，回退到简化版
        if (useFull) {
          return this.fetchGeo(adcode, level, false);
        }
        return null;
      }
      const rawData = await res.json() as GeoJSONFeatureCollection;
      // DataV 数据使用 GCJ-02 坐标系，转换为 WGS-84 以匹配 MapLibre/OSM 底图
      const data = convertFeatureCollection(rawData, 'gcj02', 'wgs84');
      this.cache.set(cacheKey, data);
      return data;
    } catch {
      return null;
    }
  }
}
