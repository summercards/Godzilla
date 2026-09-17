#!/usr/bin/env node
'use strict';
/* ------------------------------------------------------------------ *
 * derive-rig.cjs —— 从母图裁切元数据推导运行时骨骼数据
 *
 * 输入：tv/assets/monsters/<怪兽>/source/parts.json   （母图空间：裁切框 + 原始枢轴）
 *       tv/assets/monsters/<怪兽>/parts/<槽位>/*.png  （实际部件图，用于校验尺寸）
 * 输出：tv/assets/monsters/<怪兽>/rig.json           （运行空间：枢轴比例 + 基准尺寸 + 缩放）
 *
 * 为什么要有这个脚本
 * ------------------------------------------------------------------
 * 旧数据把枢轴存成「换算完的像素值」（pivot:[8.8, 9.2]），把 scale 焊死在
 * 枢轴里。一旦某个形态要改单部件大小（大小轴），枢轴必须跟着比例走，
 * 否则部件会从关节上掉下来。
 * 本脚本改存「母图空间里的整数偏移」pivotOffset，由消费方乘比例：
 *   pivot_最终像素 = pivotOffset × scale × size
 * 整数偏移让装配与已验收值逐比特相等，同时与尺寸解耦 ——
 * 「大小」轴只改 size，挂点自动跟随。
 *
 * 用法：
 *   node build/derive-rig.cjs                 # 推导并写入 rig.json
 *   node build/derive-rig.cjs --check         # 只校验，不写盘（CI 用）
 *   node build/derive-rig.cjs --monster=godzilla
 * ------------------------------------------------------------------ */
const fs = require('node:fs');
const path = require('node:path');

const TV = path.join(__dirname, '..', 'tv');
const ASSETS = path.join(TV, 'assets');

/** 槽位顺序 = 绘制顺序（尾→躯干→肢→头），见 rig.js draw() */
const SLOTS = [
  'tail_tip', 'tail_mid', 'tail_base', 'far_thigh', 'far_shin', 'torso',
  'thigh', 'shin', 'upper_arm', 'forearm', 'jaw', 'head',
];

/** 骨骼父子契约。torso 为根。改这里必须同步 rig.js 的 PARENTS 校验。 */
const PARENTS = {
  torso: null,
  head: 'torso', jaw: 'head',
  upper_arm: 'torso', forearm: 'upper_arm',
  thigh: 'torso', shin: 'thigh',
  far_thigh: 'torso', far_shin: 'far_thigh',
  tail_base: 'torso', tail_mid: 'tail_base', tail_tip: 'tail_mid',
};

/** 从 PNG 文件头读 IHDR 宽高，不依赖任何图像库。 */
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG: ' + file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

const round = (v, n = 6) => Number(v.toFixed(n));

