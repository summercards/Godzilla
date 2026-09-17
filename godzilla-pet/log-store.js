/* 巨兽都市桌宠 · 文件日志
 *
 * 这是一个"挂机几个月"的应用，故障只在长时运行里露出来 —— 而那时它不在开发机上。
 * 没有日志，玩家报"挂了一晚上等级不对"就只能靠猜。主进程必须留下一条事后能查的
 * 痕迹，这是拿到玩家侧真实数据的唯一手段。
 *
 * ── 三条硬约束 ────────────────────────────────────────────────────────
 *   1. 日志本身绝不能变成故障源。写不进去就静默降级、绝不抛异常 ——
 *      磁盘满了、目录只读、路径被占，桌宠都该照常跑下去。
 *   2. 无限增长不可接受。超过上限就轮转，只留上一份（main.log / main.log.1）。
 *      7×24 跑一年，不轮转的日志会变成几个 GB。
 *   3. 一行一条。换行会破坏"按行追溯"，所以消息里的换行必须压平。
 *
 * 刻意不记日常存档写入（5 秒一次，一天一万七千行）—— 只记生命周期、失败与异常。
 * 日志的价值在信噪比，不在行数。
 *
 * 本模块不依赖 electron，目录由调用方注入，因此可以被 node 直接 require 做测试。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LOG_NAME = 'main.log';
const DEFAULT_MAX_BYTES = 256 * 1024;   // 约两千多行，够复盘一次故障
const MAX_LINE = 1200;                  // 单行上限：一段超长堆栈不该把日志撑爆

const pad = (n, w = 2) => String(n).padStart(w, '0');

/* 本地时间，秒后带毫秒。用本地时间是因为读它的人就在本机，
 * 时区换算只会给查错增加心算。 */
function stamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

/* 压平换行：⏎ 这个记号比转义成 \n 好认 —— 后者会和 JSON 里的真转义混淆。 */
const flatten = (s) => String(s).replace(/\s*\r?\n\s*/g, ' ⏎ ').trim();

/* 一行日志 = 时间戳 + 级别 + 消息 +（可选的）结构化载荷。
 * 载荷是 JSON，这样 `grep 'error'` 之后还能按字段筛，而不是靠肉眼读散文。 */
function format(level, message, extra, now) {
  let line = `${stamp(now)} [${String(level).toUpperCase().padEnd(5)}] ${flatten(message)}`;
  if (extra !== undefined && extra !== null) {
    let tail;
    if (typeof extra === 'string') {
      tail = flatten(extra);
    } else {
      try { tail = JSON.stringify(extra); } catch { tail = String(extra); }
    }
    if (tail && tail !== '{}' && tail !== 'null') line += ' ' + flatten(tail);
  }
  return line.length > MAX_LINE ? line.slice(0, MAX_LINE - 3) + '...' : line;
}

function createLogger(options) {
  const dir = options && options.dir;
  if (!dir) throw new Error('createLogger 需要一个目录');

  const name = (options && options.name) || LOG_NAME;
  const maxBytes = Number.isFinite(options && options.maxBytes) ? options.maxBytes : DEFAULT_MAX_BYTES;
  const now = typeof (options && options.now) === 'function' ? options.now : () => new Date();

  const file = path.join(dir, name);
  const rotated = file + '.1';

  /* 一旦写不动就锁死成"静默"：日志系统的故障不该每 5 秒重试一次，
   * 那只会把磁盘写满或把日志刷爆。第一次失败已经足够说明问题。 */
  let broken = null;

  const stat = (target) => {
    try {
      const s = fs.statSync(target);
      return { exists: true, size: s.size, mtime: s.mtimeMs };
    } catch {
      return { exists: false, size: 0, mtime: 0 };
    }
  };

  /* 轮转在上限处发生，因此当前文件最多超出上限一行 —— 不为此再拆一次写。 */
  function rotateIfNeeded() {
    try {
      if (!fs.existsSync(file)) return;
      if (fs.statSync(file).size < maxBytes) return;
      fs.rmSync(rotated, { force: true });
      fs.renameSync(file, rotated);
    } catch {
      /* 轮转失败不阻塞写入：宁可本次写进一个偏大的文件，也不能丢掉这条日志 */
    }
  }

  function write(level, message, extra) {
    if (broken) return { ok: false, line: null, error: broken };
    let line = null;
    try {
      fs.mkdirSync(dir, { recursive: true });
      rotateIfNeeded();
      line = format(level, message, extra, now());
      fs.appendFileSync(file, line + '\n');
      return { ok: true, line, error: null };
    } catch (error) {
      broken = String((error && error.message) || error);
      return { ok: false, line, error: broken };
    }
  }

  return {
    file,
    rotated,
    maxBytes,

    /* 统一入口。级别是自由字符串，但约定只用 debug / info / warn / error 四种：
     * 级别一多，筛选就没人用了。 */
    log: write,
    info: (message, extra) => write('info', message, extra),
    warn: (message, extra) => write('warn', message, extra),
    error: (message, extra) => write('error', message, extra),

    /* 日志文件现在的样子。`error` 非空就代表日志这条线也断了 ——
     * 诊断菜单该如实说出来，而不是让用户对着一个空文件发呆。 */
    meta() {
      const f = stat(file);
      const r = stat(rotated);
      return {
        dir,
        file,
        rotated,
        size: f.size,
        mtime: f.mtime,
        exists: f.exists,
        rotatedExists: r.exists,
        rotatedSize: r.size,
        maxBytes,
        broken,
      };
    },
  };
}

module.exports = { createLogger, LOG_NAME, DEFAULT_MAX_BYTES, MAX_LINE };
