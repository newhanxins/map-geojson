/**
 * 拖拽上传区域组件
 * 支持拖拽文件到页面加载 GeoJSON
 */

export class DropZone {
  private overlay: HTMLElement;
  private onFilesDropped: (files: FileList) => void;
  private dragCounter = 0;

  constructor(overlayId: string, onFilesDropped: (files: FileList) => void) {
    this.overlay = document.getElementById(overlayId) || document.createElement('div');
    this.onFilesDropped = onFilesDropped;
    this.init();
  }

  private init(): void {
    // 确保覆盖层有样式
    if (this.overlay) {
      this.overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(79, 140, 255, 0.15);
        border: 3px dashed #4f8cff;
        z-index: 9998;
        display: none;
        align-items: center;
        justify-content: center;
        pointer-events: none;
      `;
    }

    const body = document.body;

    body.addEventListener('dragenter', (e) => {
      e.preventDefault();
      this.dragCounter++;
      if (this.hasFiles(e as DragEvent)) {
        this.show();
      }
    });

    body.addEventListener('dragleave', (e) => {
      e.preventDefault();
      this.dragCounter--;
      if (this.dragCounter <= 0) {
        this.dragCounter = 0;
        this.hide();
      }
    });

    body.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    });

    body.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dragCounter = 0;
      this.hide();

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        this.onFilesDropped(files);
      }
    });
  }

  private hasFiles(e: DragEvent): boolean {
    if (e.dataTransfer?.types) {
      for (const type of e.dataTransfer.types) {
        if (type === 'Files') return true;
      }
    }
    return false;
  }

  private show(): void {
    if (this.overlay) {
      this.overlay.style.display = 'flex';
    }
  }

  private hide(): void {
    if (this.overlay) {
      this.overlay.style.display = 'none';
    }
  }

  destroy(): void {
    // 清理事件监听器（简化处理）
  }
}
