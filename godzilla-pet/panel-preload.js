/* 面板窗口的 preload
 *
 * 面板是**另一个 tv 实例**，和电视窗口并存 —— 电视那边不动一个像素。
 * 它不缩放（zoom 恒为 1），让游戏自己的窄屏紧凑断点接管版面，
 * 这样菜单里的字才是真实的屏幕像素，而不是被 0.46 压扁的残影。
 *
 * 两个窗口跑的是同一份 game.js，所以这里必须做三件事，少一件都会出乱子：
 *
 * 1. **存档只读。** 两个实例都在跑游戏、都会调 save()。如果都往文件里写，
 *    它们会互相覆盖 —— 谁后写谁赢，另一个还拿着旧数据继续跑。
 *    所以这里把 setItem 吞下来：面板自己照常更新（数字会动，看起来是活的），
 *    但绝不落盘。落盘由电视窗口独占。
 *
 * 2. **操作转发。** 面板里点的每一个「强化 +1」都必须真正作用到游戏上，
 *    也就是作用到电视窗口那个实例。所以点击不在这里执行完就算，
 *    而是把目标元素报给主进程，由主进程在电视窗口里执行同一个元素。
 *
 * 3. **关闭即收窗。** 面板自己有三个出口（× 返回直播、Esc、将来别的），
 *    统一盯 hidden 属性；一旦关掉就把整个面板窗口收走。
 */
'use strict';

const { ipcRenderer } = require('electron');

/* 跟 tv-preload.js 里必须是同一个键。有测试盯着这两个常量一致。 */
const KEY = 'gnn-kaiju-idle-v3';

const realGet = Storage.prototype.getItem;
const realSet = Storage.prototype.setItem;

/* 从文件里取一份存档。取不到就当新档 —— 面板照样开得起来，
 * 只是显示初始状态，总好过打不开。 */
let mem = null;
try {
  const boot = ipcRenderer.sendSync('panel:boot');
  if (boot && typeof boot.payload === 'string') mem = boot.payload;
} catch { mem = null; }

/* 只读的存储层：读照常给，写只落在内存里。
 *
 * 内存那一份是有意义的 —— 面板自己那个 economy 会因此保持一致，
 * 用户点完强化，按钮上的价格当场就变，不用等电视窗口回话。 */
Storage.prototype.getItem = function (key) {
  if (key === KEY && this === window.localStorage) return mem;
  return realGet.call(this, key);
};

Storage.prototype.setItem = function (key, value) {
  if (key === KEY && this === window.localStorage) { mem = String(value); return; }
  return realSet.call(this, key, value);
};

/* 把面板里的操作送回电视窗口。
 *
 * 只转发带 id 的元素 —— 面板里所有能点的东西（四个强化、技能树节点、
 * 复选框、下拉）都带 id，靠 id 定位最稳；用坐标或 DOM 路径都会因为两边
 * 布局的细微差异而错位，而错位在这里的后果是"点了个别的按钮"。
 *
 * 用捕获阶段监听，免得页面自己的处理器先 stopPropagation 把事件吃掉。 */
function forward(el, kind) {
  const id = el && el.id;
  if (!id) return;
  // 面板入口本身不转发：那是"在这个窗口里打开面板"的意思，
  // 转过去会让电视窗口也弹一个面板出来（两个窗口各一个，叠着）。
  if (id.startsWith('open-')) return;

  const payload = { id, kind };
  if (kind === 'change') {
    if (el.type === 'checkbox') payload.checked = el.checked;
    else payload.value = el.value;
  }
  ipcRenderer.send('panel:tap', payload);
}

/* 需要转发给电视窗口执行的操作（权威状态在电视那边）。
 *
 * 这份清单只收「会改游戏状态」的控件，宁可漏、不可多：
 * talentTab / assignTab / skillsTab / evoTab 都带着这些前缀 ——
 * 正则若不把 Tab 结尾的排除掉，面板里切个页就会让电视机弹出自己的
 * 观测面板，直播画面被功能页整个盖住。这不是假想：用户截图里
 * "电视机里开着天赋面板"就是这条正则干的。 */
const FORWARD = /^(assign|talent|buy|up|skill|roll|auto|policy|sound)[-\w]*$/;

document.addEventListener('click', (e) => {
  const el = e.target.closest('button, [role="tab"], input[type="checkbox"]');
  if (!el || !el.id) return;
  // 这些是面板自己的 UI，本地执行：切页只动 aria-selected，关窗只动 hidden，
  // 动画速度只是这块屏自己的显示偏好 —— 转发出去都会长到电视机里去。
  if (el.id.endsWith('Tab') || el.id === 'closePanel' || el.id === 'evoSpeed') return;
  if (!FORWARD.test(el.id)) return;
  // 只转发真正的游戏操作，且停掉本地执行避免双写。
  e.stopImmediatePropagation();
  e.preventDefault();
  forward(el, 'click');
}, true);

/* 复选框与下拉走 change。auto 的本地 toggle 已被上面的 preventDefault 挡掉，
 * 不会走到这里；policy 是下拉，本身不触发 click 转发。 */
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.id === 'auto' || el.id === 'policy') forward(el, 'change');
}, true);

/* 打开面板。默认落到「加点」——那是新成长系统的第一页。
 * 之前默认开的是 open-stats（数值强化），用户点按钮看到的还是老面板，
 * 新系统藏在第 01 个 tab 里根本没人知道。 */
function openOwnPanel() {
  const g = window.__growth;
  if (g && g.open) g.open('assign');
  else { const btn = document.getElementById('open-stats'); if (btn) btn.click(); }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', openOwnPanel);
else openOwnPanel();

/* 面板关掉就收窗。盯属性而不是听某个按钮，是因为出口不止一个。 */
let lastHidden = null;
function watchPanel() {
  const mgmt = document.getElementById('management');
  if (!mgmt) return;
  lastHidden = mgmt.hidden;
  new MutationObserver(() => {
    if (mgmt.hidden === lastHidden) return;
    lastHidden = mgmt.hidden;
    if (mgmt.hidden) ipcRenderer.send('panel:done');
  }).observe(mgmt, { attributes: true, attributeFilter: ['hidden'] });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchPanel);
else watchPanel();

/* ------------------------------------------------------------------ *
 * 主进程 → 面板的两条消息
 *
 * panel:rolled —— 电视窗口算完掷骰结果后回推。面板只是落在那个已知的面上，
 *   动画不参与计算（结果在电视窗口里就已经由 seed + level 算完了）。
 * panel:sync —— 电视窗口每次落盘后推来的 payload。面板用它重建显示，
 *   否则角标永远不亮（面板是只读的，电视在跑、面板不知道）。
 * ------------------------------------------------------------------ */
function bridge() { return window.__growth; }

ipcRenderer.on('panel:rolled', (_e, result) => {
  const g = bridge();
  if (g && g.playRoll) g.playRoll(result);
});

ipcRenderer.on('panel:sync', (_e, payload) => {
  const g = bridge();
  if (g && g.sync) g.sync(payload);
});
