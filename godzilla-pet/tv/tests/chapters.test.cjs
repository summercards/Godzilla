'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const P = require('../progression.js');
const source = fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8');
const functionSource = (name, next) => source.slice(source.indexOf('function ' + name + '('), source.indexOf('function ' + next + '('));

test('章节边界独立于等级，纽约每五区无限续轮', () => {
  for (const [district, key, index, round] of [
    [1,'osaka',0,1], [5,'osaka',4,1], [6,'tokyo',0,1], [10,'tokyo',4,1],
    [11,'newyork',0,1], [15,'newyork',4,1], [16,'newyork',0,2], [100,'newyork',4,18], [101,'newyork',0,19],
  ]) {
    const r = P.routeFor(district, .37);
    assert.equal(P.chapterFor(district).key, key);
    assert.equal(r.chapter, P.chapterFor(district));
    assert.equal(r.index, index); assert.equal(r.round, round); assert.equal(r.progress, .37);
    assert.equal(r.nodes.length, 5); assert.equal(r.nodes[index].district, district);
    assert.equal(r.nodes.filter(n => n.state === 'cleared').length, index);
    assert.equal(r.nodes.filter(n => n.state === 'current').length, 1);
    assert.equal(r.nextDistrict, district + 1);
    assert.equal(r.nextStreet, P.routeFor(district + 1).street);
  }
  assert.equal(P.routeFor(5).nextChapter.key, 'tokyo');
  assert.equal(P.routeFor(10).nextChapter.key, 'newyork');
  assert.equal(P.routeFor(15).nextChapter.key, 'newyork');
  assert.equal(P.routeFor(100, 2).progress, 1);
  assert.equal(P.routeFor(16, -1).progress, 0);
  const before = JSON.stringify(P.CHAPTERS);
  for (let d=1; d<=1000; d++) P.routeFor(d, .8);
  assert.equal(JSON.stringify(P.CHAPTERS), before, '纯函数不能修改章节配置');
  assert.deepEqual(P.STAGES.map(s => s.key), ['village','suburb','city']);
});

test('每城五个街区拥有独立颜色与招牌，不复用固定东京招牌', () => {
  assert.equal(P.CHAPTERS.length, 3);
  assert.equal(new Set(P.CHAPTERS.map(c => c.sky.join())).size, 3);
  assert.deepEqual(P.CHAPTERS.map(c => c.skyTime), ['dusk','night','dawn']);
  assert.deepEqual(P.CHAPTERS.map(c => c.weather.key), ['rain','storm','fog']);
  assert.equal(new Set(P.CHAPTERS.map(c => c.weather.label)).size, 3);
  for (const c of P.CHAPTERS) {
    assert.equal(new Set(c.districts.map(d => d.name)).size, 5);
    assert.equal(new Set(c.districts.map(d => d.color)).size, 5);
    assert.equal(new Set(c.districts.map(d => d.signs.join())).size, 5);
    assert.equal(c.landmarks.length, 3);
    if (c.key === 'newyork') assert(c.districts.every(d => d.signs.every(s => /^[A-Z0-9 /]+$/.test(s))));
  }
});

test('v3/v4 旧档区域、资源与 world.stage 原样保留，不写章节字段', () => {
  for (const version of [3,4]) for (const district of [5,6,10,11,15,16,100]) {
    const old = {...P.defaults(),version,district,level:1,energy:7654,meters:9200,cleared:97,kills:31,seed:789,
      world:{district,stage:'city',x:3280,buildings:[{id:'1-0',hp:390,max:780,dead:false}],enemies:[{id:'gate',hp:67,state:'alive'}]}};
    const copy = JSON.stringify(old), e = new P.Economy(old);
    P.chapterFor(e.data.district); P.routeFor(e.data.district);
    const restored = new P.Economy(JSON.parse(e.serialize(Date.now(), e.data.world)));
    for (const key of ['district','level','energy','meters','cleared','kills','seed']) assert.equal(restored.data[key], old[key], key);
    assert.deepEqual(restored.data.world, old.world);
    assert.equal(Object.hasOwn(restored.data, 'chapter'), false);
    assert.equal(Object.hasOwn(restored.data, 'currentChapter'), false);
    assert.equal(JSON.stringify(old), copy, '读取不能改动传入的旧档');
  }
});

