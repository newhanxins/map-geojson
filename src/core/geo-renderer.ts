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
    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
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

  /** 添加鼠标坐标显示组件（顶部透明背景，同时显示三种坐标） */
  private addCoordinateDisplay(): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'coord-display';
    wrapper.style.cssText = `
      position: absolute;
      top: 8px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 10;
      display: flex;
      align-items: center;
      gap: 12px;
      background: rgba(0,0,0,0.35);
      padding: 5px 14px;
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
      right: 10px;
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

    const color = layer.color;

    // 填充层 (面)
    if (!this.map.getLayer(this.layerFillId(layer.id))) {
      this.map.addLayer({
        id: this.layerFillId(layer.id),
        type: 'fill',
        source: sourceKey,
        filter: ['==', '$type', 'Polygon'],
        paint: {
          'fill-color': color,
          'fill-opacity': 0.25,
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
          'line-color': color,
          'line-width': 2,
          'line-opacity': 0.8,
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
          'circle-radius': 5,
          'circle-color': color,
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

  /** 更新图层样式 */
  updateLayerStyle(layerId: string, style: Partial<LayerStyle>): void {
    if (style.fillColor && this.map.getLayer(this.layerFillId(layerId))) {
      this.map.setPaintProperty(this.layerFillId(layerId), 'fill-color', style.fillColor);
    }
    if (style.fillOpacity !== undefined && this.map.getLayer(this.layerFillId(layerId))) {
      this.map.setPaintProperty(this.layerFillId(layerId), 'fill-opacity', style.fillOpacity);
    }
    if (style.strokeColor && this.map.getLayer(this.layerLineId(layerId))) {
      this.map.setPaintProperty(this.layerLineId(layerId), 'line-color', style.strokeColor);
    }
    if (style.strokeWidth !== undefined && this.map.getLayer(this.layerLineId(layerId))) {
      this.map.setPaintProperty(this.layerLineId(layerId), 'line-width', style.strokeWidth);
    }
    if (style.strokeOpacity !== undefined && this.map.getLayer(this.layerLineId(layerId))) {
      this.map.setPaintProperty(this.layerLineId(layerId), 'line-opacity', style.strokeOpacity);
    }
    if (style.pointColor && this.map.getLayer(this.layerPointId(layerId))) {
      this.map.setPaintProperty(this.layerPointId(layerId), 'circle-color', style.pointColor);
    }
    if (style.pointRadius !== undefined && this.map.getLayer(this.layerPointId(layerId))) {
      this.map.setPaintProperty(this.layerPointId(layerId), 'circle-radius', style.pointRadius);
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


