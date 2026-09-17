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
const { VIEWPORT, TV_SIZES, TV_DRAG_CSS, PANEL_ONLY_CSS, PANEL_READABLE_CSS, zoomFor } = require('../tv-config.js');

test('副屏定位：优先右侧、左侧回退、上下回退且始终在工作区', () => {
  const { panelBounds } = require('../tv-config.js');
  const area = { x: 0, y: 0, width: 1440, height: 900 };
  const size = { width: 520, height: 496 };
  assert.equal(panelBounds({ x: 100, y: 100, width: 520, height: 342 }, size, area).x, 630);
  assert.equal(panelBounds({ x: 880, y: 530, width: 520, height: 342 }, size, area).x, 350);
  const vertical = panelBounds({ x: 0, y: 0, width: 600, height: 294 }, size, { x: 0, y: 0, width: 800, height: 900 });
  assert.equal(vertical.y, 304);
  for (const a of [area, { x: -1280, y: 80, width: 1280, height: 700 }, { x: 0, y: 0, width: 420, height: 300 }]) {
    const b = panelBounds({ x: a.x, y: a.y, width: 520, height: 342 }, size, a);
    assert.ok(b.x >= a.x && b.y >= a.y);
    assert.ok(b.x + b.width <= a.x + a.width && b.y + b.height <= a.y + a.height);
  }
});

/* ------------------------------------------------------------------ *
 * 面板尺寸与电视档位解耦（Step 4）
 *
 * 解耦之前面板尺寸是从电视档位推出来的（电视宽 × 电视高 × 1.45），
 * 于是 small 档的面板只有 448×426 —— 4 列 20px 的资源数字塞进去必然挤成一团。
 * 这组断言钉住三件事：
 *   1. 面板三档独立存在，且每一档都宽到放得下 4 列资源条；
 *   2. 面板尺寸**不再**从电视档位推导（那条推导路径必须彻底消失）；
 *   3. 档位名进了持久化状态，未知档位回落而不是把窗口开成 0×0。
 *
 * 变异测试：把 main.js 里的 `curPanelSize()` 换回 `curSize()`，或把 placePanel 的
 * `panelBox(state.panelSize)` 换回面板窗口当前的 bounds，这条断言必须变红。
 * ------------------------------------------------------------------ */
test('面板尺寸：三档独立于电视档位，且不再从电视推导', () => {
  const { PANEL_SIZES, panelBox } = require('../tv-config.js');
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

  assert.deepEqual(Object.keys(PANEL_SIZES), ['compact', 'standard', 'tall'], '面板档位必须是三档，且顺序稳定');

  const seen = new Set();
  for (const [key, s] of Object.entries(PANEL_SIZES)) {
    assert.ok(s.label, `面板 ${key} 档缺 label，托盘菜单会显示 undefined`);
    // 560 是"4 列资源条不换行"的实测下限；448 是解耦前 small 档面板的宽度
    assert.ok(s.w >= 560, `面板 ${key} 档只有 ${s.w} 宽，4 列资源条会换行（解耦前 small 档是 448）`);
    assert.ok(s.h >= 640, `面板 ${key} 档只有 ${s.h} 高，扣掉固定开销后内容区只剩一条缝`);
    const sig = s.w + '×' + s.h;
    assert.ok(!seen.has(sig), `面板档位 ${sig} 重复，菜单里点了看不出变化`);
    seen.add(sig);
  }

  // 意图：面板是操作台，出厂设置就不该比电视机小
  assert.ok(
    PANEL_SIZES.standard.w >= TV_SIZES.large.w,
    `默认面板 ${PANEL_SIZES.standard.w} 比最大的电视档位 ${TV_SIZES.large.w} 还窄，解耦没解决"面板太窄"`,
  );

  /* 解耦的判据：在两个**函数体**里取值域，而不是全文找关键字。
   *
   * 全文找关键字会把"记录这次删除"的历史注释一起算进来（那正是要保留的东西），
   * 于是只能放宽到什么都拦不住。反过来锁函数体，写的才是真正要守的东西：
   * 开面板这一步不许再碰电视档位，摆面板这一步不许再拿窗口当前尺寸当输入。 */
  const openBody = main.slice(main.indexOf('function openPanel('), main.indexOf('function closePanel('));
  const placeBody = main.slice(main.indexOf('function placePanel()'), main.indexOf('function openPanel('));
  assert.ok(openBody.length > 200 && placeBody.length > 100, '在 main.js 里定位不到 openPanel/placePanel，函数可能改名了');

  assert.ok(!openBody.includes('curSize()'), '面板窗口的尺寸还在从电视档位（curSize）取');
  assert.ok(!openBody.includes('PANEL_H_SCALE'), '面板尺寸仍在按电视档位乘系数推导');
  assert.match(openBody, /const ps = curPanelSize\(\)/, '面板窗口没有取自己的档位');
  assert.match(openBody, /width:\s*ps\.w/, '面板窗口宽度没接档位');
  assert.match(openBody, /height:\s*ps\.h/, '面板窗口高度没接档位');
  assert.match(placeBody, /panelBox\(state\.panelSize\)/, 'placePanel 没按档位算尺寸（改档位会拿旧尺寸定位，差一个面板宽）');
  assert.ok(!placeBody.includes('panelWin.getBounds()'), 'placePanel 又拿面板窗口当前尺寸当输入了，改档位会算错位置');

  // 档位名必须进持久化状态，且托盘里有入口
  assert.match(main, /panelSize: pickPanelSize\(raw\.panelSize\)/, '面板档位没有进持久化状态');
  assert.match(main, /label: '面板大小'/, '托盘菜单里没有面板档位入口');

  // 档位 → 窗口尺寸的换算；未知档位必须回落，不能给 undefined 把窗口开成 0×0
  assert.deepEqual(panelBox('compact'), { width: PANEL_SIZES.compact.w, height: PANEL_SIZES.compact.h });
  assert.deepEqual(panelBox('__nope__'), panelBox('standard'), '未知档位必须回落到 standard');
});

