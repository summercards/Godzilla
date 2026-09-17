const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {Economy,STATS,SKILLS,TALENT_RINGS,TALENT_NODES,TALENT_BY_ID,RING_GATE,MUTATIONS,MUTATION_BY_ID,RARITY,RARITY_BY_KEY,FACE_WEIGHTS,EPOCHS,epochIndexFor,globalScaleFor,STAGES,stageIndexFor,hashSeed,mulberry32,mutateFor,rarityTableFor,Ke,Kb,xpPerEnemy,xpPerBuilding,xpPerDistrict,sanitize}=require('../progression.js');
const Rig=require('../rig.js');
/* 页面按 index.html 的顺序加载这两个模块，沙箱必须照抄，
 * 否则 game.js 里的资产索引 / 形态解算会凭空是 undefined。 */
const Assets=require('../assets/asset-index.js'),Appearance=require('../appearance.js');
/* growth.js 是体型的唯一真源，game.js 通过 window.KaijuGrowth 读它；沙箱必须一起注入。 */
const Growth=require('../growth.js');
let e=new Economy();assert.equal(e.speed(),38,'heavier initial walking speed');e.data.levels.stride=4;assert.equal(e.speed(),46,'stride upgrades still improve speed');e.data.levels.stride=1;assert(e.upgrade('power'));assert.equal(e.data.levels.power,2);e.data.energy=0;let before=e.data.energy;assert(!e.upgrade('atomic'));assert.equal(e.data.energy,before);e.data.dna=9;assert(!e.unlock('meltdown'),'prerequisite enforced');assert(e.unlock('pierce'));assert(e.unlock('chain'));assert(e.unlock('meltdown'));assert(!e.unlock('meltdown'));e.data.energy=10000;e.data.policy='atomic';assert.equal(e.data.auto,true,'default is auto-managed');e.autoSpend();assert(e.data.levels.atomic>1,'default auto-spends nuclear reserves');let ecOff=new Economy({version:4,auto:false,energy:10000,policy:'atomic'});ecOff.autoSpend();assert.equal(ecOff.data.energy,10000,'auto=false preserves nuclear reserves');
let off=new Economy();off.data.lastSeen=Date.now()-12*3600*1000;let report=off.offline(Date.now());assert.equal(report.seconds,28800);assert(report.capped);assert.equal(off.offline(Date.now()),null,'offline credit cannot duplicate');let saved=new Economy(JSON.parse(off.serialize(Date.now(),{x:900})));assert.equal(saved.data.energy,off.data.energy);assert.equal(saved.data.world.x,900);let bad=new Economy({version:3,energy:-5,levels:{power:-2},level:'oops',dna:NaN,skills:['hack']});assert.equal(bad.data.energy,0);assert.equal(bad.data.levels.power,1);assert.deepEqual(bad.data.skills,[]);console.log('PASS economy: upgrade pricing, prerequisites, policies, save, offline cap and sanitization');
let pose1=Rig.pose({x:400,ground:590,moving:true,step:0,action:{name:'walk',t:0}},0),pose2=Rig.pose({x:400,ground:590,moving:true,step:1.5,action:{name:'walk',t:0}},1);assert.notEqual(pose1.bones.shin.a,pose2.bones.shin.a);assert.notEqual(pose1.bones.tail_tip.a,pose2.bones.tail_tip.a);for(let name of ['claw','beam','stomp','roar','tail']){let pose=Rig.pose({x:400,ground:590,step:0,angle:.3,action:{name,t:.7}},1);assert(Object.values(pose.bones).every(b=>Number.isFinite(b.x)&&Number.isFinite(b.y)&&Number.isFinite(b.a)));}console.log('PASS rig: independent limb motion, parent transforms and all animation states');
let nodes=new Map(),listeners={},storage=new Map();let grad={addColorStop(){}};let ctx=new Proxy({createLinearGradient:()=>grad},{get:(t,k)=>k in t?t[k]:(()=>{}),set:(t,k,v)=>(t[k]=v,true)});function node(id){if(!nodes.has(id)){let el={style:{setProperty(){}},dataset:{},classList:{toggle(){},add(){},remove(){}},setAttribute(){},getContext:()=>ctx,hidden:false,textContent:'',innerHTML:'',disabled:false,querySelector:()=>({textContent:'',style:{setProperty(){}}}),querySelectorAll:()=>[]};nodes.set(id,el);}return nodes.get(id);}
class ImageMock{set src(v){this.complete=true;this.naturalWidth=300;this.naturalHeight=300;queueMicrotask(()=>this.onload?.());}}
let randomSeed=76123;const testMath=Object.create(Math);testMath.random=()=>{randomSeed=(Math.imul(randomSeed,1664525)+1013904223)>>>0;return randomSeed/4294967296;};
const window={IdleProgression:{Economy,STATS,SKILLS,TALENT_RINGS,TALENT_NODES,TALENT_BY_ID,RING_GATE,MUTATIONS,MUTATION_BY_ID,RARITY,RARITY_BY_KEY,FACE_WEIGHTS,EPOCHS,epochIndexFor,globalScaleFor,STAGES,stageIndexFor,hashSeed,mulberry32,mutateFor,rarityTableFor,Ke,Kb,xpPerEnemy,xpPerBuilding,xpPerDistrict,sanitize},KaijuRig:Rig,KaijuAssets:Assets,KaijuAppearance:Appearance,KaijuGrowth:Growth,addEventListener:(k,f)=>listeners[k]=f};let sandbox={window,KaijuRig:{...Rig,Skeleton:class{constructor(parts){this.parts=parts;this.ready=true;this.loaded=Promise.resolve(true);}draw(){}},FinRenderer:class{draw(){}}},KaijuAssets:Assets,KaijuAppearance:Appearance,KaijuGrowth:Growth,console,Math:testMath,Set,Array,Map,Date,String,Number,Image:ImageMock,document:{getElementById:node,createElement:()=>node(Math.random()),hidden:false,addEventListener:(k,f)=>listeners[k]=f,body:{classList:{toggle(){}}}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},performance:{now:()=>0},requestAnimationFrame(){},setTimeout(fn){fn();return 0;}};
let src=fs.readFileSync(require('node:path').join(__dirname,'../game.js'),'utf8').replace(/\}\)\(\);\s*$/,`window.test={frame,update,render,save,generateWorld,defeat,crash,begin,damageBuilding,worldSnapshot,broadcast,get breakCd(){return breakingCd;},get state(){return {data,p,buildings,enemies,crashCount,particles,fires,beam,rigState,news,economy};}};})();`);vm.runInNewContext(src,sandbox);let api=window.test;assert.equal(api.state.data.auto,true,'factory default must be auto-managed, otherwise nothing grows while idling');api.state.data.auto=true;
let main=api.state.buildings.find(b=>b.layer===1);assert(main.max>=780);api.damageBuilding(main,api.state.economy.power(),'claw');api.damageBuilding(main,api.state.economy.power(),'claw');assert(!main.dead&&main.hp>main.max*.7,'main building survives repeated initial claws');
let currentSave=api.worldSnapshot(),ratio=main.hp/main.max,id=main.id;api.generateWorld(currentSave);assert(Math.abs(api.state.buildings.find(b=>b.id===id).hp/api.state.buildings.find(b=>b.id===id).max-ratio)<1e-9,'new save preserves damage ratio');
api.generateWorld({district:1,x:420,buildings:[{id,hp:115,dead:false},{id:'1-1',hp:0,dead:true}]});main=api.state.buildings.find(b=>b.id===id);assert.equal(main.hp/main.max,.5,'legacy save retains half damaged condition');assert(api.state.buildings.find(b=>b.id==='1-1').dead,'legacy ruins stay destroyed');api.generateWorld();
console.log('PASS tougher buildings: multiple hits, current save and legacy damage migration');
let seen=new Set(),crashSeen=false,counts={},previousAction=null;for(let i=0;i<(process.argv.includes('--long')?1800:600)*60;i++){api.update(1/60);seen.add(api.state.p.action.name);if(api.state.p.action!==previousAction){previousAction=api.state.p.action;counts[previousAction.name]=(counts[previousAction.name]||0)+1;}if(api.state.crashCount>0)crashSeen=true;if(i%1200===0)api.render();if(api.state.data.district>=(process.argv.includes('--long')?6:3))break;}
let s=api.state;console.log('IDLE RUN',JSON.stringify({district:s.data.district,level:s.data.level,buildings:s.data.cleared,kills:s.data.kills,crashes:s.crashCount,stats:s.data.levels,skills:s.data.skills,actions:[...seen],counts}));assert(s.data.district>=2,'autonomous progression clears first district');assert(s.data.level>=3,'combat XP accumulates levels');assert(s.data.cleared>40);assert(s.data.skills.length>=1);assert(s.data.levels.power+s.data.levels.atomic+s.data.levels.metabolism+s.data.levels.stride>4,'auto-managed run must actually spend on upgrades');assert(crashSeen,'airborne destruction reaches ground explosion');for(let name of ['walk','claw','beam','stomp','roar','tail'])assert(seen.has(name),'AI selects '+name);assert(s.p.x>400);assert(s.p.hp===undefined,'player has no health/death mechanic');api.save();let payload=JSON.parse(storage.get('gnn-kaiju-idle-v3'));assert.equal(payload.world.district,s.data.district);assert(s.particles.length<=700);assert(s.fires.length<=60);console.log('PASS autonomous world: districts, skills, all attacks, airborne crashes, persistence, bounded particles');
assert((counts.claw||0)+(counts.stomp||0)+(counts.tail||0)>(counts.beam||0)*3,'melee dominates automatic combat');console.log('PASS combat pacing: melee actions exceed laser casts by more than 3 to 1');
/* 加点不自动花（见 progression.js autoSpend），所以电视主界面必须自己常驻显示未花点数 ——
 * 否则玩家挂机回来在主界面看不到"有几点没花"，保留纯手动的产品决定就落空了。 */
