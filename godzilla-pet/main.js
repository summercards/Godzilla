/* 巨兽都市桌宠 · Electron 主进程
 *
 * 两套画面共用同一套窗口骨架，靠 state.mode 切换：
 *
 *   tv  —— 迷你电视。直接把原版游戏（../godzilla-shinjuku）装进一个小窗，
 *          窗口内的视口固定成原版的 1280×720，只用一个缩放系数整体缩小。
 *          因此版面、行距、断点全都与原版一模一样，原版目录一个字节都不改。
 *
 *   pet —— 底座模式。重画的迷你底座场景，透明背景 + 自动鼠标穿透。
 *
 * 主进程只负责窗口与托盘，游戏逻辑一律在渲染层。
 */
'use strict';

const { app, BrowserWindow, ipcMain, Menu, Tray, screen, shell, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const { TV_DRAG_CSS, TV_SIZES, zoomFor } = require('./tv-config.js');

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

/* 原版游戏的入口页。迷你电视直接播它——不复制、不改写，
 * godzilla-pet 里怎么折腾都不会影响到原版画面。 */
const ORIGINAL_GAME = path.join(__dirname, '..', 'godzilla-shinjuku', 'index.html');

/* 底座模式：固定 5:4 横构图。渲染层设计坐标 320 × 256，
 * 用横向而不是正方形，是因为角色连尾巴的长宽比接近 2:1，窗口太窄会横着裁掉。 */
const PET_SIZES = {
  small: { w: 240, h: 192, label: '小' },
  medium: { w: 320, h: 256, label: '中' },
  large: { w: 400, h: 320, label: '大' },
};

const MODES = {
  tv: {
    label: '迷你电视 · 原版画面',
    file: ORIGINAL_GAME,
    sizes: TV_SIZES,
    defaultSize: 'medium',
    viewportZoom: true,
    // 电视里要能点"强化 / 技能树"那些按钮，所以不能透明、也不设成不抢焦点的 panel
    transparent: false,
    clickThrough: false,
    panel: false,
    preload: null,
  },
  pet: {
    label: '底座模式 · 重绘场景',
    file: path.join(__dirname, 'renderer', 'index.html'),
    sizes: PET_SIZES,
    defaultSize: 'medium',
    viewportZoom: false,
    transparent: true,
    clickThrough: true,
    // panel 让 macOS 把它当成辅助面板：浮在全屏应用之上，且不抢走输入焦点
    panel: true,
    preload: path.join(__dirname, 'preload.js'),
  },
};

const DEFAULTS = {
  mode: 'tv',
  size: { tv: 'medium', pet: 'medium' },
  pos: { tv: null, pet: null },
  alwaysOnTop: true,
  clickThrough: false,
  hidden: false,
};

let win = null;
let tray = null;
let state = structuredClone(DEFAULTS);

const mode = () => MODES[state.mode] || MODES.tv;
const curSize = () => mode().sizes[state.size[state.mode]] || mode().sizes[mode().defaultSize];

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

  state = {
    mode: MODES[raw.mode] ? raw.mode : DEFAULTS.mode,
    alwaysOnTop: raw.alwaysOnTop !== false,
    clickThrough: raw.clickThrough === true,
    hidden: raw.hidden === true,
    size: {},
    pos: {},
  };

  for (const key of Object.keys(MODES)) {
    const want = raw.size && typeof raw.size === 'object' ? raw.size[key] : null;
    state.size[key] = MODES[key].sizes[want] ? want : MODES[key].defaultSize;

    const p = raw.pos && typeof raw.pos === 'object' ? raw.pos[key] : null;
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) state.pos[key] = { x: p.x, y: p.y };
    else if (key === 'pet' && Number.isFinite(raw.x) && Number.isFinite(raw.y)) {
      // 老存档：那时只有底座模式，size/x/y 是扁平的
      state.pos[key] = { x: raw.x, y: raw.y };
      if (MODES.pet.sizes[raw.size]) state.size.pet = raw.size;
    } else state.pos[key] = null;
  }
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
  state.pos[state.mode] = { x, y };
}

/* ------------------------------------------------------------------ *
 * 窗口
 * ------------------------------------------------------------------ */
