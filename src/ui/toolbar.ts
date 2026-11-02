/**
 * 工具栏组件
 * 提供导入/导出/简化等操作按钮
 */
export class Toolbar {
  private container: HTMLElement;
  private callbacks: ToolbarCallbacks;

  constructor(containerId: string, callbacks: ToolbarCallbacks) {
    this.container = document.getElementById(containerId)!;
    this.callbacks = callbacks;
    this.render();
    this.bindEvents();
  }

  /** 渲染工具栏 */
  render(): void {
    this.container.innerHTML = `
      <div class="toolbar-brand">
        <svg class="logo" viewBox="0 0 24 24" fill="none" stroke="#4f8cff" stroke-width="2">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
          <path d="M2 17l10 5 10-5"/>
          <path d="M2 12l10 5 10-5"/>
        </svg>
        <h1>GeoJSON 查看器</h1>
      </div>

      <div class="toolbar-actions">
        <!-- 导入（单击弹出菜单） -->
        <div class="dropdown" id="importDropdown">
          <button class="btn btn-primary" id="btnImportDropdown">
            <span>&#128194;</span> 导入 <span>&#9662;</span>
          </button>
          <div class="dropdown-menu" id="importMenu">
            <div class="dropdown-menu-item" data-action="import-file">
              <span class="item-icon">&#128196;</span> 打开文件
            </div>
            <div class="dropdown-menu-item" data-action="import-url">
              <span class="item-icon">&#128279;</span> 从 URL 加载
            </div>
            <div class="dropdown-menu-item" data-action="import-paste">
              <span class="item-icon">&#128203;</span> 粘贴 JSON
            </div>
            <div class="dropdown-menu-divider"></div>
            <div class="dropdown-menu-item" data-action="import-sample">
              <span class="item-icon">&#127758;</span> 加载示例数据
            </div>
          </div>
        </div>

        <!-- 导出按钮 -->
        <button class="btn btn-success" id="btnExport" title="导出数据">
          <span>&#128190;</span> 导出
        </button>

        <div class="toolbar-divider"></div>

        <button class="btn" id="btnSimplify">
          <span>&#9881;</span> 简化
        </button>

        <button class="btn" id="btnFitAll" title="Fit to all layers">
          <span>&#128269;</span> 适配
        </button>

        <button class="btn" id="btnClearAll" title="Clear all layers">
          <span>&#128465;</span> 清除
        </button>
      </div>
    `;
  }

