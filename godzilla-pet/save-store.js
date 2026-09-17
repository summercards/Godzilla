/* 巨兽都市桌宠 · 文件存档仓库
 *
 * 存档落在 userData 目录下的一个 JSON 文件里，而不是画面的 localStorage。
 * 换成文件有三个实在的理由：
 *
 *   1. localStorage 是页面私有的，窗口一关、清一次缓存就跟着走了；而这是一个
 *      "挂机几个月"的游戏，存档得是用户能看见、能备份、能搬到另一台机器的东西。
 *   2. localStorage 没有原子性，也没有备份。写到一半断电就是一个坏掉的 JSON，
 *      而画面自己的 sanitize 遇到坏档会整体回落到 1 级 —— 几个月的进度就没了。
 *   3. 主进程掌控窗口生命周期，能在退出、崩溃、系统重启前把数据落盘。
 *
 * ── 写入是原子的 ──────────────────────────────────────────────────────
 * 顺序固定为：可读主档原子复制到备份 → 新档写临时文件并 fsync → 原子替换主档。
 * 主档不提前挪走，写入失败时仍保留原件；损坏的主档不会覆盖可读备份。
 * 临时文件写入或替换失败时保留现场，不删除任何文件。
 *
 * 代价是备份永远落后一个存档周期（5 秒），换来的是"永远不会读到半个 JSON"。
 *
 * 本模块不依赖 electron，目录由调用方注入，因此可以被 node 直接 require 做测试。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SAVE_NAME = 'tv.json';
const BACKUP_NAME = 'tv.json.bak';
const TMP_NAME = 'tv.json.tmp';

/* 默认校验：必须是个普通对象。业务字段的钳制交给注入进来的 validate
 * （main.js 里是 isSaveV1），这一层只管"这份文件是不是一个能用的存档数据"，
 * 判断越少越不容易误伤。 */
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/* 精确替换的原子写。先落盘到 tmp，再到 rename —— rename 在同一分区内是原子的，
 * 所以主档要么是旧的完整内容，要么是新的完整内容，不存在中间态。 */
function atomicWrite(target, text) {
  const tmp = target + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);   // 不 fsync 的话数据可能还在页缓存里，断电后 rename 已生效但内容是空的
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
}

function createStore(options) {
  const dir = options && options.dir;
  if (!dir) throw new Error('createStore 需要一个目录');

  const name = (options && options.name) || SAVE_NAME;
  const backupName = name + '.bak';
  const tmpName = name + '.tmp';
  const validate = (options && options.validate) || isPlainObject;

  const file = path.join(dir, name);
  const backup = path.join(dir, backupName);
  const tmp = path.join(dir, tmpName);

  const ensureDir = () => fs.mkdirSync(dir, { recursive: true });

  /* 读一份文件并校验。任何异常都吞掉并返回 null —— 存档坏了不该让应用起不来，
   * 上层拿到 null 会走"新档"，再由 read() 决定要不要回退备份。 */
  function readOne(target) {
    let text;
    try {
      text = fs.readFileSync(target, 'utf8');
    } catch {
      return null;                       // 不存在或读不动
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;                       // 半个 JSON
    }
    return validate(parsed) ? parsed : null;
  }

  function stat(target) {
    try {
      const s = fs.statSync(target);
      return { exists: true, size: s.size, mtime: s.mtimeMs };
    } catch {
      return { exists: false, size: 0, mtime: 0 };
    }
  }

  return {
    file,
    backup,

    ensureDir,

    /* 读取。主档优先，坏了或不存在才回退备份。
     * source 会如实报告数据来自哪一份，UI 可以据此提示"已从备份恢复"。 */
    read() {
      const main = readOne(file);
      if (main) return { data: main, source: 'main' };
      const bak = readOne(backup);
      if (bak) return { data: bak, source: 'backup' };
      return { data: null, source: 'none' };
    },

    /* 写入。返回 { ok, bytes, error }，不抛异常 —— 磁盘满了、目录只读、
     * 被安全软件锁住，这些都不该让桌宠崩掉，写失败保持上一份存档就好。 */
    write(payload) {
      try {
        const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
        ensureDir();
        // 备份失败就中止，不能牺牲可恢复性；坏主档也不能污染好备份。
        if (readOne(file)) atomicWrite(backup, fs.readFileSync(file, 'utf8'));
        atomicWrite(file, text);
        return { ok: true, bytes: Buffer.byteLength(text), error: null };
      } catch (error) {
        return { ok: false, bytes: 0, error: String((error && error.message) || error) };
      }
    },

    /* 主档与备份现在的样子，用于在菜单里显示"存档写在哪、多大、多久没动" */
    info() {
      const m = stat(file);
      const b = stat(backup);
      return {
        dir,
        file,
        backup,
        size: m.size,
        mtime: m.mtime,
        hasSave: m.exists,
        hasBackup: b.exists,
        backupSize: b.size,
        backupMtime: b.mtime,
      };
    },

    /* 导出：把当前主档拷到用户挑的位置。
     *
     * 挑哪一份拷要按"读得出来"来判断，而不是"文件在不在" —— 主档存在但内容
     * 已经损坏时，那个文件是垃圾，真正能救的是备份。只看 existsSync 的话，
     * 用户点了「导出备份」会拿到一个同样打不开的文件，还以为自己救下来了。 */
    exportTo(dest, { exclusive = false } = {}) {
      const src = readOne(file) ? file : (readOne(backup) ? backup : null);
      if (!src) return { ok: false, error: '没有可导出的存档' };
      try {
        ensureDir();
        fs.copyFileSync(src, dest, exclusive ? fs.constants.COPYFILE_EXCL : 0);
        const fd = fs.openSync(dest, 'r+');
        try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        return {
          ok: true,
          from: src,
          backup: src === backup,      // 让 UI 能说明"这份是从上一版备份里救出来的"
          bytes: fs.statSync(dest).size,
          error: null,
        };
      } catch (error) {
        return { ok: false, error: String((error && error.message) || error) };
      }
    },

    /* 导入：先按存档规则校验来源文件，通过才原子写入。
     * 校验放在写入之前，是为了不让一个坏文件把好档顶掉。 */
    importFrom(src) {
      const data = readOne(src);
      if (!data) return { ok: false, error: '这个文件不是有效的存档' };
      const r = this.write(data);
      return r.ok ? { ok: true, bytes: r.bytes, error: null } : r;
    },

    /* 重置：主档与备份一起删。刻意不做"删掉再自动存一份新档"，
     * 让下一次写入自然地重建，这样调用方不需要关心初始化顺序。 */
    clear() {
      try {
        fs.rmSync(file, { force: true });
        fs.rmSync(backup, { force: true });
        fs.rmSync(tmp, { force: true });
        return { ok: true, error: null };
      } catch (error) {
        return { ok: false, error: String((error && error.message) || error) };
      }
    },
  };
}

module.exports = { createStore, SAVE_NAME, BACKUP_NAME, TMP_NAME, atomicWrite };
