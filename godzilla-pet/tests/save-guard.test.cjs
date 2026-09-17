/* 巨兽都市桌宠 · 退出兜底写盘自检
 *
 * 这份账本存在的唯一理由是"别丢档"，所以这里逐条钉住它的四件事：
 * 落盘了就不欠账、没落盘就留着、退出时补上、文件被换掉时必须忘记。
 *
 * 最后一条是最容易写漏的：导入/重置之后如果不丢弃缓存，退出时会把一份过期的档
 * 盖回刚导入的档上面 —— 那不是丢档，是"看起来没生效"，更难查。
 *
 * 零依赖，直接 node --test tests/save-guard.test.cjs 跑。
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createSaveGuard } = require('../save-guard.js');

/* 假写入函数：记录每一次调用，可以被指定"接下来几次失败"或"直接抛"。 */
function fakeWrite({ failTimes = 0, bytes = (p) => p.length, result } = {}) {
  const calls = [];
  let left = failTimes;
  const fn = (payload) => {
    calls.push(payload);
    if (left > 0) {
      left--;
      if (result) return result;
      return { ok: false, bytes: 0, error: '磁盘满了（假）' };
    }
    return { ok: true, bytes: bytes(payload), error: null };
  };
  fn.calls = calls;
  return fn;
}

test('落盘成功就不欠账：退出兜底一次物理写都不该多做', () => {
  const w = fakeWrite();
  const g = createSaveGuard({ write: w });

  const r = g.save('{"level":7}');
  assert.equal(r.ok, true);
  assert.equal(g.pending, null, '写入成功了却还留着待补的档');

  const f = g.flush('before-quit');
  assert.equal(f.attempted, false, '不欠账时退出兜底不该碰磁盘');
  assert.equal(w.calls.length, 1, '退出时多写了一次');
  assert.deepEqual(g.stats, {
    saves: 1, flushes: 0, failures: 0, discarded: 0, pending: false,
    lastFlush: { reason: 'before-quit', attempted: false, ok: true, bytes: 0, error: null },
  });
});

test('写入失败就留着：退出兜底把它补上', () => {
  const w = fakeWrite({ failTimes: 1 });
  const g = createSaveGuard({ write: w });

  const r = g.save('{"level":8}');
  assert.equal(r.ok, false, '假写入函数应该失败了');
  assert.equal(g.pending, '{"level":8}', '写失败的档没有留下来，退出时就没人补了');

  const f = g.flush('before-quit');
  assert.equal(f.attempted, true);
  assert.equal(f.ok, true);
  assert.equal(f.bytes, 11);
  assert.deepEqual(w.calls, ['{"level":8}', '{"level":8}'], '补写的不是同一份档');
  assert.equal(g.pending, null, '补写成功了还留着');
});

test('补写的是最新一份，不是最早失败的那一份', () => {
  const w = fakeWrite();
  const g = createSaveGuard({ write: w });

  g.save('{"level":1}');            // 成功
  const bad = fakeWrite({ failTimes: 9 });
  const g2 = createSaveGuard({ write: bad });
  g2.save('{"level":2}');           // 失败
  g2.save('{"level":3}');           // 也失败
  g2.save('{"level":4}');           // 还是失败

  assert.equal(g2.pending, '{"level":4}', '留着的应该是最后收到的那一份');
  g2.flush('before-quit');
  assert.equal(bad.calls[bad.calls.length - 1], '{"level":4}');
  assert.equal(g.pending, null);
});

test('丢弃之后退出不再补写（导入 / 重置场景）', () => {
  const w = fakeWrite({ failTimes: 1 });
  const g = createSaveGuard({ write: w });

  g.save('{"level":9}');
  assert.equal(g.pending, '{"level":9}');

  // 用户在这里导入了另一份档：文件已经被整体替换，旧的缓存必须作废
  const d = g.discard('import');
  assert.equal(d.discarded, true);

  const f = g.flush('before-quit');
  assert.equal(f.attempted, false, '过期的档在退出时被写回去了 —— 导入会被它盖掉');
  assert.equal(w.calls.length, 1, '除了那次失败的 save，不该再有写入');
  assert.equal(g.stats.discarded, 1);
});

test('本来就不欠账时，丢弃是空操作', () => {
  const g = createSaveGuard({ write: fakeWrite() });
  g.save('{"level":1}');
  assert.equal(g.discard('boot').discarded, false);
  assert.equal(g.stats.discarded, 0);
});

test('非字符串 payload 一律拒收，也不进待补队列', () => {
  const w = fakeWrite();
  const g = createSaveGuard({ write: w });

  for (const bad of [null, undefined, 42, {}, []]) {
    const r = g.save(bad);
    assert.equal(r.ok, false);
  }
  assert.equal(w.calls.length, 0, '不该把非字符串喂给写入函数');
  assert.equal(g.pending, null);
  assert.equal(g.flush('before-quit').attempted, false);
});

test('写入函数直接抛异常时不冒泡，并且照样进待补队列', () => {
  let boom = true;
  const g = createSaveGuard({
    write: (payload) => {
      if (boom) throw new Error('目录被安全软件锁了');
      return { ok: true, bytes: payload.length, error: null };
    },
  });

  const r = g.save('{"level":5}');
  assert.equal(r.ok, false);
  assert.match(r.error, /安全软件/);
  assert.equal(g.pending, '{"level":5}');

  boom = false;                       // 退出前锁解开了，兜底写就该成功
  const f = g.flush('before-quit');
  assert.equal(f.ok, true);
  assert.equal(g.pending, null);
});

test('写入函数返回坏形状也算失败，不当成写成功', () => {
  const g = createSaveGuard({ write: () => undefined });
  const r = g.save('{"level":6}');
  assert.equal(r.ok, false);
  assert.match(r.error, /没有返回结果/);
  assert.equal(g.pending, '{"level":6}', '坏返回值被当成了成功，这份档就永远补不上了');
});

test('补写再次失败时不清账，也不假装成功', () => {
  const w = fakeWrite({ failTimes: 9 });
  const g = createSaveGuard({ write: w });

  g.save('{"level":1}');
  const f = g.flush('before-quit');
  assert.equal(f.attempted, true);
  assert.equal(f.ok, false);
  assert.equal(f.error, '磁盘满了（假）');
  assert.equal(g.pending, '{"level":1}', '补写失败却清了账，这份档就丢了');
  assert.equal(g.stats.failures, 2);
});

test('写入失败会通知调用方（用来落日志）', () => {
  const seen = [];
  const g = createSaveGuard({
    write: fakeWrite({ failTimes: 2 }),
    onWriteFailed: (result, payload, reason) => seen.push({ reason, error: result.error, len: payload.length }),
  });

  g.save('{"level":1}');
  g.flush('before-quit');
  assert.deepEqual(seen, [
    { reason: 'save', error: '磁盘满了（假）', len: 11 },
    { reason: 'before-quit', error: '磁盘满了（假）', len: 11 },
  ]);
});

test('缺少写入函数就直接报错，不静默退化成一个永远丢档的壳', () => {
  assert.throws(() => createSaveGuard({}), /需要一个写入函数/);
  assert.throws(() => createSaveGuard(), /需要一个写入函数/);
});
