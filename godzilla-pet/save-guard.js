/* 巨兽都市桌宠 · 退出兜底写盘
 *
 * 存档的日常写入是画面推过来的（tv:saveWrite），大约 5 秒一次。但"最后一次写入"
 * 和"进程真的结束"之间永远有一道缝，缝里会发生这些事：
 *
 *   - Steam 库页的"停止"、系统关机、Alt+F4、kill -TERM 都不经过画面；
 *   - 渲染进程若已经崩溃或卡死，更没人来推；
 *   - 主进程自己被强杀时，谁都来不及做什么。
 *
 * 主进程是唯一写盘的人，所以它手上那份"最后一次收到的 payload"就是磁盘与画面
 * 之间的最后一道保险。这里把它留一份，退出时若还没落盘就补写一次。
 *
 * ── 什么时候必须丢弃这份缓存 ──────────────────────────────────────────
 * 缓存成立的前提是"它比磁盘新"。这个前提在下面三种情况下**不成立**，必须主动
 * 丢弃，否则退出时会把一份过期的档盖到刚换上的档上面 —— 正是导入/重置最怕的
 * 那类"看起来没生效"的故障：
 *
 *   导入存档（文件被整体替换）
 *   重置存档（文件被删除）
 *   启动握手（画面重载后重新认档，此后以文件为准）
 *
 * 这是硬规则：任何"文件被外部整体替换"的路径，都要跟一次 discard()。
 *
 * ── 与 pagehide 的关系 ────────────────────────────────────────────────
 * 画面在 pagehide 里有一次同步落盘（tv-preload.js 的 flushSync），窗口关闭时
 * 那次会带上**最新**状态。所以正常退出时这里通常是空转（pending 早已是 null）。
 * 两条路不冲突：pagehide 负责"更细"，这里负责"pagehide 没跑成"。
 *
 * 本模块不依赖 electron（写盘函数由调用方注入），因此可以被 node 直接 require
 * 做测试。
 */
'use strict';

function createSaveGuard(options) {
  const write = options && options.write;
  if (typeof write !== 'function') throw new Error('createSaveGuard 需要一个写入函数');

  const onWriteFailed = typeof (options && options.onWriteFailed) === 'function'
    ? options.onWriteFailed
    : null;

  /* 收到的、但还没确认落盘的最新一份。null 代表"不欠账"。 */
  let pending = null;

  let saves = 0;
  let flushes = 0;
  let failures = 0;
  let discarded = 0;
  let lastFlush = null;

  /* 真正碰磁盘的那一次。写入函数自己已经吞掉了异常（save-store 的约定），
   * 但这里是保险：注入进来的东西不保证守约，而这条路径在退出时跑，
   * 抛出异常会让进程带着未落盘的档直接死掉。 */
  function attempt(payload, reason) {
    let result;
    try {
      result = write(payload);
    } catch (error) {
      result = { ok: false, bytes: 0, error: String((error && error.message) || error) };
    }
    if (!result || typeof result !== 'object') {
      result = { ok: false, bytes: 0, error: '写入函数没有返回结果' };
    }
    if (!result.ok) {
      failures++;
      if (onWriteFailed) onWriteFailed(result, payload, reason);
    }
    return result;
  }

  return {
    /* 日常写入。先记后写 —— 顺序不能反：写失败时那份 payload 正是要留着补的。
     * 返回值与 save-store 的 write() 同形，调用方可以原样透传给 IPC。 */
    save(payload) {
      if (typeof payload !== 'string') {
        return { ok: false, bytes: 0, error: 'payload 必须是字符串' };
      }
      pending = payload;
      saves++;
      const r = attempt(payload, 'save');
      if (r.ok) pending = null;          // 落盘了就不欠了
      return r;
    },

    /* 丢弃缓存。导入/重置/启动握手这些"文件被整体替换"的路径必须调它，
     * 理由见文件顶部。reason 只用于统计，方便事后确认各条路径确实走过了。 */
    discard(reason) {
      const had = pending !== null;
      pending = null;
      if (had) discarded++;
      return { discarded: had, reason: reason || null };
    },

    /* 退出兜底。不欠账就什么都不做 —— 退出路径上不该多一次无谓的 fsync。
     * 返回的 attempted / ok 让调用方能如实区分"没补写"和"补写失败"。 */
    flush(reason) {
      const label = reason || 'flush';
      if (pending === null) {
        lastFlush = { reason: label, attempted: false, ok: true, bytes: 0, error: null };
        return lastFlush;
      }
      const payload = pending;
      flushes++;
      const r = attempt(payload, label);
      if (r.ok) pending = null;
      lastFlush = {
        reason: label,
        attempted: true,
        ok: r.ok,
        bytes: r.ok ? r.bytes : 0,
        error: r.error || null,
      };
      return lastFlush;
    },

    get pending() { return pending; },
    get stats() {
      return { saves, flushes, failures, discarded, pending: pending !== null, lastFlush };
    },
  };
}

module.exports = { createSaveGuard };
