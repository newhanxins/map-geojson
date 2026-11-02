/**
 * 图层样式管理器
 * 负责管理图层样式的增删改查、持久化和 GeoJSON 样式嵌入
 */

import type { LayerStyle, GeoJSONFeatureCollection } from './types';
import { DEFAULT_LAYER_STYLE } from './types';

const STORAGE_KEY = 'geo-viewer-layer-styles';

export class StyleManager {
  private styles: Map<string, LayerStyle> = new Map();

  constructor() {
    this.loadFromLocalStorage();
  }

  /** 获取图层样式（如果没有则返回默认样式） */
  getStyle(layerId: string): LayerStyle {
    return this.styles.get(layerId) || { ...DEFAULT_LAYER_STYLE };
  }

  /** 更新图层样式（支持部分更新） */
  updateStyle(layerId: string, style: Partial<LayerStyle>): void {
    const current = this.getStyle(layerId);
    const updated = { ...current, ...style };
    this.styles.set(layerId, updated);
  }

  /** 删除图层样式 */
  removeStyle(layerId: string): void {
    this.styles.delete(layerId);
  }

  /** 清空所有样式 */
  clearAllStyles(): void {
    this.styles.clear();
  }

  /** 从 GeoJSON 中提取嵌入的样式 */
  extractStyleFromGeoJSON(geojson: any): LayerStyle | null {
    // 检查顶层 _style 字段
    if (geojson._style && typeof geojson._style === 'object') {
      return this.validateStyle(geojson._style);
    }

    // 检查第一个 Feature 的 properties._style
    if (geojson.features && geojson.features.length > 0) {
      const firstFeature = geojson.features[0];
      if (firstFeature.properties && firstFeature.properties._style) {
        return this.validateStyle(firstFeature.properties._style);
      }
    }

    return null;
  }

  /** 将样式嵌入到 GeoJSON */
  embedStyleToGeoJSON(
    geojson: GeoJSONFeatureCollection,
    style: LayerStyle
  ): GeoJSONFeatureCollection {
    // 在顶层添加 _style 字段
    const result = {
      ...geojson,
      _style: style,
    } as any;

    return result;
  }

  /** 从 GeoJSON 中移除样式字段 */
  removeStyleFromGeoJSON(
    geojson: GeoJSONFeatureCollection
  ): GeoJSONFeatureCollection {
    const result = { ...geojson } as any;
    delete result._style;

    // 移除每个 Feature 的 properties._style
    if (result.features) {
      result.features = result.features.map((feature: any) => {
        if (feature.properties && feature.properties._style) {
          const { _style, ...restProps } = feature.properties;
          return { ...feature, properties: restProps };
        }
        return feature;
      });
    }

    return result;
  }

  /** 保存样式到 localStorage */
  saveToLocalStorage(): void {
    try {
      const data: Record<string, LayerStyle> = {};
      this.styles.forEach((style, layerId) => {
        data[layerId] = style;
      });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn('保存样式到 localStorage 失败:', err);
    }
  }

  /** 从 localStorage 加载样式 */
  loadFromLocalStorage(): void {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data) as Record<string, LayerStyle>;
        this.styles.clear();
        for (const [layerId, style] of Object.entries(parsed)) {
          const validated = this.validateStyle(style);
          if (validated) {
            this.styles.set(layerId, validated);
          }
        }
      }
    } catch (err) {
      console.warn('从 localStorage 加载样式失败:', err);
    }
  }

  /** 验证并修正样式对象 */
  private validateStyle(style: any): LayerStyle | null {
    if (!style || typeof style !== 'object') return null;

    return {
      fillColor: this.validateColor(style.fillColor) || DEFAULT_LAYER_STYLE.fillColor,
      fillOpacity: this.validateOpacity(style.fillOpacity) ?? DEFAULT_LAYER_STYLE.fillOpacity,
      strokeColor: this.validateColor(style.strokeColor) || DEFAULT_LAYER_STYLE.strokeColor,
      strokeWidth: this.validateNumber(style.strokeWidth, 0, 20) ?? DEFAULT_LAYER_STYLE.strokeWidth,
      strokeOpacity: this.validateOpacity(style.strokeOpacity) ?? DEFAULT_LAYER_STYLE.strokeOpacity,
      pointColor: this.validateColor(style.pointColor) || DEFAULT_LAYER_STYLE.pointColor,
      pointRadius: this.validateNumber(style.pointRadius, 1, 50) ?? DEFAULT_LAYER_STYLE.pointRadius,
    };
  }

  /** 验证颜色值（必须是 #RRGGBB 格式） */
  private validateColor(value: any): string | null {
    if (typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value)) {
      return value;
    }
    return null;
  }

  /** 验证透明度（0-1 之间） */
  private validateOpacity(value: any): number | null {
    if (typeof value === 'number' && value >= 0 && value <= 1) {
      return value;
    }
    return null;
  }

  /** 验证数值（在指定范围内） */
  private validateNumber(value: any, min: number, max: number): number | null {
    if (typeof value === 'number' && value >= min && value <= max) {
      return value;
    }
    return null;
  }

  /** 重置图层样式为默认 */
  resetToDefault(layerId: string): void {
    this.styles.set(layerId, { ...DEFAULT_LAYER_STYLE });
  }

  /** 获取所有样式（用于调试） */
  getAllStyles(): Record<string, LayerStyle> {
    const result: Record<string, LayerStyle> = {};
    this.styles.forEach((style, layerId) => {
      result[layerId] = style;
    });
    return result;
  }
}
