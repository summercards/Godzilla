/* 巨兽都市桌宠 · 骨骼与坐标系自检
 *
 * rig.js 是从网页版逐字复用的模块，这里只测它与桌宠渲染层之间的**契约**，
 * 不测动画好不好看（那是美术问题，得靠截图）。契约有三条：
 *
 *   1. 部件表与预计算的边界表必须一一对应，否则包围盒会算漏部件；
 *   2. 求解骨骼时 ground 必须显式传入，缺了会算出 NaN（canvas 会静默吞掉，
 *      表现为角色"歪打正着"地悬在半空——这个坑真踩过）；
 *   3. 嘴、爪、脚这些挂点解出来的是**骨骼空间**坐标，必须经同一套变换才能
 *      当屏幕坐标用。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const R = require('../renderer/rig.js');
const { PartBounds } = require('../renderer/part-bounds.js');

const G = require('../renderer/growth.js');

// 与 pet.js 保持一致的设计坐标常量
const DESIGN_W = 320;
const DESIGN_H = 256;
const GROUND = 214;

const BONE_KEYS = Object.keys(R.PARTS);

/* ------------------------------------------------------------------ *
 * 部件表 ↔ 边界表
 * ------------------------------------------------------------------ */
test('边界表覆盖全部部件，且没有多余条目', () => {
  assert.equal(BONE_KEYS.length, 12, '部件数量变了，边界表必须同步重算');
  assert.deepEqual(
    Object.keys(PartBounds).sort(),
    [...BONE_KEYS].sort(),
    '部件表与 part-bounds.js 对不上，请重跑 build/make-part-bounds.py',
  );
});

test('每个部件的不透明范围都落在自己的图内，且非空', () => {
  for (const key of BONE_KEYS) {
    const p = R.PARTS[key];
    const [x0, y0, x1, y1] = PartBounds[key];
    assert.ok(x1 > x0 && y1 > y0, `${key} 的边界是空的`);
    assert.ok(x0 >= 0 && y0 >= 0, `${key} 的边界出现负坐标`);
    assert.ok(x1 <= p.width && y1 <= p.height,
      `${key} 的边界 ${x1}×${y1} 超出了图幅 ${p.width}×${p.height}`);
  }
});

/* ------------------------------------------------------------------ *
 * 骨骼求解契约
 * ------------------------------------------------------------------ */
const actor = (over) => ({
  x: 160, ground: GROUND, step: 0, moving: false, angle: 0,
  action: { name: 'walk', t: 0 }, ...over,
});

test('求解骨骼：给了 ground，所有骨骼坐标都必须是有限值', () => {
  const actions = ['walk', 'claw', 'roar', 'beam', 'stomp', 'tail', 'neutral'];
  for (const name of actions) {
    for (const t of [0, 0.4, 1.0, 2.5, 4.2]) {
      const st = R.pose(actor({ action: { name, t } }), t);
      for (const key of ['root', ...BONE_KEYS]) {
        const b = st.bones[key];
        assert.ok(b, `${name}@${t} 缺少骨骼 ${key}`);
        assert.ok(Number.isFinite(b.x), `${name}@${t} 的 ${key}.x 不是有限值`);
        assert.ok(Number.isFinite(b.y), `${name}@${t} 的 ${key}.y 不是有限值`);
      }
    }
  }
});

test('求解骨骼：漏传 ground 会算出 NaN —— 这就是必须显式传的理由', () => {
  const broken = R.pose(actor({ ground: undefined }), 0);
  assert.ok(Number.isNaN(broken.bones.root.y),
    'rig.js 的行为变了：漏传 ground 不再产生 NaN，请重新确认渲染层的调用');
  // x 仍然是好的，这正是当初最难察觉的地方：只有纵轴烂掉
  assert.ok(Number.isFinite(broken.bones.root.x));
});

test('求解骨骼：同一输入必须得到同一结果', () => {
  const a = R.pose(actor({ action: { name: 'stomp', t: 0.7 } }), 0.7);
  const b = R.pose(actor({ action: { name: 'stomp', t: 0.7 } }), 0.7);
  assert.deepEqual(a.bones, b.bones);
});

/* ------------------------------------------------------------------ *
 * 包围盒：脚底必须落在 ground 上
 * ------------------------------------------------------------------ */
function bbox(groundAt) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  // 必须以 x=0 求解：这样得到的是相对枢轴的偏移量（dxLeft/dxRight），
  // 而不是某个具体站位的绝对坐标。
  const st = R.pose(actor({ x: 0, ground: groundAt }), 0);
  for (const key of BONE_KEYS) {
    const p = R.PARTS[key];
    const b = st.bones[key];
    const [x0, y0, x1, y1] = PartBounds[key];
    // 图像像素 → 以枢轴为原点的局部坐标（与 Skeleton.draw 的绘制方式一致）
    const local = (ix, iy) => [ix * p.scale - p.pivot[0], iy * p.scale - p.pivot[1]];
    const cos = Math.cos(b.a), sin = Math.sin(b.a);
    for (const [lx, ly] of [local(x0, y0), local(x1, y0), local(x1, y1), local(x0, y1)]) {
      const wx = b.x + lx * cos - ly * sin;
      const wy = b.y + lx * sin + ly * cos;
      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;
    }
  }
  return { minX, maxX, minY, maxY, h: maxY - minY, dxLeft: minX, dxRight: maxX };
}

