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

/* 路线条：轨道与 5 个节点必须**画在同一条线**上，填充的起点必须跟着当前节点走。
 *
 * 改前这条轨道是坏的，三种表现同一个根因（2026-09-18 主人报的"进度条不在正确的
 * 节点里、推图指示不亮、一直停在第一章"）：
 *   · 进度条另画在 y=65，和节点（y=44）不是一条线；
 *   · 填充宽度 (w+16)*progress 不含当前节点序号 —— 站在第 2 个区、本区推进 0%
 *     时条子也从最左边铺开；
 *   · 节点之间的连线只在 i<index 时变绿，**正在推进的那一段永远是暗的**。
 * 下面每一条都对着其中一个，回退任何一个都会红。 */
test('路线条与节点同线，填充跟着当前节点走，章末出口在最后一个区接管', () => {
  const draw = (district, progress, gate) => {
    const r = P.routeFor(district, progress), texts = [], rects = [];
    const env = { currentRoute: () => r, bossChallengeAvailable: () => gate, ctx: { save() {}, restore() {} },
      rect: (...a) => rects.push(a), text: (...a) => texts.push(a) };
    vm.runInNewContext(functionSource('drawCampaignRoute', 'render') + ';drawCampaignRoute();', env);
    // 轨道各段统一高 3（改前那条是 4），节点方块 14×14，开闸红圈 20×20
    return { r, texts, rects, nodes: rects.filter(a => a[2] === 14 && a[3] === 14), track: rects.filter(a => a[3] <= 4) };
  };

  const mid = draw(2, .5, null);           // 第 2 区（index 1），本区推进 50%
  assert.equal(mid.nodes.length, 5);
  assert.equal(mid.r.index, 1);

  // ① 同一条线：轨道必须落在节点方块的高度范围内
  const top = mid.nodes[0][1], bottom = top + mid.nodes[0][3];
  for (const a of mid.track) assert.ok(a[1] >= top && a[1] + a[3] <= bottom,
    `轨道 y=${a[1]}..${a[1] + a[3]} 跑到节点行（${top}..${bottom}）外面去了`);

  // ② 填充起点跟着当前节点，不是整个轨道的最左边
  const fill = mid.track.find(a => a[0] === 262 + 1 * 125 + 8 && a[4] === mid.r.street.color);
  assert.ok(fill, '本区推进的填充没有从当前节点（第 2 个）之后开始');
  assert.ok(Math.abs(fill[2] - 109 * .5) < 1e-9, '填充长度不是 step−2×gap 的 50%');

  // ③ 正在推进的那一段不是暗的，未到的段才是
  assert.equal(mid.track.filter(a => a[4] === '#70e7b0').length, mid.r.index, '只有走过的段是绿的');

  const last = draw(5, .5, null);          // 第 5 区（index 4），本章最后一个节点
  assert.ok(last.track.some(a => a[0] === 762 && a[2] === 40), '最后一个区没有通往下一章的出口');
  const exit = last.track.find(a => a[0] === 770 && a[4] === last.r.street.color);
  assert.ok(exit && Math.abs(exit[2] - 20) < 1e-9, '最后一个区的推进度必须填在章末出口里');
  assert.ok(last.texts.some(a => a[0] === '下一章 · 东京'), '跨章时右栏没有点名第二章');
  assert.ok(last.texts.some(a => a[0] === '下一城区 · 浅草灯笼街'));
  assert.ok(last.texts.some(a => a[0].includes('50%')));
  assert.ok(draw(2, .3, null).texts.some(a => a[0] === '本章 · 大阪'), '章内推进不该点名别的章');

  // ④ 已开闸：当前节点套红圈、右栏转红；未开闸一个红圈都不许有
  const ring = (d) => d.rects.filter(a => a[2] === 20 && a[3] === 20);
  const gated = draw(5, 1, { district: 6 });
  assert.equal(ring(gated).length, 1, '已开闸时当前节点要套一圈红');
  assert.equal(ring(gated)[0][4], '#ff7780');
  assert.ok(gated.texts.some(a => a[0] === '下一章 · 东京' && a[4] === '#ff7780'), '跨章且已开闸时右栏要转红');
  assert.equal(ring(last).length, 0, '未开闸不许出现红圈');
  // 红色只留给真的跨章：同章内开闸也变红的话，"可以切场景"这个信号就被稀释了
  assert.ok(draw(2, 1, { district: 3 }).texts.every(a => a[4] !== '#ff7780'),
    '同章内开闸不该出现跨章红');

  assert.ok(mid.rects.every(a => a[1] + a[3] <= 78), '路线条不能覆盖怪兽活动区');
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
