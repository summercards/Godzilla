/* 巨兽都市桌宠 · 成长系统自检
 *
 * 零依赖，直接 node tests/growth.test.cjs 跑。成长系统的每一处数值都会被
 * 渲染层当作事实使用（体型决定骨骼缩放、阶段决定可解锁技能、经验决定进度条），
 * 所以这里把公式本身当成接口来测：单调性、边界、钳制、以及"永不撑破窗口"
 * 这个唯一的安全性约束。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const G = require('../renderer/growth.js');
const {
  Growth, STAGES, SIZE, BUILDINGS, ABILITY_LEVEL, TIER_XP,
  PET_XP, PET_COOLDOWN,
  bodyHeight, stageOf, unlocked, has, nextXP, idleRate, wreckXP,
  defaults, sanitize,
} = G;

/* ------------------------------------------------------------------ *
 * 体型曲线
 * ------------------------------------------------------------------ */
test('体型：1 级就是新生儿身高', () => {
  assert.equal(bodyHeight(1), SIZE.newborn);
  assert.equal(SIZE.newborn, 62);
});

test('体型：严格单调递增，且永不触及上限', () => {
  let prev = -Infinity;
  for (let lv = 1; lv <= 5000; lv++) {
    const h = bodyHeight(lv);
    assert.ok(h > prev, `第 ${lv} 级身高没有增长：${h} <= ${prev}`);
    assert.ok(h < SIZE.ceiling, `第 ${lv} 级身高越过了上限：${h}`);
    prev = h;
  }
  // 极端等级也不该溢出，这是"挂多久都不会撑破窗口"的硬保证
  assert.ok(bodyHeight(1e6) < SIZE.ceiling);
  assert.ok(bodyHeight(9999) > 139, '上限应当可以无限逼近');
});

test('体型：文档里承诺的锚点数值', () => {
  const at = (lv) => Math.round(bodyHeight(lv) * 10) / 10;
  assert.equal(at(10), 75.2);
  assert.equal(at(25), 89.5);
  assert.equal(at(50), 103.1);
  assert.equal(at(90), 114.2);
  assert.equal(at(200), 125.9);
});

test('体型：非法等级一律当作 1 级', () => {
  for (const bad of [0, -1, -999, NaN, undefined, null, 'x']) {
    assert.equal(bodyHeight(bad), SIZE.newborn, `输入 ${String(bad)} 未被兜底`);
  }
  // 小数向下取整，不产生"半级"
  assert.equal(bodyHeight(7.9), bodyHeight(7));
});

/* ------------------------------------------------------------------ *
 * 阶段与能力
 * ------------------------------------------------------------------ */
test('阶段：阈值边界完全对齐', () => {
  const expect = [
    [1, 'hatchling'], [9, 'hatchling'],
    [10, 'juvenile'], [24, 'juvenile'],
    [25, 'adolescent'], [49, 'adolescent'],
    [50, 'mature'], [89, 'mature'],
    [90, 'apex'], [9999, 'apex'],
  ];
  for (const [lv, id] of expect) {
    assert.equal(stageOf(lv).id, id, `第 ${lv} 级阶段错误`);
  }
  assert.equal(stageOf(-5).id, 'hatchling', '负数等级应当兜底到第一阶段');
});

test('阶段：与解锁表、城市档次三者自洽', () => {
  for (const s of STAGES) {
    assert.equal(s.unlock && ABILITY_LEVEL[s.unlock], s.min,
      `${s.id} 的解锁等级与 ABILITY_LEVEL 不一致`);
    assert.ok(BUILDINGS[s.cityTier], `${s.id} 指向了不存在的建筑档次 ${s.cityTier}`);
  }
  // 阶段按等级排好序，且相邻边界递增
  for (let i = 1; i < STAGES.length; i++) {
    assert.ok(STAGES[i].min > STAGES[i - 1].min, '阶段阈值必须递增');
  }
  assert.equal(STAGES[0].min, 1, '第一阶段必须从 1 级开始');
});

