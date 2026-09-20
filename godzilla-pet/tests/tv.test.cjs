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
const { VIEWPORT, TV_SIZES, TV_DRAG_CSS, TV_TRANSPARENT_CSS, PANEL_ONLY_CSS, PANEL_READABLE_CSS, zoomFor } = require('../tv-config.js');

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

test('注入：上/右/下三块可拖、左侧按钮区整块不可拖，可点的控件一个都不许拖', () => {
  // 先去掉注释再断言，免得说明文字里的词误伤
  const rules = TV_DRAG_CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
  /* 拆成规则块逐块读：只对整段做关键词匹配的话，
   * "某块写了 no-drag" 与 "某控件被写进了 drag 块" 分不出来。 */
  const blocks = [...rules.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, sel, body]) => ({
    sel: sel.trim(),
    val: (/-webkit-app-region:\s*([a-z-]+)/.exec(body) || [])[1] || '',
  }));
  const valOf = (sel) => (blocks.find(b => b.sel === sel) || {}).val || '';
  const noDragSels = blocks.filter(b => b.val === 'no-drag').flatMap(b => b.sel.split(',').map(s => s.trim()));
  const dragSels = blocks.filter(b => b.val === 'drag').flatMap(b => b.sel.split(',').map(s => s.trim()));

  /* ⚠️ body 与电视窗口的 .shell 都必须**声明为空**。
   *
   * 2026-09-18 那版是 body{drag} + .shell{drag} + 侧栏 no-drag 挖洞 —— 看起来
   * 天经地义，实测却完全不成立。把真机窗口起起来逐个锚点问系统 WM_NCHITTEST：
   * body 上一旦出现任何声明，整窗判定就退化成"全听 body 的" ——
   *   body{drag}    ⇒ 侧栏元素照样是 HTCAPTION（挖洞无效，按钮点不动）；
   *   body{no-drag} ⇒ 连 #playerFrame 的 drag 也一起失效；
   *   .shell{drag}  ⇒ 作为它兄弟的 .tv-sidebar 同样挡不住。
   * 所以"大祖先 drag + 子级 no-drag 挖洞"这条路走不通，拖动区只能落在
   * **互不包含**的几块上。
   *
   * 这两条钉的就是这个"空"：谁哪天顺手把 body 的 drag 加回来（它看起来最自然），
   * 侧栏会立刻静默失守 —— 现象是"按钮点了没反应"，两端都不报错。 */
  assert.equal(valOf('body'), '', 'body 不许声明 app-region：一写整窗就退化成"全听 body 的"');
  assert.ok(
    !blocks.some(b => b.sel.split(',').map(s => s.trim()).includes('body')),
    'body 又被写进了某条规则的选择器列表里 —— 它会吞掉整个窗口的拖动判定，侧栏失守',
  );
  const shellRules = blocks.filter(b =>
    b.sel.split(',').map(s => s.trim()).some(s => s.endsWith('.shell')));
  assert.ok(
    !shellRules.some(b => b.sel.includes(':not(.panel-view)')),
    '电视窗口的 .shell 不许整块 drag —— 它一 drag，作为兄弟的左侧控制栏就跟着被拖走',
  );

  /* 拖动区必须**恰好**是这三块：上（台标条）、右（大电视）、下（页脚）。
   * 多一块就是把操作区拖进了拖动区；少一块就有玩家抓不到的地方。 */
  const norm = (s) => s.replace(/^html:not\(\.panel-view\)\s*/, '').trim();
  assert.deepEqual(
    [...new Set(dragSels.map(norm))].sort(),
    ['#playerFrame', '.tv-brand', 'footer'],
    '电视窗口的拖动区必须恰好是台标条 / 大电视 / 页脚三块',
  );

  /* 面板窗口必须显式压回不可拖。
   * 这一条是**保底**：`-webkit-app-region` 是继承属性，面板窗口整页就是 .shell，
   * 哪天有人给 .shell 或 body 加回一条 drag（见上面那段实测为什么不许加），
   * 面板会顺着继承沾上，滚动区与滚轮一起被吞掉，而面板里全是纵向滚动的列表。
   * 历史：改动前 `.shell { no-drag }` 是全局规则，面板整页本来就是 no-drag，
   * 所以旧行为要靠这条显式重建。 */
  const panelShell = shellRules.find(b => b.sel.includes('html.panel-view'));
  assert.equal(panelShell && panelShell.val, 'no-drag',
    '面板窗口必须显式 no-drag，否则滚动被拖动区吞掉');

  /* 控件必须逐个挡：祖先一旦是 drag 而又没在控件上声明 no-drag，
   * 命中测试就按"拖窗口"处理，按钮会点不动 —— 且两端都不报错。 */
  for (const t of ['button', 'select', 'input', 'label']) {
    assert.ok(noDragSels.includes(t), '可点控件 ' + t + ' 必须在 no-drag 名单里');
  }
  assert.ok(noDragSels.some(s => s.endsWith('.management-screen')),
    '观测面板要整块保持可交互（内部滚动），且只限电视窗口');
  /* 左侧控制栏必须**整块**声明 no-drag，不许只靠上面那条 button 标签级顶着。
   * 2026-09-19 反馈的现象：只挡 button 时，侧栏的组间距、小标题（span）、
   * 旋钮装饰、按钮四周仍留在拖动区里 —— 按按钮时手偏十几像素就从"点"
   * 变成"拖窗口"，按钮的 :active（下沉 3px）拿不住，
   * 表现为"按下去不暗 / 亮了不弹回来"，而窗口会跟着手走一小段，两端都不报错。 */
  const sidebarRule = blocks.find(b => b.sel.includes('.tv-sidebar'));
  assert.equal(
    sidebarRule && sidebarRule.val, 'no-drag',
    '左侧控制栏必须整块 no-drag，否则拖动区会吞掉按钮点击',
  );
  assert.ok(
    sidebarRule.sel.includes(':not(.panel-view)'),
    '侧栏那条 no-drag 必须只作用于电视窗口：面板窗口里 .tv-sidebar 是隐藏的，不该被它牵连',
  );
  for (const t of ['button', 'select', 'input', 'label']) {
    assert.ok(!dragSels.some(s => s.includes(t)), t + ' 被写进了 drag 块，会点不动');
  }

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

  // 面板自己的本地操作一律不许转发（resetSave 走 invoke，另两个在面板本地执行）
  assert.ok(!loadForward().test('resetSave'), '重置存档是面板自己的通道，不该转发');
});