let hb=nodes.get('assignHudBadge');assert(hb,'HUD assign badge element exists in index.html');assert(Number(hb.textContent)>0&&hb.hidden===false,'HUD badge shows pending assign points without opening the panel');console.log('PASS HUD badge: unspent assign points are visible on the TV main screen');
/* 帧时序死区回归（P1-2）：wallDt 必须覆盖真实流逝的全部时间。
 * 造慢帧 0.2s/帧（低于 3s 长停顿阈值）——旧实现把 wallDt 钳到 0.15s，每帧丢 25%。
 * 清空世界让战斗不参与，passive() 恒定，于是 earned 增量可直接换算成"秒数"来对比。 */
let sc=api.state,autoWas=sc.data.auto;api.generateWorld();sc.buildings.length=0;sc.enemies.length=0;sc.data.auto=false;
let ft=1e6;api.frame(ft);   // 先喂一帧：模块级 last 初值为 0，首帧走的是 1/60 默认值，不能计入本次测量
let pRate=sc.economy.passive(),e0=sc.data.earned,lv0=sc.data.level;
for(let i=0;i<10;i++){ft+=200;api.frame(ft);}
let credited=(sc.data.earned-e0)/pRate;
assert.equal(sc.data.level,lv0,'no enemies and no buildings means no xp, so the level must stay put');
assert(Math.abs(credited-2)<1e-9,'10 slow frames of 0.2s must credit the full 2.000s of passive income, but only '+credited.toFixed(3)+'s was credited (a gap means real time is being dropped)');
sc.data.auto=autoWas;console.log('PASS frame timing: slow frames credit the full elapsed wall time, no dead zone (2.000s credited at 5fps)');
/* 同一缺陷的相邻区间：3~10s 的停顿原本也全额蒸发
 * —— offline() 对 <10s 直接 return null，而 wallDt 被强制成 1/60。 */
