// 关键词高亮助手 端到端测试
// 用法：npm install && npm test
// 需要一个 Chromium 内核浏览器可执行文件：
//   1) 设置环境变量 CHROME_BIN 指向 Chrome / Chromium / Edge / Chrome for Testing
//   2) 未设置时尝试 playwright 管理的 Chromium，再退回到本机 Chrome for Testing 缓存路径
const http = require('http');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const os = require('os');
const EXT = path.resolve(__dirname, '..');
const PAGES = path.join(__dirname, 'pages');
const PORT = Number(process.env.TEST_PORT || 8899);
const PROFILE = path.join(os.tmpdir(), `kwh-pw-profile-${Date.now()}`);

// 在 playwright 浏览器缓存里找已安装的 Chromium（版本目录取字典序最大）
function findCachedChromium() {
  const cacheRoots = [
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
  ];
  const candidates = [
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-linux/chrome',
  ];
  for (const root of cacheRoots) {
    let dirs = [];
    try {
      dirs = fs.readdirSync(root)
        .filter(d => d.startsWith('chromium-') && !d.includes('headless'))
        .sort()
        .reverse();
    } catch { continue; }
    for (const dir of dirs) {
      for (const rel of candidates) {
        const p = path.join(root, dir, rel);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

function resolveBrowser() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  try {
    const p = chromium.executablePath();
    if (p && fs.existsSync(p)) return p; // playwright 管理的浏览器已下载
  } catch { /* 未安装 playwright 浏览器 */ }
  const fallback = findCachedChromium();
  if (fallback) return fallback;
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
    check('input 内不插入 mark', await page.evaluate(() => !document.querySelector('input mark')));

    // 只读/禁用表单控件整框高亮，可编辑控件不动
    check('只读输入框整框高亮（默认黄色）', await page.evaluate(() => {
      const el = document.querySelector('#ro');
      return el.classList.contains('kwh-field')
        && getComputedStyle(el).backgroundColor === 'rgb(255, 224, 102)';
    }));
    check('禁用下拉框整框高亮', await page.evaluate(() => !!document.querySelector('select[disabled].kwh-field')));
    check('可编辑输入框不高亮', await page.evaluate(() => !document.getElementById('box').classList.contains('kwh-field')));

    const frame = page.frames().find(f => f !== page.mainFrame());
    await frame.waitForSelector('mark.kwh-mark', { timeout: 3000 }).catch(() => null);
    check('iframe 内 2 处高亮', await frame.evaluate(() => document.querySelectorAll('mark.kwh-mark').length) === 2);

    // 增量重扫：无关 DOM 变更不应清掉重建已有高亮（节点身份不变 = 无闪烁）
    const markBefore = await page.$('mark.kwh-mark');
    await page.evaluate(() => {
      const d = document.createElement('div');
      d.id = 'churn-unrelated';
      d.textContent = '无关内容';
      document.body.appendChild(d);
    });
    await sleep(1100);
    const markAfter = await page.$('mark.kwh-mark');
    const sameNode = await page.evaluate(([a, b]) => a === b, [markBefore, markAfter]);
    check('页面变化触发重扫时保留已有高亮（增量，无闪烁）', sameNode === true && await page.evaluate(() => document.querySelectorAll('mark.kwh-mark').length) === 6);

    // 数字容差匹配：关键词 100% 应命中 100/100.0/100.00/带空格/全角等变体，不误伤其他数字
    await popup.fill('#new-keyword', '100%');
    await popup.press('#new-keyword', 'Enter');
    await sleep(900);
    const numMarks = await page.evaluate(() =>
      [...document.querySelectorAll('#numvar mark.kwh-mark')].map(m => m.textContent));
    check('数字容差：100% 命中 4 种写法变体', JSON.stringify(numMarks) === JSON.stringify(['100%', '100.00%', '100 %', '100.0%']), JSON.stringify(numMarks));
    check('数字容差：不误伤 1000.00% 与 99.75%', numMarks.length === 4 && await page.evaluate(() =>
      ![...document.querySelectorAll('#numvar mark.kwh-mark')].some(m => m.textContent.includes('75') || m.textContent.startsWith('1000'))));
    // 移除数字关键词并删掉测试段，恢复基线计数
    await popup.evaluate(() => {
      const li = [...document.querySelectorAll('#keyword-list li')].find(el => el.querySelector('.kw-text')?.textContent === '100%');
      li?.querySelector('.kw-del')?.click();
    });
    await page.evaluate(() => document.getElementById('numvar')?.remove());
    await sleep(900);
    check('移除数字关键词后计数恢复', await page.evaluate(() => document.querySelectorAll('mark.kwh-mark').length) === 6);

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

    // 模拟后台系统轮询重渲染：框架把高亮连同旧文字一起抹掉再写入新内容（同一批次）
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.className = 'rwipe';
      p.textContent = '轮询数据 Chrome 首次渲染';
      document.body.appendChild(p);
    });
    await sleep(1300);
    check('轮询新增文字自动高亮', await page.evaluate(() => document.querySelector('.rwipe mark.kwh-mark')?.textContent === 'Chrome'));

    await page.evaluate(() => {
      document.querySelector('.rwipe').textContent = '轮询数据 Chrome 重渲染后';
    });
    await sleep(1500);
    check('页面重渲染抹掉后自动恢复高亮', await page.evaluate(() => document.querySelector('.rwipe mark.kwh-mark')?.textContent === 'Chrome'));

    // 模拟后台高频轮询：反复整段重写（抹掉高亮），高亮应稳定恢复且数量不失控
    await page.evaluate(() => {
      window.__wipes = 0;
      window.__wipeTimer = setInterval(() => {
        window.__wipes += 1;
        const p = document.querySelector('.rwipe');
        if (p) p.textContent = `轮询数据 Chrome 第${window.__wipes}次重写`;
      }, 400);
    });
    await sleep(3400);
    const churn = await page.evaluate(() => ({
      wipes: window.__wipes,
      total: document.querySelectorAll('mark.kwh-mark').length,
      rwipe: document.querySelector('.rwipe mark.kwh-mark')?.textContent,
    }));
    await page.evaluate(() => clearInterval(window.__wipeTimer));
    await sleep(1000);
    check('高频轮询下高亮稳定恢复且数量不失控', churn.wipes >= 6 && churn.rwipe === 'Chrome' && churn.total === 7, JSON.stringify(churn));
  } finally {
    if (context) await context.close().catch(() => {});
    server.close();
    fs.rmSync(PROFILE, { recursive: true, force: true });
  }

  const pass = results.every(Boolean);
  console.log(pass ? '== ALL PASS ==' : '== SOME FAILED ==');
  process.exit(pass ? 0 : 1);
})().catch(e => { console.error('ERROR:', e.message); process.exit(2); });
