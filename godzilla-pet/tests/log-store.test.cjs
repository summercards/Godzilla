/* 巨兽都市桌宠 · 文件日志自检
 *
 * 日志这条线只有两个要求：能读懂，且永远不会把应用拖下水。
 * 所以这里钉的是格式与失败行为，而不是"有没有写进去"。
 *
 * 零依赖，直接 node --test tests/log-store.test.cjs 跑。
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createLogger, MAX_LINE } = require('../log-store.js');

const freshDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gnn-log-'));
const make = (opts = {}) => createLogger({ dir: freshDir(), ...opts });
const linesOf = (l) => fs.readFileSync(l.file, 'utf8').split('\n').filter(Boolean);

test('格式：时间戳 + 级别 + 消息 + 结构化载荷', () => {
  const l = make({ now: () => new Date(2026, 8, 17, 11, 52, 37, 123) });
  const r = l.info('电视窗口已创建', { w: 520, h: 342 });

  assert.equal(r.ok, true);
  assert.equal(r.line, '2026-09-17 11:52:37.123 [INFO ] 电视窗口已创建 {"w":520,"h":342}');
});

test('级别宽度固定，grep 出来的列才对得齐', () => {
  const l = make({ now: () => new Date(2026, 0, 2, 3, 4, 5, 6) });
  l.info('a');
  l.warn('b');
  l.error('c');
  const lines = linesOf(l);
  assert.match(lines[0], /\[INFO \] a$/);
  assert.match(lines[1], /\[WARN \] b$/);
  assert.match(lines[2], /\[ERROR\] c$/);
  // 23 位时间戳 +1 空格 +1 左括号 +5 位级别 → 右括号恒在第 30 列
  assert.deepEqual(lines.map((s) => s.indexOf(']')), [30, 30, 30]);
});

test('换行被压平：一条消息永远只占一行', () => {
  const l = make();
  l.error('渲染进程消失\n  at foo (bar.js:1)\n  at baz (qux.js:2)');
  const lines = linesOf(l);
  assert.equal(lines.length, 1, '换行没压平，按行追溯会断');
  assert.match(lines[0], /⏎/);
  assert.ok(!lines[0].includes('\n'));
});

test('载荷是字符串时直接用，不是 JSON 时也不炸', () => {
  const l = make();
  assert.doesNotThrow(() => l.warn('桥不通', '纯字符串原因'));
  const circular = {};
  circular.self = circular;
  assert.doesNotThrow(() => l.error('不可序列化的载荷', circular), '循环引用把日志写挂了');
  assert.equal(linesOf(l).length, 2);
});

test('空载荷不留一个空尾巴，也不写 "{}"', () => {
  const l = make();
  l.info('无载荷');
  l.info('空对象', {});
  l.info('null', null);
  assert.match(linesOf(l)[0], /无载荷$/);
  assert.match(linesOf(l)[1], /空对象$/);
});

test('超长行被截断，一段巨大堆栈撑不爆日志', () => {
  const l = make();
  l.error('大载荷', { stack: 'x'.repeat(5000) });
  const line = linesOf(l)[0];
  assert.ok(line.length <= MAX_LINE, `行长 ${line.length} 超过了上限 ${MAX_LINE}`);
  assert.match(line, /\.\.\.$/);
});

test('目录不存在会自己建出来', () => {
  const base = freshDir();
  const l = createLogger({ dir: path.join(base, 'nested', 'logs') });
  assert.equal(l.info('第一次写入').ok, true);
  assert.equal(fs.existsSync(l.file), true);
});

test('超过上限就轮转，只留上一份', () => {
  const l = make({ maxBytes: 300 });
  const total = 30;
  for (let i = 0; i < total; i++) l.info(`第${i}条`, { i });

  assert.equal(fs.existsSync(l.rotated), true, '没有轮转，日志会一直长');
  const num = (s) => Number(/第(\d+)条/.exec(s)[1]);
  const current = linesOf(l).map(num);
  const rotated = fs.readFileSync(l.rotated, 'utf8').split('\n').filter(Boolean).map(num);

  assert.ok(current.length > 0 && rotated.length > 0, '轮转后两份都该有内容');
  // .1 是"上一份文件"，不是"最早的那一份" —— 每轮轮转都把它覆盖掉。
  // 因此两份必须是紧邻的两段：.1 的最后一条，紧接着当前文件的第一条。
  assert.equal(rotated[rotated.length - 1] + 1, current[0], '.1 与当前文件之间断号或重号了');
  assert.equal(current[current.length - 1], total - 1, '最新一条不在当前文件里');
  assert.ok(rotated[0] > 0, '第 0 条早该被后续轮转覆盖掉了，说明轮转没生效');
  assert.ok(!fs.readFileSync(l.file, 'utf8').includes('第0条'), '旧行没被挪走');
  assert.ok(fs.statSync(l.file).size <= 300 + MAX_LINE, '轮转后当前文件还是超上限');
});

test('写不进去不抛异常，并且锁死不再重试', () => {
  const base = freshDir();
  const blocker = path.join(base, 'blocker');
  fs.writeFileSync(blocker, '我是一个文件，不是目录');

  const l = createLogger({ dir: path.join(blocker, 'logs') });
  let r;
  assert.doesNotThrow(() => { r = l.info('第一次'); }, '日志写不进去把应用带崩了');
  assert.equal(r.ok, false);
  assert.ok(r.error, '失败却没给出原因');

  // 锁死：第二次直接短路，不再碰磁盘（否则每 5 秒重试一次，等于拿日志打磁盘）
  const again = l.info('第二次');
  assert.equal(again.ok, false);
  assert.equal(again.error, r.error);

  const meta = l.meta();
  assert.equal(meta.exists, false);
  assert.equal(meta.broken, r.error, 'meta() 该如实说出日志这条线已经断了');
});

test('meta() 报告文件现状，供诊断用', () => {
  const l = make({ maxBytes: 100 });
  l.info('一句话', { a: 1 });
  const meta = l.meta();
  assert.equal(meta.exists, true);
  assert.equal(meta.rotatedExists, false);
  assert.equal(meta.maxBytes, 100);
  assert.equal(meta.broken, null);
  assert.equal(meta.file, l.file);
  assert.ok(meta.size > 0);
  assert.ok(meta.mtime > 0);
});

test('缺少目录参数直接报错，不静默写到一个随机位置', () => {
  assert.throws(() => createLogger({}), /需要一个目录/);
  assert.throws(() => createLogger(), /需要一个目录/);
});
