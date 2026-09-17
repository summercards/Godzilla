/* 巨兽都市桌宠 · 迷你电视的存档接管（contextBridge 版）
 *
 * 画面只认 window.__tvBridge.storage（见 tv/game.js 里的 SAVEIO 常量），
 * 这一层把那一个键接到 <userData>/save/tv.json。
 * 桥不在的时候 —— 直接用浏览器打开 tv/index.html、或者 build/tv-shot.cjs
 * 那种自带窗口的截图工具（它不挂 preload）—— 画面自动落回真正的
 * localStorage，见 SAVEIO 那一行的兜底。
 *
 * 为什么必须是 preload ——
 *   game.js 一启动就同步读档：
 *     raw = JSON.parse(SAVEIO.getItem(SAVE) || 'null')
 *   桥必须赶在任何页面脚本之前装好，只有 preload 卡在这个位置上。
 *
 * 为什么用 contextBridge，而不是去改 Storage.prototype ——
 *   最早的做法是关掉 contextIsolation、与页面共用同一个 window，
 *   然后直接改它的 Storage.prototype，让画面"以为自己还在跟 localStorage 打交道"。
 *   那套的代价是整个渲染进程没有隔离，而 Electron 在持续收紧这一层：
 *   哪天这条路被堵死，就只能在"不升级 Electron"和"重写存档层"之间二选一。
 *   现在换成官方文档化的双向桥 —— 隔离打开，画面显式地调这个接口。
 *   代价是 tv/game.js 要认识 SAVEIO（改动见那个文件的注释），
 *   换来的是这条路不会随 Electron 版本失效。
 *
 * 读：启动时用 sendSync 一次性把文件内容取回内存，getItem 直接返回内存值。
 *     保持同步语义是关键 —— 换成异步会打乱 game.js 的启动时序
 *     （它会先拿到 null 建一份新档，再被迟到的文件覆盖成两次初始化）。
 * 写：setItem 只写内存并标脏，防抖后异步推给主进程；
 *     而在 pagehide / visibilitychange 这两个"等不到异步回调"的时刻用 sendSync 落盘。
 *     这两个点正是 tv 自己在调 save() 的地方，跟它的节奏对齐。
 *
 * 隔离世界与页面共用同一份 localStorage（同一个 origin、同一份存储），
 * 所以页面以前写下的老档在这里仍然读得到 —— 而那是唯一一次机会：
 * 迁移只可能在安装之前做（见下面 boot 那段）。
 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/* 画面自己的存档键。tv/ 里改了这个常量，这里必须跟着改 ——
 * 有 tests/tv.test.cjs 的断言盯着，不会静默失联。 */
const KEY = 'gnn-kaiju-idle-v3';

/* 防抖窗口。画面自己每 5 秒存一次（game.js 里 saveTimer），
 * 这里的 1 秒只是为了合并用户连点强化/解锁时的密集写入。 */
const DEBOUNCE_MS = 1000;

let mem = null;      // 当前存档字符串；null 表示还没有档，画面会走默认值
let dirty = false;   // 内存比磁盘新
let timer = null;

/* 一次性握手：向主进程要文件里的档，顺带完成老档迁移。
 *
 * 迁移必须在这一刻读原件 —— 页面一旦改用桥，那份老档就再也没人读了，
 * 会永远困在浏览器存储里。所以这里直接读 localStorage（与页面同一份），
 * 连同文件里的档一起交给主进程判断该怎么处理。 */
let boot = null;
try {
  let legacy = null;
  try { legacy = window.localStorage.getItem(KEY); } catch { /* 存储不可用 */ }
  boot = ipcRenderer.sendSync('tv:saveBoot', legacy || null);
} catch {
  // 桥不通就退化成纯内存档：这一局照常玩，只是关掉就没了
  boot = null;
}

if (boot && typeof boot.payload === 'string') mem = boot.payload;
// 迁移结果不弹窗：画面没有给外部留通知出口，硬塞一条会破坏它自己的版面。
// 需要确认时看 __tvBridge.info().migrated 即可。

function push(async_) {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!dirty) return;
  dirty = false;
  try {
    if (async_) ipcRenderer.send('tv:saveWrite', mem);
    else ipcRenderer.sendSync('tv:saveWriteSync', mem);
  } catch { /* 主进程没了就认了，这一帧的进度留着下次写 */ }
}