/* 面板与电视两侧各有一份操作白名单，两边必须**同一集合**：
 * 电视侧 panelCommand() 的 valid 正则决定执行什么，面板侧 panel-preload.js 的
 * FORWARD 决定转发什么。任一侧少一项，那个按钮就是"点了没反应"，两端都不报错。
 *
 * 2026-09-18 的实际事故：nextMap 只加在 game.js 一侧，面板不转发 ——
 * 「进入下一张地图」点了永远没有反馈，推图卡死在第一章，日志里一个字都不留。
 *
 * 所以这里不手写 id 清单（手写清单正是漏掉 nextMap 的原因），而是从 game.js 的
 * 白名单源文里反推它能接受的 id，再逐个拿面板的**真正则**试一遍。
 * 以后往 game.js 加操作、忘了同步面板，这条会红。 */
function loadForward() {
  const m = readPanel().match(/const\s+FORWARD\s*=\s*(\/.*?\/[a-z]*)/);
  assert.ok(m, '在 panel-preload.js 里找不到 FORWARD 正则');
  return eval(m[1]);   // eslint-disable-line no-eval —— 只求拿到那份真正则
}

/* 顶层按 | 切，但括号里的 | 不算：assign-(power|atomic|metabolism|stride)
 * 必须当成一个分支，否则会被切成三条残缺的碎片，断言就永远绿了。 */
