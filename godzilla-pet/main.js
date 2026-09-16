/* 巨兽都市桌宠 · Electron 主进程
 *
 * 窗口里播的是游戏画面（./tv）—— 直接 loadFile 打开，不复制、不改写，
 * 所以 tv 目录一个字节都没动过。视口固定成原版的 1280×720，只用一个缩放系数
 * 整体缩小，因此版面、行距、断点全都与原版一模一样。
 *
 * 主进程除了窗口与托盘，还独占存档的写入权：存档是文件，路径在 userData 下，
 * 画面只能通过 IPC 读写。理由见 save-store.js 顶部的注释。
 * 游戏逻辑一律在画面自己那边。
 *
 * 唯一的例外是存档这件事本身：画面认的是 localStorage，而这里把那个键
 * 接到了文件上。动手的是 tv-preload.js —— 它凭什么能改到页面，见那个文件顶部。
 */
'use strict';

const { app, BrowserWindow, ipcMain, Menu, Tray, screen, shell, dialog, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const { TV_DRAG_CSS, TV_HIDE_DOCK_CSS, PANEL_ONLY_CSS, PANEL_READABLE_CSS, TV_SIZES, zoomFor } = require('./tv-config.js');
const { createStore } = require('./save-store.js');

const ASSETS = path.join(__dirname, 'assets');

/* 开发期开关：设了 GNN_DEBUG_PORT 才打开远程调试端口，用来核对窗口里究竟
 * 加载了什么（页面 URL、视口尺寸、缩放系数、拖动区域），默认完全关闭。
 * 应用是 GUI 程序、没有终端，所以配合 launchctl setenv 传进来：
 *
 *   launchctl setenv GNN_DEBUG_PORT 9222
 *   open -a "~/Applications/巨兽都市桌宠.app"
 *   node build/cdp-probe.cjs 9222
 *   launchctl unsetenv GNN_DEBUG_PORT */
if (process.env.GNN_DEBUG_PORT) {
  app.commandLine.appendSwitch('remote-debugging-port', String(process.env.GNN_DEBUG_PORT));
}

/* 应用名必须在任何一次路径解析之前定下来：userData 目录、单实例锁都是按名字
 * 决定的，晚一步设置就会先把缓存目录建成包名（godzilla-pet），改名后存档就找不到了。 */
app.setName('巨兽都市桌宠');

const STATE_FILE = () => path.join(app.getPath('userData'), 'pet-window.json');

/* 游戏画面的入口页。迷你电视直接播它——不复制、不改写，
 * 桌宠里怎么折腾都不会影响到里面的画面。 */
const ORIGINAL_GAME = path.join(__dirname, 'tv', 'index.html');

/* 画面的存档接管层。tv/ 里一个字节都不能改，存档就从外面劫持：
 * 这个 preload 把画面用的那个 localStorage 键接到 <userData>/save/tv.json。
 * 必须配 contextIsolation: false，原因见该文件顶部的说明。 */
const TV_PRELOAD = path.join(__dirname, 'tv-preload.js');

/* ------------------------------------------------------------------ *
 * 控制按钮（窗口外的那个像素方块）
 *
 * 为什么必须是独立窗口 ——
 *   画面的视口是 1120px，而窗户只有 500 出头，缩放系数 0.46。
 *   画面里任何 UI 都会被这个系数砍掉一半多：12px 的字落到屏幕上只有 5.6px，
 *   既看不清也点不准。想让它保持在 64px，就必须待在缩放之外，也就是另一个窗口。
 *
 * 它贴在电视窗口外侧，跟着窗口走（见 placeDock）。
 * ------------------------------------------------------------------ */
const DOCK_W = 96;                  // 按钮 88 + 8px 硬阴影在右下
const DOCK_H = 96;
const DOCK_GAP = 10;                // 与电视窗口之间留的空隙
const DOCK_PRELOAD = path.join(__dirname, 'dock-preload.js');
const DOCK_HTML = path.join(__dirname, 'dock.html');

/* ------------------------------------------------------------------ *
 * 观测面板窗口
 *
 * 它是**另一个 tv 实例**，放大到 1:1，和电视窗口并存 —— 电视那边不动一个像素。
 * 之所以不把电视窗口本身放大：那样小电视就没了，而它本来就该一直挂在那儿播。
 *
 * 两个实例跑同一份 game.js，所以面板那份必须只读（见 panel-preload.js）。
 * ------------------------------------------------------------------ */
const PANEL_PRELOAD = path.join(__dirname, 'panel-preload.js');

/* 面板高度放大系数。宽度跟电视成套；高度放宽是因为字放大之后，
 * 标题、资源条、页签这些固定部分就要占掉 200px 出头 —— 再按电视原高，
 * 窗口里只剩一条缝，打开面板什么都看不见、全靠滚动。
 * 加出来的高度全部给内容区（growthContent 是纵向滚动的）。 */
const PANEL_H_SCALE = 1.45;

/* ------------------------------------------------------------------ *
 * 存档
 *
 * 存档放在 userData 下的 save/ 目录里，跟窗口状态文件分开：
 * 窗口位置丢了无所谓，存档丢了不可再生，两者不该共用一份文件，
 * 也不该共用同一套出错处理。
 *
 * store 延迟创建：app.getPath('userData') 要等 app 就绪后才能调用，
 * 而 setName 又必须在任何一次路径解析之前执行（见上面那段注释）。
 * ------------------------------------------------------------------ */
const SAVE_DIR = () => path.join(app.getPath('userData'), 'save');

/* 版本号是这一层唯一的把关点：版本对不上的存档一概不认，
 * 让画面拿到空档从 1 级开始，也好过按新字段去解释旧数据。
 *
 * payload 保持字符串而不是解析后的对象 —— 它就是 localStorage 里原本的那个值
 * （tv/game.js 的 economy.serialize() 输出）。原样存取，才不会在往返中
 * 丢掉画面那边的字段。 */
const isSaveV1 = (d) =>
  !!d && typeof d === 'object' && !Array.isArray(d) &&
  d.version === 1 && typeof d.payload === 'string';

let _store = null;
const store = () => (_store ||= createStore({ dir: SAVE_DIR(), validate: isSaveV1 }));

/* 只剩一种画面了：迷你电视。窗口只是个框，改的只有物理尺寸 ——
 * 视口恒等于原版的 1280×720，靠缩放系数整体缩小，版面不受影响。 */
const DEFAULTS = {
  size: 'medium',
  pos: null,
  alwaysOnTop: true,
  hidden: false,
};

let win = null;
let tray = null;
let state = structuredClone(DEFAULTS);

const curSize = () => TV_SIZES[state.size] || TV_SIZES.medium;

/* ------------------------------------------------------------------ *
 * 状态持久化
 * ------------------------------------------------------------------ */
function loadState() {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')) || {};
  } catch {
    raw = {};
  }

  /* 这个文件比产品活得久，历史上出现过三种形状，都得读得出来：
   *   1. 只有底座模式时：{ size, x, y }                       扁平
   *   2. 两种模式并存时：{ mode, size:{tv,pet}, pos:{tv,pet} }
   *   3. 现在（只剩迷你电视）：{ size, pos:{x,y} }
   * 统一收敛到形状 3，读不出来的字段各自回落到默认值，
   * 这样从任何一版升上来都不会因为窗口位置读崩。 */
  const pickSize = (v) => (TV_SIZES[v] ? v : DEFAULTS.size);
  const pickPos = (v) =>
    v && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null;

  const legacyPos = Number.isFinite(raw.x) && Number.isFinite(raw.y) ? { x: raw.x, y: raw.y } : null;
  const pos = raw.pos && typeof raw.pos === 'object' ? raw.pos.tv ?? raw.pos : null;

  state = {
    size: pickSize(raw.size && typeof raw.size === 'object' ? raw.size.tv : raw.size),
    pos: pickPos(pos) || pickPos(legacyPos),
    alwaysOnTop: raw.alwaysOnTop !== false,
    hidden: raw.hidden === true,
  };
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE(), JSON.stringify(state, null, 2));
  } catch {
    /* 存档失败不该影响运行 */
  }
}

