'use strict';
const { ipcRenderer } = require('electron');
const KEY = 'gnn-kaiju-idle-v3';
window.__panelMode = true;
const realGet = Storage.prototype.getItem;
const realSet = Storage.prototype.setItem;
const boot = ipcRenderer.sendSync('panel:boot');
let mem = boot?.payload || null;
let selected = boot?.key || 'assign';
Storage.prototype.getItem = function (key) {
  if (key === KEY && this === window.localStorage) return mem;
  return realGet.call(this, key);
};
Storage.prototype.setItem = function (key, value) {
  if (key === KEY && this === window.localStorage) return;
  return realSet.call(this, key, value);
};
// 入口、Tab、closePanel、evoSpeed 都是本地导航，不转发。
const FORWARD = /^(assign|talent|buy|up|skill|roll|auto|policy|sound)[-\w]*$/;
function forward(payload) {
  if (payload.id.startsWith('open-') || payload.id.endsWith('Tab') || ['closePanel', 'evoSpeed'].includes(payload.id) || !FORWARD.test(payload.id)) return;
  ipcRenderer.send('panel:tap', payload);
}
window.__panelHost = {
  command: forward,
  close: () => ipcRenderer.send('panel:done'),
};
function ready() {
  document.documentElement.classList.add('panel-view');
  window.__growth.sync(mem);
  window.__growth.open(selected);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
else ready();
ipcRenderer.on('panel:select', (_e, key) => {
  selected = key;
  window.__growth?.open(key);
});
ipcRenderer.on('panel:rolled', (_e, result) => window.__growth?.playRoll(result));
ipcRenderer.on('panel:sync', (_e, payload) => {
  mem = payload;
  window.__growth?.sync(payload);
});
