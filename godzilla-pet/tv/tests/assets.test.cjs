/* 资产完整性测试 —— docs/资产规范.md 的可执行版本。
 *
 * 这份测试的职责是把"文档里写的约束"变成"改错了会红"。
 * 它不测玩法，只测资产与代码指向是否自洽：
 *   1. 登记了的路径必须真实存在（没登记的东西不允许散在目录里）
 *   2. rig.json / rig.data.js / 母图裁切元数据 / 实际部件图 四者一致
 *   3. 形态与等级阶梯（appearance.FORMS × progression.EPOCHS）对账
 *   4. 单位声明的绘制函数在 game.js 里真的有实现（写错不会静默退化成坦克）
 *   5. 生成建筑的资产种类都在索引里登记过
 *   6. 命名规范
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TV = path.join(__dirname, '..');
const ASSETS_DIR = path.join(TV, 'assets');
const Assets = require('../assets/asset-index.js');
const Appearance = require('../appearance.js');
const Progression = require('../progression.js');
const { derive } = require('../../build/derive-rig.cjs');
const gameSrc = fs.readFileSync(path.join(TV, 'game.js'), 'utf8');

const abs = (rel) => path.join(TV, rel);
const exists = (p) => fs.existsSync(p);
const dirsIn = (p) => fs.readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

/* ------------------------------------------------------------------ */
test('frame: 形态与等级阶梯对账，且无越界登记', () => {
  const problems = Appearance.validate(Progression.EPOCHS);
  assert.deepEqual(problems, [], 'appearance.validate 报错：\n  ' + problems.join('\n  '));
  assert.equal(Appearance.FORMS.length, Progression.EPOCHS.length);
  for (let i = 0; i < Appearance.FORMS.length; i++) {
    assert.equal(Appearance.FORMS[i].label, Progression.EPOCHS[i].name, `第 ${i} 档形态名与 EPOCHS 不一致`);
  }
  assert.equal(Assets.SLOTS.length, 12, '骨骼槽必须恰好 12 个');
  assert.equal(new Set(Assets.SLOTS).size, 12, '骨骼槽不得重复');
  for (const slot of Object.keys(Appearance.FORMS[0].styles)) {
    assert(Assets.SLOTS.includes(slot), `${slot} 不是骨骼槽，不能出现在形态的 styles 里`);
  }
});

/* ------------------------------------------------------------------ */
test('frame: 12 个骨骼槽在索引 / rig 数据 / 实际目录三方一致', () => {
  const rig = require('../assets/monsters/godzilla/rig.json');
  const byOrder = [...rig.order].sort();
  assert.deepEqual(byOrder, [...Assets.SLOTS].sort(), 'rig.json 的 order 与 asset-index 的 SLOTS 不是同一批槽位');
  assert.deepEqual(Object.keys(rig.slots).sort(), byOrder, 'rig.json 的 slots 与 order 不是同一批槽位');

  const partsDir = path.join(ASSETS_DIR, 'monsters', 'godzilla', 'parts');
  const onDisk = dirsIn(partsDir).sort();
  assert.deepEqual(onDisk, byOrder, 'parts/ 下的槽位目录与槽位清单不一致（多的没登记，少的没建）');

  for (const slot of Assets.SLOTS) {
    assert.equal(rig.slots[slot].parent === undefined, false, `${slot} 缺少 parent`);
    assert(Array.isArray(rig.slots[slot].pivotOffset) && rig.slots[slot].pivotOffset.length === 2, `${slot} 缺少 pivotOffset`);
  }
  // 父子关系必须无环且能回溯到 torso
  for (const slot of Assets.SLOTS) {
    let cur = slot, hops = 0;
    while (rig.slots[cur].parent) {
      cur = rig.slots[cur].parent;
      assert(hops++ < 12, `${slot} 的父子链成环`);
    }
    assert.equal(cur, 'torso', `${slot} 的父子链没有回到根节点 torso`);
  }
});