/* ------------------------------------------------------------------ *
 * 位置：首次运行落到主屏右下角，之后记住用户拖到哪
 * ------------------------------------------------------------------ */
function defaultPosition(w, h) {
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.round(area.x + area.width - w - 40),
    y: Math.round(area.y + area.height - h - 40),
  };
}

function clampToVisible(x, y, w, h) {
  // 换显示器或改分辨率后，旧坐标可能落在屏幕外，这里拉回最近的可视区域
  const displays = screen.getAllDisplays();
  const inside = displays.some((d) => {
    const a = d.workArea;
    return x + w > a.x && x < a.x + a.width && y + h > a.y && y < a.y + a.height;
  });
  if (inside) return { x, y };
  const area = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.min(Math.max(x, area.x), area.x + area.width - w),
    y: Math.min(Math.max(y, area.y), area.y + area.height - h),
  };
}

function rememberBounds() {
  if (!win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  state.pos = { x, y };
}

/* ------------------------------------------------------------------ *
 * 窗口
 * ------------------------------------------------------------------ */
function createWindow() {
  const size = curSize();
  const pos = state.pos
    ? clampToVisible(state.pos.x, state.pos.y, size.w, size.h)
    : defaultPosition(size.w, size.h);

  const w = new BrowserWindow({
    width: size.w,
    height: size.h,
    x: pos.x,
    y: pos.y,
    // 电视里要能点"强化 / 技能树"那些按钮，所以不能透明、也不能设成不抢焦点的 panel
    transparent: false,
    backgroundColor: '#050a15',
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false, // 挡住页面里的"全屏直播"——小电视不该变成全屏
    skipTaskbar: true,
    alwaysOnTop: state.alwaysOnTop,
    webPreferences: {
      preload: TV_PRELOAD,
      /* 必须关掉隔离：存档接管要改的是页面那一份 Storage.prototype，
       * 隔离世界里改的是另一个对象，碰不到画面。nodeIntegration 仍为 false，
       * 页面拿不到 require。详见 tv-preload.js 顶部。 */
      contextIsolation: false,
      nodeIntegration: false,
      backgroundThrottling: false, // 挂机游戏不能因为窗口失焦就降频
    },
  });
  win = w;

  w.loadFile(ORIGINAL_GAME);

  // 版面锚点：加载完成后把缩放系数定死，视口就恒等于原版的设计尺寸。
  // 两条注入一起下：拖动区域（不动呈现），以及藏掉画面里那排小按钮
  // （唯一的呈现改动，理由见 tv-config.js 顶部的说明）。
  w.webContents.on('did-finish-load', () => {
    w.webContents.setZoomFactor(zoomFor(size.w));
    w.webContents.insertCSS(TV_DRAG_CSS).catch(() => {});
    w.webContents.insertCSS(TV_HIDE_DOCK_CSS).catch(() => {});
  });
  // 右键弹控制菜单：frameless 窗口没有标题栏，总得有个入口
  w.webContents.on('context-menu', () => {
    Menu.buildFromTemplate(controlTemplate()).popup({ window: w });
  });

  // screen-saver 层级高于普通置顶，能压在菜单栏与全屏窗口之上
  if (state.alwaysOnTop) w.setAlwaysOnTop(true, 'screen-saver');
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (state.hidden) w.hide();

  // 拖动过程中持续记录位置，节流写入避免拖动时狂刷磁盘
  let saveTimer = null;
  const rememberPos = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const [x, y] = win.getPosition();
      state.pos = { x, y };
      saveState();
    }, 400);
  };
  w.on('moved', rememberPos);
  // 只清掉自己这一个引用：切画面时会先建新窗再让旧窗关掉，
  // 不加判断的话旧窗的 closed 会把新窗的引用一起抹掉。
  w.on('closed', () => { if (win === w) win = null; });

  // 外部链接交给系统浏览器，窗口本身永远不导航
  w.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 控制按钮要一直贴着窗口，窗口一动就得重新摆
  w.on('moved', placeDock);
  w.on('resize', placeDock);
  // 面板窗口开着的时候同理
  w.on('moved', placePanel);
  w.on('resize', placePanel);
}

