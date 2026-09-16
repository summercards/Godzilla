/* 只暴露必要的窗口操作。渲染层拿不到任何 node 能力。 */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petHost', {
  isDesktop: true,

  // 拖动：由渲染层算出目标坐标，主进程只负责落位
  drag: (x, y) => ipcRenderer.send('pet:drag', { x, y }),
  dragEnd: () => ipcRenderer.send('pet:dragEnd'),

  // 右键菜单由主进程弹出，渲染层只提供当前状态用于勾选与文案
  menu: (state) => ipcRenderer.send('pet:menu', state),
  quit: () => ipcRenderer.send('pet:quit'),
  flags: () => ipcRenderer.invoke('pet:flags'),

  /* 自动穿透的核心开关。
   * 透明窗口默认会吃掉整块矩形上的点击，导致桌面上出现一片看不见的死区。
   * 渲染层每次指针移动时判断光标是否落在实体像素上，据此让主进程在
   * 「接收鼠标」与「穿透到桌面」之间切换。 */
  setIgnoreMouse: (ignore) => ipcRenderer.send('pet:setIgnoreMouse', ignore === true),

  onCommand: (fn) => {
    ipcRenderer.on('pet:command', (_e, payload) => fn(payload));
  },
  onFlags: (fn) => {
    ipcRenderer.on('pet:flags', (_e, payload) => fn(payload));
  },
});
