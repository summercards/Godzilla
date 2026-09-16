/* 迷你电视档位的契约测试。
 *
 * 这组数字看起来只是"窗口多大"，其实背后挂着两条会让版面整体走形的硬约束。
 * 改档位时最容易犯的错就是只改宽、忘了跟着算高，所以这里把它们钉死。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { VIEWPORT, TV_SIZES, TV_DRAG_CSS, TV_HIDE_DOCK_CSS, PANEL_ONLY_CSS, PANEL_READABLE_CSS, zoomFor } = require('../tv-config.js');

/* 原版页面的固定像素尺寸，改原版就得跟着改这里 */
const HEADER_H = 46;
const FOOTER_H = 38;
const SHELL_GUTTER = 32;    // .shell 宽度 = min(100vw - 32px, (100dvh - 100px) * 16/9)

/* 复刻原版的 .shell 宽度公式 */
function shellWidth(vw, vh) {
  return Math.min(vw - SHELL_GUTTER, (vh - 100) * 16 / 9);
}

function contentHeight(vw, vh) {
  return HEADER_H + shellWidth(vw, vh) * 9 / 16 + FOOTER_H;
}

test('视口：宽度必须越过 1050px 断点，否则版面会切成另一套', () => {
  // 原版在 max-width:1050px 和 max-width:680px 各有一套布局：
  // 1050 那套把 .shell 改成 100vw - 16px，680 那套让画面铺满视口并藏掉页脚。
  assert.ok(VIEWPORT.w > 1050, `视口宽 ${VIEWPORT.w} 会撞上原版的窄屏断点，版面不再是原版那一套`);
  assert.ok(VIEWPORT.h > 480, '视口高会撞上原版的短景观断点');
});

test('视口：高度必须装得下页眉 + 画面 + 页脚，否则出现滚动条', () => {
  const need = contentHeight(VIEWPORT.w, VIEWPORT.h);
  assert.ok(
    need <= VIEWPORT.h,
    `内容需要 ${need.toFixed(1)}px 高，视口只有 ${VIEWPORT.h}px，页脚会被挤出去`,
  );
});

test('视口：画面应当由宽度顶着，四周才留得下均匀边框', () => {
  // 若高度约束生效（shell 由 (vh-100)*16/9 决定），.shell 会比视口窄一大截，
  // 左右就会空出很宽的黑边——这正是 1280×720 的问题。
  const byWidth = VIEWPORT.w - SHELL_GUTTER;
  const byHeight = (VIEWPORT.h - 100) * 16 / 9;
  assert.ok(
    byWidth <= byHeight,
    `宽度约束没生效：shell 只有 ${byWidth.toFixed(0)}px 宽而高度允许 ${byHeight.toFixed(0)}px，四周会出现宽黑边`,
  );
});

test('档位：每一档的高度都必须等于 视口高 × 该档的缩放系数', () => {
  // 只改宽度会让视口高度偏离设计值，页面的高度约束一失效，.shell 就会撑满宽度，
  // 整个版面（字号、行距、断点）全部错位。这条是最容易踩的坑。
  for (const [key, s] of Object.entries(TV_SIZES)) {
    const expect = VIEWPORT.h * zoomFor(s.w);
    assert.ok(
      Math.abs(s.h - expect) <= 1,
      `档位 ${key}：高 ${s.h}，按 视口高×系数 应为 ${expect.toFixed(1)}`,
    );
  }
});

test('档位：三档尺寸递增，且宽高比一致', () => {
  const list = Object.values(TV_SIZES);
  for (let i = 1; i < list.length; i++) {
    assert.ok(list[i].w > list[i - 1].w, '档位宽度应当递增');
    assert.ok(list[i].h > list[i - 1].h, '档位高度应当递增');
  }
  const ratios = list.map((s) => s.w / s.h);
  for (const r of ratios) {
    assert.ok(Math.abs(r - ratios[0]) < 0.01, `各档宽高比不一致：${ratios.map((v) => v.toFixed(3)).join(', ')}`);
  }
});

