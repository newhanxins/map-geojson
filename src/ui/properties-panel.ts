import type { GeoLayer, SelectedFeature } from '../core/types';

/**
 * 属性面板组件
 * 显示选中要素的详细属性信息
 */
export class PropertiesPanel {
  private container: HTMLElement;
  private content: HTMLElement;

  constructor(
    panelId: string,
    _toggleId: string,
    contentId: string
  ) {
    this.container = document.getElementById(panelId)!;
    this.content = document.getElementById(contentId)!;
  }

  /** 显示要素属性 */
  showFeature(feature: SelectedFeature | null, layerName?: string): void {
    if (!feature) {
      this.content.innerHTML = `
        <div class="empty-state">
          <p>点击地图上的要素查看属性信息</p>
        </div>
      `;
      return;
    }

    const props = feature.feature.properties || {};
    const entries = Object.entries(props);
    const geomType = feature.feature.geometry.type;

    let html = `
      <div style="padding:8px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="
            display:inline-block;padding:2px 8px;
            background:#4f8cff;color:#fff;border-radius:4px;
            font-size:11px;font-weight:600;
          ">${geomType}</span>
          ${layerName ? `<span style="font-size:11px;color:#9ca3af;">图层: ${this.escapeHtml(layerName)}</span>` : ''}
          ${feature.feature.id !== undefined ? `<span style="font-size:11px;color:#9ca3af;">ID: ${feature.feature.id}</span>` : ''}
          <span style="font-size:11px;color:#9ca3af;">#${feature.featureIndex + 1}</span>
        </div>
    `;

    if (entries.length === 0) {
      html += `<p style="color:#9ca3af;font-size:12px;">无属性信息</p>`;
    } else {
      // 搜索过滤输入框
      html += `
        <div style="margin-bottom:8px;">
          <input type="text" class="prop-search-input" placeholder="搜索属性..."
            style="width:100%;padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;
            font-size:12px;outline:none;box-sizing:border-box;"
          />
          <span style="font-size:10px;color:#9ca3af;margin-top:2px;display:block;">
            ${entries.length} 个属性
          </span>
        </div>
        <table class="prop-table" style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="background:#f0f2f5;">
              <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e8ecf1;color:#5c6370;">属性名</th>
              <th style="text-align:left;padding:4px 8px;border-bottom:1px solid #e8ecf1;color:#5c6370;">属性值</th>
            </tr>
          </thead>
          <tbody class="prop-tbody">
      `;

      for (const [key, value] of entries) {
        const searchKey = `${key} ${String(value)}`.toLowerCase();
        html += `
          <tr class="prop-row" data-search="${this.escapeHtml(searchKey)}">
            <td style="padding:3px 8px;border-bottom:1px solid #f0f2f5;font-weight:500;color:#1a1a2e;">
              ${this.escapeHtml(key)}
            </td>
            <td style="padding:3px 8px;border-bottom:1px solid #f0f2f5;font-family:Consolas,monospace;color:#4f8cff;word-break:break-all;">
              ${this.formatValue(value)}
            </td>
          </tr>
        `;
      }

      html += `</tbody></table>`;
    }

    html += `</div>`;
    this.content.innerHTML = html;

    // 绑定搜索过滤事件
    this.bindSearchFilter();
  }

  /** 绑定属性搜索过滤 */
  private bindSearchFilter(): void {
    const searchInput = this.content.querySelector('.prop-search-input') as HTMLInputElement;
    if (!searchInput) return;

    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase().trim();
      const rows = this.content.querySelectorAll('.prop-row');
      let visibleCount = 0;
      rows.forEach((row) => {
        const searchData = (row as HTMLElement).dataset.search || '';
        const match = !query || searchData.includes(query);
        (row as HTMLElement).style.display = match ? '' : 'none';
        if (match) visibleCount++;
      });
      // 更新计数
      const counter = this.content.querySelector('.prop-search-input + span');
      if (counter) {
        counter.textContent = query
          ? `${visibleCount} of ${rows.length} properties matched`
          : `${rows.length} properties`;
      }
    });
  }

  /** 清空面板 */
  clear(): void {
    this.content.innerHTML = `
      <div class="empty-state">
        <p>点击地图上的要素查看属性信息</p>
      </div>
    `;
  }

  private formatValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '<span style="color:#9ca3af;">null</span>';
    }
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'string') {
      if (value.startsWith('http://') || value.startsWith('https://')) {
        return `<a href="${this.escapeHtml(value)}" target="_blank" style="color:#4f8cff;">${this.escapeHtml(value.length > 60 ? value.slice(0, 60) + '...' : value)}</a>`;
      }
      return this.escapeHtml(value);
    }
    return this.escapeHtml(JSON.stringify(value));
  }

  private escapeHtml(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}
