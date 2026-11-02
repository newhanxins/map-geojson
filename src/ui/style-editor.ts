/**
 * 样式编辑器组件
 * 在侧边栏底部显示图层样式编辑面板
 */

import type { LayerStyle } from '../core/types';
import { DEFAULT_LAYER_STYLE } from '../core/types';

export class StyleEditor {
  private container: HTMLElement;
  private onStyleChange: (style: Partial<LayerStyle>) => void;
  private onReset: () => void;
  private currentStyle: LayerStyle | null = null;
  private isCollapsed = false;

  constructor(
    containerId: string,
    callbacks: {
      onStyleChange: (style: Partial<LayerStyle>) => void;
      onReset: () => void;
    }
  ) {
    this.container = document.getElementById(containerId)!;
    this.onStyleChange = callbacks.onStyleChange;
    this.onReset = callbacks.onReset;
  }

  /** 显示样式编辑器（传入图层样式） */
  show(style: LayerStyle): void {
    this.currentStyle = { ...style };
    this.render();
  }

  /** 隐藏样式编辑器 */
  hide(): void {
    this.currentStyle = null;
    this.container.innerHTML = '';
  }

  /** 更新样式（外部调用） */
  updateStyle(style: LayerStyle): void {
    if (this.currentStyle) {
      this.currentStyle = { ...style };
      this.updateControls();
    }
  }

  /** 渲染编辑器 */
  private render(): void {
    if (!this.currentStyle) return;

    const style = this.currentStyle;

    this.container.innerHTML = `
      <div class="style-editor">
        <div class="style-editor-content" style="${this.isCollapsed ? 'display:none;' : ''}">
          <!-- 填充 -->
          <div class="style-editor-compact-row">
            <label class="compact-label">填充</label>
            <input type="color" id="fillColor" value="${style.fillColor}" class="compact-color" />
            <input type="range" id="fillOpacity" min="0" max="100" 
                   value="${Math.round(style.fillOpacity * 100)}" class="compact-range" />
            <span class="compact-value">${Math.round(style.fillOpacity * 100)}%</span>
          </div>

          <!-- 边框 -->
          <div class="style-editor-compact-row">
            <label class="compact-label">边框</label>
            <input type="color" id="strokeColor" value="${style.strokeColor}" class="compact-color" />
            <input type="range" id="strokeWidth" min="0" max="10" step="0.5" 
                   value="${style.strokeWidth}" class="compact-range" style="max-width:50px;" />
            <span class="compact-value" style="width:35px;">${style.strokeWidth}px</span>
            <input type="range" id="strokeOpacity" min="0" max="100" 
                   value="${Math.round(style.strokeOpacity * 100)}" class="compact-range" />
            <span class="compact-value">${Math.round(style.strokeOpacity * 100)}%</span>
          </div>

          <!-- 点 -->
          <div class="style-editor-compact-row">
            <label class="compact-label">点</label>
            <input type="color" id="pointColor" value="${style.pointColor}" class="compact-color" />
            <input type="range" id="pointRadius" min="1" max="20" 
                   value="${style.pointRadius}" class="compact-range" style="max-width:80px;" />
            <span class="compact-value">${style.pointRadius}px</span>
          </div>

          <!-- 操作按钮 -->
          <div class="style-editor-actions">
            <button id="resetStyle" class="btn-reset" title="重置样式">↺ 重置样式</button>
          </div>
        </div>
      </div>
    `;

    this.bindEvents();
  }

  /** 绑定事件 */
  private bindEvents(): void {
    // 填充颜色（只有颜色选择器，没有文本输入）
    const fillColorInput = document.getElementById('fillColor') as HTMLInputElement;
    fillColorInput?.addEventListener('input', (e) => {
      this.onStyleChange({ fillColor: (e.target as HTMLInputElement).value });
    });

    // 填充透明度
    this.bindRangeInput('fillOpacity', 100, (value) => {
      this.onStyleChange({ fillOpacity: value });
    });

    // 边框颜色
    const strokeColorInput = document.getElementById('strokeColor') as HTMLInputElement;
    strokeColorInput?.addEventListener('input', (e) => {
      this.onStyleChange({ strokeColor: (e.target as HTMLInputElement).value });
    });

    // 边框宽度
    this.bindRangeInput('strokeWidth', 1, (value) => {
      this.onStyleChange({ strokeWidth: value });
    });

    // 边框透明度
    this.bindRangeInput('strokeOpacity', 100, (value) => {
      this.onStyleChange({ strokeOpacity: value });
    });

    // 点颜色
    const pointColorInput = document.getElementById('pointColor') as HTMLInputElement;
    pointColorInput?.addEventListener('input', (e) => {
      this.onStyleChange({ pointColor: (e.target as HTMLInputElement).value });
    });

    // 点半径
    this.bindRangeInput('pointRadius', 1, (value) => {
      this.onStyleChange({ pointRadius: value });
    });

    // 重置按钮
    const resetBtn = document.getElementById('resetStyle');
    resetBtn?.addEventListener('click', () => {
      this.onReset();
    });
  }

