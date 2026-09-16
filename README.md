# 巨兽都市 · GNN 挂机直播版

打开即开始的自动破坏游戏。哥斯拉自行推进、选择目标和释放技能；不需要移动或战斗操作，也没有玩家血条、死亡或复活流程。

完整 16:9 像素画幅，中英文字体、美术、界面与逻辑全部内嵌，可离线运行。

## 快速开始

| 方式 | 操作 |
| --- | --- |
| 免安装游玩 | 双击根目录的 `巨兽都市-挂机直播.html` |
| 源码运行 | `cd godzilla-shinjuku && python3 -m http.server 8765`，浏览器访问 `http://localhost:8765` |
| 逻辑自检 | `cd godzilla-shinjuku && node tests/idle.cjs`（加 `--long` 跑长期模拟） |

游戏自动运行。现场声音默认关闭，点击「设置」→「开启现场声音」启用；浏览器要求音频由用户点击启动。

## 玩法概要

- 哥斯拉按距离、敌军与技能冷却自动决策，近战优先于原子吐息。
- 被动代谢持续产出核能，拆楼与击破军队额外获得核能与进化经验。
- 四项数值强化：巨兽力量、原子炉心、核能代谢、巨躯动能。
- 三条分支九个节点的技能树，默认开启自动进化（均衡 / 力量 / 吐息 / 收益四种偏好）。
- 五个城市主题循环，区域编号持续增长，敌方耐久与压制逐步提高。
- 每 5 秒自动保存；离线收益最多结算 8 小时。

## 目录结构

```
godzilla-shinjuku/
├── index.html          新闻直播界面与成长面板
├── style.css           像素界面样式
├── game.js             自动决策、战斗、场景、物理表演、存档接入
├── progression.js      资源、成长、技能树、离线结算（可 require，便于测试）
├── rig.js              骨骼层级、关节位置、关键帧与世界坐标计算
├── assets/
│   ├── rig-source/     从原始角色拆出的 12 个透明部件 PNG 与资源元数据
│   ├── rig/            早期部件方案，游戏不加载，仅作历史记录
│   ├── fonts/          Fusion Pixel 点阵字库及 OFL 许可证
│   └── godzilla-pixel.png  批准的完整像素角色原图
└── tests/idle.cjs      零依赖逻辑自检
```

补充文档：

- [`godzilla-shinjuku/README.md`](godzilla-shinjuku/README.md) — 完整功能说明、技能树与敌军表
- [`godzilla-shinjuku/DESIGN.md`](godzilla-shinjuku/DESIGN.md) — 数值公式、自动决策与破坏状态机
- [`godzilla-shinjuku/ART-DIRECTION.md`](godzilla-shinjuku/ART-DIRECTION.md) — 原图拆件、造型还原与动画实现
- [`godzilla-shinjuku/CHANGELOG.md`](godzilla-shinjuku/CHANGELOG.md) — 各版本改动与验证记录

归档压缩包：`巨兽都市-挂机版与源码.zip` 为当前版本全量打包；`雨夜新宿-游戏与源码.zip` 为更早的街机版存档，内容已过时，仅作历史保留。

## 技术说明

原生 JavaScript 与 Canvas 2D，无构建步骤、无 npm 依赖。游戏内部以 640×360 渲染后放大到 1280×720，保持 16:9。

角色不使用预录动画，而是在运行时按父子骨骼连续计算关节变换：12 个独立部件、13 个变换节点，走路、挥爪、吐息、重踏、咆哮、尾扫六组动作，嘴部光束与爪击特效读取骨骼世界坐标。

## 字体许可

界面使用 [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)，许可证见 `godzilla-shinjuku/assets/fonts/LICENSE-OFL`。