function topLevelAlternatives(src) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of src) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === '|' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function gameCommandIds() {
  const src = readGame();
  const m = src.match(/const\s+valid\s*=\s*\/\^\(([\s\S]*?)\)\$\//);
  assert.ok(m, '在 tv/game.js 里找不到 panelCommand 的 valid 白名单');
  const ids = [];
  for (const branch of topLevelAlternatives(m[1])) {
    const group = branch.match(/^([\w-]+)\(([^)]*)\)$/);
    if (group) for (const one of group[2].split('|')) ids.push(group[1] + one);
    else ids.push(branch);
  }
  const P = require('../tv/progression.js');
  for (const n of P.TALENT_NODES) ids.push('talent-' + n.id);
  for (const s of P.SKILLS) ids.push('skill-' + s.id);
  return ids;
}

test('面板窗口：两侧白名单必须同一集合，加在一边等于没加', () => {
  // 仓库里的 js 是 CRLF，正则里必须写成 \r?\n，否则这条断言会"找不到表达式"而误报
  const expr = readGame().match(/const\s+valid\s*=\s*([\s\S]*?);\r?\n/);
  assert.ok(expr, '在 tv/game.js 里找不到 panelCommand 的 valid 表达式');
  const P = require('../tv/progression.js');
  const accepts = (id) => new Function('id', 'P', 'return (' + expr[1] + ')')(id, P);
  const forward = loadForward();

  const ids = gameCommandIds();
  assert.ok(ids.length >= 15, `反推出来的操作只有 ${ids.length} 个，正则大概解析错了`);

  for (const id of ids) {
    // 先自检：反推出来的必须真的是电视侧认的 id，否则下面的断言是空转
    assert.ok(accepts(id), `反推出来的 ${id} 其实不在 game.js 的白名单里，正则解析错了`);
    assert.ok(forward.test(id), `面板不转发 ${id} —— 电视侧认它，面板点了却没有任何反应`);
  }

  // 反向：白名单里的每个前缀都得真有用它的人，否则是只增不减的死条目
  for (const alt of loadForward().source.match(/\(([^)]*)\)/)[1].split('|')) {
    assert.ok(ids.some((id) => id.startsWith(alt)), `转发白名单里的 ${alt} 没有任何对应操作，已失效`);
  }

  /* 自检：这条断言必须有牙。把 2026-09-18 那版（漏掉 nextMap）的白名单拿来跑一遍，
   * 它必须被抓住 —— 抓不住就说明上面那圈 for 是空转，绿了也不代表任何事。 */
  const historical = /^(assign|talent|buy|up|skill|roll|auto|policy|sound)[-\w]*$/;
  assert.ok(ids.some((id) => !historical.test(id)),
    '连漏掉 nextMap 的那版白名单都能全过，这条断言没有牙齿');
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

/* ------------------------------------------------------------------ *
 * 电视窗口四周必须是桌面，不是黑边
 *
 * 用户反馈的现象：小电视周围有一圈深色留白，上下两条明显比左右厚。
 * 成因是**两层**底色叠出来的：
 *
 *   1. 窗口层：main.js 原先 transparent:false + backgroundColor:'#050a15'；
 *   2. 页面层：tv/style.css 给 html/body 各刷了一层 #050a15，
 *      body 还叠了径向渐变。
 *
 * 留白的厚度来自版面：视口 1120×736，.shell 只有 1088×579 且垂直居中，
 * 于是左右各 16px、**上下各 78px**（缩放 0.46 后仍有 36 屏幕像素）——
 * 这正对应用户看到的那两条厚黑边。
 *
 * 少改一层就还是黑边：窗口透明而页面不透明，页面底色照样铺满；
 * 页面透明而窗口不透明，窗口底色照样在。所以下面三条各自钉一层。
 *
 * 变异测试：把 main.js 的 transparent 改回 false，或删掉 createWindow 里
 * 那句 insertCSS(TV_TRANSPARENT_CSS)，或把这句挪进面板窗口，三者任一
 * 都必须让这条断言变红。
 * ------------------------------------------------------------------ */
test('电视窗口：窗口层与页面层都必须透明，否则四周还是黑边', () => {
  const main = readMain();

  // ① 窗口层
  assert.match(main, /transparent:\s*true/, '电视窗口没开透明，四周会是窗口底色（黑边的一半）');
  assert.ok(!/transparent:\s*false/.test(main), '还有窗口写着 transparent:false');
  assert.match(main, /backgroundColor:\s*'#00000000'/,
    '窗口底色不是全透明 —— transparent:true 时窗口创建瞬间会先闪一块黑');

  // ② 页面层：只准抹 html/body 这两层底色，不许碰画面本体
  assert.ok(typeof TV_TRANSPARENT_CSS === 'string' && TV_TRANSPARENT_CSS.length > 0,
    'TV_TRANSPARENT_CSS 没有被导出');
  assert.match(TV_TRANSPARENT_CSS, /html\s*,\s*body\s*\{[^}]*background:\s*transparent\s*!important/,
    '页面那层 #050a15 没被抹掉（shorthand 必须带 !important 才压得过 tv/style.css）');
  const rules = TV_TRANSPARENT_CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\.shell|\.tv-cabinet|#playerFrame|#stage|\.broadcast/.test(rules),
    '透明注入越过 html/body 去动画面本体了 —— 那属于改产品定义，不是改窗口');

  // ③ 注入范围：面板窗口必须仍然不透明
  /* 断言钉的是"哪里调了 insertCSS"，不是"全文有没有出现过这个名字" ——
   * 面板那段注释里正当地提到了它（说明"这里故意没有注入"），
   * 扫关键字会把那句说明当成违规证据。同 TV_HIDE_DOCK_CSS 那条的处理方式。 */
  const injects = main.match(/insertCSS\(\s*TV_TRANSPARENT_CSS\s*\)/g) || [];
  assert.equal(injects.length, 1, `透明注入应当恰好注入一次（电视窗口），现在有 ${injects.length} 次`);

  const start = main.indexOf('panelWin = new BrowserWindow');
  assert.ok(start > 0, '在 main.js 里找不到面板窗口的创建处');
  const panelBlock = main.slice(start, main.indexOf("panelWin.on('closed'", start));
  assert.ok(!/insertCSS\(\s*TV_TRANSPARENT_CSS/.test(panelBlock),
    '透明注入泄漏到面板窗口 —— 面板是一块菜单，透出桌面只会更难看');
  assert.match(panelBlock, /backgroundColor:\s*'#050a15'/,
    '面板窗口的底色被一起改掉了（面板故意不透明）');
  // 电视那条注入不许并进拖动 CSS：拖动 CSS 有"零视觉属性"的单独断言
  assert.ok(!/transparent/.test(TV_DRAG_CSS.replace(/\/\*[\s\S]*?\*\//g, '')),
    'TV_DRAG_CSS 里混进了透明相关规则，两条注入必须独立');
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

/* ==================================================================
 * 2026-09-17 · 直播画面与侧栏的减法
 *
 * 这一组钉的不是"某个功能能不能用"，而是**别把删掉的东西加回来**。
 * 每条都带着它的理由，理由不成立时应当先改这里，而不是悄悄绕过。
 * ================================================================== */

test('画面：常驻 HUD 已移除，且没有任何一处还在写它的元素', () => {
  // 同上：注释剥掉再断言，注释里保留着"原来那排是什么"的说明
  const html = fs.readFileSync(path.join(ROOT, 'tv', 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const game = readGame();

  /* 那排 HUD（核能 / 等级 / 经验 / 天赋点 / 随机变异）压在直播画面上，
   * 挡画面又和观测面板里的数字重复，2026-09-17 按反馈移除。
   * 删元素不删赋值会当场抛在 $() 上，所以两件事必须一起钉。 */
  const dead = ['hudEnergy', 'hudProd', 'hudLevel', 'hudXpFill', 'hudXpText', 'hudTalent', 'hudMutName', 'hudMutation'];
  for (const id of dead) {
    assert.ok(!html.includes(`id="${id}"`), `index.html 里 ${id} 又回来了（那排常驻 HUD 是故意移除的）`);
    // 只认"赋值/取属性"这种代码形状，不全文找词：tv/game.js 里留了
    // "为什么删掉"的说明，那段说明要长期保留，不该被当成违规证据。
    assert.ok(!new RegExp(`\\$\\('${id}'\\)\\.`).test(game),
      `tv/game.js 还在写 $('${id}') —— 元素已经不存在，会在下一次 hud() 里直接抛错`);
  }
  // 顺手钉住那一整排容器也走了，免得留一个空 .hud 在画面上当透明挡板
  assert.ok(!/class="hud[ "]/i.test(html), 'index.html 里又出现了 .hud 容器');

  // 角标**不在**移除之列：加点保留纯手动，未花点数必须在主界面上看得见。
  assert.ok(html.includes('id="assignHudBadge"'), '未花加点数的角标被一起删掉了');
  assert.ok(html.includes('class="hud-badge"'), '角标的样式类被一起删掉了');
});

test('画面：页眉页脚的四段状态文案已移除，但页脚元素必须留着', () => {
  /* 先把 HTML 注释剥掉再断言：注释不渲染，也就不算"画面上的文字"。
   * 这里必须这么做 —— 页脚旁边就留着一段说明"原来写的是什么、为什么去掉"，
   * 那段说明是要长期保留的，不该被当成违规证据（同 TV_HIDE_DOCK_CSS 那条）。 */
  const html = fs.readFileSync(path.join(ROOT, 'tv', 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');

  for (const text of ['自动运行中', '近战优先', 'PIXEL BROADCAST', '巨兽都市 · 像素直播', '自动破坏 · 持续进化']) {
    assert.ok(!html.includes(text), `电视周围的「${text}」又回来了（按反馈只留 GNN 台标）`);
  }
  assert.ok(/<div class="brand-mark"><b>GNN<\/b>/.test(html), 'GNN 台标应当保留');

  /* 页脚现在是空的，但**元素不能删**：它的 38px 高 + 8px 外边距是
   * .shell 宽度公式 calc((100dvh - 100px)*16/9) 里那个 100 的一部分
   * （46 页眉 + 38 + 8 + 8），也是 tv-config.js 的 VIEWPORT 注释与
   * 本文件 FOOTER_H 常量的依据。删掉元素，整只电视机在窗口里会上移
   * 54px、上下各空一条。
   *
   * 变异测试：把 <footer></footer> 整个删掉，这条必须变红。 */
  assert.match(html, /<footer><\/footer>/,
    '页脚元素被删了 —— 它没有文字了，但它的高度是版面公式的输入，不能当空元素清掉');
});

test('侧栏：只剩一个入口，且名字是「遥控器」', () => {
  const html = fs.readFileSync(path.join(ROOT, 'tv', 'index.html'), 'utf8');
  const menu = html.slice(html.indexOf('class="tv-menu"'), html.indexOf('</nav>'));
  assert.ok(menu.length > 100, '在 index.html 里定位不到 .tv-menu，侧栏可能改结构了');

  /* 天赋 / 变异两个按钮打开的就是观测面板里已经存在的两个页签，
   * 一个面板给三条路是重复导航，2026-09-17 按反馈删掉。 */
  assert.ok(!/id="open-talent"/.test(menu), '天赋按钮又回到侧栏了（它与观测面板里的天赋页重复）');
  assert.ok(!/id="open-evo"/.test(menu), '变异按钮又回到侧栏了（同上）');

  // 剩下那个入口改名成「遥控器」（功能本来就是打开怪兽面板）
  assert.match(menu, /id="open-assign"[^>]*aria-label="遥控器"/, '入口的无障碍名还没改成「遥控器」');
  assert.match(menu, />遥控器</, '入口上的可见文字还不是「遥控器」');

  /* 删的是**侧栏入口**，不是页本身：面板里的加点 / 天赋 / 变异三个页签
   * 必须原样保留，否则那两个面板就再也没有到达路径了。 */
  for (const tab of ['id="assignTab"', 'id="talentTab"', 'id="evoTab"']) {
    assert.ok(html.includes(tab), `观测面板里的 ${tab} 被一起删了 —— 这次只该删侧栏入口`);
  }
});

/* 突发新闻的编排（反馈原文：「频率太高了，释放技能的时候不用出现，
 * 一分钟左右出现一次差不多了」）。
 *
 * 行为级回归在 tv/tests/idle.cjs 里真跑（字幕条拉没拉、闸门衰减与重开、
 * 被压下来的那条仍进档案）。这里钉的是源码形状：
 *   - 重踏 / 长啸 / 吐息三条技能播报不许带 priority —— 行为测试只跑得到
 *     吐息那一条路径，重踏与长啸得在这里兜住；
 *   - 闸门必须真的接在 broadcast 上，且必须随时间衰减。 */
test('突发新闻：技能释放不拉字幕条，其余事件至少隔一分钟一条', () => {
  const game = readGame();
  assert.match(game, /const BREAKING_GAP=60;/, '突发新闻的间隔常量不见了，或被改成了别的值');

  // 在各自函数体里取调用形态，不全文找关键字（文件里有解释"技能为什么不
  // 拉突发条"的注释，全文找词会把它误判成违规）。
  const body = (from, to) => {
    const s = game.indexOf(from);
    assert.ok(s > 0, `在 tv/game.js 里定位不到 ${from}`);
    const e = game.indexOf(to, s);
    assert.ok(e > s, `在 tv/game.js 里定位不到 ${to}，${from} 的边界变了`);
    return game.slice(s, e);
  };
  const cases = [
    ['重踏', body('function doStomp()', 'function doRoar()')],
    ['长啸', body('function doRoar()', 'function doTail()')],
    ['吐息', body('function begin(name,target)', 'function targetForBeam()')],
  ];
  for (const [name, src] of cases) {
    assert.match(src, /broadcast\(/, `${name}的播报整个不见了`);
    assert.ok(!/broadcast\([^\n]*?,true\)/.test(src),
      `${name}又把突发新闻条拉起来了 —— 技能几十秒一轮，每次都报等于让那条横幅常驻`);
  }

  assert.match(game, /if\(priority&&breakingCd>0\)priority=false;/,
    'broadcast 没有把间隔内的突发新闻压成普通播报');
  assert.match(game, /breakingCd=BREAKING_GAP;/,
    '拉起字幕条时没有重置间隔，闸门形同虚设');
  assert.match(game, /breakingCd=Math\.max\(0,breakingCd-dt\);/,
    '间隔没有随时间衰减，第一条突发新闻之后再也不会拉横幅');
});

/* 「地面机位 CAM 02」小窗（.inset / #monitor）2026-09-20 按反馈移除。
 *
 * 它是画面右上角的第二块屏幕，信息量却和主画面完全重复（同一个 buffer 的裁切），
 * 白白抢注意力。删元素不删代码会在下一次 $() 里当场抛错，所以这条链上的每一环
 * 都要一起钉：元素（index.html）/ 上下文与绘制（game.js）/ 样式（style.css）/
 * 面板隐藏清单（tv-config.js）/ 两处播报文案。
 *
 * 变异测试：把 index.html 的 .inset 段落贴回来，或把 game.js 的 monitor.getContext
 * 加回去，这条必须变红。 */
test('画面：地面机位小窗（.inset / #monitor）已整条移除', () => {
  // 剥掉注释再断言：index.html / style.css 里都特意留了"原来是什么、为什么删"的说明，
  // 那段说明要长期保留，不该被当成违规证据（同「常驻 HUD 已移除」那条）。
  const html = fs.readFileSync(path.join(ROOT, 'tv', 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const game = readGame();
  const css = fs.readFileSync(path.join(ROOT, 'tv', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  // ① 元素
  assert.ok(!html.includes('id="monitor"'), 'index.html 里又出现了 #monitor 画布');
  assert.ok(!/class="inset"/.test(html), 'index.html 里又出现了 .inset 小窗容器');
  assert.ok(!html.includes('CAM 02'), 'index.html 里又出现了 CAM 02 文案');

  // ② 代码：只认"建上下文 / 取元素"这种形状，不全文找词。
  //    .monster-monitor / .monitor-caption 是观测面板里的全息扫描图，与本小窗无关，
  //    所以这里必须精确到 monitor.getContext 与 $('monitor')，不能只搜 "monitor"。
  assert.ok(!/monitor\.getContext/.test(game), 'game.js 里又给 monitor 建了 2D 上下文');
  assert.ok(!/\$\('monitor'\)/.test(game), "game.js 里又在取 $('monitor') —— 元素已不存在，会当场抛错");
  assert.ok(!/地面机位/.test(game), 'game.js 播报里又出现了「地面机位」（应写成「现场镜头」）');

  // ③ 样式：不许再有生效的 .inset 规则（CSS 的 inset: 属性与 box-shadow:inset 不带点，不会误伤）
  assert.ok(!/\.inset\b/.test(css), 'style.css 里又出现了生效的 .inset 规则');

  // ④ 面板隐藏清单：元素已不存在，留着就是一条匹配不到东西的空操作
  assert.ok(!/\.inset/.test(PANEL_ONLY_CSS), 'PANEL_ONLY_CSS 里还在藏 .inset —— 该类名在 tv/ 里已不存在');
});

/* 两侧机位条（左「LIVE + 地名」/ 右「AIR CAM 07 + 时钟」）必须**顶对齐**。
 *
 * 2026-09-20 主人反馈「这两个 ui 向上对齐」。根因是一条纯 CSS 的相互作用：
 *   左组里 <b>LIVE 徽章</b>带 `padding:2px` 竖向内边距 → 左组比右组高
 *   （实测 38.9 vs 33.1 逻辑像素）→ 而 .camera-top 是 align-items:center，
 *   于是两块**中心**对齐，左块顶边比右块高出 (38.9−33.1)/2 = 2.9 逻辑像素。
 * 实心红块的顶边对着旁边一行纯文字，这点差值一眼就能看出来是"没对齐"。
 *
 * 这条测试钉的是**两条会互相抵消的约束**，缺一条都会回退：
 *   ① 容器顶对齐 → 两块的上边缘落在同一行；只靠它不够：当左块比右块高时，
 *      左块自己就是最高项，中心对齐与顶对齐的结果完全相同（都是左块顶边=容器顶边）。
 *   ② 徽章不许有竖向 padding、line-height 收成 1 → 红块不再把左组撑高，
 *      它的涂色顶边才真的和右边那行文字的墨迹顶边同线
 *      （实测 111.3 vs 111.2 逻辑像素，差 0.1）。
 *
 * 变异测试：把 align-items 改回 center，或给徽章加回 `padding:2px`，这条必须变红。 */
test('版面：两侧机位条顶对齐，LIVE 徽章不许撑高左组', () => {
  const css = fs.readFileSync(path.join(ROOT, 'tv', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const decl = (re) => { const m = css.match(re); return m ? m[1] : null; };

  // ① 容器：顶对齐，不能是 center
  const top = decl(/\.camera-top\{([^}]*)\}/);
  assert.ok(top, '找不到 .camera-top 的基础规则');
  assert.match(top, /align-items:flex-start/, '.camera-top 必须是 align-items:flex-start —— 改回 center 两侧机位条就又变成中心对齐、上边缘不齐了');
  assert.ok(!/align-items:center/.test(top), '.camera-top 里又出现了 align-items:center');

  // ② 徽章：竖向 padding 必须为 0，行高收成 1（= 高度等于字号）
  const badge = decl(/\.camera-top b\{([^}]*)\}/);
  assert.ok(badge, '找不到 .camera-top b 的基础规则');
  const pad = (badge.match(/padding:([^;}]+)/) || [])[1];
  assert.ok(pad, 'LIVE 徽章没写 padding —— 横向内边距是它外观的一部分，删掉请先确认');
  assert.ok(/^0(px)?$/.test(pad.trim().split(/\s+/)[0]),
    `LIVE 徽章又有了竖向 padding（padding:${pad.trim()}）—— 红块会把左组撑高，涂色顶边又跑到右边文字上面去`);
  assert.match(badge, /line-height:1(?:\.0)?(?:;|$)/,
    'LIVE 徽章的 line-height 必须收成 1；默认 22.5px 会让红块比文字行高，顶边对不上右边的文字');
});
