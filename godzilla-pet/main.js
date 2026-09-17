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
 * 唯一的例外是存档这件事本身：画面认的是它的存档键，而这里把那个键接到了文件上。
 * 动手的是 tv-preload.js —— 它通过 contextBridge 把接口交给画面（见那个文件顶部）。
 * 渲染进程的隔离是开着的。 */
'use strict';

const { app, BrowserWindow, ipcMain, Menu, Tray, screen, shell, dialog, nativeImage, crashReporter } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const { TV_DRAG_CSS, TV_TRANSPARENT_CSS, PANEL_ONLY_CSS, PANEL_READABLE_CSS, TV_SIZES, PANEL_SIZES, zoomFor, panelBounds, panelBox } = require('./tv-config.js');
const { createStore } = require('./save-store.js');
const { createLogger } = require('./log-store.js');
const { createSaveGuard } = require('./save-guard.js');
const { createResetSave, isTrustedWindowSender } = require('./save-reset.js');

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

/* ------------------------------------------------------------------ *
 * 可观测性：文件日志 + 崩溃转储
 *
 * 这一层存在的理由只有一个：这个应用要连续跑几个月，而它跑在别人的机器上。
 * 玩家报"挂了一晚上等级不对"的时候，没有日志就只能靠猜；而挂机类的故障
 * （数值跑飞、内存缓慢增长、渲染进程悄悄死掉）恰恰只在长时运行里出现，
 * 在开发机上永远复现不了。
 *
 * 所以这里只做两件事：把主进程的关键事件写进一个能事后查看的文件，
 * 以及真崩溃时留下一份可读的转储。日志的写法与约束见 log-store.js。
 * ------------------------------------------------------------------ */
const LOG_DIR = () => path.join(app.getPath('userData'), 'logs');
const CRASH_DIR = () => path.join(app.getPath('userData'), 'crashes');

let _log = null;

/* 日志拿不到目录也不能让应用起不来：这一层是来帮忙的，不是来添乱的。
 * 真到了那一步就静默成空操作，应用照常跑。 */
function logger() {
  if (!_log) {
    try {
      _log = createLogger({ dir: LOG_DIR(), name: 'main.log' });
    } catch (error) {
      _log = {
        file: '',
        info: () => {}, warn: () => {}, error: () => {},
        meta: () => ({ broken: String((error && error.message) || error) }),
      };
    }
  }
  return _log;
}

/* 三层包装只是为了让"日志自身出错"不冒到调用点上 —— 它不该有能力打断应用。 */
const logInfo = (message, extra) => { try { logger().info(message, extra); } catch { /* 日志不能反过来打断应用 */ } };
const logWarn = (message, extra) => { try { logger().warn(message, extra); } catch { /* 同上 */ } };
const logError = (message, extra) => { try { logger().error(message, extra); } catch { /* 同上 */ } };

/* 崩溃转储落在 userData 下，和存档、日志并列。
 *
 * submitURL 先留空、uploadToServer 关掉：现在还没有收集端，把 dump 上传到
 * 一个不存在的地方毫无意义。但**留着 dump 本身就是收益** —— 玩家机器上的
 * 崩溃第一次有了可回传的证据。将来接上报只需填 submitURL 并打开开关。 */
function startCrashReporter() {
  try {
    app.setPath('crashDumps', CRASH_DIR());
    crashReporter.start({ submitURL: '', uploadToServer: false, compress: false, productName: '巨兽都市桌宠' });
  } catch (error) {
    logError('崩溃转储没能启动', { error: String((error && error.message) || error) });
  }
}

/* 启动的第一条日志。版本与平台必须记下来 ——
 * "在谁的机器上、跑的是哪一版"是所有后续排查的前提。 */
function initObservability() {
  try { app.setPath('logs', LOG_DIR()); } catch { /* setPath 失败不影响写日志，logger 自己会 mkdir */ }
  logInfo('启动', {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    userData: app.getPath('userData'),
  });
  startCrashReporter();
}

/* 退出兜底的那本账。写入函数与 save-store 的 write 同形，所以 save() 的返回值
 * 可以原样透传给 IPC 调用方；写失败则落一条日志 —— 必须留痕，否则
 * "玩家的进度为什么回退了"永远查不出来。语义见 save-guard.js。 */