/* 上面那条测的是"main.js 怎么调用"，这条测"算术本身对不对"。
 *
 * 把电视三档 × 面板三档全跑一遍：同一个面板档位在三种电视下必须量出同一个尺寸。
 * 它**不读 main.js**（纯函数调用），所以两条是互补的：那条管调用方，这条管
 * panelBounds / panelBox 自己 —— 将来谁把 panelBox 改成也要吃电视档位、
 * 或把 panelBounds 的尺寸改用 main.width 算，九格里就会出现不一致的值。
 * 反过来说，位置**应当**随电视变（电视挪了、面板跟着挪），所以位置必须不止一种。 */
test('面板尺寸：九种组合下档位是唯一真相，位置则应当随电视变', () => {
  const { PANEL_SIZES, panelBox, panelBounds, TV_SIZES } = require('../tv-config.js');
  const area = { x: 0, y: 0, width: 2560, height: 1440 };
  const sizes = {};
  const positions = {};
  for (const tv of Object.values(TV_SIZES)) {
    for (const pk of Object.keys(PANEL_SIZES)) {
      const b = panelBounds({ x: 100, y: 100, width: tv.w, height: tv.h }, panelBox(pk), area);
      (sizes[pk] ||= new Set()).add(b.width + '×' + b.height);
      (positions[pk] ||= new Set()).add(b.x + ',' + b.y);
    }
  }
  for (const pk of Object.keys(PANEL_SIZES)) {
    assert.equal(sizes[pk].size, 1, `面板 ${pk} 档在电视三档下量出了 ${[...sizes[pk]]} —— 尺寸仍在跟电视档位走`);
    assert.ok(positions[pk].size > 1, `面板 ${pk} 档在电视三档下位置完全没变，面板没跟着电视摆位`);
  }
});

