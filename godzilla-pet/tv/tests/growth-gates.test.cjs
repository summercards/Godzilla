/* 成长按钮的门（加点 / 核能购买 / 掷骰进化）。
 *
 * 2026-09-18 主人报的"加点按钮和变异按钮按下去没反应"，根因不是经济逻辑，
 * 而是**电视窗口里那三个按钮的 disabled 停在了旧状态**：
 *
 *   · renderGrowthPanels() 在电视窗口里一次都不会跑 —— tv-preload 的
 *     guardMainPanel() 把 #management 永久按住 hidden，hud() 里那句重绘的
 *     守卫 `if(!$('management').hidden)` 于是恒为假，剩下的触发点只剩
 *     "某个命令成功执行之后"那一次；
 *   · 于是按钮带着上一次成功操作那一刻的 disabled 活着：用光点数被置灰，
 *     之后升级再把点数发回来，按钮仍然是灰的；
 *   · 而 panelCommand() 第一句就是 `if(!el||el.disabled)return null;`，
 *     面板点过来的命令被静默丢掉，两端都不报错。
 *
 * 实测（.workbuddy/probe-growth-gate.cjs）：升级把点数发回来后，面板侧已亮、
 * 电视侧仍是灰的，命令返回 null 且 assign/evoRolls 一动不动。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../progression.js');

const ROOT = path.join(__dirname, '..', '..');
const readGame = () => fs.readFileSync(path.join(ROOT, 'tv', 'game.js'), 'utf8');
const readHook = () => fs.readFileSync(path.join(ROOT, 'tv-preload.js'), 'utf8');
const source = readGame();
const functionSource = (name, next) => source.slice(source.indexOf('function ' + name + '('), source.indexOf('function ' + next + '('));

function fakeEnv() {
  const els = {};
  for (const k of Object.keys(P.STATS)) { els['assign-' + k] = { disabled: null }; els['buy-' + k] = { disabled: null }; }
  els.rollEvo = { disabled: null };
  return {
    els,
    env: {
      data: { assign: 0, evoRolls: 0, energy: 0, levels: Object.fromEntries(Object.keys(P.STATS).map((k) => [k, 1])) },
      P,
      economy: { cost: () => 80 },
      $: (id) => els[id] || null,
    },
  };
}

test('成长按钮的门跟着当前数值走，点数一回来就必须开', () => {
  const gates = functionSource('statGate', 'renderGrowthPanels');
  assert.ok(gates.includes('function syncGrowthGates'), 'game.js 里找不到 syncGrowthGates');

  const { els, env } = fakeEnv();
  vm.runInNewContext(gates + ';syncGrowthGates();', env);

  for (const k of Object.keys(P.STATS)) {
    assert.equal(els['assign-' + k].disabled, true, `0 加点时 assign-${k} 必须是灰的`);
    assert.equal(els['buy-' + k].disabled, true, `核能不够时 buy-${k} 必须是灰的`);
  }
  assert.equal(els.rollEvo.disabled, true, '0 进化机会时 rollEvo 必须是灰的');

  // 数值回来 → 门必须跟着开。这正是电视窗口里原先做不到的那一步。
  env.data.assign = 3; env.data.evoRolls = 2; env.data.energy = 1e6;
  vm.runInNewContext(gates + ';syncGrowthGates();', env);
  for (const k of Object.keys(P.STATS)) {
    assert.equal(els['assign-' + k].disabled, false, `点数回来后 assign-${k} 必须亮起来`);
    assert.equal(els['buy-' + k].disabled, false, `核能够了 buy-${k} 必须亮起来`);
  }
  assert.equal(els.rollEvo.disabled, false, '进化机会回来后 rollEvo 必须亮起来');

  // 满级那一档也要灰住，别只判点数
  env.data.levels.power = 500;
  vm.runInNewContext(gates + ';syncGrowthGates();', env);
  assert.equal(els['assign-power'].disabled, true, '满 500 级后加点必须是灰的');
  assert.equal(els['buy-power'].disabled, true, '满 500 级后核能购买必须是灰的');
});

test('这三组门必须挂在 hud 的心跳上，不能跟着"面板可见"的守卫走', () => {
  const hud = functionSource('hud', 'processEconomyEvents');
  assert.ok(hud.includes('syncGrowthGates()'), 'hud 心跳里没有刷成长按钮的门 —— 电视窗口里它们会停在旧状态');

  const guard = hud.indexOf("if(!$('management').hidden)");
  if (guard >= 0) {
    assert.ok(hud.indexOf('syncGrowthGates()') < guard,
      '门被放进"面板可见才重绘"的守卫里了；电视窗口的 #management 永远是 hidden，等于没刷');
  }

  // 电视窗口确实永远看不到面板：tv-preload 用 MutationObserver 把 hidden 按住。
  // 这条断了的话，"门挂在心跳上"的前提就变了，得回来重新判断。
  const hook = readHook();
  assert.match(hook, /mgmt\.hidden = true/, 'tv-preload 不再强制隐藏 #management？那这个前提要重新确认');
});

test('门的判据只有一份，不许在 renderAssignPanel 里另抄一遍', () => {
  const assign = functionSource('renderAssignPanel', 'renderTalentPanel');
  assert.ok(assign.includes('statGate(k)'), 'renderAssignPanel 没有共用 statGate —— 两份判据迟早会漂移');
  assert.ok(!/disabled\s*=\s*d\.assign\s*<=/.test(assign), 'renderAssignPanel 里又写了一份加点门槛');
  assert.ok(!/disabled\s*=\s*d\.energy\s*</.test(assign), 'renderAssignPanel 里又写了一份核能门槛');
});
