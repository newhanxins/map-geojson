import type { GeoLayer, LayerStyle } from '../core/types';
import { computeStats, formatArea, formatDistance, formatBbox } from '../core/geo-stats';
import { StyleEditor } from './style-editor';

/**
 * 侧边栏组件
 * 显示图层列表和统计信息
 */
export class Sidebar {
  private container: HTMLElement;
  private styleEditor: StyleEditor | null = null;
  private onToggleVisibility: (layerId: string) => void;
  private onSelectLayer: (layerId: string) => void;
  private onRemoveLayer: (layerId: string) => void;
  private onFitToLayer: (layerId: string) => void;
  private onReorderLayer: (fromIndex: number, toIndex: number) => void;
  private onRenameLayer: (layerId: string, name: string) => void;
  private onStyleChange: (layerId: string, style: Partial<LayerStyle>) => void;
  private onResetStyle: (layerId: string) => void;

  constructor(
    containerId: string,
    callbacks: {
      onToggleVisibility: (layerId: string) => void;
      onSelectLayer: (layerId: string) => void;
      onRemoveLayer: (layerId: string) => void;
      onFitToLayer: (layerId: string) => void;
      onReorderLayer: (fromIndex: number, toIndex: number) => void;
      onRenameLayer: (layerId: string, name: string) => void;
      onStyleChange: (layerId: string, style: Partial<LayerStyle>) => void;
      onResetStyle: (layerId: string) => void;
    }
  ) {
    this.container = document.getElementById(containerId)!;
    this.onToggleVisibility = callbacks.onToggleVisibility;
    this.onSelectLayer = callbacks.onSelectLayer;
    this.onRemoveLayer = callbacks.onRemoveLayer;
    this.onFitToLayer = callbacks.onFitToLayer;
    this.onReorderLayer = callbacks.onReorderLayer;
    this.onRenameLayer = callbacks.onRenameLayer;
    this.onStyleChange = callbacks.onStyleChange;
    this.onResetStyle = callbacks.onResetStyle;
  }