function createWindow() {
  const m = mode();
  const size = curSize();
  const saved = state.pos[state.mode];
  const pos = saved
    ? clampToVisible(saved.x, saved.y, size.w, size.h)
    : defaultPosition(size.w, size.h);

  const w = new BrowserWindow({
    width: size.w,
    height: size.h,
    x: pos.x,
    y: pos.y,
    transparent: m.transparent,
    backgroundColor: m.transparent ? '#00000000' : '#050a15',
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false, // 挡住页面里的"全屏直播"——小电视不该变成全屏
    skipTaskbar: true,
    alwaysOnTop: state.alwaysOnTop,
    ...(process.platform === 'darwin' && m.panel ? { type: 'panel', focusable: false } : {}),
    webPreferences: {
      ...(m.preload ? { preload: m.preload } : {}),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // 挂机游戏不能因为窗口失焦就降频
    },
  });
  win = w;

  w.loadFile(m.file);

  if (m.viewportZoom) {
    // 版面锚点：加载完成后把缩放系数定死，视口就恒等于原版的 1280×720
    w.webContents.on('did-finish-load', () => {
      w.webContents.setZoomFactor(zoomFor(size.w));
      w.webContents.insertCSS(TV_DRAG_CSS).catch(() => {});
    });
    // 右键弹同一套控制菜单：frameless 窗口没有标题栏，总得有个入口
    w.webContents.on('context-menu', () => {
      Menu.buildFromTemplate(controlTemplate()).popup({ window: w });
    });
  }

  // screen-saver 层级高于普通置顶，能压在菜单栏与全屏窗口之上
  if (state.alwaysOnTop) w.setAlwaysOnTop(true, 'screen-saver');
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (m.clickThrough && state.clickThrough) w.setIgnoreMouseEvents(true, { forward: true });
  if (state.hidden) w.hide();

  // 拖动过程中持续记录位置，节流写入避免拖动时狂刷磁盘
  let saveTimer = null;
  const rememberPos = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const [x, y] = win.getPosition();
      state.pos[state.mode] = { x, y };
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

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function applyAlwaysOnTop(on) {
  state.alwaysOnTop = on;
  if (win) {
    win.setAlwaysOnTop(on, on ? 'screen-saver' : 'normal');
    if (on) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
  saveState();
  refreshTray();
  send('pet:flags', publicFlags());
}

function applyClickThrough(on) {
  state.clickThrough = on;
  if (win && mode().clickThrough) {
    win.setIgnoreMouseEvents(on, { forward: true });
    // 关掉强制穿透时置空，把控制权交还给渲染层的自动判定
    win.__ignoring = on ? true : null;
  }
  saveState();
  refreshTray();
  send('pet:flags', publicFlags());
}

function applySize(key) {
  const m = mode();
  if (!m.sizes[key] || !win || win.isDestroyed()) return;
  const [x, y] = win.getPosition();
  const s = m.sizes[key];
  state.size[state.mode] = key;
  state.pos[state.mode] = { x, y };
  win.setBounds({ x, y, width: s.w, height: s.h });
  // 缩放系数跟着窗口宽度走，版面才不会因为改尺寸而错位
  if (m.viewportZoom) win.webContents.setZoomFactor(zoomFor(s.w));
  saveState();
  refreshTray();
  send('pet:flags', publicFlags());
}

function switchMode(key) {
  if (!MODES[key] || key === state.mode) return;
  rememberBounds();
  const wasHidden = state.hidden;
  state.mode = key;
  saveState();

  const old = win;
  win = null; // 先断开，避免旧窗的 closed 事件把新窗引用抹掉
  if (old && !old.isDestroyed()) old.destroy();

  createWindow();
  if (wasHidden) win.hide();
  refreshTray();
}

function toggleVisible(force) {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  state.hidden = typeof force === 'boolean' ? force : !state.hidden;
  if (state.hidden) win.hide();
  else win.showInactive(); // showInactive：显示但不抢焦点
  saveState();
  refreshTray();
  send('pet:flags', publicFlags());
}

function resetPosition() {
  if (!win || win.isDestroyed()) return;
  const p = defaultPosition(curSize().w, curSize().h);
  win.setPosition(p.x, p.y);
  state.pos[state.mode] = p;
  saveState();
}

function publicFlags() {
  return {
    mode: state.mode,
    alwaysOnTop: state.alwaysOnTop,
    clickThrough: state.clickThrough,
    hidden: state.hidden,
    size: state.size[state.mode],
    sizes: Object.fromEntries(
      Object.entries(mode().sizes).map(([k, v]) => [k, { w: v.w, h: v.h, label: v.label }]),
    ),
  };
}

/* 托盘与右键菜单共用同一份模板 */
function controlTemplate() {
  const m = mode();
  const items = [
    { label: '巨兽都市桌宠', enabled: false },
    { label: m.label, enabled: false },
    { type: 'separator' },
    { label: state.hidden ? '显示' : '收起', click: () => toggleVisible() },
    { label: '回到右下角', click: resetPosition },
    { type: 'separator' },
    {
      label: '窗口大小',
      submenu: Object.entries(m.sizes).map(([key, s]) => ({
        label: `${s.label}  (${s.w}×${s.h})`,
        type: 'radio',
        checked: state.size[state.mode] === key,
        click: () => applySize(key),
      })),
    },
    {
      label: '画面',
      submenu: Object.entries(MODES).map(([key, v]) => ({
        label: v.label,
        type: 'radio',
        checked: state.mode === key,
        click: () => switchMode(key),
      })),
    },
    {
      label: '持续置顶',
      type: 'checkbox',
      checked: state.alwaysOnTop,
      click: (item) => applyAlwaysOnTop(item.checked),
    },
  ];
  if (m.clickThrough) {
    items.push({
      label: '穿透点击（只观赏）',
      type: 'checkbox',
      checked: state.clickThrough,
      click: (item) => applyClickThrough(item.checked),
    });
  }
  items.push({ type: 'separator' }, { label: '退出', role: 'quit' });
  return items;
}

function refreshTray() {
  if (!tray) return;
  tray.setToolTip(`巨兽都市桌宠 · ${mode().label}`);
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
 * IPC：全部来自渲染层（只有底座模式用），逐条做类型校验
 * ------------------------------------------------------------------ */
function registerIPC() {
  ipcMain.on('pet:drag', (_e, payload) => {
    if (!win || win.isDestroyed() || state.clickThrough) return;
    const x = Math.round(Number(payload?.x));
    const y = Math.round(Number(payload?.y));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    win.setPosition(x, y);
  });

  ipcMain.on('pet:dragEnd', () => {
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    state.pos[state.mode] = { x, y };
    saveState();
  });

  ipcMain.on('pet:menu', (_e, payload) => {
    if (!win || win.isDestroyed()) return;
    const s = payload && typeof payload === 'object' ? payload : {};
    const template = [
      { label: s.title || '巨兽都市桌宠', enabled: false },
      { label: s.subtitle || '', enabled: false, visible: !!s.subtitle },
      { type: 'separator' },
      {
        label: s.paused ? '继续拆楼' : '暂停拆楼',
        click: () => send('pet:command', { type: 'togglePause' }),
      },
      {
        label: s.muted ? '开启音效' : '静音',
        click: () => send('pet:command', { type: 'toggleMute' }),
      },
      { type: 'separator' },
      {
        label: '窗口大小',
        submenu: Object.entries(PET_SIZES).map(([key, sz]) => ({
          label: `${sz.label}  (${sz.w}×${sz.h})`,
          type: 'radio',
          checked: state.size.pet === key,
          click: () => applySize(key),
        })),
      },
      {
        label: '持续置顶',
        type: 'checkbox',
        checked: state.alwaysOnTop,
        click: (item) => applyAlwaysOnTop(item.checked),
      },
      {
        label: '穿透点击（只观赏）',
        type: 'checkbox',
        checked: state.clickThrough,
        click: (item) => applyClickThrough(item.checked),
      },
      { type: 'separator' },
      { label: '回到右下角', click: resetPosition },
      { label: '收起（托盘里能叫回来）', click: () => toggleVisible(true) },
      { label: '退出', role: 'quit' },
    ];
    Menu.buildFromTemplate(template).popup({ window: win });
  });

  ipcMain.on('pet:quit', () => app.quit());
  ipcMain.handle('pet:flags', () => publicFlags());

  /* 自动穿透：渲染层判定光标是否压在实体像素上，这里只负责切换。
   * 强制穿透开启时忽略渲染层的请求，避免两边互相覆盖。 */
  ipcMain.on('pet:setIgnoreMouse', (_e, ignore) => {
    if (!win || win.isDestroyed()) return;
    if (!mode().clickThrough || state.clickThrough) return; // 电视模式没有穿透这回事
    const next = ignore === true;
    if (win.__ignoring === next) return;   // 状态未变就不打扰系统
    win.__ignoring = next;
    win.setIgnoreMouseEvents(next, { forward: true });
  });
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
    registerIPC();
    createWindow();
    createTray();
  });

  // 托盘应用：关掉窗口不等于退出
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => {
    rememberBounds();
    saveState();
  });
}