let _guard = null;
const guard = () => (_guard ||= createSaveGuard({
  write: (payload) => store().write({ version: 1, payload }),
  onWriteFailed: (result, payload, reason) =>
    logError('存档写入失败', { reason, error: result.error, bytes: payload.length, file: store().file }),
}));

const STATE_FILE = () => path.join(app.getPath('userData'), 'pet-window.json');

/* 游戏画面的入口页。迷你电视直接播它——不复制、不改写，
 * 桌宠里怎么折腾都不会影响到里面的画面。 */
const ORIGINAL_GAME = path.join(__dirname, 'tv', 'index.html');

/* 画面的存档接管层。存档不落在页面私有的存储里，而是接到
 * <userData>/save/tv.json：这个 preload 用 contextBridge 把那个存档键
 * 交给画面，细节见该文件顶部。 */
const TV_PRELOAD = path.join(__dirname, 'tv-preload.js');

/* ------------------------------------------------------------------ *
 * 观测面板窗口
 *
 * 它是**另一个 tv 实例**，放大到 1:1，和电视窗口并存 —— 电视那边不动一个像素。
 * 之所以不把电视窗口本身放大：那样小电视就没了，而它本来就该一直挂在那儿播。
 *
 * 两个实例跑同一份 game.js，所以面板那份必须只读（见 panel-preload.js）。
 * ------------------------------------------------------------------ */
const PANEL_PRELOAD = path.join(__dirname, 'panel-preload.js');

/* 面板尺寸曾经是"电视尺寸 × 1.45"（PANEL_H_SCALE）。
 * 那是解耦之前的做法：宽度跟着电视走，只把高度放宽一点，理由是"两个窗口要成套"。
 * 代价是 small 档的面板只有 448×426 —— 20px 的资源数字塞进 4 列必然换行。
 * 2026-09-17 改成独立档位，这个常量随之删除，别再按电视尺寸去推面板尺寸。
 * 现在见 tv-config.js 的 PANEL_SIZES 与 panelBox()。 */

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
 * payload 保持字符串而不是解析后的对象 —— 它就是画面存档键里原本的那个值
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
  /* 面板档位是独立状态：它不跟着电视走，也不从电视推导（见 tv-config.js）。 */
  panelSize: 'standard',
  pos: null,
  alwaysOnTop: true,
  hidden: false,
};

let win = null;
let tray = null;
let state = structuredClone(DEFAULTS);

