import type { GeoLayer } from '../core/types';
import { computeStats, formatArea, formatDistance, formatBbox } from '../core/geo-stats';

/**
 * 侧边栏组件
 * 显示图层列表和统计信息
 */
export class Sidebar {
  private container: HTMLElement;
  private onToggleVisibility: (layerId: string) => void;
  private onSelectLayer: (layerId: string) => void;
  private onRemoveLayer: (layerId: string) => void;
  private onFitToLayer: (layerId: string) => void;
  private onReorderLayer: (fromIndex: number, toIndex: number) => void;
  private onRenameLayer: (layerId: string, name: string) => void;

  constructor(
    containerId: string,
    callbacks: {
      onToggleVisibility: (layerId: string) => void;
      onSelectLayer: (layerId: string) => void;
      onRemoveLayer: (layerId: string) => void;
      onFitToLayer: (layerId: string) => void;
      onReorderLayer: (fromIndex: number, toIndex: number) => void;
      onRenameLayer: (layerId: string, name: string) => void;
    }
  ) {
    this.container = document.getElementById(containerId)!;
    this.onToggleVisibility = callbacks.onToggleVisibility;
    this.onSelectLayer = callbacks.onSelectLayer;
    this.onRemoveLayer = callbacks.onRemoveLayer;
    this.onFitToLayer = callbacks.onFitToLayer;
    this.onReorderLayer = callbacks.onReorderLayer;
    this.onRenameLayer = callbacks.onRenameLayer;
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
        const featureCount = (layer.simplifiedData || layer.data).features.length;
        html += `
          <div class="layer-item ${isActive ? 'active' : ''}" data-layer-id="${layer.id}" data-layer-index="${i}" draggable="true">
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
            </div>
          </div>
        `;
      }
    }

    // 统计信息区域
    if (layers.length > 0) {
      const totalFeatures = layers.reduce((sum, l) => sum + l.data.features.length, 0);
      const activeLayer = layers.find((l) => l.id === activeLayerId);
      const stats = activeLayer ? computeStats(activeLayer.simplifiedData || activeLayer.data) : null;

      html += `
        <div style="border-top:1px solid var(--border-light);padding:0;">
          <div style="padding:6px 12px;background:var(--bg-hover);font-size:11px;font-weight:600;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.5px;">统计信息</div>
          <div class="stats-grid">
            <div class="stat-item">
              <span class="stat-label">要素总数</span>
              <span class="stat-value">${totalFeatures.toLocaleString()}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">图层数</span>
              <span class="stat-value">${layers.length}</span>
            </div>
      `;

      if (stats) {
        const types = Object.entries(stats.typeDistribution)
          .map(([type, count]) => `${type}: ${count}`)
          .join(', ');

        html += `
          <div class="stat-item" style="grid-column:span 2;">
            <span class="stat-label">几何类型</span>
            <span class="stat-value" style="font-size:11px;">${types || '无'}</span>
          </div>
        `;

        if (stats.bbox) {
          html += `
            <div class="stat-item" style="grid-column:span 2;">
              <span class="stat-label">边界框</span>
              <span class="stat-value" style="font-size:10px;">${formatBbox(stats.bbox)}</span>
            </div>
          `;
        }

        if (stats.estimatedArea !== null) {
          html += `
            <div class="stat-item">
              <span class="stat-label">面积</span>
              <span class="stat-value" style="font-size:11px;">${formatArea(stats.estimatedArea)}</span>
            </div>
          `;
        }

        if (stats.estimatedPerimeter !== null) {
          html += `
            <div class="stat-item">
              <span class="stat-label">周长</span>
              <span class="stat-value" style="font-size:11px;">${formatDistance(stats.estimatedPerimeter)}</span>
            </div>
          `;
        }
      }

      html += `</div></div>`;
    }

    this.container.innerHTML = html;
    this.bindEvents();
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
