/* 巨兽都市 · 成长系统数值层
 *
 * 对应 doc/game-design/06-成长系统.md，落地后 DESIGN.md 应以本文件行为为准。
 *
 * 四层成长，各有各的货币，互不抢：
 *   强化   核能        四项数值的底子          （原有）
 *   加点   升级白给    保底成长，不看核能        （本次新增）
 *   技能树 dna         它能做什么              （原有）
 *   天赋   天赋点      它是什么 —— 体貌         （本次新增）
 *   突变   不需要货币   它长什么样，每级自动抽一次 （本次新增）
 *
 * 两条铁律，破坏任何一条都会毁掉"这头巨兽独一无二"：
 *   1. 决定外观的随机一律走 hashSeed + mulberry32，绝不用 Math.random()
 *   2. 按 level 派生独立序列，不用全局连续流 —— 否则将来在别处插一次随机调用，
 *      后续所有突变就会错位，和已落盘的 mutations 对不上
 *
 * 天气是可选输入：本次只做成长，weather 传 null 时所有天气系数取 1。
 * 接口留好，05-天气系统.md 落地时不用改这里。
 */
(function (root) {
'use strict';

/* 成长的数值口径（体型曲线 / 体征解锁门槛 / 战斗数值的区域系数）全部来自
 * growth.js —— 本文件不再自带第二套体型公式。见 growth.js 顶部的约定。 */
const Growth = (typeof module !== 'undefined' && module.exports)
  ? require('./growth.js')
  : root.KaijuGrowth;
if (!Growth) throw new Error('progression.js 需要先加载 growth.js');

/* ------------------------------------------------------------------ *
 * 强化项与技能树（原有，不动）
 * ------------------------------------------------------------------ */
const STATS = {
  power: { name: '巨兽力量', base: 80, desc: '爪击、重踏与尾击伤害' },
  atomic: { name: '原子炉心', base: 95, desc: '吐息伤害与高能强度' },
  metabolism: { name: '核能代谢', base: 70, desc: '被动产能与破坏收益' },
  stride: { name: '巨躯动能', base: 90, desc: '行进速度与抗封锁能力' },
};

const SKILLS = [
  { id: 'impact', name: '震荡爪击', branch: 'kinetic', cost: 1, requires: null, desc: '爪击冲击相邻建筑，额外造成 40% 伤害' },
  { id: 'throw', name: '巨兽投掷', branch: 'kinetic', cost: 2, requires: 'impact', desc: '被拍飞的残骸撞击其他敌人，造成连锁爆破' },
  { id: 'seismic', name: '地脉崩解', branch: 'kinetic', cost: 3, requires: 'throw', desc: '重踏范围 +60%，建筑破坏伤害翻倍' },
  { id: 'pierce', name: '贯穿吐息', branch: 'atomic', cost: 1, requires: null, desc: '原子光束贯穿首个目标，追加攻击后方目标' },
  { id: 'chain', name: '电离连锁', branch: 'atomic', cost: 2, requires: 'pierce', desc: '光束命中后向附近军队传导电弧' },
  { id: 'meltdown', name: '红莲临界', branch: 'atomic', cost: 3, requires: 'chain', desc: '每第三次吐息转为红莲射线，伤害 ×2.5' },
  { id: 'harvest', name: '辐射汲取', branch: 'evolution', cost: 1, requires: null, desc: '所有核能获取 +25%，持续提高挂机收益' },
  { id: 'momentum', name: '不可阻挡', branch: 'evolution', cost: 2, requires: 'harvest', desc: '军队对前进速度的压制降低 40%' },
  { id: 'overdrive', name: '原始觉醒', branch: 'evolution', cost: 3, requires: 'momentum', desc: '技能冷却缩短 25%，离线收益效率提升至 90%' },
];

/* ------------------------------------------------------------------ *
 * 天赋网格：3 环 × 6 节点 × 3 级
 *
 * 三环有先后门槛（见 RING_GATE），这样"树"才真的成立 ——
 * 否则玩家会一上来就把 18 个点位摊平，体貌和元素都不会成形。
 * ------------------------------------------------------------------ */
const RING_GATE = [0, 4, 4];   // 开启本环所需的「上一环累计投入」

const TALENT_RINGS = [
  {
    key: 'morph', name: '体貌',
    desc: '直接改身体，每个节点都有可见的形状变化',
    nodes: [
      { id: 'mass', name: '巨躯', desc: '体型变大，近战判定同步放大' },
      { id: 'spines', name: '脊刺', desc: '背刺更多、更高，高级出现分叉' },
      { id: 'talons', name: '锐爪', desc: '前爪变长变弯，爪击判定变大' },
      { id: 'tailwhip', name: '长尾', desc: '尾巴更长，尾尖变形' },
      { id: 'carapace', name: '甲胄', desc: '鳞甲出现分块线，受击闪光变弱' },
      { id: 'jaws', name: '巨颌', desc: '牙列变长，吐息蓄力更快' },
    ],
  },
  {
    key: 'element', name: '元素',
    desc: '第一个点满 3 级的节点成为主元素，决定背刺与吐息的颜色',
    nodes: [
      { id: 'pyro', name: '赤焰', color: '#ff5a3c', desc: '吐息附带燃烧：3 秒内追加 25% 伤害' },
      { id: 'volt', name: '苍雷', color: '#a8d8ff', desc: '命中弹射 1 道电弧（50% 伤害）至最近单位' },
      { id: 'cryo', name: '冰棘', color: '#dff4ff', desc: '命中使目标减速 30%，持续 2 秒' },
      { id: 'venom', name: '腐毒', color: '#b58cff', desc: '破坏建筑时溅射毒雾（120px）' },
      { id: 'radiant', name: '辐热', color: '#7affd0', desc: '核能产出 +8% / 级' },
      { id: 'magma', name: '熔核', color: '#ff8a3c', desc: '体型额外 +3% / 级，躯干浮出熔岩裂纹' },
    ],
  },
  {
    key: 'instinct', name: '本能',
    desc: '不改外观，改行为与天气适应',
    nodes: [
      { id: 'hunter', name: '猎手嗅觉', desc: '优先锁定最容易造成压制的目标' },
      { id: 'stormcraft', name: '风暴适应', desc: '恶劣天气的速度惩罚减半' },
      { id: 'conductor', name: '雷暴导体', desc: '雷暴 / 磁暴天气下吐息伤害 +30%' },
      { id: 'rubblewalker', name: '废墟行者', desc: '建筑倒塌的额外收益 +15% / 级' },
      { id: 'nocturnal', name: '夜行', desc: '血月天气下核能产出 +20% / 级' },
      { id: 'sleepless', name: '无眠', desc: '离线收益效率 +5% / 级' },
    ],
  },
];

const TALENT_NODES = TALENT_RINGS.flatMap((ring) => ring.nodes.map((n) => ({ ...n, ring: ring.key })));
const TALENT_BY_ID = Object.fromEntries(TALENT_NODES.map((n) => [n.id, n]));

/* ------------------------------------------------------------------ *
 * 稀有度与骰面
 *
 * 骰子面上的点数就是稀有度，面的颜色就是稀有度色。落定那一刻不用读文字
 * 就知道中了什么。面出现的概率不均匀（1 面 34% 而 6 面 0.5%）——
 * 这叫灌铅，是唯一能同时满足"权重精确"和"骰子直觉"的做法。
 * ------------------------------------------------------------------ */
const RARITY = [
  { key: 'common', name: '常见', weight: 60, color: '#c8ccd4', faces: [1, 2], faceWeights: [34, 26] },
  { key: 'fine', name: '优良', weight: 25, color: '#7ddc8a', faces: [3], faceWeights: [25] },
  { key: 'rare', name: '稀有', weight: 11, color: '#6bb8ff', faces: [4], faceWeights: [11] },
  { key: 'epic', name: '史诗', weight: 3.5, color: '#c58cff', faces: [5], faceWeights: [3.5] },
  { key: 'legend', name: '传说', weight: 0.5, color: '#ffd76b', faces: [6], faceWeights: [0.5] },
];

const RARITY_BY_KEY = Object.fromEntries(RARITY.map((r) => [r.key, r]));
const FACE_WEIGHTS = RARITY.flatMap((r) => r.faces.map((face, i) => ({ face, rarity: r.key, w: r.faceWeights[i] })));

/* ------------------------------------------------------------------ *
 * 突变池
 *
 * 四类，占比决定抽到哪一类。稀有度只决定"效果量级"，
 * 类别决定"改的是数值、部位、元素还是形态"。
 * ------------------------------------------------------------------ */
const CATEGORY_SHARE = { stat: 55, part: 30, element: 12, trait: 3 };

const MUTATIONS = [
  /* 属性突变 —— 四项强化的等效免费加成 */
  // 属性等级只允许由核能强化或 assign 加点改变。突变只改变外观、元素和倍率，
  // 避免玩家未加点时 levels 自己增长。
  { id: 'm_power', name: '力量增生', cat: 'stat', rarity: 'common', desc: '破坏倍率 +4%', apply: (d) => { d.morph.dmgBoost = (d.morph.dmgBoost || 0) + 0.04; } },
  { id: 'm_atomic', name: '炉心膨胀', cat: 'stat', rarity: 'common', desc: '吐息倍率 +4%', apply: (d) => { d.morph.beamBoost = (d.morph.beamBoost || 0) + 0.04; } },
  { id: 'm_metab', name: '代谢加速', cat: 'stat', rarity: 'common', desc: '收益倍率 +4%', apply: (d) => { d.morph.energyBoost = (d.morph.energyBoost || 0) + 0.04; } },
  { id: 'm_stride', name: '步幅拓宽', cat: 'stat', rarity: 'common', desc: '速度倍率 +4%', apply: (d) => { d.morph.speedBoost = (d.morph.speedBoost || 0) + 0.04; } },
  { id: 'm_twin', name: '双生强化', cat: 'stat', rarity: 'fine', desc: '随机两项战斗倍率各 +3%', apply: (d, rng) => { const ks = ['dmgBoost', 'beamBoost', 'energyBoost', 'speedBoost']; const a = ks[Math.floor(rng() * ks.length)]; let b = a; while (b === a) b = ks[Math.floor(rng() * ks.length)]; d.morph[a] = (d.morph[a] || 0) + 0.03; d.morph[b] = (d.morph[b] || 0) + 0.03; } },
  { id: 'm_surge', name: '核能过载', cat: 'stat', rarity: 'rare', desc: '四项战斗倍率各 +3%', apply: (d) => { for (const k of ['dmgBoost', 'beamBoost', 'energyBoost', 'speedBoost']) d.morph[k] = (d.morph[k] || 0) + 0.03; } },
  { id: 'm_apex', name: '巅峰体质', cat: 'stat', rarity: 'epic', desc: '四项战斗倍率各 +6%', apply: (d) => { for (const k of ['dmgBoost', 'beamBoost', 'energyBoost', 'speedBoost']) d.morph[k] = (d.morph[k] || 0) + 0.06; } },

  /* 部位突变 —— 绑定一个骨骼部件，同时给数值和外观 */
  { id: 'p_spike1', name: '脊刺增生', cat: 'part', part: 'spikes', rarity: 'common', desc: '背刺 +2 根，重踏范围 +5%', apply: (d) => { d.morph.spikes += 2; d.morph.stompBoost = (d.morph.stompBoost || 0) + 0.05; } },
  { id: 'p_spike2', name: '脊刺加长', cat: 'part', part: 'spikes', rarity: 'fine', desc: '背刺高度 +20%，重踏范围 +8%', apply: (d) => { d.morph.spikeScale = (d.morph.spikeScale || 1) * 1.2; d.morph.stompBoost = (d.morph.stompBoost || 0) + 0.08; } },
  { id: 'p_tail', name: '尾节增生', cat: 'part', part: 'tail_mid', rarity: 'common', desc: '尾节 +1，尾扫范围 +6%', apply: (d) => { d.morph.tailSegs += 1; d.morph.tailBoost = (d.morph.tailBoost || 0) + 0.06; } },
  { id: 'p_tailtip', name: '尾尖硬化', cat: 'part', part: 'tail_tip', rarity: 'rare', desc: '尾尖变锤状，尾扫击退 +30%', apply: (d) => { d.morph.tailTip = 'hammer'; d.morph.tailBoost = (d.morph.tailBoost || 0) + 0.15; } },
  { id: 'p_claw', name: '爪裂增生', cat: 'part', part: 'forearm', rarity: 'fine', desc: '爪 +1 根，爪击伤害 +8%', apply: (d) => { d.morph.claws += 1; d.morph.clawBoost = (d.morph.clawBoost || 0) + 0.08; } },
  { id: 'p_jaw', name: '獠牙外翻', cat: 'part', part: 'jaw', rarity: 'common', desc: '撕咬范围 +10%', apply: (d) => { d.morph.jawBoost = (d.morph.jawBoost || 0) + 0.1; } },
  { id: 'p_horn', name: '头角萌生', cat: 'part', part: 'head', rarity: 'rare', desc: '头顶 +1 根角，吐息伤害 +6%', apply: (d) => { d.morph.horns += 1; d.morph.beamBoost = (d.morph.beamBoost || 0) + 0.06; } },
  { id: 'p_bulk', name: '躯干臃肿', cat: 'part', part: 'torso', rarity: 'common', desc: '体型 +1.5%，抗压制 +5%', apply: (d) => { d.morph.extraScale += 0.015; d.morph.pressResist = (d.morph.pressResist || 0) + 0.05; } },
  { id: 'p_thigh', name: '腿肌隆起', cat: 'part', part: 'thigh', rarity: 'common', desc: '行进速度 +4%', apply: (d) => { d.morph.speedBoost = (d.morph.speedBoost || 0) + 0.04; } },
  { id: 'p_scale', name: '鳞甲加厚', cat: 'part', part: 'torso', rarity: 'fine', desc: '受击闪光 -20%，鳞片分块 +1', apply: (d) => { d.morph.plates += 1; d.morph.hitFlash = Math.max(0, (d.morph.hitFlash ?? 1) - 0.2); } },
  { id: 'p_lidless', name: '无睑之眼', cat: 'part', part: 'head', rarity: 'rare', desc: '眼部发红光，暴击 +8%', apply: (d) => { d.morph.eyeGlow = true; d.morph.crit = (d.morph.crit || 0) + 0.08; } },
  { id: 'p_twin_tail', name: '双尾', cat: 'part', part: 'tail_base', rarity: 'epic', desc: '尾节 +2，尾扫范围 +25%', apply: (d) => { d.morph.tailSegs += 2; d.morph.tailBoost = (d.morph.tailBoost || 0) + 0.25; d.morph.twinTail = true; } },

  /* 元素突变 —— 给副特效，不改主色 */
  { id: 'e_spark', name: '鳞片导电', cat: 'element', rarity: 'fine', desc: '获得「苍雷」副特效', apply: (d) => { addSub(d, 'volt'); } },
  { id: 'e_ember', name: '鳞片蓄热', cat: 'element', rarity: 'fine', desc: '获得「赤焰」副特效', apply: (d) => { addSub(d, 'pyro'); } },
  { id: 'e_frost', name: '霜纹蔓延', cat: 'element', rarity: 'fine', desc: '获得「冰棘」副特效', apply: (d) => { addSub(d, 'cryo'); } },
  { id: 'e_glow', name: '辐射辉光', cat: 'element', rarity: 'rare', desc: '体表常驻辉光，核能 +10%', apply: (d) => { d.morph.aura = true; d.morph.energyBoost = (d.morph.energyBoost || 0) + 0.1; } },

  /* 质变突变 —— 改形态，最稀有的那档 */
  { id: 't_crimson', name: '赤化', cat: 'trait', rarity: 'legend', desc: '体色整体转红，所有伤害 +12%', apply: (d) => { d.morph.hue = 'crimson'; d.morph.dmgBoost = (d.morph.dmgBoost || 0) + 0.12; } },
  { id: 't_albino', name: '白化', cat: 'trait', rarity: 'legend', desc: '体色转苍白，吐息 +25%，近战 -10%', apply: (d) => { d.morph.hue = 'albino'; d.morph.beamBoost = (d.morph.beamBoost || 0) + 0.25; d.morph.meleePenalty = 0.1; } },
  { id: 't_colossal', name: '巨躯化', cat: 'trait', rarity: 'legend', desc: '体型 +12%，全部判定范围同步放大', apply: (d) => { d.morph.extraScale += 0.12; d.morph.colossal = (d.morph.colossal || 0) + 1; } },
  { id: 't_elemental', name: '元素化身', cat: 'trait', rarity: 'legend', desc: '主元素伤害 +40%，体表常驻元素粒子', apply: (d) => { d.morph.elemental = true; d.morph.elementBoost = 0.4; } },
  { id: 't_third_eye', name: '第三只眼', cat: 'trait', rarity: 'epic', desc: '头部新增发光眼，暴击 +10%', apply: (d) => { d.morph.thirdEye = true; d.morph.crit = (d.morph.crit || 0) + 0.1; } },

  /* —— 扩展的部位突变：更多背刺 / 颈盾 / 角 / 尾鳍 / 血瞳 数值组合 —— */
  { id: 'p_spike3', name: '脊刺晶化', cat: 'part', part: 'spikes', rarity: 'common', desc: '背刺 +3 根，重踏范围 +6%', apply: (d) => { d.morph.spikes += 3; d.morph.stompBoost = (d.morph.stompBoost || 0) + 0.06; } },
  { id: 'p_spike4', name: '脊刺分叉', cat: 'part', part: 'spikes', rarity: 'fine', desc: '背刺高度 +30%，重踏范围 +10%', apply: (d) => { d.morph.spikeScale = (d.morph.spikeScale || 1) * 1.3; d.morph.stompBoost = (d.morph.stompBoost || 0) + 0.1; } },
  { id: 'p_frill', name: '颈盾增生', cat: 'part', part: 'torso', rarity: 'rare', desc: '颈盾 +2 块，受击闪光 -15%', apply: (d) => { d.morph.plates += 2; d.morph.hitFlash = Math.max(0, (d.morph.hitFlash ?? 1) - 0.15); } },
  { id: 'p_horn2', name: '巨角丛生', cat: 'part', part: 'head', rarity: 'rare', desc: '头顶 +2 根角，吐息伤害 +8%', apply: (d) => { d.morph.horns += 2; d.morph.beamBoost = (d.morph.beamBoost || 0) + 0.08; } },
  { id: 'p_tailfin', name: '尾鳍增生', cat: 'part', part: 'tail_mid', rarity: 'fine', desc: '尾节 +1，尾扫范围 +8%', apply: (d) => { d.morph.tailSegs += 1; d.morph.tailBoost = (d.morph.tailBoost || 0) + 0.08; } },
  { id: 'p_eye3', name: '血瞳', cat: 'part', part: 'head', rarity: 'fine', desc: '双眼赤红，暴击 +6%', apply: (d) => { d.morph.eyeGlow = true; d.morph.crit = (d.morph.crit || 0) + 0.06; } },

  /* —— 扩展的元素副特效：喂给已有的主元素色与 laser/fire 外观 —— */
  { id: 'e_magma', name: '鳞片熔纹', cat: 'element', rarity: 'fine', desc: '获得「熔核」副特效', apply: (d) => { addSub(d, 'magma'); } },
  { id: 'e_venom', name: '鳞片渗毒', cat: 'element', rarity: 'fine', desc: '获得「腐毒」副特效', apply: (d) => { addSub(d, 'venom'); } },
  { id: 'e_radiant', name: '辐能辉耀', cat: 'element', rarity: 'rare', desc: '体表常驻强辉光，核能 +14%', apply: (d) => { d.morph.aura = true; d.morph.energyBoost = (d.morph.energyBoost || 0) + 0.14; } },

  /* —— 扩展的质变（皮肤 / 激光 / 火焰）：crimson/albino 之外再加玄黑、翠玉、炎狱、冰封 —— */
  { id: 't_jade', name: '翠化', cat: 'trait', rarity: 'epic', desc: '体色转为翠玉，受击闪光 -25%', apply: (d) => { d.morph.hue = 'jade'; d.morph.hitFlash = Math.max(0, (d.morph.hitFlash ?? 1) - 0.25); } },
  { id: 't_obsidian', name: '玄化', cat: 'trait', rarity: 'legend', desc: '体色转为玄黑，全伤害 +10%', apply: (d) => { d.morph.hue = 'obsidian'; d.morph.dmgBoost = (d.morph.dmgBoost || 0) + 0.1; } },
  { id: 't_inferno', name: '炎狱体', cat: 'trait', rarity: 'legend', desc: '体表常驻火焰，吐息 +30% 且附带燃烧', apply: (d) => { d.morph.hue = 'crimson'; addSub(d, 'pyro'); d.morph.aura = true; d.morph.beamBoost = (d.morph.beamBoost || 0) + 0.3; } },
  { id: 't_glacial', name: '冰封体', cat: 'trait', rarity: 'legend', desc: '体表常驻寒霜，获得「冰棘」且吐息 +20%', apply: (d) => { addSub(d, 'cryo'); d.morph.hue = 'jade'; d.morph.beamBoost = (d.morph.beamBoost || 0) + 0.2; } },
];

const MUTATION_BY_ID = Object.fromEntries(MUTATIONS.map((m) => [m.id, m]));

function addSub(d, key) {
  if (!Array.isArray(d.subElements)) d.subElements = [];
  if (!d.subElements.includes(key)) d.subElements.push(key);
}

/* ------------------------------------------------------------------ *
 * 确定性随机（铁律：外观绝不交给 Math.random）
 * ------------------------------------------------------------------ */
function hashSeed(seed, level) {
  let h = 2166136261 ^ (seed | 0);
  h = Math.imul(h ^ (level | 0), 16777619);
  return h >>> 0;
}

function mulberry32(a) {
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 天气只做加权，不改判定本身。weather 为 null 时全部系数取 1 ——
 * 本次只做成长，05-天气系统.md 落地后把真实的 weather 传进来即可。 */
const WEATHER_RARITY_BOOST = { bloodmoon: 1.3, silent: 1.5 };
const WEATHER_CAT_BIAS = { storm: { element: 1.5 }, bloodmoon: { trait: 1.4 } };

/* 返回按稀有度分组的权重表 [{key, w}]，合计总是 100。
 * 天气加成把「从常见面挪给高阶面」：高阶权重乘系数，常见权重吸收差额。 */
function rarityTableFor(weather) {
  const boost = weather && WEATHER_RARITY_BOOST[weather] ? WEATHER_RARITY_BOOST[weather] : 1;
  if (boost === 1) return RARITY.map((r) => ({ key: r.key, w: r.weight }));

  const base = RARITY.map((r) => r.weight);
  const hi = base.map((w, i) => (i === 0 ? w : w * boost));
  const hiTotal = hi.reduce((a, b) => a + b, 0);
  // 常见权重 = 100 - 高阶合计，保持总和不变
  const common = Math.max(0, 100 - (hiTotal - base[0]));
  return RARITY.map((r, i) => ({ key: r.key, w: i === 0 ? common : hi[i] }));
}

function pickWeighted(rng, items, weightOf) {
  const total = items.reduce((a, it) => a + weightOf(it), 0);
  let roll = rng() * total;
  for (const it of items) {
    roll -= weightOf(it);
    if (roll <= 0) return it;
  }
  return items[items.length - 1];
}

function pickCategory(rng, weather) {
  const bias = weather && WEATHER_CAT_BIAS[weather] ? WEATHER_CAT_BIAS[weather] : null;
  const cats = Object.keys(CATEGORY_SHARE);
  return pickWeighted(rng, cats, (c) => CATEGORY_SHARE[c] * (bias && bias[c] ? bias[c] : 1));
}

/* 抽一个突变。同一个 seed + level 永远得到同一个结果 —— 骰子动画不参与计算，
 * 它只是落在那个已经算好的面上。
 *
 * 两步：先按稀有度权重定稀有度，再在该稀有度的全部突变里按类别权重抽一个。
 * 类别和稀有度不是独立的（比如常见稀有度只有属性类突变），
 * 所以必须先定稀有度、再在它内部按类别挑，否则会出现不存在的组合。 */
/* 体征门槛：某个部位的突变，要等对应的体征解锁之后才可能被抽到。
 * 背鳍类（part === 'spikes'）绑 growth 的 15 级门槛 —— 老版本没有这道闸，
 * 低等级就能抽出"背刺 +3 根"，而那时按设计一根都不该有。
 * 单条数据想自己定门槛就加 minLevel。 */
function gateFor(m) {
  if (Number(m.minLevel) > 0) return Number(m.minLevel);
  return m.part === 'spikes' ? Growth.GATES.spines : 0;
}

function mutateFor(seed, level, weather, rarityOverride) {
  const rng = mulberry32(hashSeed(seed, level));
  const table = rarityOverride || rarityTableFor(weather);
  const rk = pickWeighted(rng, table, (row) => row.w).key;

  const byRarity = MUTATIONS.filter((m) => m.rarity === rk);
  /* 门槛过滤后若整个稀有度被清空（策划把门槛调太高时会这样），退回未过滤池，
   * 保证任何等级都抽得出东西 —— 空池会让"每级抽一次"静默失效。 */
  const gated = byRarity.filter((m) => level >= gateFor(m));
  const pool = gated.length ? gated : byRarity;
  const cat = pickCategory(rng, weather);
  const inCat = pool.filter((m) => m.cat === cat);
  const chosen = (inCat.length ? inCat : pool);
  const picked = chosen[Math.floor(rng() * chosen.length)];

  const face = RARITY_BY_KEY[picked.rarity].faces[0];
  return { ...picked, face, rarityInfo: RARITY_BY_KEY[picked.rarity] };
}

/* ------------------------------------------------------------------ *
 * 经验收益的区域缩放（06 §2.2）
 *
 * 这是前置修复：没有它，区域 10 以后升级会慢到几乎停滞，
 * 而"一章 5 关"的节拍要求大致每 3 个区域升一级。
 * ------------------------------------------------------------------ */
const Ke = (d) => 1 + (d - 1) * 0.19;      // 敌人经验系数
/* 建筑耐久与建筑经验共用区域强度系数，系数本身住在 growth.js —— 那边是
 * 攻防平衡的唯一真源（巨兽伤害乘同一个倍率）。这里**不再写第二份 0.22**：
 * 两处各写一份的话，策划案调其中一个就会让"拆楼效率"悄悄漂移。 */
const Kb = (d) => 1 + (d - 1) * Growth.DISTRICT.coef;   // 建筑耐久 / 经验系数
const xpPerEnemy = (d) => Math.round(12 * Ke(d));
const xpPerBuilding = (d, layer) => Math.round((layer === 1 ? 24 : 12) * Kb(d));
const xpPerDistrict = (d) => Math.round(60 * Ke(d));

/* ------------------------------------------------------------------ *
 * 离线经验折算
 *
 * 离线只结算被动产能（没有画面就没有击杀），但 XP 必须补 —— 等级是 dna /
 * 加点机会 / 进化机会 / 天赋点的唯一发钞口，等级一停，四条成长线一起饿死。
 *
 * 折算比 0.12 是实测标定出来的：出厂默认在线挂机 8 小时的 XP/核能 ≈ 0.131
 * （42,048 XP / 321,475 核能），取略低一档作为离线比，保证离线严格劣于在线。
 *
 * ⚠️ 不要在这里再乘 xpPerEnemy(district)。amount 已经随 passive() 和等级缩放，
 * 再乘一次区域单价就是双重缩放 —— 实测那样会把 8 小时离线顶到 LV115。
 * ------------------------------------------------------------------ */
const OFFLINE_XP_RATIO = 0.12;

/* ------------------------------------------------------------------ *
 * 体征期：每 25 级一个质变台阶，不单独存储，由 level 推导
 *
 * ⚠️ 这里**不写镜头值**。2026-09-18 之前每档带一个 camera（1.30/1.16/1.00），
 * 换场时画面会硬缩一档 —— L8 倒退 2.9%、L18 倒退 7.3%，而升一级只涨 1.5%。
 * 镜头真源是 growth.VIEW / growth.cameraScale()，本表只管行程与等级的解锁。
 * ------------------------------------------------------------------ */
const STAGES = [
  { key: 'village', name: '现代村庄', minMeters: 0, minLevel: 1, enemyTier: 0 },
  { key: 'suburb', name: '城郊防线', minMeters: 2600, minLevel: 8, enemyTier: 1 },
  { key: 'city', name: '城区核心', minMeters: 7200, minLevel: 18, enemyTier: 2 },
];
function stageIndexFor(data) {
  const meters = Number(data?.meters) || 0;
  const level = Number(data?.level) || 1;
  let i = 0;
  for (let n = 0; n < STAGES.length; n++) if (meters >= STAGES[n].minMeters && level >= STAGES[n].minLevel) i = n;
  return i;
}

/* 章节只由累计区域派生；纽约每五区开始新一轮，不影响成长建筑阶段或旧档。 */
const CHAPTERS = [
  {
    key: 'osaka', number: 1, name: '大阪', title: '第一章 · 大阪',
    sky: ['#160e2c', '#493354', '#b07763'], skyline: ['#35283f', '#52354a', '#654351'],
    skyTime: 'dusk', weather: { key: 'rain', label: '黄昏细雨', color: '#8dc6ef', density: 0.62, lightning: false },
    wall: '#8b766c', accent: '#ffad68', road: '#343044', water: '#254854',
    landmarks: ['大阪城', '通天阁', '道顿堀霓虹'],
    districts: [
      { name: '城下町', color: '#dfc781', signs: ['城下食堂', 'OSAKA', '茶屋'] },
      { name: '通天阁商店街', color: '#ffa260', signs: ['通天阁', '串烧', '新世界'] },
      { name: '道顿堀灯街', color: '#ff70af', signs: ['道顿堀', '章鱼烧', '霓虹剧场'] },
      { name: '中之岛水岸', color: '#66d6c5', signs: ['中之岛', '河畔咖啡', '水岸书店'] },
      { name: '大阪港仓库街', color: '#ffc56e', signs: ['大阪港', '港湾仓库', 'OSAKA PORT'] },
    ],
  },
  {
    key: 'tokyo', number: 2, name: '东京', title: '第二章 · 东京',
    sky: ['#07112f', '#18366a', '#586a97'], skyline: ['#132344', '#20385b', '#304c75'],
    skyTime: 'night', weather: { key: 'storm', label: '午夜雷暴', color: '#84dfff', density: 1, lightning: true },
    wall: '#3c5675', accent: '#75cfff', road: '#172c49', water: '#163e68',
    landmarks: ['东京塔', '高架轨道', '新宿霓虹'],
    districts: [
      { name: '浅草灯笼街', color: '#ff8d75', signs: ['浅草', '灯笼商店', 'TOKYO'] },
      { name: '秋叶原电器街', color: '#74ddff', signs: ['秋叶原', 'RADIO', '电器街'] },
      { name: '新宿高架街', color: '#d895ff', signs: ['新宿', 'NEON', '歌舞伎町'] },
      { name: '芝公园塔街', color: '#ff9566', signs: ['芝公园', '东京塔', 'TOWER'] },
      { name: '湾岸货运区', color: '#80e4df', signs: ['湾岸', 'TOKYO BAY', '货运站'] },
    ],
  },
  {
    key: 'newyork', number: 3, name: '纽约', title: '第三章 · 纽约',
    sky: ['#101c2a', '#34515e', '#b5a183'], skyline: ['#22333e', '#364651', '#4e5b61'],
    skyTime: 'dawn', weather: { key: 'fog', label: '清晨浓雾', color: '#d4ddd2', density: 0.42, lightning: false },
    wall: '#7b685c', accent: '#ffd379', road: '#2b3037', water: '#364e5c',
    landmarks: ['阶梯天际线', '帝国大厦', '钢桥'],
    districts: [
      { name: '布鲁克林桥街', color: '#8dcacb', signs: ['BROOKLYN', 'BRIDGE', 'DELI'] },
      { name: '华尔街石楼区', color: '#d1bf91', signs: ['WALL ST', 'COFFEE', 'EXCHANGE'] },
      { name: '时代广场灯街', color: '#ffb26b', signs: ['TIMES SQ', 'BROADWAY', 'ARCADE'] },
      { name: '中城摩天楼区', color: '#ffdc91', signs: ['MIDTOWN', 'EMPIRE', 'HOTEL'] },
      { name: '哈德逊码头', color: '#90bcd5', signs: ['HUDSON', 'PIER 05', 'WAREHOUSE'] },
    ],
  },
];
function chapterFor(district) {
  return CHAPTERS[district >= 11 ? 2 : district >= 6 ? 1 : 0];
}
function routeFor(district, progress = 0) {
  const chapter = chapterFor(district), index = (district - 1) % 5;
  const start = district - index, round = Math.floor((start - (chapter.number - 1) * 5 - 1) / 5) + 1;
  const nextDistrict = district + 1, nextChapter = chapterFor(nextDistrict);
  return {
    chapter, district, index, round, start, street: chapter.districts[index],
    progress: Math.max(0, Math.min(1, progress)),
    nodes: chapter.districts.map((street, i) => ({ ...street, district: start + i, state: i < index ? 'cleared' : i === index ? 'current' : 'ahead' })),
    nextDistrict, nextChapter, nextStreet: nextChapter.districts[(nextDistrict - 1) % 5],
  };
}

/* 形态阶梯。scale 是**本档的体型区间**，由 growth.baseScale() 在区间内按等级
 * 线性插值 —— 这是体型的唯一出处，渲染层不再有第二套公式。
 *   幼兽   1 → 25   0.34 → 0.58     1 级 = 0.34（初始体型）
 *   亚成体 25 → 50   0.58 → 0.76
 *   成体   50 → 75   0.76 → 0.90
 *   完全体 75 → 100  0.90 → 1.00
 *   灾厄体 100+      1.00（基础到此饱和，之后靠天赋/突变）
 * 区间必须首尾相接（上一档 hi == 下一档 lo），否则跨档时体型会跳变。
 * 背鳍根数**不在**这里 —— 它由 growth.spineCount() 按等级给，15 级才解锁；
 * 老版本这个字段是 3/5/6/7/9，等于 1 级就长背鳍，已移除以免出现第二个真源。 */
const EPOCHS = [
  { name: '幼兽', min: 1, scale: [0.34, 0.58], color: '#2f4d3a' },
  { name: '亚成体', min: 25, scale: [0.58, 0.76], color: '#38573f', fork: true },
  { name: '成体', min: 50, scale: [0.76, 0.90], color: '#4a5a3c', fork: true, elemental: true },
  { name: '完全体', min: 75, scale: [0.90, 1.00], color: '#6b5436', fork: true, elemental: true, texture: true },
  /* 灾厄体：末档。上限 1.60 是 2026-09-18 主人要的"满级极限翻倍"落地处 ——
   * 它在 growth.js 的 END_SPAN（60 级）里走完，即 L100=1.00 → L160=1.60，
   * 之后饱和。改这个数之前先看 growth.js 里 VIEW.ceiling 那张像素对照表：
   * 体型 1.5692 以上屏幕表观就吃满 2.04，再往上加只会被镜头抵消，画面不变。 */
  { name: '灾厄体', min: 100, scale: [1.00, 1.60], color: '#7a4a2c', fork: true, elemental: true, texture: true, aura: true },
];

const epochIndexFor = (level) => {
  let i = 0;
  for (let k = 0; k < EPOCHS.length; k++) if (level >= EPOCHS[k].min) i = k;
  return i;
};

/* 体型缩放。锚点是脚底（见 rig.js 的 pose()/scaleRig()），系数上限 CEIL=2.24
 * （2026-09-18 随"满级极限翻倍"一起翻倍）。⚠️ 屏幕放不放得下**不归它管**：
 * 那道线是 growth.VIEW.ceiling，由镜头反向收敛兜住。
 * 本函数只是转发 —— 老实现自带的 1.80 上限与渲染层从来不调用它，是第二套
 * 只好看不好用的公式，已删除。 */
function globalScaleFor(level, talents, morph) {
  return Growth.bodyScale(level, talents, morph, EPOCHS);
}

/* ------------------------------------------------------------------ *
 * 存档
 * ------------------------------------------------------------------ */
const MUTATION_SHAPE = () => ({
  spikes: 0, spikeScale: 1, tailSegs: 0, tailTip: null, claws: 0, horns: 0,
  plates: 0, eyeGlow: false, thirdEye: false, aura: false, twinTail: false,
  hue: null, elemental: false, colossal: 0, extraScale: 0,
});

const defaults = () => ({
  version: 4,
  energy: 180, earned: 0, xp: 0, level: 1, dna: 0,
  district: 1, cleared: 0, kills: 0, meters: 0,
  levels: { power: 1, atomic: 1, metabolism: 1, stride: 1 },
  skills: [],
  /* auto 默认开。这是"摆在那里自己玩"的产品形态：默认关掉等于让全新用户挂机
   * 八小时回来看见一只强化全 1 级、技能 0 个、突变 0 个的巨兽（实测 LV13 / 城区 31，
   * 而同一段时间开着托管是 LV28 / 城区 184）。
   * 注意 assign（加点机会）仍然不自动花 —— 见 autoSpend() 里的说明。 */
  auto: true, policy: 'balanced', muted: true,
  lastSeen: Date.now(), world: null,
  // —— 本次新增 ——
  talent: 0,               // 天赋点余额
  talents: {},             // { id: level }
  assign: 0,               // 可用加点机会
  evoRolls: 0,             // 可用进化机会
  mutations: [],           // 已获得突变 id，按获得顺序
  seed: hashSeed(0, 1),    // 新档立即固定；避免首次重启按变化后的击杀/里程重新派生
  rerolls: 0,              // 已用重掷次数，用于定价
  morph: MUTATION_SHAPE(), // 外观快照（见 06 §5.4：可以推演，但必须落盘）
  talentResets: 0,         // 天赋重置次数，用于定价
  subElements: [],         // 副元素（不改主色）
});

const finite = (v, d, min = 0, max = 1e15) => (Number.isFinite(+v) ? Math.min(max, Math.max(min, +v)) : d);

/* ⚠️ 这里是最容易犯致命错误的地方。
 *
 * 只把版本号改成 4 就等于把所有旧档判废、回落成 1 级 —— 玩家几个月的进度
 * 一次性归零，而且不会报任何错。所以 3 和 4 都必须认，认了之后就地补齐新字段。
 *
 * seed 的派生也必须确定性：用旧档里已有的、当时就稳定的字段算，
 * 绝不能用 Date.now() 或 Math.random()。 */
function sanitize(raw) {
  const a = defaults();
  if (!raw || (raw.version !== 3 && raw.version !== 4)) return a;

  for (const k of ['energy', 'earned', 'xp', 'level', 'dna', 'district', 'cleared', 'kills', 'meters']) {
    a[k] = finite(raw[k], a[k], (k === 'level' || k === 'district') ? 1 : 0);
  }
  a.level = Math.floor(a.level);
  a.district = Math.floor(a.district);
  a.dna = Math.floor(a.dna);

  for (const k in STATS) a.levels[k] = Math.floor(finite(raw.levels && raw.levels[k], 1, 1, 500));

  a.skills = SKILLS.filter((s) => Array.isArray(raw.skills) && raw.skills.includes(s.id)).map((s) => s.id);
  /* 旧档没写过 auto 字段时，跟随产品默认（开）；显式关过（存了 false）才保持关。
   * 用 !== false 而不是 === true：后者会把所有 version 3/4 老档一律判成关闭。 */
  a.auto = raw.auto !== false;
  a.policy = ['balanced', 'kinetic', 'atomic', 'evolution'].includes(raw.policy) ? raw.policy : 'balanced';
  a.muted = raw.muted !== false;
  a.lastSeen = finite(raw.lastSeen, Date.now(), 0, Date.now());
  a.world = raw.world && typeof raw.world === 'object' ? raw.world : null;

  // —— 新增字段：老档没有就补默认值，有就钳制 ——
  a.talent = Math.floor(finite(raw.talent, 0, 0, 1e9));
  a.assign = Math.floor(finite(raw.assign, 0, 0, 1e9));
  a.evoRolls = Math.floor(finite(raw.evoRolls, 0, 0, 1e9));
  a.rerolls = Math.floor(finite(raw.rerolls, 0, 0, 1e9));
  a.talentResets = Math.floor(finite(raw.talentResets, 0, 0, 1e9));

  a.talents = {};
  if (raw.talents && typeof raw.talents === 'object') {
    for (const id in raw.talents) {
      if (TALENT_BY_ID[id]) a.talents[id] = Math.floor(finite(raw.talents[id], 0, 0, 3));
    }
  }

  a.mutations = Array.isArray(raw.mutations) ? raw.mutations.filter((id) => !!MUTATION_BY_ID[id]) : [];

  // seed 只在此刻派生一次；派生后立即被调用方落盘，之后永远从存档读
  const derived = hashSeed(a.cleared * 7919 + a.kills * 104729 + Math.round(a.meters), a.level);
  a.seed = finite(raw.seed, derived, 0, 4294967295) >>> 0;
  if (!a.seed) a.seed = derived;

  a.subElements = Array.isArray(raw.subElements)
    ? raw.subElements.filter((k) => TALENT_BY_ID[k] && TALENT_BY_ID[k].ring === 'element')
    : [];

  // 外观快照：老档没有就按空的推一遍
  a.morph = { ...MUTATION_SHAPE(), ...(raw.morph && typeof raw.morph === 'object' ? raw.morph : {}) };
  a.morph.plates = Math.floor(finite(a.morph.plates, 0, 0, 9));
  a.morph.spikes = Math.floor(finite(a.morph.spikes, 0, 0, 60));
  a.morph.spikeScale = finite(a.morph.spikeScale, 1, 1, 1.6);
  a.morph.tailSegs = Math.floor(finite(a.morph.tailSegs, 0, 0, 9));
  a.morph.claws = Math.floor(finite(a.morph.claws, 0, 0, 9));
  a.morph.horns = Math.floor(finite(a.morph.horns, 0, 0, 9));

  return a;
}

/* ------------------------------------------------------------------ *
 * Economy
 * ------------------------------------------------------------------ */
class Economy {
  constructor(raw) {
    this.data = sanitize(raw);
    this.autoClock = 0;
    this.events = [];
  }

  has(id) { return this.data.skills.includes(id); }
  /* mult() 是**收益**的等级膨胀（挂机核能），与攻击力无关 —— 见下面两条。 */
  mult() { return 1 + (this.data.level - 1) * 0.07; }
  passive() { return (2.5 + this.data.levels.metabolism * 1.4) * this.mult() * (this.has('harvest') ? 1.25 : 1) * (1 + (this.data.morph.energyBoost || 0)); }
  rewardMult() { return (1 + (this.data.levels.metabolism - 1) * 0.12) * (this.has('harvest') ? 1.25 : 1); }
  /* 攻击力：不再随等级膨胀。老公式乘了 mult() = 1+(L-1)*0.07，50 级时是初始的
   * 4.4 倍 —— "1 级就是初始攻击力"这句话在数值上根本不成立。
   * 改由**区域推进**驱动，系数与建筑 HP 的 Kb 同源（见 growth.COMBAT），
   * 推图时伤害跟着涨、后期不会打不动；等级则只负责体型。
   * 想回退旧行为：把 growth.js 的 COMBAT.levelScaling 打开即可。 */
  power() { return (54 + this.data.levels.power * 22) * Growth.levelMult(this.data.level) * Growth.districtScale(this.data.district) * (1 + (this.data.morph.dmgBoost || 0)); }
  atomic() { return (85 + this.data.levels.atomic * 30) * Growth.levelMult(this.data.level) * Growth.districtScale(this.data.district) * (1 + (this.data.morph.beamBoost || 0)); }
  speed() { return (30 + Math.sqrt(this.data.levels.stride) * 8) * (1 + (this.data.morph.speedBoost || 0)); }
  nextXP() { return Math.round(260 * Math.pow(this.data.level, 1.28)); }
  cost(key) { return Math.round(STATS[key].base * Math.pow(1.22, this.data.levels[key] - 1)); }

  /* —— 体征期与体型 —— */
  epochIndex() { return epochIndexFor(this.data.level); }
  epoch() { return EPOCHS[this.epochIndex()]; }
  globalScale() { return globalScaleFor(this.data.level, this.data.talents, this.data.morph); }

  /* 升级：+1 dna、+1 加点机会、+1 进化机会；每 3 级再 +1 天赋点。
   * 全部发放在这里，与 dna 同一处 —— 散到各处迟早漏一个。 */
  gain(n, xp = 0) {
    const d = this.data;
    d.energy += n; d.earned += n; d.xp += xp;
    let guard = 0;
    while (d.xp >= this.nextXP() && guard++ < 100) {
      d.xp -= this.nextXP();
      d.level++;
      d.dna++;
      d.assign++;
      d.evoRolls++;
      if (d.level % 3 === 0) d.talent++;
      if (d.level === 25 || d.level === 50 || d.level === 75 || d.level === 100) d.evoRolls++;
      this.events.push({ type: 'evolution', level: d.level, epoch: this.epochIndex() });
    }
  }

  upgrade(key) {
    if (!STATS[key] || this.data.levels[key] >= 500) return false;
    const cost = this.cost(key);
    if (this.data.energy < cost) return false;
    this.data.energy -= cost;
    this.data.levels[key]++;
    this.events.push({ type: 'upgrade', key, level: this.data.levels[key] });
    return true;
  }

  /* 加点：花一次白给的机会，不看核能。这是"升级这个动作终于有了直接产出"。
   * 与 upgrade() 分工清楚：加点保底，核能加速。 */
  assignPoint(key) {
    if (!STATS[key] || this.data.assign <= 0 || this.data.levels[key] >= 500) return false;
    this.data.assign--;
    this.data.levels[key]++;
    this.events.push({ type: 'assign', key, level: this.data.levels[key] });
    return true;
  }

  /* 一键均分：价格最低优先 —— 和 chooseUpgrade() 的思路一致，
   * 把机会用在最便宜的地方，边际收益最大。 */
  assignSpread() {
    let used = 0;
    while (this.data.assign > 0) {
      const order = Object.keys(STATS).sort((a, b) => this.cost(a) - this.cost(b));
      let moved = false;
      for (const k of order) if (this.assignPoint(k)) { used++; moved = true; break; }
      if (!moved) break;
    }
    return used;
  }

  unlock(id) {
    const s = SKILLS.find((x) => x.id === id);
    if (!s || this.has(id) || this.data.dna < s.cost || (s.requires && !this.has(s.requires))) return false;
    this.data.dna -= s.cost;
    this.data.skills.push(id);
    this.events.push({ type: 'skill', id });
    return true;
  }

  chooseUpgrade() {
    const d = this.data;
    const priority = d.policy === 'kinetic' ? ['power', 'stride', 'atomic', 'metabolism']
      : d.policy === 'atomic' ? ['atomic', 'metabolism', 'power', 'stride']
      : d.policy === 'evolution' ? ['metabolism', 'stride', 'power', 'atomic']
      : ['power', 'atomic', 'metabolism', 'stride'];
    return priority.map((k, i) => ({ k, weight: this.cost(k) * (d.policy === 'balanced' ? 1 : i === 0 ? 0.55 : i === 1 ? 0.85 : 1.3) }))
      .sort((a, b) => a.weight - b.weight)[0].k;
  }

  autoSpend() {
    const d = this.data;
    if (d.auto) {
      // 托管只负责技能树，不得偷偷替玩家提升四项属性。
      // 属性的唯一增长来源是升级发放的 assign，以及玩家主动加点。
      const policy = d.policy;
      const choices = SKILLS.filter((s) => !this.has(s.id) && (!s.requires || this.has(s.requires)))
        .sort((a, b) => (policy === a.branch ? -10 : 0) + a.cost - ((policy === b.branch ? -10 : 0) + b.cost));
      for (const s of choices) if (this.unlock(s.id)) break;
    }
    // 加点机会与进化机会都保留给玩家。升级后必须看得见余额增加，不能在
    // 下一次托管 tick 里被自动消费；随机突变也不能成为属性暗增入口。
  }

  tick(dt) {
    this.gain(this.passive() * dt);
    this.autoClock += dt;
    if (this.autoClock >= 3) { this.autoClock %= 3; this.autoSpend(); }
  }

  /* —— 天赋 —— */
  ringInvested(ringKey) {
    const ring = TALENT_RINGS.find((r) => r.key === ringKey);
    if (!ring) return 0;
    return ring.nodes.reduce((sum, n) => sum + (this.data.talents[n.id] || 0), 0);
  }

  /* 环的开启门槛：上一环累计投入够数才开。第 1 环永远开。 */
  ringUnlocked(ringKey) {
    const idx = TALENT_RINGS.findIndex((r) => r.key === ringKey);
    if (idx <= 0) return true;
    return this.ringInvested(TALENT_RINGS[idx - 1].key) >= RING_GATE[idx];
  }

  talentUpgrade(id) {
    const node = TALENT_BY_ID[id];
    if (!node) return false;
    if (!this.ringUnlocked(node.ring)) return false;
    const cur = this.data.talents[id] || 0;
    if (cur >= 3 || this.data.talent <= 0) return false;
    this.data.talent--;
    this.data.talents[id] = cur + 1;
    this.events.push({ type: 'talent', id, level: cur + 1 });
    return true;
  }

  /* 主元素：元素环里第一个点满 3 级的节点。之后其他元素节点仍可点，
   * 只给副特效、不改主色 —— 这是整套设计里最重要的那个外观开关。 */
  mainElement() {
    for (const id of Object.keys(this.data.talents)) {
      const node = TALENT_BY_ID[id];
      if (node && node.ring === 'element' && this.data.talents[id] >= 3) return id;
    }
    return null;
  }

  talentResetCost() {
    return this.data.talentResets === 0 ? 0 : Math.round(2000 * Math.pow(1.8, this.data.talentResets));
  }

  talentReset() {
    const cost = this.talentResetCost();
    if (this.data.energy < cost) return false;
    this.data.energy -= cost;
    this.data.talentResets++;
    let refunded = 0;
    for (const id in this.data.talents) { refunded += this.data.talents[id]; delete this.data.talents[id]; }
    this.data.talent += refunded;
    this.events.push({ type: 'talentReset', refunded });
    return true;
  }

  /* —— 随机突变 —— */
  rerollCost() { return Math.round(5000 * Math.pow(1.6, this.data.rerolls)); }

  /* 抽一次并用掉一次机会。结果由 seed + level 确定性派生，
   * 骰子动画不参与计算 —— 它只是落在那个已经算好的面上。 */
  rollEvolution(weather) {
    const d = this.data;
    if (d.evoRolls <= 0) return null;

    // 同一级重掷要换一个结果，所以把「已抽过的次数」混进种子，
    // 但仍然只依赖确定性输入，不用 Math.random。
    const attempt = d.mutations.length;
    const seed = (d.seed ^ Math.imul(attempt + 1, 2654435761)) >>> 0;
    const picked = mutateFor(seed, d.level, weather || null);
    const rng = mulberry32(hashSeed(seed, d.level));

    d.evoRolls--;
    picked.apply(d, rng);
    d.mutations.push(picked.id);
    // 关键约束：先落盘再播动画。动画途中关面板，结果也已经在存档里
    this.events.push({ type: 'mutation', id: picked.id, rarity: picked.rarity, level: d.level });

    return {
      mutationId: picked.id, name: picked.name, desc: picked.desc,
      rarity: picked.rarity, rarityName: picked.rarityInfo.name,
      color: picked.rarityInfo.color, face: picked.face, part: picked.part || null,
      level: d.level,
    };
  }

  /* 最近 N 条进化记录，给面板的「最近进化」用。
   * 只反查 id → 突变定义，不重算随机。 */
  recentMutations(n = 20) {
    return this.data.mutations.slice(-n).reverse().map((id) => {
      const m = MUTATION_BY_ID[id];
      return m ? { id, name: m.name, desc: m.desc, rarity: m.rarity, rarityName: RARITY_BY_KEY[m.rarity].name, color: RARITY_BY_KEY[m.rarity].color, face: RARITY_BY_KEY[m.rarity].faces[0] } : null;
    }).filter(Boolean);
  }

  offline(now) {
    const seconds = Math.min(8 * 3600, Math.max(0, (now - this.data.lastSeen) / 1000));
    this.data.lastSeen = now;
    if (seconds < 10) return null;
    let efficiency = this.has('overdrive') ? 0.9 : 0.65;
    // 无眠：离线效率 +5%/级，与原始觉醒的 90% 对齐，封顶 100%
    efficiency = Math.min(1, efficiency + 0.05 * (this.data.talents.sleepless || 0));
    const rate = this.passive() + 7 * this.rewardMult();
    const amount = seconds * rate * efficiency;
    const xp = Math.round(amount * OFFLINE_XP_RATIO);
    this.gain(amount, xp);
    return { seconds, amount, xp, efficiency, capped: seconds >= 8 * 3600 };
  }

  serialize(now, world) {
    this.data.lastSeen = now;
    if (world) this.data.world = world;
    return JSON.stringify(this.data);
  }
}

const api = {
  Economy, STATS, SKILLS, defaults, sanitize,
  TALENT_RINGS, TALENT_NODES, TALENT_BY_ID, RING_GATE,
  MUTATIONS, MUTATION_BY_ID, RARITY, RARITY_BY_KEY, FACE_WEIGHTS, CATEGORY_SHARE,
  Growth, EPOCHS, STAGES, stageIndexFor, epochIndexFor, globalScaleFor, CHAPTERS, chapterFor, routeFor,
  hashSeed, mulberry32, mutateFor, rarityTableFor,
  Ke, Kb, xpPerEnemy, xpPerBuilding, xpPerDistrict,
};

if (typeof module !== 'undefined') module.exports = api;
else root.IdleProgression = api;
})(typeof window !== 'undefined' ? window : this);
