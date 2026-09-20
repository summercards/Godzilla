/* 突变视觉对账（审计脚本，非门禁用例）
 *
 * 逐条 apply 每个突变到空白 morph，记录它到底改了哪些字段，
 * 再按「谁在消费这个字段」给每条突变判定视觉效果是否真的落地。
 *
 * 消费表（改这里必须同时改代码，否则这张表会骗人）：
 *   VISUAL  —— 屏幕上真的会变
 *   READOUT —— 只在全息图/面板文字里出现
 *   DEAD    —— 全项目零引用
 */
'use strict';

const path = require('path');
const P = require(path.join(__dirname, '..', 'progression.js'));

/* 字段 → 消费者。注释里写明消费点，方便复核。 */
const CONSUMER = {
  // —— 视觉：真的画出来 ——
  spikes:     ['VISUAL', 'rig.js FinRenderer.draw() 用 spec.count 定根数'],
  spikeScale: ['VISUAL', 'rig.js FinRenderer.draw() 用 spec.heightScale/fork 定高度与分叉'],
  horns:      ['VISUAL', 'game.js drawMorph:576 / drawHologramDecor:762 画头角'],
  plates:     ['VISUAL', 'game.js drawMorph:579 / :765 画鳞甲分块（只看 on，count 未用）'],
  eyeGlow:    ['VISUAL', 'game.js drawMorph:577 画眼部红光'],
  thirdEye:   ['VISUAL', 'game.js drawMorph:578 画第三只眼'],
  aura:       ['VISUAL', 'game.js drawMorph:580 画辉光粒子'],
  twinTail:   ['VISUAL', 'game.js drawMorph:582 在尾尖镜像出第二尾'],
  hue:        ['VISUAL', 'appearance.js skinFor() 换全身皮肤贴图 + PALETTES 叠色'],
  extraScale: ['VISUAL', 'growth.js growFactor():89 进 bodyScale'],
  colossal:   ['VISUAL', 'growth.js growFactor():88 每层 +3% 体型'],

  // —— 只在文字里出现 ——
  claws:      ['READOUT', 'appearance.js decor() 出 claw.count；game.js 仅 :879 全息读数用，画面不画'],

  // —— 全项目零引用 ——
  tailSegs:   ['DEAD', '全项目零引用（尾节数量从未参与绘制）'],
  tailTip:    ['DEAD', '全项目零引用（"尾尖变锤状" 从未绘制）'],
  elemental:  ['DEAD', '全项目零引用（"体表常驻元素粒子" 从未绘制）'],

  // —— 数值向，本来就不承诺外观 ——
  dmgBoost:    ['NUM', 'progression.js power():549'],
  beamBoost:   ['NUM', 'progression.js atomic():550'],
  energyBoost: ['NUM', 'progression.js passive():542'],
  speedBoost:  ['NUM', 'progression.js speed():551'],
  stompBoost:  ['NUM', 'growth.js spineBonus():200'],
  tailBoost:   ['NUM-DEAD', '全项目零引用'],
  clawBoost:   ['NUM-DEAD', '全项目零引用'],
  jawBoost:    ['NUM-DEAD', '全项目零引用'],
  pressResist: ['NUM-DEAD', '全项目零引用'],
  crit:        ['NUM-DEAD', '全项目零引用'],
  meleePenalty:['NUM-DEAD', '全项目零引用'],
  elementBoost:['NUM-DEAD', '全项目零引用'],
  hitFlash:    ['NUM-DEAD', '全项目零引用（写了 3 处，读 0 处）'],
};

/* subElements 的消费是逐 key 的，不能按整体看 */
const SUB_CONSUMER = {
  pyro:  ['VISUAL', 'game.js updateBeam():329 命中→火焰吐息分支'],
  volt:  ['NUM-DEAD', '全项目零引用'],
  cryo:  ['NUM-DEAD', '全项目零引用'],
  venom: ['NUM-DEAD', '全项目零引用'],
  magma: ['NUM-DEAD', '全项目零引用'],
  radiant:['NUM-DEAD', '全项目零引用（radiant 的辉光由 aura 字段负责，不是这个 key）'],
};

const blank = () => ({
  morph: {
    spikes: 0, spikeScale: 1, tailSegs: 0, tailTip: null, claws: 0, horns: 0,
    plates: 0, eyeGlow: false, thirdEye: false, aura: false, twinTail: false,
    hue: null, elemental: false, colossal: 0, extraScale: 0,
  },
  subElements: [],
});

