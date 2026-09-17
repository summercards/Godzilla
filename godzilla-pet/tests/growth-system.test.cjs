/* 成长系统数值层的契约测试
 *
 * 对应 doc/game-design/06-成长系统.md。这里钉住的是几条"破了就会毁掉
 * 产品"的性质，尤其是确定性随机 —— 决定外观的随机绝不能交给 Math.random。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const P = require('../tv/progression.js');

test('阶段：现代村庄、城郊、城区必须同时满足行程和等级', () => {
  assert.equal(P.stageIndexFor({ level: 1, meters: 0 }), 0);
  assert.equal(P.stageIndexFor({ level: 99, meters: 2599 }), 0);
  assert.equal(P.stageIndexFor({ level: 7, meters: 9000 }), 0);
  assert.equal(P.stageIndexFor({ level: 8, meters: 2600 }), 1);
  assert.equal(P.stageIndexFor({ level: 99, meters: 7199 }), 1);
  assert.equal(P.stageIndexFor({ level: 17, meters: 7200 }), 1);
  assert.equal(P.stageIndexFor({ level: 18, meters: 7200 }), 2);
});

test('阶段存档：升级和离线结算不能重置累计里程或已进入阶段', () => {
  const e = new P.Economy({ version: 4, level: 18, meters: 7300, world: { stage: 'city', district: 9, x: 950 } });
  e.gain(0, e.nextXP());
  assert.equal(e.data.meters, 7300);
  assert.equal(e.data.level, 19);
  e.data.lastSeen = Date.now() - 12 * 3600000;
  e.offline(Date.now());
  assert.equal(e.data.meters, 7300);
  const back = new P.Economy(JSON.parse(e.serialize(Date.now())));
  assert.equal(back.data.meters, 7300);
  assert.equal(back.data.world.stage, 'city');
  assert.equal(back.data.world.x, 950);
  assert.equal(P.stageIndexFor(back.data), 2);
});

/* 确定性：同一个 seed + level 永远抽出同一个突变 */
test('突变：同一个 seed+level 永远得到同一个结果', () => {
  const a = P.mutateFor(12345, 42);
  const b = P.mutateFor(12345, 42);
  assert.equal(a.id, b.id, '相同输入必须得到相同突变');
  assert.equal(a.face, b.face);
  assert.equal(a.rarity, b.rarity);
});

test('突变：不同 level 得到不同序列（按 level 派生独立序列）', () => {
  const seen = new Set();
  for (let lv = 1; lv <= 50; lv++) seen.add(P.mutateFor(12345, lv).id);
  // 50 级抽下来至少该有 3 种不同的突变，证明不是固定的
  assert.ok(seen.size >= 3, `50 级只出了 ${seen.size} 种，随机没在起效`);
});

/* 稀有度分布：10000 次抽，常见应该在 60% 附近（±10%），传说极稀 */
test('突变：稀有度分布大致符合权重（常见约 60%，传说 <2%）', () => {
  const counts = {};
  const N = 10000;
  for (let i = 0; i < N; i++) {
    const m = P.mutateFor(70000 + i, (i % 200) + 1);
    counts[m.rarity] = (counts[m.rarity] || 0) + 1;
  }
  const common = (counts.common || 0) / N;
  const legend = (counts.legend || 0) / N;
  assert.ok(common > 0.5 && common < 0.7, `常见占比 ${(common * 100).toFixed(1)}%，应接近 60%`);
  assert.ok(legend < 0.02, `传说占比 ${(legend * 100).toFixed(2)}%，应 <2%`);
});

/* 突变应用后，effect 真实写进了 morph / levels，且能被序列化读回 */
test('突变：应用结果落盘后可读回，且不丢', () => {
  const e = new P.Economy({ version: 4, seed: 999, evoRolls: 5 });
  e.rollEvolution();
  assert.ok(e.data.mutations.length === 1, '抽过一次应记录一次');
  const id = e.data.mutations[0];
  const back = new P.Economy(JSON.parse(e.serialize(Date.now())));
  assert.deepEqual(back.data.mutations, [id], '突变记录应逐字保留');
});

/* 加点机会：升级白给，加点不看核能 */
test('加点：升级 +1 机会，加点免费且不受核能限制', () => {
  const e = new P.Economy({ version: 4, level: 1, xp: 0, energy: 0 });
  e.gain(0, e.nextXP());           // 恰好升一级
  assert.equal(e.data.level, 2);
  assert.equal(e.data.assign, 1, '升级应给 1 次加点机会');
  assert.equal(e.data.evoRolls, 1, '升级应给 1 次进化机会');
  const before = e.data.levels.power;
  assert.ok(e.assignPoint('power'), '有加点机会就该能加，不看核能');
  assert.equal(e.data.levels.power, before + 1);
  assert.equal(e.data.assign, 0);
  assert.ok(!e.assignPoint('power'), '机会用完就不能再加');
});