test('档位：缩放系数都小于 1，屏幕上才叫"小窗"', () => {
  for (const [key, s] of Object.entries(TV_SIZES)) {
    const z = zoomFor(s.w);
    assert.ok(z > 0 && z < 1, `档位 ${key} 的系数 ${z} 不在 (0,1) 内`);
  }
  assert.equal(zoomFor(VIEWPORT.w), 1, '按视口宽度反推的系数应当正好是 1');
});

test('注入：外壳可拖、画面可点，两者不能搞反', () => {
  // 先去掉注释再断言，免得说明文字里的词误伤
  const rules = TV_DRAG_CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
  assert.match(rules, /body\s*\{[^}]*app-region:\s*drag/, '四周留白（body）应当可拖动');
  assert.match(rules, /\.shell\s*\{[^}]*app-region:\s*no-drag/, '.shell 必须保持可交互，否则画面里的按钮点不动');
  assert.match(rules, /header[^{]*\{[^}]*app-region:\s*drag/, '页眉应当作为第二拖动区');
  // 只要碰了颜色、字号、间距，就说明"不改原版画面"这条被破了
  assert.ok(
    !/color|font|margin|padding|background|border/.test(rules),
    '注入内容里出现了视觉属性，应当只有 app-region',
  );
});

/* 藏掉画面右上角那排按钮，是整个工程**唯一**改变画面呈现的注入。
 *
 * 它是产品决定而不是修 bug：那排按钮在 1120→520 的缩放里只剩 5.6px，
 * 看不清也点不准，功能搬到了窗口外的像素按钮上。所以这里把它和拖动 CSS
 * 严格分开盯着 —— 拖动那条依然一个字都不许带视觉属性，这条则只许动
 * display。将来有人想往里头顺手塞颜色或字号，会在这里被拦下来。 */
test('注入：藏按钮那条只许动 display，不许变成重画', () => {
  const hide = TV_HIDE_DOCK_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(hide, /\.pixel-dock\s*\{[^}]*display:\s*none/, '应当只藏掉 .pixel-dock');
  assert.ok(
    !/color|font|margin|padding|background|border|width|height|opacity|transform/.test(hide),
    '隐藏规则里出现了 display 以外的属性，那就不再是"藏起来"而是"重画"了',
  );

  // 方向不能搞反：拖动那条里不能悄悄夹带 display
  const drag = TV_DRAG_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/display/.test(drag), '拖动 CSS 里出现了 display，两条注入被混到一起了');
});

test('注入：藏按钮与拖动必须是两条独立常量', () => {
  // 合成一条的话，"不改呈现"那条不变式就永远说不清了
  assert.notEqual(TV_DRAG_CSS, TV_HIDE_DOCK_CSS);
  assert.ok(!TV_DRAG_CSS.includes('pixel-dock'), '拖动 CSS 不该知道 pixel-dock 的存在');
});

/* ------------------------------------------------------------------ *
 * 存档接管：tv-preload.js 的契约
 *
 * 接管层从外面劫持画面的存档键，而画面只认自己代码里的 SAVE 常量。
 * 两边一旦对不上，接管会**静默失效** —— 画面照常跑、照常显示"已保存"，
 * 只是写回了 localStorage，导出和备份全部落空，谁都不会报错。
 * 这组断言就是为了让这种失联在测试里当场暴露。
 * ------------------------------------------------------------------ */
const readGame = () => fs.readFileSync(path.join(ROOT, 'tv', 'game.js'), 'utf8');
const readHook = () => fs.readFileSync(path.join(ROOT, 'tv-preload.js'), 'utf8');
const readPanel = () => fs.readFileSync(path.join(ROOT, 'panel-preload.js'), 'utf8');

/* ------------------------------------------------------------------ *
 * 面板窗口：和电视窗口跑同一份 game.js，是第二个实例
 *
 * 这一组盯的是"两个实例不能互相伤害"。面板里点开的是完整的观测面板，
 * 用户能强化、能解锁技能 —— 这些操作必须真的作用到游戏上，而游戏是
 * 电视窗口那个实例说了算的。
 * ------------------------------------------------------------------ */
test('面板窗口：只读，不许出现任何落盘通道', () => {
  const h = readPanel();
  // 面板和电视跑的是同一份 game.js，两边都会调 save()。
  // 面板一旦也能写盘，两个实例就会互相覆盖 —— 谁后写谁赢，
  // 另一个还拿着旧数据继续跑，而磁盘上看不出任何异常。
  assert.ok(!/tv:saveWrite/.test(h), '面板窗口接上了落盘通道，会和电视窗口互相覆盖存档');
  assert.ok(!/saveWriteSync/.test(h), '面板窗口接上了同步落盘通道，同上');
});