sc.data.lastSeen=Date.now();sc.data.auto=false;
let e1=sc.data.earned,p1=sc.economy.passive();api.frame(ft+5000);ft+=5000;
let stall=(sc.data.earned-e1)/p1;
assert(stall>4.5&&stall<=5.001,'a 5s stall must credit about 5s, but only '+stall.toFixed(4)+'s was credited (time silently dropped)');
sc.data.auto=autoWas;console.log('PASS frame timing: a 5s stall credits ~5s instead of being dropped ('+stall.toFixed(3)+'s)');
let a=s.enemies.find(x=>x.state==='alive');if(a){api.defeat(a,'claw');assert.equal(a.state,'flying');let oldKills=s.data.kills;api.defeat(a,'claw');assert.equal(s.data.kills,oldKills,'no duplicate kill reward');api.crash(a);assert.equal(a.state,'exploding');}console.log('PASS destruction: launch, crash transition and single reward');
api.state.data.skills=[];api.begin('beam',api.state.enemies[0]);assert.equal(api.state.p.cooldowns.beam,28,'base beam cooldown 28 s');api.state.data.skills=['overdrive'];api.begin('beam',api.state.enemies[0]);assert.equal(api.state.p.cooldowns.beam,21,'evolved beam cooldown 21 s');api.generateWorld();api.state.p.x=500;api.state.p.cooldowns={beam:0,stomp:0,tail:0,roar:0};api.update(1/60);assert.equal(api.state.p.action.name,'stomp','nearby destruction takes priority over ready laser');console.log('PASS laser cooldown and melee priority');
api.state.data.skills=SKILLS.map(s=>s.id);api.generateWorld();let red=0;for(let i=0;i<3;i++){api.begin('beam',api.state.enemies[2]);if(api.state.p.action.super)red++;for(let j=0;j<250;j++)api.update(1/60);}assert.equal(red,1,'meltdown fires every third cast');let boosted=new Economy({version:3,skills:['harvest','momentum','overdrive'],lastSeen:Date.now()-60000});assert.equal(boosted.offline(Date.now()).efficiency,.9);console.log('PASS final skill effects: third-cast red beam and 90% offline efficiency');
/* 突发新闻的编排闸门（2026-09-17 反馈：频率太高、释放技能时不该出现、
 * 一分钟左右一条差不多）。这里真跑行为，不看源码文字。
 *
 * 判据是"字幕条那条分支到底跑没跑"，用一个哨兵值读 #lowerThird.hidden：
 * 本沙箱把 setTimeout 换成了同步执行（见上面的 sandbox），所以只要那条
 * 分支跑了，hidden 一定会被写成 false 再被写成 true，哨兵必被冲掉；
 * 被闸门压下来的那条压根不碰它，哨兵原样留着。
 *
 * 先清空世界、关掉托管、把怪兽位置每轮钉回起点：既没有击杀、也没有区域
 * 突破，就不会有别的突发新闻插进来重新计时（同下面"帧时序"那段的做法）。
 * 位置必须钉住 —— p.x 越过 LENGTH-260 就是"突破城区"，那本身就是一条
 * 突发新闻，会把闸门重新拉满。这也是"闸门会衰减、隔满一分钟重新打开"
 * 能被确定地量出来的前提。 */
