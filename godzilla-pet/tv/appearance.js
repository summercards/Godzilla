/* ------------------------------------------------------------------ *
 * appearance.js —— 怪兽成长形态框架（运行时）
 *
 * 框架：怪物 → 形态 → 部件槽 → { 样式, 颜色, 大小 }
 *
 *   怪物  godzilla
 *    └ 形态   5 档，与 progression.js 的 EPOCHS 一一对应（幼兽…灾厄体）
 *       └ 部件槽  12 个骨骼槽 + 7 个装饰槽
 *          ├ 样式 style  换贴图（parts/<槽位>/<样式>.png）
 *          ├ 颜色 color  调色板（原色 / 赤化 / 白化 / 玄化 / 翠化）
 *          └ 大小 size   绕枢轴等比缩放，挂点自动跟随
 *
 * 分层原则（重要）：
 *   等级 → 形态 的「阈值」只由 progression.js 的 EPOCHS 决定（数值层）；
 *   形态 → 外观 的「呈现」只由本文件的 FORMS 决定（表现层）。
 *   本文件不重复声明任何等级阈值，只按序号与 EPOCHS 对齐，
 *   由 validate() + 测试保证两边长度与名称一致，避免出现第二套成长阶梯。
 *
 * 三个轴当前的落地程度（详见 docs/资产规范.md §5）：
 *   样式  已生效：解析出的路径会真的被 rig.js 加载。
 *   大小  已生效：改 size 只改挂点缩放，装配不脱节。
 *   颜色  已声明但对 12 个骨骼槽「只记录不施加」——
 *         对已验收的像素部件做调色板重映射会改变轮廓边缘，本版不动它；
 *         目前真正生效的是装饰槽的叠色与辉光（见 decor()）。
 * ------------------------------------------------------------------ */