test('面板窗口：盯着同一个键，操作靠转发而不是自己算', () => {
  const h = readPanel();
  const gameKey = readGame().match(/SAVE\s*=\s*'([^']+)'/)[1];

  const hookKey = h.match(/const\s+KEY\s*=\s*'([^']+)'/);
  assert.ok(hookKey, '在 panel-preload.js 里找不到 KEY 常量');
  assert.equal(hookKey[1], gameKey, `面板盯着 ${hookKey[1]}，画面却在写 ${gameKey}`);

  // 权威状态在电视窗口那个实例里，面板只是个遥控器；
  // 少了转发，面板里的强化就变成了"改了个内存数字给人看"。
  assert.match(h, /ipcRenderer\.send\('panel:tap'/, '面板没有把操作转发出去');
  assert.match(h, /ipcRenderer\.send\('panel:done'/, '面板关掉时没有通知主进程收窗');
});

test('面板窗口：转发必须跳过面板入口本身', () => {
  const h = readPanel();
  // open-* 是"在本窗口打开面板"的意思。转过去会让电视窗口也弹一个面板，
  // 变成两个窗口各开一个、叠在一起。
  assert.match(h, /id\.startsWith\('open-'\)/, '转发没有跳过 open-* 入口');
});

/* 转发白名单多收一个字都会出事：talentTab / assignTab / skillsTab / evoTab
 * 全部带着操作前缀（talent、assign、skill、evo），正则若不排除 Tab 结尾，
 * 面板里切个页就会让电视机弹出自己的观测面板 —— 直播画面被功能页整个盖住，
 * 而两条注入（隐藏 css）在电视那边都还生效着，看起来就像"功能窗口跑到
 * 电视机里了"。真实发生过，所以单独钉一条。 */
test('面板窗口：只转发游戏操作，切页与关窗留在面板本地', () => {
  const h = readPanel();

  assert.match(h, /endsWith\('Tab'\)/, '转发没有排除 tab 按钮 —— 面板切页会打开电视机的面板');
  assert.match(h, /'closePanel'/, '转发没有排除关闭按钮');
  assert.match(h, /'evoSpeed'/, '动画速度是面板自己的显示偏好，不该转发');

  // 全屏与离线提示是电视画面的事：转发 fullscreen 会去全屏电视机窗口
  const fwd = h.match(/const FORWARD = ([^;]+);/);
  assert.ok(fwd, '找不到转发白名单 FORWARD');
  assert.ok(!/fullscreen|dismiss/.test(fwd[1]), '白名单里混进了全屏/离线提示');

  // 白名单必须仍然覆盖真正的游戏操作
  for (const p of ['assign', 'talent', 'buy', 'up', 'skill', 'roll']) {
    assert.ok(fwd[1].includes(p), `白名单缺了 ${p} 前缀的操作`);
  }
});

/* 面板注入只在面板窗口生效。它藏掉直播包装、让面板铺满窗口 ——
 * 这些都是"面板本来就不是原版画面"的范围内的事，不能泄漏到电视那条
 * 注入链里去，也不许染指 pixel-dock（那是电视窗口那条注入的专属职责）。 */