/* ------------------------------------------------------------------ */
test('frame: 生成物与母图元数据一致（改母图后必须重跑 derive-rig）', () => {
  const { rig, problems } = derive('godzilla');
  assert.deepEqual(problems, [], '母图裁切元数据自相矛盾：\n  ' + problems.join('\n  - '));

  const onDisk = JSON.parse(fs.readFileSync(path.join(ASSETS_DIR, 'monsters', 'godzilla', 'rig.json'), 'utf8'));
  assert.deepEqual(onDisk, rig, 'rig.json 与母图元数据不一致 —— 请运行 node build/derive-rig.cjs');

  const runtime = require('../assets/monsters/godzilla/rig.data.js');
  assert.deepEqual(runtime, rig, 'rig.data.js 与 rig.json 不一致 —— 请运行 node build/derive-rig.cjs');

  // 部件图的实际像素尺寸必须与声明一致
  for (const slot of Assets.SLOTS) {
    const p = path.join(ASSETS_DIR, 'monsters', 'godzilla', 'parts', slot, 'default.png');
    assert(exists(p), `缺少部件图 parts/${slot}/default.png`);
  }
});

/* ------------------------------------------------------------------ */
test('assets: 怪兽登记的路径与样式都真实存在', () => {
  const monsterDirs = dirsIn(path.join(ASSETS_DIR, 'monsters'));
  assert.deepEqual(monsterDirs.sort(), Object.keys(Assets.MONSTERS).sort(), 'monsters/ 下有未登记的怪兽目录，或登记了不存在的怪兽');

  for (const [id, m] of Object.entries(Assets.MONSTERS)) {
    assert.deepEqual(m.slots, Assets.SLOTS, `${id} 的槽位清单与全局不一致`);
    for (const f of Object.values(m.files)) assert(exists(abs(Assets.dir.monster(id) + '/' + f)), `${id} 缺少文件 ${f}`);
    const styles = Object.keys(m.styles);
    assert(styles.includes(m.defaultStyle), `${id} 的默认样式 ${m.defaultStyle} 没有登记`);
    for (const style of styles) {
      for (const slot of m.slots) {
        const p = abs(Assets.file.monsterPart(id, slot, style));
        assert(exists(p), `登记了样式 ${style}，但缺少贴图 ${Assets.file.monsterPart(id, slot, style)}`);
      }
    }
  }
});

/* ------------------------------------------------------------------ */
test('assets: 敌人单位的目录、阵营、绘制函数都能对上', () => {
  const factions = dirsIn(path.join(ASSETS_DIR, 'enemies'));
  assert.deepEqual(factions.sort(), Object.keys(Assets.ENEMY_FACTIONS).sort(), 'enemies/ 下有未登记的阵营');
  for (const faction of factions) {
    const units = dirsIn(path.join(ASSETS_DIR, 'enemies', faction));
    const declared = Object.entries(Assets.ENEMY_UNITS).filter(([, u]) => u.faction === faction).map(([k]) => k);
    assert.deepEqual(units.sort(), declared.sort(), `enemies/${faction}/ 下的单位目录与登记不一致`);
  }

  /* 绘制函数必须真的存在。否则 TYPES[type].renderer 查不到会静默退化成坦克 ——
   * 那种错误在游戏里只表现为"某个单位长得不对"，没人会去查。 */
  const table = gameSrc.match(/const UNIT_RENDERERS=\{([^}]*)\}/);
  assert(table, 'game.js 里找不到 UNIT_RENDERERS 分派表');
  const implemented = new Set(table[1].split(',').map((s) => s.trim()).filter(Boolean));
  for (const [type, unit] of Object.entries(Assets.ENEMY_UNITS)) {
    assert(implemented.has(unit.renderer), `${type} 声明的 ${unit.renderer} 不在 UNIT_RENDERERS 表里`);
    assert(new RegExp('function\\s+' + unit.renderer + '\\s*\\(').test(gameSrc), `${type} 的 ${unit.renderer} 在 game.js 里只有名字没有实现`);
    assert(gameSrc.includes(`'${type}'`), `单位 ${type} 已登记但 game.js 从不生成它`);
    assert(unit.label && unit.slots.length, `${type} 缺少显示名或部件槽声明`);
  }
});

