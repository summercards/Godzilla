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

const { TV_SIZES, TV_DRAG_CSS, PANEL_ONLY_CSS, PANEL_READABLE_CSS, zoomFor } = require('../tv-config.js');

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
const PANEL = argv.panel === true || argv.panel === 'true';
const STAGE = argv.stage || 'village';

/* 用独立的临时 userData，保证每次跑都是干净存档，截图结果可复现 */
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tv-shot-')));

const problems = [];

async function runContract() {
  const assert = require('node:assert/strict');
  const waitFor = async (probe, label) => {
    const end = Date.now() + 10000;
    while (Date.now() < end) {
      if (await probe()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('等待失败：' + label);
  };
  await waitFor(() => BrowserWindow.getAllWindows().length === 1, '主电视创建');
  const main = BrowserWindow.getAllWindows()[0];
  const execute = (w, js) => w.webContents.executeJavaScript(js);
  const snapshot = async w => JSON.parse(await execute(w, 'window.__growth.snapshot()'));
  await waitFor(() => execute(main, '!!window.__growth'), '主屏就绪');
  assert.equal(app.getPath('userData').includes('tv-shot-'), true, '只能使用隔离存档');
  assert.equal((await snapshot(main)).assign, 4);
  const mainZoom = main.webContents.getZoomFactor();
  const layout = w => execute(w, `JSON.stringify({width:innerWidth,height:innerHeight,boxes:['.shell','#playerFrame','#game'].map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [r.x,r.y,r.width,r.height]})})`);
  const mainLayout = await layout(main);
  await execute(main, "document.getElementById('open-talent').click()");
  await waitFor(() => BrowserWindow.getAllWindows().length === 2, '副屏创建且没有旧 dock');
  const panel = BrowserWindow.getAllWindows().find(w => w !== main);
  await waitFor(() => execute(panel, "!!window.__growth && document.getElementById('panelTitle').textContent==='天赋'"), '首次按入口选页');
  assert.equal(await execute(main, "document.getElementById('management').hidden"), true);
  assert.equal(await execute(main, "getComputedStyle(document.getElementById('management')).display"), 'none');
  assert.notEqual(main.webContents.session, panel.webContents.session, '主副屏会话必须隔离缩放');
  assert.equal(main.webContents.getZoomFactor(), mainZoom, '首次打开副屏不能改变主屏缩放');
  assert.equal(await layout(main), mainLayout, '首次打开副屏不能改变主屏布局');
  await execute(main, "document.getElementById('open-assign').click()");
  await waitFor(() => execute(panel, "document.getElementById('panelTitle').textContent==='加点'"), '切换已有副屏');
  assert.equal(BrowserWindow.getAllWindows().length, 2);
  const before = await snapshot(main);
  await execute(panel, "document.getElementById('assign-power').click()");
  await waitFor(async () => (await snapshot(panel)).assign === before.assign - 1, '加点立即同步');
  const assigned = await snapshot(main);
  assert.equal(assigned.assign, before.assign - 1);
  assert.equal(assigned.levels.power, before.levels.power + 1, '只消费一次');
  assert.equal((await snapshot(panel)).levels.power, assigned.levels.power);
  await execute(panel, "document.getElementById('talentTab').click();document.getElementById('talent-mass').click()");
  await waitFor(async () => (await snapshot(panel)).talents.mass === 1, '天赋同步');
  assert.equal((await snapshot(main)).talent, before.talent - 1);
  await execute(main, "document.getElementById('open-evo').click()");
  await waitFor(() => execute(panel, "document.getElementById('panelTitle').textContent==='进化'"), '进化入口');
  const rolls = (await snapshot(main)).evoRolls;
  await execute(panel, "document.getElementById('rollEvo').click()");
  await waitFor(async () => (await snapshot(panel)).evoRolls === rolls - 1, '掷骰同步');
  assert.equal((await snapshot(main)).mutations.length, 1, '掷骰只结算一次');
  await execute(panel, "document.getElementById('assignTab').click();document.getElementById('auto').click()");
  await waitFor(async () => (await snapshot(panel)).auto === true, '托管开关');
  await execute(panel, "const policy=document.getElementById('policy');policy.value='atomic';policy.dispatchEvent(new Event('change',{bubbles:true}))");
  await waitFor(async () => (await snapshot(main)).policy === 'atomic', '偏好转发');
  await execute(panel, "document.getElementById('auto').click()");
  await waitFor(async () => (await snapshot(panel)).auto === false, '关闭托管');
  assert.equal(main.webContents.getZoomFactor(), mainZoom, '打开副屏不改变主屏缩放');
  const liveBefore = await snapshot(main);
  await new Promise(resolve => setTimeout(resolve, 6200));
  const liveAfter = await snapshot(main);
  assert.ok(liveAfter.energy > liveBefore.energy, '副屏打开时主屏经济仍在运行');
  assert.ok(liveAfter.meters >= liveBefore.meters, '里程不能倒退');
  await execute(main, 'window.__growth.save();window.__tvSaveBridge.flush()');
  await waitFor(async () => {
    const a = await snapshot(panel), b = await snapshot(main);
    return a.level === b.level && a.assign === b.assign && a.talent === b.talent && a.mutations.length === b.mutations.length;
  }, '最终权威同步');
  const saved = JSON.parse(JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'save/tv.json'), 'utf8')).payload);
  await waitFor(async () => (await snapshot(panel)).lastSeen === saved.lastSeen, '接收指定存档快照');
  assert.equal((await snapshot(panel)).energy, saved.energy, '副屏核能必须严格等于权威快照，而非自行累计');
  assert.equal(saved.assign, liveAfter.assign);
  assert.equal(await execute(main, "document.getElementById('management').hidden"), true);
  assert.equal(await execute(panel, 'document.documentElement.scrollWidth<=innerWidth'), true, '副屏不横向溢出');
  fs.writeFileSync(OUT, (await main.webContents.capturePage()).toPNG());
  fs.writeFileSync(OUT.replace(/\.png$/, '-panel.png'), (await panel.webContents.capturePage()).toPNG());
  await execute(panel, "document.getElementById('closePanel').click()");
  await waitFor(() => BrowserWindow.getAllWindows().length === 1, '只关闭副屏');
  for (const tab of ['assign','talent','evo']) {
    await execute(main, `document.getElementById('open-${tab}').click()`);
    await waitFor(() => BrowserWindow.getAllWindows().length === 2, '重复打开副屏');
    const again = BrowserWindow.getAllWindows().find(w => w !== main);
    await waitFor(() => execute(again, '!!window.__growth'), '副屏重新就绪');
    assert.equal(main.webContents.getZoomFactor(), mainZoom);
    assert.equal(await layout(main), mainLayout, '重新打开菜单后主屏布局不变');
    await execute(again, "document.getElementById('closePanel').click()");
    await waitFor(() => BrowserWindow.getAllWindows().length === 1, '重复关闭副屏');
  }
  console.log('PASS 真实双窗口：首次及重复打开布局不变、菜单切换、单次消费、托管、主屏挂机、存档同步、无横向溢出、关闭副屏');
  console.log('隔离目录 ' + app.getPath('userData'));
  app.exit(0);
}

