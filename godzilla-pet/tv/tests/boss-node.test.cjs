const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const P=require('../progression.js');
const game=fs.readFileSync(path.join(__dirname,'../game.js'),'utf8');
const panelPreload=fs.readFileSync(path.join(__dirname,'../../panel-preload.js'),'utf8');

/* 「节点 → 锁存 → 按钮 → 降临 → 结算 → 下一区」全链路测试。
 * 口径（2026-09-20 现场核对 game.js 82-171 行）：
 *  - Boss 不自动出现，只能由「摧毁这块区域」按钮触发（requestNextMap）；
 *  - 节点锚点 nodeAnchorX() 跟着巨兽走（每段路 LENGTH 的段末回退 NODE_GUARD）；
 *  - 走进 NODE_APPROACH 即锁存 nodeArmed（随存档落盘），按钮从此常亮；
 *  - Boss 是唯一无重生实体：所有 enemies 回收过滤必须放 bossEntity 过去。
 * 任何一条破了，症状就是主人担心的那种：按钮永不亮 / Boss 永久丢失 / 节点永远到不了。 */
const LENGTH=4800,NODE_GUARD=390,NODE_APPROACH=970,NODE_LEAD=520,BOSS_IN_RANGE=580;
/* 与 game.js:258 的真实出怪保持同构（字段一个不差，gate 是 sentinel() 的判据）。 */
const makeBoss=x=>({x,y:590-180,type:'sentinel',state:'alive',phase:0,cd:2,hit:0,hp:2200,max:2200,gate:true,fixed:true,id:'boss-sentinel',introDone:false,introStarted:false,introTime:0});

function scenario(px=100){
  const env={P,LENGTH,G:590,console,
    data:{district:1,cleared:0,kills:0,dna:0,level:10,meters:0,xp:0,world:{},levels:{power:1,atomic:1,metabolism:1,stride:1}},
    p:{x:px},buildings:[],enemies:[makeBoss(LENGTH-NODE_GUARD)],
    alive:e=>e.state==='alive',
    saves:0,grants:[],
    save(){env.saves++;},banner(){},notice(){},hud(){},
    grant(a,b){env.grants.push([a,b]);},
    currentStage:()=>({key:'city',name:'城区核心'}),
    currentChapter:()=>P.chapterFor(env.data.district),
    generateWorld(){env.buildings.length=0;env.enemies.length=0;env.enemies.push(makeBoss(LENGTH-NODE_GUARD));env.p.x=0;}
  };
  const ctx=vm.createContext(env);
  const cut=(a,b)=>vm.runInContext(game.slice(game.indexOf(a),game.indexOf(b)),ctx);
  cut('function mapProgress()','function appendWorldChunk(');   // 节点/锁存/可用性/syncBossPost/nextMapLabel
  cut('function ensureWorldAhead()','function completeBossChallenge()'); // 回收过滤
  cut('function completeBossChallenge()','function advanceStage()');     // 结算与挑战入口
  const run=expr=>vm.runInContext(expr,ctx);
  return {env,run};
}

test('1 · 未到节点：按钮必须禁用，且点击无效',()=>{
  const {env,run}=scenario(100);
  assert.equal(run('nodeReached()'),false,'100 距节点 4410 差得远');
  assert.equal(run('bossChallengeAvailable()'),false);
  assert.equal(run('mapProgress()'),0,'没到节点就按拆楼/击破公式显示进度');
  assert.equal(run('requestNextMap()'),false,'按钮灰着时点击不应触发任何事');
  assert.equal(env.saves,0,'误点不该写盘');
});

test('2 · 临界差 1px 不亮：锁存判据是 >=，不是约等',()=>{
  const {run}=scenario(LENGTH-NODE_GUARD-NODE_APPROACH-1);
  assert.equal(run('nodeReached()'),false);
  assert.equal(run('bossChallengeAvailable()'),false);
});

test('3 · 走进 970px 内：锁存生效，按钮亮起，进度显示为已突破',()=>{
  const {run}=scenario(LENGTH-NODE_GUARD-NODE_APPROACH);
  assert.equal(run('nodeReached()'),true);
  run('armNodeGate()');
  assert.equal(run('nodeArmed'),true,'armNodeGate 必须锁存，不能只按位置判断');
  assert.equal(run('bossChallengeAvailable()'),true);
  assert.equal(run('mapProgress()'),1,'可挑战时进度恒为 1（mapProgress 的短路分支）');
});

test('4 · 不点按钮继续挂机：跨段后资格不丢、Boss 不被回收、自动钉到新段末',()=>{
  const {env,run}=scenario(LENGTH-NODE_GUARD-NODE_APPROACH); // 先走到节点
  run('armNodeGate()');                       // 锁存到手
  env.p.x=2*LENGTH+200;                       // 走进第三个区块
  run('worldChunk=9');                        // 跳过 while 铺图，只验证回收过滤
  run('ensureWorldAhead()');
  env.enemies.push({x:7000,y:590,type:'tank',state:'alive',id:'decoy',hp:1,max:1}); // 远处杂兵
  run('ensureWorldAhead()');
  assert.equal(env.enemies.some(e=>e.id==='decoy'),false,'远离的普通敌人照常回收');
  const boss=env.enemies.find(e=>e.type==='sentinel');
  assert.ok(boss&&env.alive(boss),'Boss 离得再远也必须被 bossEntity 放行');
  assert.equal(boss.x,run('nodeAnchorX()'),'syncBossPost 把 Boss 钉在当前段末');
  assert.equal(run('bossChallengeAvailable()'),true,'nodeArmed 锁存 → 按钮常亮，不走回头路');
  assert.equal(run('armNodeGate(),nodeArmed'),true,'重复 armNodeGate 幂等');
});

