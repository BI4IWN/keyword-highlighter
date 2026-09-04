// 关键词高亮助手 端到端测试
// 用法：npm install && npm test
// 需要一个 Chromium 内核浏览器可执行文件：
//   1) 设置环境变量 CHROME_BIN 指向 Chrome / Chromium / Edge / Chrome for Testing
//   2) 未设置时尝试 playwright 管理的 Chromium，再退回到本机 Chrome for Testing 缓存路径
const http = require('http');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const EXT = path.resolve(__dirname, '..');
const PAGES = path.join(__dirname, 'pages');
const PORT = Number(process.env.TEST_PORT || 8899);
const PROFILE = path.join(require('os').tmpdir(), `kwh-pw-profile-${Date.now()}`);
const FALLBACK_EXE = '/Users/imac/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

function resolveBrowser() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  try {
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p; // playwright 管理的浏览器已下载
  } catch { /* 未安装 playwright 浏览器 */ }
  if (fs.existsSync(FALLBACK_EXE)) return FALLBACK_EXE;
  throw new Error('未找到浏览器：请设置 CHROME_BIN 环境变量指向 Chrome/Chromium 可执行文件');
}

function startServer(root, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const filePath = path.join(root, urlPath === '/' ? 'test.html' : urlPath);
      if (!filePath.startsWith(root)) { res.writeHead(403); return res.end(); }
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': filePath.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream' });
        res.end(data);
      });
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

const results = [];
function check(name, cond, detail = '') {
  results.push(cond);
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}${detail ? ' :: ' + detail : ''}`);
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = await startServer(PAGES, PORT);
  let context;
  try {
    context = await chromium.launchPersistentContext(PROFILE, {
      headless: false,
      executablePath: resolveBrowser(),
      args: [
        `--disable-extensions-except=${EXT}`,
        `--load-extension=${EXT}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });

    let sw = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'));
    for (let i = 0; i < 60 && !sw; i++) {
      await sleep(250);
      sw = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'));
    }
    if (!sw) throw new Error('扩展 Service Worker 未启动（--load-extension 可能未生效）');
    const extId = new URL(sw.url()).host;
    console.log('扩展已加载, id =', extId);

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extId}/popup.html`);

    await popup.fill('#new-keyword', 'Chrome, 高亮');
    await popup.press('#new-keyword', 'Enter');
    await sleep(300);
    check('弹窗批量添加 2 个关键词', await popup.locator('#keyword-list li').count() === 2);

    const listColors = await popup.evaluate(() =>
      [...document.querySelectorAll('#keyword-list input[type=color]')].map(i => i.value));
    check('新增关键词默认黄色 #ffe066', listColors.length === 2 && listColors.every(c => c === '#ffe066'), JSON.stringify(listColors));

    const page = await context.newPage();
    await page.goto(`http://localhost:${PORT}/test.html`);
    await sleep(1500);

    const markInfo = () => page.evaluate(() => {
      const out = { total: document.querySelectorAll('mark.kwh-mark').length, byTitle: {} };
      document.querySelectorAll('mark.kwh-mark').forEach(m => {
        const t = m.title;
        (out.byTitle[t] = out.byTitle[t] || new Set()).add(m.style.getPropertyValue('--kwh-color'));
      });
      out.byTitle = Object.fromEntries(Object.entries(out.byTitle).map(([k, v]) => [k, [...v]]));
      return out;
    });

    let info = await markInfo();
    check('主文档 6 处且全部默认黄色', info.total === 6 && Object.values(info.byTitle).every(([c]) => c === '#ffe066'), JSON.stringify(info));
    check('code 块内不高亮', await page.evaluate(() => !document.querySelector('code mark')));
    check('input 内不高亮', await page.evaluate(() => !document.querySelector('input mark')));

    const frame = page.frames().find(f => f !== page.mainFrame());
    await frame.waitForSelector('mark.kwh-mark', { timeout: 3000 }).catch(() => null);
    check('iframe 内 2 处高亮', await frame.evaluate(() => document.querySelectorAll('mark.kwh-mark').length) === 2);

    await popup.click('.swatch[data-color="#a5d8ff"]');
    await sleep(900);
    info = await markInfo();
    check('色板一键应用：全部变蓝 #a5d8ff', info.total === 6 && Object.values(info.byTitle).every(([c]) => c === '#a5d8ff'), JSON.stringify(info.byTitle));

    await popup.evaluate(() => {
      const el = document.querySelector('#batch-color');
      el.value = '#69db7c';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await popup.click('#apply-batch');
    await sleep(900);
    info = await markInfo();
    check('自定义颜色应用到全部：#69db7c', info.total === 6 && Object.values(info.byTitle).every(([c]) => c === '#69db7c'), JSON.stringify(info.byTitle));

    await popup.evaluate(() => {
      const el = document.querySelector('#keyword-list li input[type=color]');
      el.value = '#ffc9c9';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(900);
    info = await markInfo();
    check('逐词颜色仍有效：Chrome=粉，高亮=绿', info.byTitle['关键词：Chrome']?.[0] === '#ffc9c9' && info.byTitle['关键词：高亮']?.[0] === '#69db7c', JSON.stringify(info.byTitle));

    await popup.evaluate(() => document.querySelector('#case-sensitive').click());
    await sleep(900);
    check('区分大小写后主文档 = 4 处', await page.evaluate(() => document.querySelectorAll('mark.kwh-mark').length) === 4);

    await page.click('#add');
    await sleep(1300);
    check('动态插入内容自动扫描（+2 = 6 处）', await page.evaluate(() => document.querySelectorAll('mark.kwh-mark').length) === 6);

    await popup.evaluate(() => document.querySelector('#enabled').click());
    await sleep(900);
    check('关闭总开关后高亮清除', await page.evaluate(() => document.querySelectorAll('mark.kwh-mark').length) === 0);
    await popup.evaluate(() => document.querySelector('#enabled').click());
    await sleep(900);
    check('重新开启后高亮恢复（6 处）', await page.evaluate(() => document.querySelectorAll('mark.kwh-mark').length) === 6);

    await popup.evaluate(async (tabUrl) => {
      const [tab] = await chrome.tabs.query({ url: tabUrl });
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    }, `http://localhost:${PORT}/*`);
    await sleep(800);
    check('重复注入不产生重复高亮（守卫生效）', await page.evaluate(() => document.querySelectorAll('mark.kwh-mark').length) === 6);
  } finally {
    if (context) await context.close().catch(() => {});
    server.close();
    fs.rmSync(PROFILE, { recursive: true, force: true });
  }

  const pass = results.every(Boolean);
  console.log(pass ? '== ALL PASS ==' : '== SOME FAILED ==');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERROR:', e.message); process.exit(2); });
