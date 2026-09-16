/* 迷你电视档位的契约测试。
 *
 * 这组数字看起来只是"窗口多大"，其实背后挂着两条会让版面整体走形的硬约束。
 * 改档位时最容易犯的错就是只改宽、忘了跟着算高，所以这里把它们钉死。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { VIEWPORT, TV_SIZES, TV_DRAG_CSS, zoomFor } = require('../tv-config.js');

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
