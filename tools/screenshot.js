// 生成 Chrome Web Store 商店截图（1280×800），输出到 store/screenshots/
// 用法: npm run screenshots （需先 npm install；浏览器探测规则同 test/test.js）
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright-core');

const EXT = path.resolve(__dirname, '..');
const PAGES = path.join(EXT, 'test', 'pages');
const OUT = path.join(EXT, 'store', 'screenshots');
const PORT = Number(process.env.TEST_PORT || 8901);
const FALLBACK_EXE = '/Users/imac/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';

function resolveBrowser() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  try {
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p;
  } catch { /* 未安装 playwright 浏览器 */ }
  if (fs.existsSync(FALLBACK_EXE)) return FALLBACK_EXE;
  throw new Error('未找到浏览器：请设置 CHROME_BIN 环境变量');
}

function startServer(root, port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const filePath = path.join(root, urlPath === '/' ? 'demo.html' : urlPath);
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

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const PROFILE = path.join(os.tmpdir(), `kwh-shot-${Date.now()}`);

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer(PAGES, PORT);
  let context;
  try {
    context = await chromium.launchPersistentContext(PROFILE, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      executablePath: resolveBrowser(),
      args: [
        `--disable-extensions-except=${EXT}`,
        `--load-extension=${EXT}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--window-size=1280,800',
      ],
    });

    let sw = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'));
    for (let i = 0; i < 60 && !sw; i++) {
      await sleep(250);
      sw = context.serviceWorkers().find(w => w.url().startsWith('chrome-extension://'));
    }
    if (!sw) throw new Error('扩展未加载');
    const extId = new URL(sw.url()).host;

    const popup = await context.newPage();
    await popup.setViewportSize({ width: 1280, height: 800 });
    await popup.goto(`chrome-extension://${extId}/popup.html`);
    await popup.fill('#new-keyword', 'Chrome, Edge, 高亮');
    await popup.press('#new-keyword', 'Enter');
    await sleep(300);

    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(`http://localhost:${PORT}/demo.html`);
    await page.waitForSelector('mark.kwh-mark', { timeout: 5000 });
    await sleep(500);

    // 1. 文章高亮效果（默认黄色）
    await page.screenshot({ path: path.join(OUT, '1-article.png') });
    console.log('已生成 1-article.png');

    // 3. 多彩逐词颜色（产品名红、浏览器蓝、动作绿）
    await popup.evaluate(() => {
      const rows = [...document.querySelectorAll('#keyword-list li input[type=color]')];
      const colors = ['#ffc9c9', '#a5d8ff', '#b2f2bb'];
      rows.forEach((el, i) => {
        el.value = colors[i % colors.length];
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
    await sleep(900);
    await page.screenshot({ path: path.join(OUT, '3-colors.png') });
    console.log('已生成 3-colors.png');

    // 2. 弹窗配置面板预览（居中 + 阴影背景）
    await popup.addStyleTag({
      content: `html { background: linear-gradient(160deg,#37474f,#78909c); height: 100vh; display: grid; place-items: center; }
                body { border-radius: 10px; box-shadow: 0 20px 60px rgba(0,0,0,.45); height: auto !important; }`,
    });
    await sleep(300);
    await popup.screenshot({ path: path.join(OUT, '2-popup.png') });
    console.log('已生成 2-popup.png');
  } finally {
    if (context) await context.close().catch(() => {});
    server.close();
    fs.rmSync(PROFILE, { recursive: true, force: true });
  }
})().catch(e => { console.error('ERROR:', e.message); process.exit(2); });