test('主屏契约：捕获入口、永不显示 management、没有 dock 自动创建', () => {
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
  const hook = fs.readFileSync(path.join(ROOT, 'tv-preload.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'tv/style.css'), 'utf8');
  assert.ok(!main.includes('createDock('));
  assert.ok(!main.includes("'dock:toggle'"));
  assert.match(hook, /stopImmediatePropagation/);
  assert.match(hook, /tv:openPanel/);
  assert.match(css, /html:not\(\.panel-view\) #management\{display:none!important\}/);
  assert.match(readGame(), /if\(panelMode\)return/);
  assert.ok(!readGame().includes('P.IdleProgression.sanitize'));
});

/* ------------------------------------------------------------------ *
 * 退出入口：右键菜单（Step 5）
 *
 * frameless 窗口既没有标题栏也没有关闭按钮，`skipTaskbar` + 隐藏 Dock 又把
 * 任务栏那条路也堵了 —— "我怎么退出"只能由右键菜单回答。这里钉住五件事：
 *
 *   1. 电视窗与面板窗**都**装了右键菜单。玩家在面板里待的时间长得多，
 *      只给电视装等于"退出"在最常用的那个窗口里反而找不到；
 *   2. 两个窗口走同一个 popupControlMenu，不是各建一份菜单（各写一遍
 *      迟早有一套忘了同步）；
 *   3. 退出走 `app.quit()` —— 只有它会走完 `before-quit` 的存档兜底补写；
 *      `window.close()` / `process.exit()` 都会绕过兜底，最坏情况丢最后一次进度；
 *   4. 托盘里能重新叫回面板（电视被收起时，托盘是唯一入口）；
 *   5. 面板窗**没有** `skipTaskbar` —— 它是 Windows 上唯一正确的找回入口，不许"顺手"加上。
 *
 * 变异测试：把面板那条 context-menu 摘掉、或把退出改成 `role:'quit'`/`window.close()`，
 * 这条断言必须变红。
 * ------------------------------------------------------------------ */
test('退出入口：两个窗口都有右键菜单，且退出走 app.quit()', () => {
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

  // 1 + 2：两个窗口都必须装，且都走同一个构建函数
  // 刻意**不做数量断言**（`length === 2`）—— 那样摘掉任一条都只会撞在计数上，
  // 报出来的是"装了 1 个"而不是"哪个窗口漏了"，变异测试时定位不到凶手。
  const wired = main.match(/webContents\.on\('context-menu', \(\) => popupControlMenu\((\w+)\)\)/g) || [];
  assert.ok(wired.some((s) => s.includes('(w)')), '电视窗口没有右键菜单（或没走 popupControlMenu）');
  assert.ok(wired.some((s) => s.includes('(panelWin)')), '面板窗口没有右键菜单 —— 退出在最常用的那个窗口里找不到');
  assert.ok(
    !/webContents\.on\('context-menu'[\s\S]{0,160}Menu\.buildFromTemplate/.test(main),
    '有窗口绕开 popupControlMenu 自己建了一份菜单，两个窗口迟早不同步',
  );

  // 3：退出必须走 app.quit()
  assert.match(main, /label: '退出', click: \(\) => app\.quit\(\)/, '退出没有走 app.quit()，存档兜底不会触发');
  assert.ok(
    !/label: '退出'[^\n]*(window\.close|process\.exit)/.test(main),
    '退出用了 window.close/process.exit，会绕过 before-quit 的兜底落盘',
  );

  // 4：托盘能把面板叫回来
  assert.match(main, /label: '打开观测面板'/, '托盘菜单里没有打开面板的入口');

  // 5：面板窗不许有 skipTaskbar
  const panelArgs = main.slice(main.indexOf('panelWin = new BrowserWindow('), main.indexOf('panelWin.loadFile('));
  assert.ok(panelArgs.length > 200, '在 main.js 里定位不到面板窗口的创建参数，函数可能改名了');
  assert.ok(!panelArgs.includes('skipTaskbar'), '面板窗被加了 skipTaskbar —— 它是 Windows 上唯一正确的找回入口');
});

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

/* 拖动 CSS 是唯一进电视窗口呈现层的注入，它一个字都不许带视觉属性 ——
 * 这条不变式不因为别的注入被删就失效。 */
test('注入：拖动 CSS 只许动 app-region，不许带任何视觉属性', () => {
  const drag = TV_DRAG_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(
    !/color|font|margin|padding|background|border|width|height|opacity|transform|display/.test(drag),
    '拖动 CSS 里出现了视觉属性，"不改原版画面"这条被破了',
  );
});

/* 曾经有一条 TV_HIDE_DOCK_CSS，用来藏掉画面右上角那排小按钮。
 *
 * 它注入的选择器是 .pixel-dock，而该类名在 tv/ 里早已不存在（版面换成了
 * .tv-sidebar / .tv-menu）—— 匹配不到任何元素，是一条空操作。
 * 2026-09-17 删除。实测证据：删前删后各跑一次真实应用，全页 448 个元素的
 * computed display 指纹逐字节一致（差异只有游戏自己生成的新闻条目条数）。
 *
 * 这条钉住删除。将来想在 tv-config.js 里重新加一条"藏某个元素"的注入，
 * 会先在这里被问一句：那个选择器匹配得到东西吗？ */
test('注入：不许再出现匹配不到元素的选择器', () => {
  const cfg = fs.readFileSync(path.join(ROOT, 'tv-config.js'), 'utf8');
  const cfgMod = require('../tv-config.js');
  /* 断言的是"没有重新声明它"，而不是"全文不许出现这个词" ——
   * 文件头那段历史说明里必须留着这个名字，否则下一个人不知道为什么
   * 不能把它加回来。 */
  assert.ok(!/const\s+TV_HIDE_DOCK_CSS\s*=/.test(cfg), 'TV_HIDE_DOCK_CSS 已删除，不该再被声明');
  assert.ok(!('TV_HIDE_DOCK_CSS' in cfgMod), '导出的常量里又出现了 TV_HIDE_DOCK_CSS');
  assert.ok(
    !/\.pixel-dock\s*\{/.test(cfg),
    '.pixel-dock 这个类名在 tv/ 里不存在，把它写成 CSS 规则就是一条空操作',
  );
});

/* 画面里曾有一个「全屏直播」按钮（#settingsPanel 里的 #fullscreen），
 * 2026-09-17 删除。它在桌宠形态下两头都不成立：
 *
 *   1. 它不可达 —— #settingsPanel 没有任何入口（电视侧栏只有加点/天赋/变异，
 *      面板的 .tabs 也只有三个页签），按钮的 getClientRects() 在两个窗口
 *      里都是 0；
 *   2. 一旦可达就会坏版面 —— 实测强行 click() 之后窗口尺寸纹丝不动
 *      （仍是 520×342），但 document.fullscreenElement 被设成了 #playerFrame，
 *      于是 tv/style.css 的 #playerFrame:fullscreen 规则生效：布局按 1120×736
 *      排、窗口只有 520×342，画面被裁掉一大块。源码里那句
 *      "可使用浏览器全屏观看" 从未出现（requestFullscreen 并没有 reject）。
 *
 * 顺带钉住主进程那两块挡板：它们是"画面别想全屏"真正生效的前提。 */
test('画面：不许再出现全屏入口', () => {
  const html = fs.readFileSync(path.join(ROOT, 'tv', 'index.html'), 'utf8');
  const game = fs.readFileSync(path.join(ROOT, 'tv', 'game.js'), 'utf8');
  const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

  assert.ok(!/id="fullscreen"/.test(html), 'tv/index.html 里又出现了 #fullscreen 按钮');
  assert.ok(!/requestFullscreen/.test(game), 'tv/game.js 里又出现了 requestFullscreen');

  const guards = (main.match(/fullscreenable:\s*false/g) || []).length;
  assert.equal(guards, 2, `电视窗与面板窗都必须 fullscreenable:false，现在只有 ${guards} 个`);
});

/* ------------------------------------------------------------------ *
 * 存档桥：tv-preload.js 的契约
 *
 * 桥从外面把画面的存档键接到文件上，而画面只认自己代码里的 SAVE 常量、
 * 以及 __tvBridge.storage 这个接口名。两边一旦对不上，桥会**静默失效** ——
 * 画面照常跑、照常显示"已保存"，只是写回了 localStorage，导出和备份全部
 * 落空，谁都不会报错。这组断言就是为了让这种失联在测试里当场暴露。
 * ------------------------------------------------------------------ */
const readGame = () => fs.readFileSync(path.join(ROOT, 'tv', 'game.js'), 'utf8');
const readHook = () => fs.readFileSync(path.join(ROOT, 'tv-preload.js'), 'utf8');
const readPanel = () => fs.readFileSync(path.join(ROOT, 'panel-preload.js'), 'utf8');
const readMain = () => fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

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
 * 这些都是"面板本来就不是原版画面"的范围内的事，不能泄漏到电视窗口的
 * 呈现里去（电视那条注入只剩拖动 CSS，它一个字都不许带视觉属性）。 */
test('面板窗口：只留观测面板，直播包装必须藏掉，且不混入电视注入', () => {
  for (const sel of ['header', 'footer', '.ticker', '.camera-top', '#offline', '#notice', '#stage']) {
    assert.ok(PANEL_ONLY_CSS.includes(sel), `面板注入没有处理 ${sel}`);
  }
  assert.match(PANEL_ONLY_CSS, /#stage\s*\{[^}]*aspect-ratio:\s*auto/, '面板里的画面应当解除 16:9，让菜单铺满窗口');
  assert.match(PANEL_ONLY_CSS, /\.obs-title\s*\{[^}]*app-region:\s*drag/, '面板需要自己的拖动把手（页眉页脚都藏掉了）');

  assert.ok(!PANEL_ONLY_CSS.includes('pixel-dock'), '面板注入不该染指 pixel-dock（该类名在 tv/ 里已不存在）');
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
  // 放大规则不许混进"只留菜单"那条，也不许染指 pixel-dock
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

/* ------------------------------------------------------------------ *
 * 存档桥的核心风险：同步语义（Step 6）
 *
 * 桥的两个时刻在整个方案里是**同步依赖**，一旦被异步化就会静默出错：
 *   1. 启动读档 —— 画面必须同步拿到档再建世界。异步的话它会先拿 null
 *      建一份新档、再被迟到的文件覆盖，表现为"进度被重置或回退"；
 *   2. 退出落盘 —— pagehide 之后异步 IPC 根本发不出去，最后一段进度丢失。
 * 这两条是本步唯一的真风险，各自必须有回归。断言一律锚在**取值语句的形状**上，
 * 不扫关键字 —— 文件里有解释"为什么不能异步"的注释，扫关键字会把它们当成违规。
 * ------------------------------------------------------------------ */
test('存档桥：启动必须同步读档，否则画面会初始化两次', () => {
  const hook = readHook(), game = readGame();
  // 握手：档必须在这一句里被取回内存。改成 send（异步）的话，
  // 下面画面同步读到的就是 null —— 先建新档，再被迟到的文件覆盖。
  assert.match(hook, /ipcRenderer\.sendSync\('tv:saveBoot', legacy \|\| null\)/,
    '启动握手不再是 sendSync，画面读档时拿不到文件里的档');
  // 取数口必须直接给值：内存命中就返回内存，否则原样转发。
  // 变成 Promise / 每次 sendSync 都会打破同步前提。
  assert.match(hook, /getItem:\s*\(key\)\s*=>\s*\(key === KEY \? mem : window\.localStorage\.getItem\(key\)\)/,
    '桥的 storage.getItem 不再是"直接返回一个值"的形状');
  // 画面取口：优先桥、兜底 localStorage（浏览器/截图工具没有 preload）
  assert.match(game, /const SAVEIO=\(window\.__tvBridge&&window\.__tvBridge\.storage\)\|\|localStorage;/,
    '画面没有从 __tvBridge.storage 取存档口，或丢了 localStorage 兜底');
  // 读档语句必须仍是"取出→立刻解析"的单条同步 try/catch。
  // 把它包进 setTimeout / then / 变成 await，这条会立刻变红。
  assert.match(game, /let storageOK=true,raw=null;try\{raw=JSON\.parse\(SAVEIO\.getItem\(SAVE\)\|\|'null'\);\}catch\{storageOK=false;\}/,
    '启动读档不再是单条同步语句 —— 异步读会让画面先拿空档建世界');
});

test('存档桥：退出路径必须同步落盘，异步 IPC 在页面卸载时发不出去', () => {
  const hook = readHook(), game = readGame();
  // 画面侧：pagehide 里先 save() 再让桥同步落盘，两件事缺一不可 ——
  // save() 把进度写进内存并标脏，flush() 才是把它落到磁盘的那一下。
  assert.match(game, /window\.addEventListener\('pagehide',\(\)=>\{save\(\);window\.__tvBridge\?\.flush\(\);\}\)/,
    '画面的 pagehide 不再"先 save 再 flush"，退出会丢最后一段进度');
  // 桥侧：flush 必须落到那条同步通道上。注意 flushSync 走的是 push(false)。
  assert.match(hook, /flush:\s*\(\)\s*=>\s*\{\s*flushSync\(\);/,
    '桥的 flush 不再直接调 flushSync');
  assert.match(hook, /const flushSync = \(\) => push\(false\);/,
    'flushSync 不再走同步分支（push(false)）');
  assert.match(hook, /sendSync\('tv:saveWriteSync', mem\)/,
    '落盘改成了异步写，那一刻回调根本来不及跑');
  // pagehide 与可见性变化都要挂这条同步落盘
  assert.match(hook, /addEventListener\('pagehide', flushSync\)/, 'pagehide 没挂同步落盘，退出会丢最后一段进度');
  assert.match(hook, /visibilitychange/, 'visibilitychange 没处理，切走窗口时不落盘');
});

test('存档桥：只换掉画面那一个键，其余读写一律放行', () => {
  const hook = readHook(), panel = readPanel();
  // 旧实现靠 `this === window.localStorage` 区分两个存储；桥只收一个 (key, value)，
  // 因此判据变成"是不是那个键" —— 非目标键必须原样转发给真正的 localStorage。
  assert.match(hook, /if \(key !== KEY\) return window\.localStorage\.setItem\(key, value\);/,
    '非目标键没有原样转发给原生 setItem，会误伤其他存储');
  assert.match(hook, /getItem:\s*\(key\)\s*=>\s*\(key === KEY \? mem : window\.localStorage\.getItem\(key\)\)/,
    '非目标键的读没有原样转发给原生 getItem');
  // 面板侧同源：非目标键照转，而**存档键一律丢弃**（面板没有落盘通道）。
  // 这条不许写成全文找关键字 —— 判据必须锚在 setItem 自己的函数体里，
  // 否则前面 getItem 里的 `key === KEY ? mem : ...` 会被跨行吞进来当成证据。
  const body = (src) => {
    const m = src.match(/setItem:\s*\(key, value\)\s*=>\s*\{([\s\S]*?)\n\s*\},/);
    assert.ok(m, '找不到 storage.setItem 的函数体 —— 桥的形状变了');
    return m[1];
  };
  const tvBody = body(hook), panelBody = body(panel);
  assert.match(tvBody, /if \(key !== KEY\) return window\.localStorage\.setItem\(key, value\);/,
    '电视侧的 setItem 没有把非目标键原样转发出去');
  assert.match(panelBody, /if \(key !== KEY\) window\.localStorage\.setItem\(key, value\);/,
    '面板侧的非目标键没有转发');
  const writes = panelBody.match(/localStorage\.setItem\(/g) || [];
  assert.equal(writes.length, 1,
    `面板的 setItem 里有 ${writes.length} 处 localStorage.setItem —— 只该有"非目标键转发"那一次，`
    + '多出来的就是对存档键落盘，两个实例会互相覆盖');
});

/* ------------------------------------------------------------------ *
 * 隔离本身与桥的暴露方式（Step 6 的"还债"部分）
 *
 * 旧做法是关掉隔离、与页面共用同一个 window，然后改它的 Storage.prototype。
 * 现在反过来：隔离开着，接口经 contextBridge 显式暴露。
 * 这组断言钉住"债真的还了"，避免将来有人为了图快把隔离再关回去。
 * ------------------------------------------------------------------ */
test('存档桥：两个窗口都必须开着 contextIsolation，且桥只能经 contextBridge 暴露', () => {
  const main = readMain();
  const flags = main.match(/contextIsolation:\s*(?:true|false)/g) || [];
  assert.equal(flags.length, 2, `contextIsolation 应显式出现两次（电视窗 + 面板窗），现在 ${flags.length} 次`);
  for (const f of flags) assert.match(f, /true$/, `仍有窗口关着 contextIsolation：${f}`);
  assert.ok(!/contextIsolation:\s*false/.test(main), 'main.js 里还残留 contextIsolation:false');

  for (const [name, src] of [['tv-preload.js', readHook()], ['panel-preload.js', readPanel()]]) {
    assert.match(src, /contextBridge\.exposeInMainWorld\('__tvBridge'/,
      `${name} 没有经 contextBridge 暴露 __tvBridge`);
    // 旧劫持的代码形状（赋值给 Storage.prototype / 留着一个 realGet 引用）。
    // 只认赋值与标识符，不认 "Storage.prototype" 这几个字 —— 顶部那段
    // "为什么不再改 Storage.prototype"的注释是要长期保留的。
    assert.ok(!/Storage\.prototype\s*\.\s*(getItem|setItem)\s*=/.test(src),
      `${name} 还在给 Storage.prototype 赋值（隔离打开后那碰不到页面）`);
    assert.ok(!/\brealGet\b|\brealSet\b/.test(src),
      `${name} 还留着旧劫持的 realGet/realSet 引用`);
  }
  assert.match(readHook(), /contextBridge\.exposeInMainWorld\('__tvHost'/,
    'tv-preload 没有经 contextBridge 暴露 __tvHost');
  assert.match(readPanel(), /contextBridge\.exposeInMainWorld\('__panelMode'/,
    'panel-preload 没有经 contextBridge 暴露 __panelMode');
  assert.match(readPanel(), /contextBridge\.exposeInMainWorld\('__panelHost'/,
    'panel-preload 没有经 contextBridge 暴露 __panelHost');

  // 隔离之后外壳看不见页面里的全局对象，钩子必须由画面**主动交回来**。
  // 少了这一步，主进程推来的指令（暂停/强化/ROLL）会全部落空。
  assert.match(readGame(), /try\{window\.__tvBridge\?\.register\(window\.__growth\);\}catch\{\}/,
    '画面没有把 __growth 交给桥，外壳的指令与面板同步会全部落空');
});
