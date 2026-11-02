import type { GeoJSONFeatureCollection, GeoLayer, SimplifyAlgorithm, SelectedFeature, LayerStyle } from './types';
import { loadFromFile, loadFromUrl, loadFromText, loadFromFiles } from './geo-loader';
import { GeoRenderer } from './geo-renderer';
import { LayerManager } from './layer-manager';
import { FeatureInspector, findFeatureIndex } from './feature-inspector';
import { simplify, ratioToTolerance } from './geo-simplify';
import { exportLayer, exportAllLayers, exportTopoJSON } from './exporter';
import { DrillDownManager, type BreadcrumbNode, type DrillLevel } from './drill-down';
import { StyleManager } from './style-manager';
import { EditManager } from './edit-manager';
import { ContextMenu } from '../ui/context-menu';
import { ENABLE_DRILL_DOWN } from '../config';
import { toast } from '../ui/toast';
import { DropZone } from '../ui/drop-zone';
import { Sidebar } from '../ui/sidebar';
import { Toolbar } from '../ui/toolbar';

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
  private dropZone!: DropZone;
  private drillDown?: DrillDownManager;
  private styleManager!: StyleManager;
  private editManager!: EditManager;
  private contextMenu!: ContextMenu;

  // 下钻专用图层 ID
  private drillLayerId = '__drill_down__';
  private breadcrumbEl: HTMLElement | null = null;

  // 编辑状态
  private isEditMode = false;
  private selectedFeature: SelectedFeature | null = null;

  // 简化状态
  private simplifyActive = false;
  private simplifyAlgorithm: SimplifyAlgorithm = 'douglas-peucker';
  private simplifyRatio = 0.5;

  constructor() {
    this.layerManager = new LayerManager();
  }

  /** 初始化应用 */
  async init(): Promise<void> {
    // 初始化样式管理器
    this.styleManager = new StyleManager();

    // 初始化编辑管理器
    this.editManager = new EditManager();

    // 初始化地图渲染器
    this.renderer = new GeoRenderer('map');
    await this.renderer.ready();

    // 初始化右键菜单
    this.contextMenu = new ContextMenu('app', (action, data) => {
      this.handleContextMenuAction(action, data);
    });

    // 初始化 UI 组件
    this.inspector = new FeatureInspector('panelContent');

    this.sidebar = new Sidebar('sidebar', {
      onToggleVisibility: (id) => this.handleToggleVisibility(id),
      onSelectLayer: (id) => this.handleSelectLayer(id),
      onRemoveLayer: (id) => this.handleRemoveLayer(id),
      onFitToLayer: (id) => this.handleFitToLayer(id),
      onReorderLayer: (from, to) => this.handleReorderLayer(from, to),
      onRenameLayer: (id, name) => this.handleRenameLayer(id, name),
      onStyleChange: (id, style) => this.handleStyleChange(id, style),
      onResetStyle: (id) => this.handleResetStyle(id),
    });

    this.toolbar = new Toolbar('toolbar', {
      onImportFile: () => this.handleImportFile(),
      onImportUrl: (url) => this.handleImportUrl(url),
      onImportPaste: (text) => this.handleImportPaste(text),
      onLoadSample: () => this.handleLoadSample(),
      onExportGeoJSON: () => this.handleExportGeoJSON(),
      onExportTopoJSON: () => this.handleExportTopoJSON(),
      onExportJSON: () => this.handleExportJSON(),
      onToggleSimplify: () => this.handleToggleSimplify(),
      onFitAll: () => this.handleFitAll(),
      onClearAll: () => this.handleClearAll(),
    });

    // 绑定右侧编辑工具栏事件
    this.setupEditToolbar();

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

    // 绑定右键菜单
    this.setupContextMenu();

    // 绑定编辑模式悬停效果
    this.setupEditHoverHandler();

    // 绑定文件输入
    this.setupFileInput();

    // 绑定快捷键
    this.setupKeyboardShortcuts();

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

  /** 设置右侧编辑工具栏事件 */
  private setupEditToolbar(): void {
    document.getElementById('btnEditMode')?.addEventListener('click', () => {
      this.handleToggleEditMode();
    });

    document.getElementById('btnSaveEdit')?.addEventListener('click', () => {
      this.showSaveModal();
    });

    document.getElementById('btnUndo')?.addEventListener('click', () => {
      this.handleUndo();
    });

    document.getElementById('btnRedo')?.addEventListener('click', () => {
      this.handleRedo();
    });

    document.getElementById('btnDeleteSelected')?.addEventListener('click', () => {
      this.handleDeleteSelected();
    });
  }

  /** 显示保存弹窗 */
  private showSaveModal(): void {
    const activeLayer = this.layerManager.getActiveLayer();
    if (!activeLayer) {
      toast.warning('请先选择一个图层');
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal export-modal">
        <h2>保存编辑数据</h2>
        <p style="color:var(--text-muted);font-size:12px;margin-bottom:16px;">选择导出格式保存当前图层: ${activeLayer.name}</p>
        <div class="export-options">
          <div class="export-option" data-action="save-geojson">
            <div class="export-option-icon">&#128196;</div>
            <div class="export-option-content">
              <div class="export-option-title">GeoJSON 文件</div>
              <div class="export-option-desc">下载为标准 .geojson 文件</div>
            </div>
          </div>
          <div class="export-option" data-action="save-topojson">
            <div class="export-option-icon">&#128196;</div>
            <div class="export-option-content">
              <div class="export-option-title">TopoJSON 文件</div>
              <div class="export-option-desc">下载为压缩拓扑格式</div>
            </div>
          </div>
          <div class="export-option" data-action="save-json">
            <div class="export-option-icon">&#128196;</div>
            <div class="export-option-content">
              <div class="export-option-title">JSON 文件</div>
              <div class="export-option-desc">导出为 JSON 格式文件</div>
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="saveCancel">取消</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();

    overlay.querySelector('[data-action="save-geojson"]')?.addEventListener('click', () => {
      this.handleExportGeoJSON();
      close();
    });
    overlay.querySelector('[data-action="save-topojson"]')?.addEventListener('click', () => {
      this.handleExportTopoJSON();
      close();
    });
    overlay.querySelector('[data-action="save-json"]')?.addEventListener('click', () => {
      this.handleExportJSON();
      close();
    });

    document.getElementById('saveCancel')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
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

        // 编辑模式下的选中处理
        if (this.isEditMode) {
          // 如果正在编辑顶点且点击的是同一个要素，不重新选中
          const editingState = this.renderer.getEditingState();
          if (editingState.isEditing && editingState.layerId === hit.layerId) {
            // 已在编辑同一个要素，不干扰拖动/添加顶点
            return;
          }

          const layer = this.layerManager.getLayer(hit.layerId);
          if (!layer) return;

          const data = layer.simplifiedData || layer.data;
          const featureIndex = findFeatureIndex(data.features, hit.feature);
          const fullFeature = featureIndex >= 0 ? data.features[featureIndex] : feature;

          // 更新选中状态
          this.selectedFeature = {
            layerId: hit.layerId,
            featureIndex: featureIndex >= 0 ? featureIndex : 0,
            feature: fullFeature,
          };

          // 设置为活动图层
          this.layerManager.setActiveLayer(hit.layerId);

          // 高亮要素
          this.renderer.highlightFeature(fullFeature as unknown as GeoJSON.Feature);

          // 自动显示顶点标记
          this.renderer.startVertexEditing(
            hit.layerId,
            featureIndex >= 0 ? featureIndex : 0,
            fullFeature as unknown as GeoJSON.Feature,
            (lid, fidx, newGeometry) => {
              this.handleVertexUpdate(lid, fidx, newGeometry);
            },
            data as unknown as GeoJSON.FeatureCollection,
            (vertexIndex) => {
              this.handleVertexDelete(vertexIndex);
            }
          );

          // 更新工具栏状态
          this.updateEditToolbarState();
          this.refreshUI();
          return;
        }

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
        
        // 从原始数据中获取完整的要素（解决 MultiPolygon 只显示部分的问题）
        const fullFeature = featureIndex >= 0 
          ? data.features[featureIndex] 
          : feature;

        const selected: SelectedFeature = {
          layerId: hit.layerId,
          featureIndex: featureIndex >= 0 ? featureIndex : 0,
          feature: fullFeature,
        };

        // 高亮要素（使用完整的要素）
        this.renderer.highlightFeature(fullFeature as unknown as GeoJSON.Feature);

        // 显示属性到对应图层
        const propsHtml = this.generatePropertiesHtml(selected, layer.name);
        this.sidebar.updateLayerProperties(hit.layerId, propsHtml);
      } else {
        // 点击空白区域
        if (this.isEditMode) {
          // 如果刚刚添加了顶点，不停止编辑
          if (this.renderer.consumeVertexAddedFlag()) {
            return;
          }
          // 编辑模式下停止顶点编辑
          this.renderer.stopVertexEditing();
          this.selectedFeature = null;
          this.renderer.clearHighlight();
          this.updateEditToolbarState();
        } else {
          // 普通模式下取消选中
          this.renderer.clearHighlight();
          this.sidebar.clearAllProperties();
        }
      }
    });
  }

  /** 生成属性 HTML */
  private generatePropertiesHtml(feature: SelectedFeature | null, layerName?: string): string {
    if (!feature) {
      return `<p style="padding:12px;text-align:center;color:var(--text-muted);font-size:11px;">点击地图上的要素查看属性信息</p>`;
    }

    const props = feature.feature.properties || {};
    const entries = Object.entries(props);
    const geomType = feature.feature.geometry.type;
    
    // 获取要素名称（优先使用 name 属性）
    const featureName = props.name || props.NAME || props.title || `要素 #${feature.featureIndex + 1}`;
    const featureId = feature.feature.id !== undefined ? feature.feature.id : `#${feature.featureIndex + 1}`;

    let html = `
      <div class="feature-info-card">
        <!-- 要素头部摘要 -->
        <div class="feature-header">
          <div class="feature-header-left">
            <span class="feature-type-badge">${geomType}</span>
            <div class="feature-title">
              <div class="feature-name">${this.escapeHtml(String(featureName))}</div>
              <div class="feature-meta">
                ${layerName ? `<span>图层: ${this.escapeHtml(layerName)}</span>` : ''}
                <span>ID: ${featureId}</span>
              </div>
            </div>
          </div>
          <button class="feature-toggle-btn" onclick="this.parentElement.parentElement.classList.toggle('collapsed')">
            <span>▾</span>
          </button>
        </div>
        
        <!-- 可折叠的详细内容 -->
        <div class="feature-details">
    `;

    if (entries.length === 0) {
      html += `<p class="feature-no-props">无属性信息</p>`;
    } else {
      // 统计信息
      html += `
        <div class="feature-stats">
          <div class="feature-stat-item">
            <span class="stat-label">属性数</span>
            <span class="stat-value">${entries.length}</span>
          </div>
        </div>
      `;
      
      // 属性表格
      html += `
        <div class="feature-properties">
          <div class="properties-section-header" onclick="this.nextElementSibling.classList.toggle('collapsed')">
            <span>📋 属性列表</span>
            <span class="toggle-icon">▾</span>
          </div>
          <div class="properties-content">
            <table class="prop-table">
      `;

      // 显示前 10 个属性，其余的折叠
      const visibleEntries = entries.slice(0, 10);
      const hiddenEntries = entries.slice(10);

      for (const [key, value] of visibleEntries) {
        html += `
          <tr>
            <td class="prop-key">${this.escapeHtml(key)}</td>
            <td class="prop-value">${this.escapeHtml(String(value))}</td>
          </tr>
        `;
      }

      html += `</table>`;

      // 如果有更多属性，显示“展开更多”按钮
      if (hiddenEntries.length > 0) {
        html += `
          <div class="more-properties">
            <button class="show-more-btn" onclick="this.parentElement.classList.add('expanded')">
              显示更多 ${hiddenEntries.length} 个属性
            </button>
            <div class="hidden-properties collapsed">
              <table class="prop-table">
        `;
        
        for (const [key, value] of hiddenEntries) {
          html += `
            <tr>
              <td class="prop-key">${this.escapeHtml(key)}</td>
              <td class="prop-value">${this.escapeHtml(String(value))}</td>
            </tr>
          `;
        }
        
        html += `
              </table>
            </div>
          </div>
        `;
      }

      html += `</div></div>`;
    }

    html += `</div></div>`;
    return html;
  }

  /** HTML 转义 */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

  /** 设置快捷键 */
  private setupKeyboardShortcuts(): void {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      // 忽略输入框中的快捷键
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        return;
      }

      // Ctrl+Z - 撤销
      if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        this.handleUndo();
      }

      // Ctrl+Y 或 Ctrl+Shift+Z - 重做
      if (e.ctrlKey && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        this.handleRedo();
      }

      // Ctrl+S - 保存
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        this.handleSaveEdit();
      }

      // Delete 或 Backspace - 删除选中
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectedFeature) {
          e.preventDefault();
          this.handleDeleteSelected();
        }
      }

      // Escape - 停止编辑
      if (e.key === 'Escape') {
        if (this.renderer.getEditingState().isEditing) {
          e.preventDefault();
          this.renderer.stopVertexEditing();
          toast.info('已停止顶点编辑');
        }
      }
    });
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

  /** 导出 JSON 文件 */
  private handleExportJSON(): void {
    const activeLayer = this.layerManager.getActiveLayer();
    if (activeLayer) {
      const data = activeLayer.simplifiedData || activeLayer.data;
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeLayer.name}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('JSON 已导出');
    } else {
      toast.warning('没有可导出的图层');
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
    this.sidebar.clearAllProperties();
    this.refreshUI();
    toast.info('已清除所有图层');
  }

  // ==================== 编辑功能 ====================

  /** 切换编辑模式 */
  private handleToggleEditMode(): void {
    // 必须先选中图层才能进入编辑模式
    const activeLayer = this.layerManager.getActiveLayer();
    if (!activeLayer && !this.isEditMode) {
      toast.warning('请先在右侧选中一个图层，才能进入编辑模式');
      return;
    }

    this.isEditMode = !this.isEditMode;
    
    const btnEditMode = document.getElementById('btnEditMode');
    if (btnEditMode) {
      if (this.isEditMode) {
        btnEditMode.classList.add('active');
        toast.info('编辑模式已启用 - 点击地图上的要素进行编辑');
        // 启用编辑模式时设置地图光标
        this.renderer.setEditCursor(true);
      } else {
        btnEditMode.classList.remove('active');
        toast.info('编辑模式已禁用');
        // 退出编辑模式时恢复光标
        this.renderer.setEditCursor(false);
        // 停止顶点编辑
        this.renderer.stopVertexEditing();
        // 清除选中
        this.selectedFeature = null;
        this.renderer.clearHighlight();
      }
    }
    
    // 更新编辑按钮状态
    this.updateEditToolbarState();
    this.refreshUI();
  }

  /** 更新编辑工具栏按钮状态 */
  private updateEditToolbarState(): void {
    const btnSave = document.getElementById('btnSaveEdit') as HTMLButtonElement;
    const btnUndo = document.getElementById('btnUndo') as HTMLButtonElement;
    const btnRedo = document.getElementById('btnRedo') as HTMLButtonElement;
    const btnDelete = document.getElementById('btnDeleteSelected') as HTMLButtonElement;

    if (btnSave) btnSave.disabled = !this.isEditMode;
    if (btnUndo) btnUndo.disabled = !this.isEditMode;
    if (btnRedo) btnRedo.disabled = !this.isEditMode;
    if (btnDelete) btnDelete.disabled = !this.isEditMode || !this.selectedFeature;
  }

  /** 保存编辑 */
  private handleSaveEdit(): void {
    const activeLayer = this.layerManager.getActiveLayer();
    if (!activeLayer) {
      toast.warning('请先选择一个图层');
      return;
    }

    // 导出当前图层数据
    const data = activeLayer.simplifiedData || activeLayer.data;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeLayer.name}_edited.geojson`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast.success('编辑已保存');
  }

  /** 撤销 */
  private handleUndo(): void {
    const activeLayer = this.layerManager.getActiveLayer();
    if (!activeLayer) {
      toast.warning('请先选择一个图层');
      return;
    }

    const result = this.editManager.undo(activeLayer.id, activeLayer);
    if (result) {
      // 更新图层数据
      if (activeLayer.simplifiedData) {
        activeLayer.simplifiedData = result;
      } else {
        activeLayer.data = result;
      }
      
      // 重新渲染
      this.renderer.removeLayer(activeLayer.id);
      this.renderer.addLayer(activeLayer);
      this.refreshUI();
      
      toast.info('已撤销操作');
    } else {
      toast.info('没有可撤销的操作');
    }
  }

  /** 重做 */
  private handleRedo(): void {
    const activeLayer = this.layerManager.getActiveLayer();
    if (!activeLayer) {
      toast.warning('请先选择一个图层');
      return;
    }

    const redoCount = this.editManager.getRedoHistoryLength(activeLayer.id);
    if (redoCount === 0) {
      toast.info('没有可重做的操作');
      return;
    }

    const updatedData = this.editManager.redo(activeLayer.id, activeLayer);
    if (updatedData) {
      // 更新图层数据
      if (activeLayer.simplifiedData) {
        activeLayer.simplifiedData = updatedData;
      } else {
        activeLayer.data = updatedData;
      }

      // 重新渲染
      this.renderer.removeLayer(activeLayer.id);
      this.renderer.addLayer(activeLayer);

      // 清除高亮
      this.renderer.clearHighlight();
      this.selectedFeature = null;

      toast.success('已重做');
    }
  }

  /** 删除选中 */
  private handleDeleteSelected(): void {
    if (!this.selectedFeature) {
      toast.warning('请先选择一个要素');
      return;
    }

    this.showConfirmDialog('确认删除', '确定要删除这个区域吗？此操作可以撤销。', () => {
      const activeLayer = this.layerManager.getActiveLayer();
      if (!activeLayer) return;

      const result = this.editManager.deleteFeature(
        activeLayer.id,
        activeLayer,
        this.selectedFeature!.featureIndex
      );

      if (result) {
        // 更新图层数据
        if (activeLayer.simplifiedData) {
          activeLayer.simplifiedData = result;
        } else {
          activeLayer.data = result;
        }

        // 停止顶点编辑并清除选中
        this.renderer.stopVertexEditing();
        this.selectedFeature = null;
        this.renderer.clearHighlight();

        // 重新渲染
        this.renderer.removeLayer(activeLayer.id);
        this.renderer.addLayer(activeLayer);
        this.updateEditToolbarState();
        this.refreshUI();

        toast.success('区域已删除');
      }
    });
  }

  /** 处理右键菜单动作 */
  private handleContextMenuAction(action: string, data: any): void {
    const { layerId, featureIndex } = data;
    const layer = this.layerManager.getLayer(layerId);
    if (!layer) return;

    const layerData = layer.simplifiedData || layer.data;
    const feature = layerData.features[featureIndex];
    if (!feature) return;

    switch (action) {
      case 'edit-vertices':
        // 开始编辑顶点
        this.renderer.startVertexEditing(
          layerId,
          featureIndex,
          feature as GeoJSON.Feature,
          (lid, fidx, newGeometry) => {
            this.handleVertexUpdate(lid, fidx, newGeometry);
          },
          layerData as unknown as GeoJSON.FeatureCollection,
          (vertexIndex) => {
            this.handleVertexDelete(vertexIndex);
          }
        );
        toast.info('顶点编辑已启用：拖动圆点修改位置，点击边缘添加顶点，右键圆点删除顶点');
        break;

      case 'stop-editing':
        // 停止编辑顶点
        this.renderer.stopVertexEditing();
        toast.info('顶点编辑已停止');
        break;

      case 'move-feature':
        // 区域移动：启用拖动模式
        this.enableFeatureMove(layerId, featureIndex, feature as GeoJSON.Feature);
        break;

      case 'add-vertex':
        // 添加顶点
        this.handleAddVertex(layerId, featureIndex, feature as GeoJSON.Feature);
        break;

      case 'delete-feature':
        this.selectedFeature = { layerId, featureIndex, feature: null as any };
        this.handleDeleteSelected();
        break;

      case 'reset-feature':
        // 重置为原始数据
        const originalData = layer.data;
        const updatedData = this.editManager.resetFeature(layerId, layer, featureIndex, originalData);
        if (updatedData) {
          this.refreshLayerRendering(layer);
          toast.success('已重置为源数据');
        }
        break;

      case 'undo':
        this.handleUndo();
        break;
    }
  }

  /** 处理顶点更新（拖动后） */
  /** 处理顶点更新（拖动结束后记录历史） */
  private handleVertexUpdate(layerId: string, featureIndex: number, newGeometry: any): void {
    const layer = this.layerManager.getLayer(layerId);
    if (!layer) return;

    // 记录编辑历史（不重新渲染，因为 source 已在拖动过程中实时更新）
    const updatedData = this.editManager.updateFeatureGeometry(
      layerId,
      layer,
      featureIndex,
      newGeometry
    );

    if (updatedData) {
      // 更新图层数据（保持数据同步）
      if (layer.simplifiedData) {
        layer.simplifiedData = updatedData;
      } else {
        layer.data = updatedData;
      }
      // 不再重新渲染图层（已由 geo-renderer 实时更新）
    }
  }

  /** 处理删除顶点 */
  private handleVertexDelete(vertexIndex: number): void {
    const editingState = this.renderer.getEditingState();
    if (!editingState.isEditing || editingState.layerId === null || editingState.featureIndex === null) {
      return;
    }

    // 执行删除
    const success = this.renderer.removeVertex(vertexIndex);
    if (!success) {
      toast.warning('无法删除：至少需要保留最小顶点数');
      return;
    }

    // 获取更新后的几何和数据
    const editingFeature = this.renderer.getEditingFeature();
    const editingData = this.renderer.getEditingData();
    if (!editingFeature || !editingData) return;

    // 更新数据源
    const sourceKey = `geo-source-${editingState.layerId}`;
    const source = this.renderer.getMap().getSource(sourceKey) as maplibregl.GeoJSONSource;
    if (source) {
      editingData.features[editingState.featureIndex] = editingFeature;
      source.setData(editingData);
    }

    // 记录到编辑历史
    this.handleVertexUpdate(editingState.layerId, editingState.featureIndex, editingFeature.geometry);

    // 重新渲染顶点标记
    this.renderer.stopVertexEditing();
    const layer = this.layerManager.getLayer(editingState.layerId);
    if (layer) {
      const data = layer.simplifiedData || layer.data;
      const feature = data.features[editingState.featureIndex];
      this.renderer.startVertexEditing(
        editingState.layerId,
        editingState.featureIndex,
        feature as unknown as GeoJSON.Feature,
        (lid, fidx, newGeometry) => {
          this.handleVertexUpdate(lid, fidx, newGeometry);
        },
        data as unknown as GeoJSON.FeatureCollection,
        (vtxIdx) => {
          this.handleVertexDelete(vtxIdx);
        }
      );
    }

    toast.success('顶点已删除');
  }

  /** 启用要素移动模式 */
  private enableFeatureMove(layerId: string, featureIndex: number, feature: GeoJSON.Feature): void {
    toast.info('区域移动：拖动地图上的要素到新位置（功能实现中）');
    
    // TODO: 实现拖动整个要素的逻辑
    // 需要使用 MapLibre Draw 插件或手动实现
  }

  /** 添加顶点 */
  private handleAddVertex(layerId: string, featureIndex: number, feature: GeoJSON.Feature): void {
    toast.info('添加顶点：点击地图上的边添加新点（功能实现中）');
    
    // TODO: 实现添加顶点的逻辑
    // 监听地图点击事件，在边上插入新点
  }

  /** 刷新图层渲染 */
  private refreshLayerRendering(layer: any): void {
    this.renderer.removeLayer(layer.id);
    this.renderer.addLayer(layer);
  }

  /** 显示确认对话框 */
  private showConfirmDialog(title: string, message: string, onConfirm: () => void): void {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h3>${title}</h3>
        <p>${message}</p>
        <div class="modal-actions">
          <button class="btn" id="confirmCancel">取消</button>
          <button class="btn btn-primary" id="confirmOk">确认</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    const confirm = () => {
      onConfirm();
      close();
    };

    document.getElementById('confirmCancel')?.addEventListener('click', close);
    document.getElementById('confirmOk')?.addEventListener('click', confirm);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  /** 绑定右键菜单 */
  private setupContextMenu(): void {
    const map = this.renderer.getMap();

    map.on('contextmenu', (e) => {
      if (!this.isEditMode) return;

      // 编辑顶点时，右键由顶点处理器负责，跳过要素右键菜单
      if (this.renderer.getEditingState().isEditing) return;
      
      // 阻止浏览器默认右键菜单
      e.originalEvent.preventDefault();

      // 查询点击位置的要素
      const layerIds = this.layerManager.getLayers()
        .filter((l) => l.visible)
        .map((l) => l.id);

      const results = this.renderer.queryFeaturesAtPoint(e.point, layerIds);

      if (results.length > 0) {
        const hit = results[0];
        const layer = this.layerManager.getLayer(hit.layerId);
        if (!layer) return;

        const data = layer.simplifiedData || layer.data;
        const featureIndex = findFeatureIndex(data.features, hit.feature);

        // 选中要素
        const fullFeature = featureIndex >= 0 ? data.features[featureIndex] : hit.feature;
        this.selectedFeature = {
          layerId: hit.layerId,
          featureIndex: featureIndex >= 0 ? featureIndex : 0,
          feature: fullFeature,
        };

        // 高亮
        this.renderer.highlightFeature(fullFeature as any);

        // 获取菜单项
        const menuItems = this.editManager.getContextMenuItems(
          hit.layerId,
          featureIndex >= 0 ? featureIndex : 0
        );

        // 显示菜单
        this.contextMenu.show(
          e.originalEvent.clientX,
          e.originalEvent.clientY,
          menuItems,
          {
            layerId: hit.layerId,
            featureIndex: featureIndex >= 0 ? featureIndex : 0,
          }
        );
      }
    });
  }

  /** 设置编辑模式悬停效果（鼠标悬停在要素上时变为抓手光标） */
  private setupEditHoverHandler(): void {
    const map = this.renderer.getMap();

    map.on('mousemove', (e) => {
      if (!this.isEditMode) return;

      const layerIds = this.layerManager.getLayers()
        .filter((l) => l.visible)
        .map((l) => l.id);

      if (layerIds.length === 0) return;

      const results = this.renderer.queryFeaturesAtPoint(e.point, layerIds);
      const canvas = map.getCanvas();

      if (results.length > 0) {
        // 悬停在要素上 - 显示抓手光标（表示可以拖动）
        canvas.style.cursor = 'pointer';
      } else {
        // 不在要素上 - 恢复十字光标
        canvas.style.cursor = 'crosshair';
      }
    });
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
    const currentActive = this.layerManager.getActiveLayer()?.id;
    
    // 如果点击的是已选中的图层，则取消选中（折叠）
    if (currentActive === layerId) {
      this.layerManager.setActiveLayer(null);
    } else {
      this.layerManager.setActiveLayer(layerId);
    }
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

  /** 处理样式变更 */
  private handleStyleChange(layerId: string, style: Partial<LayerStyle>): void {
    const layer = this.layerManager.getLayer(layerId);
    if (!layer) return;

    // 更新图层样式
    if (!layer.style) {
      layer.style = {
        fillColor: layer.color,
        fillOpacity: 0.25,
        strokeColor: layer.color,
        strokeWidth: 2,
        strokeOpacity: 0.8,
        pointColor: layer.color,
        pointRadius: 5,
        ...style,
      };
    } else {
      Object.assign(layer.style, style);
    }

    // 更新地图渲染
    this.renderer.updateLayerStyle(layerId, style);

    // 保存到 localStorage
    this.styleManager.updateStyle(layerId, layer.style);
    this.styleManager.saveToLocalStorage();
  }

  /** 重置样式 */
  private handleResetStyle(layerId: string): void {
    const layer = this.layerManager.getLayer(layerId);
    if (!layer) return;

    // 重置为默认样式
    layer.style = {
      fillColor: layer.color,
      fillOpacity: 0.25,
      strokeColor: layer.color,
      strokeWidth: 2,
      strokeOpacity: 0.8,
      pointColor: layer.color,
      pointRadius: 5,
    };

    // 更新地图渲染
    this.renderer.updateLayerStyle(layerId, layer.style);

    // 保存到 localStorage
    this.styleManager.updateStyle(layerId, layer.style);
    this.styleManager.saveToLocalStorage();

    // 刷新 UI
    this.refreshUI();
    toast.info('样式已重置');
  }

  // ===================== 辅助方法 =====================

  /** 添加并渲染图层 */
  private addAndRenderLayer(name: string, data: GeoJSONFeatureCollection): void {
    const layer = this.layerManager.addLayer(name, data);
    
    // 检查 GeoJSON 是否包含嵌入的样式
    const embeddedStyle = this.styleManager.extractStyleFromGeoJSON(data);
    if (embeddedStyle) {
      layer.style = embeddedStyle;
      this.styleManager.updateStyle(layer.id, embeddedStyle);
      toast.info('已加载图层嵌入的样式');
    } else {
      // 使用图层颜色初始化默认样式
      layer.style = {
        fillColor: layer.color,
        fillOpacity: 0.25,
        strokeColor: layer.color,
        strokeWidth: 2,
        strokeOpacity: 0.8,
        pointColor: layer.color,
        pointRadius: 5,
      };
      this.styleManager.updateStyle(layer.id, layer.style);
    }
    
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
      top: 20px;
      left: 100px;
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
    // 自动选中下钻图层作为活动图层
    this.layerManager.setActiveLayer(this.drillLayerId);
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
      // 自动选中下钻图层作为活动图层
      this.layerManager.setActiveLayer(this.drillLayerId);
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
