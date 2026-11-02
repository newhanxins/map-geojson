import type { GeoJSONFeatureCollection, GeoLayer, SimplifyAlgorithm, SelectedFeature } from './types';
import { loadFromFile, loadFromUrl, loadFromText, loadFromFiles } from './geo-loader';
import { GeoRenderer } from './geo-renderer';
import { LayerManager } from './layer-manager';
import { FeatureInspector, findFeatureIndex } from './feature-inspector';
import { simplify, ratioToTolerance } from './geo-simplify';
import { exportLayer, exportAllLayers, exportTopoJSON, copyToClipboard } from './exporter';
import { DrillDownManager, type BreadcrumbNode, type DrillLevel } from './drill-down';
import { ENABLE_DRILL_DOWN } from '../config';
import { toast } from '../ui/toast';
import { DropZone } from '../ui/drop-zone';
import { Sidebar } from '../ui/sidebar';
import { Toolbar } from '../ui/toolbar';
import { PropertiesPanel } from '../ui/properties-panel';

/**
 * 应用主控制器
 * 协调所有模块和 UI 的交互
 */
export class App {
  private renderer!: GeoRenderer;
  private layerManager: LayerManager;
  private inspector!: FeatureInspector;
  private sidebar!: Sidebar;
  private toolbar!: Toolbar;
  private propertiesPanel!: PropertiesPanel;
  private dropZone!: DropZone;
  private drillDown?: DrillDownManager;

  // 下钻专用图层 ID
  private drillLayerId = '__drill_down__';
  private breadcrumbEl: HTMLElement | null = null;

  // 简化状态
  private simplifyActive = false;
  private simplifyAlgorithm: SimplifyAlgorithm = 'douglas-peucker';
  private simplifyRatio = 0.5;

  constructor() {
    this.layerManager = new LayerManager();
  }

  /** 初始化应用 */
  async init(): Promise<void> {
    // 初始化地图渲染器
    this.renderer = new GeoRenderer('map');
    await this.renderer.ready();

    // 初始化 UI 组件
    this.inspector = new FeatureInspector('panelContent');

    this.sidebar = new Sidebar('sidebar', {
      onToggleVisibility: (id) => this.handleToggleVisibility(id),
      onSelectLayer: (id) => this.handleSelectLayer(id),
      onRemoveLayer: (id) => this.handleRemoveLayer(id),
      onFitToLayer: (id) => this.handleFitToLayer(id),
      onReorderLayer: (from, to) => this.handleReorderLayer(from, to),
      onRenameLayer: (id, name) => this.handleRenameLayer(id, name),
    });

    this.toolbar = new Toolbar('toolbar', {
      onImportFile: () => this.handleImportFile(),
      onImportUrl: (url) => this.handleImportUrl(url),
      onImportPaste: (text) => this.handleImportPaste(text),
      onLoadSample: () => this.handleLoadSample(),
      onExportGeoJSON: () => this.handleExportGeoJSON(),
      onExportTopoJSON: () => this.handleExportTopoJSON(),
      onCopyJSON: () => this.handleCopyJSON(),
      onToggleSimplify: () => this.handleToggleSimplify(),
      onFitAll: () => this.handleFitAll(),
      onClearAll: () => this.handleClearAll(),
    });

    this.propertiesPanel = new PropertiesPanel('rightPanel', 'propertiesContent', 'propertiesContent');

    this.dropZone = new DropZone('dropOverlay', (files) => this.handleFilesDropped(files));

    // 初始化下钻管理器（根据配置决定是否启用）
    if (ENABLE_DRILL_DOWN) {
      this.drillDown = new DrillDownManager({
        onDrillDown: (data, name, level) => this.handleDrillDown(data, name, level),
        onDrillUp: (data) => this.handleDrillUp(data),
        onBreadcrumbChange: (path) => this.renderBreadcrumb(path),
      });
      this.addBreadcrumbUI();
    }

    // 绑定地图点击事件
    this.setupMapClickHandler();

    // 绑定文件输入
    this.setupFileInput();

    // 初始渲染
    this.refreshUI();

    // 自动加载全国下钻数据
    if (this.drillDown) {
      this.drillDown.init().catch(() => {
        console.warn('下钻数据加载失败，下钻功能不可用');
      });
    }

    console.log('GeoJSON Viewer initialized', ENABLE_DRILL_DOWN ? '(下钻: ON)' : '(下钻: OFF)');
  }