test('实际 doStomp 消费 Growth.spineBonus 返回值，范围变大但伤害不变', () => {
  // 数值由主代理的 growth.js 提供；这里用接口桩检查调用方，不复制成长公式。
  for (const seismic of [false,true]) for (const level of [14,15,100]) {
    const base = seismic ? 576 : 360, morph = {stompBoost:.25}, calls = [];
    const buildings = [.9,1.1,1.26].map(f => ({x:1000+base*f,hp:1000,dead:false}));
    const enemies = [.9,1.1,1.26].map(f => ({x:1000+base*f,hp:1000,type:'tank',state:'alive'}));
    const env = {
      economy:{power:()=>100,has:()=>seismic},data:{level,morph},p:{x:1000},G:590,
      Growth:{spineBonus:(l,m)=>{calls.push([l,m]);return level===14?0:.25;}},
      buildings,enemies,rings:[],alive:e=>e.state==='alive',explosion(){},burst(){},broadcast(){},
      damageBuilding:(b,n)=>{b.hp-=n;},damageEnemy:(e,n)=>{e.hp-=n;},
    };
    vm.runInNewContext(functionSource('doStomp','doRoar')+';doStomp();',env);
    assert.equal(calls.length, 1);assert.equal(calls[0][0],level);assert.equal(calls[0][1],morph);
    assert.equal(buildings[0].hp,1000-(seismic?340:170));assert.equal(enemies[0].hp,720);
    assert.equal(buildings[1].hp,level===14?1000:1000-(seismic?340:170));
    assert.equal(enemies[1].hp,level===14?1000:720);
    assert.equal(buildings[2].hp,1000);assert.equal(enemies[2].hp,1000);
  }
});

test('像素地标与路面三城绘制分支不同，地标整段保持在视口内', () => {
  const signatures = [];
  for (const district of [1,6,11]) {
    const commands = [], r = P.routeFor(district);
    const env = {currentChapter:()=>r.chapter,currentRoute:()=>r,camera:0,W:1280,H:720,G:590,
      rect:(...args)=>commands.push(['rect',...args]),line:(...args)=>commands.push(['line',...args]),poly:(...args)=>commands.push(['poly',...args]),text:(...args)=>commands.push(['text',...args])};
    vm.runInNewContext(functionSource('drawChapterLandmarks','drawVillageGround'),env);
    for (const camera of [0,2100,4200]) {
      env.camera=camera;commands.length=0;env.drawChapterLandmarks();
      const rects=commands.filter(c=>c[0]==='rect');
      assert(rects.length>20,'每城必须有真实像素轮廓，不仅文字');
      assert(rects.every(c=>c.slice(1,5).every(Number.isFinite)));
      assert(rects.some(c=>c[1]>=700&&c[1]+c[3]<=1280&&c[2]<200),'地标上部必须持续可见');
    }
    env.drawChapterGround();signatures.push(JSON.stringify(commands));
  }
  assert.equal(new Set(signatures).size,3);
});

test('三城拥有不同天空时段与天气表现，且天气绘制读取章节配置', () => {
  const signatures = [];
  for (const district of [1, 6, 11]) {
    const commands = [], r = P.routeFor(district);
    const env = {
      currentChapter: () => r.chapter, camera: 0, time: 3, G: 590, W: 1280, H: 720,
      lightning: .2, bolt: [[100, 0], [120, 80]],
      ctx: { globalAlpha: 1 },
      rect: (...args) => commands.push(['rect', ...args]),
      line: (...args) => commands.push(['line', ...args]),
    };
    vm.runInNewContext(functionSource('drawWeather','drawCampaignRoute') + ';drawWeather();', env);
    assert(commands.length > 0, '每张地图必须绘制天气层');
    signatures.push(JSON.stringify(commands));
  }
  assert.equal(new Set(signatures).size, 3);
});

/* 路线条（2026-09-20 第二版）：只有一条进度条，**一个字的文案都没有**。
 *
 * 上一版是"底板 + 标题 + 5 个 30px 节点方块 + 右栏三行 18px 文字"的 1010×132 大块，
 * 主人反馈「上面这段信息不好看，简化成一个进度条就好了，文字都去掉，可以靠上一点」。
 * 所以「零文案」和「压在画面顶部 40px 以内」在这条测试里是**版面契约**，不是风格偏好：
 * 谁想往这条进度条上加文字、或者把它再往下挪回画面中部，都会红。
 *
 * 三条老 bug 的守护仍然保留（2026-09-18 主人报的"进度条不在正确的节点里、
 * 推图指示不亮、一直停在第一章"）：
 *   · 填充起点必须跟着当前节点走 —— 宽度里不含 index 的话，站在第 2 个区、
 *     本区推进 0% 时条子也会从最左边铺开，看着像"快到章末了"；
 *   · **正在推进的那一段必须是亮的**（填街道色），不能只有走过的段绿；
 *   · 未到的段必须是暗的。 */
