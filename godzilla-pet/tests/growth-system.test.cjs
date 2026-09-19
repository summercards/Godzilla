/* 成长系统数值层的契约测试
 *
 * 权威描述在 `tv/DESIGN.md` 的「成长与体貌」一节；数值单一真源是 `tv/growth.js`。
 * （`doc/README.md` 里列的 `game-design/06-成长系统.md` 目前尚未写，别照着找。）
 * 这里钉住的是几条"破了就会毁掉产品"的性质，尤其是确定性随机 ——
 * 决定外观的随机绝不能交给 Math.random。
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

/* 体型缩放：成长外观的第一组硬约束。1 级要小、随等级看得见地长、封顶 CEIL。
 * L1 / L15 / L25 / L50 四个锚点是后续策划案接进来的接口，破了任何一条都要红。
 * 上限写 Growth.CEIL 而不是抄一个数字 —— 2026-09-18 把 1.12 翻到 2.24 时，
 * 这里硬编码的 1.12 是唯一会红的地方，抄数字等于每次改上限都要记得改这里。 */
test('体型：1 级最小、随等级单调增长、封顶 CEIL', () => {
  const Growth = require('../tv/growth.js');
  const TOP = Growth.CEIL;
  const s = (lv, t, m) => P.globalScaleFor(lv, t || {}, m || {});
  assert.equal(+s(1).toFixed(4), 0.34, '1 级幼兽体型应当是 0.34');
  assert.equal(+s(15).toFixed(4), 0.48, '15 级体型应当是 0.48');
  assert.equal(+s(25).toFixed(4), 0.58, '25 级亚成体体型应当是 0.58');
  assert.equal(+s(50).toFixed(4), 0.76, '50 级成体体型应当是 0.76');
  let prev = 0;
  for (let lv = 1; lv <= 300; lv++) {
    const cur = s(lv);
    assert.ok(cur >= prev - 1e-12, `体型在 ${lv} 级倒退了：${prev} -> ${cur}`);
    assert.ok(cur <= TOP + 1e-6, `体型 ${cur} 越过了 ${TOP} 上限`);
    prev = cur;
  }
  const stacked = s(200, { mass: 3, magma: 3 }, { colossal: 5, extraScale: 1 });
  assert.ok(stacked <= TOP + 1e-6 && stacked > 1.0, `叠满加成的体型 ${stacked} 应当贴在 ${TOP} 上限`);
  /* 1 级到 50 级必须长出看得见的量：0.34 -> 0.76 是 2.24 倍。
   * 低于 1.5 倍就说明曲线又被压平了（旧的饱和指数就会这样）。 */
  assert.ok(s(50) / s(1) > 1.5, '50 级体型相对 1 级必须明显变大');
});

/* 屏幕表观尺寸：玩家看到的不是 bodyScale，而是 bodyScale × 镜头。
 *
 * 只守上面那条"体型单调增长"是不够的 —— 2026-09-18 实测（主人真实存档 LV11）：
 * 体型系数 +29.4%，镜头却从 1.300 反向收到 1.160，屏幕上只有 +15.5%，
 * 一级只多 3.8px；换场处还倒退（L8 −2.9%、L18 −7.3%）。
 * 那段时间上面那条测试一直是绿的 —— 因为体型本身确实在单调增长。
 * 所以判据必须是这个乘积，不是 bodyScale。 */