  /** 设置地图点击事件处理（含下钻） */
  private setupMapClickHandler(): void {
    const map = this.renderer.getMap();

    map.on('click', async (e) => {
      // 收集所有可查询的图层（用户图层 + 下钻图层）
      const layerIds = this.layerManager.getLayers()
        .filter((l) => l.visible)
        .map((l) => l.id);

      // 下钻图层也参与查询
      if (this.layerManager.getLayer(this.drillLayerId)) {
        layerIds.push(this.drillLayerId);
      }

      if (layerIds.length === 0) return;

      const results = this.renderer.queryFeaturesAtPoint(e.point, layerIds);

      if (results.length > 0) {
        const hit = results[0];
        const feature = hit.feature as unknown as import('./types').GeoJSONFeature;

        // 1. 先尝试下钻（如果启用且要素有 adcode 属性）
        if (this.drillDown) {
          const drilled = await this.drillDown.tryDrillDown(feature);
          if (drilled) return; // 下钻成功，不执行普通选中
        }

        // 2. 非行政区划要素，执行普通选中
        const layer = this.layerManager.getLayer(hit.layerId);
        if (!layer) return;

        const data = layer.simplifiedData || layer.data;
        const featureIndex = findFeatureIndex(data.features, hit.feature);

        const selected: SelectedFeature = {
          layerId: hit.layerId,
          featureIndex: featureIndex >= 0 ? featureIndex : 0,
          feature,
        };

        // 高亮要素
        this.renderer.highlightFeature(feature as unknown as GeoJSON.Feature);

        // 显示属性
        this.propertiesPanel.showFeature(selected, layer.name);
      } else {
        // 点击空白区域取消选中
        this.renderer.clearHighlight();
        this.propertiesPanel.clear();
      }
    });
  }

  /** 设置文件输入事件 */
  private setupFileInput(): void {
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    if (fileInput) {
      fileInput.addEventListener('change', async (e) => {
        const files = (e.target as HTMLInputElement).files;
        if (files && files.length > 0) {
          await this.handleFilesDropped(files);
        }
        fileInput.value = ''; // 重置
      });
    }
  }

  // ===================== 事件处理 =====================

  /** 导入文件 */
  private handleImportFile(): void {
    const fileInput = document.getElementById('fileInput') as HTMLInputElement;
    fileInput?.click();
  }

  /** 从 URL 导入 */
  private async handleImportUrl(url: string): Promise<void> {
    toast.info('正在从 URL 加载...');
    try {
      const data = await loadFromUrl(url);
      const name = url.split('/').pop()?.split('?')[0] || 'remote';
      this.addAndRenderLayer(name, data);
      toast.success(`已加载 ${data.features.length} 个要素`);
    } catch (err) {
      toast.error(`加载失败: ${(err as Error).message}`);
    }
  }

  /** 粘贴导入 */
  private handleImportPaste(text: string): void {
    try {
      const data = loadFromText(text);
      this.addAndRenderLayer('pasted-data', data);
      toast.success(`已从剪贴板加载 ${data.features.length} 个要素`);
    } catch (err) {
      toast.error(`解析失败: ${(err as Error).message}`);
    }
  }

  /** 文件拖拽 */
  private async handleFilesDropped(files: FileList): Promise<void> {
    toast.info(`正在加载 ${files.length} 个文件...`);
    const results = await loadFromFiles(files);
    // 显示加载成功的文件
    for (const { name, data } of results) {
      this.addAndRenderLayer(name, data);
    }
    if (results.length > 0) {
      const totalFeatures = results.reduce((sum, r) => sum + r.data.features.length, 0);
      toast.success(`已加载 ${results.length} 个文件，共 ${totalFeatures} 个要素`);
    }
    // 显示加载失败的文件
    if (results.length < files.length) {
      const failedCount = files.length - results.length;
      toast.warning(`${failedCount} 个文件加载失败，请检查文件格式`);
    }
  }

