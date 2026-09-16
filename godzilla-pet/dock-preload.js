/* 控制按钮窗口的桥
 *
 * 它只做一件事：被点时告诉主进程"用户想开面板了"。
 * 面板开多大、开在哪、什么时候收，全部由主进程决定 ——
 * 这个窗口对电视窗口的尺寸和位置一无所知，它只是个按钮。
 *
 * 之所以要单独一个窗口，是因为它必须待在电视画面的缩放之外：
 * 电视窗口把 1120px 的视口缩到 520px，画面里任何东西都会被砍掉一半多，
 * 12px 的字落到屏幕上只剩 5.6px。这里的 64px 按钮就是 64px。
 */
'use strict';

const { ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('dock');
  if (!btn) return;
  // button 元素本身已经处理了回车与空格，这里只需要接住鼠标点击
  btn.addEventListener('click', () => ipcRenderer.send('dock:toggle'));
});