test('路线条是一条无文案的进度条，靠上、居中、填充跟着当前节点走', () => {
  const draw = (district, progress, gate) => {
    const r = P.routeFor(district, progress), texts = [], rects = [];
    const env = { currentRoute: () => r, bossChallengeAvailable: () => gate, W: 1280,
      ctx: { save() {}, restore() {} }, rect: (...a) => rects.push(a), text: (...a) => texts.push(a) };
    vm.runInNewContext(functionSource('drawCampaignRoute', 'render') + ';drawCampaignRoute();', env);
    return {
      r, texts, rects, seg: 560 / 5,
      fill: rects.filter(a => a[4] === r.street.color),
      green: rects.filter(a => a[4] === '#70e7b0'),
      ticks: rects.filter(a => a[2] === 2 && a[3] === 8 && a[4] === '#071225e6'),
      red: rects.filter(a => a[4] === '#ff7780'),
      base: rects.find(a => a[4] === '#2b3d52'),
    };
  };

  const mid = draw(2, .5, null);            // 第 2 区（index 1），本区推进 50%
  assert.equal(mid.r.index, 1);

  // ① 零文案 —— 这次改动的核心
  assert.equal(mid.texts.length, 0, '进度条上还有文字，主人已经裁定全部去掉');
  assert.equal(draw(5, .5, { district: 6 }).texts.length, 0, '开闸时也不许有文字');

  // ② 靠上 + 居中：全部图形压在 y≤40，条身水平居中
  assert.ok(mid.rects.every(a => a[1] + a[3] <= 40), '进度条跑出画面顶部 40px 了');
  assert.ok(mid.base, '找不到进度条底条');
  assert.equal(mid.base[0] + mid.base[2] / 2, 640, '进度条不再水平居中');
  assert.equal(mid.base[1], 26, '条身基线不再是 y=26');

  // ③ 5 段结构留在条上：4 条刻度缝，代替原来的 30px 节点方块
  assert.equal(mid.ticks.length, 4, '刻度缝不是 4 条（5 段应有 4 个分界）');

  // ④ 填充起点跟着当前节点走（老 bug：从最左边铺开）
  assert.equal(mid.fill.length, 1, '当前段的填充不是唯一一条');
  assert.equal(mid.fill[0][0], 360 + 1 * mid.seg + 1, '填充没有从当前节点（第 2 个）之后开始');
  assert.ok(Math.abs(mid.fill[0][2] - (mid.seg - 2) * .5) < 1e-9, '填充长度不是段宽的 50%');

  // ⑤ 只有走过的段是绿的；正在推进的那一段必须亮
  assert.equal(mid.green.length, mid.r.index, '绿色段数必须等于走过的区数');
  assert.equal(draw(3, .2, null).green.length, 2, '第 3 区应有两段绿');

  // ⑥ 本章最后一个区（index 4）：第 5 段照样能填，不再有"章末出口"特例
  const last = draw(5, .5, null);
  assert.equal(last.r.index, 4);
  assert.equal(last.green.length, 4, '第 5 区时前 4 段该是绿的');
  assert.equal(last.fill[0][0], 360 + 4 * last.seg + 1, '第 5 段的填充起点不对');
  assert.ok(Math.abs(last.fill[0][2] - (last.seg - 2) * .5) < 1e-9, '第 5 段的推进度没填在段内');

  // ⑦ 开闸 → 整条描红边（替代原来的节点红框）；未开闸一条红都不许有
  assert.equal(draw(5, 1, { district: 6 }).red.length, 4, '已开闸时该有四条红边围成一圈');
  assert.equal(mid.red.length, 0, '未开闸不许出现红边');
});

/* 关卡前进按钮的文案。
 *
 * 改前是 `'进入 ' + 下一区所在章的标题`：站在大阪的第 1–4 区时按钮写着
 * "进入 第一章 · 大阪" —— 和"我已经在大阪"自相矛盾，玩家读到的就是"推图卡住了"。
 * 现在跨章才点名章节，章内点名下一区街道。 */
test('关卡前进按钮文案：章内点名下一区街道，跨章才点名章节', () => {
  const fn = functionSource('nextMapLabel', 'appendWorldChunk');
  assert.ok(fn.includes('nextMapLabel'), 'game.js 里找不到 nextMapLabel');
  const label = (target, from) => vm.runInNewContext(fn + ';nextMapLabel(' + target + ',' + from + ')', { P });

  assert.equal(label(2, 1), '进入 通天阁商店街');
  assert.equal(label(3, 2), '进入 道顿堀灯街');
  assert.equal(label(5, 4), '进入 大阪港仓库街');
  assert.equal(label(6, 5), '进入第二章-东京');
  assert.equal(label(11, 10), '进入第三章-纽约');
  // 纽约每五区续轮：16 区仍是纽约，所以只报街区名，绝不报出一个"第四章"
  assert.equal(label(16, 15), '进入 布鲁克林桥街');
  assert.ok(!label(16, 15).includes('第四'), '纽约续轮不许凭空造出第四章');

  // 同章内的每一档都必须正好是下一区的街区名 —— 一个章号都不许出现
  for (let d = 1; d <= 15; d++) {
    const to = P.chapterFor(d + 1);
    if (to.key !== P.chapterFor(d).key) continue;
    assert.equal(label(d + 1, d), '进入 ' + to.districts[d % 5].name,
      `第 ${d} 区推进时按钮报出了所在章的名字，和"我已经在这一章"自相矛盾`);
  }
});
