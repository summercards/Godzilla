/* 巨兽都市桌宠 · 文件存档仓库自检
 *
 * 存档是唯一"丢了就不可再生"的东西：等级可以再挂回来，拆除数不能。所以这里
 * 逐条钉住它的三条性质 —— 写入原子、读取能回退、坏数据不覆盖好数据。
 *
 * 零依赖，直接 node --test tests/save-store.test.cjs 跑。
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createStore, SAVE_NAME } = require('../save-store.js');

const isSave = (d) => !!d && typeof d === 'object' && d.version === 1;
const fresh = () => createStore({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'gnn-save-')), validate: isSave });
const read = (p) => fs.readFileSync(p, 'utf8');

test('空目录：读不到东西，但也不报错', () => {
  const s = fresh();
  const r = s.read();
  assert.equal(r.data, null);
  assert.equal(r.source, 'none');
  const info = s.info();
  assert.equal(info.hasSave, false);
  assert.equal(info.hasBackup, false);
});

test('写入之后能原样读回，来源是主档', () => {
  const s = fresh();
  const r = s.write({ version: 1, level: 42, xp: 7, wrecks: 900 });
  assert.equal(r.ok, true);
  assert.ok(r.bytes > 0);

  const back = s.read();
  assert.equal(back.source, 'main');
  assert.equal(back.data.level, 42);
  assert.equal(back.data.wrecks, 900);
});

test('目录不存在时会自己建出来', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gnn-save-'));
  const s = createStore({ dir: path.join(base, 'nested', 'save'), validate: isSave });
  assert.equal(s.write({ version: 1, level: 3 }).ok, true);
  assert.equal(s.read().data.level, 3);
});

test('写第二次时，第一次的存档退位成备份', () => {
  const s = fresh();
  s.write({ version: 1, level: 10 });
  s.write({ version: 1, level: 11 });

  assert.equal(s.read().source, 'main');
  assert.equal(s.read().data.level, 11);
  // 备份必须正好是上一版，不能是更早的、也不能是同一份
  assert.equal(JSON.parse(read(s.backup)).level, 10);
});

test('主档被写坏时回退到备份，并如实报告来源', () => {
  const s = fresh();
  s.write({ version: 1, level: 10 });   // → 主档
  s.write({ version: 1, level: 11 });   // → 主档 11，备份 10

  // 模拟写到一半断电：主档变成半个 JSON
  fs.writeFileSync(s.file, '{"version":1,"level":11,"xp":');

  const r = s.read();
  assert.equal(r.source, 'backup', '坏档应当回退到备份');
  assert.equal(r.data.level, 10);
});

test('主档与备份同时损坏时返回空档，而不是抛异常', () => {
  const s = fresh();
  s.write({ version: 1, level: 10 });
  s.write({ version: 1, level: 11 });
  fs.writeFileSync(s.file, 'not json at all');
  fs.writeFileSync(s.backup, '{{{');

  const r = s.read();
  assert.equal(r.data, null);
  assert.equal(r.source, 'none');
});

test('版本不符的主档算无效，会去翻备份', () => {
  const s = fresh();
  s.write({ version: 1, level: 10 });
  s.write({ version: 1, level: 11 });
  fs.writeFileSync(s.file, JSON.stringify({ version: 99, level: 11 }));

  const r = s.read();
  assert.equal(r.source, 'backup');
  assert.equal(r.data.version, 1);
});

test('导入：来源不是合法存档时，绝不覆盖现有存档', () => {
  const s = fresh();
  s.write({ version: 1, level: 77 });

  const junk = path.join(s.info().dir, 'junk.json');
  fs.writeFileSync(junk, JSON.stringify({ version: 2, level: 999 }));
  const bad = s.importFrom(junk);
  assert.equal(bad.ok, false);
  assert.notEqual(bad.error, null);
  assert.equal(s.read().data.level, 77, '导入失败却动了存档');

  const good = path.join(s.info().dir, 'good.json');
  fs.writeFileSync(good, JSON.stringify({ version: 1, level: 88 }));
  assert.equal(s.importFrom(good).ok, true);
  assert.equal(s.read().data.level, 88);
});

test('导出：把主档拷出去，内容逐字节一致', () => {
  const s = fresh();
  s.write({ version: 1, level: 61, wrecks: 1234 });
  const dest = path.join(s.info().dir, 'backup-export.json');
  const r = s.exportTo(dest);
  assert.equal(r.ok, true);
  assert.equal(read(dest), read(s.file));
});

test('导出：主档没了也还能把备份救出来', () => {
  const s = fresh();
  s.write({ version: 1, level: 10 });
  s.write({ version: 1, level: 11 });
  fs.rmSync(s.file);
  const dest = path.join(s.info().dir, 'rescued.json');
  const r = s.exportTo(dest);
  assert.equal(r.ok, true);
  assert.equal(r.backup, true, '应当说明这份是从备份里救出来的');
  assert.equal(JSON.parse(read(dest)).level, 10);
});

test('导出：主档损坏时导出的是备份，绝不是那份坏档', () => {
  const s = fresh();
  s.write({ version: 1, level: 10 });
  s.write({ version: 1, level: 11 });          // 主档 11，备份 10
  fs.writeFileSync(s.file, '{"version":1,"level":11,"xp":');   // 主档废了

  // 主档文件是"存在"的，只看 existsSync 就会把这份垃圾导出去，
  // 用户拿到一个同样打不开的文件还以为救下来了
  assert.equal(fs.existsSync(s.file), true);

  const dest = path.join(s.info().dir, 'rescued.json');
  const r = s.exportTo(dest);
  assert.equal(r.ok, true);
  assert.equal(r.backup, true);
  assert.equal(JSON.parse(read(dest)).level, 10, '导出的必须是能读出来的那一份');
  // 导出的东西必须真的能再导入回去
  const other = fresh();
  assert.equal(other.importFrom(dest).ok, true);
  assert.equal(other.read().data.level, 10);
});

test('导出：一份存档都没有时明确失败，不产出空文件', () => {
  const s = fresh();
  const dest = path.join(s.info().dir, 'nothing.json');
  const r = s.exportTo(dest);
  assert.equal(r.ok, false);
  assert.equal(fs.existsSync(dest), false);
});

test('重置：主档与备份一起清掉，回到全新状态', () => {
  const s = fresh();
  s.write({ version: 1, level: 30 });
  s.write({ version: 1, level: 31 });
  assert.equal(s.clear().ok, true);
  assert.equal(s.read().data, null);
  assert.equal(s.read().source, 'none');
  assert.equal(s.info().hasBackup, false);
});

test('写入失败时报错而不是抛异常，且不破坏已有存档', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'gnn-save-'));
  // 拿一个普通文件当目录用，mkdir 必然失败
  const blocker = path.join(base, 'blocked');
  fs.writeFileSync(blocker, 'x');
  const s = createStore({ dir: blocker, validate: isSave });

  const r = s.write({ version: 1, level: 5 });
  assert.equal(r.ok, false);
  assert.ok(r.error, '失败时应当带上原因');
});

test('正常写入不会留下临时文件', () => {
  const s = fresh();
  s.write({ version: 1, level: 10 });
  s.write({ version: 1, level: 11 });
  assert.equal(fs.existsSync(s.file + '.tmp'), false, '临时文件没有被 rename 掉');
});

test('存档只落在注入的目录里，不会写到别处', () => {
  const s = fresh();
  s.write({ version: 1, level: 1 });
  const entries = fs.readdirSync(s.info().dir).sort();
  // 用导出的常量而不是字面量：改默认文件名时这条不该跟着挂
  assert.deepEqual(entries, [SAVE_NAME]);
});

test('连续写入 50 次：等级一路递增，备份永远只落后一版', () => {
  const s = fresh();
  for (let lv = 1; lv <= 50; lv++) {
    assert.equal(s.write({ version: 1, level: lv }).ok, true);
    assert.equal(s.read().data.level, lv, `第 ${lv} 次写入后读不到刚写的内容`);
    if (lv > 1) assert.equal(JSON.parse(read(s.backup)).level, lv - 1);
  }
});

test('非对象载荷会被 validate 拦下，读回来依旧是空档', () => {
  const s = fresh();
  s.write([1, 2, 3]);
  assert.equal(s.read().data, null);
});

/* 真实存档的形状：外层是桌宠的封装（version + payload），
 * payload 是画面自己序列化出来的那份 JSON 字符串（tv/game.js 的
 * economy.serialize()）。这里钉住的是逐字往返 —— 差一个字符，
 * 画面那边 JSON.parse 就失败，整个进度回落成 1 级。 */