/* 天赋：环门槛 + 主元素 */
test('天赋：三环门槛成立，主元素是第一个点满的元素节点', () => {
  const e = new P.Economy({ version: 4, talent: 100 });
  // 环 1 直接可点
  assert.ok(e.talentUpgrade('mass'));
  // 环 2 在环 1 投入 < 4 时不可点
  assert.ok(!e.ringUnlocked('element'));
  assert.ok(!e.talentUpgrade('pyro'), '环 1 未满 4 点前，元素环不可点');
  // 环 1 投入够 4 点
  for (let i = 0; i < 3; i++) e.talentUpgrade('spines');   // spines 满 3
  e.talentUpgrade('talons');                               // +1 = 累计 4
  assert.ok(e.ringUnlocked('element'), '环 1 投入 4 点后元素环应开启');
  assert.ok(e.talentUpgrade('pyro'));
  assert.ok(e.talentUpgrade('pyro'));
  assert.ok(e.talentUpgrade('pyro'), '点满 3 级');
  assert.equal(e.mainElement(), 'pyro', '第一个点满的元素节点是主元素');
});

/* 体征期：每 25 级一个台阶，由 level 推导不落盘 */
test('体征期：由等级推导，25/50/75/100 各一个台阶', () => {
  const e = new P.Economy({ version: 4 });
  assert.equal(e.epoch().name, '幼兽');
  e.data.level = 25; assert.equal(e.epoch().name, '亚成体');
  e.data.level = 50; assert.equal(e.epoch().name, '成体');
  e.data.level = 75; assert.equal(e.epoch().name, '完全体');
  e.data.level = 100; assert.equal(e.epoch().name, '灾厄体');
});

/* 体型缩放：上限 1.80 硬约束 */
test('体型：globalScale 封顶 1.80', () => {
  const e = new P.Economy({ version: 4 });
  e.data.level = 200;
  e.data.talents = { mass: 3, magma: 3 };
  e.data.morph = { ...e.data.morph, colossal: 5, extraScale: 1 };
  assert.ok(e.globalScale() <= 1.800001, `体型 ${e.globalScale()} 越过了 1.80 上限`);
});

/* 旧档迁移：version 3 必须能读，且补齐新字段（这是最容易犯的致命错） */
test('迁移：version 3 旧档照读，等级核能强化一个不丢', () => {
  const old = { version: 3, level: 33, energy: 9000, xp: 12, dna: 4, district: 5, cleared: 300, kills: 120, meters: 5000, levels: { power: 6, atomic: 5, metabolism: 7, stride: 4 }, skills: ['impact', 'pierce'], auto: true, policy: 'balanced', muted: true, lastSeen: Date.now(), world: { district: 5 } };
  const e = new P.Economy(old);
  assert.equal(e.data.level, 33, '旧档等级不能丢');
  assert.equal(e.data.energy, 9000);
  assert.equal(e.data.levels.metabolism, 7);
  assert.deepEqual(e.data.skills, ['impact', 'pierce']);
  assert.equal(e.data.district, 5);
  // 新字段补齐默认值
  assert.equal(e.data.talent, 0);
  assert.ok(typeof e.data.seed === 'number' && e.data.seed > 0, 'seed 必须从旧档派生');
  assert.deepEqual(e.data.talents, {});
  assert.deepEqual(e.data.mutations, []);
});

/* 迁移：seed 派生是确定性的，不能用 Date.now/Math.random */
test('迁移：同一个旧档派生出的 seed 完全一致', () => {
  const old = { version: 3, cleared: 300, kills: 120, meters: 5000, level: 33 };
  const s1 = P.sanitize(old).seed;
  const s2 = P.sanitize(old).seed;
  assert.equal(s1, s2, 'seed 派生必须是确定性的');
});

/* ------------------------------------------------------------------ *
 * 以下五条守住 2026-09-17 修掉的三处 P0。
 *
 * 之前没有任何测试在看这几个开关，所以 6e5e10c 那次提交把 auto 默认值翻成
 * false 时 61 项测试全绿 —— 而实际效果是：全新用户挂机八小时，回来看见一只
 * 强化停在 1/1/1/1、技能 0 个、突变 0 个的巨兽（实测 LV13 / 城区 31，
 * 而同一段时间开着托管是 LV28 / 城区 184）。
 * ------------------------------------------------------------------ */

