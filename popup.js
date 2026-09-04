// 关键词高亮助手 - 弹窗
const DEFAULT_COLOR = '#ffe066'; // 默认高亮颜色：黄色
const PRESETS = ['#ffe066', '#ffd8a8', '#ffc9c9', '#fcc2d7', '#d0bfff', '#a5d8ff', '#99e9f2', '#b2f2bb'];
const MAX_KEYWORDS = 100;
const PLACEHOLDER = '输入关键词，回车添加（支持逗号批量）';
const DEFAULTS = { enabled: true, caseSensitive: false, watchDom: true, keywords: [] };

let settings = { ...DEFAULTS, keywords: [] };
const $ = (sel) => document.querySelector(sel);

async function loadSettings() {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  settings = { ...DEFAULTS, ...stored };
  if (!Array.isArray(settings.keywords)) settings.keywords = [];
}

function saveSettings() {
  chrome.storage.sync.set(settings);
  // 内容脚本收到 storage 变更后重新高亮，稍等片刻再刷新计数
  setTimeout(updateCount, 600);
}

let placeholderTimer = 0;
function flashPlaceholder(msg) {
  const input = $('#new-keyword');
  input.placeholder = msg;
  clearTimeout(placeholderTimer);
  placeholderTimer = setTimeout(() => { input.placeholder = PLACEHOLDER; }, 1500);
}

function addKeywords(rawText) {
  const parts = rawText.split(/[,，、;；\n\t]+/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) return;
  const existing = new Set(settings.keywords.map(k => k.text.toLowerCase()));
  let added = 0;
  let dup = 0;
  for (const text of parts) {
    if (settings.keywords.length >= MAX_KEYWORDS) {
      flashPlaceholder(`最多 ${MAX_KEYWORDS} 个关键词`);
      break;
    }
    const key = text.toLowerCase();
    if (existing.has(key)) { dup += 1; continue; }
    existing.add(key);
    settings.keywords.push({ text, color: DEFAULT_COLOR });
    added += 1;
  }
  if (added === 0 && dup > 0) flashPlaceholder('该关键词已存在');
}

function render() {
  $('#enabled').checked = settings.enabled;
  $('#case-sensitive').checked = settings.caseSensitive;
  $('#watch-dom').checked = settings.watchDom;
  $('#batch-count').textContent = settings.keywords.length;

  const list = $('#keyword-list');
  list.replaceChildren();
  settings.keywords.forEach((kw, index) => {
    const li = document.createElement('li');

    const color = document.createElement('input');
    color.type = 'color';
    color.value = kw.color || DEFAULT_COLOR;
    color.title = '修改高亮颜色';
    color.addEventListener('input', () => { kw.color = color.value; saveSettings(); });

    const text = document.createElement('span');
    text.className = 'kw-text';
    text.textContent = kw.text;
    text.title = kw.text;

    const del = document.createElement('button');
    del.className = 'kw-del';
    del.textContent = '✕';
    del.title = '删除';
    del.addEventListener('click', () => {
      settings.keywords.splice(index, 1);
      saveSettings();
      render();
    });

    li.append(color, text, del);
    list.appendChild(li);
  });
  $('#empty').classList.toggle('hidden', settings.keywords.length > 0);
}

// 批量颜色：预设色板 + 自定义颜色，一键应用到全部关键词
function renderSwatches() {
  const box = $('#swatches');
  box.replaceChildren();
  for (const c of PRESETS) {
    const btn = document.createElement('button');
    btn.className = 'swatch';
    btn.dataset.color = c;
    btn.style.background = c;
    btn.title = `全部设为 ${c}`;
    btn.addEventListener('click', () => {
      $('#batch-color').value = c;
      applyColorToAll(c);
    });
    box.appendChild(btn);
  }
}

function applyColorToAll(color) {
  settings.keywords.forEach(k => { k.color = color; });
  saveSettings();
  render();
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setCount(text) {
  $('#count').textContent = text;
}

async function updateCount() {
  const tab = await getActiveTab();
  if (!tab) { setCount('当前页高亮 — 处'); return; }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'kwh-get-count' });
    setCount(`当前页高亮 ${res?.count ?? 0} 处`);
  } catch {
    setCount('此页面未生效，点「重新扫描」注入');
  }
}

// 页面在扩展安装前就已打开时，内容脚本未被注入，这里程序化补注入
async function ensureInjected(tabId) {
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return true;
  } catch {
    return false;
  }
}

async function rescan() {
  const tab = await getActiveTab();
  if (!tab) return;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'kwh-rescan' });
    setCount(`当前页高亮 ${res?.count ?? 0} 处`);
    return;
  } catch { /* 未注入，走下方补注入流程 */ }
  if (await ensureInjected(tab.id)) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'kwh-rescan' });
      setCount(`当前页高亮 ${res?.count ?? 0} 处`);
      return;
    } catch { /* 注入了但仍无法通信，按不支持处理 */ }
  }
  setCount('此页面不支持高亮');
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  render();
  renderSwatches();
  updateCount();

  const input = $('#new-keyword');
  const handleAdd = () => {
    addKeywords(input.value);
    input.value = '';
    render();
    saveSettings();
  };
  $('#add-btn').addEventListener('click', handleAdd);
  input.addEventListener('keydown', (e) => {
    // 中文输入法组词期间按回车是确认候选词，不触发添加；上屏后再按一次回车或点「添加」
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') handleAdd();
  });

  $('#apply-batch').addEventListener('click', () => applyColorToAll($('#batch-color').value));

  $('#enabled').addEventListener('change', (e) => { settings.enabled = e.target.checked; saveSettings(); });
  $('#case-sensitive').addEventListener('change', (e) => { settings.caseSensitive = e.target.checked; saveSettings(); });
  $('#watch-dom').addEventListener('change', (e) => { settings.watchDom = e.target.checked; saveSettings(); });
  $('#refresh').addEventListener('click', rescan);
});
