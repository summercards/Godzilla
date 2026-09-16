/* 开发期截图工具：在真实的 Electron 运行时里渲染桌宠并抓图。
 *
 * 为什么不用无头浏览器：桌宠跑在 file:// 协议 + preload 桥接的环境里，
 * 浏览器预览覆盖不到这两条路径。这个脚本连窗口透明、部件加载、存档恢复一起验。
 *
 * 用法：
 *   node_modules/.bin/electron build/qa-shot.cjs --level=25 --out=/tmp/a.png
 * 可选：
 *   --w=256 --h=256     窗口尺寸
 *   --wait=3000         抓图前等待毫秒数
 *   --bg                铺一层模拟桌面背景，便于判断构图（默认抓透明通道）
 *   --paused            让宠物静止，便于横向比对不同等级的身高
 *
 * 注意：本机环境若存在 ELECTRON_RUN_AS_NODE=1，Electron 会退化成纯 Node，
 * 必须用 env -u ELECTRON_RUN_AS_NODE 启动；沙箱环境还需要 --no-sandbox。
 */
'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const flag = (name) => argv.includes(`--${name}`);

const LEVEL = Math.max(1, Number(arg('level', 1)) || 1);
const WIDTH = Number(arg('w', 320)) || 320;
const HEIGHT = Number(arg('h', 256)) || 256;
const WAIT = Number(arg('wait', 3000)) || 3000;
const OUT = arg('out', '/tmp/pet-shot.png');
const USE_BG = flag('bg');
const PAUSED = flag('paused');

const ROOT = path.join(__dirname, '..');

// 主进程里的这些通道在 QA 里没有对应实现，静默接住避免报错刷屏
['pet:setIgnoreMouse', 'pet:drag', 'pet:dragEnd', 'pet:menu'].forEach((ch) => ipcMain.on(ch, () => {}));
ipcMain.handle('pet:flags', () => ({
  alwaysOnTop: true, clickThrough: false, hidden: false, size: 'medium', sizes: {},
}));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    transparent: !USE_BG,
    backgroundColor: USE_BG ? '#1d2433' : '#00000000',
    webPreferences: {
      preload: path.join(ROOT, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  const errors = [];
  win.webContents.on('console-message', (event) => {
    // Electron 44 起改用事件对象，这里兼容两种签名
    const text = typeof event === 'object' && event.message ? event.message : String(event);
    if (!/Security Warning/.test(text)) errors.push(text);
  });
  win.webContents.on('preload-error', (_e, file, err) => errors.push(`preload ${file}: ${err}`));

  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));

  /* 把指定等级的存档塞进去，再重载让它按真实启动路径生效。
   *
   * 直接写 localStorage 后 reload 是无效的：页面卸载时 pagehide 上的保存
   * 会拿着当前（1 级）的状态把注入的值覆盖掉。所以写入用原始的 setItem，
   * 写完立刻把 setItem 换成空函数，让这次卸载回写落不下去。
   * 原型上的改写只影响当前文档，重载后的新文档不受影响。 */
  const save = {
    version: 1, level: LEVEL, xp: 0, wrecks: LEVEL * 3, pets: 0, seconds: LEVEL * 240,
    muted: true, paused: PAUSED, clickThrough: false,
    lastSeen: Date.now(), seenStages: ['hatchling', 'juvenile', 'adolescent', 'mature', 'apex'],
  };
  await win.webContents.executeJavaScript(`
    (() => {
      const orig = Storage.prototype.setItem;
      orig.call(localStorage, 'gnn-pet-v1', ${JSON.stringify(JSON.stringify(save))});
      Storage.prototype.setItem = function () {};
    })();
  `);
  await win.webContents.reload();
  await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));

  if (USE_BG) {
    // 模拟桌面：一块带渐变的深色底，用来看透明区域的构图
    await win.webContents.executeJavaScript(`
      document.body.classList.add('preview');
      document.body.style.background = 'linear-gradient(160deg,#2b3550,#161c2b 60%,#0e131e)';
    `);
  }

  await wait(WAIT);

  /* --action=beam --seek=1.6：定格某一动作的某一帧，用于逐个核对动画。
   * 不指定动作时抓的是宠物自然状态下的一帧。 */
  const action = arg('action', '');
  if (action) {
    const seek = Number(arg('seek', 0)) || 0;
    const ok = await win.webContents.executeJavaScript(`
      (() => {
        const d = window.__petDebug;
        if (!d) return 'no-debug-api';
        d.freeze(true);
        if (!d.force(${JSON.stringify(action)}, Number(${JSON.stringify(arg('slot', ''))}) || undefined)) return 'no-target';
        d.seek(${seek});
        return 'ok';
      })();
    `);
    console.log('FORCE', action, seek, ok);
    await wait(220);
  }

  const dataset = await win.webContents.executeJavaScript(
    'JSON.stringify({...document.getElementById("stage").dataset})',
  );
  const img = await win.webContents.capturePage();
  fs.writeFileSync(OUT, img.toPNG());

  console.log('STATE', dataset);
  console.log('CONSOLE_ERRORS', errors.length ? JSON.stringify(errors.slice(0, 6)) : 'none');
  console.log('SAVED', OUT, img.getSize().width + 'x' + img.getSize().height);

  app.exit(0);
});