test('包围盒：脚底几乎正好压在 ground 上（设计像素误差小于 2px）', () => {
  const box = bbox(GROUND);
  const base = G.bodyHeight(1) / box.h;       // 最小体型时的缩放，误差最不显眼
  const worst = G.bodyHeight(9999) / box.h;   // 最大体型时误差最明显
  for (const action of ['walk', 'claw', 'roar', 'beam', 'tail']) {
    const st = R.pose(actor({ x: 0, ground: GROUND, action: { name: action, t: 0 } }), 0);
    let maxY = -Infinity;
    for (const key of BONE_KEYS) {
      const p = R.PARTS[key];
      const b = st.bones[key];
      const [x0, y0, x1, y1] = PartBounds[key];
      const local = (ix, iy) => [ix * p.scale - p.pivot[0], iy * p.scale - p.pivot[1]];
      const cos = Math.cos(b.a), sin = Math.sin(b.a);
      for (const [lx, ly] of [local(x0, y0), local(x1, y0), local(x1, y1), local(x0, y1)]) {
        const wy = b.y + lx * sin + ly * cos;
        if (wy > maxY) maxY = wy;
      }
    }
    const drift = Math.abs(maxY - GROUND) * worst;
    assert.ok(drift < 2,
      `${action} 姿态下脚底偏离地面 ${drift.toFixed(2)} 设计像素，角色会显得悬空`);
  }
  assert.ok(base > 0);
});

test('包围盒：头在脚上方，尾巴比头伸得远', () => {
  const box = bbox(GROUND);
  assert.ok(box.minY < GROUND, '头顶应当在地面之上');
  assert.ok(box.h > 300, '整体高度不合理：' + box.h.toFixed(1));
  // 枢轴在躯干：尾巴那一侧的外伸明显大于头那一侧
  assert.ok(Math.abs(box.dxLeft) > box.dxRight * 1.5,
    `尾巴侧外伸 ${box.dxLeft.toFixed(0)} 与头侧 ${box.dxRight.toFixed(0)} 的比例不对`);
});

/* ------------------------------------------------------------------ *
 * 挂点：骨骼空间 → 设计坐标
 * ------------------------------------------------------------------ */
test('挂点：嘴、爪、脚、尾尖都存在且落在包围盒内', () => {
  const box = bbox(GROUND);
  // 与包围盒同一参照系（x=0），否则比的是绝对坐标与相对偏移，必然对不上
  const st = R.pose(actor({ x: 0, action: { name: 'beam', t: 2 } }), 2);
  for (const key of ['muzzle', 'claw', 'foot', 'tail']) {
    const p = st[key];
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `挂点 ${key} 不是有限值`);
    assert.ok(p.x >= box.dxLeft && p.x <= box.dxRight, `挂点 ${key} 的 x 跑到身体外了`);
    assert.ok(p.y >= box.minY && p.y <= box.maxY, `挂点 ${key} 的 y 跑到身体外了`);
  }
});

test('挂点：嘴解出来的是骨骼坐标，直接用会飞出画面外', () => {
  const st = R.pose(actor({ action: { name: 'beam', t: 2 } }), 2);
  const m = st.muzzle;
  const naiveInside =
    m.x >= 0 && m.x <= DESIGN_W && m.y >= 0 && m.y <= DESIGN_H;
  assert.ok(!naiveInside,
    '嘴部挂点看起来已经在设计坐标范围内了，请复核渲染层里 rigToDesign 是否还有必要');
});

test('挂点：经与 drawPet 相同的变换后，嘴部必须落进画面且贴着地面之上', () => {
  // 这段变换与 pet.js 的 drawPet 一致：以 (pet.x, GROUND) 为不动点按 dir×k 缩放
  const map = (p, level, dir, petX) => {
    const k = G.bodyHeight(level) / bbox(GROUND).h;
    return {
      x: petX + (p.x - petX) * dir * k,
      y: GROUND + (p.y - GROUND) * k,
    };
  };

  for (const level of [1, 10, 25, 50, 90, 200, 999]) {
    for (const dir of [1, -1]) {
      const petX = DESIGN_W / 2;
      const st = R.pose(actor({ x: petX, action: { name: 'beam', t: 2 } }), 2);
      const m = map(st.muzzle, level, dir, petX);
      assert.ok(m.x > 0 && m.x < DESIGN_W,
        `LV${level} dir=${dir}：嘴部落到了画面外 x=${m.x.toFixed(1)}`);
      assert.ok(m.y > 0 && m.y < GROUND,
        `LV${level} dir=${dir}：嘴部不在水平线以上 y=${m.y.toFixed(1)}`);
    }
  }
});

test('包围盒：全身在任何等级下都必须装得进窗口', () => {
  const box = bbox(GROUND);
  for (const level of [1, 25, 90, 200, 999, 9999]) {
    const k = G.bodyHeight(level) / box.h;
    const top = GROUND + box.minY * 0 - (GROUND - box.minY) * k;
    const width = (box.dxRight - box.dxLeft) * k;
    assert.ok(top > 0, `LV${level} 的头顶越过了窗口上沿：${top.toFixed(1)}`);
    assert.ok(width < DESIGN_W * 1.4,
      `LV${level} 的体宽 ${width.toFixed(0)} 会把窗口撑爆`);
  }
});
