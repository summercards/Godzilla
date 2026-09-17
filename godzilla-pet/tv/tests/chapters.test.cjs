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

test('路线条位于画布上方，五节点、当前进度和下一区文本真实绘制', () => {
  const r=P.routeFor(5,.5),texts=[],rects=[];
  const env={currentRoute:()=>r,ctx:{save(){},restore(){}},rect:(...args)=>rects.push(args),text:(...args)=>texts.push(args)};
  vm.runInNewContext(functionSource('drawCampaignRoute','render')+';drawCampaignRoute();',env);
  assert.equal(rects.filter(a=>a[2]===14&&a[3]===14).length,5);
  assert(rects.some(a=>a[2]===258&&a[3]===4),'当前区进度按 50% 绘制');
  assert(texts.some(a=>a[0].includes('东京')));assert(texts.some(a=>a[0].includes('浅草')));
  assert(texts.some(a=>a[0].includes('50%')));
  assert(rects.every(a=>a[1]+a[3]<=78),'路线条不能覆盖怪兽活动区');
});
