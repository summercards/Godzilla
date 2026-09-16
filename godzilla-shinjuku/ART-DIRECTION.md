# 美术与骨骼动画记录 · 2.1

## 方向

沿用用户第二张参考图的粗颗粒 16 位街机像素、灰黑鳞片、青蓝背鳍、深蓝夜景、黄色窗灯与洋红霓虹。天气、雨滴、闪电、烟尘、火焰、水面反光和军队破坏演出继续运行。

## 造型修正

上一版重新生成的部件图集改变了原角色的躯干与腿部比例，不能视为与原图一致。本版不再使用该图集作为运行主角，而是直接按解剖部位拆分 `assets/godzilla-pixel.png`。

原图每个像素只分配到一个部件，保持统一 0.40 倍比例。将十二部件恢复到绑定姿态后，与原始像素角色合成到相同底色比较，最大 RGB 差值为 0。此验证针对静止绑定姿态，不表示运动时轮廓始终不变。

## 运行资产

- `assets/godzilla-pixel.png`：批准的完整像素角色。
- `assets/rig-source/`：躯干、头、下颌、上臂、前臂、近侧大腿与胫足、远侧大腿与胫足、尾根、尾中、尾尖，共十二个透明 PNG。
- `assets/rig-source/parts.json`：原图裁切坐标、原始枢轴、像素尺寸与统一比例。
- `assets/rig-source/neutral-reassembled.png`：静止重组图。
- `assets/rig-source/original-comparison.png`：原图与静止重组对照。
- `assets/rig-source/preview-*.webp`：六组透明动画 QA 预览，每组 24 个姿态。
- `assets/rig-source/animation-contact.png`：行走、爪击、吐息、重踏、咆哮、尾扫联系表。
- `rig.js`：13 个唯一变换节点（根节点 + 十二部件）；父子变换、关键帧曲线与运行时接缝。

之前的 `assets/rig/` 与 `godzilla-parts-atlas.png` 保留为历史方案，游戏不加载它们。

## 动画实现

头部与下颌分别运动，上下臂有独立挥击，双腿错相迈步，三节尾巴逐级摆动。吐息从头部骨骼的嘴部位置发出，爪击和脚部冲击点使用骨骼世界坐标。

在转动关节下方绘制跟随父骨骼的深色像素鳞片补片，减少抬腿和挥爪时内部切口透出城市背景。补片不参与静止绑定姿态的还原比较。运行时连续计算关节，不播放整张立绘平移或预录视频；WebP 仅为资源验收预览。

## 像素界面

使用本地 Fusion Pixel 12px 简体中文字库，保留硬边窗口、方形按钮、点阵图标与横向新闻滚动。正常窗口与全屏的直播画面都为 16:9。字体来源与许可：[Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)，随包附 `assets/fonts/LICENSE-OFL`。