  /** 加载示例数据（内嵌中国主要城市数据，无需网络） */
  private handleLoadSample(): void {
    const sampleData: GeoJSONFeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { name: '北京', population: 2189, type: '直辖市' }, geometry: { type: 'Point', coordinates: [116.40, 39.90] } },
        { type: 'Feature', properties: { name: '上海', population: 2487, type: '直辖市' }, geometry: { type: 'Point', coordinates: [121.47, 31.23] } },
        { type: 'Feature', properties: { name: '广州', population: 1868, type: '省会' }, geometry: { type: 'Point', coordinates: [113.26, 23.13] } },
        { type: 'Feature', properties: { name: '深圳', population: 1756, type: '计划单列市' }, geometry: { type: 'Point', coordinates: [114.07, 22.54] } },
        { type: 'Feature', properties: { name: '成都', population: 2094, type: '省会' }, geometry: { type: 'Point', coordinates: [104.07, 30.67] } },
        { type: 'Feature', properties: { name: '重庆', population: 3205, type: '直辖市' }, geometry: { type: 'Point', coordinates: [106.55, 29.56] } },
        { type: 'Feature', properties: { name: '武汉', population: 1233, type: '省会' }, geometry: { type: 'Point', coordinates: [114.30, 30.59] } },
        { type: 'Feature', properties: { name: '杭州', population: 1237, type: '省会' }, geometry: { type: 'Point', coordinates: [120.15, 30.29] } },
        { type: 'Feature', properties: { name: '南京', population: 942, type: '省会' }, geometry: { type: 'Point', coordinates: [118.78, 32.06] } },
        { type: 'Feature', properties: { name: '西安', population: 1295, type: '省会' }, geometry: { type: 'Point', coordinates: [108.94, 34.26] } },
        { type: 'Feature', properties: { name: '长沙', population: 1005, type: '省会' }, geometry: { type: 'Point', coordinates: [112.97, 28.23] } },
        { type: 'Feature', properties: { name: '天津', population: 1387, type: '直辖市' }, geometry: { type: 'Point', coordinates: [117.20, 39.13] } },
        { type: 'Feature', properties: { name: '苏州', population: 1275, type: '地级市' }, geometry: { type: 'Point', coordinates: [120.62, 31.30] } },
        { type: 'Feature', properties: { name: '郑州', population: 1260, type: '省会' }, geometry: { type: 'Point', coordinates: [113.65, 34.75] } },
        { type: 'Feature', properties: { name: '青岛', population: 1007, type: '计划单列市' }, geometry: { type: 'Point', coordinates: [120.38, 36.07] } },
        // 中国大致轮廓多边形
        {
          type: 'Feature',
          properties: { name: '中国', area: '约 960 万 km²' },
          geometry: {
            type: 'Polygon',
            coordinates: [[
              [73.5, 39.4], [80.5, 44.2], [87.3, 49.2], [97.4, 48.0],
              [108.0, 48.5], [116.7, 49.8], [121.5, 47.3], [126.0, 45.5],
              [131.0, 42.5], [130.0, 40.8], [124.4, 40.0], [122.3, 37.5],
              [121.6, 31.3], [122.1, 29.0], [120.5, 26.8], [117.0, 23.6],
              [114.0, 22.5], [110.0, 21.5], [109.0, 18.5], [108.5, 21.8],
              [106.5, 22.5], [102.0, 22.5], [99.0, 21.5], [97.5, 24.0],
              [98.0, 27.5], [96.0, 29.5], [92.0, 27.5], [88.0, 27.8],
              [85.0, 28.5], [81.0, 30.5], [78.5, 32.5], [76.0, 34.5],
              [73.5, 37.0], [73.5, 39.4]
            ]]
          }
        }
      ]
    };
    this.addAndRenderLayer('中国主要城市', sampleData);
    toast.success(`已加载示例数据: 15 个城市 + 中国轮廓`);
  }

  /** 导出 GeoJSON */
  private handleExportGeoJSON(): void {
    const activeLayer = this.layerManager.getActiveLayer();
    if (activeLayer) {
      exportLayer(activeLayer, this.simplifyActive);
      toast.success('GeoJSON 已导出');
    } else {
      toast.warning('没有可导出的图层');
    }
  }

  /** 导出 TopoJSON */
  private handleExportTopoJSON(): void {
    const activeLayer = this.layerManager.getActiveLayer();
    if (activeLayer) {
      const data = activeLayer.simplifiedData || activeLayer.data;
      exportTopoJSON(data, activeLayer.name);
      toast.success('TopoJSON 已导出');
    } else {
      toast.warning('没有可导出的图层');
    }
  }

  /** 复制 JSON */
  private async handleCopyJSON(): Promise<void> {
    const activeLayer = this.layerManager.getActiveLayer();
    if (activeLayer) {
      const data = activeLayer.simplifiedData || activeLayer.data;
      await copyToClipboard(data);
      toast.success('JSON 已复制到剪贴板');
    } else {
      toast.warning('没有可复制的图层');
    }
  }

  /** 切换简化模式 */
  private handleToggleSimplify(): void {
    this.simplifyActive = !this.simplifyActive;
    const simplifyBar = document.getElementById('simplifyBar');

    if (this.simplifyActive) {
      this.renderSimplifyBar();
      if (simplifyBar) simplifyBar.style.display = 'flex';
      this.applySimplification();
      toast.info('已开启简化模式');
    } else {
      if (simplifyBar) simplifyBar.style.display = 'none';
      // 恢复原始数据
      for (const layer of this.layerManager.getLayers()) {
        this.layerManager.clearSimplifiedData(layer.id);
        this.renderer.updateLayerData(layer);
      }
      this.refreshUI();
      toast.info('已关闭简化模式');
    }
  }

  /** 渲染简化工具栏 */
  private renderSimplifyBar(): void {
    const bar = document.getElementById('simplifyBar');
    if (!bar) return;

    // 计算简化前后顶点数
    const { originalVertices, simplifiedVertices } = this.countVertices();

    bar.innerHTML = `
      <label>简化:</label>
      <div class="simplify-algo">
        <button class="${this.simplifyAlgorithm === 'douglas-peucker' ? 'active' : ''}" data-algo="douglas-peucker">Douglas-Peucker</button>
        <button class="${this.simplifyAlgorithm === 'visvalingam' ? 'active' : ''}" data-algo="visvalingam">Visvalingam</button>
      </div>
      <input type="range" min="0" max="100" value="${Math.round(this.simplifyRatio * 100)}" id="simplifySlider" />
      <span class="simplify-value" id="simplifyValueLabel">${Math.round(this.simplifyRatio * 100)}%</span>
      <span class="simplify-vertex-info" style="font-size:11px;color:#5c6370;white-space:nowrap;">
        ${simplifiedVertices > 0 ? `${simplifiedVertices.toLocaleString()} / ${originalVertices.toLocaleString()} 个顶点` : `${originalVertices.toLocaleString()} 个顶点`}
        ${simplifiedVertices > 0 && originalVertices > 0 ? `（已减少 ${Math.round((1 - simplifiedVertices / originalVertices) * 100)}%）` : ''}
      </span>
      <button class="btn btn-sm" id="simplifyApply">应用</button>
    `;

    // 绑定事件
    bar.querySelectorAll('[data-algo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.simplifyAlgorithm = (btn as HTMLElement).dataset.algo as SimplifyAlgorithm;
        bar.querySelectorAll('[data-algo]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.applySimplification();
      });
    });

    const slider = document.getElementById('simplifySlider') as HTMLInputElement;
    const valueLabel = document.getElementById('simplifyValueLabel');
    slider?.addEventListener('input', () => {
      this.simplifyRatio = parseInt(slider.value) / 100;
      if (valueLabel) valueLabel.textContent = `${slider.value}%`;
    });

    document.getElementById('simplifyApply')?.addEventListener('click', () => {
      this.applySimplification();
    });
  }

  /** 应用简化 */
  private applySimplification(): void {
    for (const layer of this.layerManager.getLayers()) {
      if (this.simplifyRatio > 0) {
        const tolerance = ratioToTolerance(this.simplifyRatio, layer.data);
        const simplified = simplify(layer.data, tolerance, this.simplifyAlgorithm);
        this.layerManager.setSimplifiedData(layer.id, simplified, this.simplifyRatio);
      } else {
        this.layerManager.clearSimplifiedData(layer.id);
      }
      this.renderer.updateLayerData(layer);
    }
    this.refreshUI();
  }

  /** 适配全部图层 */
  private handleFitAll(): void {
    this.renderer.fitToAll(this.layerManager.getLayers());
  }

  /** 清除所有图层 */
  private handleClearAll(): void {
    const layers = this.layerManager.getLayers();
    for (const layer of layers) {
      this.renderer.removeLayer(layer.id);
    }
    this.layerManager.clearAll();
    this.renderer.clearHighlight();
    this.propertiesPanel.clear();
    this.refreshUI();
    toast.info('已清除所有图层');
  }

  /** 切换图层可见性 */
  private handleToggleVisibility(layerId: string): void {
    const visible = this.layerManager.toggleVisibility(layerId);
    if (visible !== undefined) {
      this.renderer.toggleLayerVisibility(layerId, visible);
    }
    this.refreshUI();
  }

  /** 选择图层 */
  private handleSelectLayer(layerId: string): void {
    this.layerManager.setActiveLayer(layerId);
    this.refreshUI();
  }

  /** 移除图层 */
  private handleRemoveLayer(layerId: string): void {
    this.renderer.removeLayer(layerId);
    this.layerManager.removeLayer(layerId);
    this.refreshUI();
    toast.info('图层已删除');
  }

  /** 缩放到图层 */
  private handleFitToLayer(layerId: string): void {
    const layer = this.layerManager.getLayer(layerId);
    if (layer) {
      this.renderer.fitToLayer(layer);
    }
  }

  /** 重排序图层 */
  private handleReorderLayer(fromIndex: number, toIndex: number): void {
    this.layerManager.moveLayer(fromIndex, toIndex);
    this.refreshUI();
  }

  /** 重命名图层 */
  private handleRenameLayer(layerId: string, name: string): void {
    this.layerManager.renameLayer(layerId, name);
    this.refreshUI();
  }

  // ===================== 辅助方法 =====================

  /** 添加并渲染图层 */
  private addAndRenderLayer(name: string, data: GeoJSONFeatureCollection): void {
    const layer = this.layerManager.addLayer(name, data);
    this.renderer.addLayer(layer);
    this.renderer.fitToLayer(layer);
    this.refreshUI();
  }

  /** 刷新所有 UI */
  private refreshUI(): void {
    const layers = this.layerManager.getLayers();
    const activeId = this.layerManager.getActiveLayerId();
    this.sidebar.render(layers, activeId);
    // 如果简化模式激活，更新顶点计数
    if (this.simplifyActive) {
      const vertexInfo = document.querySelector('.simplify-vertex-info');
      if (vertexInfo) {
        const { originalVertices, simplifiedVertices } = this.countVertices();
        vertexInfo.innerHTML =
          `${simplifiedVertices.toLocaleString()} / ${originalVertices.toLocaleString()} 个顶点` +
          (simplifiedVertices > 0 && originalVertices > 0
            ? `（已减少 ${Math.round((1 - simplifiedVertices / originalVertices) * 100)}%）`
            : '');
      }
    }
  }

  /** 计算所有图层的顶点数 */
  private countVertices(): { originalVertices: number; simplifiedVertices: number } {
    let originalVertices = 0;
    let simplifiedVertices = 0;

    for (const layer of this.layerManager.getLayers()) {
      originalVertices += countCoordsInCollection(layer.data);
      if (layer.simplifiedData) {
        simplifiedVertices += countCoordsInCollection(layer.simplifiedData);
      }
    }

    return { originalVertices, simplifiedVertices };
  }

  // ===================== 下钻功能 =====================

  /** 添加面包屑导航 UI */
  private addBreadcrumbUI(): void {
    const el = document.createElement('div');
    el.className = 'drill-breadcrumb';
    el.style.cssText = `
      position: absolute;
      top: 44px;
      left: 10px;
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      pointer-events: auto;
    `;
    const mapContainer = this.renderer.getMap().getContainer();
    mapContainer.appendChild(el);
    this.breadcrumbEl = el;
  }

  /** 渲染面包屑导航 */
  private renderBreadcrumb(path: BreadcrumbNode[]): void {
    if (!this.breadcrumbEl) return;

    if (path.length <= 1) {
      this.breadcrumbEl.style.display = 'none';
      return;
    }

    this.breadcrumbEl.style.display = 'flex';
    let html = '';

    for (let i = 0; i < path.length; i++) {
      const node = path[i];
      const isLast = i === path.length - 1;

      if (i > 0) {
        html += `<span style="color:#9ca3af;margin:0 2px;">›</span>`;
      }

      if (isLast) {
        html += `<span style="
          padding: 3px 8px;
          background: rgba(79,140,255,0.9);
          color: #fff;
          border-radius: 4px;
          font-weight: 600;
          white-space: nowrap;
        ">${node.name}</span>`;
      } else {
        html += `<button class="breadcrumb-btn" data-index="${i}" style="
          padding: 3px 8px;
          background: rgba(0,0,0,0.45);
          color: #e0e8f0;
          border: 1px solid rgba(255,255,255,0.15);
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-family: inherit;
          white-space: nowrap;
          backdrop-filter: blur(4px);
        ">${node.name}</button>`;
      }
    }

    this.breadcrumbEl.innerHTML = html;

    // 绑定上钻事件
    this.breadcrumbEl.querySelectorAll('.breadcrumb-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = parseInt((btn as HTMLElement).dataset.index || '0');
        this.drillDown.drillUp(idx);
      });
      // 悬停效果
      btn.addEventListener('mouseenter', () => {
        (btn as HTMLElement).style.background = 'rgba(79,140,255,0.7)';
      });
      btn.addEventListener('mouseleave', () => {
        (btn as HTMLElement).style.background = 'rgba(0,0,0,0.45)';
      });
    });
  }

  /** 处理下钻事件 */
  private handleDrillDown(data: GeoJSONFeatureCollection, name: string, _level: DrillLevel): void {
    // 移除旧的下钻图层
    this.removeDrillLayer();

    // 添加新的下钻图层（指定 ID）
    const layer = this.layerManager.addLayer(name, data, '#4f8cff', this.drillLayerId);
    this.renderer.addLayer(layer);
    this.renderer.fitToLayer(layer);
    this.refreshUI();

    toast.info(`已下钻到: ${name}`);
  }

  /** 处理上钻事件 */
  private handleDrillUp(data: GeoJSONFeatureCollection | null): void {
    // 移除旧的下钻图层
    this.removeDrillLayer();

    if (data) {
      const name = this.drillDown.getBreadcrumb().slice(-1)[0]?.name || '中国';
      const layer = this.layerManager.addLayer(name, data, '#4f8cff', this.drillLayerId);
      this.renderer.addLayer(layer);
      this.renderer.fitToLayer(layer);
    }

    this.refreshUI();
  }

  /** 移除下钻图层 */
  private removeDrillLayer(): void {
    if (this.layerManager.getLayer(this.drillLayerId)) {
      this.renderer.removeLayer(this.drillLayerId);
      this.layerManager.removeLayer(this.drillLayerId);
    }
  }
}

/** 计算 FeatureCollection 中所有坐标点的数量 */
function countCoordsInCollection(data: GeoJSONFeatureCollection): number {
  let count = 0;
  for (const feature of data.features) {
    count += countCoordsInGeometry(feature.geometry);
  }
  return count;
}

function countCoordsInGeometry(geometry: GeoJSONFeatureCollection['features'][0]['geometry']): number {
  if (!geometry) return 0;
  if ('coordinates' in geometry) {
    return countCoordsRecursive(geometry.coordinates);
  }
  if (geometry.type === 'GeometryCollection' && 'geometries' in geometry) {
    return geometry.geometries.reduce((sum, g) => sum + countCoordsInGeometry(g as any), 0);
  }
  return 0;
}

function countCoordsRecursive(coords: unknown): number {
  if (typeof coords[0] === 'number') return 1;
  if (Array.isArray(coords)) {
    return coords.reduce((sum, c) => sum + countCoordsRecursive(c), 0);
  }
  return 0;
}