test('能力：解锁只增不减', () => {
  assert.deepEqual(unlocked(1).sort(), ['claw']);
  assert.deepEqual(unlocked(10).sort(), ['claw', 'roar']);
  assert.deepEqual(unlocked(25).sort(), ['beam', 'claw', 'roar']);
  assert.deepEqual(unlocked(50).sort(), ['beam', 'claw', 'roar', 'stomp']);
  assert.deepEqual(unlocked(90).sort(), ['beam', 'claw', 'roar', 'stomp', 'tail']);

  let prev = [];
  for (let lv = 1; lv <= 200; lv++) {
    const cur = unlocked(lv).sort();
    for (const a of prev) assert.ok(cur.includes(a), `第 ${lv} 级丢失了能力 ${a}`);
    prev = cur;
  }
  assert.equal(has(1, 'claw'), true);
  assert.equal(has(9, 'roar'), false);
  assert.equal(has(10, 'roar'), true);
  assert.equal(has(99, '不存在的技能'), false, '未知技能不应被解锁');
});

/* ------------------------------------------------------------------ *
 * 经验公式
 * ------------------------------------------------------------------ */
test('经验：升级需求为正整数且逐级变贵', () => {
  let prev = 0;
  for (let lv = 1; lv <= 300; lv++) {
    const need = nextXP(lv);
    assert.ok(Number.isInteger(need), `第 ${lv} 级需求不是整数`);
    assert.ok(need > 0);
    assert.ok(need > prev, `第 ${lv} 级需求没有变贵`);
    prev = need;
  }
  assert.equal(nextXP(1), 26);
  assert.equal(nextXP(10), 596);
});

test('经验：挂机产速随等级小幅提升', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  assert.ok(near(idleRate(1), 1.7));
  assert.ok(near(idleRate(10), 2.6));
  for (let lv = 2; lv <= 100; lv++) {
    assert.ok(idleRate(lv) > idleRate(lv - 1));
  }
  assert.equal(idleRate(-3), idleRate(1), '非法等级兜底');
});

test('经验：拆楼收益按档次与等级放大', () => {
  assert.equal(wreckXP(1, 1), TIER_XP[1]);
  assert.equal(wreckXP(4, 1), TIER_XP[4]);
  assert.equal(wreckXP(3, 11), 59);                  // 45 × 1.30
  assert.ok(wreckXP(3, 50) > wreckXP(3, 1));
  assert.equal(wreckXP(99, 1), TIER_XP[1], '未知档次回落到最低档');
  assert.equal(wreckXP(4, -5), TIER_XP[4], '非法等级当作 1 级');
});

/* ------------------------------------------------------------------ *
 * Growth 主体
 * ------------------------------------------------------------------ */
test('升级：恰好卡在阈值上只升一级，且不残留经验', () => {
  const g = new Growth(null);
  assert.equal(g.level, 1);
  const gained = g.gain(nextXP(1));
  assert.equal(gained, 1);
  assert.equal(g.level, 2);
  assert.equal(g.data.xp, 0);
  assert.deepEqual(g.events, [{ type: 'level', level: 2, stage: stageOf(2) }]);
});

test('升级：一次给够经验可以连升多级，并逐级发事件', () => {
  const g = new Growth(null);
  const gained = g.gain(nextXP(1) + nextXP(2) + nextXP(3));
  assert.equal(gained, 3);
  assert.equal(g.level, 4);
  assert.equal(g.events.length, 3);
  assert.deepEqual(g.events.map((e) => e.level), [2, 3, 4]);
});

test('升级：踏进新阶段时事件类型是 stage，只发一次', () => {
  const g = new Growth({ ...defaults(), level: 9, xp: 0, seenStages: ['hatchling'] });
  g.gain(nextXP(9));
  assert.equal(g.level, 10);
  assert.equal(g.events.length, 1);
  assert.equal(g.events[0].type, 'stage');
  assert.equal(g.events[0].stage.id, 'juvenile');
  assert.ok(g.data.seenStages.includes('juvenile'));

  // 之前已经见过该阶段就不该重复播横幅
  g.events.length = 0;
  g.gain(nextXP(10));
  assert.equal(g.events[0].type, 'level');
});

test('升级：非法或非正的经验一律忽略', () => {
  const g = new Growth(null);
  for (const bad of [0, -10, NaN, undefined, null, Infinity]) {
    assert.equal(g.gain(bad), 0, `输入 ${String(bad)} 不该给经验`);
  }
  assert.equal(g.level, 1);
  assert.equal(g.data.xp, 0);
  assert.equal(g.events.length, 0);
});