/* ------------------------------------------------------------------ *
 * 控制按钮：创建、跟随、点开
 * ------------------------------------------------------------------ */
let dock = null;

/* 面板窗口。它是个真正的独立窗口，和电视窗口并存；
 * 非 null 就代表面板正开着。 */
let panelWin = null;

function createDock() {
  dock = new BrowserWindow({
    width: DOCK_W,
    height: DOCK_H,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      preload: DOCK_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  dock.loadFile(DOCK_HTML);
  dock.setAlwaysOnTop(true, 'screen-saver');
  dock.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  dock.on('closed', () => { dock = null; });
  placeDock();
  // 窗口本来就是藏着的（上次退出时收起了），按钮也一起藏着，
  // 否则桌面上会只剩一个没主的按钮
  if (state.hidden) dock.hide();
}

/* 把按钮摆到电视窗口外侧。
 *
 * 优先左侧 —— 电视默认落在主屏右下角，左边一定有地方。
 * 左边顶到屏幕边缘就翻到右侧；两边都挤不下（窗口宽得快占满屏幕）时
 * 退到窗口内部左下角：宁可压住一点画面，也不能让按钮跑到屏幕外点不到。 */
function placeDock() {
  if (!dock || dock.isDestroyed() || !win || win.isDestroyed() || !win.isVisible()) return;

  const b = win.getBounds();
  const area = screen.getDisplayMatching(b).workArea;

  const y = Math.min(Math.max(b.y + b.height - DOCK_H, area.y), area.y + area.height - DOCK_H);
  let x = b.x - DOCK_W - DOCK_GAP;

  if (x < area.x) {
    const right = b.x + b.width + DOCK_GAP;
    x = right + DOCK_W <= area.x + area.width ? right : b.x + DOCK_GAP;
  }

  dock.setBounds({ x: Math.round(x), y: Math.round(y), width: DOCK_W, height: DOCK_H });
}

/* 把面板窗口摆在电视窗口旁边，跟它成对。
 *
 * 优先右侧（面板是电视的"遥控屏"，放右手边顺手）；
 * 右边顶到屏幕边缘就翻到左侧；两边都放不下时退回居中 ——
 * 宁可盖住一点别的，也不能跑到屏幕外。 */
function placePanel() {
  if (!panelWin || panelWin.isDestroyed() || !win || win.isDestroyed()) return;
  const b = win.getBounds();
  const p = panelWin.getBounds();
  const area = screen.getDisplayMatching(b).workArea;

  const y = Math.min(Math.max(b.y, area.y), Math.max(area.y, area.y + area.height - p.height));

  /* 控制按钮可能贴在电视右侧（电视靠左时 placeDock 会翻到右侧）。
   * 不让出这段距离，按钮就会压在面板上 —— 用户截图里右上角那个
   * 叠在面板上的方块就是这次撞位。 */
  let anchor = b.x + b.width;
  if (dock && !dock.isDestroyed() && dock.isVisible()) {
    const d = dock.getBounds();
    if (d.x >= b.x + b.width) anchor = Math.max(anchor, d.x + d.width);
  }

  const right = anchor + DOCK_GAP;
  let x;
  if (right + p.width <= area.x + area.width) x = right;
  else if (b.x - DOCK_GAP - p.width >= area.x) x = b.x - DOCK_GAP - p.width;
  else x = Math.round(area.x + (area.width - p.width) / 2);

  panelWin.setBounds({ x: Math.round(x), y: Math.round(y), width: p.width, height: p.height });
}

/* 打开观测面板。
 *
 * 开的是**另一个窗口**，不是把这个窗口放大 —— 小电视要一直挂在那儿播，
 * 面板只是它旁边多出来的一块。这也是这个按钮存在的意义：把功能从被
 * 0.46 倍缩放压扁的画面里救出来。
 *
 * 面板窗口加载的是同一份 tv 页面、同一份 game.js，所以四个页面连同交互
 * 是它自己画好的，一行都没重写。它唯一被限制的是不准写存档
 * （见 panel-preload.js），落盘由电视窗口独占，否则两个实例会互相覆盖。 */
function openPanel() {
  if (!win || win.isDestroyed()) return;
  if (panelWin && !panelWin.isDestroyed()) { panelWin.show(); panelWin.focus(); return; }

  // 尺寸跟电视窗口的当前档位走 —— 两个窗口要成套，
  // 一大一小摆在一起很突兀（用户原话："这个面板很大"）。
  // 缩放却必须保持 1：面板要的是游戏自己的窄屏紧凑断点
  // （max-height:480 那套，字号是真实的屏幕像素），而不是把 1120 宽的
  // 直播版面再压扁一遍 —— 那正是"文字太小无法看到"的原因。
  const s = curSize();

  panelWin = new BrowserWindow({
    width: s.w,
    height: Math.round(s.h * PANEL_H_SCALE),
    frame: false,
    backgroundColor: '#050a15',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: PANEL_PRELOAD,
      // 同 tv-preload：存档接管要改页面那一份 Storage.prototype
      contextIsolation: false,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  panelWin.loadFile(ORIGINAL_GAME);
  panelWin.webContents.on('did-finish-load', () => {
    /* zoom 必须显式钉回 1，哪怕"没设过"。
     *
     * Chromium 把缩放按**来源**存在会话里：电视窗口对同一个 file:// 页面
     * 设过 0.41，面板窗口加载同一来源时会静默继承那份缩放 —— 实测
     * clientWidth 是 1120 而不是窗口宽度，菜单里的字全部缩到 5px。
     * 不显式设 1，"面板不缩放"就只是个没生效的愿望。 */
    panelWin.webContents.setZoomFactor(1);
    // 四条注入：拖动把手、藏画面里的小按钮、只留观测面板（见 tv-config.js）、
    // 以及可读性放大 —— 字与按钮整体大一号（用户反馈"字也太小了"）。
    panelWin.webContents.insertCSS(TV_DRAG_CSS).catch(() => {});
    panelWin.webContents.insertCSS(TV_HIDE_DOCK_CSS).catch(() => {});
    panelWin.webContents.insertCSS(PANEL_ONLY_CSS).catch(() => {});
    panelWin.webContents.insertCSS(PANEL_READABLE_CSS).catch(() => {});
  });
  panelWin.once('ready-to-show', () => { if (panelWin) panelWin.show(); });
  panelWin.on('closed', () => { panelWin = null; });

  placePanel();
}

/* 面板关掉就收窗。
 *
 * 由画面那边上报（panel:done），不是这里主动关 —— 面板有三个出口
 * （× 返回直播、Esc、将来别的），让画面统一告诉我们才不会漏。 */
function closePanel() {
  if (panelWin && !panelWin.isDestroyed()) panelWin.close();
}

function togglePanel() {
  if (panelWin && !panelWin.isDestroyed()) closePanel();
  else openPanel();
}

/* ------------------------------------------------------------------ *
 * 托盘与控制
 * ------------------------------------------------------------------ */
function trayIcon() {
  // macOS 用模板图（纯黑 + alpha），浅色深色菜单栏都能正确反色
  const file = process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png';
  const p = path.join(ASSETS, file);
  return fs.existsSync(p) ? p : undefined;
}

function applyAlwaysOnTop(on) {
  state.alwaysOnTop = on;
  if (win) {
    win.setAlwaysOnTop(on, on ? 'screen-saver' : 'normal');
    if (on) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  saveState();
  refreshTray();
}

function applySize(key) {
  if (!TV_SIZES[key] || !win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  const s = TV_SIZES[key];
  state.size = key;
  state.pos = { x, y };
  win.setBounds({ x, y, width: s.w, height: s.h });
  // 缩放系数跟着窗口宽度走，版面才不会因为改尺寸而错位
  win.webContents.setZoomFactor(zoomFor(s.w));
  saveState();
  refreshTray();
  placeDock();
}

function toggleVisible(force) {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  state.hidden = typeof force === 'boolean' ? force : !state.hidden;
  if (state.hidden) win.hide();
  else win.showInactive(); // showInactive：显示但不抢焦点

  // 按钮跟着一起收放，否则窗口收起来了按钮还孤零零留在桌面上
  if (dock && !dock.isDestroyed()) {
    if (state.hidden) dock.hide();
    else { placeDock(); dock.showInactive(); }
  }

  saveState();
  refreshTray();
}

function resetPosition() {
  if (!win || win.isDestroyed()) return;
  const p = defaultPosition(curSize().w, curSize().h);
  win.setPosition(p.x, p.y);
  state.pos = p;
  saveState();
  placeDock();
}

/* 托盘与右键菜单共用同一份模板 */
function controlTemplate() {
  return [
    { label: '巨兽都市桌宠', enabled: false },
    { label: '迷你电视 · 原版画面', enabled: false },
    { type: 'separator' },
    { label: state.hidden ? '显示' : '收起', click: () => toggleVisible() },
    { label: '回到右下角', click: resetPosition },
    { type: 'separator' },
    {
      label: '窗口大小',
      submenu: Object.entries(TV_SIZES).map(([key, s]) => ({
        label: `${s.label}  (${s.w}×${s.h})`,
        type: 'radio',
        checked: state.size === key,
        click: () => applySize(key),
      })),
    },
    {
      label: '持续置顶',
      type: 'checkbox',
      checked: state.alwaysOnTop,
      click: (item) => applyAlwaysOnTop(item.checked),
    },
    { type: 'separator' },
    saveTemplate(),
    { type: 'separator' },
    { label: '退出', role: 'quit' },
  ];
}

function refreshTray() {
  if (!tray) return;
  tray.setToolTip('巨兽都市桌宠 · 迷你电视');
  tray.setContextMenu(Menu.buildFromTemplate(controlTemplate()));
}

function createTray() {
  const icon = trayIcon();
  // 图标缺失时用空图兜底：Tray 依然可用（菜单能弹），只是看不见。
  // 不能传空 Buffer——Electron 会把它当坏图直接抛异常。
  tray = new Tray(icon || nativeImage.createEmpty());
  if (process.platform === 'darwin' && icon) tray.setIgnoreDoubleClickEvents(true);
  refreshTray();
  // Windows / Linux 习惯左键唤起，macOS 左键默认弹菜单
  tray.on('click', () => {
    if (process.platform !== 'darwin') toggleVisible();
  });
}

/* ------------------------------------------------------------------ *
 * IPC：迷你电视完全自足，没有任何需要主进程代劳的操作。
 * 唯一的桥是存档（见下面的 registerSaveIPC）与 tv-preload.js。
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * 存档：操作实现
 *
 * 抽成普通函数而不是直接写在 IPC 里，是为了让托盘菜单和右键菜单
 * 走同一条代码路径 —— 两个入口各写一遍迟早会有一套忘了做校验。
 * ------------------------------------------------------------------ */
const pickWin = (kind, options) =>
  (win && !win.isDestroyed() ? dialog[kind](win, options) : dialog[kind](options));

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

function revealSave() {
  store().ensureDir();
  shell.openPath(store().info().dir);
}

async function exportSave() {
  const info = store().info();
  if (!info.hasSave && !info.hasBackup) {
    await pickWin('showMessageBox', {
      type: 'info', message: '还没有存档可以导出',
      detail: '等它拆掉第一栋楼，或者先让它在桌面上挂一会儿。',
    });
    return { ok: false, error: '没有存档' };
  }
  const r = await pickWin('showSaveDialog', {
    title: '导出桌宠存档',
    defaultPath: path.join(app.getPath('documents'), `巨兽都市桌宠-存档-${stamp()}.json`),
    filters: [{ name: '存档', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true, error: null };
  const out = store().exportTo(r.filePath);
  if (out.ok) await pickWin('showMessageBox', {
    type: 'info', message: '已导出', detail: r.filePath,
  });
  else await pickWin('showMessageBox', {
    type: 'error', message: '导出失败', detail: out.error || '未知原因',
  });
  return out;
}

async function importSave() {
  const r = await pickWin('showOpenDialog', {
    title: '从备份导入存档',
    properties: ['openFile'],
    filters: [{ name: '存档', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePaths || !r.filePaths.length) return { ok: false, canceled: true, error: null };

  // 覆盖之前先问一句：导入是单向的，当前进度会被顶掉
  const ask = await pickWin('showMessageBox', {
    type: 'warning',
    buttons: ['取消', '导入'],
    defaultId: 0,
    cancelId: 0,
    message: '导入这份存档？',
    detail: '当前进度会被替换掉（现有存档会退位成备份，仍可导出找回）。',
  });
  if (ask.response !== 1) return { ok: false, canceled: true, error: null };

  const out = store().importFrom(r.filePaths[0]);
  if (out.ok) reloadSave();
  else await pickWin('showMessageBox', {
    type: 'error', message: '这个文件不是有效的存档', detail: out.error || '未知原因',
  });
  return out;
}

async function resetSave() {
  const ask = await pickWin('showMessageBox', {
    type: 'warning',
    buttons: ['取消', '重置存档'],
    defaultId: 0,
    cancelId: 0,
    message: '重置桌宠存档？',
    detail: '核能、等级、突变点、技能、破坏进度与所在城区全部归零，且无法撤销。\n存档文件和它的备份会被一起删掉。',
  });
  if (ask.response !== 1) return { ok: false, canceled: true, error: null };
  const out = store().clear();
  if (out.ok) reloadSave();
  return out;
}

/* 导入/重置与自动存档之间有一场竞态：画面每 5 秒存一次盘，那一次写完全可能
 * 已经在路上，落地时间却晚于导入，于是把刚导入的档又盖回旧数据 ——
 * 用户看到的是"导入没生效"，而磁盘上什么都没坏，最难查的那种。
 *
 * 用一个闸门掐掉那段时间窗：从导入成功到画面下一次握手之间，写盘一律拒绝。
 * 画面的握手一旦被应答就自动开闸，所以闸门最多关一个 IPC 往返。 */
let reloading = false;
const SAVE_BUSY = { ok: false, bytes: 0, error: '存档正在重新载入' };

/* 存档换了内容，让画面重新载入它。
 *
 * 画面把存档攥在 preload 的内存里（tv-preload.js），导入之后那份内存还是旧的，
 * 所以必须整页重载 —— 重载会重走一遍 preload 的同步握手，拿到刚导入的档。
 * 代价是城市按新档重建；但导入本来就是换一个进度，这个代价是必然的。
 *
 * 同时关掉写盘闸门：页面卸载时 preload 会同步落一次盘，
 * 那一次写会把刚导入的档又盖回旧数据。 */
function reloadSave() {
  reloading = true;
  if (win && !win.isDestroyed()) win.webContents.reload();
}

/* 托盘与右键菜单共用的存档子菜单 */
function saveTemplate() {
  const info = store().info();
  return {
    label: '存档',
    submenu: [
      {
        label: info.hasSave ? '打开存档文件夹' : '打开存档文件夹（还没有存档）',
        click: revealSave,
      },
      { type: 'separator' },
      { label: '导出备份…', click: () => { exportSave(); } },
      { label: '从备份导入…', click: () => { importSave(); } },
      { type: 'separator' },
      { label: '重置存档…', click: () => { resetSave(); } },
    ],
  };
}

function registerSaveIPC() {
  /* 画面的存档握手。
   *
   * 同步的，因为 game.js 一启动就同步读档 —— 这里必须当场把内容给它，
   * 换成异步会让它先拿着一份新档跑起来，再被迟到的文件覆盖成第二次初始化。
   *
   * legacy 是画面原来那份 localStorage 存档（tv-preload.js 在装劫持之前读出来的）。
   * 文件里还没有档、而浏览器存储里有的时候把它搬进文件 —— 装完劫持就再也
   * 读不到那份老档了，只有这一次机会。搬完文件立刻存在，所以只会搬一次。 */
  ipcMain.on('tv:saveBoot', (e, legacy) => {
    reloading = false;                     // 握手应答即开闸

    const r = store().read();
    let payload = r.data && typeof r.data.payload === 'string' ? r.data.payload : null;
    let migrated = false;

    if (payload === null && typeof legacy === 'string' && legacy) {
      const w = store().write({ version: 1, payload: legacy });
      if (w.ok) { payload = legacy; migrated = true; }
    }

    e.returnValue = { payload, migrated, source: r.source };
  });

  ipcMain.on('tv:saveWrite', (_e, payload) => {
    if (reloading || typeof payload !== 'string') return;
    store().write({ version: 1, payload });
    syncPanel(payload);
  });

  /* 同步写入。只在页面即将卸载（pagehide）时用：那一刻没有"稍后"，
   * 异步 IPC 的回调根本来不及跑，而这是退出前的最后一次落盘机会。
   * 日常的写入走异步那条，不阻塞渲染帧。 */
  ipcMain.on('tv:saveWriteSync', (e, payload) => {
    if (reloading || typeof payload !== 'string') { e.returnValue = SAVE_BUSY; return; }
    e.returnValue = store().write({ version: 1, payload });
    syncPanel(payload);
  });

  ipcMain.on('save:reveal', revealSave);
  ipcMain.handle('save:export', exportSave);
  ipcMain.handle('save:import', importSave);
  ipcMain.handle('save:reset', resetSave);
}

/* 控制按钮与面板窗口之间的三条通道。
 * 按钮只喊一声"开"；面板那边负责报"用户点了什么"和"我关了"。 */
function registerDockIPC() {
  ipcMain.on('dock:toggle', () => togglePanel());

  /* 面板启动时要一份存档 —— 给文件里那一份。
   * 面板自己不准写盘，只读这一份（见 panel-preload.js）。 */
  ipcMain.on('panel:boot', (e) => {
    const r = store().read();
    e.returnValue = {
      payload: r.data && typeof r.data.payload === 'string' ? r.data.payload : null,
      source: r.source,
    };
  });

  /* 面板里的点击转发过来，在电视窗口里执行同一个元素。
   *
   * 为什么不在这里直接把数据算出来：游戏的权威状态在电视窗口那个实例里，
   * 面板只是个遥控器。让电视窗口自己去执行，进度、存档、画面才会一致 ——
   * 否则面板改了内存、电视那边一无所知，五秒后电视一写盘就全盖回去。
   *
   * 掷骰是特例：电视窗口执行 rollEvolution 后，把结果挂到 el.__panelResult 上，
   * 这里接出返回值、若是对象就回推给面板播动画（面板的骰子只是落在已知的面上，
   * 动画不参与计算）。 */
  ipcMain.on('panel:tap', (_e, payload) => {
    if (!win || win.isDestroyed()) return;

    const id = payload && typeof payload.id === 'string' ? payload.id : '';
    // id 要拼进 JS 里执行，先挡一道；面板里的 id 都是常规标识符
    if (!/^[A-Za-z][\w-]*$/.test(id)) return;

    const isChange = payload.kind === 'change';
    let body = 'el.click();';
    if (isChange) {
      if (typeof payload.checked === 'boolean') body = `el.checked = ${payload.checked};`;
      else if (typeof payload.value === 'string') body = `el.value = ${JSON.stringify(payload.value)};`;
      body += "el.dispatchEvent(new Event('change', { bubbles: true }));";
    }

    win.webContents
      .executeJavaScript(
        `(() => { const el = document.getElementById(${JSON.stringify(id)}); if (!el) return false; ${body} return el.__panelResult || true; })()`,
      )
      .then((r) => {
        if (r && typeof r === 'object' && panelWin && !panelWin.isDestroyed()) {
          panelWin.webContents.send('panel:rolled', r);
        }
      })
      .catch(() => { /* 电视窗口还没就绪，这一下就算了 */ });
  });

  ipcMain.on('panel:done', () => closePanel());
}

/* 面板的一致性同步：电视窗口每次落盘后，把 payload 推给面板。
 *
 * 面板的存档是只读的，它靠"同一份存档 + 同一串点击"和电视保持一致。
 * 但电视在面板开着的时候一直在跑（自动升级、自动加点、自动进化），
 * 面板对此一无所知 —— 没有这条同步，面板上的角标永远不亮，
 * 玩家挂机 8 小时回来，面板还以为自己有 0 次进化机会。
 *
 * 从主进程推，而不是让电视窗口广播：面板窗口本来就是主进程创建的，
 * 电视窗口不该知道面板的存在（否则就破坏了"桌宠只管窗口生命周期"的分层）。 */
function syncPanel(payload) {
  if (typeof payload !== 'string') return;
  if (!panelWin || panelWin.isDestroyed()) return;
  panelWin.webContents.send('panel:sync', payload);
}

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */
// 第二次启动时只是把已有窗口叫回视线，不新开一个
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => toggleVisible(false));

  app.whenReady().then(() => {
    if (process.platform === 'darwin') app.dock?.hide(); // 桌宠不占 Dock
    Menu.setApplicationMenu(null);
    loadState();
    registerSaveIPC();
    registerDockIPC();
    createWindow();
    createDock();
    createTray();
  });

  // 托盘应用：关掉窗口不等于退出
  app.on('window-all-closed', () => {});

  /* 退出前只需要记住窗口位置。
   *
   * 进度不用在这里操心：画面自己的 pagehide 里有一次同步落盘
   * （tv-preload.js 的 flushSync），窗口关闭时必定跑到，
   * 而且 sendSync 会一直阻塞到主进程把档写完为止 ——
   * 主进程继续往下退出时，数据已经在磁盘上了。 */
  app.on('before-quit', () => {
    rememberBounds();
    saveState();
  });
}