  /** 渲染图层列表和统计信息 */
  render(layers: GeoLayer[], activeLayerId: string | null): void {
    // 更新图层计数
    const countEl = document.getElementById('layerCount');
    if (countEl) countEl.textContent = String(layers.length);

    let html = '';

    // 图层列表
    if (layers.length === 0) {
      html += `
        <div class="layers-empty">
          <div style="font-size:32px;opacity:0.3;">&#128506;</div>
          <p>暂无图层</p>
          <p style="font-size:11px;">拖拽 GeoJSON 文件或点击导入按钮</p>
        </div>
      `;
    } else {
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i];
        const isActive = layer.id === activeLayerId;
        const data = layer.simplifiedData || layer.data;
        const featureCount = data.features.length;
        const stats = computeStats(data);
        
        html += `
          <div class="layer-panel ${isActive ? 'active' : ''}" data-layer-id="${layer.id}">
            <!-- 图层头部 -->
            <div class="layer-item" data-layer-index="${i}" draggable="true" data-action="select" data-layer-id="${layer.id}">
              <div class="visibility-toggle ${layer.visible ? '' : 'hidden'}" data-action="toggle" data-layer-id="${layer.id}">
                ${layer.visible ? '&#9673;' : '&#9675;'}
              </div>
              <div class="color-swatch" style="background:${layer.color};"></div>
              <span class="layer-name" data-action="select" data-layer-id="${layer.id}" title="${layer.name} (双击重命名)">
                ${layer.name}
              </span>
              <span class="layer-count">${featureCount}</span>
              <div class="layer-actions">
                <button data-action="fit" data-layer-id="${layer.id}" title="缩放至图层">&#128269;</button>
                <button data-action="remove" data-layer-id="${layer.id}" title="删除图层">&#10005;</button>
                <button class="toggle-panel-btn" data-action="toggle-panel" data-layer-id="${layer.id}" title="展开/折叠">
                  ${isActive ? '&#9660;' : '&#9654;'}
                </button>
              </div>
            </div>
            
            <!-- 图层详情面板（选中时展开） -->
            ${isActive ? `
              <div class="layer-details">
                <!-- 统计信息 -->
                <div class="layer-section">
                  <div class="layer-section-header" data-action="toggle-section" data-section="stats-${layer.id}">
                    <span>&#128202; 统计信息</span>
                    <span class="section-toggle">&#9660;</span>
                  </div>
                  <div class="layer-section-content" id="stats-${layer.id}">
                    <div class="stats-grid">
                      <div class="stat-item">
                        <span class="stat-label">要素总数</span>
                        <span class="stat-value">${featureCount.toLocaleString()}</span>
                      </div>
                      <div class="stat-item">
                        <span class="stat-label">图层数</span>
                        <span class="stat-value">${layers.length}</span>
                      </div>
                      ${stats ? `
                        <div class="stat-item" style="grid-column:span 2;">
                          <span class="stat-label">类型分布</span>
                          <span class="stat-value" style="font-size:10px;">
                            ${Object.entries(stats.typeDistribution).map(([type, count]) => `${type}: ${count}`).join(', ')}
                          </span>
                        </div>
                        ${stats.bbox ? `
                          <div class="stat-item" style="grid-column:span 2;">
                            <span class="stat-label">边界框</span>
                            <span class="stat-value" style="font-size:10px;">${formatBbox(stats.bbox)}</span>
                          </div>
                        ` : ''}
                        ${stats.estimatedArea !== null ? `
                          <div class="stat-item">
                            <span class="stat-label">面积</span>
                            <span class="stat-value" style="font-size:11px;">${formatArea(stats.estimatedArea)}</span>
                          </div>
                        ` : ''}
                        ${stats.estimatedPerimeter !== null ? `
                          <div class="stat-item">
                            <span class="stat-label">周长</span>
                            <span class="stat-value" style="font-size:11px;">${formatDistance(stats.estimatedPerimeter)}</span>
                          </div>
                        ` : ''}
                      ` : ''}
                    </div>
                  </div>
                </div>
                
                <!-- 样式编辑 -->
                <div class="layer-section">
                  <div class="layer-section-header" data-action="toggle-section" data-section="style-${layer.id}">
                    <span>&#127912; 样式编辑</span>
                    <span class="section-toggle">&#9660;</span>
                  </div>
                  <div class="layer-section-content" id="style-${layer.id}">
                    <div id="styleEditor-${layer.id}"></div>
                  </div>
                </div>
                
                <!-- 要素属性 -->
                <div class="layer-section">
                  <div class="layer-section-header" data-action="toggle-section" data-section="properties-${layer.id}">
                    <span>&#128196; 要素属性</span>
                    <span class="section-toggle">&#9660;</span>
                  </div>
                  <div class="layer-section-content" id="properties-${layer.id}">
                    <div id="propertiesContent-${layer.id}" class="properties-placeholder">
                      <p style="padding:12px;text-align:center;color:var(--text-muted);font-size:11px;">
                        点击地图上的要素查看属性信息
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ` : ''}
          </div>
        `;
      }
    }

    this.container.innerHTML = html;
    this.bindEvents();

    // 为选中的图层渲染样式编辑器
    const activeLayer = layers.find((l) => l.id === activeLayerId);
    if (activeLayer) {
      this.renderStyleEditor(activeLayer);
    }
  }

  /** 渲染样式编辑器 */
  private renderStyleEditor(layer: GeoLayer): void {
    const containerId = `styleEditor-${layer.id}`;
    const container = document.getElementById(containerId);
    if (!container) return;

    // 为该图层创建或复用样式编辑器
    if (!this.styleEditor) {
      this.styleEditor = new StyleEditor(containerId, {
        onStyleChange: (style) => {
          this.onStyleChange(layer.id, style);
        },
        onReset: () => {
          this.onResetStyle(layer.id);
        },
      });
    } else {
      // 更新容器 ID
      this.styleEditor = new StyleEditor(containerId, {
        onStyleChange: (style) => {
          this.onStyleChange(layer.id, style);
        },
        onReset: () => {
          this.onResetStyle(layer.id);
        },
      });
    }

    // 使用图层样式或默认样式
    const style = layer.style || {
      fillColor: layer.color,
      fillOpacity: 0.25,
      strokeColor: layer.color,
      strokeWidth: 2,
      strokeOpacity: 0.8,
      pointColor: layer.color,
      pointRadius: 5,
    } as LayerStyle;
    
    this.styleEditor.show(style);
  }

  /** 更新图层的要素属性显示 */
  updateLayerProperties(layerId: string, html: string): void {
    const container = document.getElementById(`propertiesContent-${layerId}`);
    if (container) {
      container.innerHTML = html;
    }
  }

  /** 清除所有图层的要素属性显示 */
  clearAllProperties(): void {
    const containers = this.container.querySelectorAll('[id^="propertiesContent-"]');
    containers.forEach((container) => {
      container.innerHTML = `
        <p style="padding:12px;text-align:center;color:var(--text-muted);font-size:11px;">
          点击地图上的要素查看属性信息
        </p>
      `;
    });
  }

  /** 绑定事件 */
  private bindEvents(): void {
    // 点击事件
    this.container.querySelectorAll('[data-action]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const target = e.currentTarget as HTMLElement;
        const action = target.dataset.action;
        const layerId = target.dataset.layerId;
        if (!layerId) return;

        // 折叠按钮特殊处理：直接切换详情显示，不触发选中
        if (action === 'toggle-panel') {
          const details = target.closest('.layer-panel')?.querySelector('.layer-details') as HTMLElement;
          const icon = target.querySelector('.toggle-panel-btn') || target;
          if (details) {
            const isHidden = details.style.display === 'none';
            details.style.display = isHidden ? 'block' : 'none';
            if (icon.classList.contains('toggle-panel-btn')) {
              icon.innerHTML = isHidden ? '&#9660;' : '&#9654;';
            } else if (target.classList.contains('toggle-panel-btn')) {
              target.innerHTML = isHidden ? '&#9660;' : '&#9654;';
            }
          }
          return;
        }

        switch (action) {
          case 'toggle':
            this.onToggleVisibility(layerId);
            break;
          case 'select':
            this.onSelectLayer(layerId);
            break;
          case 'remove':
            this.onRemoveLayer(layerId);
            break;
          case 'fit':
            this.onFitToLayer(layerId);
            break;
        }
      });
    });

    // 双击重命名
    this.container.querySelectorAll('.layer-name').forEach((el) => {
      el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const target = e.currentTarget as HTMLElement;
        const layerId = target.dataset.layerId;
        if (!layerId) return;

        const currentName = target.textContent?.trim() || '';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentName;
        input.style.cssText = 'width:100%;padding:1px 4px;border:1px solid #4f8cff;border-radius:3px;font-size:12px;outline:none;';

        target.textContent = '';
        target.appendChild(input);
        input.focus();
        input.select();

        const finishRename = () => {
          const newName = input.value.trim();
          if (newName && newName !== currentName) {
            this.onRenameLayer(layerId, newName);
          }
        };

        input.addEventListener('blur', finishRename);
        input.addEventListener('keydown', (ke) => {
          if (ke.key === 'Enter') {
            (ke.target as HTMLInputElement).blur();
          }
          if (ke.key === 'Escape') {
            input.value = currentName;
            (ke.target as HTMLInputElement).blur();
          }
        });
      });
    });

    // 拖拽排序
    this.bindDragSort();

    // 折叠/展开区块
    this.container.querySelectorAll('[data-action="toggle-section"]').forEach((header) => {
      header.addEventListener('click', (e) => {
        e.stopPropagation();
        const sectionId = (header as HTMLElement).dataset.section;
        if (sectionId) {
          const content = document.getElementById(sectionId);
          const toggle = header.querySelector('.section-toggle');
          if (content && toggle) {
            const isCollapsed = content.style.display === 'none';
            content.style.display = isCollapsed ? 'block' : 'none';
            toggle.textContent = isCollapsed ? '▼' : '▶';
          }
        }
      });
    });
  }

  /** 绑定拖拽排序 */
  private bindDragSort(): void {
    const items = this.container.querySelectorAll('.layer-item[draggable]');
    let draggedEl: HTMLElement | null = null;

    items.forEach((item) => {
      const el = item as HTMLElement;

      el.addEventListener('dragstart', (e) => {
        draggedEl = el;
        el.style.opacity = '0.4';
        e.dataTransfer!.effectAllowed = 'move';
        e.dataTransfer!.setData('text/plain', el.dataset.layerIndex || '');
      });

      el.addEventListener('dragend', () => {
        el.style.opacity = '1';
        draggedEl = null;
        items.forEach((i) => (i as HTMLElement).classList.remove('drag-over'));
      });

      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer!.dropEffect = 'move';
        if (el !== draggedEl) {
          el.classList.add('drag-over');
        }
      });

      el.addEventListener('dragleave', () => {
        el.classList.remove('drag-over');
      });

      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('drag-over');
        if (!draggedEl || draggedEl === el) return;

        const fromIndex = parseInt(draggedEl.dataset.layerIndex || '-1');
        const toIndex = parseInt(el.dataset.layerIndex || '-1');

        if (fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex) {
          this.onReorderLayer(fromIndex, toIndex);
        }
      });
    });
  }
}