const curSize = () => TV_SIZES[state.size] || TV_SIZES.medium;
const curPanelSize = () => PANEL_SIZES[state.panelSize] || PANEL_SIZES.standard;

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
  /* 面板档位是 Step 4 新增的字段，老档里没有它。
   * 刻意**不**按电视档位推一个初值 —— 解耦本身就是要让两者不再相关，
   * 从电视推等于把耦合重新引进来一次。一律回落到 standard。 */
  const pickPanelSize = (v) => (PANEL_SIZES[v] ? v : DEFAULTS.panelSize);
  const pickPos = (v) =>
    v && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null;

  const legacyPos = Number.isFinite(raw.x) && Number.isFinite(raw.y) ? { x: raw.x, y: raw.y } : null;
  const pos = raw.pos && typeof raw.pos === 'object' ? raw.pos.tv ?? raw.pos : null;

  state = {
    size: pickSize(raw.size && typeof raw.size === 'object' ? raw.size.tv : raw.size),
    panelSize: pickPanelSize(raw.panelSize),
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
    /* 电视柜以外必须透出桌面，不是一圈黑边。这需要**窗口与页面两层一起透明**：
     * 窗口开 transparent 只是前提，页面自己给 html/body 刷的那两层底色还得由
     * TV_TRANSPARENT_CSS 抹掉（见 tv-config.js）。
     * backgroundColor 必须是全透明而不是 '#050a15' —— 半透明/不透明的底色会让
     * 窗口创建瞬间先闪一块黑，而页面加载完又变得看见桌面。
     * 拖动区仍然靠 TV_DRAG_CSS 的 -webkit-app-region，透明区域在 Windows 上
     * 照常接鼠标事件，拖拽行为不变。 */
    transparent: true,
    backgroundColor: '#00000000',
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
      /* 渲染进程隔离开着。存档桥走 contextBridge（tv-preload.js 顶部有理由），
       * 不再需要跟页面共用同一个 window。nodeIntegration 也是 false，
       * 页面拿不到 require。 */
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false, // 挂机游戏不能因为窗口失焦就降频
    },
  });
  win = w;

  /* 窗口的物理尺寸与缩放系数是"版面看起来对不对"的全部输入，记下来 ——
   * 玩家截图里画面偏了，第一件事就是比对这一行。 */
  logInfo('电视窗口已创建', {
    size: state.size, w: size.w, h: size.h, x: pos.x, y: pos.y,
    zoom: Number(zoomFor(size.w).toFixed(4)),
    alwaysOnTop: state.alwaysOnTop, hidden: state.hidden,
  });

  w.loadFile(ORIGINAL_GAME);

  // 版面锚点：加载完成后把缩放系数定死，视口就恒等于原版的设计尺寸。
  // 注入只补 frameless 窗口缺的拖动把手 + 抹掉页面自己的底色（见 tv-config.js）。
  w.webContents.on('did-finish-load', () => {
    w.webContents.setZoomFactor(zoomFor(size.w));
    w.webContents.insertCSS(TV_DRAG_CSS).catch(() => {});
    /* 电视柜以外的留白透出桌面。**只在电视窗口注入** —— 面板是摆在旁边的
     * 一块菜单，透出桌面只会让面板里的字压在壁纸上，更难读。 */
    w.webContents.insertCSS(TV_TRANSPARENT_CSS).catch(() => {});
  });
  // 右键弹控制菜单：frameless 窗口没有标题栏，总得有个入口
  w.webContents.on('context-menu', () => popupControlMenu(w));

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
  w.on('closed', () => { if (win === w) win = null; logInfo('电视窗口已关闭'); });

  /* 画面卡死是挂机场景里最典型的故障：进程还在、画面不动、存档也不再更新。
   * 它可能自己缓过来，但必须留痕 —— 否则玩家说"挂了两小时什么都没涨"时，
   * 我们连"它卡过"都不知道。 */
  w.webContents.on('unresponsive', () => logError('画面无响应'));
  w.webContents.on('responsive', () => logInfo('画面恢复响应'));

  // 外部链接交给系统浏览器，窗口本身永远不导航
  w.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // 面板窗口开着时跟随主电视位置。
  w.on('moved', placePanel);
  w.on('resize', placePanel);
}

/* 面板窗口。它是个真正的独立窗口，和电视窗口并存；
 * 非 null 就代表面板正开着。 */
let panelWin = null;

let panelKey = 'assign';
const PANEL_KEYS = new Set(['assign', 'talent', 'evo', 'stats', 'skills', 'news', 'settings']);

/* 把面板窗口摆在电视窗口旁边，跟它成对。
 *
 * 优先右侧（面板是电视的"遥控屏"，放右手边顺手）；
 * 右边顶到屏幕边缘就翻到左侧；两边都放不下时退回居中 ——
 * 宁可盖住一点别的，也不能跑到屏幕外。 */
