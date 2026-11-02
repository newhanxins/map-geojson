import maplibregl from 'maplibre-gl';
import type { GeoLayer, LayerStyle, DEFAULT_LAYER_STYLE } from './types';
import { convert, detectRegion } from './coord-transform';

/**
 * MapLibre GL 地图渲染器
 * 负责在地图上渲染多个 GeoJSON 图层
 */
export class GeoRenderer {
  private map: maplibregl.Map;
  private layerSourcePrefix = 'geo-source-';
  private layerFillId = (id: string) => `geo-fill-${id}`;
  private layerLineId = (id: string) => `geo-line-${id}`;
  private layerPointId = (id: string) => `geo-point-${id}`;
  private sourceId = (id: string) => `${this.layerSourcePrefix}${id}`;
  private coordEls: { wgs84: HTMLElement; gcj02: HTMLElement; bd09: HTMLElement; region: HTMLElement } | null = null;
  private tooltipEl: HTMLElement | null = null;
  private currentBasemap = 'osm';
  private pendingLayers: GeoLayer[] = []; // 等待 style 加载的图层队列
  
  // 顶点编辑相关
  private isEditingVertices = false;
  private editingLayerId: string | null = null;
  private editingFeatureIndex: number | null = null;
  private editingFeature: GeoJSON.Feature | null = null;
  private editingData: GeoJSON.FeatureCollection | null = null; // 当前编辑的完整数据
  private onVertexUpdate: ((layerId: string, featureIndex: number, newGeometry: any) => void) | null = null;
  private onVertexDelete: ((vertexIndex: number) => void) | null = null;
  private vertexJustAdded = false; // 刚刚添加了顶点
  // WebGL 渲染顶点
  private hoveredVertexIndex: number | null = null;
  private draggingVertexIndex: number | null = null;
  private vertexCoords: number[][] = []; // 当前所有顶点坐标
  private vertexTooltipEl: HTMLElement | null = null; // 地图上的黑色坐标浮窗
  private onVertexHover: ((coord: number[] | null, index: number | null) => void) | null = null;

  constructor(container: string | HTMLElement) {
    this.map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        name: 'GeoViewer Base',
        sources: {
          'osm-tiles': {
            type: 'raster',
            tiles: [
              'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
            ],
            tileSize: 256,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          },
        },
        layers: [
          {
            id: 'osm-tiles',
            type: 'raster',
            source: 'osm-tiles',
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center: [0, 20],
      zoom: 2,
      attributionControl: true,
    });

    // 添加导航控件
    this.map.addControl(new maplibregl.NavigationControl(), 'top-left');
    this.map.addControl(new maplibregl.ScaleControl(), 'bottom-left');

    // 地图加载完成时重试待处理图层
    this.map.on('idle', () => this.flushPendingLayers());
    this.map.on('load', () => this.flushPendingLayers());

    // 保底机制：15 秒后强制刷新（底图完全无法加载时也能显示 GeoJSON 数据）
    setTimeout(() => {
      if (this.pendingLayers.length > 0) {
        console.warn('保底刷新待处理图层');
        this.flushPendingLayers();
      }
    }, 15000);

    // 添加鼠标坐标显示
    this.addCoordinateDisplay();

    // 添加悬停提示框（DataV 风格）
    this.addTooltip();

    // 添加底图切换控件
    this.addBasemapSwitcher();
  }

  /** 添加鼠标坐标显示组件（底部透明背景，同时显示三种坐标） */
  private addCoordinateDisplay(): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'coord-display';
    wrapper.style.cssText = `
      position: absolute;
      bottom: 8px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(0,0,0,0.45);
      padding: 4px 14px;
      border-radius: 6px;
      font-size: 11px;
      font-family: Consolas, 'Courier New', monospace;
      color: rgba(255,255,255,0.85);
      backdrop-filter: blur(6px);
      pointer-events: none;
      white-space: nowrap;
    `;

    // 创建三个坐标显示元素
    const makeItem = (label: string, color: string): { el: HTMLElement } => {
      const span = document.createElement('span');
      span.style.cssText = `display:inline-flex;align-items:center;gap:4px;`;
      const tag = document.createElement('span');
      tag.textContent = label;
      tag.style.cssText = `
        font-size: 9px;
        padding: 1px 4px;
        border-radius: 2px;
        background: ${color};
        color: #fff;
        font-weight: 600;
        letter-spacing: 0.5px;
      `;
      const val = document.createElement('span');
      val.textContent = '--';
      val.style.cssText = 'min-width:180px;';
      span.appendChild(tag);
      span.appendChild(val);
      wrapper.appendChild(span);
      return { el: val };
    };

    const wgs = makeItem('WGS-84', '#6b7280');
    const gcj = makeItem('GCJ-02', '#3b82f6');
    const bd = makeItem('BD-09', '#f59e0b');

    // 区域标签
    const regionEl = document.createElement('span');
    regionEl.textContent = '';
    regionEl.style.cssText = `
      font-size: 9px;
      padding: 1px 5px;
      border-radius: 2px;
      background: rgba(255,255,255,0.15);
      color: rgba(255,255,255,0.7);
    `;
    wrapper.appendChild(regionEl);

    const mapContainer = this.map.getContainer();
    mapContainer.style.position = 'relative';
    mapContainer.appendChild(wrapper);

    this.coordEls = {
      wgs84: wgs.el,
      gcj02: gcj.el,
      bd09: bd.el,
      region: regionEl,
    };

    // 区域名称映射
    const regionNames: Record<string, string> = {
      mainland: '大陆', hk: '香港', mo: '澳门', tw: '台湾', overseas: '境外',
    };

    // 监听鼠标移动，同时计算并显示三种坐标
    this.map.on('mousemove', (e) => {
      if (!this.coordEls) return;
      const wgsLng = e.lngLat.lng;
      const wgsLat = e.lngLat.lat;

      // WGS-84 始终是原始坐标（地图底图使用 WGS-84）
      this.coordEls.wgs84.textContent = `${wgsLng.toFixed(6)}, ${wgsLat.toFixed(6)}`;

      // 检测当前区域，决定是否偏移
      const region = detectRegion(wgsLng, wgsLat);
      this.coordEls.region.textContent = regionNames[region] || region;

      // GCJ-02：大陆有偏移，港澳台和境外不偏移
      const gcjPt = convert(wgsLng, wgsLat, 'wgs84', 'gcj02');
      this.coordEls.gcj02.textContent = `${gcjPt.lng.toFixed(6)}, ${gcjPt.lat.toFixed(6)}`;

      // BD-09：在 GCJ-02 基础上进一步偏移（仅大陆）
      const bdPt = convert(wgsLng, wgsLat, 'wgs84', 'bd09');
      this.coordEls.bd09.textContent = `${bdPt.lng.toFixed(6)}, ${bdPt.lat.toFixed(6)}`;
    });

