# 巨兽都市

一个常驻桌面的哥斯拉。它自己拆楼、自己进化、自己长大，从只能拍碎平房的幼体
慢慢长成能一脚踩平高楼的完全体。全程不需要你操作，进度存在文件里，
关掉再打开接着算。

```
Godzilla/
├── godzilla-pet/        唯一主线：Electron 桌宠（应用本体）
│   ├── tv/              它播放的画面：一份完整的挂机直播游戏，独立可跑
│   ├── dist/            发布产物：离线单文件版、生成的 .app
│   └── ...
├── archive/             历史文件，仅作保留
└── README.md            你正在看的这份
```

以前这里有两条并列的产品线：一个网页版，一个桌宠。现在只有一条 ——
桌宠是应用，网页版降级成它播放的画面（`godzilla-pet/tv/`）。桌宠用 `loadFile`
直接打开它，不复制、不改写，所以电视里看到的画面与它单独跑时分毫不差。

## 快速开始

| 目标 | 怎么做 |
| --- | --- |
| 玩桌宠 | `cd godzilla-pet && npm install && sh build/make-app.sh` → 双击 `~/Applications/巨兽都市桌宠.app` |
| 只跑电视画面 | 双击 `godzilla-pet/dist/巨兽都市-挂机直播.html`（离线单文件，不需要服务器） |
| 改电视画面的源码 | `cd godzilla-pet/tv && python3 -m http.server 8765` |
| 自检 | `cd godzilla-pet && npm test`（67 项，已含电视画面的端到端自检） |

`npm start` 是在终端前台跑一个，**终端一关它就没了**，只适合调试。
日常用走 `make-app.sh` 装成真正的应用。

## 存档

**进度存在一个文件里**：`<userData>/save/tv.json`，
macOS 下是 `~/Library/Application Support/巨兽都市桌宠/save/tv.json`。

- 每 5 秒自动落盘，关窗那一刻再同步补一次；崩溃或强杀最多丢 5 秒。
- 写入是原子的（临时文件 → fsync → 改名），主档坏了自动回退上一版备份，
  永远不会读到半个 JSON。
- 托盘菜单 →「存档」可以打开文件夹、导出备份、从备份导入、重置。

画面自己只认 localStorage，这份文件的读写是从外面**劫持**过来的 ——
`tv/` 里一个字节都没改。做法和它踩过的坑见
[`godzilla-pet/README.md`](godzilla-pet/README.md)。

## 文档

- [`godzilla-pet/README.md`](godzilla-pet/README.md) — 桌宠主文档：存档接管机制、
  开发命令、目录、踩过的两个坑
- [`godzilla-pet/CHANGELOG.md`](godzilla-pet/CHANGELOG.md) — 本次改版与验证记录
- [`godzilla-pet/tv/README.md`](godzilla-pet/tv/README.md) — 电视画面的玩法、
  技能树与敌军表
- [`godzilla-pet/tv/DESIGN.md`](godzilla-pet/tv/DESIGN.md) — 数值公式、自动决策
  与破坏状态机
- [`godzilla-pet/tv/ART-DIRECTION.md`](godzilla-pet/tv/ART-DIRECTION.md) —
  原图拆件、造型还原与动画实现

## archive/

只放历史，不参与构建：

| 文件 | 是什么 |
| --- | --- |
| `雨夜新宿-游戏与源码.zip` | 更早的街机版存档：玩家还能操作的那一版，内容已过时。解开来是完整可跑的一套 |

> 早期还有一份 `雨夜新宿.html`（与 `godzilla-pet/dist/巨兽都市-挂机直播.html`
> 逐字节相同的重名副本）和一个旧版全量打包 zip，两份都已在 2026-09-17 的工程整理中移除：
> 前者是改名时误留的重复文件，后者早已被仓库目录完全取代。

## 技术说明

原生 JavaScript 与 Canvas 2D，无构建步骤；桌宠的依赖只有 Electron 运行时本身。
游戏画面内部以 640×360 渲染后放大到 1280×720，保持 16:9。

角色不使用预录动画，而是在运行时按父子骨骼连续计算关节变换：12 个独立部件、
13 个变换节点，走路、挥爪、吐息、重踏、咆哮、尾扫六组动作，嘴部光束与爪击特效
读取骨骼世界坐标。静止绑定姿态与原图像素的最大 RGB 差值为 0。

## 字体许可

界面使用 [Fusion Pixel Font](https://github.com/TakWolf/fusion-pixel-font)，
许可证见 `godzilla-pet/tv/assets/fonts/LICENSE-OFL`。代码 MIT。