  /** 绑定事件 */
  private bindEvents(): void {
    // 导入下拉菜单（单击打开菜单）
    this.setupDropdown('btnImportDropdown', 'importMenu');
    document.querySelector('[data-action="import-file"]')?.addEventListener('click', () => {
      this.callbacks.onImportFile();
      this.closeAllDropdowns();
    });
    document.querySelector('[data-action="import-url"]')?.addEventListener('click', () => {
      this.showUrlModal();
      this.closeAllDropdowns();
    });
    document.querySelector('[data-action="import-paste"]')?.addEventListener('click', () => {
      this.showPasteModal();
      this.closeAllDropdowns();
    });
    document.querySelector('[data-action="import-sample"]')?.addEventListener('click', () => {
      this.callbacks.onLoadSample();
      this.closeAllDropdowns();
    });

    // 导出按钮 - 显示导出弹窗
    document.getElementById('btnExport')?.addEventListener('click', () => {
      this.showExportModal();
    });

    // 简化按钮
    document.getElementById('btnSimplify')?.addEventListener('click', () => {
      this.callbacks.onToggleSimplify();
    });

    // 适配全部
    document.getElementById('btnFitAll')?.addEventListener('click', () => {
      this.callbacks.onFitAll();
    });

    // 清除
    document.getElementById('btnClearAll')?.addEventListener('click', () => {
      this.callbacks.onClearAll();
    });

    // 编辑工具
    // 点击外部关闭下拉菜单
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.dropdown')) {
        this.closeAllDropdowns();
      }
    });
  }

  /** 设置下拉菜单 */
  private setupDropdown(buttonId: string, menuId: string): void {
    const btn = document.getElementById(buttonId);
    const menu = document.getElementById(menuId);
    if (!btn || !menu) return;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // 关闭其他下拉菜单
      document.querySelectorAll('.dropdown-menu.show').forEach((m) => {
        if (m !== menu) m.classList.remove('show');
      });
      menu.classList.toggle('show');
    });
  }

  /** 关闭所有下拉菜单 */
  private closeAllDropdowns(): void {
    document.querySelectorAll('.dropdown-menu.show').forEach((m) => {
      m.classList.remove('show');
    });
  }

  /** 显示 URL 输入弹窗 */
  private showUrlModal(): void {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2>从 URL 加载</h2>
        <input class="input" id="urlInput" type="text" placeholder="https://example.com/data.geojson" autofocus />
        <div class="modal-actions">
          <button class="btn" id="urlCancel">取消</button>
          <button class="btn btn-primary" id="urlLoad">加载</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const urlInput = document.getElementById('urlInput') as HTMLInputElement;
    urlInput.focus();

    const close = () => overlay.remove();
    const load = () => {
      const url = urlInput.value.trim();
      if (url) {
        this.callbacks.onImportUrl(url);
        close();
      }
    };

    document.getElementById('urlCancel')?.addEventListener('click', close);
    document.getElementById('urlLoad')?.addEventListener('click', load);
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') load();
      if (e.key === 'Escape') close();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  /** 显示粘贴 JSON 弹窗 */
  private showPasteModal(): void {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <h2>粘贴 GeoJSON 数据</h2>
        <textarea class="input" id="pasteInput" rows="8"
          placeholder='{"type":"FeatureCollection","features":[...]}'
          style="width:100%;font-family:Consolas,monospace;font-size:12px;resize:vertical;"
        ></textarea>
        <div class="modal-actions">
          <button class="btn" id="pasteCancel">取消</button>
          <button class="btn btn-primary" id="pasteLoad">加载</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const textarea = document.getElementById('pasteInput') as HTMLTextAreaElement;
    textarea.focus();

    const close = () => overlay.remove();
    const load = () => {
      const text = textarea.value.trim();
      if (text) {
        this.callbacks.onImportPaste(text);
        close();
      }
    };

    document.getElementById('pasteCancel')?.addEventListener('click', close);
    document.getElementById('pasteLoad')?.addEventListener('click', load);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }

  /** 显示导出弹窗 */
  private showExportModal(): void {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal export-modal">
        <h2>导出数据</h2>
        <div class="export-options">
          <div class="export-option" data-action="export-geojson">
            <div class="export-option-icon">&#128196;</div>
            <div class="export-option-content">
              <div class="export-option-title">GeoJSON</div>
              <div class="export-option-desc">标准 GeoJSON 格式文件</div>
            </div>
          </div>
          <div class="export-option" data-action="export-topojson">
            <div class="export-option-icon">&#128196;</div>
            <div class="export-option-content">
              <div class="export-option-title">TopoJSON</div>
              <div class="export-option-desc">压缩后的拓扑格式</div>
            </div>
          </div>
          <div class="export-option" data-action="export-json">
            <div class="export-option-icon">&#128196;</div>
            <div class="export-option-content">
              <div class="export-option-title">JSON</div>
              <div class="export-option-desc">导出为 JSON 格式文件</div>
            </div>
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn" id="exportCancel">取消</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();

    // 绑定导出选项事件
    overlay.querySelector('[data-action="export-geojson"]')?.addEventListener('click', () => {
      this.callbacks.onExportGeoJSON();
      close();
    });
    overlay.querySelector('[data-action="export-topojson"]')?.addEventListener('click', () => {
      this.callbacks.onExportTopoJSON();
      close();
    });
    overlay.querySelector('[data-action="export-json"]')?.addEventListener('click', () => {
      this.callbacks.onExportJSON();
      close();
    });

    document.getElementById('exportCancel')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  }
}

/** 工具栏回调接口 */
interface ToolbarCallbacks {
  onImportFile(): void;
  onImportUrl(url: string): void;
  onImportPaste(text: string): void;
  onLoadSample(): void;
  onExportGeoJSON(): void;
  onExportTopoJSON(): void;
  onExportJSON(): void;
  onToggleSimplify(): void;
  onFitAll(): void;
  onClearAll(): void;
}