const flushAsync = () => push(true);
const flushSync = () => push(false);

/* 画面交过来的成长钩子（tv/game.js 末尾的 window.__growth）。
 *
 * 隔离之后外壳再也看不见页面里的全局对象了，所以反过来由画面主动交出来。
 * 只接函数、不接内部状态：economy / data 一律不交。 */
let growth = null;

/* ------------------------------------------------------------------ *
 * 存档桥
 *
 * storage 是给画面用的（SAVEIO 就是它）。只换掉画面那一个键，
 * 其余读写一律原样转给真正的 localStorage —— 与旧实现的那条口径一致。
 * ------------------------------------------------------------------ */
contextBridge.exposeInMainWorld('__tvBridge', {
  storage: {
    getItem: (key) => (key === KEY ? mem : window.localStorage.getItem(key)),
    setItem: (key, value) => {
      if (key !== KEY) return window.localStorage.setItem(key, value);
      mem = String(value);
      dirty = true;
      if (!timer) timer = setTimeout(flushAsync, DEBOUNCE_MS);
    },
  },

  /* 画面在文件末尾把它那份钩子交进来。没交之前 growth 是 null，
   * 主进程推来的指令会被安静地丢掉 —— 那时页面还没跑起来，本来也执行不了。 */
  register: (api) => { growth = api; },

  /* 同步落盘。画面在 pagehide 里调它 —— 那一刻异步 IPC 根本发不出去。 */
  flush: () => { flushSync(); return true; },

  /* 调试口。QA 用它确认桥确实装上了，而不是静默退回 localStorage。 */
  info: () => ({
    installed: true,
    hasData: mem !== null,
    bytes: mem ? mem.length : 0,
    pending: dirty,
    origin: boot ? boot.source : 'none',
    migrated: !!(boot && boot.migrated),
  }),
});

// 页面卸载前最后一次落盘，必须是同步的 —— 异步 IPC 在这时候根本发不出去
window.addEventListener('pagehide', flushSync);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSync(); });

/* ------------------------------------------------------------------ *
 * 面板状态上报
 *
 * 画面自带一个全屏观测面板（#management），桌宠要跟着做一件事：
 * 它打开时把窗口放大到 1:1 —— 否则面板里的字还是被 0.46 倍缩放压过的，
 * 12px 落到屏幕上只剩 5.6px；关掉时缩回小电视。
 *
 * 用 MutationObserver 盯属性、而不是监听"关闭"按钮的点击，是因为面板
 * 不止一个出口：`× 返回直播` 关得掉，Esc 也关得掉。盯属性是唯一能覆盖
 * 全部出口的做法，将来加了新出口也不用改这里。
 *
 * 这段监听装在隔离世界里 —— DOM 是两个世界共用的，事件照样收得到。
 * ------------------------------------------------------------------ */
contextBridge.exposeInMainWorld('__tvHost', { openPanel: requestPanel });

/* 打开面板：先让画面把进度交出来（save）再落盘，最后才通知主进程开窗 ——
 * 顺序反了的话，面板会拿着上一次写盘的旧档渲染自己，看起来像"刚加的
 * 点数丢了"。点击拦截与页面里的按钮走的是同一个函数。 */
function requestPanel(key) {
  growth?.save();
  flushSync();
  ipcRenderer.send('tv:openPanel', key);
}

// 捕获阶段阻止旧 onclick，键盘激活也经过同一入口。
document.addEventListener('click', (e) => {
  const el = e.target.closest?.('[id^="open-"]');
  if (!el || !['assign', 'talent', 'evo', 'stats', 'skills', 'news', 'settings'].includes(el.id.slice(5))) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  requestPanel(el.id.slice(5));
}, true);

ipcRenderer.on('tv:command', (_e, payload) => {
  const result = growth?.command(payload);
  flushSync();
  if (result) ipcRenderer.send('tv:rolled', result);
});
ipcRenderer.on('tv:snapshot', () => { growth?.save(); flushSync(); });

function guardMainPanel() {
  const mgmt = document.getElementById('management');
  if (!mgmt) return;
  mgmt.hidden = true;
  new MutationObserver(() => { if (!mgmt.hidden) mgmt.hidden = true; })
    .observe(mgmt, { attributes: true, attributeFilter: ['hidden'] });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', guardMainPanel);
else guardMainPanel();