  /** 绑定颜色输入（颜色选择器 + 文本输入） */
  private bindColorInput(
    colorInputId: string,
    textInputId: string,
    onChange: (value: string) => void
  ): void {
    const colorInput = document.getElementById(colorInputId) as HTMLInputElement;
    const textInput = document.getElementById(textInputId) as HTMLInputElement;

    if (colorInput && textInput) {
      // 颜色选择器变更
      colorInput.addEventListener('input', (e) => {
        const value = (e.target as HTMLInputElement).value;
        textInput.value = value;
        onChange(value);
      });

      // 文本输入变更
      textInput.addEventListener('input', (e) => {
        const value = (e.target as HTMLInputElement).value;
        if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
          colorInput.value = value;
          onChange(value);
        }
      });

      textInput.addEventListener('blur', (e) => {
        const value = (e.target as HTMLInputElement).value;
        if (!/^#[0-9A-Fa-f]{6}$/.test(value)) {
          textInput.value = colorInput.value;
        }
      });
    }
  }

  /** 绑定范围输入（滑块） */
  private bindRangeInput(
    inputId: string,
    divisor: number,
    onChange: (value: number) => void
  ): void {
    const input = document.getElementById(inputId) as HTMLInputElement;

    if (input) {
      input.addEventListener('input', (e) => {
        const rawValue = parseInt((e.target as HTMLInputElement).value);
        const value = divisor === 1 ? rawValue : rawValue / divisor;
        
        // 更新显示值（相邻的 span）
        const valueSpan = input.nextElementSibling as HTMLElement;
        if (valueSpan && valueSpan.classList.contains('compact-value')) {
          const displayValue = divisor === 1 ? rawValue : Math.round(rawValue / divisor * 100) / 100;
          valueSpan.textContent = `${displayValue}${divisor === 100 ? '%' : 'px'}`;
        }
        
        onChange(value);
      });
    }
  }

  /** 更新控件值（不重新渲染） */
  private updateControls(): void {
    if (!this.currentStyle) return;

    const style = this.currentStyle;

    // 更新填充
    this.updateInput('fillColor', style.fillColor);
    this.updateInput('fillColorText', style.fillColor);
    this.updateInput('fillOpacity', Math.round(style.fillOpacity * 100));
    this.updateLabel('fillOpacityLabel', `${Math.round(style.fillOpacity * 100)}%`);

    // 更新边框
    this.updateInput('strokeColor', style.strokeColor);
    this.updateInput('strokeColorText', style.strokeColor);
    this.updateInput('strokeWidth', style.strokeWidth);
    this.updateLabel('strokeWidthLabel', `${style.strokeWidth}px`);
    this.updateInput('strokeOpacity', Math.round(style.strokeOpacity * 100));
    this.updateLabel('strokeOpacityLabel', `${Math.round(style.strokeOpacity * 100)}%`);

    // 更新点
    this.updateInput('pointColor', style.pointColor);
    this.updateInput('pointColorText', style.pointColor);
    this.updateInput('pointRadius', style.pointRadius);
    this.updateLabel('pointRadiusLabel', `${style.pointRadius}px`);
  }

  /** 更新输入框值 */
  private updateInput(id: string, value: any): void {
    const input = document.getElementById(id) as HTMLInputElement;
    if (input && input.value !== String(value)) {
      input.value = String(value);
    }
  }

  /** 更新标签文本 */
  private updateLabel(id: string, text: string): void {
    const label = document.getElementById(id);
    if (label && label.textContent !== text) {
      label.textContent = text;
    }
  }
}