    this.map.on('mouseout', () => {
      if (!this.coordEls) return;
      this.coordEls.wgs84.textContent = '--';
      this.coordEls.gcj02.textContent = '--';
      this.coordEls.bd09.textContent = '--';
      this.coordEls.region.textContent = '';
    });
  }

  /** 添加悬停提示框（DataV 风格，类似阿里 DataV 的要素信息弹窗） */
  private addTooltip(): void {
    const tooltip = document.createElement('div');
    tooltip.className = 'feature-tooltip';
    tooltip.style.cssText = `
      position: absolute;
      z-index: 20;
      display: none;
      pointer-events: none;
      max-width: 300px;
      min-width: 160px;
      background: rgba(10, 15, 30, 0.88);
      border: 1px solid rgba(80, 160, 255, 0.35);
      border-radius: 6px;
      padding: 0;
      font-size: 12px;
      color: #e0e8f0;
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 20px rgba(0,0,0,0.4), 0 0 8px rgba(80,160,255,0.15);
      overflow: hidden;
    `;
    tooltip.innerHTML = `
      <div class="tt-header" style="
        padding: 8px 12px;
        background: linear-gradient(90deg, rgba(60,130,255,0.25), rgba(60,130,255,0.05));
        border-bottom: 1px solid rgba(80,160,255,0.2);
        font-size: 13px;
        font-weight: 600;
        color: #fff;
        display: flex;
        align-items: center;
        gap: 6px;
      ">
        <span class="tt-icon" style="
          width: 6px; height: 6px;
          border-radius: 50%;
          background: #4f8cff;
          box-shadow: 0 0 6px #4f8cff;
          flex-shrink: 0;
        "></span>
        <span class="tt-title"></span>
      </div>
      <div class="tt-body" style="
        padding: 6px 0;
      "></div>
    `;

    const mapContainer = this.map.getContainer();
    mapContainer.style.position = 'relative';
    mapContainer.appendChild(tooltip);
    this.tooltipEl = tooltip;

    // 获取所有可见的自定义图层 ID
    const getVisibleLayerMapIds = (): string[] => {
      const ids: string[] = [];
      const style = this.map.getStyle();
      if (!style || !style.layers) return ids;
      for (const layer of style.layers) {
        if (layer.id.startsWith('geo-fill-') || layer.id.startsWith('geo-line-') || layer.id.startsWith('geo-point-')) {
          if (layer.layout?.visibility !== 'none') {
            ids.push(layer.id);
          }
        }
      }
      return ids;
    };

    // 鼠标在地图上移动时查询要素并显示提示框
    this.map.on('mousemove', (e) => {
      if (!this.tooltipEl) return;
      const mapIds = getVisibleLayerMapIds();
      if (mapIds.length === 0) {
        this.hideTooltip();
        return;
      }

      // 在鼠标位置附近查询要素（扩大查询范围 5px）
      const { x, y } = e.point;
      const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
        [x - 5, y - 5],
        [x + 5, y + 5],
      ];
      const features = this.map.queryRenderedFeatures(bbox, { layers: mapIds });

      if (features.length === 0) {
        this.hideTooltip();
        return;
      }

      // 优先级排序：点 > 线 > 面（点要素更容易被精确点击）
      const sorted = [...features].sort((a, b) => {
        const priority = { Point: 0, LineString: 1, Polygon: 2 };
        const aType = (a as any).geometry?.type || 'Polygon';
        const bType = (b as any).geometry?.type || 'Polygon';
        return (priority[aType as keyof typeof priority] ?? 2) - (priority[bType as keyof typeof priority] ?? 2);
      });

      const feature = sorted[0] as unknown as GeoJSON.Feature;
      const props = feature.properties || {};

      // 提取标题：优先用 name/title/NAME 等字段
      const titleKey = Object.keys(props).find(k =>
        ['name', 'title', 'NAME', '名称', '图层名', 'label'].includes(k.toLowerCase())
      );
      const title = titleKey ? String(props[titleKey]) : '未命名要素';

      // 构建属性列表（排除标题字段和内部字段）
      const entries = Object.entries(props).filter(([k]) => {
        if (k === titleKey) return false;
        if (k.startsWith('_')) return false; // 排除 MapLibre 内部字段
        return true;
      }).slice(0, 8); // 最多显示 8 个属性

      this.showTooltip(title, entries, e.originalEvent);
    });

    this.map.on('mouseout', () => this.hideTooltip());
  }

  /** 显示提示框 */
  private showTooltip(title: string, props: [string, unknown][], event: MouseEvent): void {
    if (!this.tooltipEl) return;

    const titleEl = this.tooltipEl.querySelector('.tt-title') as HTMLElement;
    const bodyEl = this.tooltipEl.querySelector('.tt-body') as HTMLElement;
    if (!titleEl || !bodyEl) return;

    titleEl.textContent = title;

    // 构建属性行
    if (props.length === 0) {
      bodyEl.innerHTML = '<div style="padding:4px 12px;color:rgba(255,255,255,0.4);font-size:11px;">无属性信息</div>';
    } else {
      bodyEl.innerHTML = props.map(([key, val]) => {
        const displayVal = val === null || val === undefined ? '--' : String(val);
        const truncated = displayVal.length > 30 ? displayVal.slice(0, 30) + '...' : displayVal;
        return `
          <div style="display:flex;justify-content:space-between;align-items:baseline;padding:3px 12px;gap:12px;">
            <span style="color:rgba(180,200,230,0.7);font-size:11px;white-space:nowrap;">${key}</span>
            <span style="color:#e8f0ff;font-size:11px;font-family:Consolas,monospace;text-align:right;word-break:break-all;">${truncated}</span>
          </div>
        `;
      }).join('');
    }

    // 定位提示框（跟随鼠标，偏移 15px，防止超出边界）
    const container = this.map.getContainer();
    const rect = container.getBoundingClientRect();
    let left = event.clientX - rect.left + 15;
    let top = event.clientY - rect.top + 15;

    // 边界检测
    const ttWidth = this.tooltipEl.offsetWidth || 200;
    const ttHeight = this.tooltipEl.offsetHeight || 100;
    if (left + ttWidth > rect.width - 10) left = left - ttWidth - 30;
    if (top + ttHeight > rect.height - 10) top = top - ttHeight - 30;
    if (left < 10) left = 10;
    if (top < 10) top = 10;

    this.tooltipEl.style.left = `${left}px`;
    this.tooltipEl.style.top = `${top}px`;
    this.tooltipEl.style.display = 'block';
  }

  /** 隐藏提示框 */
  private hideTooltip(): void {
    if (this.tooltipEl) {
      this.tooltipEl.style.display = 'none';
    }
  }

  /** 底图配置 */
  private static BASEMAPS: Record<string, { url: string; name: string; tiles: string[]; tileSize: number }> = {
    osm: {
      url: '',
      name: '街道',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
    },
    satellite: {
      url: '',
      name: '卫星',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
    },
    dark: {
      url: '',
      name: '暗色',
      tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'],
      tileSize: 256,
    },
  };

  /** 添加底图切换控件（放在右上角缩放控件下方） */
  private addBasemapSwitcher(): void {
    const el = document.createElement('div');
    el.className = 'basemap-switcher';
    el.style.cssText = `
      position: absolute;
      top: 120px;
      left: 10px;
      z-index: 10;
      display: flex;
      flex-direction: column;
      gap: 2px;
      background: rgba(255,255,255,0.95);
      border-radius: 6px;
      padding: 4px;
      border: 1px solid rgba(0,0,0,0.1);
      backdrop-filter: blur(4px);
    `;

    for (const [key, config] of Object.entries(GeoRenderer.BASEMAPS)) {
      const btn = document.createElement('button');
      btn.textContent = config.name;
      btn.className = key === this.currentBasemap ? 'basemap-btn active' : 'basemap-btn';
      btn.style.cssText = `
        padding: 4px 10px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        color: ${key === this.currentBasemap ? '#fff' : '#5c6370'};
        background: ${key === this.currentBasemap ? '#4f8cff' : 'transparent'};
        transition: all 0.15s;
      `;
      btn.addEventListener('click', () => this.switchBasemap(key));
      btn.dataset.basemap = key;
      el.appendChild(btn);
    }

    const mapContainer = this.map.getContainer();
    mapContainer.appendChild(el);
  }

  /** 切换底图 */
  switchBasemap(key: string): void {
    const config = GeoRenderer.BASEMAPS[key];
    if (!config || key === this.currentBasemap) return;

    this.currentBasemap = key;

    // 移除旧底图源和图层
    if (this.map.getLayer('osm-tiles')) {
      this.map.removeLayer('osm-tiles');
    }
    if (this.map.getSource('osm-tiles')) {
      this.map.removeSource('osm-tiles');
    }

    // 添加新底图源
    this.map.addSource('osm-tiles', {
      type: 'raster',
      tiles: config.tiles,
      tileSize: config.tileSize,
      attribution: key === 'osm'
        ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        : key === 'satellite'
          ? '&copy; Esri'
          : '&copy; CARTO',
    });

    // 添加底图图层（放在最底层）
    const layers = this.map.getStyle().layers;
    // 找到第一个自定义图层（geo- 开头的图层），在它之前插入底图
    let beforeId: string | undefined;
    for (const layer of layers) {
      if (layer.id.startsWith('geo-') || layer.id.startsWith('highlight-')) {
        beforeId = layer.id;
        break;
      }
    }
    this.map.addLayer({
      id: 'osm-tiles',
      type: 'raster',
      source: 'osm-tiles',
      minzoom: 0,
      maxzoom: key === 'dark' ? 20 : 19,
    }, beforeId);

    // 更新按钮状态
    const container = this.map.getContainer();
    container.querySelectorAll('.basemap-btn').forEach((btn) => {
      const isActive = (btn as HTMLElement).dataset.basemap === key;
      (btn as HTMLElement).style.background = isActive ? '#4f8cff' : 'transparent';
      (btn as HTMLElement).style.color = isActive ? '#fff' : '#5c6370';
    });
  }

  /** 获取地图实例 */
  getMap(): maplibregl.Map {
    return this.map;
  }

  /** 等待地图样式加载完成，带超时保护（5秒） */
  async ready(): Promise<void> {
    return new Promise((resolve) => {
      // style 加载完成即可操作图层，无需等待瓦片加载
      if (this.map.isStyleLoaded()) {
        resolve();
        return;
      }

      // 超时保护：防止瓦片加载失败导致初始化挂起
      const timeout = setTimeout(() => {
        console.warn('地图样式加载超时，继续初始化...');
        resolve();
      }, 5000);

      this.map.once('style.load', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  /** 确保地图 style 已加载后再执行操作（带超时保护） */
  private whenStyleReady(fn: () => void): void {
    if (this.map.isStyleLoaded()) {
      fn();
      return;
    }

    let done = false;
    const onReady = () => {
      if (done) return;
      done = true;
      fn();
    };

    // 超时保护：8 秒后强制执行（底图瓦片加载失败时不会阻塞图层添加）
    const timer = setTimeout(() => {
      console.warn('whenStyleReady 超时，强制执行');
      onReady();
    }, 8000);

    this.map.once('style.load', () => {
      clearTimeout(timer);
      onReady();
    });
  }

  /** 添加图层到地图 */
  addLayer(layer: GeoLayer): void {
    this.whenStyleReady(() => {
      try {
        this.doAddLayer(layer);
      } catch (e) {
        // style 未真正就绪，加入待处理队列
        console.warn('图层添加失败，等待重试:', (e as Error).message);
        this.pendingLayers.push(layer);
      }
    });
  }

  /** 重试添加待处理图层（在 idle 事件时调用） */
  private flushPendingLayers(): void {
    if (this.pendingLayers.length === 0) return;
    const pending = [...this.pendingLayers];
    this.pendingLayers = [];
    for (const layer of pending) {
      try {
        this.doAddLayer(layer);
      } catch (e) {
        console.warn('图层重试仍失败:', (e as Error).message);
      }
    }
  }

  /** 实际执行图层添加（需确保 style 已加载） */
  private doAddLayer(layer: GeoLayer): void {
    const sourceKey = this.sourceId(layer.id);

    // 添加数据源
    if (this.map.getSource(sourceKey)) {
      (this.map.getSource(sourceKey) as maplibregl.GeoJSONSource).setData(
        layer.simplifiedData || layer.data
      );
    } else {
      this.map.addSource(sourceKey, {
        type: 'geojson',
        data: layer.simplifiedData || layer.data,
      });
    }

    // 使用自定义样式或默认样式
    const style = layer.style || {
      fillColor: layer.color,
      fillOpacity: 0.25,
      strokeColor: layer.color,
      strokeWidth: 2,
      strokeOpacity: 0.8,
      pointColor: layer.color,
      pointRadius: 5,
    };

    // 填充层 (面)
    if (!this.map.getLayer(this.layerFillId(layer.id))) {
      this.map.addLayer({
        id: this.layerFillId(layer.id),
        type: 'fill',
        source: sourceKey,
        filter: ['==', '$type', 'Polygon'],
        paint: {
          'fill-color': style.fillColor,
          'fill-opacity': style.fillOpacity,
        },
        layout: {
          visibility: layer.visible ? 'visible' : 'none',
        },
      });
    }

    // 描边层 (线和面边界)
    if (!this.map.getLayer(this.layerLineId(layer.id))) {
      this.map.addLayer({
        id: this.layerLineId(layer.id),
        type: 'line',
        source: sourceKey,
        filter: ['any', ['==', '$type', 'LineString'], ['==', '$type', 'Polygon']],
        paint: {
          'line-color': style.strokeColor,
          'line-width': style.strokeWidth,
          'line-opacity': style.strokeOpacity,
        },
        layout: {
          visibility: layer.visible ? 'visible' : 'none',
        },
      });
    }

    // 点层
    if (!this.map.getLayer(this.layerPointId(layer.id))) {
      this.map.addLayer({
        id: this.layerPointId(layer.id),
        type: 'circle',
        source: sourceKey,
        filter: ['==', '$type', 'Point'],
        paint: {
          'circle-radius': style.pointRadius,
          'circle-color': style.pointColor,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
          'circle-opacity': 0.9,
        },
        layout: {
          visibility: layer.visible ? 'visible' : 'none',
        },
      });
    }
  }

  /** 更新图层数据 */
  updateLayerData(layer: GeoLayer): void {
    const source = this.map.getSource(this.sourceId(layer.id)) as maplibregl.GeoJSONSource;
    if (source) {
      source.setData(layer.simplifiedData || layer.data);
    }
  }

  /** 切换图层可见性 */
  toggleLayerVisibility(layerId: string, visible: boolean): void {
    const vis = visible ? 'visible' : 'none';
    const layers = [this.layerFillId(layerId), this.layerLineId(layerId), this.layerPointId(layerId)];
    for (const id of layers) {
      if (this.map.getLayer(id)) {
        this.map.setLayoutProperty(id, 'visibility', vis);
      }
    }
  }

  /** 更新图层样式（动态更新，无需重新加载数据） */
  updateLayerStyle(layerId: string, style: Partial<import('./types').LayerStyle>): void {
    // 更新填充层
    if (this.map.getLayer(this.layerFillId(layerId))) {
      if (style.fillColor !== undefined) {
        this.map.setPaintProperty(this.layerFillId(layerId), 'fill-color', style.fillColor);
      }
      if (style.fillOpacity !== undefined) {
        this.map.setPaintProperty(this.layerFillId(layerId), 'fill-opacity', style.fillOpacity);
      }
    }

    // 更新描边层
    if (this.map.getLayer(this.layerLineId(layerId))) {
      if (style.strokeColor !== undefined) {
        this.map.setPaintProperty(this.layerLineId(layerId), 'line-color', style.strokeColor);
      }
      if (style.strokeWidth !== undefined) {
        this.map.setPaintProperty(this.layerLineId(layerId), 'line-width', style.strokeWidth);
      }
      if (style.strokeOpacity !== undefined) {
        this.map.setPaintProperty(this.layerLineId(layerId), 'line-opacity', style.strokeOpacity);
      }
    }

    // 更新点层
    if (this.map.getLayer(this.layerPointId(layerId))) {
      if (style.pointColor !== undefined) {
        this.map.setPaintProperty(this.layerPointId(layerId), 'circle-color', style.pointColor);
      }
      if (style.pointRadius !== undefined) {
        this.map.setPaintProperty(this.layerPointId(layerId), 'circle-radius', style.pointRadius);
      }
    }
  }

  /** 移除图层 */
  removeLayer(layerId: string): void {
    const layers = [this.layerFillId(layerId), this.layerLineId(layerId), this.layerPointId(layerId)];
    for (const id of layers) {
      if (this.map.getLayer(id)) {
        this.map.removeLayer(id);
      }
    }
    const sourceKey = this.sourceId(layerId);
    if (this.map.getSource(sourceKey)) {
      this.map.removeSource(sourceKey);
    }
  }

  /** 缩放到图层范围 */
  fitToLayer(layer: GeoLayer): void {
    const data = layer.simplifiedData || layer.data;
    const bounds = calculateBounds(data);
    if (bounds) {
      this.map.fitBounds(bounds, { padding: 50, maxZoom: 16 });
    }
  }

  /** 缩放到所有图层范围 */
  fitToAll(layers: GeoLayer[]): void {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    let hasData = false;

    for (const layer of layers) {
      if (!layer.visible) continue;
      const data = layer.simplifiedData || layer.data;
      const bounds = calculateBounds(data);
      if (bounds) {
        hasData = true;
        minLng = Math.min(minLng, bounds[0][0]);
        minLat = Math.min(minLat, bounds[0][1]);
        maxLng = Math.max(maxLng, bounds[1][0]);
        maxLat = Math.max(maxLat, bounds[1][1]);
      }
    }

    if (hasData) {
      this.map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 50, maxZoom: 16 });
    }
  }

  /** 设置要素高亮（直接传入 feature 对象） */
  highlightFeature(feature: GeoJSON.Feature): void {
    // 清除之前的高亮
    this.clearHighlight();

    this.map.addSource('highlight-source', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [feature] },
    });

    this.map.addLayer({
      id: 'highlight-fill',
      type: 'fill',
      source: 'highlight-source',
      filter: ['==', '$type', 'Polygon'],
      paint: {
        'fill-color': '#ff6b6b',
        'fill-opacity': 0.4,
      },
    });

    this.map.addLayer({
      id: 'highlight-line',
      type: 'line',
      source: 'highlight-source',
      filter: ['any', ['==', '$type', 'LineString'], ['==', '$type', 'Polygon']],
      paint: {
        'line-color': '#ff6b6b',
        'line-width': 3,
        'line-opacity': 1,
      },
    });

    this.map.addLayer({
      id: 'highlight-point',
      type: 'circle',
      source: 'highlight-source',
      filter: ['==', '$type', 'Point'],
      paint: {
        'circle-radius': 8,
        'circle-color': '#ff6b6b',
        'circle-stroke-width': 3,
        'circle-stroke-color': '#fff',
      },
    });
  }

  /** 清除高亮 */
  clearHighlight(): void {
    const highlightLayers = ['highlight-fill', 'highlight-line', 'highlight-point'];
    for (const id of highlightLayers) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    if (this.map.getSource('highlight-source')) {
      this.map.removeSource('highlight-source');
    }
  }

  /** 设置编辑光标 */
  setEditCursor(enabled: boolean): void {
    const canvas = this.map.getCanvas();
    if (enabled) {
      canvas.style.cursor = 'crosshair';
    } else {
      canvas.style.cursor = '';
    }
  }

  // ==================== 顶点编辑功能（WebGL 渲染） ====================

  private static VERTEX_SOURCE = 'vertex-edit-source';
  private static VERTEX_LAYER = 'vertex-edit-layer';
  private static VERTEX_HOVER_LAYER = 'vertex-edit-hover-layer';

  /** 开始编辑顶点 */
  startVertexEditing(
    layerId: string,
    featureIndex: number,
    feature: GeoJSON.Feature,
    onUpdate: (layerId: string, featureIndex: number, newGeometry: any) => void,
    fullData?: GeoJSON.FeatureCollection,
    onDelete?: (vertexIndex: number) => void,
    onHover?: (coord: number[] | null, index: number | null) => void
  ): void {
    this.stopVertexEditing();

    this.isEditingVertices = true;
    this.editingLayerId = layerId;
    this.editingFeatureIndex = featureIndex;
    this.editingFeature = JSON.parse(JSON.stringify(feature));
    this.editingData = fullData ? JSON.parse(JSON.stringify(fullData)) : null;
    this.onVertexUpdate = onUpdate;
    this.onVertexDelete = onDelete || null;
    this.onVertexHover = onHover || null;

    // 添加顶点 source + layer
    this.addVertexLayers();
    this.refreshVertexDisplay();

    // 创建坐标浮窗
    this.createVertexTooltip();

    // 绑定地图级事件
    this.map.on('mousemove', this.onVertexMouseMove);
    this.map.on('mousedown', this.onVertexMouseDown);
    this.map.on('mouseup', this.onVertexMouseUp);
    this.map.on('click', this.handleMapClickForAddVertex);
    this.map.on('contextmenu', this.onVertexContextMenu);
  }

  /** 停止编辑顶点 */
  stopVertexEditing(): void {
    this.removeVertexLayers();
    this.removeVertexTooltip();

    this.isEditingVertices = false;
    this.editingLayerId = null;
    this.editingFeatureIndex = null;
    this.editingFeature = null;
    this.editingData = null;
    this.onVertexUpdate = null;
    this.onVertexDelete = null;
    this.onVertexHover = null;
    this.hoveredVertexIndex = null;
    this.draggingVertexIndex = null;
    this.vertexCoords = [];

    // 移除地图事件
    this.map.off('mousemove', this.onVertexMouseMove);
    this.map.off('mousedown', this.onVertexMouseDown);
    this.map.off('mouseup', this.onVertexMouseUp);
    this.map.off('click', this.handleMapClickForAddVertex);
    this.map.off('contextmenu', this.onVertexContextMenu);
  }

  /** 添加顶点 WebGL 图层 */
  private addVertexLayers(): void {
    if (!this.map.getSource(GeoRenderer.VERTEX_SOURCE)) {
      this.map.addSource(GeoRenderer.VERTEX_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    }

    if (!this.map.getLayer(GeoRenderer.VERTEX_LAYER)) {
      this.map.addLayer({
        id: GeoRenderer.VERTEX_LAYER,
        type: 'circle',
        source: GeoRenderer.VERTEX_SOURCE,
        paint: {
          'circle-radius': 6,
          'circle-color': '#4f8cff',
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#ffffff',
        },
      });
    }

    // 悬停高亮层（单点显示）
    if (!this.map.getLayer(GeoRenderer.VERTEX_HOVER_LAYER)) {
      this.map.addLayer({
        id: GeoRenderer.VERTEX_HOVER_LAYER,
        type: 'circle',
        source: GeoRenderer.VERTEX_SOURCE,
        filter: ['==', ['get', 'index'], -1], // 默认不显示
        paint: {
          'circle-radius': 9,
          'circle-color': '#ff6b6b',
          'circle-stroke-width': 3,
          'circle-stroke-color': '#ffffff',
        },
      });
    }
  }

  /** 移除顶点图层 */
  private removeVertexLayers(): void {
    for (const id of [GeoRenderer.VERTEX_HOVER_LAYER, GeoRenderer.VERTEX_LAYER]) {
      if (this.map.getLayer(id)) this.map.removeLayer(id);
    }
    if (this.map.getSource(GeoRenderer.VERTEX_SOURCE)) {
      this.map.removeSource(GeoRenderer.VERTEX_SOURCE);
    }
  }

  /** 刷新顶点显示 */
  private refreshVertexDisplay(): void {
    if (!this.editingFeature) return;

    this.vertexCoords = this.extractCoords(this.editingFeature.geometry);
    const features: GeoJSON.Feature[] = this.vertexCoords.map((coord, i) => ({
      type: 'Feature' as const,
      properties: { index: i },
      geometry: { type: 'Point' as const, coordinates: coord },
    }));

    const source = this.map.getSource(GeoRenderer.VERTEX_SOURCE) as maplibregl.GeoJSONSource;
    if (source) {
      source.setData({ type: 'FeatureCollection', features });
    }
  }

  /** 创建坐标浮窗 */
  private createVertexTooltip(): void {
    this.removeVertexTooltip();
    const el = document.createElement('div');
    el.className = 'vertex-coord-tooltip';
    el.style.cssText = `
      position: absolute;
      display: none;
      pointer-events: none;
      z-index: 100;
      background: rgba(0, 0, 0, 0.85);
      color: #fff;
      font-size: 12px;
      font-family: Consolas, monospace;
      padding: 5px 10px;
      border-radius: 4px;
      white-space: nowrap;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    `;
    this.map.getContainer().appendChild(el);
    this.vertexTooltipEl = el;
  }

  /** 移除坐标浮窗 */
  private removeVertexTooltip(): void {
    if (this.vertexTooltipEl) {
      this.vertexTooltipEl.remove();
      this.vertexTooltipEl = null;
    }
  }

  /** 更新浮窗显示（鼠标位置 + 坐标） */
  private showVertexTooltip(mouseX: number, mouseY: number, coord: number[]): void {
    if (!this.vertexTooltipEl) return;
    this.vertexTooltipEl.style.display = 'block';
    this.vertexTooltipEl.textContent = `${coord[0].toFixed(6)}, ${coord[1].toFixed(6)}`;
    // 鼠标右侧偏移
    this.vertexTooltipEl.style.left = `${mouseX + 14}px`;
    this.vertexTooltipEl.style.top = `${mouseY - 12}px`;
  }

  /** 隐藏顶点浮窗 */
  private hideVertexTooltip(): void {
    if (this.vertexTooltipEl) {
      this.vertexTooltipEl.style.display = 'none';
    }
  }

  /** 获取鼠标下的顶点索引（使用 BBOX 查询提高容错） */
  private queryVertexAtPoint(point: maplibregl.PointLike): number | null {
    // 使用 10x10 像素的包围盒查询，提高点击容错
    const px = (point as any).x ?? (point as number[])[0];
    const py = (point as any).y ?? (point as number[])[1];
    const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
      [px - 8, py - 8],
      [px + 8, py + 8],
    ];
    const features = this.map.queryRenderedFeatures(bbox, {
      layers: [GeoRenderer.VERTEX_LAYER],
    });
    if (features.length > 0 && features[0].properties) {
      return features[0].properties.index as number;
    }
    return null;
  }

  /** 更新悬停高亮 */
  private updateHoverHighlight(vertexIndex: number | null, mouseX?: number, mouseY?: number): void {
    const prevIndex = this.hoveredVertexIndex;
    this.hoveredVertexIndex = vertexIndex;

    // 更新高亮层 filter
    if (vertexIndex !== prevIndex) {
      if (this.map.getLayer(GeoRenderer.VERTEX_HOVER_LAYER)) {
        if (vertexIndex !== null) {
          this.map.setFilter(GeoRenderer.VERTEX_HOVER_LAYER, ['==', ['get', 'index'], vertexIndex]);
        } else {
          this.map.setFilter(GeoRenderer.VERTEX_HOVER_LAYER, ['==', ['get', 'index'], -1]);
        }
      }
    }

    // 更新光标
    const canvas = this.map.getCanvas();
    canvas.style.cursor = vertexIndex !== null ? 'move' : (this.isEditingVertices ? 'crosshair' : '');

    // 显示/隐藏坐标浮窗
    if (vertexIndex !== null && this.vertexCoords[vertexIndex] && mouseX !== undefined && mouseY !== undefined) {
      this.showVertexTooltip(mouseX, mouseY, this.vertexCoords[vertexIndex]);
    } else if (this.draggingVertexIndex === null) {
      this.hideVertexTooltip();
    }

    // 通知回调
    if (this.onVertexHover) {
      if (vertexIndex !== null && this.vertexCoords[vertexIndex]) {
        this.onVertexHover(this.vertexCoords[vertexIndex], vertexIndex);
      } else if (this.draggingVertexIndex === null) {
        this.onVertexHover(null, null);
      }
    }
  }



  // ---------- 地图级事件处理 ----------

  private onVertexMouseMove = (e: maplibregl.MapMouseEvent): void => {
    if (!this.isEditingVertices) return;

    // 拖动中
    if (this.draggingVertexIndex !== null) {
      const newCoord = [e.lngLat.lng, e.lngLat.lat];
      this.updateVertexGeometry(this.draggingVertexIndex, newCoord);
      this.vertexCoords[this.draggingVertexIndex] = newCoord;

      // 更新 source（流畅拖动）
      if (this.editingLayerId && this.editingFeatureIndex !== null && this.editingFeature) {
        this.updateLayerSource(this.editingLayerId, this.editingFeatureIndex, this.editingFeature);
      }

      // 更新顶点显示
      this.refreshVertexDisplay();

      // 更新浮窗位置和内容
      this.showVertexTooltip(e.point.x, e.point.y, newCoord);

      // 通知回调（实时更新坐标）
      if (this.onVertexHover) {
        this.onVertexHover(newCoord, this.draggingVertexIndex);
      }
      return;
    }

    // 悬停检测
    const vertexIdx = this.queryVertexAtPoint(e.point);
    this.updateHoverHighlight(vertexIdx, e.point.x, e.point.y);
  };

  private onVertexMouseDown = (e: maplibregl.MapMouseEvent): void => {
    if (!this.isEditingVertices) return;

    const vertexIdx = this.queryVertexAtPoint(e.point);
    if (vertexIdx !== null) {
      e.preventDefault();
      this.draggingVertexIndex = vertexIdx;
      this.map.dragPan.disable();
      this.map.getCanvas().style.cursor = 'grabbing';
    }
  };

  private onVertexMouseUp = (_e: maplibregl.MapMouseEvent): void => {
    if (this.draggingVertexIndex !== null) {
      const idx = this.draggingVertexIndex;
      this.draggingVertexIndex = null;
      this.map.dragPan.enable();
      this.map.getCanvas().style.cursor = 'move';

      // 记录历史
      this.handleVertexDrag(idx, this.vertexCoords[idx]);

      // 标记刚拖动完，防止触发空白区域点击
      this.vertexJustAdded = true;
      setTimeout(() => { this.vertexJustAdded = false; }, 150);
    }
  };

  private onVertexContextMenu = (e: maplibregl.MapMouseEvent): void => {
    if (!this.isEditingVertices) return;

    const vertexIdx = this.queryVertexAtPoint(e.point);
    if (vertexIdx !== null) {
      // 阻止浏览器默认右键菜单
      e.originalEvent.preventDefault();
      if (this.onVertexDelete) {
        this.onVertexDelete(vertexIdx);
      }
    }
  };

  /** 地图点击添加顶点 */
  private handleMapClickForAddVertex = (e: maplibregl.MapMouseEvent): void => {
    if (!this.isEditingVertices || !this.editingFeature || !this.editingLayerId || this.editingFeatureIndex === null) {
      return;
    }

    const clickCoord = [e.lngLat.lng, e.lngLat.lat];
    const geometry = this.editingFeature.geometry;

    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon' ||
        geometry.type === 'LineString' || geometry.type === 'MultiLineString') {

      const result = this.insertVertexOnNearestEdge(geometry, clickCoord);
      if (result) {
        this.vertexJustAdded = true;
        setTimeout(() => { this.vertexJustAdded = false; }, 150);

        this.editingFeature.geometry = result.geometry;
        this.updateLayerSource(this.editingLayerId, this.editingFeatureIndex, this.editingFeature);
        this.refreshVertexDisplay();

        if (this.onVertexUpdate) {
          this.onVertexUpdate(this.editingLayerId, this.editingFeatureIndex, this.editingFeature.geometry);
        }
      }
    }
  };

  /** 在最近的边上插入顶点 */
  private insertVertexOnNearestEdge(geometry: any, clickCoord: number[]): { geometry: any; insertIndex: number } | null {
    let minDist = Infinity;
    let bestRing: number[][] | null = null;
    let bestInsertIndex = -1;

    const rings = this.getRings(geometry);
    
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        const p1 = ring[i];
        const p2 = ring[i + 1];
        const dist = this.pointToSegmentDistance(clickCoord, p1, p2);
        if (dist < minDist) {
          minDist = dist;
          bestRing = ring;
          bestInsertIndex = i + 1;
        }
      }
    }

    if (bestRing && minDist < 0.1) { // 距离阈值（度）
      // 在边上插入新点
      const newPoint = this.projectPointOnSegment(clickCoord, bestRing[bestInsertIndex - 1], bestRing[bestInsertIndex]);
      bestRing.splice(bestInsertIndex, 0, newPoint);
      return { geometry, insertIndex: bestInsertIndex };
    }

    return null;
  }

  /** 获取几何体的所有环 */
  private getRings(geometry: any): number[][][] {
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

  /** 点到线段的距离 */
  private pointToSegmentDistance(p: number[], a: number[], b: number[]): number {
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

  /** 投影点到线段上 */
  private projectPointOnSegment(p: number[], a: number[], b: number[]): number[] {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return [...a];
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return [a[0] + t * dx, a[1] + t * dy];
  }

  /** 实时更新图层 source（不删除/重建图层） */
  private updateLayerSource(layerId: string, featureIndex: number, updatedFeature: GeoJSON.Feature): void {
    const sourceKey = this.sourceId(layerId);
    const source = this.map.getSource(sourceKey) as maplibregl.GeoJSONSource;
    if (!source || !this.editingData) return;

    // 更新编辑数据中的要素
    this.editingData.features[featureIndex] = updatedFeature;
    // 触发 source 更新（MapLibre 会自动重新渲染）
    source.setData(this.editingData);
  }

  /** 更新顶点几何（拖动过程中，不记录历史） */
  private updateVertexGeometry(vertexIndex: number, newCoord: number[]): void {
    if (!this.editingFeature) return;

    const geometry = this.editingFeature.geometry;
    let coordIndex = 0;
    
    if (geometry.type === 'Point') {
      geometry.coordinates = newCoord;
    } else if (geometry.type === 'LineString' || geometry.type === 'MultiPoint') {
      geometry.coordinates[vertexIndex] = newCoord;
    } else if (geometry.type === 'Polygon' || geometry.type === 'MultiLineString') {
      for (let ringIdx = 0; ringIdx < geometry.coordinates.length; ringIdx++) {
        const ring = geometry.coordinates[ringIdx];
        if (vertexIndex >= coordIndex && vertexIndex < coordIndex + ring.length) {
          ring[vertexIndex - coordIndex] = newCoord;
          break;
        }
        coordIndex += ring.length;
      }
    } else if (geometry.type === 'MultiPolygon') {
      for (let polyIdx = 0; polyIdx < geometry.coordinates.length; polyIdx++) {
        const polygon = geometry.coordinates[polyIdx];
        for (let ringIdx = 0; ringIdx < polygon.length; ringIdx++) {
          const ring = polygon[ringIdx];
          if (vertexIndex >= coordIndex && vertexIndex < coordIndex + ring.length) {
            ring[vertexIndex - coordIndex] = newCoord;
            break;
          }
          coordIndex += ring.length;
        }
      }
    }
  }

  /** 提取所有坐标 */
  private extractCoords(geometry: any): number[][] {
    const coords: number[][] = [];
    
    if (geometry.type === 'Point') {
      coords.push(geometry.coordinates);
    } else if (geometry.type === 'LineString' || geometry.type === 'MultiPoint') {
      coords.push(...geometry.coordinates);
    } else if (geometry.type === 'Polygon' || geometry.type === 'MultiLineString') {
      for (const ring of geometry.coordinates) {
        coords.push(...ring);
      }
    } else if (geometry.type === 'MultiPolygon') {
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          coords.push(...ring);
        }
      }
    }
    
    return coords;
  }

  /** 处理顶点拖动结束（记录历史） */
  private handleVertexDrag(vertexIndex: number, newCoord: number[]): void {
    if (!this.editingLayerId || this.editingFeatureIndex === null || !this.onVertexUpdate || !this.editingFeature) {
      return;
    }

    // 通知调用者（会记录到编辑历史）
    this.onVertexUpdate(this.editingLayerId, this.editingFeatureIndex, this.editingFeature.geometry);
  }

  /** 删除顶点 */
  removeVertex(vertexIndex: number): boolean {
    if (!this.editingFeature) return false;

    const geometry = this.editingFeature.geometry;
    let coordIndex = 0;

    // 检查是否可以删除（至少需要保留最小顶点数）
    if (geometry.type === 'Polygon') {
      // 多边形至少需要 3 个顶点（加上闭合点共 4 个坐标）
      const totalCoords = geometry.coordinates.reduce((sum: number, ring: number[][]) => sum + ring.length, 0);
      if (totalCoords <= 4) {
        return false; // 不能删除，否则不是有效多边形
      }
    } else if (geometry.type === 'MultiPolygon') {
      const totalCoords = geometry.coordinates.reduce((sum: number, poly: number[][][]) => 
        sum + poly.reduce((s: number, ring: number[][]) => s + ring.length, 0), 0);
      if (totalCoords <= 4) {
        return false;
      }
    } else if (geometry.type === 'LineString') {
      if (geometry.coordinates.length <= 2) {
        return false; // 线至少需要 2 个点
      }
    } else if (geometry.type === 'Point' || geometry.type === 'MultiPoint') {
      return false; // 点类型不支持删除顶点
    }

    // 删除顶点
    if (geometry.type === 'LineString' || geometry.type === 'MultiPoint') {
      geometry.coordinates.splice(vertexIndex, 1);
    } else if (geometry.type === 'Polygon' || geometry.type === 'MultiLineString') {
      for (const ring of geometry.coordinates) {
        if (vertexIndex >= coordIndex && vertexIndex < coordIndex + ring.length) {
          ring.splice(vertexIndex - coordIndex, 1);
          // 如果是多边形的环，删除后要更新闭合点
          if (geometry.type === 'Polygon' && ring.length > 0) {
            ring[ring.length - 1] = ring[0];
          }
          break;
        }
        coordIndex += ring.length;
      }
    } else if (geometry.type === 'MultiPolygon') {
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          if (vertexIndex >= coordIndex && vertexIndex < coordIndex + ring.length) {
            ring.splice(vertexIndex - coordIndex, 1);
            // 更新闭合点
            if (ring.length > 0) {
              ring[ring.length - 1] = ring[0];
            }
            break;
          }
          coordIndex += ring.length;
        }
      }
    }

    return true;
  }

  /** 获取编辑状态 */
  getEditingState(): { isEditing: boolean; layerId: string | null; featureIndex: number | null } {
    return {
      isEditing: this.isEditingVertices,
      layerId: this.editingLayerId,
      featureIndex: this.editingFeatureIndex,
    };
  }

  /** 获取当前编辑的要素 */
  getEditingFeature(): GeoJSON.Feature | null {
    return this.editingFeature;
  }

  /** 获取当前编辑的数据集 */
  getEditingData(): GeoJSON.FeatureCollection | null {
    return this.editingData;
  }

  /** 检查并重置刚刚添加顶点标志 */
  consumeVertexAddedFlag(): boolean {
    const flag = this.vertexJustAdded;
    this.vertexJustAdded = false;
    return flag;
  }

  /** 查询地图上的要素（使用 bbox 查询 + 面积优先排序） */
  queryFeaturesAtPoint(point: { x: number; y: number }, layerIds: string[]): Array<{ layerId: string; featureIndex: number; feature: GeoJSON.Feature }> {
    const results: Array<{ layerId: string; featureIndex: number; feature: GeoJSON.Feature }> = [];

    // 扩大查询范围 5px，确保能捕获到面要素
    const bbox: [maplibregl.PointLike, maplibregl.PointLike] = [
      [point.x - 5, point.y - 5],
      [point.x + 5, point.y + 5],
    ];

    for (const layerId of layerIds) {
      const mapLayerIds = [this.layerFillId(layerId), this.layerLineId(layerId), this.layerPointId(layerId)]
        .filter((id) => this.map.getLayer(id));

      const features = this.map.queryRenderedFeatures(bbox, { layers: mapLayerIds });

      // 去重（同一要素可能在 fill 和 line 图层中都查到）
      const seen = new Set<string>();
      for (const feature of features) {
        const key = `${(feature as any).id || JSON.stringify((feature as any).properties).slice(0, 100)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          layerId,
          featureIndex: -1,
          feature: feature as unknown as GeoJSON.Feature,
        });
      }
    }

    // 排序优先级：点 > 线 > 面（面积越小优先级越高，避免大背景面遮挡小要素）
    results.sort((a, b) => {
      const priority: Record<string, number> = { Point: 0, MultiPoint: 0, LineString: 1, MultiLineString: 1, Polygon: 2, MultiPolygon: 2 };
      const pa = priority[a.feature.geometry.type] ?? 2;
      const pb = priority[b.feature.geometry.type] ?? 2;
      if (pa !== pb) return pa - pb;
      // 同类型按面积排序（面积小的优先）
      if (pa === 2) {
        const areaA = estimateArea(a.feature.geometry);
        const areaB = estimateArea(b.feature.geometry);
        return areaA - areaB;
      }
      return 0;
    });

    return results;
  }

  /** 销毁地图实例 */
  destroy(): void {
    this.map.remove();
  }
}

/**
 * 计算 GeoJSON 数据的边界框
 */
function calculateBounds(data: GeoJSON.FeatureCollection): [[number, number], [number, number]] | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  let hasCoords = false;

  function processCoords(coords: unknown): void {
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords as [number, number];
      hasCoords = true;
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    } else if (Array.isArray(coords)) {
      for (const c of coords) {
        processCoords(c);
      }
    }
  }

  for (const feature of data.features) {
    if (feature.geometry && 'coordinates' in feature.geometry) {
      processCoords(feature.geometry.coordinates);
    }
  }

  if (!hasCoords) return null;
  return [[minLng, minLat], [maxLng, maxLat]];
}

/** 粗略估算几何体面积（用于排序优先级，不需要精确值） */
function estimateArea(geometry: GeoJSON.Geometry): number {
  if (geometry.type === 'Polygon') {
    const ring = (geometry as GeoJSON.Polygon).coordinates[0];
    if (!ring || ring.length < 3) return 0;
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    }
    return Math.abs(area / 2);
  }
  if (geometry.type === 'MultiPolygon') {
    return (geometry as GeoJSON.MultiPolygon).coordinates.reduce(
      (sum, poly) => sum + estimateArea({ type: 'Polygon', coordinates: poly } as GeoJSON.Polygon), 0
    );
  }
  return 0;
}


