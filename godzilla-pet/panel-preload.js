/* 巨兽都市桌宠 · 观测面板窗口的接管层（contextBridge 版）
 *
 * 面板是**另一个 tv 实例**，和电视窗口跑同一份 game.js。它的存档是**只读**的：
 * 面板只拿启动那一刻的文件快照，之后靠主进程推来的 payload 重建，
 * 自己一个字节都不落盘（两个实例都能写的话，谁后写谁赢，磁盘上看不出异常）。
 *
 * 与 tv-preload.js 同源的两件事，这里各有一份：
 *   - storage 给画面的 SAVEIO 用，但 setItem 对存档键是**丢弃**，不是写入；
 *   - register 收画面交出来的成长钩子，外壳拿它去 sync / open / playRoll。
 *
 * 为什么不能再改 Storage.prototype：与 tv-preload.js 同一段理由 —— 隔离打开后
 * 改的是隔离世界那一份，碰不到页面。见那个文件顶部的说明。
 */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const KEY = 'gnn-kaiju-idle-v3';
const boot = ipcRenderer.sendSync('panel:boot');
let mem = boot?.payload || null;
let selected = boot?.key || 'assign';

/* 画面上报的面板模式标记。画面靠它决定走"全屏观测面板"那一套初始化
 * （tv/game.js 顶部读 window.__panelMode）。原语也能经桥暴露。 */
contextBridge.exposeInMainWorld('__panelMode', true);

/* 画面交出来的成长钩子。见 tv/game.js 末尾的 register。 */
let growth = null;

/* ------------------------------------------------------------------ *
 * 存档桥（只读）
 *
 * 存档键只返回启动快照 mem；写进来一律丢弃。
 * 非存档键原样转给真正的 localStorage —— 与旧实现"只盯一个键"的口径一致。
 * ------------------------------------------------------------------ */
contextBridge.exposeInMainWorld('__tvBridge', {
  storage: {
    getItem: (key) => (key === KEY ? mem : window.localStorage.getItem(key)),
    setItem: (key, value) => {
      if (key !== KEY) window.localStorage.setItem(key, value);
      // 存档键：面板没有落盘通道，丢弃。
    },
  },
  register: (api) => { growth = api; },
  flush: () => true,   // 面板不落盘，接口形状与电视侧保持一致
  info: () => ({ installed: true, readOnly: true, hasData: mem !== null, key: selected }),
});

// 入口、Tab、closePanel、evoSpeed 都是本地导航，不转发。
const FORWARD = /^(assign|talent|buy|up|skill|roll|auto|policy|sound)[-\w]*$/;
function forward(payload) {
  if (payload.id.startsWith('open-') || payload.id.endsWith('Tab') || ['closePanel', 'evoSpeed'].includes(payload.id) || !FORWARD.test(payload.id)) return;
  ipcRenderer.send('panel:tap', payload);
}
contextBridge.exposeInMainWorld('__panelHost', {
  command: forward,
  close: () => ipcRenderer.send('panel:done'),
});

function ready() {
  document.documentElement.classList.add('panel-view');
  growth.sync(mem);
  growth.open(selected);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
else ready();
ipcRenderer.on('panel:select', (_e, key) => {
  selected = key;
  growth?.open(key);
});
ipcRenderer.on('panel:rolled', (_e, result) => growth?.playRoll(result));
ipcRenderer.on('panel:sync', (_e, payload) => {
  mem = payload;
  growth?.sync(payload);
});
