import type { GeoJSONFeature, SelectedFeature } from './types';

/**
 * 要素检查器
 * 用于展示和检查 GeoJSON 要素的属性
 */
export class FeatureInspector {
  private selectedFeature: SelectedFeature | null = null;
  private panel: HTMLElement | null = null;
  private panelContent: HTMLElement | null = null;

  constructor(panelContentId: string) {
    this.panelContent = document.getElementById(panelContentId);
  }

  /** 设置选中的要素 */
  select(feature: SelectedFeature | null): void {
    this.selectedFeature = feature;
    this.render();
  }

  /** 获取当前选中的要素 */
  getSelected(): SelectedFeature | null {
    return this.selectedFeature;
  }

  /** 清除选中 */
  clear(): void {
    this.selectedFeature = null;
    this.render();
  }

  /** 渲染属性面板 */
  render(): void {
    if (!this.panelContent) return;

    if (!this.selectedFeature) {
      this.panelContent.innerHTML = `
        <div class="empty-state">
          <p>Click a feature on the map to view its properties</p>
        </div>
      `;
      return;
    }

    const { feature, layerId, featureIndex } = this.selectedFeature;
    const props = feature.properties || {};
    const entries = Object.entries(props);

    let html = `
      <div class="feature-info">
        <div class="feature-info-header">
          <span class="feature-badge">${feature.geometry.type}</span>
          <span class="feature-meta">Layer: ${layerId} | #${featureIndex + 1}</span>
          ${feature.id !== undefined ? `<span class="feature-id">ID: ${feature.id}</span>` : ''}
        </div>
    `;

    if (entries.length === 0) {
      html += `<div class="feature-no-props">No properties</div>`;
    } else {
      html += `
        <table class="feature-table">
          <thead>
            <tr><th>Property</th><th>Value</th></tr>
          </thead>
          <tbody>
      `;
      for (const [key, value] of entries) {
        const displayValue = this.formatValue(value);
        html += `
          <tr>
            <td class="prop-key">${this.escapeHtml(key)}</td>
            <td class="prop-value">${displayValue}</td>
          </tr>
        `;
      }
      html += `</tbody></table>`;
    }

    html += `</div>`;
    this.panelContent.innerHTML = html;
  }

  /** 格式化属性值 */
  private formatValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '<span class="value-null">null</span>';
    }
    if (typeof value === 'number') {
      return `<span class="value-number">${value}</span>`;
    }
    if (typeof value === 'boolean') {
      return `<span class="value-boolean">${value}</span>`;
    }
    if (typeof value === 'string') {
      // 检查是否为 URL
      if (value.startsWith('http://') || value.startsWith('https://')) {
        return `<a href="${this.escapeHtml(value)}" target="_blank" class="value-link">${this.escapeHtml(value)}</a>`;
      }
      return `<span class="value-string">${this.escapeHtml(value)}</span>`;
    }
    if (typeof value === 'object') {
      return `<span class="value-object">${this.escapeHtml(JSON.stringify(value))}</span>`;
    }
    return this.escapeHtml(String(value));
  }

  /** HTML 转义 */
  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

/**
 * 在 FeatureCollection 中查找与查询要素匹配的索引
 * 优先通过关键属性（adcode/name/id）匹配，回退到属性子集匹配
 */
export function findFeatureIndex(
  features: GeoJSONFeature[],
  queryFeature: { properties?: Record<string, unknown> | null; geometry?: { type: string } }
): number {
  if (!queryFeature.properties) return -1;
  const qp = queryFeature.properties;

  // 优先通过唯一标识属性精确匹配
  const idKeys = ['adcode', 'id', 'ID', 'OBJECTID', 'FID'];
  for (const key of idKeys) {
    if (qp[key] !== undefined) {
      const idx = features.findIndex(f => f.properties?.[key] === qp[key]);
      if (idx >= 0) return idx;
    }
  }

  // 通过 name + 几何类型匹配
  const nameKeys = ['name', 'NAME', '名称', 'title'];
  for (const key of nameKeys) {
    if (qp[key] !== undefined) {
      const idx = features.findIndex(f =>
        f.properties?.[key] === qp[key] &&
        f.geometry.type === queryFeature.geometry?.type
      );
      if (idx >= 0) return idx;
    }
  }

  // 回退：属性子集匹配（排除 MapLibre 内部属性 _开头的键）
  const qKeys = Object.keys(qp).filter(k => !k.startsWith('_'));
  for (let i = 0; i < features.length; i++) {
    const fp = features[i].properties;
    if (!fp) continue;
    const match = qKeys.length > 0 && qKeys.every(
      key => JSON.stringify(fp[key]) === JSON.stringify(qp[key])
    );
    if (match) return i;
  }

  return -1;
}
