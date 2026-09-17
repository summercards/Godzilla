'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const A=require('../tv/appearance.js'),R=require('../tv/rig.js'),P=require('../tv/progression.js'),G=require('../tv/growth.js'),I=require('../tv/assets/asset-index.js');
const tv=path.resolve(__dirname,'../tv');
test('growth skins: all runtime bodies are fin-free and explicit original remains available',()=>{
 assert.equal(A.defaultSkin('godzilla').slots.torso.style,'default');
 const expected=['clean','jade','frost','ember','void'];
 for(let i=0;i<P.EPOCHS.length;i++)for(const p of Object.values(A.toParts(R.RIG,A.skinFor('godzilla',i,{})))){
  assert.equal(p.style,expected[i]);assert.ok(fs.existsSync(path.join(tv,p.src)));
  const bytes=fs.readFileSync(path.join(tv,p.src));assert.equal(bytes.readUInt32BE(16),p.width);assert.equal(bytes.readUInt32BE(20),p.height);
 }
 for(const [hue,style] of Object.entries({crimson:'ember',albino:'frost',jade:'jade',obsidian:'clean'})){
  assert.equal(A.skinFor('godzilla',4,{hue}).slots.torso.style,style);
 }
});
test('growth fins: L14 zero / L15 two, existing slots never shuffle and attach to real bones',()=>{
 const d=l=>A.decor({form:A.FORMS[P.epochIndexFor(l)],level:l,morph:{},talents:{}}).spikes;
 for(let l=1;l<15;l++){assert.equal(d(l).count,0);assert.equal(A.decor({level:l,morph:{spikes:9,spikeScale:1.6},talents:{spines:3}}).spikes.count,0);}
 assert.equal(d(15).count,2);assert.equal(d(27).count,3);assert.equal(d(99).count,9);
 assert.deepEqual(R.finSlots(3).slice(0,2),R.finSlots(2));
 for(const s of R.finSlots(30)){assert.ok(R.PARTS[s.bone]);assert.ok(Number.isFinite(s.x)&&Number.isFinite(s.y));}
 assert.ok(d(100).height>d(15).height);assert.equal(d(15).sprite,'crown');assert.equal(d(50).sprite,'crown');
 assert.equal(A.decor({level:15,morph:{spikeScale:1.2}}).spikes.sprite,'crown');
 assert.equal(G.spineCount(15),d(15).count);
});
test('fin sprite runtime anchors match the generated manifest',()=>{
 const m=require('../tv/assets/monsters/godzilla/fins/manifest.json');
 for(const [k,s] of Object.entries(I.MONSTERS.godzilla.finSprites)){
  assert.deepEqual(s.anchor,m.fins[k].anchor);assert.equal(s.path,m.fins[k].path);
  assert.ok(fs.existsSync(path.join(tv,I.dir.monster('godzilla'),s.path)));
 }
});
test('real fin renderer consumes count and gates all draw calls',async()=>{
 const calls=[];const c={width:1,height:1,getContext:()=>({drawImage(){},fillRect(){}})};
 class ImageMock{constructor(){this.complete=true;this.naturalWidth=218;this.naturalHeight=228;}set src(v){queueMicrotask(()=>this.onload());}}
 const root={KaijuMonsters:{godzilla:R.RIG},KaijuAssets:I,KaijuAppearance:A};
 vm.runInNewContext(fs.readFileSync(path.join(tv,'rig.js'),'utf8'),{window:root,Image:ImageMock,document:{createElement:()=>c},console});
 const f=new root.KaijuRig.FinRenderer();await f.loaded;
 const ctx={save(){},restore(){},translate(){},rotate(){},drawImage(...v){calls.push(v);}};
 const state=R.pose({x:420,ground:590,action:{name:'neutral',t:0}},0);
 for(const [level,n] of [[1,0],[14,0],[15,2],[27,3],[99,9]]){
  calls.length=0;const spec=A.decor({form:A.FORMS[P.epochIndexFor(level)],level}).spikes;
  f.draw(ctx,state,0,1,spec);assert.equal(calls.length,n,'render count at '+level);
 }
 assert.ok(f.cache.size<=4,'finite texture cache');
});
test('game actually consumes dynamic skins and independent fins, with no rectangular body tint',()=>{
 const s=fs.readFileSync(path.join(tv,'game.js'),'utf8');
 assert.match(s,/new KaijuRig\.Skeleton\(growthParts\(\)\)/);
 assert.match(s,/if\(request!==skinRequest\)return/);
 assert.match(s,/if\(next.ready\)skeleton=next/);
 assert.match(s,/fins.draw\(ctx,sk,camera,bs,decor.spikes\)/);
 assert.doesNotMatch(s,/if\(D.overlay\)/);
});
