/* 迷你电视模式：档位参数 + 窗口注入的 CSS。
 *
 * 抽成独立模块有两个原因：
 *   1. 拖动区域的 CSS 与档位尺寸是"对外契约"，主进程和开发期工具必须用同一份，
 *      复制粘贴迟早会漂移；
 *   2. 截图工具能 require 到真实数值，验证的是应用实际会用的东西。
 *
 * 注入内容分三类，前一类是给 frameless 窗口补把手，后两类只作用于面板窗口：
 *
 *   TV_DRAG_CSS        不改变任何呈现，只补 frameless 窗口缺的拖动把手。
 *   PANEL_ONLY_CSS     面板只留观测面板，藏掉直播包装。
 *   PANEL_READABLE_CSS 面板里的字与按钮放大一号。
 *
 * 历史：这里曾有一条 TV_HIDE_DOCK_CSS，用来藏掉画面右上角那排小按钮。
 * 它注入的选择器是 .pixel-dock，而该类名在 tv/ 里早已不存在（版面换成了
 * .tv-sidebar / .tv-menu），所以它是一条匹配不到任何元素的空操作。
 * 2026-09-17 删除，删除前后全页 448 个元素的 computed display 逐字段一致
 * （见 docs/技术线调整方向.md 的 Step 3 记录）。
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

/* 面板窗口的三档尺寸。**与电视档位完全解耦。**
 *
 * 为什么要解耦：电视是摆件，越小越不碍事；面板是操作台，越大越好用。
 * 绑死时只有"小电视＋小面板""大电视＋大面板"两种组合，而玩家真正想要的
 * 组合往往正好相反 —— 小电视挂在角落播着，面板摊开来点。
 *
 * 面板是 1:1 原生缩放（不做整页 zoom），所以这里写的就是真实屏幕像素。
 * 取值依据：
 *   - 宽度底线 560：资源条是 4 列，每格要塞下 20px 的数值 + 11px 的单位，
 *     再窄就开始换行。解耦前 small 档的面板只有 448 宽，必然挤压 —— 那正是
 *     "面板太窄"这条反馈的来源。
 *   - 高度底线 640：标题栏 + 资源条 + 页签 + 行头约 200px 是固定开销，
 *     内容区（自身纵向滚动）再留不到 400px，打开就只剩一条缝。
 *
 * 数值由 Step 4 实机截图定档；以后再调只改这里，别处不用动。 */
const PANEL_SIZES = {
  compact: { w: 560, h: 640, label: '紧凑' },
  standard: { w: 640, h: 760, label: '标准' },
  tall: { w: 720, h: 900, label: '加高' },
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

/* 面板窗口专属注入。面板是"另一个 tv 实例"，但它不是用来直播的 ——
 * 用户要的是一块干净的菜单：直播包装（台标条、机位小窗、字幕组、
 * 滚动新闻条、页脚）全部藏掉，只留观测面板本身。
 *
 * 只在面板窗口注入，电视画面一个像素都不受影响：这里藏掉的每一个元素
 * 在电视窗里都必须原样保留。 */
const PANEL_ONLY_CSS = `
  /* 直播包装全部藏掉 */
  header, footer, #game, .scanlines, .camera-top, .inset,
  .action-caption, .event-banner, .lower-third, .ticker,
  #offline, #notice { display: none !important; }
  /* 电视左侧那排实体按钮（功能菜单 + 转台）只在直播电视窗口里有意义，
   * 面板是干净的观测菜单，连同机柜侧栏一起藏掉，避免重复导航。 */
  .tv-sidebar { display: none !important; }
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

function panelBounds(main, size, area, gap = 10) {
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const right = main.x + main.width + gap;
  const left = main.x - width - gap;
  let x, y = clamp(main.y, area.y, area.y + area.height - height);
  if (right + width <= area.x + area.width) x = right;
  else if (left >= area.x) x = left;
  else {
    x = clamp(main.x, area.x, area.x + area.width - width);
    if (main.y + main.height + gap + height <= area.y + area.height) y = main.y + main.height + gap;
    else if (main.y - gap - height >= area.y) y = main.y - gap - height;
    else y = area.y;
  }
  return { x: Math.round(x), y: Math.round(y), width, height };
}
const zoomFor = (w) => w / VIEWPORT.w;

/* 面板档位 → panelBounds 吃的窗口尺寸。
 *
 * 档位用 w/h 命名（跟 TV_SIZES 对齐，两个列表要在同一个菜单里并排显示），
 * 而 panelBounds 收的是 BrowserWindow 那套 width/height —— 在这里做唯一一次换算。
 * 未知档位回落到 standard 而不是 `undefined`：档位名是从持久化状态读出来的，
 * 老档、手改过的档都可能带一个没见过的值，那时给个能用的尺寸，别把窗口开成 0×0。 */
const panelBox = (key) => {
  const s = PANEL_SIZES[key] || PANEL_SIZES.standard;
  return { width: s.w, height: s.h };
};

module.exports = {
  VIEWPORT, TV_SIZES, PANEL_SIZES,
  TV_DRAG_CSS, PANEL_ONLY_CSS, PANEL_READABLE_CSS,
  zoomFor, panelBounds, panelBox,
};