test('面板窗口：只留观测面板，直播包装必须藏掉，且不混入电视注入', () => {
  for (const sel of ['header', 'footer', '.ticker', '.camera-top', '#offline', '#notice', '#stage']) {
    assert.ok(PANEL_ONLY_CSS.includes(sel), `面板注入没有处理 ${sel}`);
  }
  assert.match(PANEL_ONLY_CSS, /#stage\s*\{[^}]*aspect-ratio:\s*auto/, '面板里的画面应当解除 16:9，让菜单铺满窗口');
  assert.match(PANEL_ONLY_CSS, /\.obs-title\s*\{[^}]*app-region:\s*drag/, '面板需要自己的拖动把手（页眉页脚都藏掉了）');

  assert.ok(!PANEL_ONLY_CSS.includes('pixel-dock'), '面板注入不该染指 pixel-dock');
  assert.notEqual(PANEL_ONLY_CSS, TV_HIDE_DOCK_CSS, '面板注入与电视注入必须是两条独立常量');
});

/* 用户反馈"按钮还是太小了，字也太小了"：游戏的紧凑断点是为 680px 宽的
 * 浏览器窗口设计的，落到 448px 的面板里，10px 的字在桌面上偏小。
 * 这条钉住"放大层"必须存在且真的比紧凑断点大 —— 改名、删规则都会在这里失败。 */
test('面板窗口：字与按钮必须放大一号，且只作用于面板', () => {
  assert.match(PANEL_READABLE_CSS, /\.tabs button\s*\{[^}]*font-size:\s*1[3-9]px/, 'tab 字号没有放大（紧凑断点是 10px）');
  assert.match(PANEL_READABLE_CSS, /\.pixel-button\s*\{[^}]*font-size:\s*1[3-9]px/, '功能按钮字号没有放大');
  assert.match(PANEL_READABLE_CSS, /\.metric-row strong\s*\{[^}]*font-size:\s*2\dpx/, '资源数值没有放大（紧凑断点是 16px）');
  assert.match(PANEL_READABLE_CSS, /\.upgrade-card h3\s*\{[^}]*font-size:\s*1[4-9]px/, '卡片标题没有放大');
  // 窗口外那个像素按钮也放大了（dock.html 88px），两边都靠整数像素保颗粒感
  const dock = fs.readFileSync(path.join(ROOT, 'dock.html'), 'utf8');
  assert.match(dock, /width:\s*88px/, '控制按钮没有放大（应为 88px）');
  // 放大规则不许混进电视注入，也不许染指 pixel-dock
  assert.ok(!PANEL_READABLE_CSS.includes('pixel-dock'), '放大规则不许染指 pixel-dock');
  assert.notEqual(PANEL_READABLE_CSS, PANEL_ONLY_CSS, '放大与"只留菜单"必须是两条独立常量');
});

test('存档接管：preload 盯着的键必须与画面里的 SAVE 常量一致', () => {
  const gameKey = readGame().match(/SAVE\s*=\s*'([^']+)'/);
  assert.ok(gameKey, '在 tv/game.js 里找不到 SAVE 常量，画面可能改了存档方式');

  const hookKey = readHook().match(/const\s+KEY\s*=\s*'([^']+)'/);
  assert.ok(hookKey, '在 tv-preload.js 里找不到 KEY 常量');

  assert.equal(
    hookKey[1], gameKey[1],
    `接管层盯着 ${hookKey[1]}，画面却在写 ${gameKey[1]} —— 存档会静默落回 localStorage`,
  );
});

test('存档接管：画面必须仍是同步读档，否则启动会初始化两次', () => {
  // preload 用 sendSync 一次性取回档，前提是画面在同步读。
  // 画面若改成异步读，会先拿着空档建世界，再被迟到的文件覆盖。
  assert.match(
    readGame(), /localStorage\.getItem\(SAVE\)/,
    '画面不再用 localStorage.getItem(SAVE) 同步读档，同步握手的前提已经变了',
  );
});

test('存档接管：exit 路径必须是同步落盘，异步 IPC 在页面卸载时发不出去', () => {
  const hook = readHook();
  assert.match(hook, /addEventListener\('pagehide',\s*flushSync\)/, 'pagehide 没挂同步落盘，退出会丢最后一段进度');
  assert.match(hook, /visibilitychange/, 'visibilitychange 没处理，切走窗口时不落盘');
  assert.match(hook, /sendSync\('tv:saveWriteSync'/, '退出路径改成了异步写，那一刻回调根本来不及跑');
});

test('存档接管：只换掉画面那一个键，其余读写一律放行', () => {
  const hook = readHook();
  // 少了 this 判断会把 sessionStorage 的同名键一起接走
  assert.match(hook, /key === KEY && this === window\.localStorage/, '缺少 this 判断，会误伤其他存储');
  assert.match(hook, /realGet\.call\(this, key\)/, '非目标键必须原样转发给原生 getItem');
  assert.match(hook, /realSet\.call\(this, key, value\)/, '非目标键必须原样转发给原生 setItem');
});