/* P0-1：默认必须是托管的。 */
test('托管：默认开启，旧档没写过 auto 也跟随默认，显式关过才保持关', () => {
  assert.equal(new P.Economy().data.auto, true, '全新档默认必须托管');
  assert.equal(P.sanitize({ version: 4, level: 5 }).auto, true, 'version 4 旧档没写过 auto 应跟随产品默认');
  assert.equal(P.sanitize({ version: 3, level: 5 }).auto, true, 'version 3 老档同理');
  assert.equal(P.sanitize({ version: 4, level: 5, auto: false }).auto, false, '玩家显式关过必须保持关');
  assert.equal(P.sanitize({ version: 4, level: 5, auto: true }).auto, true);
});

/* P0-1 的另一半：托管要真的花出去，但加点机会绝不替玩家花。 */
test('托管：autoSpend 会强化与解锁技能，但绝不替玩家花加点机会', () => {
  const e = new P.Economy({ version: 4, energy: 100000, dna: 100, level: 20, assign: 5 });
  e.data.levels = { power: 1, atomic: 1, metabolism: 1, stride: 1 };
  const sum = () => e.data.levels.power + e.data.levels.atomic + e.data.levels.metabolism + e.data.levels.stride;
  assert.equal(sum(), 4);
  e.autoSpend();
  assert.ok(sum() > 4, 'autoSpend 必须自动强化');
  assert.ok(e.data.skills.length > 0, 'autoSpend 必须自动解锁技能');
  assert.equal(e.data.assign, 5, '加点机会必须原样留着 —— 那是留给玩家回来点的仪式感');
});

/* P0-2：离线必须发 XP。等级是 dna / 加点 / 进化机会 / 天赋点的唯一发钞口，
 * 离线不发 XP 等于挂机这条路完全不成长。 */
test('离线：必须结算经验，挂机不再原地踏步', () => {
  const e = new P.Economy();
  e.data.lastSeen = Date.now() - 8 * 3600 * 1000;
  const report = e.offline(Date.now());
  assert.ok(report, '8 小时离线必须给出结算');
  assert.ok(report.xp > 0, '离线必须发经验');
  assert.ok(e.data.level > 1, `离线 8 小时应至少升几级，实测停在 LV${e.data.level}`);
});

/* P0-2 的边界：离线 XP 折算比必须低于在线实测的 XP/核能 比（0.131），
 * 否则「关掉比开着赚」会从核能蔓延到等级。 */
test('离线：经验折算比低于在线实测的 XP/核能 比', () => {
  for (const [lv, st] of [[1, 1], [25, 20], [100, 90]]) {
    const e = new P.Economy({ version: 4, level: lv });
    e.data.levels = { power: st, atomic: st, metabolism: st, stride: st };
    e.data.lastSeen = Date.now() - 8 * 3600 * 1000;
    const r = e.offline(Date.now());
    const ratio = r.xp / r.amount;
    assert.ok(ratio > 0, `LV${lv} 离线没发经验`);
    assert.ok(ratio < 0.131, `LV${lv} 的离线 XP/核能 = ${ratio.toFixed(3)}，高于在线实测的 0.131`);
  }
});

/* P0-3：经验单价必须随区域增长。写死常数会让等级永久追不上区域推进 ——
 * 实测 xpPerEnemy(50) 应为 124，而 game.js 当时只发 12。 */
test('经验曲线：单价随区域单调递增，且第 1 区与旧写死值一致', () => {
  assert.equal(P.xpPerEnemy(1), 12, '第 1 区击杀经验与旧写死值一致（这就是这个 bug 开局一小时看不见的原因）');
  assert.equal(P.xpPerBuilding(1, 1), 24, '第 1 区主楼经验与旧写死值一致');
  assert.equal(P.xpPerBuilding(1, 0), 12, '第 1 区非主楼经验与旧写死值一致');
  assert.equal(P.xpPerDistrict(1), 60, '第 1 区破区经验与旧写死值一致');
  assert.ok(P.xpPerEnemy(50) > P.xpPerEnemy(1) * 5, '第 50 区击杀经验应远高于第 1 区');
  for (let d = 2; d <= 60; d++) {
    assert.ok(P.xpPerEnemy(d) > P.xpPerEnemy(d - 1), `xpPerEnemy 在区域 ${d} 应递增`);
    assert.ok(P.xpPerBuilding(d, 1) > P.xpPerBuilding(d - 1, 1), `xpPerBuilding 在区域 ${d} 应递增`);
    assert.ok(P.xpPerDistrict(d) > P.xpPerDistrict(d - 1), `xpPerDistrict 在区域 ${d} 应递增`);
  }
  assert.equal(P.Ke(1), 1);
  assert.equal(P.Kb(1), 1);
});