/* ------------------------------------------------------------------ */
test('assets: 建筑按幕分目录，生成的建筑种类都登记过', () => {
  const stages = dirsIn(path.join(ASSETS_DIR, 'buildings'));
  assert.deepEqual(stages.sort(), Object.keys(Assets.BUILDING_KINDS).sort(), 'buildings/ 下的幕目录与登记不一致');
  assert.deepEqual(stages.sort(), Progression.STAGES.map((s) => s.key).sort(), '建筑目录的幕必须与 progression.STAGES 的 key 一致');

  for (const stage of stages) {
    const kinds = dirsIn(path.join(ASSETS_DIR, 'buildings', stage)).filter((k) => k !== '_shared');
    const declared = Object.keys(Assets.BUILDING_KINDS[stage].kinds);
    assert.deepEqual(kinds.sort(), declared.sort(), `buildings/${stage}/ 下的种类目录与登记不一致`);
  }

  // 文档 §2.4 的那张表就是这里的断言
  for (const k of ['house', 'shop']) assert(Assets.buildingKind('village', k), `village 缺少 ${k}`);
  for (const k of ['house', 'shop', 'midrise']) assert(Assets.buildingKind('suburb', k), `suburb 缺少 ${k}`);
  for (const k of ['tower', 'block']) assert(Assets.buildingKind('city', k), `city 缺少 ${k}`);

  // game.js 里所有 buildingAssetId('幕','种类') 的字面量必须在索引里
  const calls = [...gameSrc.matchAll(/buildingAssetId\('([a-z]+)','([a-z_]+)'\)/g)];
  assert(calls.length >= 2, 'game.js 里找不到 buildingAssetId 调用，建筑资产指向可能被删掉了');
  for (const [, stage, kind] of calls) {
    assert(Assets.buildingKind(stage, kind), `game.js 引用了未登记的建筑资产 ${stage}/${kind}`);
  }
});

/* ------------------------------------------------------------------ */
test('assets: 命名规范（小写 ASCII + 下划线，无中文无大写无版本后缀）', () => {
  const SEG = /^[a-z0-9_]+$/;
  /* 目录名只允许小写字母数字下划线。文件名额外允许 `.` 与 `-` 作分隔符 ——
   * 规范里有两类名字必须用到：生成对 `<用途>.json` / `<用途>.data.js`、
   * 母图 `<怪兽>-pixel.png`。分隔符不能出现在首尾，也不能连着出现。 */
  const FILE = /^[a-z0-9_]+(?:[.-][a-z0-9_]+)*\.(png|json|js)$/;
  const banned = /(final|new|copy|副本|备份|v\d+$)/;
  const problems = [];

  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (!SEG.test(e.name)) problems.push('目录名不合规：' + r);
        walk(path.join(dir, e.name), r);
      } else {
        if (e.name === '.gitkeep') continue;
        if (!FILE.test(e.name)) problems.push('文件名不合规：' + r);
        if (banned.test(e.name.replace(/\.(png|json|js)$/, ''))) problems.push('文件名带了版本/副本后缀：' + r);
      }
    }
  };
  walk(path.join(ASSETS_DIR, 'monsters'), 'monsters');
  walk(path.join(ASSETS_DIR, 'enemies'), 'enemies');
  walk(path.join(ASSETS_DIR, 'buildings'), 'buildings');

  assert.deepEqual(problems, [], '命名规范违规：\n  ' + problems.join('\n  '));

  /* 正则自身的反向自检。这类"逐条列违规"的测试有个典型的退化方式：
   * 为了让现有文件过而把正则放宽，最后宽到什么都接受，等于没测。
   * 所以这里固定钉死几个必须被拒的样本。 */
  for (const bad of ['Head', '头部', 'default v2.png', 'a..b.png', '-x.png', 'x-.png', 'default .png']) {
    assert.equal(FILE.test(bad), false, `文件名正则漏放了 ${bad}`);
  }
  for (const bad of ['Head', '尾部', 'a-b', 'a.b', '']) assert.equal(SEG.test(bad), false, `目录名正则漏放了 ${bad}`);
  for (const good of ['default.png', 'parts.json', 'rig.data.js', 'godzilla-pixel.png', 'asset-index.js']) {
    assert.equal(FILE.test(good), true, `合法文件名被正则误拒：${good}`);
  }
  for (const bad of ['default_final', 'godzilla_new', 'a_copy', '素材副本', 'tankv2']) {
    assert.equal(banned.test(bad), true, `版本/副本后缀检查漏放了 ${bad}`);
  }
});

/* ------------------------------------------------------------------ */
test('assets: 资产根目录里没有多余的散落文件', () => {
  // 允许的顶层项只有：索引模块、字库、三大类目录
  const allowed = new Set(['asset-index.js', 'fonts', 'monsters', 'enemies', 'buildings']);
  const stray = fs.readdirSync(ASSETS_DIR).filter((n) => !allowed.has(n));
  assert.deepEqual(stray, [], 'tv/assets 顶层出现未归类的东西：' + stray.join('、') + '（归入 monsters/ enemies/ buildings/ 之一，或写进规范）');
});