if (argv.contract) {
  const userData = app.getPath('userData');
  const initial = require('../tv/progression.js').defaults();
  Object.assign(initial, { energy: 10000, assign: 4, talent: 6, evoRolls: 3 });
  fs.mkdirSync(path.join(userData, 'save'));
  fs.writeFileSync(path.join(userData, 'save', 'tv.json'), JSON.stringify({ version: 1, payload: JSON.stringify(initial) }));
  require('../main.js');
  app.whenReady().then(runContract).catch((error) => { console.error(error); app.exit(1); });
} else app.whenReady().then(async () => {
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

  const loadPage = PANEL ? PAGE + (PAGE.includes('?') ? '&' : '?') + 'panel=1' : PAGE;
  await win.loadURL('file://' + loadPage);
  if (!PANEL && STAGE !== 'village') {
    const level = STAGE === 'city' ? 18 : 8;
    const meters = STAGE === 'city' ? 7200 : 2600;
    await win.webContents.executeJavaScript(`(() => { const raw = JSON.parse(localStorage.getItem('gnn-kaiju-idle-v3') || 'null') || {version:4}; raw.version=4; raw.level=${level}; raw.meters=${meters}; raw.district=${STAGE === 'city' ? 5 : 2}; raw.world=null; const real=Storage.prototype.setItem; Storage.prototype.setItem=function(){}; real.call(localStorage,'gnn-kaiju-idle-v3',JSON.stringify(raw)); location.reload(); })()`);
    await new Promise((r) => win.webContents.once('did-finish-load', r));
  }
  win.webContents.setZoomFactor(PANEL ? 1 : ZOOM);
  if (argv.tv) await win.webContents.insertCSS(TV_DRAG_CSS);
  if (PANEL) {
    await win.webContents.insertCSS(PANEL_ONLY_CSS);
    await win.webContents.insertCSS(PANEL_READABLE_CSS);
  }
  await new Promise((r) => setTimeout(r, WAIT));

  // 实测版面，不靠估算
  if (!PANEL) {
    const undersized = await win.webContents.executeJavaScript(`(() => {
      const minimum = parseFloat(getComputedStyle(document.querySelector('.pb-tx')).fontSize);
      return [...document.querySelectorAll('.shell *')].filter(e => {
        const r=e.getBoundingClientRect(), s=getComputedStyle(e);
        return r.width && r.height && s.visibility!=='hidden' && [...e.childNodes].some(n=>n.nodeType===3 && n.textContent.trim()) && parseFloat(s.fontSize)<minimum;
      }).map(e=>({tag:e.tagName,id:e.id,class:e.className,size:getComputedStyle(e).fontSize}));
    })()`);
    require('node:assert/strict').deepEqual(undersized, [], '所有可见文字不得小于左侧按钮');
    console.log('PASS 所有可见文字字号不小于左侧按钮');
  }
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
                 footer: region('footer'), dock: region('.tv-menu') },
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
