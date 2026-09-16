/* 巨兽都市桌宠 · 迷你电视的存档接管
 *
 * tv/ 里的代码一个字都不能改，所以存档从外面劫持：
 * 画面只认 localStorage['gnn-kaiju-idle-v3']（见 tv/game.js 里 SAVE 常量），
 * 这里把这一个键的读写换接到 <userData>/save/tv.json。
 * 页面完全无感，它仍然以为自己在跟 localStorage 打交道。
 *
 * 为什么必须是 preload ——
 *   game.js 一启动就同步读档：
 *     raw = JSON.parse(localStorage.getItem(SAVE) || 'null')
 *   替换必须赶在任何页面脚本之前完成，只有 preload 卡在这个位置上。
 *
 * 为什么 contextIsolation 要关掉 ——
 *   Storage.prototype 在隔离世界里是另一份对象，改它影响不到页面。
 *   关掉之后 preload 与页面共用同一个 window，改的就是页面那一份。
 *   nodeIntegration 仍然为 false，页面拿不到 require；
 *   preload 里的 ipcRenderer 也只是模块作用域的局部变量，不会挂到 window 上。
 *
 * 读：启动时用 sendSync 一次性把文件内容取回内存，getItem 直接返回内存值。
 *     保持同步语义是关键 —— 换成异步 API 会打乱 game.js 的启动时序
 *     （它会先拿到 null 建一份新档，再被迟到的文件覆盖成两次初始化）。
 * 写：setItem 只写内存并标脏，防抖后异步推给主进程；
 *     而在 pagehide / visibilitychange 这两个"等不到异步回调"的时刻用 sendSync 落盘。
 *     这两个点正是 tv 自己在调 save() 的地方，跟它的节奏对齐。
 */
'use strict';

const { ipcRenderer } = require('electron');

/* 画面自己的存档键。tv/ 里改了这个常量，这里必须跟着改 ——
 * 有 tests/tv.test.cjs 的断言盯着，不会静默失联。 */
const KEY = 'gnn-kaiju-idle-v3';

/* 先把原生的读写抓在手上，再安装劫持。抓不住的后果是自我递归。 */
const realGet = Storage.prototype.getItem;
const realSet = Storage.prototype.setItem;

/* 防抖窗口。画面自己每 5 秒存一次（game.js 里 saveTimer），
 * 这里的 1 秒只是为了合并用户连点强化/解锁时的密集写入。 */
const DEBOUNCE_MS = 1000;

let mem = null;      // 当前存档字符串；null 表示还没有档，画面会走默认值
let dirty = false;   // 内存比磁盘新
let timer = null;

/* 一次性握手：向主进程要文件里的档，顺带完成老档迁移。
 *
 * 迁移必须发生在安装劫持之前 —— 装好之后就再也读不到真正的 localStorage 了，
 * 那份老档会永远困在浏览器存储里。所以这里用抓下来的 realGet 读原件，
 * 连同文件里的档一起交给主进程判断该怎么处理。 */
let boot = null;
try {
  let legacy = null;
  try { legacy = realGet.call(window.localStorage, KEY); } catch { /* 存储不可用 */ }
  boot = ipcRenderer.sendSync('tv:saveBoot', legacy || null);
} catch {
  // 桥不通就退化成纯内存档：这一局照常玩，只是关掉就没了
  boot = null;
}

if (boot && typeof boot.payload === 'string') mem = boot.payload;
// 迁移结果不弹窗：画面没有给外部留通知出口，硬塞一条会破坏它自己的版面。
// 需要确认时看下面的 __tvSaveBridge.migrated 即可。

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

/* 只换掉画面那一个键，其余读写一律放行。
 * this 判断不能省：sessionStorage 用的是同一个 Storage.prototype，
 * 不区分的话会把同名键一起接走。 */
Storage.prototype.getItem = function (key) {
  if (key === KEY && this === window.localStorage) return mem;
  return realGet.call(this, key);
};

Storage.prototype.setItem = function (key, value) {
  if (key === KEY && this === window.localStorage) {
    mem = String(value);
    dirty = true;
    if (!timer) timer = setTimeout(flushAsync, DEBOUNCE_MS);
    return;
  }
  return realSet.call(this, key, value);
};

// 页面卸载前最后一次落盘，必须是同步的 —— 异步 IPC 在这时候根本发不出去
window.addEventListener('pagehide', flushSync);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSync(); });

/* 导出的调试口。QA 用它确认劫持确实装上了，而不是静默退回 localStorage。 */
window.__tvSaveBridge = {
  installed: true,
  get hasData() { return mem !== null; },
  get bytes() { return mem ? mem.length : 0; },
  get pending() { return dirty; },
  origin: boot ? boot.source : 'none',
  migrated: !!(boot && boot.migrated),
  flush: () => { flushSync(); return true; },
};

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
 * ------------------------------------------------------------------ */
let panelWatched = false;

function watchPanel() {
  const mgmt = document.getElementById('management');
  if (!mgmt || panelWatched) return;
  panelWatched = true;

  let last = mgmt.hidden;
  new MutationObserver(() => {
    if (mgmt.hidden === last) return;
    last = mgmt.hidden;
    try { ipcRenderer.send('tv:panel', { open: !mgmt.hidden }); } catch { /* 桥断了就算了 */ }
  }).observe(mgmt, { attributes: true, attributeFilter: ['hidden'] });
}

// game.js 是同步脚本，DOMContentLoaded 时 #management 一定已经在文档里了
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchPanel);
else watchPanel();
