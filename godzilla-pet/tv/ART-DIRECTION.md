# 美术与骨骼动画记录 · 2.1

## 方向

沿用用户第二张参考图的粗颗粒 16 位街机像素、灰黑鳞片、青蓝背鳍、深蓝夜景、黄色窗灯与洋红霓虹。天气、雨滴、闪电、烟尘、火焰、水面反光和军队破坏演出继续运行。

## 造型修正

上一版重新生成的部件图集改变了原角色的躯干与腿部比例，不能视为与原图一致。本版不再使用该图集作为运行主角，而是直接按解剖部位拆分母图 `assets/monsters/godzilla/source/godzilla-pixel.png`。

原图每个像素只分配到一个部件，保持统一 0.40 倍比例。将十二部件恢复到绑定姿态后，与原始像素角色合成到相同底色比较，最大 RGB 差值为 0。此验证针对静止绑定姿态，不表示运动时轮廓始终不变。

## 运行资产

运行时只加载下面这几项，`assets/` 里其余内容都不参与运行：

- `assets/monsters/godzilla/source/godzilla-pixel.png`：批准的完整像素角色，也是裁切坐标的母图。
- `assets/monsters/godzilla/parts/<槽位>/default.png`：十二个透明 PNG 部件，
  位于躯干、头、下颌、上臂、前臂、近侧大腿与胫足、远侧大腿与胫足、尾根、尾中、尾尖
  各自以槽位命名的目录下。
- `assets/monsters/godzilla/source/parts.json`：母图空间的裁切坐标、原始枢轴、像素尺寸与统一比例。
- `assets/monsters/godzilla/rig.json` + `rig.data.js`：由 `build/derive-rig.cjs`
  从上一项推导出的运行空间骨骼数据（枢轴偏移、基准尺寸、绘制顺序、父子关系）。
- `assets/asset-index.js`：贴图路径的唯一真相。
- `appearance.js`：形态与「样式 / 颜色 / 大小」三轴的解算。
- `rig.js`：13 个唯一变换节点（根节点 + 十二部件）；父子变换、关键帧曲线与运行时接缝。

以下都是验收期的一次性产物，**已在 2026-09-17 的工程整理中移除**（上面「造型修正」一节的
结论仍然成立，它们只是当时的取证材料，不是运行资产）：

- 旧版方案目录 `rig/` 与旧版图集 `godzilla-parts-atlas.png`——游戏从不加载。
- `neutral-reassembled.png`（静止重组图）、`original-comparison.png`（原图对照）——
  上节 0 差值比较的取证图。
- `preview-*.webp`（六组透明动画预览，每组 24 个姿态）、`animation-contact.png`
  （行走、爪击、吐息、重踏、咆哮、尾扫联系表）——动作验收预览。

需要复现这些材料时，从 `source/godzilla-pixel.png` 按 `source/parts.json` 重新拆件即可，两者都还在。
改完母图后必须跑 `node build/derive-rig.cjs` 重推 `rig.json`，否则枢轴会与母图脱钩
（测试会拦下来，见 `docs/资产规范.md` §4.3）。

## 动画实现

头部与下颌分别运动，上下臂有独立挥击，双腿错相迈步，三节尾巴逐级摆动。吐息从头部骨骼的嘴部位置发出，爪击和脚部冲击点使用骨骼世界坐标。

在转动关节下方绘制跟随父骨骼的深色像素鳞片补片，减少抬腿和挥爪时内部切口透出城市背景。补片不参与静止绑定姿态的还原比较。运行时连续计算关节，不播放整张立绘平移或预录视频。

## 像素界面

使用本地 Fusion Pixel 12px 简体中文字库，保留硬边窗口、方形按钮、点阵图标与横向新闻滚动。正常窗口与全屏的直播画面都为 16:9。字体来源与许可：[Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)，随包附 `assets/fonts/LICENSE-OFL`。