let keepAuto = api.state.data.auto, lt = node('lowerThird');
api.state.data.auto = false;
const drainBreak = () => { for (let i = 0; i < 61; i++) { api.state.p.x = 100; api.state.buildings.length = 0; api.state.enemies.length = 0; api.update(1, 1); } };
drainBreak();
assert.equal(api.breakCd, 0, '闸门必须随游戏时间衰减到 0，否则第一条突发新闻之后再也不会拉横幅，实测 ' + api.breakCd.toFixed(3));

lt.hidden = 'SENTINEL';
api.broadcast('甲','详情甲',true);
assert.equal(lt.hidden, true, '闸门开着时，突发新闻必须真的拉起字幕条');
assert.equal(api.breakCd, 60, '拉起字幕条之后闸门必须重置为 60 秒');

lt.hidden = 'SENTINEL';
api.broadcast('乙','详情乙',true);
assert.equal(lt.hidden, 'SENTINEL', '间隔内的第二条突发新闻被放行了：字幕条一直挂着就不叫"突发"了');
assert.equal(api.breakCd, 60, '被压下来的那条不许重置闸门');
assert(api.state.news.some(n=>n.title==='乙'), '被压下来的那条仍然要进现场档案，消息不能丢');

drainBreak();
lt.hidden = 'SENTINEL';
api.broadcast('丙','详情丙',true);
assert.equal(lt.hidden, true, '隔满一分钟之后的下一条突发新闻必须能重新拉起字幕条');
api.state.data.auto = keepAuto;

/* 技能释放：不拉突发条，但仍然进现场档案与滚动新闻条（消息不丢，只是不抢画面）。
 *
 * 测之前必须再把闸门放开 —— 闸门闭着的时候它本来就会把技能那条压住，
 * 于是"技能自己有没有申请 priority"根本测不出来。第一版就是这么写的，
 * 变异测试把 begin 那处的 true 改回去时它没变红，才发现判据被闸门挡住了。 */
drainBreak();
assert.equal(api.breakCd, 0, '技能断言之前闸门必须先归零，否则测不出技能自己申请没申请突发条');
lt.hidden = 'SENTINEL';
api.begin('beam', { x: api.state.p.x + 400 });
assert.equal(lt.hidden, 'SENTINEL', '释放原子吐息不该拉起突发新闻条');
/* 现场档案封顶 20 条，所以判据是"最新那条是不是这次吐息"，
 * 不能比长度（长度早就顶到上限了，涨不上去）。 */
assert(/(高能反应|红莲临界)/.test(api.state.news[0].title), '技能播报仍要进现场档案（它只是不抢画面），实际是「' + api.state.news[0].title + '」');
console.log('PASS breaking news: skill casts never raise the banner, other events are gated to one per minute');