function derive(monster) {
  const dir = path.join(ASSETS, 'monsters', monster);
  const srcPath = path.join(dir, 'source', 'parts.json');
  if (!fs.existsSync(srcPath)) throw new Error('缺少母图裁切元数据: ' + srcPath);
  const src = JSON.parse(fs.readFileSync(srcPath, 'utf8'));

  /* parents 不单独成表：每个槽位自己带 parent，避免同一事实存两份。 */
  const rig = { monster, version: 1, scale: null, order: SLOTS, slots: {} };
  const problems = [];

  for (const slot of SLOTS) {
    const s = src[slot];
    if (!s) { problems.push('parts.json 缺少槽位 ' + slot); continue; }
    if (!PARENTS.hasOwnProperty(slot)) { problems.push('PARENTS 缺少槽位 ' + slot); continue; }

    const rel = path.posix.join('parts', slot, 'default.png');
    const abs = path.join(dir, 'parts', slot, 'default.png');
    if (!fs.existsSync(abs)) { problems.push('缺少部件图 ' + rel); continue; }

    const [w, h] = pngSize(abs);
    if (w !== s.width || h !== s.height) {
      problems.push(`${slot}: 部件图实际 ${w}×${h}，但 parts.json 声明 ${s.width}×${s.height}`);
    }

    const [ax, ay] = s.atlasBounds;
    const [sx, sy] = s.sourcePivot;
    /* 枢轴存「母图空间里的整数偏移」而不是换算后的像素值：
     * 整数没有精度损失，乘上比例后与已验收的装配逐比特相等。
     * 存比例（如 22/134）看着更"尺寸无关"，但两位小数一舍就差了百万分之几像素，
     * 与其放宽断言，不如存能精确还原的那个量。 */
    const pivotOffset = [sx - ax, sy - ay];

    /* approvedPivot 是视觉验收通过时的枢轴像素值，作为回归锚点。
     * 重建一次并与它对账：谁动了裁切框或枢轴，这里必须立刻报错，
     * 而不是等部件在关节上错位了才发现。 */
    const approved = s.approvedPivot || s.pivot;
    if (Array.isArray(approved)) {
      const rebuilt = [pivotOffset[0] * s.scale, pivotOffset[1] * s.scale];
      const drift = Math.max(Math.abs(rebuilt[0] - approved[0]), Math.abs(rebuilt[1] - approved[1]));
      if (drift > 0.01) problems.push(`${slot}: 枢轴推出 ${rebuilt.map(v => round(v, 3))}，与已验收的 ${approved} 不符（差 ${round(drift, 4)}）`);
    } else {
      problems.push(`${slot}: parts.json 缺少 approvedPivot 回归锚点`);
    }

    rig.slots[slot] = {
      parent: PARENTS[slot],
      png: rel,
      size: [s.width, s.height],
      scale: s.scale,
      pivotOffset,
      atlas: { origin: [ax, ay], sourcePivot: [sx, sy] },
    };
  }

  /* 全局装配比例必须唯一：pose() 用它把母图坐标换算成骨骼世界坐标。
   * 一旦某个槽位私自改比例，骨骼原点与部件图就会各说各话（部件整体错位），
   * 所以这里直接否决，而不是取最大值了事。 */
  const scales = [...new Set(SLOTS.map(s => rig.slots[s] && rig.slots[s].scale))];
  if (scales.length !== 1) problems.push('各槽位比例不一致：' + JSON.stringify(scales) + '，全局装配比例必须唯一');
  else rig.scale = scales[0];

  return { rig, problems };
}

/** 运行时包装：项目没有打包器，浏览器靠 <script> 直接加载，
 *  所以把同一份 rig.json 再写成一个 UMD 模块，避免 fetch/异步加载。 */
function umd(rig) {
  const rel = 'assets/monsters/' + rig.monster + '/rig.json';
  return `/* 由 build/derive-rig.cjs 从 ${rel} 生成 —— 不要手改，改母图元数据后重跑脚本。 */\n`
    + `(function(root){'use strict';\n`
    + `var RIG=${JSON.stringify(rig,null,2)};\n`
    + `if(typeof module!=='undefined'&&module.exports)module.exports=RIG;\n`
    + `else{(root.KaijuMonsters=root.KaijuMonsters||{})[RIG.monster]=RIG;}\n`
    + `})(typeof window!=='undefined'?window:this);\n`;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const mArg = args.find(a => a.startsWith('--monster='));
  const monster = mArg ? mArg.split('=')[1] : 'godzilla';

  const { rig, problems } = derive(monster);
  if (problems.length) {
    console.error('推导失败：\n  - ' + problems.join('\n  - '));
    process.exit(1);
  }

  const root = path.join(__dirname, '..');
  const targets = [
    [path.join(ASSETS, 'monsters', monster, 'rig.json'), JSON.stringify(rig, null, 2) + '\n'],
    [path.join(ASSETS, 'monsters', monster, 'rig.data.js'), umd(rig)],
  ];

  if (check) {
    const stale = targets.filter(([f, body]) => !fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== body);
    if (stale.length) {
      console.error('以下产出与母图元数据不一致，请运行 node build/derive-rig.cjs 重新推导：\n  - '
        + stale.map(([f]) => path.relative(root, f)).join('\n  - '));
      process.exit(1);
    }
    console.log('OK  rig.json / rig.data.js 与 parts.json、11+1 部件图四者一致（' + SLOTS.length + ' 槽位，装配比例 ' + rig.scale + '）');
    return;
  }

  for (const [f, body] of targets) fs.writeFileSync(f, body);
  console.log('写入 ' + targets.map(([f]) => path.relative(root, f)).join(' + ') + '（' + SLOTS.length + ' 槽位，装配比例 ' + rig.scale + '）');
}

if (require.main === module) main();
module.exports = { derive, pngSize, SLOTS, PARENTS };
