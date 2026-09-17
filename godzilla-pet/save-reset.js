'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function isTrustedWindowSender(sender, windows) {
  return windows.some((w) => w && !w.isDestroyed() && sender === w.webContents);
}

function createResetSave(options) {
  const {
    getStore,
    getGuard,
    defaults,
    isSave,
    isReloading = () => false,
    confirm,
    notify,
    reload,
    closePanel,
    log,
    errorLog,
    now = () => new Date(),
    id = () => crypto.randomUUID(),
  } = options || {};
  if (typeof getStore !== 'function' || typeof getGuard !== 'function' || typeof defaults !== 'function') {
    throw new Error('createResetSave 缺少存档依赖');
  }
  if (typeof confirm !== 'function' || typeof notify !== 'function' || typeof reload !== 'function') {
    throw new Error('createResetSave 缺少界面回调');
  }

  let busy = false;

  const failure = async (error, backupPath, written) => {
    const detail = String((error && error.message) || error);
    try { errorLog?.(detail, { backupPath, written }); } catch { /* 日志不能阻断错误提示 */ }
    try {
      await notify({
        type: 'error',
        message: written ? '新存档已写入，但重载或提示失败' : '重置已中止',
        detail: `${detail}\n${written ? '请重新启动桌宠。' : '未写入重置后的新档。'}\n备份路径（若备份步骤已完成）：${backupPath || '未生成'}`,
      });
    } catch { /* 对话框失败也必须返回明确结果并释放 busy */ }
    return { ok: false, error: detail, backupPath, written };
  };

  return async function resetSave() {
    if (busy || isReloading()) return { ok: false, busy: true, error: '存档正在重置或重新载入' };
    busy = true;
    let backupPath;
    let written = false;
    try {
      const store = getStore();
      const info = store.info();
      const timestamp = now().toISOString().replace(/[:.]/g, '-');
      backupPath = path.join(info.dir, `tv-reset-${timestamp}-${id()}.json`);
      const ask = await confirm({
        type: 'warning',
        buttons: ['取消', '备份并重置'],
        defaultId: 0,
        cancelId: 0,
        message: '重置桌宠存档？',
        detail: `等级、核能、突变点、技能、章节、破坏进度与所在城区将全部重置为初始状态。\n确认后先保存独立备份，备份失败则中止；不会删除存档或备份文件。\n\n主存档：${info.file}\n轮转备份：${info.backup}\n本次新备份：${backupPath}`,
      });
      if (ask.response !== 1) return { ok: false, canceled: true, error: null };

      const flushed = getGuard().flush('reset');
      if (!flushed.ok) throw new Error(`最新缓存保存失败：${flushed.error || '未知原因'}`);
      const previous = store.read().data;
      const exported = store.exportTo(backupPath, { exclusive: true });
      if (!exported.ok) throw new Error(`独立备份失败：${exported.error || '未知原因'}`);

      let saved;
      try {
        saved = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      } catch (error) {
        throw new Error(`独立备份校验失败：${String((error && error.message) || error)}`);
      }
      if (!isSave(saved) || !previous || saved.payload !== previous.payload) {
        throw new Error('独立备份校验失败：内容与当前可读存档不一致');
      }
      try {
        const payload = JSON.parse(saved.payload);
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('payload 不是对象');
      } catch (error) {
        throw new Error(`独立备份校验失败：${String((error && error.message) || error)}`);
      }

      const out = store.write({ version: 1, payload: JSON.stringify(defaults()) });
      if (!out.ok) throw new Error(`新存档写入失败：${out.error || '未知原因'}`);
      written = true;
      getGuard().discard('reset');
      try {
        reload();
      } finally {
        closePanel?.();
      }
      try { log?.('重置了存档', { backupPath }); } catch { /* 日志不能阻断成功结果 */ }
      await notify({
        type: 'info',
        message: '存档已重置',
        detail: `重置前的进度已备份，可通过「从备份导入」恢复。\n备份路径：${backupPath}`,
      });
      return { ...out, backupPath };
    } catch (error) {
      return await failure(error, backupPath, written);
    } finally {
      busy = false;
    }
  };
}

module.exports = { createResetSave, isTrustedWindowSender };
