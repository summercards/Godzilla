#!/usr/bin/env node
/* ------------------------------------------------------------------------- *
 * 迷你电视模式 · 开发期核对工具
 *
 * 用应用真实的档位参数（tv-config.js）把原版画面渲染出来抓图，
 * 并把版面实测值、注入后的 app-region 一起打回来——靠数据而不是靠眼看。
 *
 * 用法：
 *   electron build/tv-shot.cjs --size=medium --tv --out=/tmp/tv.png
 *
 * 参数：
 *   --size      档位 small|medium|large，取 tv-config.js 里的真实尺寸
 *   --w --h     也可以直接指定窗口尺寸（此时 --zoom 必须一起给）
 *   --zoom      缩放系数；给 --size 时会按 w/1280 自动算
 *   --tv        注入拖动区域 CSS（与应用完全同一份），并回读 app-region
 *   --wait      等待毫秒数，默认 6000（让世界跑一会儿再抓）
 *   --pad       窗口留白涂成的颜色（不带 #），默认 ff00ff，便于看出边界
 *   --url       换一个页面来抓，默认原版游戏
 *   --out       输出 PNG 路径
 * ------------------------------------------------------------------------- */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { TV_SIZES, TV_DRAG_CSS, zoomFor } = require('../tv-config.js');

const argv = {};
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) argv[m[1]] = m[2] === undefined ? true : m[2];
}

const preset = argv.size ? TV_SIZES[argv.size] : null;
if (argv.size && !preset) {
  console.error('未知档位：' + argv.size + '（可选 ' + Object.keys(TV_SIZES).join('/') + '）');
  process.exit(2);
}

const W = +(preset ? preset.w : argv.w || TV_SIZES.medium.w);
const H = +(preset ? preset.h : argv.h || TV_SIZES.medium.h);
const ZOOM = argv.zoom !== undefined ? +argv.zoom : zoomFor(W);
const WAIT = +(argv.wait || 6000);
const PAD = '#' + (argv.pad || 'ff00ff');
const OUT = argv.out || '/tmp/tv-shot.png';
const PAGE = argv.url
  ? path.resolve(argv.url)
  : path.join(__dirname, '..', 'tv', 'index.html');

/* 用独立的临时 userData，保证每次跑都是干净存档，截图结果可复现 */
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tv-shot-')));

const problems = [];

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: W,
    height: H,
    show: false,
    backgroundColor: PAD,
    frame: false,
    hasShadow: false,
    resizable: false,
    fullscreenable: false,
    webPreferences: { backgroundThrottling: false },
  });

  // 控制台报错要抓住——原版在 file:// 下偶尔会有加载告警
  win.webContents.on('console-message', (...a) => {
    const d = a[0] && typeof a[0] === 'object' ? a[0] : { level: a[1], message: a[2] };
    const lv = String(d.level ?? '');
    if (lv === 'error' || lv === '3') problems.push(String(d.message || '').slice(0, 200));
  });

  await win.loadFile(PAGE);
  win.webContents.setZoomFactor(ZOOM);
  if (argv.tv) await win.webContents.insertCSS(TV_DRAG_CSS);
  await new Promise((r) => setTimeout(r, WAIT));

  // 实测版面，不靠估算
  const probe = await win.webContents.executeJavaScript(`(() => {
    const box = (s) => { const e = document.querySelector(s); if (!e) return null;
      const r = e.getBoundingClientRect();
      return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), x: +r.left.toFixed(1), y: +r.top.toFixed(1) }; };
    const region = (s) => { const e = document.querySelector(s); if (!e) return 'missing';
      const v = getComputedStyle(e).webkitAppRegion;
      return v || 'none'; };
    const q = (s) => document.querySelector(s);
    return {
      innerW: innerWidth, innerH: innerHeight,
      scrollH: document.documentElement.scrollHeight,
      shell: box('.shell'), header: box('header'),
      stage: box('#playerFrame'), footer: box('footer'),
      regions: { body: region('body'), shell: region('.shell'), header: region('header'),
                 footer: region('footer'), dock: region('.pixel-dock') },
      title: (q('.network b') || {}).textContent || '',
      level: (q('#level') || {}).textContent || '',
    };
  })()`);

  const px = (v) => (v === null || v === undefined ? 'n/a' : (v * ZOOM).toFixed(0));
  const b = (o) => (o ? o.w + '×' + o.h : 'n/a');

  fs.writeFileSync(OUT, (await win.webContents.capturePage()).toPNG());

  console.log(
    'WINDOW   ' + W + '×' + H + '  zoom=' + ZOOM.toFixed(4) +
    '  → 视口 ' + probe.innerW + '×' + probe.innerH
  );
  console.log(
    'VIEWPORT shell=' + b(probe.shell) + '  stage=' + b(probe.stage) +
    '  header=' + b(probe.header) + '  footer=' + b(probe.footer) +
    '  scrollH=' + probe.scrollH
  );
  console.log(
    'ONS      shell=' + px(probe.shell && probe.shell.w) + '×' + px(probe.shell && probe.shell.h) +
    '  stage=' + px(probe.stage && probe.stage.w) + '×' + px(probe.stage && probe.stage.h) +
    '  header=' + px(probe.header && probe.header.h) +
    '  footer=' + (probe.footer ? px(probe.footer.h) : 'hidden')
  );
  if (argv.tv) {
    const r = probe.regions;
    console.log(
      'REGION   body=' + r.body + '  shell=' + r.shell + '  header=' + r.header +
      '  footer=' + r.footer + '  dock=' + r.dock
    );
  }
  console.log('SAVED    ' + OUT);
  console.log('ERRORS   ' + (problems.length ? problems.join(' | ') : 'none'));

  app.exit(0);
});
