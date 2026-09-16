/* 迷你电视模式：档位参数 + 唯一的注入内容。
 *
 * 抽成独立模块有两个原因：
 *   1. 拖动区域的 CSS 与档位尺寸是"对外契约"，主进程和开发期工具必须用同一份，
 *      复制粘贴迟早会漂移；
 *   2. 截图工具能 require 到真实数值，验证的是应用实际会用的东西。
 *
 * 注入内容分两类，必须分清楚：
 *
 *   TV_DRAG_CSS      不改变任何呈现，只补 frameless 窗口缺的拖动把手。
 *   TV_HIDE_DOCK_CSS **唯一的例外** —— 它确实改了画面的外观（藏掉右上角那排
 *                    小按钮）。原因是那排按钮被 0.46 倍缩放压到只剩 5.6px，
 *                    既看不清也点不准，功能改由窗口外的像素按钮承担。
 *                    这是产品决定，不是修 bug；测试里单独断言，绝不能让它
 *                    混进"不改变呈现"那一类里去。
 */
'use strict';

/* 窗口内的布局视口。
 *
 * 为什么不让窗口尺寸直接等于视口：原版页面有一堆固定像素（header 46px、
 * footer 38px、字体 12px），窗口真缩到 500px 宽会撞上它自己的
 * @media(max-width:680px) 断点，版面会切成另一套（画面铺满视口、页脚隐藏）。
 * 所以保持一个"桌面宽度"的视口，再用缩放系数把整页等比缩小。
 *
 * 视口必须同时满足：
 *   - 宽度 > 1050px，绕开 max-width:1050px 与 680px 两个断点；
 *   - 高度 ≥ 704px（46 + 视口宽-32 的 9/16 + 38），否则页脚被挤出视口出现滚动条。
 *
 * 在满足上面两条的前提下，视口越接近画面的实际尺寸，四周留白越少。
 * 1120×736 是实测下来留白最少、上下左右又均匀的一档：
 * shell 1088×696，四周各留 16px / 20px，正好是一圈电视边框。
 * 若用 1280×720，shell 只有 1104 宽，左右会各空出 88px 的黑边。 */
const VIEWPORT = { w: 1120, h: 736 };

/* 缩放系数 = w / 1120，h = 736 × 系数（高度必须跟着算，
 * 只改宽度会让视口高度偏离 736，页面的高度约束一失效，.shell 会撑满宽度，
 * 版面就不再是原版那一套了）。 */
const TV_SIZES = {
  small: { w: 448, h: 294, label: '小' },
  medium: { w: 520, h: 342, label: '中' },
  large: { w: 600, h: 394, label: '大' },
};

/* 原版是给浏览器写的，不认得 frameless 窗口——没有标题栏就没有拖动把手。
 * 这里只把"电视外壳"和顶部/底部条标成可拖动区域，不含任何视觉改动：
 * 背景色、字号、间距、布局一个字段都不动。 */
const TV_DRAG_CSS = `
  /* 四周深色留白 = 电视外壳，整块都能拖 */
  body { -webkit-app-region: drag; }
  /* 画面本体保持可交互，里面的按钮、面板照常点 */
  .shell { -webkit-app-region: no-drag; }
  /* 顶部的 GNN 台标条与底部状态条没有可点元素，一并做成第二拖动区 */
  header, footer { -webkit-app-region: drag; }
`;

/* ⚠️ 这是整个工程里唯一会改变画面呈现的注入，理由见文件头。
 *
 * 藏掉的是画面右上角那排功能按钮（强化 / 技能树 / 档案 / 设置）。
 * 它们并没有消失，只是搬到了电视窗口外面那个像素按钮上，
 * 点开依旧是画面自带的那套观测面板（页面里的 #management 原样使用，
 * 由主进程用 executeJavaScript 模拟点击它自己的入口按钮打开）。
 *
 * 只动 display，不碰尺寸、颜色、字体 —— 万一哪天要还原，
 * 删掉这一条即可，画面本身没有任何残留改动。 */
const TV_HIDE_DOCK_CSS = `
  .pixel-dock { display: none !important; }
`;