test('镜头：屏幕表观尺寸逐级单调不减，且与体型同幅增长', () => {
  const Growth = require('../tv/growth.js');
  const app = (lv, t, m) => Growth.apparentScale(lv, t || {}, m || {}, P.EPOCHS);
  let prev = 0;
  for (let lv = 1; lv <= 300; lv++) {
    const cur = app(lv);
    assert.ok(cur >= prev - 1e-9, `屏幕表观在 ${lv} 级倒退了：${prev.toFixed(4)} → ${cur.toFixed(4)}`);
    assert.ok(cur <= Growth.VIEW.ceiling + 1e-6, `${lv} 级表观 ${cur.toFixed(4)} 越过 ${Growth.VIEW.ceiling} 上限，会顶穿顶部字幕条`);
    prev = cur;
  }
  /* 1→11 级是玩家最容易察觉的一段：体型涨 29%，屏幕不许再被镜头压回 15%。 */
  assert.ok(app(11) / app(1) > 1.25, `1→11 级屏幕只大了 ${((app(11) / app(1) - 1) * 100).toFixed(1)}%，镜头又在抵消体型`);
  /* 换场不许留台阶：stageIndexFor 切换的那两级（郊区和城区），表观必须仍然不减。 */
  for (const [before, after] of [[7, 8], [17, 18]]) {
    assert.ok(app(after) >= app(before), `L${before}→L${after} 换场时画面倒退了：${app(before).toFixed(4)} → ${app(after).toFixed(4)}`);
  }
  /* 体型还小的时候镜头必须恒定 —— "随等级主动拉远"正是老 bug 本体。 */
  assert.equal(+Growth.cameraScale(1, {}, {}, P.EPOCHS).toFixed(4), 1.3);
  assert.equal(+Growth.cameraScale(11, {}, {}, P.EPOCHS).toFixed(4), 1.3, '11 级镜头必须仍是 1.30，不许提前缩');
  /* 上限只在后期防溢出时才触到：50 级之前不许被钳。 */
  assert.ok(Growth.cameraScale(50, {}, {}, P.EPOCHS) > 1.28, '50 级之前镜头不该开始收敛');
});

/* 满级极限尺寸本身。
 *
 * 2026-09-18 主人拍板：满级那个"最大尺寸"翻一倍（表观 1.02 → 2.04）。
 * 代价是他认过的：头顶会出画（读 growth.js 里 VIEW.ceiling 上方那张像素表）。
 * 所以这两条盯的是**天花板不许自己缩回去**，以及**不许提前焊死** ——
 * 老代码在 L75 就吃满上限、之后 25 级画面一点不动，主人抱怨的就是这个。 */
test('镜头：满级表观上限 2.04（旧值两倍），且末档仍有成长段', () => {
  const Growth = require('../tv/growth.js');
  assert.equal(Growth.VIEW.ceiling, 2.04, '表观上限被改了 —— 记得同步 growth.js 里的像素对照表');
  const app = (lv, t, m) => Growth.apparentScale(lv, t || {}, m || {}, P.EPOCHS);
  assert.ok(Math.abs(app(300) - 2.04) < 1e-6, `练到顶的表观应当吃满 2.04，实际 ${app(300).toFixed(4)}`);
  /* 前 50 级不许被这次改动带偏：幼兽 / 亚成体 / 成体三档的锚点没动过。 */
  assert.ok(Math.abs(app(50) - 0.988) < 0.002, `50 级表观 ${app(50).toFixed(4)} 偏离了 0.988，前段曲线被动了`);
  /* 末档必须有插值段：100 → 130 级还得继续长。卡住这里的是老写法
   * `if (!next) return hi;`（一进末档就瞬间跳到上限）。 */
  assert.ok(app(130) > app(100) * 1.05, `100 → 130 级表观几乎没长（${app(100).toFixed(4)} → ${app(130).toFixed(4)}），末档插值段又没了`);
  /* 曲线终点 = 1.60。UI 归一化靠它（见 game.js 的 drawAssignHologram）。 */
  assert.equal(Growth.curveTop(P.EPOCHS), 1.60, '成长曲线终点被改了，面板全息图的归一化基准会跟着变');
});

/* 第二份镜头值：场景表不得再带 camera。
 *
 * 破了会怎样：镜头出现两个真源（growth.VIEW 与 STAGES[].camera），
 * 谁生效取决于表达式里谁写在前 —— 而且两条路都不报错。 */
test('镜头：场景表里没有第二份镜头值', () => {
  for (const s of P.STAGES) {
    assert.ok(!('camera' in s), `STAGES.${s.key} 又带上了 camera —— 镜头真源只允许 growth.VIEW`);
  }
});

/* 背鳍门禁：15 级之前是"没有这个部件"，不是"画得小"。
 * 突变池也必须同步门禁，否则"随机背鳍变化在 15 级之后"这条承诺落空。 */
