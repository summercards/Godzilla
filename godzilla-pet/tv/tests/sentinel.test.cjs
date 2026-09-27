const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Boss=require('../sentinel.js'),Assets=require('../assets/asset-index.js');
const e={x:4410,state:'alive',phase:0,cd:3,hit:0,hp:2200,max:2200};
test('Boss bind pose reconstructs source-space joint positions at a shared scale',()=>{
 const r=Boss.RIG,b=Boss.pose(e,590,true).bones;
 for(const [name,s]of Object.entries(r.slots)){assert(Math.abs(b[name].x-(e.x+(s.pivot[0]-r.origin[0])*r.scale))<1e-8,name+' x');assert(Math.abs(b[name].y-(590+(s.pivot[1]-r.origin[1])*r.scale))<1e-8,name+' y');}
});
test('Boss animation keeps child joints attached and drives muzzle with the forearm',()=>{
 const r=Boss.RIG;const idle=Boss.pose(e),charged=Boss.pose({...e,beamTime:Boss.BEAM.charge});assert(Math.hypot(idle.muzzle.x-charged.muzzle.x,idle.muzzle.y-charged.muzzle.y)>40);
 for(const input of [e,{...e,beamTime:Boss.BEAM.charge},{...e,state:'falling',age:1.8}]){const b=Boss.pose(input).bones;for(const[name,s]of Object.entries(r.slots)){if(s.parent==='root')continue;const parent=r.slots[s.parent],len=Math.hypot(s.pivot[0]-parent.pivot[0],s.pivot[1]-parent.pivot[1])*r.scale;assert(Math.abs(Math.hypot(b[name].x-b[s.parent].x,b[name].y-b[s.parent].y)-len)<1e-8,name);}}
 assert.equal(charged.bones.shin.x,idle.bones.shin.x,'standing attack keeps feet planted');
});
test('Boss registered parts and generated rig match, and every texture exists',()=>{
 assert.deepEqual([...Assets.enemyUnit('sentinel').slots].sort(),Object.keys(Boss.RIG.slots).sort());
 for(const slot of Object.keys(Boss.RIG.slots))for(const kind of ['default',...(Boss.RIG.seams[slot]?['joint']:[])])assert(fs.existsSync(path.join(__dirname,'..',Assets.file.enemyPart('army','sentinel',slot,kind))));
});
const vm=require('node:vm');
const game=fs.readFileSync(path.join(__dirname,'../game.js'),'utf8');
/* updateSentinel 现在用 game.js 的 BOSS_IN_RANGE 判据（登场位 bossIntroLead 由它定上限），
 * 沙箱必须把它一起注入 —— 这里写死 1100 是**期望值**，改游戏侧常量时要一并改。 */
