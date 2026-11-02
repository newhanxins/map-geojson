/**
 * Chrome Extension Content Script
 * 注入到页面中，检测页面内的 GeoJSON 链接
 */

(function () {
  // 监听来自 popup 或 background 的消息
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'detect-geojson') {
      const urls = detectGeoJSONLinks();
      sendResponse({ urls });
    }

    if (message.type === 'get-page-content') {
      // 获取页面文本内容（如果是 JSON 页面）
      const text = getPageTextContent();
      sendResponse({ text });
    }

    return false;
  });

  /**
   * 检测页面中的 GeoJSON 链接
   */
  function detectGeoJSONLinks(): string[] {
    const urls: Set<string> = new Set();

    // 检测 <a> 标签
    const links = document.querySelectorAll('a[href]');
    links.forEach((link) => {
      const href = (link as HTMLAnchorElement).href;
      if (isGeoJSONUrl(href)) {
        urls.add(href);
      }
    });

    // 检测 <pre> 和 <code> 标签中的 JSON 内容
    const codeBlocks = document.querySelectorAll('pre, code');
    codeBlocks.forEach((block) => {
      const text = block.textContent || '';
      if (looksLikeGeoJSON(text)) {
        // 这不是 URL，但可能是 GeoJSON 数据
        // 暂时不处理内联数据
      }
    });

    // 检测页面 URL 本身
    if (isGeoJSONUrl(window.location.href)) {
      urls.add(window.location.href);
    }

    return Array.from(urls);
  }

  /**
   * 判断 URL 是否指向 GeoJSON 文件
   */
  function isGeoJSONUrl(url: string): boolean {
    const lower = url.toLowerCase();
    return (
      lower.endsWith('.geojson') ||
      lower.endsWith('.topojson') ||
      lower.includes('geojson') ||
      lower.includes('format=geojson') ||
      lower.match(/\.json.*geo/i) !== null
    );
  }

  /**
   * 检测文本是否看起来像 GeoJSON
   */
  function looksLikeGeoJSON(text: string): boolean {
    try {
      const data = JSON.parse(text.trim());
      if (data.type === 'FeatureCollection' || data.type === 'Feature' || data.type === 'Topology') {
        return true;
      }
      if (data.type && data.coordinates) {
        return true;
      }
    } catch {
      // not JSON
    }
    return false;
  }

  /**
   * 获取页面文本内容
   */
  function getPageTextContent(): string {
    // 优先从 <pre> 标签获取（Chrome JSON 查看器格式）
    const pre = document.querySelector('pre');
    if (pre) return pre.textContent || '';

    // 否则从 body 获取
    return document.body?.textContent?.trim() || '';
  }

  // 如果当前页面是 GeoJSON 文件，自动通知 background
  if (isGeoJSONUrl(window.location.href)) {
    chrome.runtime.sendMessage({
      type: 'geojson-detected',
      url: window.location.href,
    });
  }
})();