test('5 · 点下按钮：进入挑战、Boss 就位到降临起点、按钮熄灭、立即写盘',()=>{
  const {env,run}=scenario(LENGTH-NODE_GUARD-NODE_APPROACH);
  run('armNodeGate()');env.p.x=2*LENGTH+200;run('worldChunk=9');run('ensureWorldAhead()');
  const before=env.saves;
  assert.equal(run('requestNextMap()'),'challenge');
  const boss=env.enemies.find(e=>e.type==='sentinel');
  assert.equal(boss.x,env.p.x+NODE_LEAD,'armBossIntro 把 Boss 拉到画面外起跳点');
  assert.equal(run('bossChallengeStarted'),true);
  assert.equal(run('bossChallengeAvailable()'),false,'开战后按钮必须熄灭');
  assert.ok(env.saves>before,'requestNextMap 必须 save()（nodeArmed/挑战态落盘）');
  assert.equal(run('requestNextMap()'),false,'降临中重复点击无效，不会二次演出');
});

test('6 · 击杀结算：进下一区、发奖、闸门重置、新 Boss 驻守新段末',()=>{
  const {env,run}=scenario(100);
  run('armNodeGate()');
  env.data.cleared=50;env.data.kills=30;
  env.enemies.find(e=>e.type==='sentinel').state='falling';   // 坠落中的 Boss 不再可挑战
  assert.equal(run('bossChallengeAvailable()'),false);
  run('completeBossChallenge()');
  assert.equal(env.data.district,2);
  assert.equal(env.data.dna,2,'结算固定 +2 突变点');
  assert.deepEqual(env.grants,[[180+2*30,P.xpPerDistrict(2)]],'核能与经验按新区系数发放');
  assert.equal(run('nodeArmed'),false);
  assert.equal(run('bossChallengeStarted'),false);
  assert.equal(run('mapStartCleared'),50,'下一区从新基线重算推进度');
  const boss=env.enemies.find(e=>e.type==='sentinel');
  assert.ok(boss&&env.alive(boss)&&boss.gate,'generateWorld 必须重新部署带 gate 的 Boss');
  assert.equal(boss.x,LENGTH-NODE_GUARD);
  assert.equal(run('bossChallengeAvailable()'),false,'新区节点未到，按钮回到禁用');
});

test('7 · 存档契约：挑战态/锁存随档落盘，跨区读档不复活旧状态',()=>{
  const snap=game.slice(game.indexOf('function worldSnapshot()'),game.indexOf('function generateWorld('));
  assert.ok(snap.includes('bossChallengeStarted,nodeArmed'),'worldSnapshot 必须存挑战态与锁存');
  assert.ok(snap.includes("e.type==='sentinel'")&&snap.includes('introDone:e.introDone'),'Boss 自身与降临进度必须入快照');
  const restore=game.slice(game.indexOf('bossChallengeStarted=restore'),game.indexOf("bossChallengeStarted=restore")+260);
  assert.ok(restore.includes("restore?.district===data.district&&restore.bossChallengeStarted===true"));
  assert.ok(restore.includes("restore?.district===data.district&&restore.nodeArmed===true"),'锁存必须随档恢复，重启不丢资格');
  assert.ok(game.includes('updateEnemies(dt);armNodeGate();'),'armNodeGate 必须挂在每帧 update 上');
  assert.ok(game.includes('const challenge=bossChallengeAvailable()')&&game.includes('nextButton.disabled=!challenge'),"hud() 的按钮态只认 bossChallengeAvailable 这一个真源");
});

test('8 · 回收 tripwire：每一处 enemies 重赋值过滤都必须放行 bossEntity',()=>{
  // 2026-09-19 事故的直接根因：某处过滤漏放 Boss → 永久丢 Boss、按钮永不亮。
  const re=/enemies\s*=\s*enemies\.filter\(([^;]*)\);/g;let m,n=0;
  while((m=re.exec(game))){n++;assert.ok(/bossEntity\(/.test(m[1]),`第 ${n} 处 enemies 过滤漏了 bossEntity：${m[1].slice(0,80)}`);}
  assert.ok(n>=3,`至少应有三处回收过滤（区块回收/离场回收/濒死清理），实际 ${n} 处`);
  assert.ok(game.includes("enemies.filter(e=>bossEntity(e)||e.fixed&&e.x>p.x-2200)"),'worldSnapshot 的敌人快照也必须放行 Boss');
});

test('9 · 面板白名单两侧同集合：nextMap 在电视与面板两头都放行',()=>{
  assert.ok(/\|sound\|nextMap\)/.test(game),'game.js 的 valid 正则必须含 nextMap');
  assert.ok(/const FORWARD = [^\n]*nextMap/.test(panelPreload),'panel-preload 的 FORWARD 必须含 nextMap（09-18 就是这里丢过按钮）');
});
