/**
 * 右键菜单组件
 * 显示图层/区域的编辑选项
 */

import type { ContextMenuItem } from '../core/edit-manager';

export class ContextMenu {
  private container: HTMLElement;
  private menuElement: HTMLElement | null = null;
  private onAction: (action: string, data: any) => void;

  constructor(containerId: string, onAction: (action: string, data: any) => void) {
    this.container = document.getElementById(containerId)!;
    this.onAction = onAction;

    // 点击其他区域关闭菜单
    document.addEventListener('click', () => this.hide());
    document.addEventListener('contextmenu', (e) => {
      // 只在地图区域显示右键菜单
      if (!(e.target as HTMLElement).closest('#map')) {
        this.hide();
      }
    });
  }

  /** 显示菜单 */
  show(x: number, y: number, items: ContextMenuItem[], data: any = {}): void {
    this.hide();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    let html = '';
    for (const item of items) {
      if (item.separator) {
        html += `<div class="context-menu-separator"></div>`;
      } else {
        html += `
          <div class="context-menu-item ${item.disabled ? 'disabled' : ''}" 
               data-action="${item.action}">
            <span class="context-menu-icon">${item.icon}</span>
            <span class="context-menu-label">${item.label}</span>
          </div>
        `;
      }
    }

    menu.innerHTML = html;
    this.container.appendChild(menu);
    this.menuElement = menu;

    // 绑定点击事件
    menu.querySelectorAll('.context-menu-item').forEach((itemEl) => {
      itemEl.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = (itemEl as HTMLElement).dataset.action;
        if (action && !(itemEl as HTMLElement).classList.contains('disabled')) {
          this.onAction(action, data);
          this.hide();
        }
      });
    });

    // 确保菜单不超出屏幕
    setTimeout(() => {
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        menu.style.left = `${x - rect.width}px`;
      }
      if (rect.bottom > window.innerHeight) {
        menu.style.top = `${y - rect.height}px`;
      }
    }, 0);
  }

  /** 隐藏菜单 */
  hide(): void {
    if (this.menuElement) {
      this.menuElement.remove();
      this.menuElement = null;
    }
  }
}
