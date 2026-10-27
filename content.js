// 关键词高亮助手 - 内容脚本
// 职责：读取关键词配置，在页面正文中查找并包裹 <mark>，监听动态内容。
(() => {
  'use strict';

  // 同一扩展实例只注入一次（程序化补注入时防重复高亮）；
  // 扩展重载后旧脚本的 chrome.runtime.id 失效，允许新实例重新注入接管
  if (window.__kwhLoaded) {
    try {
      if (chrome.runtime?.id) return;
    } catch { return; }
  }
  window.__kwhLoaded = true;

  const MARK_CLASS = 'kwh-mark';
  const MARK_SELECTOR = `mark.${MARK_CLASS}`;
  const DEFAULT_COLOR = '#ffe066';

  // 只读/禁用表单控件无法插入 <mark>，改用整框着色（kwh-field）
  const FIELD_CLASS = 'kwh-field';
  // 这些控件类型的 value 含义特殊或不应触碰，不做整框高亮
  const FIELD_SKIP_TYPES = new Set([
    'hidden', 'checkbox', 'radio', 'button', 'submit', 'reset', 'image',
    'file', 'range', 'color', 'date', 'datetime-local', 'month', 'week',
    'time', 'password'
  ]);

  const DEFAULTS = {
    enabled: true,
    caseSensitive: false,
    watchDom: true,
    keywords: [] // [{ text: '关键词', color: '#ffe066' }]
  };

  // 输入框、编辑器、代码块等不做处理，避免破坏页面功能与用户输入
  const SKIP_SELECTOR = [
    'script', 'style', 'noscript', 'template', 'textarea', 'input', 'select',
    'option', 'iframe', 'canvas', 'svg', 'math', 'code', 'pre',
    '[contenteditable="true"]'
  ].join(',');

  let settings = { ...DEFAULTS };
  let observer = null;
  let scanTimer = 0;
  let lastCount = 0;
  // 自身 DOM 操作（清包装/包装/字段着色）的变更由 applying 标记抑制：
  // MutationObserver 回调在微任务中先于 setTimeout(0) 执行，重扫无论耗时多久
  // 都能确定性地跳过自身触发的变更，防止大页面上出现无限重扫循环（闪烁）
  let applying = false;
  let lastApplyAt = 0;

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 纯数字关键词（可带小数与百分号）→ 数字容差模式：
  // 「100%」可命中 100%、100 %、100.0%、100.00%、100％（全角）；
  // 「99.50%」命中 99.5%/99.50%/99.500% 但不命中 99.75%（保持数值语义）。
  // 页面文本里小数位多少、百分号前有无空格、全半角符号均不影响。
  function keywordPattern(rawText) {
    const text = rawText.trim();
    const m = text.match(/^(\d+)(?:[.,．](\d+))?\s*([%％])?$/);
    if (!m) return escapeRegExp(text);
    const [, int, frac = '', pct] = m;
    let fracPat;
    if (!frac) {
      fracPat = '(?:[.,．]\\d+)?'; // 整数关键词：可选任意小数位
    } else {
      const stripped = frac.replace(/0+$/, ''); // 去掉末尾 0 后的固定部分
      fracPat = stripped
        ? `[.,．]${stripped}0*`          // 99.50 → .5 / .50 / .500…
        : '(?:[.,．]0*)?';               // 100.00 → 可省略或任意个 0
    }
    const pctPat = pct ? '\\s*[%％]' : '';
    return `${int}${fracPat}${pctPat}`;
  }

  // 长词优先排序，避免短词在同一起点抢先匹配（如 "OpenAI" vs "AI"）
  function buildMatcher() {
    const kws = settings.keywords
      .filter(k => k && typeof k.text === 'string' && k.text.trim())
      .map(k => ({ text: k.text.trim(), color: k.color || DEFAULT_COLOR }))
      .sort((a, b) => b.text.length - a.text.length);
    if (!kws.length) return null;
    const pattern = kws.map(k => `(${keywordPattern(k.text)})`).join('|');
    try {
      return { regex: new RegExp(pattern, settings.caseSensitive ? 'g' : 'gi'), kws };
    } catch {
      return null;
    }
  }

  function clearMarks() {
    for (const mark of document.querySelectorAll(MARK_SELECTOR)) {
      const parent = mark.parentNode;
      if (!parent) continue;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      mark.remove();
      parent.normalize();
    }
  }

  // 在单个文本节点内拆分并包装所有命中片段，返回命中数
  function wrapMatches(textNode, matcher) {
    const text = textNode.nodeValue;
    matcher.regex.lastIndex = 0;
    const hits = [];
    let m;
    while ((m = matcher.regex.exec(text)) !== null) {
      if (m[0].length === 0) { matcher.regex.lastIndex += 1; continue; }
      let ki = 0;
      for (let i = 1; i < m.length; i += 1) {
        if (m[i] !== undefined) { ki = i - 1; break; }
      }
      hits.push({ start: m.index, end: m.index + m[0].length, ki });
    }
    if (!hits.length) return 0;

    let count = 0;
    let cur = textNode; // cur 的内容从原文偏移 base 处开始
    let base = 0;
    for (const hit of hits) {
      if (hit.start > base) {
        cur = cur.splitText(hit.start - base);
        base = hit.start;
      }
      let after = null;
      if (hit.end - base < cur.nodeValue.length) {
        after = cur.splitText(hit.end - base);
      }
      const mark = document.createElement('mark');
      mark.className = MARK_CLASS;
      mark.style.setProperty('--kwh-color', matcher.kws[hit.ki].color);
      mark.title = `关键词：${matcher.kws[hit.ki].text}`;
      cur.parentNode.insertBefore(mark, cur);
      mark.appendChild(cur);
      count += 1;
      if (!after) break;
      cur = after;
      base = hit.end;
    }
    return count;
  }

  function cleanupField(el) {
    if (!el.classList.contains(FIELD_CLASS) && !el.dataset.kwh) return;
    el.classList.remove(FIELD_CLASS);
    el.style.removeProperty('--kwh-color');
    delete el.dataset.kwh;
    el.removeAttribute('title');
  }

  function clearFields() {
    for (const el of document.querySelectorAll(`.${FIELD_CLASS}`)) cleanupField(el);
  }

  // 只读/禁用的输入框、下拉框：值命中关键词时整框着色；可编辑控件不动，避免干扰输入
  function highlightFields(matcher) {
    let count = 0;
    for (const el of document.querySelectorAll('input, textarea, select')) {
      const type = (el.type || '').toLowerCase();
      if (FIELD_SKIP_TYPES.has(type)) continue;
      if (!(el.disabled || el.readOnly === true)) { cleanupField(el); continue; }
      const value = el.tagName === 'SELECT' ? (el.selectedOptions[0]?.text ?? '') : el.value;
      if (!value) { cleanupField(el); continue; }
      matcher.regex.lastIndex = 0;
      let m;
      let hits = 0;
      let hitKi = -1;
      while ((m = matcher.regex.exec(value)) !== null) {
        if (m[0].length === 0) { matcher.regex.lastIndex += 1; continue; }
        hits += 1;
        if (hitKi === -1) {
          for (let i = 1; i < m.length; i += 1) {
            if (m[i] !== undefined) { hitKi = i - 1; break; }
          }
        }
      }
      if (hits > 0) {
        el.classList.add(FIELD_CLASS);
        el.style.setProperty('--kwh-color', matcher.kws[hitKi].color);
        el.dataset.kwh = '1';
        el.title = `关键词：${matcher.kws[hitKi].text}`;
        count += hits;
      } else {
        cleanupField(el);
      }
    }
    return count;
  }

  function scan(root, matcher) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const el = node.parentElement;
        if (!el || el.closest(SKIP_SELECTOR) || el.closest(MARK_SELECTOR)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    // 先收集再修改，避免边遍历边改树
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let count = 0;
    for (const node of nodes) count += wrapMatches(node, matcher);
    return count;
  }

  // 增量模式下检查已有 mark：文本不再命中任何关键词（如框架原地改写了文字）则拆掉；
  // 用 matcher 本身测试而非字符串 includes，保持与实际匹配规则一致（数字容差等）
  function unwrapStaleMarks(matcher) {
    for (const mark of document.querySelectorAll(MARK_SELECTOR)) {
      matcher.regex.lastIndex = 0;
      const stale = !matcher.regex.test(mark.textContent);
      if (stale) {
        const parent = mark.parentNode;
        if (!parent) continue;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        mark.remove();
        parent.normalize();
      }
    }
  }

  // full=true（初始化/配置变更/手动重扫）：清空后全量重建
  // full=false（页面变化触发）：增量补齐，保留已有高亮，避免整页闪烁
  function apply(full = true) {
    applying = true;
    lastApplyAt = Date.now();
    try {
      const matcher = settings.enabled ? buildMatcher() : null;
      if (full || !matcher) {
        clearMarks();
        clearFields();
      } else {
        unwrapStaleMarks(matcher);
      }
      if (matcher && document.body) {
        scan(document.body, matcher);
        highlightFields(matcher);
      }
      // 计数读取当前 DOM 的真实总量（而非本轮新增量——增量重扫后新增为 0
      // 会让计数归零）。口径：页面命中的总量，含需滚动/展开后才可见的内容
      if (matcher && document.body) {
        lastCount = document.querySelectorAll(MARK_SELECTOR).length
          + document.querySelectorAll(`.${FIELD_CLASS}`).length;
      } else {
        lastCount = 0;
      }
      // 角标只统计主框架，iframe 中的高亮不计入，避免计数不准
      if (window.top === window) {
        try {
          chrome.runtime.sendMessage({ type: 'kwh-badge', count: lastCount });
        } catch { /* 扩展重载后旧脚本失效，忽略 */ }
      }
    } finally {
      // 自身变更在微任务里送达观察器，宏任务复位标记，确保全部被忽略
      setTimeout(() => { applying = false; }, 0);
    }
  }

  function scheduleApply(delay = 200) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => apply(false), delay);
  }

  function setupObserver() {
    if (observer) { observer.disconnect(); observer = null; }
    if (!settings.enabled || !settings.watchDom || !document.body) return;
    observer = new MutationObserver(() => {
      if (applying) return;
      // 静默期到达的零星变更（如后台轮询单次重渲染）立即同步恢复——
      // 观察器回调在微任务中、本帧绘制前执行，抹除与恢复落在同一帧，视觉无闪烁；
      // 密集变更期（如 SPA 初次渲染）退回去抖批量处理，避免反复全量扫描
      if (Date.now() - lastApplyAt > 150) {
        apply(false);
        return;
      }
      scheduleApply();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  async function init() {
    const stored = await chrome.storage.sync.get(DEFAULTS);
    settings = { ...DEFAULTS, ...stored };
    if (!Array.isArray(settings.keywords)) settings.keywords = [];
    apply();
    setupObserver();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, change] of Object.entries(changes)) settings[key] = change.newValue;
    if (!Array.isArray(settings.keywords)) settings.keywords = [];
    apply();
    setupObserver();
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'kwh-get-count') sendResponse({ count: lastCount });
    if (msg?.type === 'kwh-rescan') { apply(); sendResponse({ count: lastCount }); }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