function placePanel() {
  if (!panelWin || panelWin.isDestroyed() || !win || win.isDestroyed()) return;
  const b = win.getBounds();
  const area = screen.getDisplayMatching(b).workArea;

  /* 目标尺寸取自**档位**，不是面板窗口自己当前的 bounds。
   *
   * 用当前 bounds 会让"改档位"这一步自相矛盾：窗口尺寸与算位置用的输入是
   * 同一份旧值，结果是档位换了、位置却按旧尺寸算 —— 差出去正好一个面板宽度，
   * 面板会看着像没挪窝，也可能压到屏幕外。档位是唯一真相。 */
  panelWin.setBounds(panelBounds(b, panelBox(state.panelSize), area));
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
function openPanel(key = 'assign') {
  if (reloading || !win || win.isDestroyed() || !PANEL_KEYS.has(key)) return;
  panelKey = key;
  win.webContents.send('tv:snapshot');
  if (panelWin && !panelWin.isDestroyed()) {
    panelWin.webContents.send('panel:select', key);
    placePanel(); panelWin.show(); panelWin.focus(); return;
  }

  /* 尺寸用面板自己的档位，不再跟电视走。
   * 缩放仍必须保持 1：面板要的是游戏自己的窄屏紧凑断点
   * （max-height:480 那套，字号是真实的屏幕像素），而不是把 1120 宽的
   * 直播版面再压扁一遍 —— 那正是"文字太小无法看到"的原因。 */
  const ps = curPanelSize();

  panelWin = new BrowserWindow({
    width: ps.w,
    height: ps.h,
    frame: false,
    /* 面板**故意不透明**（与电视窗口相反，见 createWindow 里的 transparent）。
     * 它是一块摆在电视旁边的菜单，字要压在纯色底上才读得清；
     * 它的三个注入里也**没有** TV_TRANSPARENT_CSS。 */
    backgroundColor: '#050a15',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: PANEL_PRELOAD,
      // Chromium shares origin zoom within a session. Keep the read-only panel
      // in an ephemeral session so its 1:1 zoom cannot resize the TV viewport.
      partition: 'kaiju-panel',
      // 同 tv-preload：存档桥走 contextBridge，渲染进程隔离保持开启
      contextIsolation: true,
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
    // 三条注入：拖动把手、只留观测面板、可读性放大
    // （后两条的理由见 tv-config.js；放大是用户反馈"字也太小了"）。
    panelWin.webContents.insertCSS(TV_DRAG_CSS).catch(() => {});
    panelWin.webContents.insertCSS(PANEL_ONLY_CSS).catch(() => {});
    panelWin.webContents.insertCSS(PANEL_READABLE_CSS).catch(() => {});
  });
  panelWin.once('ready-to-show', () => { if (panelWin) panelWin.show(); });
  panelWin.on('closed', () => { panelWin = null; });

  /* 面板窗口也要有右键菜单（理由见 popupControlMenu）。
   * 这里是主进程侧的事件，面板 preload 的只读白名单管不着它 —— 退出、存档导出、
   * 面板大小这些都不属于"游戏操作"，本来就不该走那条转发通道。 */
  panelWin.webContents.on('context-menu', () => popupControlMenu(panelWin));

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
  placePanel();
}

/* 改面板档位。
 *
 * 与 applySize 的区别：电视是主窗口，改尺寸要连缩放系数一起改（版面靠它）；
 * 面板是 1:1 的副窗口，尺寸纯粹是外框，改完重新定位一次即可。
 *
 * 面板没开着时也照改 —— 档位是持久状态，下次打开自然用新尺寸。
 * 托盘菜单的勾选状态靠 refreshTray() 刷。 */
function applyPanelSize(key) {
  if (!PANEL_SIZES[key]) return;
  state.panelSize = key;
  saveState();
  refreshTray();
  placePanel();
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
}

function resetPosition() {
  if (!win || win.isDestroyed()) return;
  const p = defaultPosition(curSize().w, curSize().h);
  win.setPosition(p.x, p.y);
  state.pos = p;
  saveState();
  placePanel();
}

/* 右键弹出控制菜单。
 *
 * frameless 窗口没有标题栏也没有关闭按钮，右键菜单是"这个窗口上还能做什么"
 * 的唯一出口 —— 也是"我怎么退出"这个问题的答案所在。
 *
 * **两个窗口都要装。** 电视是观赏位、面板是操作台（定调），玩家在面板里待的时间
 * 长得多；只给电视装的话，"退出"恰恰在最常用的那个窗口里找不到。
 *
 * 走原生菜单还有一个附带好处：菜单由主进程直接构建，不经过 preload 的白名单转发，
 * 所以面板窗口仍然是纯只读的 —— 没有为"退出"新开任何一条写存档的口子。 */
function popupControlMenu(target) {
  if (!target || target.isDestroyed()) return;
  Menu.buildFromTemplate(controlTemplate()).popup({ window: target });
}

/* 托盘与右键菜单共用同一份模板 */
function controlTemplate() {
  return [
    { label: '巨兽都市桌宠', enabled: false },
    { label: '迷你电视 · 原版画面', enabled: false },
    { type: 'separator' },
    { label: state.hidden ? '显示' : '收起', click: () => toggleVisible() },
    { label: '回到右下角', click: resetPosition },
    /* 面板是游戏 UI 的正规位置（定调），也是被 skipTaskbar 排除在任务栏之外的那个
     * 窗口的入口 —— 托盘菜单里必须能把它叫回来，否则玩家把电视收起来之后
     * 就只剩"右键电视窗口"这一条路，而电视可能正被收起。 */
    { label: '打开观测面板', click: () => openPanel() },
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
      /* 与「窗口大小」并列但**互不影响**：电视是摆件、面板是操作台，
       * 玩家要的组合通常是"小电视 + 大面板"。见 tv-config.js 的 PANEL_SIZES。 */
      label: '面板大小',
      submenu: Object.entries(PANEL_SIZES).map(([key, s]) => ({
        label: `${s.label}  (${s.w}×${s.h})`,
        type: 'radio',
        checked: state.panelSize === key,
        click: () => applyPanelSize(key),
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
    { label: '打开日志文件夹', click: revealLogs },
    { type: 'separator' },
    /* 退出必须走 app.quit()：它才会走完 before-quit → 存档兜底补写 → quit 这一串。
     * 用 window.close() 或 process.exit() 都会绕过兜底，最坏情况丢掉最后一次进度。
     *
     * 这里刻意写成显式 click，而不是 `role: 'quit'`。两者行为等价（role 内部就是
     * app.quit()），但显式写法能被端到端验收真的点一下 —— Step 2 那层"退出兜底"
     * 的落盘正是靠这条路径验证的，而 role 项没法从脚本里触发。 */
    { label: '退出', click: () => app.quit() },
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

/* 日志对玩家只有一个用处：报问题的时候能找得到、发得出来。
 * 藏在 userData 深处等于没有，所以托盘里给一个入口。 */
function revealLogs() {
  const meta = logger().meta();
  const dir = meta.dir || app.getPath('userData');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* 建不出来就让 openPath 去报错 */ }
  shell.openPath(dir);
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
  if (out.ok) logInfo('导出了存档', { bytes: out.bytes, from: out.backup ? 'backup' : 'main' });
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
  if (out.ok) {
    /* 文件已经被整体替换，主进程缓存的那一份从此过期，必须当场作废。
     * 不能只指望重载后的那次握手 —— 那个握手有可能永远不来（画面卡死或崩溃），
     * 而缓存只要留到退出，就会把刚导入的档盖回旧数据，正是这场竞态的翻版。 */
    guard().discard('import');
    logWarn('导入了存档', { bytes: out.bytes });
    reloadSave();
  } else await pickWin('showMessageBox', {
    type: 'error', message: '这个文件不是有效的存档', detail: out.error || '未知原因',
  });
  return out;
}

const resetSave = createResetSave({
  getStore: store, getGuard: guard,
  defaults: () => require('./tv/progression.js').defaults(),
  isSave: isSaveV1, isReloading: () => reloading,
  confirm: (options) => pickWin('showMessageBox', options),
  notify: (options) => pickWin('showMessageBox', options),
  reload: reloadSave, closePanel,
  log: logWarn, errorLog: logWarn,
});

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
   * legacy 是页面存储里那份老档（tv-preload.js 在装桥之前读出来的，
   * 它与页面共用同一份 localStorage）。文件里还没有档、而浏览器存储里有
   * 的时候把它搬进文件 —— 画面一旦改用桥，那份老档就再也没人读了，
   * 只有这一次机会。搬完文件立刻存在，所以只会搬一次。 */
  ipcMain.on('tv:saveBoot', (e, legacy) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents) {
      e.returnValue = SAVE_BUSY;
      return;
    }
    reloading = false;                     // 握手应答即开闸

    const r = store().read();
    let payload = r.data && typeof r.data.payload === 'string' ? r.data.payload : null;
    let migrated = false;

    if (payload === null && typeof legacy === 'string' && legacy) {
      const w = store().write({ version: 1, payload: legacy });
      if (w.ok) { payload = legacy; migrated = true; }
    }

    /* 画面重载之后一律以文件为准，主进程缓存的那一份必须作废 ——
     * 否则退出兜底会把导入前的旧档写回去（save-guard.js 顶部那条规则）。 */
    guard().discard('boot');

    /* 认档结果只留这一行，但它值钱：source=backup 意味着主档读不出来、
     * 玩家是从备份救回来的 —— 那是"存档曾经损坏"的唯一线索。
     * 注：日常的 5 秒写盘刻意不记，一天一万七千行只会把日志淹掉。 */
    if (r.source === 'backup') logWarn('主档读不出来，已从备份恢复', { bytes: payload ? payload.length : 0 });
    else logInfo('画面认档完成', { source: r.source, bytes: payload ? payload.length : 0, migrated });

    e.returnValue = { payload, migrated, source: r.source };
  });

  ipcMain.on('tv:saveWrite', (e, payload) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents || reloading || typeof payload !== 'string') return;
    guard().save(payload);   // 失败会自己落日志，并把这一份留作退出兜底
    syncPanel(payload);
  });

  /* 同步写入。只在页面即将卸载（pagehide）时用：那一刻没有"稍后"，
   * 异步 IPC 的回调根本来不及跑，而这是退出前的最后一次落盘机会。
   * 日常的写入走异步那条，不阻塞渲染帧。 */
  ipcMain.on('tv:saveWriteSync', (e, payload) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents || reloading || typeof payload !== 'string') { e.returnValue = SAVE_BUSY; return; }
    e.returnValue = guard().save(payload);
    syncPanel(payload);
  });

  ipcMain.on('save:reveal', revealSave);
  ipcMain.handle('save:export', exportSave);
  ipcMain.handle('save:import', importSave);
  ipcMain.handle('save:reset', (e) => {
    const trusted = isTrustedWindowSender(e.sender, [panelWin, win]);
    if (!trusted) return { ok: false, error: '不允许此窗口重置存档' };
    return resetSave();
  });
}