(function (root) {
  'use strict';

  const idx = (typeof module !== 'undefined' && module.exports)
    ? require('./assets/asset-index.js')
    : root.KaijuAssets;

  if (!idx) throw new Error('appearance.js 需要先加载 assets/asset-index.js');

  /** 三个轴的名字。加轴必须同时改 toParts()/decor() 与约束文档 §5。 */
  const AXES = ['style', 'color', 'size'];

  /** 颜色轴：调色板。overlay 是整体叠色，最便宜的染色手段，
   *  作用在已画好的角色之上，不改部件图本身。 */
  const PALETTES = {
    none: { label: '原色', overlay: null },
    crimson: { label: '赤化', overlay: { color: '#ff3b2e', alpha: 0.18 } },
    albino: { label: '白化', overlay: { color: '#eaf6ff', alpha: 0.14 } },
    obsidian: { label: '玄化', overlay: { color: '#0a0a12', alpha: 0.22 } },
    jade: { label: '翠化', overlay: { color: '#2fae6a', alpha: 0.16 } },
  };

  /** 形态：呈现层，按序号与 EPOCHS 对齐（[0]=幼兽 … [4]=灾厄体）。
   *  styles 为空表示"该形态沿用各槽位的默认贴图"——现在就是这种情况，
   *  等美术产出 parts/<槽位>/<形态样式>.png 后，把样式名填进来即可生效。 */
  const FORMS = [
    { id: 'juvenile', label: '幼兽', styles: {}, size: {} },
    { id: 'subadult', label: '亚成体', styles: {}, size: {} },
    { id: 'adult', label: '成体', styles: {}, size: {} },
    { id: 'perfect', label: '完全体', styles: {}, size: {} },
    { id: 'cataclysm', label: '灾厄体', styles: {}, size: {} },
  ];

  const clampSize = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return 1;
    /* 单槽位大小是"相对基准"的倍率。超过这个区间就不再是同一套骨骼能承受的
     * 形变，应该新开一个形态而不是把一个槽位拉大 —— 约束文档 §5.3。 */
    return Math.max(0.85, Math.min(1.25, n));
  };

  /** 空白皮肤：所有槽位 default / 原色 / 1.0 倍，即已被验收的基准装配。 */
  function defaultSkin(monsterId) {
    const m = idx.monster(monsterId);
    if (!m) throw new Error('未登记的怪兽：' + monsterId);
    const slots = {};
    for (const slot of idx.SLOTS) slots[slot] = { style: m.defaultStyle, color: 'none', size: 1 };
    const decor = {};
    for (const slot of idx.DECOR_SLOTS) decor[slot] = { style: m.defaultStyle, color: 'none', size: 1 };
    return { monster: monsterId, axes: AXES.slice(), slots, decor };
  }

  /** 按形态序号 + 突变体征解析出一套皮肤。形态只声明差异，其余沿用默认。 */
  function skinFor(monsterId, formIndex, morph) {
    const skin = defaultSkin(monsterId);
    const form = FORMS[Math.max(0, Math.min(FORMS.length - 1, Number(formIndex) || 0))] || FORMS[0];
    for (const slot of Object.keys(form.styles)) {
      if (skin.slots[slot]) skin.slots[slot].style = form.styles[slot];
    }
    for (const slot of Object.keys(form.size)) {
      if (skin.slots[slot]) skin.slots[slot].size = clampSize(form.size[slot]);
    }
    const hue = morph && morph.hue;
    if (hue && PALETTES[hue]) for (const slot of idx.SLOTS) skin.slots[slot].color = hue;
    skin.form = form.id;
    skin.formIndex = FORMS.indexOf(form);
    return skin;
  }

  /**
   * 把 (骨骼数据 + 资产索引 + 皮肤) 装配成 rig.js 需要的部件表。
   *
   * 这里是「大小」轴唯一生效的地方：
   *   scale = 基准比例 × 槽位倍率
   *   pivot = 母图整数偏移 × scale
   * 枢轴存的是母图空间整数偏移，与最终像素尺寸解耦，
   * 所以放大缩小之后部件仍然挂在同一个关节上。
   * 注意：关节本身的世界坐标由 rig.js 的 pose() 用全局 scale 计算，
   * 与这里无关 —— 单槽位改大小不会把整只怪兽撑开，也不会移动关节。
   */
  function toParts(rig, skin, monsterId) {
    const id = monsterId || rig.monster;
    const parts = {};
    for (const slot of rig.order) {
      const d = rig.slots[slot];
      if (!d) continue;
      const s = (skin && skin.slots && skin.slots[slot]) || {};
      const size = clampSize(s.size);
      const scale = d.scale * size;
      const style = s.style || idx.monster(id).defaultStyle;
      parts[slot] = {
        slot,
        style,
        color: s.color || 'none',
        src: idx.file.monsterPart(id, slot, style),
        width: d.size[0],
        height: d.size[1],
        scale,
        pivot: [d.pivotOffset[0] * scale, d.pivotOffset[1] * scale],
        sourcePivot: d.atlas.sourcePivot,
        atlasBounds: [d.atlas.origin[0], d.atlas.origin[1], d.size[0], d.size[1]],
      };
    }
    return parts;
  }

  /**
   * 装饰槽规格：game.js 的 drawMorph() 不再自己去翻 morph/talents/epoch，
   * 一律从这里取。于是「哪个突变改哪个槽的哪个轴」只在这一个地方声明。
   *
   * 入参保持纯粹：调用方把 economy 里的颜色算好传进来，本模块不依赖 economy。
   */
  function decor(inputs) {
    const form = inputs.form || FORMS[0];
    const m = inputs.morph || {};
    const t = inputs.talents || {};
    const epoch = inputs.epoch || {};
    const elementColor = inputs.elementColor || null;

    const talentSpines = t.spines || 0;
    const extraSpines = m.spikes || 0;
    const spikeScale = m.spikeScale || 1;

    const horns = m.horns || 0;
    const overlay = (m.hue && PALETTES[m.hue] && PALETTES[m.hue].overlay) || null;

    return {
      form: form.id,
      /* 背鳍：沿尾尖→头部的脊线分布，数量与高度受形态/天赋/突变三者叠加。 */
      spikes: {
        count: 2 + (epoch.spikes || 3) + talentSpines + extraSpines,
        heightScale: (1 + 0.2 * talentSpines) * spikeScale,
        bonus: extraSpines,
        color: elementColor || epoch.color || '#3a6b4a',
        fork: talentSpines >= 1 || spikeScale > 1.1,
      },
      plates: { on: (m.plates || 0) > 0, count: m.plates || 0 },
      horns: { count: horns, blades: horns > 1 ? 2 : 1, heightPx: 58 + (horns > 1 ? 8 : 0) },
      eye: { glow: !!m.eyeGlow, third: !!m.thirdEye },
      aura: { on: !!(m.aura || t.radiant), color: inputs.beamColor || '#70f8ff' },
      overlay,
      tail: { twin: !!m.twinTail },
      claw: { count: m.claws || 0 },
    };
  }

  /**
   * 框架自检：把「框架里写了什么」和「外部世界真的有什么」对账。
   * 返回问题数组，空数组 = 通过。测试直接断言它为空。
   * epochs 由调用方从 progression.js 传入，本模块不反向依赖数值层。
   */
  function validate(epochs) {
    const problems = [];
    const m = idx.MONSTERS.godzilla;

    if (!Array.isArray(epochs)) problems.push('validate() 需要 EPOCHS 才能对账形态与等级阶梯');
    else {
      if (FORMS.length !== epochs.length) {
        problems.push(`形状态数 ${FORMS.length} 与 EPOCHS 阶数 ${epochs.length} 不一致：两套成长阶梯必须同长`);
      }
      const n = Math.min(FORMS.length, epochs.length);
      for (let i = 0; i < n; i++) {
        if (FORMS[i].label !== epochs[i].name) {
          problems.push(`第 ${i} 档形态名「${FORMS[i].label}」与 EPOCHS 的「${epochs[i].name}」不一致`);
        }
      }
    }

    for (const slot of m.slots) {
      if (!m.slots.includes(slot)) problems.push('槽位清单自相矛盾：' + slot);
    }
    if (idx.SLOTS.length !== 12) problems.push(`骨骼槽应为 12 个，实际 ${idx.SLOTS.length} 个`);

    const knownStyles = Object.keys(m.styles);
    for (const form of FORMS) {
      for (const [slot, style] of Object.entries(form.styles)) {
        if (!idx.SLOTS.includes(slot)) problems.push(`形态 ${form.id} 引用了不存在的槽位 ${slot}`);
        if (!knownStyles.includes(style)) problems.push(`形态 ${form.id} 的 ${slot} 引用了未登记的样式 ${style}`);
      }
      for (const slot of Object.keys(form.size)) {
        if (!idx.SLOTS.includes(slot)) problems.push(`形态 ${form.id} 的 size 引用了不存在的槽位 ${slot}`);
      }
    }
    return problems;
  }

  const api = {
    AXES, PALETTES, FORMS,
    defaultSkin, skinFor, toParts, decor, validate, clampSize,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KaijuAppearance = api;
})(typeof window !== 'undefined' ? window : this);