test('背鳍：15 级前为 0，15 级起出现，突变池同样被挡住', () => {
  const Growth = require('../tv/growth.js');
  assert.equal(Growth.GATES.spines, 15, '背鳍门槛就是 15 级');
  for (let lv = 1; lv < 15; lv++) {
    assert.equal(Growth.unlocked('spines', lv), false, `${lv} 级不该解锁背鳍`);
    assert.equal(Growth.spineCount(lv), 0, `${lv} 级背鳍数必须是 0`);
  }
  assert.equal(Growth.spineCount(15), 2, '15 级背鳍首次出现，2 片');
  assert.equal(Growth.spineCount(27), 3, '之后每 12 级 +1');
  assert.ok(Growth.spineCount(99) > Growth.spineCount(15), '门槛之上必须还在长');
  for (let lv = 1; lv < 15; lv++) {
    for (let k = 0; k < 200; k++) {
      const m = P.mutateFor(1000 + k, lv);
      if (m) assert.notEqual(m.part, 'spikes', `${lv} 级抽到了背鳍突变（seed ${1000 + k}）`);
    }
  }
  let hit = false;
  for (let k = 0; k < 500 && !hit; k++) { const m = P.mutateFor(7000 + k, 15); if (m && m.part === 'spikes') hit = true; }
  assert.ok(hit, '15 级之后必须真能抽到背鳍突变，否则门禁把池子锁死了');
});

/* 受击范围 = 体型。这是"小体型时子弹打在空中"的根因回归：
 * 命中盒必须由 rig 骨骼数据算出，与渲染共用同一个脚底锚点和同一个缩放系数。 */
test('受击范围：跟着体型缩放，底部锚在脚底，不再打在空中', () => {
  const Rig = require('../tv/rig.js');
  const G = 590, X = 400;
  const small = Rig.hitbox(0.34, X, G), big = Rig.hitbox(1.12, X, G);
  assert.equal(small.y1, G, '命中盒底边必须正好落在脚底');
  assert.equal(big.y1, G, '体型放大后底边仍然锚在脚底');
  assert.equal(+((big.x1 - big.x0) / (small.x1 - small.x0)).toFixed(4), +(1.12 / 0.34).toFixed(4), '命中盒尺寸必须与体型严格成正比');
  assert.ok(small.x0 < X && small.x1 > X, '命中盒以角色 x 为中心展开');
  /* 关键回归：1 级的可命中高度只有满体型的不到三分之一。
   * 旧实现把判定写死在 G-350，小体型的子弹全飞过身体 —— 这一条就是那道断言。 */
  const reachSmall = G - small.y0, reachBig = G - big.y0;
  assert.ok(reachSmall < reachBig / 3, `1 级可命中高度 ${reachSmall} 必须远低于满体型 ${reachBig}`);
  assert.ok(reachSmall > 100, `1 级也得有 ${reachSmall}px 的可命中高度，别把判定缩成一条线`);
});

/* 攻击力回到初始：等级不再乘攻击力（策划要求"回到初始状态"），
 * 但区域必须仍然加成，否则后期建筑一硬就再也打不动。 */