/* 控制按钮与面板窗口之间的三条通道。
 * 按钮只喊一声"开"；面板那边负责报"用户点了什么"和"我关了"。 */
function registerDockIPC() {
  ipcMain.on('tv:openPanel', (e, key) => {
    if (e.sender === win?.webContents) openPanel(key);
  });

  /* 面板启动时要一份存档 —— 给文件里那一份。
   * 面板自己不准写盘，只读这一份（见 panel-preload.js）。 */
  ipcMain.on('panel:boot', (e) => {
    const r = store().read();
    e.returnValue = {
      payload: r.data && typeof r.data.payload === 'string' ? r.data.payload : null,
      source: r.source,
      key: panelKey,
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
  ipcMain.on('panel:tap', (e, payload) => {
    if (e.sender !== panelWin?.webContents || !win || win.isDestroyed()) return;
    win.webContents.send('tv:command', payload);
  });
  ipcMain.on('tv:rolled', (e, result) => {
    if (e.sender === win?.webContents && panelWin && !panelWin.isDestroyed()) panelWin.webContents.send('panel:rolled', result);
  });
  ipcMain.on('panel:done', (e) => { if (e.sender === panelWin?.webContents) closePanel(); });
}

/* 面板的一致性同步：电视窗口每次落盘后，把 payload 推给面板。
 *
 * 面板的存档是只读的，它靠"同一份存档 + 同一串点击"和电视保持一致。
 * 但电视在面板开着的时候一直在跑（自动强化、自动解锁技能、自动掷进化；
 * 加点机会不自动花，那是留给玩家回来点的），
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
 * 进程级安全网
 *
 * 装在单实例锁之前：这几个回调只写日志、只请求退出，不依赖任何初始化。
 * ------------------------------------------------------------------ */

/* 主进程的兜底。装了处理器，进程就不会因为一个未捕获的异常直接消失 ——
 * 对一个要连续跑几个月的桌宠来说，带着一条日志活下去比干净地死去有用。
 * 代价是可能带着坏状态继续跑，所以每条都记 error，事后看得出来发生过什么。 */
process.on('uncaughtException', (error) => {
  logError('未捕获的异常', {
    message: String(error && error.message),
    stack: String(error && error.stack),
  });
});
process.on('unhandledRejection', (reason) => {
  logError('未处理的 Promise 拒绝', {
    reason: String(reason && reason.stack ? reason.stack : reason),
  });
});

/* 系统信号不需要自己处理 —— 这是实测结论，不是假设。
 *
 * 曾经在这里装过 process.on('SIGTERM') 想保证"被 kill 时也能正常退出"，
 * 探针跑完发现它一次都没被调用过：Electron（Chromium）在 C++ 层就接管了
 * SIGTERM，并且自己走完整的退出流程。实测的事件序列是
 *
 *   kill -TERM <pid>  →  before-quit  →  will-quit  →  quit
 *
 * 三条都触发了，而 Node 那一侧的处理器始终沉默。也就是说兜底落盘与画面的
 * pagehide 在 SIGTERM 路径下本来就都会跑到，再装一层只是重复，还会让注释
 * 说假话（"这一层保证了不丢档"——真正保证它的是平台）。
 *
 * 顺带一个实测数字：SIGTERM 到存档落盘之间约 200ms。所以"按 kill 后重启，
 * 存档时间戳应当是 last moment"这条是可复现的（记录在 docs/技术线调整方向.md
 * 的 Step 2 完成记录里）。
 *
 * 未测部分：Windows 上不存在真正的 SIGTERM，外部终止走的是别的路径，
 * 那一半仍属 Step 1 的欠账。 */

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */
// 第二次启动时只是把已有窗口叫回视线，不新开一个
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => toggleVisible(false));

  /* 渲染进程真的死掉（不是卡住）比 unresponsive 严重：画面没了，
   * 存档也不再更新，玩家看到的是一块不动的电视。 */
  app.on('render-process-gone', (_e, _webContents, details) => {
    logError('渲染进程退出', { reason: details && details.reason, exitCode: details && details.exitCode });
  });
  app.on('child-process-gone', (_e, details) => {
    logError('子进程退出', {
      type: details && details.type, reason: details && details.reason, exitCode: details && details.exitCode,
    });
  });

  app.whenReady().then(() => {
    initObservability();       // 先起日志：这之后每一步的失败都要能被记下来
    if (process.platform === 'darwin') app.dock?.hide(); // 桌宠不占 Dock
    Menu.setApplicationMenu(null);
    loadState();
    /* 记下读回来的窗口状态。它比产品活得久，历史上换过三种形状 ——
     * 万一某次升级后位置或档位不对，这一行能立刻区分"读错了"还是"没生效"。 */
    logInfo('窗口状态已载入', {
      size: state.size, pos: state.pos, alwaysOnTop: state.alwaysOnTop, hidden: state.hidden,
    });
    registerSaveIPC();
    registerDockIPC();
    createWindow();
    // 旧 dock 已移除，功能入口只通过主电视捕获后打开独立副屏。
    createTray();
  });

  // 托盘应用：关掉窗口不等于退出
  app.on('window-all-closed', () => {});

  /* 退出前记住窗口位置，外加补一次兜底落盘。
   *
   * 进度主要靠画面自己的 pagehide（tv-preload.js 的 flushSync）：窗口关闭时
   * 必定跑到，而且 sendSync 会一直阻塞到主进程把档写完为止。
   * 但那条路在下面几种情况下跑不到 ——
   *   上一次写盘就失败了、渲染进程已经不在、页面没来得及卸载 ——
   * 所以这里再补一次：主进程手上那份"最后一次收到的 payload"就是最后一道保险。
   * 正常情况下它是空转（不欠账就不碰磁盘）。 */
  app.on('before-quit', () => {
    rememberBounds();
    saveState();

    const f = guard().flush('before-quit');
    if (f.attempted && f.ok) logWarn('退出兜底：补写了未落盘的存档', { bytes: f.bytes });
  });

  app.on('quit', () => logInfo('已退出'));
}