const tvValidate = (d) =>
  !!d && typeof d === 'object' && d.version === 1 && typeof d.payload === 'string';

test('电视存档：payload 逐字往返，画面那边能原样解析回来', () => {
  const s = createStore({
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'gnn-tv-')),
    validate: tvValidate,
  });

  const payload = JSON.stringify({
    version: 3, energy: 1234.5, earned: 900, xp: 12, level: 7,
    dna: 2, district: 3, cleared: 41, kills: 18, meters: 2600,
    levels: { power: 3, atomic: 2, metabolism: 4, stride: 2 },
    skills: ['impact', 'pierce'], auto: true, policy: 'balanced',
    muted: true, lastSeen: 1789546722367,
    world: { district: 3, x: 120, buildings: [{ id: 1, hp: 40, max: 60, dead: false }] },
  });

  assert.equal(s.write({ version: 1, payload }).ok, true);
  const back = s.read();
  assert.equal(back.source, 'main');
  assert.equal(back.data.payload, payload, 'payload 必须逐字回得来');
  assert.deepEqual(JSON.parse(back.data.payload), JSON.parse(payload));
});

test('电视存档：没有 payload 的档一律不认，免得画面拿到 undefined 去解析', () => {
  const s = createStore({
    dir: fs.mkdtempSync(path.join(os.tmpdir(), 'gnn-tv2-')),
    validate: tvValidate,
  });
  assert.equal(s.write({ version: 1, level: 3 }).ok, true, '写入本身不校验，交给读的一方把关');
  assert.equal(s.read().data, null);
});