test('升级：巨量经验不会死循环，且会截断溢出', () => {
  const g = new Growth(null);
  const gained = g.gain(1e9);
  assert.ok(gained >= 500, '应当一路上升到保护上限');
  assert.equal(g.data.xp, 0, '溢出部分应当被清空，避免下帧再次触发');
  assert.ok(Number.isFinite(g.level) && g.level >= 1);
});

test('进度：完成度封顶在 1，不会因为溢出显示 120%', () => {
  const g = new Growth({ ...defaults(), level: 5, xp: 0 });
  assert.equal(g.progress, 0);
  g.data.xp = nextXP(5) * 3;
  assert.equal(g.progress, 1);
});

test('累计经验：等于前面各级需求之和加上未结算余量', () => {
  const g = new Growth({ ...defaults(), level: 4, xp: 7 });
  assert.equal(g.totalXP(), nextXP(1) + nextXP(2) + nextXP(3) + 7);
});

/* ------------------------------------------------------------------ *
 * 摸头
 * ------------------------------------------------------------------ */
test('摸头：首次生效，冷却期内拒绝再次加成', () => {
  const g = new Growth(null);
  assert.equal(g.pet(), true);
  assert.equal(g.data.pets, 1);
  assert.equal(g.data.xp, PET_XP);
  assert.equal(g.pet(), false, '冷却期内不该重复计数');
  assert.equal(g.data.pets, 1);
});

test('摸头：冷却走完后可以再摸', () => {
  const g = new Growth(null);
  g.pet();
  g.tick(PET_COOLDOWN);
  assert.equal(g.petClock, 0);
  assert.equal(g.pet(), true);
  assert.equal(g.data.pets, 2);
  // 冷却只减到 0，不会变成负数
  g.tick(1000);
  assert.equal(g.petClock, 0);
});

/* ------------------------------------------------------------------ *
 * 时间推进
 * ------------------------------------------------------------------ */
test('推进：非正的时间步长被忽略', () => {
  const g = new Growth(null);
  for (const bad of [0, -1, NaN, undefined]) g.tick(bad);
  assert.equal(g.data.seconds, 0);
  assert.equal(g.data.xp, 0);
});

test('推进：暂停时只计时长，不给经验', () => {
  const g = new Growth({ ...defaults(), paused: true });
  g.tick(10);
  assert.equal(g.data.seconds, 10);
  assert.equal(g.data.xp, 0);
  assert.equal(g.etaSeconds(), Infinity, '暂停时不该给出升级预估');
});

test('推进：正常时按产速累积经验', () => {
  const g = new Growth(null);
  g.tick(10);
  assert.ok(Math.abs(g.data.seconds - 10) < 1e-9);
  assert.ok(Math.abs(g.data.xp - idleRate(1) * 10) < 1e-9);
});

/* ------------------------------------------------------------------ *
 * 离线结算
 * ------------------------------------------------------------------ */
test('离线：短于 1 分钟不打扰用户', () => {
  const now = Date.now();
  const g = new Growth({ ...defaults(), lastSeen: now - 30_000 });
  assert.equal(g.offline(now), null);
  assert.equal(g.data.xp, 0);
  assert.equal(g.data.lastSeen, now, '无论是否结算都要刷新时间戳');
});

test('离线：按 55% 效率结算，并如实报告时长', () => {
  const now = Date.now();
  const g = new Growth({ ...defaults(), lastSeen: now - 3600_000 });
  const before = g.level;
  const r = g.offline(now);
  assert.equal(r.seconds, 3600);
  assert.equal(r.capped, false);
  assert.ok(Math.abs(r.amount - 3600 * idleRate(1) * 0.55) < 1e-6);
  assert.equal(r.levels, g.level - before, '报告的升级数必须与真实等级变化一致');
  assert.equal(r.levels, g.events.length);
});

test('离线：最多结算 8 小时，并标记为已截断', () => {
  const now = Date.now();
  const g = new Growth({ ...defaults(), lastSeen: now - 40 * 3600_000 });
  const r = g.offline(now);
  assert.equal(r.seconds, 28800);
  assert.equal(r.capped, true);
});

test('离线：时间倒流（例如系统时钟被改）不会倒扣经验', () => {
  const now = Date.now();
  const g = new Growth({ ...defaults(), lastSeen: now + 600_000 });
  assert.equal(g.offline(now), null);
  assert.equal(g.data.xp, 0);
});

/* ------------------------------------------------------------------ *
 * 存档
 * ------------------------------------------------------------------ */