function applyOne(mu) {
  let seed = 12345;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const d = blank();
  mu.apply(d, rng);
  return d;
}

function diff(mu) {
  const d = applyOne(mu);
  const a = blank();
  const out = [];
  for (const k of new Set([...Object.keys(a.morph), ...Object.keys(d.morph)])) {
    if (JSON.stringify(a.morph[k]) !== JSON.stringify(d.morph[k])) {
      out.push({ field: k, from: a.morph[k], to: d.morph[k] });
    }
  }
  for (const s of d.subElements) if (!a.subElements.includes(s)) out.push({ field: 'subElements', from: null, to: s });
  return out;
}

const GRADE_RANK = { VISUAL: 0, READOUT: 1, NUM: 2, 'NUM-DEAD': 3, DEAD: 4, UNKNOWN: 5 };

/* 判定分三档：
 *   visual   至少有一个字段真的改变了屏幕画面
 *   numeric  画面不变，但至少有一个数值真的被读了（玩家能从战斗力感受到）
 *   inert    画面不变、数值也没人读 —— 这条突变抽到等于没抽
 */
function verdictOf(graded) {
  const hasVisual = graded.some((g) => g.grade === 'VISUAL');
  const hasNumeric = graded.some((g) => g.grade === 'NUM');
  if (hasVisual) return hasNumeric ? 'visual+numeric' : 'visual';
  if (hasNumeric) return 'numeric';
  return 'inert';
}

function audit() {
  const rows = [];
  for (const mu of P.MUTATIONS) {
    const deltas = diff(mu);
    const graded = deltas.map((d) => {
      const c = d.field === 'subElements'
        ? (SUB_CONSUMER[d.to] || ['UNKNOWN', '未登记的副元素 key'])
        : (CONSUMER[d.field] || ['UNKNOWN', '未登记的 morph 字段']);
      return { ...d, grade: c[0], why: c[1] };
    });
    const worst = graded.reduce((w, g) => (GRADE_RANK[g.grade] > GRADE_RANK[w] ? g.grade : w), 'VISUAL');
    /* 只列"没生效"的字段，报告里那才是要看的 */
    const dead = graded.filter((g) => g.grade === 'DEAD' || g.grade === 'NUM-DEAD' || g.grade === 'READOUT');
    rows.push({ id: mu.id, name: mu.name, cat: mu.cat, rarity: mu.rarity, deltas: graded, dead, worst, verdict: verdictOf(graded) });
  }
  return rows;
}

module.exports = { audit, CONSUMER, SUB_CONSUMER, GRADE_RANK };

if (require.main === module) {
  const rows = audit();
  console.log('突变总数:', P.MUTATIONS.length);
  const byVerdict = {};
  const byRarity = {};
  for (const r of rows) {
    byVerdict[r.verdict] = (byVerdict[r.verdict] || 0) + 1;
    const key = r.rarity + '/' + r.verdict;
    byRarity[key] = (byRarity[key] || 0) + 1;
  }
  console.log('判定分布:', JSON.stringify(byVerdict));
  console.log('稀有度×判定:', JSON.stringify(byRarity));
  console.log('');
  console.log('=== 画面真的会变的 ===');
  for (const r of rows) if (r.verdict.startsWith('visual')) console.log(`  ${r.id}\t${r.name}\t${r.rarity}`);
  console.log('');
  console.log('=== 只有数值生效，画面不变的 ===');
  for (const r of rows) if (r.verdict === 'numeric') console.log(`  ${r.id}\t${r.name}\t${r.rarity}`);
  console.log('');
  console.log('=== 完全失效：抽到等于没抽 ===');
  for (const r of rows) if (r.verdict === 'inert') console.log(`  ${r.id}\t${r.name}\t${r.rarity}\t${r.dead.map((d) => d.field).join(',')}`);
  console.log('');
  console.log('=== 每条突变的失效字段明细 ===');
  for (const r of rows) {
    if (!r.dead.length) continue;
    console.log(`${r.id} ${r.name} [${r.verdict}]`);
    for (const d of r.dead) console.log(`    ${d.field}=${JSON.stringify(d.to)}  ${d.grade}  — ${d.why}`);
  }
}
