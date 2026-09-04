// 关键词高亮助手 - 后台 Service Worker
// 职责：首次安装写入默认配置；安装/更新时为已打开的页面补注入内容脚本；角标计数。
const DEFAULTS = {
  enabled: true,
  caseSensitive: false,
  watchDom: true,
  keywords: []
};

chrome.runtime.onInstalled.addListener(async (details) => {
  const current = await chrome.storage.sync.get(DEFAULTS);
  const patch = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (current[key] === undefined) patch[key] = value;
  }
  if (Object.keys(patch).length) await chrome.storage.sync.set(patch);

  // 扩展安装/更新前就已打开的页面收不到 manifest 注入，这里主动补上，免去逐个手动刷新
  if (details.reason !== 'install' && details.reason !== 'update') return;
  try {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const tab of tabs) {
      try {
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      } catch { /* 该标签页暂时无法注入（如正在加载），刷新后由 manifest 接管 */ }
    }
  } catch { /* 无可注入标签页时忽略 */ }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'kwh-badge' && sender.tab) {
    const text = !msg.count ? '' : (msg.count > 999 ? '999+' : String(msg.count));
    chrome.action.setBadgeText({ tabId: sender.tab.id, text });
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: '#e8590c' });
    chrome.action.setBadgeTextColor?.({ tabId: sender.tab.id, color: '#ffffff' });
  }
});
