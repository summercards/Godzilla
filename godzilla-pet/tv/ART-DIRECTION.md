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
# 银曜巨人

关底敌对巨人，银灰装甲、暗红身体纹样、暖黄双眼、青色胸口核心。
遵循城市敌军的粗颗粒 Canvas 像素风格；运行绘制为 game.js 的 drawSentinel。
约 404 世界单位高，关节驱动双臂、前臂和双腿；包含呼吸待机、举臂蓄力、射击回弹、受击闪白和 2.4 秒倒地。
每张地图固定生成一次，击败后才解锁下一地图；旧档已经解锁的出口保持解锁。

## 银曜巨人：ImageGen 母图拆件骨骼版（2026-09-19）

替换最初的 Canvas 方块造型。使用内置图像生成工具，以现有 `godzilla-pixel.png` 为像素质感参考，制作银红色、三分之二侧身朝左的完整角色母图。原始母图保存在 `assets/enemies/army/sentinel/source/sentinel.png`，1024×1536，自带透明通道；保留其原始 alpha，无需按黑色背景抠图。

生成提示词要点：Ultraman-like silver and crimson giant hero as hostile boss; richly modeled shaded 16-bit arcade pixel clusters, dark outlines, dramatic highlights; three-quarter side view facing left; streamlined silver fin helmet, warm almond eyes, cyan chest reactor; athletic proportions; neutral separated limbs suitable for skeletal cutting; transparent backdrop; no text, no block robot. 生成方式：内置 ImageGen；未使用 CLI/API 回退。完整提示词保存在 `docs/sentinel-prompt.txt`。

`build/sentinel-assets.py` 按母图解剖位置分割 10 个不重叠部件：头、躯干、两侧上臂/前臂、大腿/胫足，另取 9 个母图纹理关节补片。分割的原始 RGBA 重组差为 0。裁切坐标与枢轴输出至 `source/parts.json`，运行骨架输出至 `rig.data.js`。生成物不手改；调整分割后重新运行脚本。

`sentinel.js` 用父子坐标变换实时驱动关节，包含呼吸待机、双臂蓄力、射击、受击及屈膝倒地；上下臂分别旋转，枪口坐标从前臂骨骼计算。双腿连接根节点，确保站立攻击脚底不滑动。关节旋转时用原图圆形补片遮住切口。没有用整张立绘平移替代动作。

已接入每关末尾的敌对单位与血量存档。图像资源失败时不会用方块替身冒充成品，加载结果可由 renderer.ready / failures 检查。`build/boss-preview.cjs` 使用独立临时存档，在真实 Electron Canvas 中生成游戏内截图、四动作联系图与 52 帧动画验收图。`tv/tests/sentinel.test.cjs` 校验绑定姿态位置、父子骨段长度、手臂枪口运动、攻击时脚底固定及所有贴图文件。

### 出场与近战演出（2026-09-19）

骨架扩展为 12 个身体部件、11 个纹理关节补片：双脚从胫足继续拆出。深蹲与出拳用双骨骼 IK 保持骨段长度，双脚单独保留水平朝向；绑定姿态仍原样还原母图。

- 出场共 4.3 秒：0–0.65 秒高空预警；0.65–1.5 秒高速下坠；1.5 秒落地触发冲击波、碎石、短扬尘、低音和镜头震动；深蹲停留后缓缓起身，3.25 秒揭示名字，4.3 秒交还战斗。接近原出场点（距 Boss 580 世界单位）时，将换图按钮改为“摧毁这块区域”；未点击时 Boss 保持隐藏，街区持续向前生成。点击后才触发演出，演出期间暂停主角攻击并保护 Boss，保证出场不会被提前击杀打断。
- 近战共 1.6 秒：收拳预备、下压前探、0.72 秒拳头接触、短停顿、收势。低体型主角对应更深的下压，拳头按主角真实受击盒瞄准。只有拳头接触受击盒才触发受击反馈、0.32 秒硬直、震屏和短慢动作；不另造本游戏不存在的玩家生命值扣血机制。近距离优先两次重拳，间隔一次能量射击。
- 落地事件与拳击事件按时间跨越阈值触发，帧率变化不重复命中。出场进度随 Boss 血量一起存档；老档已有 Boss 按已出场迁移，已解锁关卡不倒退。
- `build/boss-performance.cjs` 在隔离存档中运行真实场景，输出 150 帧出场到近战演出和六姿态检查图。测试覆盖出场一次性落地、恢复战斗、近战命中时序、保护窗口、IK 长度及双脚朝向。