const BOSS_IN_RANGE=1100;
function simulation(){const calls={boom:0,save:0,hits:0,bursts:[]},env={bossChallengeStarted:true,BOSS_IN_RANGE,window:{SentinelBoss:Boss},G:590,BS:.34,p:{x:4250,recoil:0},rings:[],particles:[],buildings:[],shake:0,slow:0,hitFlash:0,clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),banner(){},sound(k){if(k==='boom')calls.boom++;},save(){calls.save++;},burst(x,y){calls.hits++;calls.bursts.push({x,y});},shoot(){},KaijuRig:require('../rig.js'),bossRequiredLead:()=>300,bossFrontGap:e=>e.x-Boss.LEFT_REACH-require('../rig.js').hitbox(env.BS,env.p.x,env.G).x1};vm.runInNewContext(game.slice(game.indexOf('function kaijuCenter('),game.indexOf('function drawSentinel(')),env);return {env,calls,step:env.updateSentinel};}
test('Entrance impact fires once across variable dt; completion persists and does not replay',()=>{
 const {step,calls}=simulation(),boss={...e,introDone:false,introStarted:false,introTime:0};
 step(boss,Boss.INTRO.cutin-.1);assert.equal(calls.boom,0,'title film must precede the drop');step(boss,1.8);assert.equal(calls.boom,1);step(boss,.8);assert.equal(calls.boom,1);step(boss,2);assert(boss.introDone);assert.equal(calls.save,1);step(boss,.05);assert.equal(calls.boom,1);
});
test('Melee telegraph, single contact, recovery, and interruption do not emit early or duplicate impacts',()=>{
 const {env,step,calls}=simulation(),boss={...e,introDone:true,cd:1.4};step(boss,.01);assert.equal(boss.meleeTime,0);assert.equal(calls.hits,0);
 const move=Boss.meleeSpec(boss);step(boss,move.hit-.1);assert.equal(calls.hits,0);step(boss,.2);assert.equal(calls.hits,2);assert(env.p.stagger>0,'forward attack uses horizontal reach regardless of juvenile height');assert(env.shake>0&&env.p.recoil>0&&env.hitFlash>0);step(boss,.1);assert.equal(calls.hits,2);step(boss,move.duration);assert.equal(boss.meleeTime,null);assert.equal(boss.cd,2.2);
 const dead=Boss.pose({...boss,state:'falling',age:.2,meleeTime:.7});assert(!dead.melee);
});
test('Entrance and melee IK preserve bone lengths; planted boots keep their orientation',()=>{
 for(const extra of [{introDone:false,introTime:Boss.INTRO.cutin+1.72},{introDone:false,introTime:Boss.INTRO.cutin+2.8},...Boss.MELEES.map(m=>({meleeTime:m.hit,meleeKind:m.id}))]){
  const pose=Boss.pose({...e,...extra}),b=pose.bones;
  for(const [upper,lower]of [['arm','forearm'],['far_arm','far_forearm'],['thigh','shin'],['far_thigh','far_shin']]){const a=Boss.RIG.slots[upper].pivot,c=Boss.RIG.slots[lower].pivot;assert(Math.abs(Math.hypot(b[upper].x-b[lower].x,b[upper].y-b[lower].y)-Math.hypot(a[0]-c[0],a[1]-c[1])*Boss.RIG.scale)<1e-7);}
  if(extra.meleeKind!=='kick')assert.equal(b.foot.a,0);assert.equal(b.far_foot.a,0);
 }
});
test('A waiting or arriving Boss is protected, an active Boss takes damage normally',()=>{
 const env={alive:e=>e.state==='alive',defeat(){}};
 vm.runInNewContext(game.slice(game.indexOf('function damageEnemy('),game.indexOf('function doClaw(')),env);
 const boss={...e,type:'sentinel',introDone:false};env.damageEnemy(boss,100,'beam');assert.equal(boss.hp,2200);boss.introDone=true;env.damageEnemy(boss,100,'claw');assert.equal(boss.hp,2100);
});
test('Five melee moves rotate in real AI and do not depend on player height',()=>{
 const {step,env}=simulation(),boss={...e,introDone:true,cd:0},seen=new Set();
 for(let i=0;i<1800;i++){step(boss,.05);if(boss.meleeTime!=null)seen.add(boss.meleeKind);}
 assert.equal(seen.size,5);assert.deepEqual([...seen],Boss.MELEES.map(m=>m.id));
 const signatures=new Set();
 for(const m of Boss.MELEES){
  const a=Boss.pose({...e,meleeTime:m.hit,meleeKind:m.id,meleeTarget:{x:4250,y:540}}),b=Boss.pose({...e,meleeTime:m.hit,meleeKind:m.id,meleeTarget:{x:4250,y:200}});
  assert.deepEqual(a.bones,b.bones,'height must not change '+m.id);assert(a.contact.y<590-200,'strike stays above the ground');
  signatures.add(JSON.stringify(Object.values(a.bones).map(v=>Math.round(v.a*100))));
 }assert.equal(signatures.size,5,'five different articulated silhouettes');
});
test('Cross beam uses perpendicular forearms and a held forward ray instead of aimed projectiles',()=>{
 const pose=Boss.pose({...e,beamTime:Boss.BEAM.charge+.2}),b=pose.bones;
 assert(Math.abs(pose.fist.x-b.forearm.x)<1e-6,'emitting forearm is vertical');
 assert(Math.abs(pose.farFist.y-b.far_forearm.y)<1e-6,'supporting forearm is horizontal');
 assert(pose.beamActive);assert(!Boss.pose({...e,beamTime:Boss.BEAM.charge-.01}).beamActive);
 const {env,step}=simulation();let projectiles=0;env.shoot=()=>projectiles++;const boss={...e,introDone:true,cd:0,attackCount:2};
 step(boss,.01);assert.equal(boss.beamTime,0);step(boss,1);assert(!boss.beamHit);step(boss,.6);assert(boss.beamHit);step(boss,2);assert.equal(boss.beamTime,null);assert.equal(projectiles,0);
});
test('Boss ray and impact follow the kaiju center at every body scale',()=>{
 const {env,step,calls}=simulation(),boss={...e,introDone:true,beamTime:Boss.BEAM.charge-.01};
 for(const scale of [.34,1,2]){
  env.BS=scale;env.p.recoil=0;env.hitFlash=0;boss.beamTime=Boss.BEAM.charge-.01;boss.beamHit=false;boss.beamImpactCd=0;
  const center=env.kaijuCenter(),box=env.KaijuRig.hitbox(scale,env.p.x,env.G);
  assert.equal(center.x,env.p.x);assert.equal(center.y,(box.y0+box.y1)/2);
  const before=calls.bursts.length;step(boss,.02);
  assert(boss.beamHit&&env.p.recoil>0&&env.hitFlash>0&&env.shake>0);
  assert(calls.bursts.slice(before).some(q=>q.x===center.x&&q.y===center.y),'beam sparks land on actual center');
 }
});
test('Every frame preserves elbow flexion, connected sockets and continuous rotations',()=>{
 const r=Boss.RIG,angle=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x),wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
 const clips=[...Boss.MELEES.map(m=>({duration:m.duration,sample:t=>({meleeTime:t,meleeKind:m.id})})),{duration:Boss.BEAM.duration,sample:t=>({beamTime:t})},{duration:Boss.INTRO.duration,sample:t=>({introDone:false,introTime:t})}];
 for(const clip of clips){let previous=null;
  for(let t=0;t<=clip.duration;t+=1/240){const p=Boss.pose({...e,...clip.sample(t)}),b=p.bones;
   for(const [upper,lower,end] of [['arm','forearm',p.fist],['far_arm','far_forearm',p.farFist]]){
    const flex=wrap(angle(b[lower],end)-angle(b[upper],b[lower]));
    assert(flex>=7*Math.PI/180&&flex<=141*Math.PI/180,'elbow must not invert or fold through the shoulder');
    const u=r.slots[upper],v=r.slots[lower],socket=Boss.point(b[upper],(v.pivot[0]-u.pivot[0])*r.scale,(v.pivot[1]-u.pivot[1])*r.scale);
    assert(Math.hypot(socket.x-b[lower].x,socket.y-b[lower].y)<1e-7,'elbow socket remains attached');
   }
   if(previous)for(const name of Object.keys(r.slots))assert(Math.abs(wrap(b[name].a-previous[name].a))<.18,'no instantaneous bone flip: '+name);
   previous=b;
  }
 }
});
test('Boss health bar is fixed beneath the route, broad, and proportional to actual HP',()=>{
 const boss={...e,type:'sentinel',introDone:true},rects=[],env={W:1280,bossChallengeStarted:true,sentinel:()=>boss,alive:e=>e.state==='alive',window:{SentinelBoss:Boss},clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),ctx:{save(){},restore(){}},rect:(...a)=>rects.push(a),text(){}};
 vm.runInNewContext(game.slice(game.indexOf('function drawBossHealth('),game.indexOf('function drawEnemy(')),env);
 env.drawBossHealth();const fill=rects.find(a=>a[4]==='#dc4b55');assert(fill[1]>40&&fill[1]+fill[3]<108);assert(fill[2]>=640&&fill[3]>=20);
 boss.x+=9999;boss.hp=boss.max/2;rects.length=0;env.drawBossHealth();const half=rects.find(a=>a[4]==='#dc4b55');assert.equal(half[0],fill[0]);assert.equal(half[1],fill[1]);assert.equal(half[2],fill[2]/2);
 boss.introDone=false;boss.introStarted=true;boss.introTime=Boss.INTRO.impact-.01;rects.length=0;env.drawBossHealth();assert.equal(rects.length,0);
 boss.introTime=Boss.INTRO.impact;env.drawBossHealth();assert(rects.length>0);boss.state='gone';rects.length=0;env.drawBossHealth();assert.equal(rects.length,0);
});
