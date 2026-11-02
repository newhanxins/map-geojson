/**
 * Toast 消息提示组件
 */

let toastContainer: HTMLElement | null = null;

function getContainer(): HTMLElement {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    toastContainer.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 10000;
      display: flex;
      flex-direction: column-reverse;
      gap: 8px;
      pointer-events: none;
    `;
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

type ToastType = 'info' | 'success' | 'warning' | 'error';

/**
 * 显示 Toast 提示
 */
export function showToast(message: string, type: ToastType = 'info', duration = 3000): void {
  const container = getContainer();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.style.cssText = `
    padding: 10px 16px;
    border-radius: 8px;
    font-size: 13px;
    color: #fff;
    background: ${getBackgroundColor(type)};
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    pointer-events: auto;
    opacity: 0;
    transform: translateX(30px);
    transition: all 0.25s ease;
    max-width: 360px;
    cursor: pointer;
  `;
  toast.textContent = message;

  toast.onclick = () => removeToast(toast);
  container.appendChild(toast);

  // 触发动画
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(0)';
  });

  // 自动移除
  if (duration > 0) {
    setTimeout(() => removeToast(toast), duration);
  }
}

function removeToast(el: HTMLElement): void {
  el.style.opacity = '0';
  el.style.transform = 'translateX(30px)';
  setTimeout(() => el.remove(), 250);
}

function getBackgroundColor(type: ToastType): string {
  switch (type) {
    case 'success': return '#52c41a';
    case 'warning': return '#faad14';
    case 'error': return '#ff5252';
    case 'info':
    default: return '#4f8cff';
  }
}

/** 快捷方法 */
export const toast = {
  info: (msg: string, dur?: number) => showToast(msg, 'info', dur),
  success: (msg: string, dur?: number) => showToast(msg, 'success', dur),
  warning: (msg: string, dur?: number) => showToast(msg, 'warning', dur),
  error: (msg: string, dur?: number) => showToast(msg, 'error', dur),
};
