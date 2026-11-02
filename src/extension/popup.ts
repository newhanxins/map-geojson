/**
 * Chrome Extension Popup 脚本
 * 处理 popup 页面的交互逻辑
 */

document.addEventListener('DOMContentLoaded', () => {
  // 打开完整查看器
  document.getElementById('btnOpenViewer')?.addEventListener('click', () => {
    // 在新标签页中打开查看器页面
    chrome.tabs.create({
      url: 'https://mapshaper.org/',
    });
    window.close();
  });

  // 检测当前页面的 GeoJSON 链接
  document.getElementById('btnLoadPage')?.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'detect-geojson' }, (response) => {
        if (response?.urls?.length) {
          // 显示找到的 GeoJSON 链接
          showDetectedUrls(response.urls);
        } else {
          showMessage('当前页面未检测到 GeoJSON 链接');
        }
      });
    }
  });

  // 粘贴 GeoJSON
  document.getElementById('btnPasteJson')?.addEventListener('click', () => {
    const pasteSection = document.getElementById('pasteSection');
    if (pasteSection) {
      pasteSection.style.display = pasteSection.style.display === 'none' ? 'block' : 'none';
    }
  });

  // 查看粘贴的 GeoJSON
  document.getElementById('btnViewPasted')?.addEventListener('click', () => {
    const textarea = document.getElementById('pasteArea') as HTMLTextAreaElement;
    const text = textarea?.value?.trim();
    if (text) {
      try {
        JSON.parse(text); // 验证 JSON
        // 存储到临时 storage 并打开查看器
        chrome.storage?.local?.set({ pastedGeoJSON: text }, () => {
          chrome.tabs.create({
            url: chrome.runtime.getURL('src/popup.html') + '?mode=viewer&source=paste',
          });
          window.close();
        });
      } catch {
        showMessage('JSON 格式无效');
      }
    }
  });
});

/** 显示检测到的 GeoJSON URL */
function showDetectedUrls(urls: string[]): void {
  const body = document.querySelector('.popup-body');
  if (!body) return;

  const section = document.createElement('div');
  section.className = 'section';
  section.innerHTML = `
    <div class="section-title">检测到的 GeoJSON 链接 (${urls.length})</div>
    ${urls.slice(0, 5).map((url) => `
      <button class="btn geo-url-btn" data-url="${escapeAttr(url)}" style="font-size:11px;">
        <span class="btn-icon">&#128279;</span>
        <span class="btn-text" style="overflow:hidden;text-overflow:ellipsis;">${escapeHtml(url.length > 50 ? url.slice(0, 50) + '...' : url)}</span>
      </button>
    `).join('')}
  `;
  body.appendChild(section);

  // 绑定点击事件
  section.querySelectorAll('.geo-url-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = (btn as HTMLElement).dataset.url;
      if (url) {
        chrome.tabs.create({
          url: chrome.runtime.getURL('src/popup.html') + '?mode=viewer&url=' + encodeURIComponent(url),
        });
        window.close();
      }
    });
  });
}

/** 显示消息 */
function showMessage(msg: string): void {
  const existing = document.querySelector('.popup-message');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = 'popup-message';
  el.style.cssText = 'padding:8px;background:#f0f2f5;border-radius:6px;font-size:12px;color:#5c6370;text-align:center;margin:8px 0;';
  el.textContent = msg;

  const body = document.querySelector('.popup-body');
  body?.appendChild(el);

  setTimeout(() => el.remove(), 3000);
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str: string): string {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
