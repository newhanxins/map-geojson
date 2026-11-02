/**
 * Web 模式入口
 * 初始化应用并加载样式
 */

// 样式
import '../styles/main.css';
import '../styles/sidebar.css';
import '../styles/toolbar.css';

// MapLibre GL CSS (通过 link 标签在 HTML 中加载)

// 应用
import { App } from '../core/app';

// 初始化应用
const app = new App();

async function bootstrap() {
  try {
    await app.init();
    console.log('GeoJSON Viewer ready');
  } catch (err) {
    console.error('Failed to initialize GeoJSON Viewer:', err);
  }
}

// module 脚本是 deferred 的，DOMContentLoaded 可能已经触发
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}