test('存档：默认值可直接使用且字段齐全', () => {
  const d = defaults();
  assert.equal(d.version, 1);
  assert.equal(d.level, 1);
  assert.equal(d.xp, 0);
  assert.deepEqual(d.seenStages, ['hatchling']);
  assert.equal(sanitize(d).level, 1);
});

test('存档：损坏或版本不符时整体回落到默认', () => {
  for (const bad of [null, undefined, 42, 'oops', [], {}, { version: 2, level: 90 }]) {
    const s = sanitize(bad);
    assert.equal(s.level, 1, `输入 ${JSON.stringify(bad)} 未被兜底`);
    assert.equal(s.xp, 0);
  }
});

test('存档：越界数值被钳制而不是照单全收', () => {
  const s = sanitize({
    version: 1, level: 1e9, xp: -5, wrecks: -3, pets: 'x',
    seconds: Infinity, muted: 0, paused: 'yes', clickThrough: 1,
    lastSeen: Number.MAX_SAFE_INTEGER,
  });
  assert.equal(s.level, 9999);
  assert.equal(s.xp, 0);
  assert.equal(s.wrecks, 0);
  assert.equal(s.pets, 0);
  assert.equal(s.seconds, 0);
  assert.equal(s.muted, true, '非布尔值应当回落成默认静音');
  assert.equal(s.paused, false, '只有严格的 true 才算暂停');
  assert.equal(s.clickThrough, false);
  assert.ok(s.lastSeen <= Date.now(), 'lastSeen 不能跑到未来');
});

test('存档：阶段记录会去重、过滤脏数据，且必定包含第一阶段', () => {
  const s = sanitize({
    version: 1, level: 1, seenStages: ['apex', 'apex', 'bogus', 7, null],
  });
  assert.deepEqual(s.seenStages, ['hatchling', 'apex']);

  const s2 = sanitize({ version: 1, level: 1, seenStages: 'hatchling' });
  assert.deepEqual(s2.seenStages, ['hatchling'], '非数组应当回落');
});

test('存档：序列化后能原样读回（等级 / 经验 / 计数不漂移）', () => {
  const g = new Growth(null);
  g.gain(300);
  g.pet();
  g.tick(12.5);
  const now = Date.now();
  const blob = g.serialize(now);

  const back = new Growth(JSON.parse(blob));
  assert.equal(back.level, g.level);
  assert.equal(back.data.xp, g.data.xp);
  assert.equal(back.data.pets, g.data.pets);
  assert.equal(back.data.wrecks, g.data.wrecks);
  assert.ok(Math.abs(back.data.seconds - g.data.seconds) < 1e-9);
  assert.equal(back.data.lastSeen, now);
  // 派生值也必须一致，因为它们全部由 level 推出
  assert.equal(back.height, g.height);
  assert.equal(back.stage.id, g.stage.id);
  assert.equal(back.cityTier, g.cityTier);
});

/* ------------------------------------------------------------------ *
 * 端到端：一次真实挂机
 * ------------------------------------------------------------------ */
test('挂机 1 小时：等级只涨不跌，全部派生值始终自洽', () => {
  const g = new Growth(null);
  const fps = 60;
  const seconds = 3600;
  const dt = 1 / fps;
  let lastLevel = g.level;
  for (let i = 0; i < fps * seconds; i++) {
    g.tick(dt);
    if (i % fps !== 0) continue;           // 每秒抽查一次即可
    assert.ok(g.level >= lastLevel, '等级出现了回退');
    lastLevel = g.level;
    assert.ok(g.height < SIZE.ceiling, '身高越界');
    assert.ok(g.progress >= 0 && g.progress <= 1, '进度越界');
    assert.ok(BUILDINGS[g.cityTier], '城市档次失配');
    for (const a of g.abilities()) assert.ok(ABILITY_LEVEL[a] <= g.level);
  }
  assert.ok(g.level >= 15, `1 小时挂机应当明显长大，实际只有 ${g.level} 级`);
  assert.ok(Math.abs(g.data.seconds - seconds) < 0.05);
});

test('拆楼：每拆一栋都会累计计数并结算经验', () => {
  const g = new Growth(null);
  const before = g.data.xp;
  g.wreck(2);
  assert.equal(g.data.wrecks, 1);
  assert.ok(g.data.xp > before || g.level > 1);
});
