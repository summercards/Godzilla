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