/* 面板窗口专属注入。面板是"另一个 tv 实例"，但它不是用来直播的 ——
 * 用户要的是一块干净的菜单：直播包装（台标条、机位小窗、字幕组、
 * 滚动新闻条、页脚）全部藏掉，只留观测面板本身。
 *
 * 只在面板窗口注入，电视画面一个像素都不受影响。它和 TV_HIDE_DOCK_CSS
 * 是两回事：那条在电视窗口里也生效、是唯一的呈现例外；这条只存在于面板，
 * 面板本来就不是"原版画面"。 */
const PANEL_ONLY_CSS = `
  /* 直播包装全部藏掉 */
  header, footer, #game, .scanlines, .camera-top, .inset,
  .action-caption, .event-banner, .lower-third, .ticker,
  #offline, #notice { display: none !important; }
  /* 画面不再锁 16:9，观测面板铺满整个窗口。
   * 高度必须从 html 一路 100% 下来：#stage 自己的 height:100% 折在
   * 自适应高度的父级上会退回页面公式（100vw*9/16），窗口加高它也不跟。 */
  html, body, .shell, #playerFrame { height: 100% !important; }
  #stage { width: 100% !important; height: 100% !important; aspect-ratio: auto !important; }
  /* 标题栏当拖动把手；按钮保持可点 */
  .obs-title { -webkit-app-region: drag; }
  .obs-title button { -webkit-app-region: no-drag; }
`;

/* 面板可读性放大（用户反馈"按钮还是太小了，字也太小了"）。
 *
 * 只在面板窗口注入；与 PANEL_ONLY_CSS 分成两条，是因为它们是两件事：
 * 一条是"只留菜单"，一条是"菜单里的字要大"。放大用**原生像素**而不是
 * 整窗 zoom —— 像素字体在整数像素上保持刀切的颗粒感，zoom 1.4 这种
 * 非整数倍会把每个字的笔画缩得忽粗忽细。
 *
 * 字号都比游戏自己的窄屏紧凑断点（max-width:680）大一到两号；
 * !important 是故意的 —— 这一层就是覆盖层，要压过页面里同名的紧凑规则。 */
const PANEL_READABLE_CSS = `
  /* 功能按钮：一键均分 / 全投偏好 / 掷骰进化 / 重置 …… 整体大一号 */
  .pixel-button { font-size: 13px !important; padding: 9px 14px !important;
                  border-width: 2px !important; box-shadow: 3px 3px 0 #071025 !important; }
  /* 这两个选择器比 .pixel-button 更具体，页面里的紧凑规则会赢过上面的，
   * 必须点名压回来 */
  .obs-tools button { font-size: 13px !important; padding: 9px 14px !important; }
  .upgrade-card button { font-size: 12px !important; padding: 8px 10px !important; }
  /* 页签 */
  .tabs button { font-size: 13px !important; padding: 8px 10px !important;
                 border-width: 2px !important; }
  /* 标题与观测台标 */
  .obs-title h2 { font-size: 20px !important; }
  .section-kicker { font-size: 12px !important; }
  /* 资源条：数值是菜单里最重要的信息 */
  .metric-row small { font-size: 11px !important; }
  .metric-row strong { font-size: 20px !important; }
  .metric-row > div > span { font-size: 10px !important; }
  .metric-row > div { padding: 8px 10px !important; }
  /* 各面板的行头（可用加点机会 / 天赋点 / 可用进化机会） */
  .assign-head > span { font-size: 14px !important; }
  .assign-head strong { font-size: 20px !important; }
  /* 卡片与天赋节点 */
  .upgrade-card h3 { font-size: 15px !important; }
  .upgrade-card p { font-size: 10px !important; min-height: 30px !important; }
  .talent-node { font-size: 13px !important; }
  /* 字放大之后内容必然超出窗口高度，纵向滚动是预期行为；
   * 横向不许滚（出现横向滚动条 = 布局又撑破了） */
  #growthContent { overflow-x: hidden !important; }
`;

const zoomFor = (w) => w / VIEWPORT.w;

module.exports = { VIEWPORT, TV_SIZES, TV_DRAG_CSS, TV_HIDE_DOCK_CSS, PANEL_ONLY_CSS, PANEL_READABLE_CSS, zoomFor };