test('攻击力：等级不再加成，区域系数仍然生效', () => {
  const Growth = require('../tv/growth.js');
  const a = new P.Economy({ version: 4 });
  const p1 = a.power(), k1 = a.atomic();
  a.data.level = 80;
  assert.equal(a.power(), p1, '等级不该改变攻击力');
  assert.equal(a.atomic(), k1, '核能攻击同样不吃等级');
  const b = new P.Economy({ version: 4 });
  b.data.district = 20;
  assert.equal(+(b.power() / p1).toFixed(6), +(1 + 19 * Growth.DISTRICT.coef).toFixed(6), '区域系数应为 1+(d-1)×DISTRICT.coef');
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

/* 托管只负责技能树；属性等级必须由玩家主动强化或 assign 加点，不能偷偷花核能。 */
test('托管：只解锁技能，不自动强化或消费加点与进化机会', () => {
  const e = new P.Economy({ version: 4, energy: 100000, dna: 100, level: 20, assign: 5 });
  e.data.levels = { power: 1, atomic: 1, metabolism: 1, stride: 1 };
  const sum = () => e.data.levels.power + e.data.levels.atomic + e.data.levels.metabolism + e.data.levels.stride;
  assert.equal(sum(), 4);
  e.autoSpend();
  assert.equal(sum(), 4, 'autoSpend 不得自动强化');
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

/* ------------------------------------------------------------------ *
 * 以下三条守住"单一真源"这件事本身。
 *
 * growth.js 声称是成长数值的唯一出处，但光靠注释声明是守不住的：
 * 2026-09-17 那次重构之前，体型曲线同时存在于 game.js、progression.js
 * 两个文件里，两个上限（1.12 / 1.80）谁也不认谁。所以下面每条都用
 * "会失败的断言"而不是注释来钉 —— 注释几个月后就没人记得了。
 * ------------------------------------------------------------------ */

/* 区域系数同源：巨兽伤害倍率与建筑耐久倍率必须是同一个函数。
 *
 * 破了会怎样：建筑耐久 = 基础值 × Kb(d)（game.js 的 generateWorld），
 * 巨兽伤害 × districtScale(d)。两个系数一旦分叉，推图几十个区域之后
 * 要么楼是纸糊的、要么怎么打都打不动 —— 而且没有任何报错。 */
test('区域系数：建筑耐久与巨兽伤害严格同源，且跟着唯一系数走', () => {
  const Growth = require('../tv/growth.js');
  assert.ok(Growth.DISTRICT && typeof Growth.DISTRICT.coef === 'number', '系数必须住在 growth.DISTRICT 里');
  for (let d = 1; d <= 200; d++) {
    const expected = 1 + (d - 1) * Growth.DISTRICT.coef;
    assert.equal(P.Kb(d), expected, `区域 ${d}：建筑耐久系数没跟着 growth.DISTRICT.coef 走`);
    /* 伤害侧还要额外过 COMBAT.districtScaling 这道开关；开关关掉时它恒为 1，
     * 那是有意的（"纯初始状态"），但开关打开时它必须与 Kb 是同一个数。 */
    if (Growth.COMBAT.districtScaling) {
      assert.equal(
        Growth.districtScale(d), expected,
        `区域 ${d}：巨兽伤害倍率 ${Growth.districtScale(d)} 与建筑耐久系数 ${expected} 分叉了`
      );
    }
  }
  /* 敌人经验系数是另一条独立设计（0.19），不该被上面这条同源契约带跑。
   * 它低于建筑系数是有意的：巨兽拆楼效率随区域提升，对敌则越来越吃力。 */
  assert.ok(P.Ke(2) < P.Kb(2), '敌人系数应当低于建筑系数，这是有意的设计差');
});

/* 体征门槛：未登记的 feature 一律不解锁。
 *
 * 破了会怎样：appearance.js / progression.js 把 'spines' 敲成 'spine'，
 * 老写法 `GATES[f] || 0` 会拿到门槛 0 → "任何等级都解锁"，且零报错：
 * 1 级幼兽直接长出背鳍，而所有测试照样绿。 */
test('体征门槛：未登记一律不解锁，已登记的按门槛值判定', () => {
  const Growth = require('../tv/growth.js');
  assert.equal(Growth.unlocked('__not_registered__', 1e9), false, '没登记的门槛绝不能因为等级高就放行');
  assert.equal(Growth.unlocked('spine', 1e9), false, '拼错一个字母（spine）必须不解锁，而不是静默放行');
  for (const feature of Object.keys(Growth.GATES)) {
    const gate = Growth.GATES[feature];
    assert.equal(Growth.unlocked(feature, gate), true, `${feature} 在门槛那一级应当解锁`);
    if (gate > 1) {
      assert.equal(Growth.unlocked(feature, gate - 1), false, `${feature} 在门槛前一级不该解锁`);
    }
  }
});

/* 消费侧与门槛表的对应：代码里用到的每个门槛名都必须在 GATES 里登记。
 * 这条同时兜住"策划案加了新门槛但忘了登记"和"名字写错"两种情形。 */
test('体征门槛：消费侧引用的门槛名全部已在 GATES 登记', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const Growth = require('../tv/growth.js');
  const tv = path.join(__dirname, '..', 'tv');
  const src = ['appearance.js', 'progression.js', 'game.js']
    .map((f) => fs.readFileSync(path.join(tv, f), 'utf8'))
    .join('\n');
  const used = new Set();
  for (const m of src.matchAll(/(?:unlocked\(\s*'|GATES\.)([A-Za-z_]\w*)/g)) used.add(m[1]);
  assert.ok(used.size > 0, '没有扫到任何门槛引用，正则可能失配了');
  for (const name of used) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(Growth.GATES, name),
      `代码里用了门槛 '${name}'，但 growth.GATES 里没有登记 —— 它会被判成"永不解锁"`
    );
  }
  assert.ok(used.has('spines'), '背鳍门槛必须仍在被消费，否则这条测试失去意义');
});
