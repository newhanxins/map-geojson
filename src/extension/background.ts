/**
 * Chrome Extension Background Service Worker
 * 处理扩展的后台逻辑
 */

// 监听扩展安装事件
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('GeoJSON Viewer installed');
  } else if (details.reason === 'update') {
    console.log('GeoJSON Viewer updated to', chrome.runtime.getManifest().version);
  }
});

// 监听来自 content script 或 popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'open-viewer') {
    // 在新标签页中打开完整查看器
    const viewerUrl = chrome.runtime.getURL('src/popup.html');
    chrome.tabs.create({ url: viewerUrl });
    sendResponse({ success: true });
  }

  if (message.type === 'load-geojson-url') {
    // 获取指定 URL 的 GeoJSON 数据
    const url = message.url;
    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((text) => {
        // 尝试解析为 JSON
        JSON.parse(text); // 验证 JSON 有效性
        sendResponse({ success: true, data: text });
      })
      .catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
    return true; // 异步响应
  }

  return false;
});

// 监听标签页更新，检测 GeoJSON 页面
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    // 如果 URL 以 .geojson 或 .topojson 结尾，自动提示
    if (tab.url.match(/\.(geojson|topojson)(\?.*)?$/i)) {
      chrome.action.setBadgeText({ tabId, text: '1' });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#4f8cff' });
    }
  }
});

export {};
