import type { GeoLayer, GeoJSONFeatureCollection, LAYER_COLORS } from './types';

/**
 * 图层管理器
 * 负责管理多个 GeoJSON 图层的增删改查
 */
export class LayerManager {
  private layers: GeoLayer[] = [];
  private activeLayerId: string | null = null;
  private nextId = 1;
  private colorIndex = 0;

  /** 颜色调色板 */
  private colors = [
    '#4f8cff', '#36cfcf', '#ff6b6b', '#ffc107', '#52c41a',
    '#9c27b0', '#ff9800', '#e91e63', '#00bcd4', '#795548',
  ];

  /** 获取所有图层 */
  getLayers(): GeoLayer[] {
    return [...this.layers];
  }

  /** 获取指定图层 */
  getLayer(id: string): GeoLayer | undefined {
    return this.layers.find((l) => l.id === id);
  }

  /** 获取当前激活的图层 */
  getActiveLayer(): GeoLayer | undefined {
    return this.activeLayerId ? this.getLayer(this.activeLayerId) : undefined;
  }

  /** 获取激活图层 ID */
  getActiveLayerId(): string | null {
    return this.activeLayerId;
  }

  /** 添加图层（可指定 ID） */
  addLayer(name: string, data: GeoJSONFeatureCollection, color?: string, customId?: string): GeoLayer {
    const id = customId || `layer-${this.nextId++}`;
    if (!customId) this.nextId; // customId 时不递增
    const layerColor = color || this.colors[this.colorIndex % this.colors.length];
    this.colorIndex++;

    const layer: GeoLayer = {
      id,
      name: name || `Layer ${this.layers.length + 1}`,
      data,
      visible: true,
      color: layerColor,
    };

    this.layers.push(layer);

    // 如果是第一个图层，自动激活
    if (this.layers.length === 1) {
      this.activeLayerId = id;
    }

    return layer;
  }

  /** 移除图层 */
  removeLayer(id: string): GeoLayer | undefined {
    const index = this.layers.findIndex((l) => l.id === id);
    if (index === -1) return undefined;

    const [removed] = this.layers.splice(index, 1);

    // 如果移除的是激活图层，切换到其他图层
    if (this.activeLayerId === id) {
      this.activeLayerId = this.layers.length > 0 ? this.layers[0].id : null;
    }

    return removed;
  }

  /** 切换图层可见性 */
  toggleVisibility(id: string): boolean | undefined {
    const layer = this.getLayer(id);
    if (!layer) return undefined;
    layer.visible = !layer.visible;
    return layer.visible;
  }

  /** 设置图层可见性 */
  setVisibility(id: string, visible: boolean): void {
    const layer = this.getLayer(id);
    if (layer) layer.visible = visible;
  }

  /** 设置激活图层 */
  setActiveLayer(id: string): void {
    if (this.getLayer(id)) {
      this.activeLayerId = id;
    }
  }

  /** 重命名图层 */
  renameLayer(id: string, name: string): void {
    const layer = this.getLayer(id);
    if (layer) layer.name = name;
  }

  /** 更新图层数据 */
  updateLayerData(id: string, data: GeoJSONFeatureCollection): void {
    const layer = this.getLayer(id);
    if (layer) layer.data = data;
  }

  /** 设置简化数据 */
  setSimplifiedData(id: string, data: GeoJSONFeatureCollection | undefined, ratio: number): void {
    const layer = this.getLayer(id);
    if (layer) {
      layer.simplifiedData = data;
      layer.simplifyRatio = ratio;
    }
  }

  /** 清空简化数据 */
  clearSimplifiedData(id: string): void {
    const layer = this.getLayer(id);
    if (layer) {
      layer.simplifiedData = undefined;
      layer.simplifyRatio = undefined;
    }
  }

  /** 移动图层顺序 */
  moveLayer(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.layers.length) return;
    if (toIndex < 0 || toIndex >= this.layers.length) return;
    const [moved] = this.layers.splice(fromIndex, 1);
    this.layers.splice(toIndex, 0, moved);
  }

  /** 获取图层要素数量 */
  getLayerFeatureCount(id: string): number {
    const layer = this.getLayer(id);
    return layer ? layer.data.features.length : 0;
  }

  /** 获取所有图层总要素数 */
  getTotalFeatureCount(): number {
    return this.layers.reduce((sum, l) => sum + l.data.features.length, 0);
  }

  /** 清空所有图层 */
  clearAll(): GeoLayer[] {
    const removed = [...this.layers];
    this.layers = [];
    this.activeLayerId = null;
    return removed;
  }

  /** 图层数量 */
  get count(): number {
    return this.layers.length;
  }
}
