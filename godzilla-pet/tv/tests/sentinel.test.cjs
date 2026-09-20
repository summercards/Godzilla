const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Boss=require('../sentinel.js'),Assets=require('../assets/asset-index.js');
const e={x:4410,state:'alive',phase:0,cd:3,hit:0,hp:2200,max:2200};
test('Boss bind pose reconstructs source-space joint positions at a shared scale',()=>{
 const r=Boss.RIG,b=Boss.pose(e,590,true).bones;
 for(const [name,s]of Object.entries(r.slots)){assert(Math.abs(b[name].x-(e.x+(s.pivot[0]-r.origin[0])*r.scale))<1e-8,name+' x');assert(Math.abs(b[name].y-(590+(s.pivot[1]-r.origin[1])*r.scale))<1e-8,name+' y');}
});
test('Boss animation keeps child joints attached and drives muzzle with the forearm',()=>{
 const r=Boss.RIG;const idle=Boss.pose(e),charged=Boss.pose({...e,cd:0});assert(Math.hypot(idle.muzzle.x-charged.muzzle.x,idle.muzzle.y-charged.muzzle.y)>40);
 for(const input of [e,{...e,cd:0},{...e,state:'falling',age:1.8}]){const b=Boss.pose(input).bones;for(const[name,s]of Object.entries(r.slots)){if(s.parent==='root')continue;const parent=r.slots[s.parent],len=Math.hypot(s.pivot[0]-parent.pivot[0],s.pivot[1]-parent.pivot[1])*r.scale;assert(Math.abs(Math.hypot(b[name].x-b[s.parent].x,b[name].y-b[s.parent].y)-len)<1e-8,name);}}
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
function simulation(){const calls={boom:0,save:0,hits:0},env={bossChallengeStarted:true,BOSS_IN_RANGE,window:{SentinelBoss:Boss},G:590,BS:.34,p:{x:4250},rings:[],particles:[],buildings:[],shake:0,slow:0,hitFlash:0,clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),banner(){},sound(k){if(k==='boom')calls.boom++;},save(){calls.save++;},burst(){calls.hits++;},shoot(){},KaijuRig:require('../rig.js')};vm.runInNewContext(game.slice(game.indexOf('function updateSentinel('),game.indexOf('function drawSentinel(')),env);return {env,calls,step:env.updateSentinel};}
test('Entrance impact fires once across variable dt; completion persists and does not replay',()=>{
 const {step,calls}=simulation(),boss={...e,introDone:false,introStarted:false,introTime:0};
 step(boss,.6);assert.equal(calls.boom,0);step(boss,1.1);assert.equal(calls.boom,1);step(boss,.8);assert.equal(calls.boom,1);step(boss,2);assert(boss.introDone);assert.equal(calls.save,1);step(boss,.05);assert.equal(calls.boom,1);
});
test('Melee telegraph, single contact, recovery, and interruption do not emit early or duplicate impacts',()=>{
 const {env,step,calls}=simulation(),boss={...e,introDone:true,cd:1.4};step(boss,.01);assert.equal(boss.meleeTime,0);assert.equal(calls.hits,0);
 step(boss,.6);assert.equal(calls.hits,0);step(boss,.2);assert.equal(calls.hits,1);assert(env.p.stagger>0,'fist overlaps actual juvenile hitbox');step(boss,.1);assert.equal(calls.hits,1);step(boss,1);assert.equal(boss.meleeTime,null);assert.equal(boss.cd,2.2);
 const dead=Boss.pose({...boss,state:'falling',age:.2,meleeTime:.7});assert(!dead.melee);
});
test('Entrance and melee IK preserve bone lengths; planted boots keep their orientation',()=>{
 for(const extra of [{introDone:false,introTime:1.72},{introDone:false,introTime:2.8},{meleeTime:.72,meleeTarget:{x:4311,y:529}}]){
  const pose=Boss.pose({...e,...extra}),b=pose.bones;
  for(const [upper,lower]of [['arm','forearm'],['far_arm','far_forearm'],['thigh','shin'],['far_thigh','far_shin']]){const a=Boss.RIG.slots[upper].pivot,c=Boss.RIG.slots[lower].pivot;assert(Math.abs(Math.hypot(b[upper].x-b[lower].x,b[upper].y-b[lower].y)-Math.hypot(a[0]-c[0],a[1]-c[1])*Boss.RIG.scale)<1e-7);}
  assert.equal(b.foot.a,0);assert.equal(b.far_foot.a,0);
 }
});
test('A waiting or arriving Boss is protected, an active Boss takes damage normally',()=>{
 const env={alive:e=>e.state==='alive',defeat(){}};
 vm.runInNewContext(game.slice(game.indexOf('function damageEnemy('),game.indexOf('function doClaw(')),env);
 const boss={...e,type:'sentinel',introDone:false};env.damageEnemy(boss,100,'beam');assert.equal(boss.hp,2200);boss.introDone=true;env.damageEnemy(boss,100,'claw');assert.equal(boss.hp,2100);
});
