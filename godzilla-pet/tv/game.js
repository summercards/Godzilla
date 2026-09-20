'use strict';
(() => {
const $=id=>document.getElementById(id),canvas=$('game'),out=canvas.getContext('2d'),channelCanvas=$('channel'),channelCtx=channelCanvas.getContext('2d');
const buffer=document.createElement('canvas');buffer.width=640;buffer.height=360;const ctx=buffer.getContext('2d');ctx.imageSmoothingEnabled=out.imageSmoothingEnabled=false;
const W=1280,H=720,G=590,LENGTH=4800,SAVE='gnn-kaiju-idle-v3',P=window.IdleProgression;
/* 火焰 / 烟尘的体型缩放 —— 跟着体型走，但**锁在 25 级那一刻的大小**。
 *
 * 25 级 = 亚成体的起点（progression.js 的 EPOCHS 第二档），也就是"满 1 倍"
 * 的基准点。25 级以下照旧跟体型一起缩小（小巨兽配小火），一到 25 级封顶，
 * 再往上不长：裸档满级体型 1.60、叠满天赋予突变到 CEIL 2.24，火都不跟着。
 *
 * 为什么是"锁"而不是随手给个上限：
 *   2026-09-18 把体型上限从 1.12 提到 2.24 之后，粒子跟着放到 2.4 倍，
 *   满级拆楼整屏都是火、巨兽反被糊掉；09-19 先压到 1.25，反馈仍不对 ——
 *   要的是"参考 25 级满 1 倍的大小，锁死，不能再大"。
 * 所以基准不再拍数字，直接由 EPOCHS 推（= baseScale(25) = 0.58）：
 * 上限与体型上限是**两件事**，谁再动 growth.CEIL，这里一动都不动。
 *
 * 唯一出口是下面的 fxScale()：render 的火焰与 update 的烟尘都调它，
 * 别再各写一份 clamp —— 改一个漏一个就是"火小了烟还大"这种对不上的画面。 */
/* 存档进出的唯一出口。桌宠外壳用 contextBridge 把它接到文件上
 * （tv-preload.js / panel-preload.js 暴露的 __tvBridge.storage）；
 * 桥不在时 —— 直接用浏览器打开本页、或 build/tv-shot.cjs 那种不挂 preload
 * 的截图工具 —— 就落回真正的 localStorage，两种形态都能跑。
 * 注意桌面外壳里**不能**再用 localStorage 存档：那份数据是页面私有的，
 * 而且清一次缓存就没了，外壳的导出/备份也全都落空。 */
const SAVEIO=(window.__tvBridge&&window.__tvBridge.storage)||localStorage;
/* 资产位置与形态框架。ASSETS 提供路径与单位/建筑清单，Appearance 提供三轴解析。
 * 加载顺序见 index.html；两侧都是 UMD，Node 测试里由沙箱注入。 */
const ASSETS=window.KaijuAssets,Appearance=window.KaijuAppearance,Growth=window.KaijuGrowth;
/* 火焰 / 烟尘的缩放上限 = 25 级（亚成体起点，即"满 1 倍"）那一刻的体型。
 * 从 EPOCHS 推，不写数字；取的是**裸档**（不带天赋/突变）的大小 ——
 * 这是一条封顶线，主人要的是"锁死，不能再大"，不该随玩家加了多少突变往上飘。
 * 放在这一行是因为它要读 Growth 与 P，两者在上面刚就位。说明见文件开头。 */
const FX_LOCK_LEVEL=P.EPOCHS[1].min;
const FX_SCALE_MAX=Growth.bodyScale(FX_LOCK_LEVEL,null,null,P.EPOCHS);
const sentinelRenderer=new window.SentinelBoss.Renderer(Image);
let storageOK=true,raw=null;try{raw=JSON.parse(SAVEIO.getItem(SAVE)||'null');}catch{storageOK=false;}
const pageSearch=window.location?.search||'';
const panelMode=window.__panelMode===true||/([?&])panel=1(?:&|$)/.test(pageSearch);
const economy=new P.Economy(raw);let data=economy.data;
function growthParts(){return Appearance.toParts(KaijuRig.RIG,Appearance.skinFor('godzilla',economy.epochIndex(),data.morph),'godzilla');}
let skeleton=new KaijuRig.Skeleton(growthParts()),skinKey=economy.epochIndex()+':'+(data.morph.hue||'');
const fins=new KaijuRig.FinRenderer();let skinRequest=0;
function syncGrowthSkin(){const key=economy.epochIndex()+':'+(data.morph.hue||'');if(key===skinKey)return;skinKey=key;const request=++skinRequest,next=new KaijuRig.Skeleton(growthParts());next.loaded.then(()=>{if(request!==skinRequest)return;if(next.ready)skeleton=next;else console.error('成长皮肤加载失败',next.failures);});}
let browserPanel=null;
const panelKeys=['assign','talent','evo','stats','skills','news','settings'];
function requestPanel(key){
  if(window.__tvHost)return window.__tvHost.openPanel(key);
  if(!browserPanel||browserPanel.closed){
    const url=new URL(window.location.href);url.searchParams.set('panel','1');url.searchParams.set('tab',key);
    browserPanel=window.open(url.href,'gnn-control','popup,width=520,height=580');
  }
  if(!browserPanel){notice('请允许弹出独立功能窗口；直播不会被替换');return;}
  browserPanel.focus();
  try{browserPanel.__growth?.sync(JSON.stringify(data));browserPanel.__growth?.open(key);}catch{}
}
function panelCommand(payload){
  if(panelMode||!payload||typeof payload.id!=='string')return null;
  const id=payload.id;
  const valid=/^(assign-(power|atomic|metabolism|stride)|buy-(power|atomic|metabolism|stride)|up-(power|atomic|metabolism|stride)|assignSpread|assignAll|talentReset|rollEvo|auto|policy|sound|nextMap)$/.test(id)||P.TALENT_NODES.some(n=>id==='talent-'+n.id)||P.SKILLS.some(n=>id==='skill-'+n.id);
  if(!valid)return null;
  if(id==='nextMap'){const ok=requestNextMap();if(ok){hud();return id;}return null;}
  const el=$(id);if(!el||el.disabled)return null;
  if(id==='auto'){if(typeof payload.checked!=='boolean')return null;el.checked=payload.checked;el.onchange();}
  else if(id==='policy'){if(!['balanced','kinetic','atomic','evolution'].includes(payload.value))return null;el.value=payload.value;el.onchange();}
  else el.click();
  save();return id==='rollEvo'?el.__panelResult:null;
}
function sendPanelCommand(payload){
  if(window.__panelHost)return window.__panelHost.command(payload);
  try{const result=window.opener?.__growth?.command(payload);if(result)playDiceRoll(result);}catch{}
}
let mode='playing',time=0,last=0,camera=0,shake=0,flash=0,hitFlash=0,lightning=0,nextLightning=2.5,bolt=[],elapsed=0,zoom=1,slow=0,particles=[],rings=[],floaters=[],fires=[],bullets=[],buildings=[],enemies=[],wrecks=[],beam=null,arcs=[],news=[],saveTimer=0,uiTimer=0,headlineTimer=0,breakingCd=0,lowerThirdTimer=0,bannerTimer=0,noticeTimer=0,hiddenAt=0,spawnTimer=7,actionSequence=0,beamCount=0,crashCount=0,channel='live',channelNoise=0,channelFlash=0,sceneZoom=1.3;
let tickerOffset=0,tickerWidth=1200,headlineOffset=0,headlineWidth=600,headlineViewport=500,pendingTicker='',panelOpener=null;
let p={x:420,ground:G,dir:1,step:0,moving:false,angle:.12,action:{name:'walk',t:0},cooldowns:{beam:18,stomp:7,roar:19,tail:10},recoil:0,stagger:0};
const STAGES=P.STAGES;
const stageAt=P.stageIndexFor;
let stageIndex=Math.max(stageAt(data),0,STAGES.findIndex(s=>s.key===data.world?.stage));
function currentStage(){return STAGES[stageIndex];}
function currentChapter(){return P.chapterFor(data.district);}
function mapProgress(){return bossChallengeAvailable()?1:Math.min(1,Math.min(1,Math.max(0,data.cleared-mapStartCleared)/12)*.6+Math.min(1,Math.max(0,data.kills-mapStartKills)/8)*.4);}
function currentRoute(){return P.routeFor(data.district,mapProgress());}
function chapterLocation(){return currentChapter().title+' · '+currentRoute().street.name;}
function cityTitle(){return currentChapter().title;}
/* Boss 不再自动出现：走到节点时只开放「摧毁这块区域」，按下之后才把降临演出交给 updateSentinel。
 *
 * 节点**不是世界里的固定坐标**：地图是无限延伸的（区块流式，见 doc/游戏逻辑梳理.md 3.4），
 * 巨兽会一直往前走，写死的坐标必然被甩在身后。2026-09-19 的实机事故就是这么来的 ——
 * Boss 站在 LENGTH−390，主人挂机到 x≈96.7 万，它先被"离远了就回收"的过滤清出 enemies，
 * 于是 sentinel() 恒为空 → 按钮永不亮 → 节点永远到不了 → 巨兽在节点前无限前进。
 *
 * 现在的口径：每 LENGTH 是一段路（同 §3.1「一张地图的基准长度」），Boss 守在段末往回 NODE_GUARD；
 * 巨兽走到 NODE_APPROACH 之内就是"到了节点"，没按按钮继续往前走就换下一段 ——
 * 节点永远在巨兽前方，推图可以一直进行下去。下面这几个数只写这一份。 */
const NODE_GUARD=390,NODE_APPROACH=970;
/* Boss 倒地演出时长（秒）：defeat() 把它推入 'falling'，updateEnemies 用它判定
 * "该结算了"。**同时是换场雪花的时间轴基准** —— 世界替换必须落在雪花糊满屏幕的
 * 那个窗口里（见 SCENE_SWITCH 与 tests/scene-switch.test.cjs 的不变式）。 */
const BOSS_FALL=2.4;
/* 降临触发半径（世界 px）：Boss 落在巨兽这个距离之内，演出才会开始（updateSentinel 判据）。
 * 1100 是**上限**，实际登场位由 bossIntroLead() 按屏幕位置反解，永远比它小一截。 */
const BOSS_IN_RANGE=1100;
/* Boss 登场位：恒定落在画面横向 BOSS_SCREEN_X 处（右侧三分之一的中段）。
 *
 * 为什么不写死一个世界距离：镜头的绘制缩放 s = sceneZoom×0.8 从 1.04（幼兽，镜头拉近）
 * 一路降到 0.51（灾厄体，镜头拉远），同一个世界距离在屏幕上会漂近一倍 —— 写死就变成
 * "小体型在右边、大体型缩回中间"。所以按**目标屏幕位置**反解世界偏移：
 *
 *   世界偏移 = (目标屏 x − 巨兽屏 x) / s
 *   巨兽屏 x = p.x − cameraTarget()      // 相机稳态值，与 camera 是否已收敛无关
 *
 * 第三个约束：登场位必须落在 BOSS_IN_RANGE 之内，越过就是"点了没反应"的死档
 * （updateSentinel 的接近判据不成立 → 演出永不开始）。所以结果夹在
 * [120, BOSS_IN_RANGE−120]：下限保证不砸在巨兽身上，上限保证一定能触发。 */
const BOSS_SCREEN_X=0.80;
function bossIntroLead(){
  const s=Math.max(.2,sceneZoom*.8);
  const kaiju=p.x-cameraTarget();
  return clamp((W*BOSS_SCREEN_X-kaiju)/s,120,BOSS_IN_RANGE-120);
}
/* —— 关底（Boss）血量：按「目标击杀时长」反解，不是一个写死的基数 ——
 *
 * 为什么必须反解：Boss 是唯一"必须打赢才能继续"的实体，而这个产品没有血条、
 * 没有死亡、不引入失败状态 —— 所以它**不能被设计成打不过**。血量只能锚在
 * 巨兽自己的输出上，才能让每一档等级、每一种加点都稳定落在同一段时长里。
 *
 * 写死基数会随等级一路漂移。2026-09-20 实测（.workbuddy/_boss-ttk.cjs，
 * 无头沙箱真打一场，数帧数到 Boss 不再 alive）：
 *   LV10 / 第4区 / 全投力量   → 47.7s
 *   LV40 / 第12区 / 全投力量  → 15.1s（一次尾扫 7027 直接秒杀 6798 血）
 *   LV120/ 第27区 / 全投力量  → 15.1s（同上）
 * 后两档的时长等于**尾扫冷却**，和血量毫无关系 —— 越到后期越"没挑战"，
 * 正是主人这次反馈的现象。
 *
 * 参考每秒伤害只取**真能打到关底**的三个动作。关底停距在 340~520px（由巨兽
 * 体型与挡路建筑决定）：爪击 reach 135 够不着，长啸 850 够得着但权重很小、略去。
 * 权重一律写成「一次伤害 ÷ 一轮周期」，每一项都由别处的既有常量推出来：
 *   重踏 power×2.8 /（12s 冷却 + 1.68s 动作）
 *   尾扫 power×2.2 /（15s 冷却 + 1.65s 动作）
 *   吐息 atomic×2.6s 有效窗口 / 28s 冷却
 *
 * BOSS_TTK_CAL 是与实测对齐的标定系数：上面算的是"理想站桩输出"，实际还有走位、
 * 被挡路建筑拖住、被 Boss 重拳打断（p.stagger 会冻住动作计时），打折之后才落地。
 * 改这里的公式、或改上面那些冷却/倍率，**必须重跑 _boss-ttk.cjs 重新标定**。 */
const BOSS_HP_BASE=2200;   /* 双重身份：血量的下限，同时也是旧档迁移的换算基准（见 bossLegacyMax） */
const BOSS_TTK_TARGET=60,BOSS_TTK_CAL=.5,BOSS_TTK={stomp:2.8/13.68,tail:2.2/16.65,beam:2.6/28};
function bossRefDps(){return (economy.power()*(BOSS_TTK.stomp+BOSS_TTK.tail)+economy.atomic()*BOSS_TTK.beam)*BOSS_TTK_CAL;}
function bossMaxHp(){return Math.max(BOSS_HP_BASE,Math.round(bossRefDps()*BOSS_TTK_TARGET));}
/* 旧档迁移用的基准：改动前 Boss 血量是 `2200 × Ke(区) × (村庄 ×0.6)`。
 * 存档快照里只存了 hp、没存 max，所以回读时得靠它把"剩下的绝对血量"换算成比例，
 * 否则读一次旧档就会把血条当成满的。 */
function bossLegacyMax(district,village){return BOSS_HP_BASE*P.Ke(district)*(village?.6:1);}
/* —— 换场：电视转台式的全屏雪花，取代原来的硬切 ——
 *
 * 原来的换场是"世界替换"和"画面替换"同一帧发生：Boss 落地 → 直接 generateWorld()
 * → 下一区第一帧就顶上来。观感是硬切，玩家会以为画面跳了一下（2026-09-20 反馈）。
 *
 * 现在的口径：雪花从 Boss **倒地那一刻**（defeat 把它推入 'falling'）就开始爬升，
 * 世界替换仍然发生在 BOSS_FALL 那一拍 —— 只要它落在 [rise, rise+hold] 区间里，
 * 替换那一帧屏幕就被雪花**完全糊满**，玩家看不到任何"换"的动作。随后经过 fall
 * 散开，露出新区域。所以这条链上真正的契约是三个数的大小关系：
 *
 *     rise ≤ BOSS_FALL ≤ rise+hold
 *
 * 它被 tests/scene-switch.test.cjs 用一个会失败的断言钉住（改了这边忘了那边就红）。
 * 单独把 rise 拉长到 BOSS_FALL 之后、或把 hold 压到 0，都会让"硬切"重新露出来 ——
 * 而那种时候画面只是看起来"有点闪"，不会报错，正是最该由断言盯住的一类回归。
 *
 * 雪花画在画布上，所以画面上的 DOM 浮层（机位条 / 字幕 / 滚动条 / 横幅）必须靠
 * #stage.scene-switching 一起让位，否则横幅会浮在雪花上面 —— 一眼看出是"遮罩"
 * 而不是"转台"。样式见 tv/style.css。 */
const SCENE_SWITCH={rise:1.6,hold:1.2,fall:.75};
let sceneSwitch=null;
/* 雪花的不透明度曲线，纯函数、不碰任何状态 —— 换场那一拍是否"遮满"就由它判定。 */
function sceneSwitchAlpha(t){
  const {rise,hold,fall}=SCENE_SWITCH;
  if(!(t>0))return 0;
  if(t<rise)return t/rise;
  if(t<rise+hold)return 1;
  if(t<rise+hold+fall)return 1-(t-rise-hold)/fall;
  return 0;
}
function sceneSwitchDone(t){return t>=SCENE_SWITCH.rise+SCENE_SWITCH.hold+SCENE_SWITCH.fall;}
function sceneSwitchSpan(){return SCENE_SWITCH.rise+SCENE_SWITCH.hold+SCENE_SWITCH.fall;}
/* 每次进入换场都从 0 重新计时（同一帧里重复调用是幂等的，不会叠加两段雪花）。 */
function beginSceneSwitch(){
  sceneSwitch={t:0};
  $('stage').classList.add('scene-switching');
  noise(1.1,.3,2600);tone(58,.5,'square',.05,30);
}
function endSceneSwitch(){
  sceneSwitch=null;
  $('stage').classList.remove('scene-switching');
}
function nodeAnchorXAt(x){return (Math.floor(Math.max(0,x)/LENGTH)+1)*LENGTH-NODE_GUARD;}
function nodeAnchorX(){return nodeAnchorXAt(p.x);}
/* Boss 是唯一**没有重生机制**的实体：任何"离远了就回收"的过滤、以及存档快照，都必须放它过去。
 * 漏一处就是永久丢 Boss（上面那次事故的直接原因），所以这个判断只写在这里一份。 */
const bossEntity=e=>e.type==='sentinel';
let bossChallengeStarted=false;
/* 节点闸门**锁存**：巨兽一旦走到节点（NODE_APPROACH 之内），「摧毁这块区域」就永久开放，
 * 直到真的点下去（或该区被摧毁后重置）。
 *
 * 为什么必须锁存：只按位置判断的话，按钮每段路只亮后面 1360px（NODE_APPROACH 之内），
 * 即 4800px 的一个周期里只亮 28% 的时间。按 119 级约 70px/s 的步速就是亮 19 秒、
 * 灭 49 秒 —— 玩家离开两分钟回来看，大概率正赶上灭着的那 49 秒，
 * 看到的和"卡在节点前、按钮不亮"一模一样。改动前是 `p.x>=3830` 的绝对判断，
 * 过了第一次就恒亮，这里把那个手感还回来。
 * nodeArmed 随存档落盘：点按钮之前重启，不该把已经到手的资格弄丢。 */
let nodeArmed=false;
function nodeReached(){return p.x>=nodeAnchorX()-NODE_APPROACH;}
function sentinel(){return enemies.find(e=>bossEntity(e)&&e.gate);}
/* 面板形态必须走存档快照：面板是另一个 tv 实例，**不跑 generateWorld、enemies 恒空**，
 * 直接问 sentinel() 永远得到 undefined —— 表现就是"电视那边闸门早开了，监控器里的
 * 「摧毁这块区域」却永远是灰的"（2026-09-20 实机：存档里 nodeArmed=true 而按钮灰）。
 * 快照由 serialize() 每次落盘刷新、sync 每 5 秒推给面板，字段与实时态同源：
 * nodeArmed / bossChallengeStarted / enemies[].state / x。判据只有这一份，别在 hud 里另写。 */
function bossChallengeAvailable(){
  if(panelMode){
    const w=data.world;
    if(!w||w.district!==data.district)return false;
    const x=Number(w.x)||0;
    const reached=w.nodeArmed===true||x>=nodeAnchorXAt(x)-NODE_APPROACH;
    const boss=(w.enemies||[]).some(e=>e.id==='boss-sentinel'&&e.state==='alive');
    return !!(boss&&!w.bossChallengeStarted&&reached);
  }
  const e=sentinel();return !!(e&&alive(e)&&!bossChallengeStarted&&(nodeArmed||nodeReached()));
}
/* 每帧调用：把"到过节点"这件事记下来。与 bossChallengeAvailable() 里的 nodeReached()
 * 是同一判据的两条入口 —— 前者负责锁存，后者负责锁存之前的那一帧也认得出来
 * （测试会直接摆坐标再立刻问，不能要求先跑一帧）。 */
function armNodeGate(){if(!nodeArmed&&!bossChallengeStarted&&nodeReached())nodeArmed=true;}
/* 把 Boss 钉到「登场位」——画面右侧 BOSS_SCREEN_X 处（换算见 bossIntroLead）。
 *
 * 老判据 `Math.abs(e.x-p.x)>BOSS_IN_RANGE` 是个隐式的"设过了就别再设"：Boss 守在节点上、
 * 而巨兽已经走过节点一小段（闸门锁存之后继续挂机就会这样，差值 < BOSS_IN_RANGE）时它
 * **不生效**，Boss 就原地砸下来 —— 视觉上正是"直接砸在巨兽身上"（2026-09-20 实机反馈）。
 * 现在按"当前位置是否就是登场位"判断，与它原先站在哪无关；演出一开始（introStarted）
 * 就不再干预，免得把已经起跳的 Boss 拽回去。 */
function armBossIntro(e){
  if(!e||!alive(e)||e.introDone!==false||e.introStarted)return;
  const want=p.x+bossIntroLead();
  if(e.x!==want)e.x=want;
}
/* 把 Boss 钉在它守的那一段路的段末（未开战时）。旧档里它丢过或落在身后，这一句同时负责自愈。 */
function syncBossPost(){
  const e=sentinel();if(!e||!alive(e))return;
  if(bossChallengeStarted){armBossIntro(e);return;}
  const x=nodeAnchorX();if(e.x!==x)e.x=x;if(!Number.isFinite(e.y))e.y=G-180;
}
let mapStartCleared=Number.isFinite(data.world?.mapStartCleared)?data.world.mapStartCleared:data.cleared;
let mapStartKills=Number.isFinite(data.world?.mapStartKills)?data.world.mapStartKills:data.kills;
const CHUNK_SPAN=3400;
let worldChunk=0;
/* 「进入下一张地图」按钮的文案，只此一处。
 *
 * 老实现把 '进入 '+章标题 分别写在 announceMapGate 和 hud 两处，于是站在大阪
 * 的第 2 个区时按钮写着"进入 第一章 · 大阪" —— 和"我已经在大阪"自相矛盾，
 * 玩家读到的就是"推图卡在第一章"。跨章才点名章节，章内点名下一区的街道。 */
function nextMapLabel(target,from){
  const to=P.chapterFor(target),cur=P.chapterFor(from);
  return to.key===cur.key?'进入 '+to.districts[(target-1)%5].name:'进入'+to.title.replace(' · ','-');
}
function appendWorldChunk(){
  // 每块独立播种：只重建存档附近的块，也能还原同一栋楼的尺寸与外观。
  seed=(1701+data.district*983+Math.imul(worldChunk,7919))>>>0;
  const stage=currentStage(),diff=P.Kb(data.district),base=LENGTH-400+(worldChunk-1)*CHUNK_SPAN;
  for(let layer=0;layer<3;layer++){
    let i=worldChunk*20;
    for(let x=base+(layer===1?0:layer===0?-80:80);x<base+CHUNK_SPAN-400;x+=layer===1?210:layer===0?185:310){
      let w=layer===2?125+rnd()*60:100+rnd()*57,h=stage.key==='village'?(layer===2?38+rnd()*24:70+rnd()*62):stage.key==='suburb'?(layer===2?65+rnd()*50:130+rnd()*95):layer===2?90+rnd()*80:layer===0?210+rnd()*170:255+rnd()*170;
      let b=makeBuilding(Math.round(x+rnd()*32),Math.round(w),Math.round(h),i+layer*13);b.layer=layer;b.id='c'+worldChunk+'-'+layer+'-'+i;
      if(stage.key==='city'&&layer===1){b.kind='tower';b.assetId=buildingAssetId('city','tower');}
      b.ground=G+(layer===2?32:layer===0?-14:0);b.max=b.hp=Math.round(3*(layer===1?780:layer===0?520:360)*diff*(1+Math.max(0,b.h-(layer===2?90:210))/500));b.floorCount=Math.ceil(h/35);b.tilt=(rnd()-.5)*.22;buildings.push(b);i++;
    }
  }
  let choices=currentStage().key==='village'?['tank','heli','drone']:data.district>=5?['gunship','aegis','mech','jet','drone','walker','bunker']:data.district>=3?['gunship','rocket','jet','drone','walker']:data.district>=2?['rocket','heli','drone','jet']:['tank','heli','drone'];
  for(let i=0;i<10;i++){let type=choices[i%choices.length],flying=/heli|gunship|jet|drone/.test(type);let e=enemy(type,base+380+i*330,flying?rand(165,255):undefined);e.fixed=true;e.id='c'+worldChunk+'-e'+i;enemies.push(e);}
  worldChunk++;
}
function ensureWorldAhead(){while(p.x>LENGTH-1900+(worldChunk-1)*CHUNK_SPAN)appendWorldChunk();if(worldChunk>1){buildings=buildings.filter(b=>b.x>p.x-2200);enemies=enemies.filter(e=>bossEntity(e)||e.x>p.x-2200||alive(e)&&Math.abs(e.x-p.x)<1350);}syncBossPost();}
function completeBossChallenge(){
  data.district++;data.dna+=2;grant(180+data.district*30,P.xpPerDistrict(data.district));
  bossChallengeStarted=false;nodeArmed=false;mapStartCleared=data.cleared;mapStartKills=data.kills;
  generateWorld();save();banner('区域已摧毁','已自动进入 '+chapterLocation());
}
function requestNextMap(){
  if(bossChallengeAvailable()){
    /* 顺序有讲究：先把演出状态清零、再钉登场位。armBossIntro 会因为 introStarted=true
     * 跳过定位，而 Boss 若正好停在"演出中"的存档上（introStarted 已是 true），
     * 先钉位就会被守卫挡掉 —— 先清零才保证这一次一定钉得动。 */
    const e=sentinel();bossChallengeStarted=true;e.introStarted=false;e.introDone=false;e.introTime=0;
    armBossIntro(e);e.cd=2;save();hud();banner('摧毁指令已确认','银曜巨人正在降临');return 'challenge';
  }
  return false;
}
function advanceStage(){const next=stageAt(data);if(next<=stageIndex)return;stageIndex=next;sceneZoom=cameraScale();save();banner('进入 '+currentStage().name,'累计行程 '+Math.floor(data.meters)+' m · LV '+data.level);}let rigState=KaijuRig.pose(p,0);let BS=bodyScale(),SM=rigState.muzzle,SK=scaleRig(rigState,BS,p.x,G);
let muted=data.muted,audio=null,master=null,musicClock=0,musicStep=0,beamAudioTimer=0;
let seed=76123;const rnd=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const rand=(a,b)=>a+Math.random()*(b-a),clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),rect=(x,y,w,h,c)=>{ctx.fillStyle=c;ctx.fillRect(Math.round(x/2)*2,Math.round(y/2)*2,Math.ceil(w/2)*2,Math.ceil(h/2)*2);};
function poly(points,c){ctx.fillStyle=c;ctx.beginPath();points.forEach((v,i)=>i?ctx.lineTo(v[0],v[1]):ctx.moveTo(v[0],v[1]));ctx.closePath();ctx.fill();}
function line(points,c,width=2){ctx.strokeStyle=c;ctx.lineWidth=width;ctx.beginPath();points.forEach((v,i)=>i?ctx.lineTo(v[0],v[1]):ctx.moveTo(v[0],v[1]));ctx.stroke();}
function text(t,x,y,size=12,color='#dbe8ff',align='left'){ctx.fillStyle=color;ctx.font=`${size}px Pixel, monospace`;ctx.textAlign=align;ctx.fillText(t,Math.round(x),Math.round(y));}
const skyline=[];for(let layer=0;layer<3;layer++){let a=[],x=-100;while(x<7800){let w=40+rnd()*75,h=70+rnd()*230;a.push({x,w,h,seed:Math.floor(rnd()*99999)});x+=w+6+rnd()*16;}skyline.push(a);}
/* 这里只留玩法数值。单位的显示名、资产目录、绘制函数一律从
 * assets/asset-index.js 取，避免同一批单位身份散落在代码与资产清单两处。 */
const TYPES={tank:{hp:90,resistance:.07,reward:20},heli:{hp:80,resistance:.06,reward:24},rocket:{hp:160,resistance:.13,reward:35},gunship:{hp:230,resistance:.19,reward:48},aegis:{hp:360,resistance:.31,reward:65},mech:{hp:600,resistance:.45,reward:100},
  jet:{hp:70,resistance:.05,reward:18},drone:{hp:38,resistance:.03,reward:11},walker:{hp:340,resistance:.28,reward:55},bunker:{hp:430,resistance:.34,reward:62},sentinel:{hp:BOSS_HP_BASE,resistance:1.1,reward:500}};
for(const type in TYPES){const unit=ASSETS.enemyUnit(type);if(!unit)throw new Error('单位 '+type+' 未在 assets/asset-index.js 登记');TYPES[type].label=unit.label;TYPES[type].assetId=ASSETS.dir.enemy(unit.faction,type);TYPES[type].renderer=unit.renderer;}
const alive=e=>e.state==='alive';const activeBuildings=()=>buildings.filter(b=>!b.dead);
function fmt(n){if(n>=1e9)return(n/1e9).toFixed(2)+'B';if(n>=1e6)return(n/1e6).toFixed(2)+'M';if(n>=10000)return(n/1000).toFixed(1)+'K';return Math.floor(n).toLocaleString('en-US');}
/* 体型：曲线、上限、天赋乘数全部在 growth.js（分段线性，1 级 0.34 → 满级 1.00，
 * 总上限 1.12）。这里只做转发 —— 老实现自带一份 0.333+0.667*(1-e^(-(L-1)/9))，
 * 与 progression.js 的 globalScaleFor 是两套公式，同一个概念两个答案。
 * 现在只有一条曲线，受击盒也吃同一个值（见 rig.js 的 hitbox）。
 *
 * 镜头（sceneZoom）同样只做转发 —— 公式在 growth.cameraScale()。老实现是
 * 就地算的三项 min：第一项随等级从 1.30 收到 1.00（正好抵消体型增长），
 * 第二项按场景硬切（1.30/1.16/1.00，换场时画面倒退 −2.9% / −7.3%），
 * 第三项因 CEIL=1.12 < 1.16 永远不是最小值、从生效过 0 次。
 * 结果是 1→11 级体型 +29%、屏幕上只有 +15%。判据是"体型 × 镜头"这个
 * 乘积有没有随等级变大，见 growth.VIEW 与 tests/growth-system.test.cjs。 */
function bodyScale(){return Growth.bodyScale(data.level,data.talents,data.morph,P.EPOCHS);}
/* 火焰 / 烟尘粒子尺寸的唯一出口（render 的火焰与 update 的烟尘都调它）。
 * 跟体型走但锁在 25 级：jitter 是每处火自己的随机扰动，只放大不超过上限。
 * ⚠️ 上限是 FX_SCALE_MAX，**不是** bodyScale() —— 见文件开头那段说明，
 * 别再写成 bodyScale() 直通，那正是"怪越大火越糊"的老毛病。 */
function fxScale(jitter){return clamp(Math.min(bodyScale(),FX_SCALE_MAX)*(1+(jitter||0)),.25,FX_SCALE_MAX);}
/* 把骨骼（含挂点）按 bodyScale 围绕脚底 pivot 等比缩放，角色与挂点共用同一缩放。 */
function scaleRig(state,bs,px,py){const mp=b=>({x:px+(b.x-px)*bs,y:py+(b.y-py)*bs,a:b.a});const bones={};for(const k in state.bones)bones[k]=mp(state.bones[k]);const pt=q=>({x:px+(q.x-px)*bs,y:py+(q.y-py)*bs});return{bones,seams:(state.seams||[]).map(s=>({x:px+(s.x-px)*bs,y:py+(s.y-py)*bs,a:s.a,rx:s.rx*bs,ry:s.ry*bs})),muzzle:pt(state.muzzle),claw:pt(state.claw),foot:pt(state.foot),tail:pt(state.tail),neutral:state.neutral};}
/* 原子吐息主色：主元素决定，否则按突变体征（赤化/白化），默认青蓝。 */
function beamColor(){let main=economy.mainElement();if(main)return P.TALENT_BY_ID[main].color;if(data.morph.hue==='crimson')return '#ff5a3c';if(data.morph.hue==='albino')return '#dff4ff';return '#70f8ff';}
/* 主元素色：有主元素天赋时返回它的颜色，否则 null（交给形态期的配色兜底）。
 * 背鳍与辉光共用，形态框架 appearance.decor() 也吃这个值。 */
function elementColor(){let main=economy.mainElement();return main?P.TALENT_BY_ID[main].color:null;}
/* 加点 / 天赋 / 突变后的可见玩法反馈：闪屏 + 画面里往上飘的字。
 * （原来还会脉冲一下画面顶部的常驻 HUD，那排信息已按反馈移除。） */
function growthFeedback(){/* 电视直播不弹成长提示，反馈仅留在功能面板的实时数值。 */}
function notice(s){$('notice').textContent=s;$('notice').style.opacity=1;noticeTimer=4;}
/* 「突发新闻」字幕条（#lowerThird 里那块 BREAKING）最短间隔，单位秒。
 *
 * 反馈：突发条出现得太频繁，一直挂着就不像"突发"了；而技能本来几十秒一轮，
 * 每轮都报一次等于让那条横幅常驻。两道闸：
 *   1. **技能释放根本不走 priority** —— 重踏 / 长啸 / 吐息三个调用点只传
 *      标题与详情（见 doStomp / doRoar / begin），它们仍然进现场档案与
 *      滚动条，只是不抢画面；
 *   2. 其余事件（进化 / 觉醒 / 突变 / 突破城区 / 启动）之间至少隔这么久，
 *      抢不到的那条同样照常进档案与滚动条，不丢消息。
 * 计时走游戏时间 dt，与 headlineTimer 同一把尺（暂停时不流失）。 */
const BREAKING_GAP=60;
function broadcast(title,detail,priority=false){if(priority&&breakingCd>0)priority=false;let stamp=new Date().toLocaleTimeString('zh-CN',{hour12:false});if(news[0]?.title!==title)news.unshift({stamp,title});news=news.slice(0,20);if(priority||headlineTimer<=0){$('headline').textContent=title;headlineOffset=0;$('headline').style.transform='translateX(0px)';$('headlineDetail').textContent=detail||'GNN 地面与空中机位正在持续跟踪';headlineTimer=priority?5:3;}if(priority){breakingCd=BREAKING_GAP;$('lowerThird').hidden=false;let releaseAt=Date.now()+4000;lowerThirdTimer=releaseAt;setTimeout(()=>{if(lowerThirdTimer===releaseAt)$('lowerThird').hidden=true;},4000);}$('newsPanel').innerHTML=news.map(n=>`<div class="news-item"><time>${n.stamp}</time><p>${n.title}</p></div>`).join('');refreshTicker();}
function refreshTicker(){pendingTicker=`GNN 24H 特别报道　◆　${chapterLocation()}：第 ${data.district} 区域　◆　军方已损失 ${data.kills} 个单位　◆　已确认 ${data.cleared} 栋建筑被摧毁　◆　巨兽正在自动进化，当前等级 ${data.level}　◆　${news.slice(0,4).map(n=>n.title).join('　◆　')}　◆　`;if(!$('tickerText').textContent)commitTicker();}
function commitTicker(){if(pendingTicker){$('tickerText').textContent=pendingTicker;$('tickerCopy').textContent=pendingTicker;pendingTicker='';}tickerWidth=$('tickerText').offsetWidth||1200;}
function scrollNews(dt){tickerOffset+=dt*48;if(tickerOffset>=tickerWidth){tickerOffset-=tickerWidth;commitTicker();}$('tickerTrack').style.transform='translateX(-'+Math.floor(tickerOffset)+'px)';headlineOffset+=dt*24;if(headlineOffset>headlineWidth+36)headlineOffset=-headlineViewport;$('headline').style.transform='translateX('+Math.floor(headlineOffset<0?-headlineOffset:-Math.max(0,headlineOffset-36))+'px)';}
function openPanel(key,opener){
  if(key==='skills')key='talent';
  if(!panelKeys.includes(key))return;
  if(!panelMode){$('management').hidden=true;requestPanel(key);return;}
  panelOpener=opener||panelOpener;$('management').hidden=false;
  for(let name of ['assign','talent','evo','stats','news','settings']){let t=$(name+'Tab'),pn=$(name+'Panel');if(t)t.setAttribute('aria-selected',String(name===key));if(pn)pn.hidden=name!==key;}
  $('skillsPanel').hidden=false;
  $('panelTitle').textContent={assign:'怪兽属性监控器',talent:'天赋与技能树',evo:'进化',stats:'数值强化',news:'现场档案',settings:'观测设置'}[key]||'';
  $('growthContent').scrollTop=0;$('closePanel').focus?.();
  if(key==='assign'||key==='talent'||key==='evo')renderGrowthPanels();
  syncAssignHologram();
}
function closePanel(){$('management').hidden=true;syncAssignHologram();if(panelMode){if(window.__panelHost)window.__panelHost.close();else window.close();}panelOpener?.focus?.();}
function banner(s,sub='GNN / SPECIAL COVERAGE'){ $('eventBanner').innerHTML=s+`<small>${sub}</small>`;$('eventBanner').hidden=false;bannerTimer=3;}
function burst(x,y,n=24,palette=['#fff3b7','#ffbb4d','#fa622c','#9a3940'],force=180){for(let i=0;i<n;i++){let a=rand(0,Math.PI*2),v=rand(20,force);particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-70,life:rand(.3,1.3),size:rand(3,12),color:palette[Math.floor(rand(0,palette.length))],gravity:310});}}
function smoke(x,y,size=17){particles.push({x,y,vx:rand(-24,-6),vy:rand(-55,-20),life:rand(1.3,2.8),size:rand(size*.6,size*1.5),color:['#182234','#263045','#343a4c'][Math.floor(rand(0,3))],gravity:-9,smoke:true});}
function explosion(x,y,big=1){burst(x,y,Math.round(35*big),undefined,230*big);rings.push({x,y,r:5,life:.38,color:'#ffd07b',type:'blast'});shake=Math.max(shake,6*big);slow=Math.max(slow,.07*big);sound('boom');}
/* 关底血量走 bossMaxHp()（按目标击杀时长反解，已含区域缩放），**不再**乘 P.Ke ——
 * 那会二次缩放区域：power()/atomic() 里已经含 districtScale 了。 */
function enemy(type,x,y){let spec=TYPES[type],hp=type==='sentinel'?bossMaxHp():spec.hp*P.Ke(data.district)*(currentStage().key==='village'?.6:1);return {type,x,y:y??G-17,baseY:y??G-17,hp,max:hp,cd:rand(1,4),hit:0,phase:rand(0,7),state:'alive',vx:0,vy:0,rotation:0,spin:0,age:0,hitIds:new Set()};}
function cameraScale(){return Growth.cameraScale(data.level,data.talents,data.morph,P.EPOCHS);}
function cameraTarget(){return p.x-(420+140*clamp((bodyScale()-.333)/.787,0,1));}
function worldSnapshot(){return {district:data.district,stage:currentStage().key,x:p.x,nextDistrict:null,bossChallengeStarted,nodeArmed,mapStartCleared,mapStartKills,worldChunk,buildings:buildings.filter(b=>b.x>p.x-2200).map(b=>({id:b.id,hp:b.hp,max:b.max,dead:b.dead})),enemies:enemies.filter(e=>bossEntity(e)||e.fixed&&e.x>p.x-2200).map(e=>({id:e.id,hp:e.hp,state:e.state,...(e.type==='sentinel'?{max:e.max,introDone:e.introDone,introStarted:e.introStarted,introTime:e.introTime}:{} )}))};}
function save(){if(panelMode)return;try{SAVEIO.setItem(SAVE,economy.serialize(Date.now(),worldSnapshot()));if(browserPanel&&!browserPanel.closed)browserPanel.__growth?.sync(JSON.stringify(data));storageOK=true;$('saveState').innerHTML='<i></i> 进化进度已保存';}catch{storageOK=false;$('saveState').textContent='当前窗口运行 · 无法写入存档';}}
function generateWorld(restore){seed=1701+data.district*983;buildings=[];enemies=[];bullets=[];fires=[];wrecks=[];particles=[];rings=[];beam=null;
bossChallengeStarted=restore?.district===data.district&&restore.bossChallengeStarted===true;nodeArmed=restore?.district===data.district&&restore.nodeArmed===true;
const stage=currentStage();sceneZoom=cameraScale();
let diff=P.Kb(data.district);for(let layer=0;layer<3;layer++){let i=0;for(let x=layer===1?650:layer===0?560:810;x<LENGTH-400;x+=layer===1?210:layer===0?185:310){let w=layer===2?125+rnd()*60:100+rnd()*57,h=stage.key==='village'?(layer===2?38+rnd()*24:70+rnd()*62):stage.key==='suburb'?(layer===2?65+rnd()*50:130+rnd()*95):layer===2?90+rnd()*80:layer===0?210+rnd()*170:255+rnd()*170;let b=makeBuilding(Math.round(x+rnd()*32),Math.round(w),Math.round(h),i+layer*13);b.layer=layer;b.id=layer+'-'+i;/* 正面主楼用商业塔楼资产，其余街区楼用街区大楼资产。 */
if(stage.key==='city'&&layer===1){b.kind='tower';b.assetId=buildingAssetId('city','tower');}b.ground=G+(layer===2?32:layer===0?-14:0);b.max=b.hp=Math.round(3*(layer===1?780:layer===0?520:360)*diff*(1+Math.max(0,b.h-(layer===2?90:210))/500));b.floorCount=Math.ceil(h/35);b.tilt=(rnd()-.5)*.22;buildings.push(b);i++;}}
let tier=stage.key==='village'?1:stage.key==='suburb'?Math.min(3,data.district):Math.min(5,data.district);for(let i=0;i<16;i++){let type='tank';if(i%4===1)type='heli';else if(i%4===3&&tier>=2)type='rocket';if(tier>=3&&i%5===2)type='gunship';if(tier>=4&&i%5===3)type='aegis';if(tier>=5&&i%7===0)type='mech';if(tier>=2&&i%6===4)type='drone';if(tier>=4&&i%6===1)type='jet';if(tier>=3&&i%8===5)type='walker';if(tier>=4&&i%9===7)type='bunker';if(stage.key==='village'&&i%4===2)type='drone';let flying=/heli|gunship|jet|drone/.test(type);let e=enemy(type,620+i*253,flying?(stage.key==='village'?G-190:165)+i%3*28:undefined);e.fixed=true;e.id='e'+i;enemies.push(e);}
{let e=enemy('sentinel',LENGTH-NODE_GUARD,G-180);e.fixed=true;e.id='boss-sentinel';e.gate=true;e.introDone=false;e.introStarted=false;e.introTime=0;e.cd=2;enemies.push(e);}
worldChunk=1;const savedChunks=restore?.district===data.district?Math.floor(Number(restore.worldChunk)||1):1;const count=Math.max(1,Math.min(savedChunks,1000000));for(let i=Math.max(1,count-2);i<count;i++){worldChunk=i;appendWorldChunk();}
p.x=420;p.action={name:'walk',t:0};p.cooldowns={beam:18,stomp:7,tail:10,roar:19};p.step=0;p.angle=.12;
if(restore&&restore.district===data.district){p.x=clamp(Number(restore.x)||420,420,LENGTH+Math.max(0,worldChunk-2)*CHUNK_SPAN+CHUNK_SPAN);let states=new Map((Array.isArray(restore.buildings)?restore.buildings:[]).map(b=>[b.id,b]));for(let b of buildings){let s=states.get(b.id);if(s){let oldMax=Number(s.max)>0?Number(s.max):(b.layer===1?230:b.layer===0?120:85)*(1+Math.max(0,data.district-1)*.12);b.hp=b.max*clamp((Number(s.hp)||0)/oldMax,0,1);b.dead=s.dead===true||b.hp<=0;b.collapse=b.dead?3:0;}}let es=new Map((Array.isArray(restore.enemies)?restore.enemies:[]).map(e=>[e.id,e]));for(let e of enemies){let s=es.get(e.id);if(s){if(e.type==='sentinel'){
      /* Boss 的血量上限跟着巨兽输出走（bossMaxHp），重启后会重算 —— 所以按**比例**
       * 恢复，不是按绝对值，否则读一次档血条就跳一下。旧档快照里没有 max（改动前
       * 只存 hp），用改动前的公式把绝对血量换算成比例。与建筑那一段同一个套路。 */
      const oldMax=Number(s.max)>0?Number(s.max):bossLegacyMax(data.district,currentStage().key==='village');
      e.hp=e.max*clamp((Number(s.hp)||0)/oldMax,0,1);
      e.introDone=s.introDone===true;e.introStarted=s.introStarted===true;e.introTime=clamp(Number(s.introTime)||0,0,window.SentinelBoss.INTRO.duration);
    } else e.hp=clamp(Number(s.hp)||0,0,e.max);if(s.state!=='alive'||e.hp<=0)e.state='gone';}}}
if(worldChunk>1){buildings=buildings.filter(b=>b.x>p.x-2200);enemies=enemies.filter(e=>bossEntity(e)||e.x>p.x-2200||alive(e)&&Math.abs(e.x-p.x)<1350);}syncBossPost();camera=cameraTarget();$('location').textContent=cityTitle();refreshTicker();commitTicker();tickerOffset=0;spawnTimer=7;}
function grant(n,xp,x,y){n*=economy.rewardMult();economy.gain(n,xp);if(x!==undefined)floaters.push({x,y,text:'+'+Math.round(n),life:1.2,color:'#a0e9df'});}
function damageBuilding(b,n,source='claw'){if(b.dead)return;b.hp-=n;b.hit=.13;if(Math.random()<.17)burst(b.x+rand(0,b.w),b.ground-b.h*.6,3,['#708299','#485568','#c5b9a3'],90);if(b.hp<=0){b.dead=true;b.hp=0;b.collapse=.001;data.cleared++;grant(30+b.h*.11,P.xpPerBuilding(data.district,b.layer),b.x+b.w/2,b.ground-b.h);fires.push({x:b.x+b.w*.6,y:b.ground-12,size:35+b.w*.12,age:0,jitter:rnd()*.2-.1});explosion(b.x+b.w/2,b.ground-b.h*.48,b.layer===1?1.6:.8);for(let j=0;j<7;j++)smoke(b.x+rand(0,b.w),b.ground-b.h*.4,30);if(b.layer===1)broadcast('建筑群接连倒塌，巨兽正突破街区封锁','现场记者：承重结构已断裂，坍塌引发连锁尘浪');}}
function defeat(e,source='beam'){if(!alive(e))return;e.hp=0;e.age=0;e.hit=0;data.kills++;grant(TYPES[e.type].reward,P.xpPerEnemy(data.district),e.x,e.y-50);if(e.type==='sentinel'){e.state='falling';e.age=0;shake=12;beginSceneSwitch();broadcast('巨型守卫倒下，区域即将被摧毁','银曜巨人核心熄灭 · 正在打开下一地区通道');return;}let flying=/heli|gunship/.test(e.type);if(source==='claw'||source==='tail'){e.state='flying';e.vx=rand(230,370)*(source==='tail'?-1:1);e.vy=-rand(250,390);e.spin=(source==='tail'?-1:1)*rand(4,8);burst(e.x,e.y,14,undefined,130);broadcast(flying?'直升机被巨兽击飞，正在失控翻滚':'装甲车辆被拍向半空，残骸高速翻滚','现场画面：目标将在落地时发生二次爆炸');}else if(flying){e.state='crashing';e.vx=rand(-100,160);e.vy=rand(0,50);e.spin=rand(1.8,3.5);explosion(e.x,e.y,.65);broadcast('武装直升机失控，拖着浓烟坠向街区','现场镜头追踪中 · 旋翼损毁，机身持续旋转');}else{e.state='exploding';e.rotation=rand(-.12,.12);e.age=0;explosion(e.x,e.y,1.1);fires.push({x:e.x,y:G-12,size:33,age:0,jitter:rnd()*.2-.1});}}
function damageEnemy(e,n,source){if(!alive(e)||e.type==='sentinel'&&e.introDone===false)return;e.hp-=n;e.hit=.11;if(e.hp<=0)defeat(e,source);}
function doClaw(){let c=SK.claw;burst(c.x,c.y,16,['#d8fbff','#6bd8eb','#ffdf9a'],170);sound('hit');shake=7;slow=.12;let power=economy.power();for(let b of buildings)if(!b.dead&&b.x-c.x<70&&b.x+b.w-c.x>-45)damageBuilding(b,power*(b.layer===2?1.3:1),'claw');for(let e of enemies)if(alive(e)&&Math.abs(e.x-c.x)<135)damageEnemy(e,power*1.4,'claw');if(economy.has('impact'))for(let b of buildings)if(!b.dead&&b.x-c.x<260&&b.x-c.x>70)damageBuilding(b,power*.4,'claw');}
function doStomp(){let power=economy.power(),range=(economy.has('seismic')?576:360)*(1+Growth.spineBonus(data.level,data.morph));explosion(p.x+35,G,1.7);rings.push({x:p.x+35,y:G,r:25,life:1,color:'#a5dfff',type:'stomp'});burst(p.x+35,G,60,['#87a8c1','#c3ecff','#55617c'],350);for(let b of buildings)if(!b.dead&&Math.abs(b.x-p.x)<range)damageBuilding(b,power*(economy.has('seismic')?3.4:1.7),'stomp');for(let e of enemies)if(alive(e)&&!(/heli|gunship/.test(e.type))&&Math.abs(e.x-p.x)<range)damageEnemy(e,power*2.8,'stomp');broadcast('地面发生强烈震动，多辆战车瞬间爆燃','巨兽重踏产生冲击波，近处建筑与道路同时受损');/* 技能不拉突发条 */}
function doRoar(){sound('roar');shake=8;for(let i=0;i<3;i++)rings.push({x:SK.muzzle.x,y:SK.muzzle.y,r:10+i*70,life:1.3,color:'#81eaff',type:'roar'});for(let e of enemies)if(alive(e)&&Math.abs(e.x-p.x)<850){e.cd+=4;damageEnemy(e,economy.power()*.9,'roar');}for(let b of bullets)burst(b.x,b.y,3,['#a6f7ff','#fff2b5'],65);bullets=[];broadcast('巨兽发出长啸，空中编队遭到震荡冲击','声压冲击清除了附近炮弹，军方攻击出现短暂中断');/* 技能不拉突发条 */}
function doTail(){let c=SK.tail;burst(c.x,c.y,35,['#8698af','#e7d7b0','#566580'],300);shake=10;sound('hit');for(let b of buildings)if(!b.dead&&Math.abs(b.x-p.x+100)<470)damageBuilding(b,economy.power()*1.8,'tail');for(let e of enemies)if(alive(e)&&Math.abs(e.x-p.x)<520)damageEnemy(e,economy.power()*2.2,'tail');}
const DURATIONS={walk:Infinity,claw:1.18,beam:4.2,stomp:1.68,roar:2.1,tail:1.65};
function begin(name,target){p.action={name,t:0,hit:false,target,super: name==='beam'&&economy.has('meltdown')&&++beamCount%3===0};p.moving=false;if(name!=='walk'){actionSequence++;p.cooldowns[name]=({beam:28,stomp:12,roar:25,tail:15,claw:0}[name]||0)*(economy.has('overdrive')?.75:1);}if(name==='beam')broadcast(p.action.super?'红莲临界！'+chapterLocation()+'上空出现高热射线':'检测到高能反应，原子吐息即将释放','背鳍出现连续蓝光 · 本台正在追踪原子炉心活动');/* 技能不拉突发条 */}
function targetForBeam(){let tough=enemies.filter(e=>alive(e)&&e.x>p.x+180&&e.x<p.x+900&&(e.type!=='sentinel'||bossChallengeStarted)).sort((a,b)=>(b.gate?1000:0)+b.hp-((a.gate?1000:0)+a.hp));if(tough.length&&actionSequence%2===0)return tough[0];return buildings.filter(b=>!b.dead&&b.x>p.x+145&&b.x<p.x+950&&b.layer!==2).sort((a,b)=>a.x-b.x)[0]||tough[0];}
function pressure(){let n=0;for(let e of enemies)if(alive(e)&&e.x>p.x-180&&e.x<p.x+700&&(e.type!=='sentinel'||bossChallengeStarted))n+=TYPES[e.type].resistance*(1+data.district*.05);if(economy.has('momentum'))n*=.6;return n/(1+(data.levels.stride-1)*.09);}
function updateAI(dt){if(enemies.some(e=>alive(e)&&e.type==='sentinel'&&bossChallengeStarted&&e.introStarted&&!e.introDone)){p.moving=false;return;}if(p.stagger>0){p.stagger=Math.max(0,p.stagger-dt);p.moving=false;return;}for(let k in p.cooldowns)p.cooldowns[k]=Math.max(0,p.cooldowns[k]-dt);p.stagger=Math.max(0,p.stagger-dt);let a=p.action;a.t+=dt;
if(a.name==='walk'){let blocking=buildings.filter(b=>b.layer===1&&!b.dead&&b.x+b.w>p.x).sort((a,b)=>a.x-b.x)[0];let close=enemies.filter(e=>alive(e)&&Math.abs(e.x-p.x)<340&&(e.type!=='sentinel'||bossChallengeStarted));let target=targetForBeam();let meleeTarget=(blocking&&blocking.x-p.x<65+170*BS)||close.some(e=>e.x-p.x<170&&e.x-p.x>-35&&!(/heli|gunship/.test(e.type)));
if(p.cooldowns.stomp<=0&&(close.some(e=>!(/heli|gunship/.test(e.type)))||buildings.some(b=>!b.dead&&Math.abs(b.x-p.x)<210))){begin('stomp');}else if(p.cooldowns.tail<=0&&buildings.some(b=>!b.dead&&Math.abs(b.x-p.x+100)<360)){begin('tail');}else if(p.cooldowns.roar<=0&&close.length>=2){begin('roar');}else if(meleeTarget){begin('claw');}else if(p.cooldowns.beam<=0&&target){begin('beam',target);}else{p.moving=true;let speed=economy.speed()/Math.min(3.4,1+pressure());let next=p.x+speed*dt;if(blocking)next=Math.min(next,blocking.x-(50+170*BS));let gate=bossChallengeStarted&&enemies.find(e=>alive(e)&&e.gate);if(gate&&p.x<gate.x)next=Math.min(next,gate.x-160);let delta=Math.max(0,next-p.x);p.x+=delta;data.meters+=delta*.12;advanceStage();p.step+=dt*2.9*(.65+speed/100);}}
else{p.moving=false;if(a.name==='claw'&&!a.hit&&a.t>=.54){a.hit=true;doClaw();}if(a.name==='stomp'&&!a.hit&&a.t>=1){a.hit=true;doStomp();}if(a.name==='tail'&&!a.hit&&a.t>=.83){a.hit=true;doTail();}if(a.name==='roar'&&!a.hit&&a.t>=.45){a.hit=true;doRoar();}if(a.name==='beam'&&a.target){let tx=a.target.x+(a.target.w?a.target.w*.55:0),ty=a.target.w?a.target.ground-a.target.h*.64:a.target.y;p.angle+=(clamp(Math.atan2(ty-(SM||rigState.muzzle).y,tx-(SM||rigState.muzzle).x),-.48,.65)-p.angle)*Math.min(1,dt*4);}if(a.t>=DURATIONS[a.name]){begin('walk');}}
ensureWorldAhead();rigState=KaijuRig.pose(p,time);BS=bodyScale();SK=scaleRig(rigState,BS,p.x,G);SM=SK.muzzle;}
function rayBox(x,y,dx,dy,b){let min=0,max=1100;for(let [origin,dir,lo,hi] of [[x,dx,b.x,b.x+b.w],[y,dy,b.ground-b.h,b.ground]]){if(Math.abs(dir)<1e-6){if(origin<lo||origin>hi)return null;}else{let t1=(lo-origin)/dir,t2=(hi-origin)/dir;if(t1>t2)[t1,t2]=[t2,t1];min=Math.max(min,t1);max=Math.min(max,t2);if(min>max)return null;}}return min;}
function updateBeam(dt){beam=null;arcs=[];if(enemies.some(e=>alive(e)&&e.type==='sentinel'&&bossChallengeStarted&&e.introStarted&&!e.introDone))return;let a=p.action;if(a.name!=='beam'||a.t<.95||a.t>3.55)return;let {x,y}=(SM||rigState.muzzle),dx=Math.cos(p.angle),dy=Math.sin(p.angle),hits=[];for(let b of buildings){if(b.dead)continue;let distance=rayBox(x,y,dx,dy,b);if(distance!==null&&distance>0&&distance<1100)hits.push({distance,target:b});}for(let e of enemies){if(!alive(e)||(e.type==='sentinel'&&!bossChallengeStarted))continue;let ex=e.x-x,ey=e.y-y,d=ex*dx+ey*dy,off=Math.abs(ex*dy-ey*dx);if(d>0&&d<1100&&off<(e.type==='sentinel'?185:e.type==='mech'?90:/heli|gunship/.test(e.type)?34:42))hits.push({distance:d,target:e});}hits.sort((a,b)=>a.distance-b.distance);let chosen=hits.slice(0,economy.has('pierce')?3:1),reach=chosen.length?chosen.at(-1).distance:1000;beam={x,y,ex:x+dx*reach,ey:y+dy*reach,super:a.super};let fire=data.subElements&&data.subElements.includes('pyro');beam.fire=fire;
/* 火焰呼吸：伤害由原子炉心与巨兽力量共同决定（属性参与伤害），与纯光束不同；
 * 光束只取原子炉心。两者造型也完全不同（drawBeam 分支）。 */
let damage=(fire?economy.atomic()*1.25+economy.power()*0.4:economy.atomic())*dt*(a.super?2.5:1)*(1+(data.levels.atomic-1)*.015);for(let [i,hit] of chosen.entries()){let target=hit.target,n=damage*(i? .65:1);target.w?damageBuilding(target,n,'beam'):damageEnemy(target,n,'beam');burst(x+dx*hit.distance,y+dy*hit.distance,2,a.super?['#ff843b','#fff7bb','#ff3c52']:['#c7ffff','#5de5ff','#fff1a1'],140);if(economy.has('chain')){let near=enemies.filter(e=>alive(e)&&Math.hypot(e.x-target.x,e.y-(target.y||y))<280).slice(0,2);for(let e of near){arcs.push({x:target.x,y:target.y||y,ex:e.x,ey:e.y});damageEnemy(e,damage*.4,'beam');}}}shake=Math.max(shake,1.3);beamAudioTimer-=dt;if(beamAudioTimer<=0){sound('beam');beamAudioTimer=.18;}}
/* 瞄准：目标点必须落在**当前体型**的受击盒里，不能按满体型写死。
 * 老实现 tx=p.x+rand(-40,70)、ty=G-rand(90,280) 是按满体型（头顶约 G-401）定的；
 * 1 级体型 0.34 倍时头顶才到 G-136，于是大部分炮弹整片打在空中。
 * 盒子来自 rig.js 的 hitbox()，与渲染共用同一个体型系数 BS。 */
function shoot(e){let hb=KaijuRig.hitbox(BS,p.x,G),hw=hb.x1-hb.x0,hh=hb.y1-hb.y0;
let tx=p.x+rand(-0.05,0.42)*hw,ty=hb.y0+rand(0.30,0.78)*hh,dx=tx-e.x,dy=ty-e.y,d=Math.hypot(dx,dy)||1,speed=e.type==='aegis'?440:240;bullets.push({x:e.x,y:e.y-13,vx:dx/d*speed,vy:dy/d*speed,life:6,type:e.type==='rocket'||e.type==='mech'?'rocket':e.type==='aegis'?'electric':'shell',trail:[]});sound('shot');}
function crash(e){if(e.state==='gone'||e.state==='exploding')return;e.state='exploding';e.age=0;e.y=G-10;crashCount++;explosion(e.x,G-22,/heli|gunship/.test(e.type)?1.7:1.2);fires.push({x:e.x,y:G-8,size:38,age:0});wrecks.push({x:e.x,y:G-6,angle:rand(-.3,.3),age:0,type:e.type});for(let b of buildings)if(!b.dead&&Math.abs(b.x-e.x)<150)damageBuilding(b,economy.power()*(economy.has('throw')?1.3:.35),'wreck');for(let other of enemies)if(other!==e&&alive(other)&&Math.abs(other.x-e.x)<(economy.has('throw')?200:100))damageEnemy(other,economy.power()*(economy.has('throw')?2:.45),'wreck');broadcast('残骸撞击地面，引发剧烈二次爆炸','翻滚的装甲与燃烧机体波及邻近建筑和军队');}
function updateEnemies(dt){for(let e of enemies){e.age+=dt;if(alive(e)){if(Math.abs(e.x-p.x)>1350)continue;e.hit=Math.max(0,e.hit-dt);e.phase+=dt;if(e.type==='sentinel'){updateSentinel(e,dt);continue;}if(/heli|gunship/.test(e.type)){e.y=e.baseY+Math.sin(e.phase*1.6)*20;if(Math.abs(e.x-p.x)>600)e.x-=Math.sign(e.x-p.x)*dt*27;}e.cd-=dt;if(e.cd<=0){e.cd=e.type==='rocket'?4:e.type==='aegis'?2.2:3;shoot(e);if(e.type==='mech'||e.type==='gunship'){shoot({...e,y:e.y+20});}}}else if(e.state==='falling'){if(e.age>=BOSS_FALL){e.state='gone';explosion(e.x,G-20,2);shake=10;if(e.type==='sentinel'&&bossChallengeStarted)completeBossChallenge();}}else if(e.state==='flying'||e.state==='crashing'){e.x+=e.vx*dt;e.y+=e.vy*dt;e.vy+=dt*(e.state==='crashing'?125:290);e.rotation+=e.spin*dt;if(Math.random()<dt*28)smoke(e.x,e.y-8,22);if(Math.random()<dt*12)burst(e.x,e.y,2,undefined,65);if(e.y>=G-13||e.age>6)crash(e);}else if(e.state==='exploding'&&e.age>.45)e.state='gone';}
/* 命中判定与渲染同源：受击盒随体型缩放。
 * 老实现是 |Δx|<75 且 y∈(G-350, G) 的死矩形，按满体型（约 401px 高）定死的 ——
 * 1 级体型 0.34 倍时怪兽只有 136px 高，子弹既可能从头顶飞过被判"打中"，
 * 也可能整片打空。命中闪光的落点同样是硬编码的 G-185，一并跟着盒子走。 */
const HB=KaijuRig.hitbox(BS,p.x,G);
for(let b of bullets){b.life-=dt;b.trail.push([b.x,b.y]);if(b.trail.length>6)b.trail.shift();b.x+=b.vx*dt;b.y+=b.vy*dt;if(b.type==='rocket'&&Math.random()<.2)smoke(b.x,b.y,7);if(b.x>HB.x0&&b.x<HB.x1&&b.y>HB.y0&&b.y<HB.y1){burst(b.x,b.y,6,['#ffda8a','#c6ffff','#63748b'],100);burst(HB.x0+(HB.x1-HB.x0)*0.42,HB.y0+(HB.y1-HB.y0)*0.6,18,['#ff344b','#ff6d7a','#ffd8d2'],105);p.recoil=.1;hitFlash=.18;shake=Math.max(shake,3);b.life=0;}if(b.y>G){burst(b.x,G,5);b.life=0;}}bullets=bullets.filter(b=>b.life>0&&Math.abs(b.x-p.x)<1400);spawnTimer-=dt;if(spawnTimer<=0){spawnTimer=12;let nearby=enemies.filter(e=>alive(e)&&Math.abs(e.x-p.x)<1100).length;if(nearby<6&&p.x<LENGTH-800){let choices=currentStage().key==='village'?['tank','heli','drone']:data.district>=5?['gunship','aegis','mech','jet','drone','walker','bunker']:data.district>=3?['gunship','rocket','jet','drone','walker']:data.district>=2?['rocket','heli','drone','jet']:['tank','heli','drone'];let type=choices[Math.floor(rand(0,choices.length))];let flying=/heli|gunship|jet|drone/.test(type);enemies.push(enemy(type,p.x+1000,flying?rand(165,255):undefined));}}
enemies=enemies.filter(e=>bossEntity(e)||e.fixed||e.state!=='gone'&&Math.abs(e.x-p.x)<1900);}
function audioInit(){try{if(!audio){audio=new(window.AudioContext||window.webkitAudioContext)();master=audio.createGain();master.gain.value=.32;master.connect(audio.destination);}audio.resume();}catch(e){muted=true;}}
function tone(f,d=.1,type='square',v=.05,end=f){if(!audio||muted)return;const o=audio.createOscillator(),g=audio.createGain();o.type=type;o.frequency.setValueAtTime(f,audio.currentTime);o.frequency.exponentialRampToValueAtTime(Math.max(10,end),audio.currentTime+d);g.gain.setValueAtTime(v,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+d);o.connect(g);g.connect(master);o.start();o.stop(audio.currentTime+d);}
function noise(d=.3,v=.3,low=800){if(!audio||muted)return;let b=audio.createBuffer(1,audio.sampleRate*d,audio.sampleRate),a=b.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=(Math.random()*2-1)*(1-i/a.length);let s=audio.createBufferSource(),f=audio.createBiquadFilter(),g=audio.createGain();s.buffer=b;f.type='lowpass';f.frequency.value=low;g.gain.value=v;s.connect(f);f.connect(g);g.connect(master);s.start();}
function sound(kind){if(kind==='hit'){noise(.17,.27,1700);tone(80,.16,'sawtooth',.12,25);}if(kind==='boom'){noise(.8,.7,700);tone(55,.6,'sine',.3,15);}if(kind==='roar'){tone(78,1.1,'sawtooth',.27,25);tone(83,1.2,'sawtooth',.13,30);noise(.9,.28,440);}if(kind==='beam'){tone(100,.25,'sawtooth',.09,160);noise(.2,.11,1800);}if(kind==='shot')tone(170,.08,'square',.03,50);if(kind==='pickup'){tone(550,.14,'sine',.12,950);} }
function music(dt){if(!audio||muted||mode!=='playing')return;musicClock-=dt;if(musicClock<=0){musicClock=.27;const notes=[55,55,65.4,55,49,49,73.4,65.4];tone(notes[Math.floor(musicStep/2)%8],.23,'triangle',.075);if(musicStep%4===0)tone(45,.2,'sine',.18,20);if(musicStep%2===1)noise(.04,.04,4000);musicStep++;}}
/* 建筑资产落点：幕 + 建筑种类 → 目录（见 assets/asset-index.js）。
 * 现在仍是程序化绘制，kind/assetId 是建筑资产的"身份证"与贴图接入点；
 * 测试会校验每栋生成的建筑都指向一个已登记的目录，写错名字不会静默放过。 */
function buildingAssetId(stage,kind){return ASSETS.buildingKind(stage,kind)?ASSETS.dir.building(stage,kind):ASSETS.dir.building(stage,'house');}
function makeVillageBuilding(x,w,h,index){
  const s=document.createElement('canvas');s.width=w;s.height=h+40;const c=s.getContext('2d');c.imageSmoothingEnabled=false;
  const R=(x,y,w,h,col)=>{c.fillStyle=col;c.fillRect(Math.round(x/2)*2,Math.round(y/2)*2,Math.ceil(w/2)*2,Math.ceil(h/2)*2);};
  const chapter=currentChapter(),street=currentRoute().street,shop=index%4===1,flat=chapter.key==='newyork'||index%3===0,wall=index%2?chapter.wall:chapter.skyline[2];
  /* 平顶楼在城郊算低层公寓，在村庄只是平顶民房 —— 同一绘制函数对应两种资产种类。 */
  const stageKey=currentStage().key,kind=flat?(stageKey==='suburb'?'midrise':'house'):shop?'shop':'house';
  R(4,31,w-8,h+5,'#101d31');R(8,35,w-16,h-1,wall);R(w-24,35,16,h-1,'#34475b');R(10,37,4,h-3,'#c0b99c');
  if(flat){R(0,24,w,12,'#263b52');R(4,24,w-8,4,'#91a5ae');R(16,10,28,14,'#8c9c9b');R(20,14,18,4,'#4a6778');}
  else{for(let row=0;row<7;row++){const inset=(6-row)*5;R(inset,6+row*4,w-inset*2,6,row%2?'#35536c':'#58778a');}R(0,32,w,5,'#a4b4ad');}
  for(let yy=48;yy<h+7;yy+=34){for(let xx=20;xx<w-24;xx+=34){R(xx-3,yy-3,24,24,'#293c50');R(xx,yy,18,17,index%3?'#e5c179':'#70a3b9');R(xx+8,yy,2,17,'#617981');R(xx,yy+8,18,2,'#4b6375');R(xx-4,yy+19,26,4,'#b3b6aa');}}
  R(w-41,57,26,16,'#bbc6bd');for(let j=0;j<4;j++)R(w-37,60+j*3,15,1,'#657b84');R(w-15,65,3,25,'#b3b9a6');
  R(18,h+7,23,29,'#263b4c');R(22,h+11,15,16,'#93b9b7');R(36,h+25,3,3,'#f6d897');
  if(shop){R(7,h-13,w-14,20,'#244e66');c.font='12px Pixel,monospace';c.fillStyle='#fff0bb';c.textAlign='center';c.fillText(street.signs[index%street.signs.length],w/2,h+1);for(let xx=4;xx<w-4;xx+=14)R(xx,h+7,14,10,xx%28<14?'#d5c7a0':'#407b85');R(48,h+18,w-77,17,'#e7cd8d');R(59,h+19,3,16,'#486775');}
  else{R(w-62,h+15,53,20,'#637987');R(w-65,h+12,59,5,'#a3aaa0');for(let xx=w-59;xx<w-12;xx+=13)R(xx,h+20,9,2,'#425c6d');}
  if(chapter.key==='osaka'){for(let xx=12;xx<w-12;xx+=24){R(xx,h-26,10,14,street.color);R(xx+4,h-12,2,5,'#d3b485');}}
  else if(chapter.key==='tokyo'){R(w-18,40,12,Math.max(20,h-48),street.color);R(w-14,44,4,12,'#e6f9ff');}
  else{for(let yy=50;yy<h;yy+=22){R(w-36,yy,28,3,'#272d35');R(w-30,yy,3,20,'#272d35');}R(8,35,w-16,4,street.color);}
  R(4,h+35,w-8,5,'#1c3044');
  return{x,w,h,index,hp:780,max:780,dead:false,collapse:0,hit:0,seed:Math.floor(rnd()*99999),texture:s,kind,assetId:buildingAssetId(stageKey,kind)};
}
function makeBuilding(x,w,h,index){if(currentStage().key==='village'||currentStage().key==='suburb'&&index%3!==0)return makeVillageBuilding(x,w,h,index);let b={x,w,h,hp:260+index*10,max:260+index*10,index,dead:false,collapse:0,hit:0,seed:Math.floor(rnd()*99999),kind:'block',assetId:buildingAssetId('city','block')};const s=document.createElement('canvas');s.width=w;s.height=h+40;const c=s.getContext('2d');c.imageSmoothingEnabled=false;
const R=(a,b,w,h,col)=>{c.fillStyle=col;c.fillRect(a,b,w,h);};R(0,30,w,h,'#090f24');R(5,32,w-10,h,currentChapter().wall);R(w-19,32,15,h,'#16283f');R(8,34,4,h,'#496480');R(0,26,w,9,'#46617c');R(15,17,w-40,9,'#253b55');R(w/2,0,3,19,'#436080');R(w/2-2,0,7,4,'#ff537b');
for(let yy=48;yy<h+20;yy+=27){R(8,yy+17,w-24,5,'#12243e');for(let xx=20;xx<w-22;xx+=22){let lit=rnd()>.3;R(xx-3,yy-3,16,19,'#101b31');R(xx,yy,10,12,lit?['#ffd477','#ffe68e','#f9bd55'][Math.floor(rnd()*3)]:'#34577a');R(xx+8,yy,2,12,lit?'#ad8056':'#172d4c');}}
for(let yy=40;yy<h+20;yy+=70){R(1,yy,6,35,'#65778b');R(w-7,yy,6,32,'#43526f');}
const street=currentRoute().street,labels=street.signs;let sw=Math.min(w-14,106),sx=(index%2?7:w-sw-7),sy=65+index%3*25;R(sx-3,sy-3,sw+6,55,'#090c1c');R(sx,sy,sw,49,currentChapter().skyline[index%3]);c.strokeStyle=street.color;c.lineWidth=3;c.strokeRect(sx+3,sy+3,sw-6,43);const label=labels[index%labels.length];c.font=Math.min(22,Math.floor((sw-12)/label.length))+'px Pixel, monospace';c.textAlign='center';c.fillStyle=street.color;c.fillText(label,sx+sw/2,sy+30);R(15,h+7,w-30,23,'#071424');R(25,h+10,25,20,'#e3b973');R(56,h+10,19,20,'#38738f');b.texture=s;return b;}
function drawSkyTimeMarker(){
  const ch=currentChapter(),timeOfDay=ch.skyTime;
  if(timeOfDay==='dusk'){ctx.globalAlpha=.8;ctx.fillStyle='#ffb46b';ctx.beginPath();ctx.arc(180,170,42,0,7);ctx.fill();ctx.globalAlpha=1;}
  else if(timeOfDay==='night'){ctx.globalAlpha=.9;ctx.fillStyle='#e8efff';ctx.beginPath();ctx.arc(180,150,30,0,7);ctx.fill();ctx.fillStyle=ch.sky[0];ctx.beginPath();ctx.arc(194,140,30,0,7);ctx.fill();ctx.globalAlpha=1;for(let i=0;i<18;i++)rect((i*83)%W,70+(i*47)%230,3,3,'#d8e5ff');}
  else{ctx.globalAlpha=.72;ctx.fillStyle='#ffe0a0';ctx.beginPath();ctx.arc(180,145,34,0,7);ctx.fill();ctx.globalAlpha=1;}
}
function drawVillageSky(){
  const pal=currentChapter().sky,g=ctx.createLinearGradient(0,0,0,G);g.addColorStop(0,pal[0]);g.addColorStop(.6,pal[1]);g.addColorStop(1,pal[2]);ctx.fillStyle=g;ctx.fillRect(-W,-H,W*3,H*3);drawSkyTimeMarker();
  rect(1010-camera*.03,100,40,40,'#afc5bc');rect(1024-camera*.03,96,30,34,'#223c61');
  for(let layer=0;layer<2;layer++){
    for(let i=-2;i<19;i++){const x=i*130-camera*(.08+layer*.12),y=430+layer*65,h=38+(i*i%5)*10;
      rect(x,y-h,116,h,layer?'#344e61':'#293f59');
      poly([[x-8,y-h],[x+40,y-h-24],[x+120,y-h]],layer?'#263e55':'#213650');
      for(let j=0;j<4;j++)rect(x+14+j*25,y-23,10,13,j%2?'#94a294':'#c1b48a');
      rect(x+106,y-h-20,5,20,'#344f60');
    }
  }
  if(currentStage().key==='suburb')for(let i=0;i<12;i++){let x=700+i*65-camera*.08,h=90+(i*37)%180;rect(x,G-110-h,48,h,'#263f60');for(let yy=G-100-h;yy<G-120;yy+=18)rect(x+10,yy,7,8,'#6486a3');}
  rect(-W,G-55,W*3,80,currentChapter().road);drawChapterLandmarks();
  for(let i=-3;i<28;i++){let x=i*96-camera*.35,y=G-52;rect(x+24,y-34,8,44,'#354f50');rect(x+6,y-66,42,32,'#294f4f');rect(x-4,y-50,64,24,'#37645a');rect(x+10,y-64,22,8,'#608574');}
}
function drawChapterLandmarks(){
  const chapter=currentChapter(),idx=currentRoute().index,accent=chapter.districts[idx].color;
  // 远景采用有限视差，整段推进时地标不会滑出镜头。
  const drift=Math.sin(camera/1600)*36;
  if(chapter.key==='osaka'){
    const castle=780-drift;rect(castle-76,286,152,20,'#7e817d');
    for(let floor=0;floor<4;floor++){const y=252-floor*44,w=144-floor*24;rect(castle-w/2+14,y-24,w-28,32,'#e9dec0');for(let j=0;j<4;j++)rect(castle-w/2+24+j*(w-48)/4,y-16,6,12,'#45665e');for(let step=0;step<4;step++)rect(castle-w/2+step*8,y-34-step*4,w-step*16,5,'#3d8076');rect(castle-w/2-6,y-30,w+12,4,'#dfc781');}rect(castle-3,76,6,14,'#ffe1a0');
    const tower=1010-drift;rect(tower-6,260,12,300,'#c7a56c');rect(tower-42,270,84,10,'#e7c27b');rect(tower-30,220,60,10,'#e7c27b');rect(tower-22,174,44,10,'#e7c27b');poly([[tower-24,174],[tower,146],[tower+24,174]],'#f4d48c');rect(tower-45,336,90,7,accent);rect(tower-57,348,114,7,'#ff7a63');
    const neon=760-drift;rect(neon,320,160,34,'#1b102c');rect(neon+8,327,144,20,accent);text(chapter.districts[idx].signs[0],neon+80,343,16,'#fff0c2','center');
  } else if(chapter.key==='tokyo'){
    const tower=840-drift;
    // 两条阶梯形塔脚与横向桁架，区别于大阪的方形观景塔。
    for(let i=0;i<16;i++){const y=176+i*24,spread=8+i*3;rect(tower-spread,y,6,26,'#e36d72');rect(tower+spread-6,y,6,26,'#e36d72');if(i%2===0)rect(tower-spread,y,spread*2,4,'#ffb58d');}
    rect(tower-2,126,4,52,'#ffb58d');rect(tower-30,270,60,14,'#83dfff');rect(tower-38,378,76,12,'#ff9566');
    for(let x=600-drift;x<1280;x+=150){rect(x,390,10,170,'#263c5d');rect(x+120,390,10,170,'#263c5d');line([[x,396],[x+65,430],[x+120,396]],'#8ba8c5',4);line([[x,414],[x+120,414]],'#436486',3);}rect(590-drift,382,760,12,'#8ba8c5');
    const neon=980-drift;rect(neon,220,190,54,'#101535');rect(neon+8,228,174,36,accent);text('新宿 / NEON',neon+95,253,18,'#fff4d0','center');
  } else {
    let bx=900-drift;rect(bx,310,330,12,'#71808a');rect(bx+25,255,8,305,'#71808a');rect(bx+295,255,8,305,'#71808a');line([[bx+25,260],[bx+85,300],[bx+165,310],[bx+245,300],[bx+295,260]],'#b0a58d',5);for(let i=1;i<9;i++)rect(bx+25+i*30,276,3,40,'#817c76');
    const empire=810-drift;rect(empire-34,210,68,350,'#9b8d78');rect(empire-24,180,48,30,'#b8a487');rect(empire-10,120,20,60,'#b8a487');rect(empire-4,92,8,28,'#d6b36f');rect(empire-60,332,120,7,accent);for(let y=226;y<520;y+=18)for(let x=-22;x<30;x+=14)rect(empire+x,y,4,9,'#f1d08c');
    let step=40-drift;for(let i=0;i<6;i++){let x=step+i*88,h=100+i*42;rect(x,G-30-h,72,h,'#5a6268');rect(x+10,G-46-h,50,18,'#c3a36e');rect(x+22,G-64-h,26,18,'#5a6268');}
    const sign=1010-drift;rect(sign,198,196,42,'#151a22');rect(sign+8,206,180,27,accent);text(chapter.districts[idx].signs[0],sign+98,226,17,'#17242b','center');
  }
}
function drawChapterGround(){
  const ch=currentChapter(),col=currentRoute().street.color;
  rect(-W,G+28,W*3,H-G,ch.road);
  if(ch.key==='osaka'){
    rect(-W,G+66,W*3,52,ch.water);rect(-W,G+60,W*3,6,'#c39772');
    for(let x=-(camera%110)-110;x<W+180;x+=110){rect(x,G+34,5,26,col);rect(x,G+36,110,3,'#bb997a');rect(x+12,G+78,38,2,col);rect(x+28,G+90,24,2,'#78a6a1');}
  }else if(ch.key==='tokyo'){
    for(let y of [G+48,G+88]){rect(-W,y,W*3,5,'#8ea7ba');for(let x=-(camera%52)-52;x<W+100;x+=52)rect(x,y+5,7,12,'#45556a');}
    for(let x=-(camera%290)-290;x<W+300;x+=290){rect(x,G+30,90,5,col);rect(x+130,G+110,48,4,'#d2d2b5');}
  }else{
    rect(-W,G+71,W*3,3,'#e8c866');rect(-W,G+78,W*3,3,'#e8c866');
    for(let x=-(camera%350)-350;x<W+360;x+=350){for(let i=0;i<5;i++)rect(x+i*18,G+31,10,30,'#c7c4b4');rect(x+170,G+98,32,8,'#17222b');rect(x+166,G+95,40,3,col);}
  }
}
function drawVillageGround(){
  rect(-W,G,W*3,H,'#1b2c40');rect(-W,G,W*3,7,'#96a39b');rect(-W,G+7,W*3,16,'#4f6670');rect(-W,G+25,W*3,4,'#111f31');
  for(let x=-(camera%150)-160;x<W+200;x+=150){rect(x,G+67,65,4,'#c3b98a');rect(x+30,G+12,55,3,'#334958');rect(x+42,G+100,46,2,'#3f566c');}
  for(let i=-2;i<18;i++){let x=i*230-camera;rect(x,G-26,135,26,'#647782');rect(x-3,G-29,141,5,'#a2aea5');for(let j=0;j<6;j++)rect(x+j*23,G-17,18,2,'#405766');}
  for(let x=-(camera%460)-80;x<W+400;x+=460){
    rect(x,G-170,7,170,'#526675');rect(x-22,G-169,53,5,'#8c9da1');rect(x-14,G-178,5,12,'#c0bbb0');rect(x+17,G-178,5,12,'#c0bbb0');
    line([[x-13,G-175],[x+210,G-151],[x+447,G-175]],'#172b40',2);
    line([[x+19,G-175],[x+246,G-146],[x+479,G-175]],'#24374b',2);
    rect(x+6,G-128,26,6,'#748b93');rect(x+24,G-123,14,5,'#ffdd99');
  }
  drawChapterGround();
}
function drawSky(){if(currentStage().key!=='city'){drawVillageSky();return;}const pal=currentChapter().sky,g=ctx.createLinearGradient(0,0,0,G);g.addColorStop(0,pal[0]);g.addColorStop(.65,pal[1]);g.addColorStop(1,pal[2]);ctx.fillStyle=g;ctx.fillRect(0,0,W,H);drawSkyTimeMarker();
for(let i=0;i<12;i++){let x=((i*179-time*4-camera*.08)%1500+1500)%1500-200,y=85+(i%4)*31;rect(x,y,180+i%3*40,14,'#102047');rect(x+30,y-12,100,18,'#102047');}
for(let layer=0;layer<3;layer++){let factor=[.13,.26,.43][layer];for(let b of skyline[layer]){let x=b.x-camera*factor;if(x<-150||x>1400)continue;let bottom=G-50+layer*14,h=b.h*(.75+layer*.12);rect(x,bottom-h,b.w,h,currentChapter().skyline[layer]);rect(x+3,bottom-h+3,3,h-3,'#284371');rect(x+b.w/2,bottom-h-9,3,9,'#203c63');if(Math.sin(time*3+b.seed)>0)rect(x+b.w/2,bottom-h-12,4,4,'#fc4b80');for(let yy=bottom-h+13;yy<bottom-8;yy+=17){for(let xx=8;xx<b.w-8;xx+=14){let hash=((b.seed+Math.floor(yy)*17+xx*13)%29);if(hash>7)rect(x+xx,yy,6,7,hash>20?'#ffc65e':layer===0?'#37559c':'#648cc4');}}}}
drawChapterLandmarks();
rect(0,557,W,50,'#061e53');for(let i=0;i<100;i++){let x=(i*91+Math.sin(time*1.7+i)*13)%1280,y=561+i%9*5;rect(x,y,10+i%5*7,2,['#2153ad','#0e79bc','#2867df','#8a5cab'][i%4]);}
}
function drawGround(){if(currentStage().key!=='city'){drawVillageGround();return;}rect(0,G,W,H-G,'#061534');rect(0,G,W,7,'#67728a');rect(0,G+7,W,8,'#263c55');for(let x=-(camera%110);x<W;x+=110){rect(x,G+15,105,23,'#172942');rect(x+5,G+19,4,17,'#2f4057');rect(x+70,G+18,25,15,'#0b1a31');}rect(0,G+40,W,2,'#3f85b8');rect(0,G+43,W,H-G,'#052155');for(let i=0;i<175;i++){let x=((i*73-camera*.75+Math.sin(time*(i%3+1)+i)*16)%1320+1320)%1320,y=G+48+i%28*3;rect(x,y,10+i%6*8,2+i%2*2,['#123c81','#145fc5','#1454a6','#287ce3','#09409e'][i%5]);}
for(let i=0;i<10;i++){let wx=((i*191-camera*.7)%1400+1400)%1400;for(let k=0;k<13;k++){let x=wx+Math.sin(time*2+k*.8+i)*13;rect(x-k*1.5,G+47+k*6,10+(k%4)*8,2,i%3===0?'#d25ea090':i%3===1?'#e6af5790':'#28b3ec90');}}
for(let x=-(camera%360)+85;x<W;x+=360){rect(x,G-66,4,67,'#10162d');rect(x-11,G-66,26,5,'#627d99');rect(x-8,G-62,20,7,'#ffdc81');rect(x-4,G-55,12,5,'#f8ae53');}
for(let x=-(camera%155);x<W;x+=155){rect(x,G-3,40,3,'#d5b951');}
drawChapterGround();
}
function fire(x,y,size=30){let tick=Math.floor(time*14);for(let i=0;i<9;i++){let h=(.55+Math.sin(i*34+tick)*.22+Math.cos(i*11-tick)*.13)*size;let xx=x+(i-4)*size/7,w=Math.max(6,size/5);poly([[xx-w/2,y],[xx-w/2,y-h*.35],[xx-w*.75,y-h*.35],[xx-w*.75,y-h*.66],[xx-w*.2,y-h*.66],[xx-w*.2,y-h],[xx+w*.2,y-h],[xx+w*.2,y-h*.8],[xx+w*.6,y-h*.8],[xx+w*.6,y-h*.4],[xx+w/2,y-h*.4],[xx+w/2,y]],'#cf3e27');poly([[xx-w*.4,y],[xx-w*.4,y-h*.38],[xx,y-h*.75],[xx+w*.3,y-h*.52],[xx+w*.4,y]],'#ff982c');rect(xx-2,y-h*.32,Math.max(4,w*.3),h*.32,'#ffea79');}for(let i=0;i<5;i++){let life=(time*1.4+i*.19)%1;rect(x+Math.sin(i*5+time)*size*.45,y-size*(.6+life),3,5,life<.7?'#ff9d3d':'#a64030');}}

function drawTank(e){let x=e.x-camera,y=e.y,dir=e.x>p.x?-1:1;ctx.save();ctx.translate(x,y);ctx.scale(dir,1);rect(-41,-10,82,25,'#080f1c');rect(-38,-8,76,19,'#293622');for(let i=-28;i<=28;i+=14){rect(i-5,5,10,10,'#0a1017');rect(i-3,6,6,6,'#85908a');}poly([[-40,-9],[-28,-21],[26,-21],[40,-7]],'#617132');rect(-34,-17,64,5,'#89934a');rect(-17,-36,39,19,'#53602b');rect(-10,-41,21,7,'#72813b');rect(17,-32,47,7,'#758348');rect(54,-33,13,9,'#323e2d');rect(-7,-31,7,5,'#101c25');rect(-31,-9,8,4,'#f0c54d');rect(29,-9,7,4,'#e3843e');if(e.type==='rocket'){rect(-26,-47,47,17,'#29352c');for(let i=0;i<4;i++)rect(-23+i*11,-44,7,11,'#829071');}if(e.hit>0){ctx.globalAlpha=.45;rect(-40,-40,80,54,'#fff3bc');ctx.globalAlpha=1;}ctx.restore();}
function drawHeli(e){let x=e.x-camera,y=e.y,dir=e.x>p.x?-1:1;ctx.save();ctx.translate(x,y);ctx.scale(dir,1);poly([[-42,-12],[17,-22],[41,-12],[45,4],[27,17],[-29,13]],'#070f1e');poly([[-37,-9],[16,-17],[36,-8],[38,2],[22,11],[-25,9]],'#606a2d');rect(-32,-6,57,7,'#92944b');rect(9,-13,12,12,'#73cbd2');rect(23,-9,10,10,'#55a9bc');rect(8,-12,3,11,'#243731');rect(-8,-10,10,19,'#293b2d');rect(-68,-8,35,5,'#68793b');poly([[-70,-16],[-61,-15],[-57,3],[-66,3]],'#83904a');rect(-70,-23,3,34,'#152133');rect(-78,-8,18,3,'#adb3a0');rect(-7,-28,5,12,'#536b70');let rw=35+Math.abs(Math.sin(time*60))*37;rect(-rw,-30,rw*2,3,'#909cad');rect(-20,20,52,3,'#8b9ca1');rect(-16,12,3,10,'#627885');rect(23,12,3,10,'#627885');rect(-22,7,6,4,Math.sin(time*6)>0?'#ff395c':'#682d47');if(e.hit>0){ctx.globalAlpha=.5;rect(-40,-20,80,38,'#fff2bd');ctx.globalAlpha=1;}ctx.restore();}
/* 单位变体：从 drawEnemy 的分支链里提出来，好让"哪个单位用哪个绘制函数"
 * 变成 assets/asset-index.js 里的一条声明（renderer 字段）。绘制内容一字未改。 */
function drawGunship(e){ctx.save();let x=e.x-camera,y=e.y;ctx.translate(x,y);ctx.scale(1.3,1.2);drawHeli({...e,x:camera,y:0});rect(-50,8,25,12,'#464e65');rect(18,13,29,8,'#283e5c');rect(-44,11,7,5,'#e07e57');ctx.restore();}
function drawMech(e){let x=e.x-camera,y=e.y;ctx.save();ctx.translate(x,y);let step=Math.sin(time*3+e.phase)*4;rect(-50,-14,38,23,'#1a2639');rect(12,-14,38,23,'#1a2639');rect(-45,-48+step,28,40,'#516277');rect(16,-48-step,28,40,'#516277');poly([[-56,-45],[-45,-103],[40,-103],[60,-45]],'#263d59');rect(-45,-101,85,18,'#6c7b85');rect(-74,-88,147,12,'#3e5570');rect(-86,-93,30,23,'#668291');rect(-91,-90,12,17,'#85f2ff');rect(-12,-118,30,18,'#364e6b');rect(-6,-113,16,6,'#ff665f');for(let i=-34;i<40;i+=19)rect(i,-62,10,5,'#e89e64');ctx.restore();}
function drawAegis(e){ctx.save();ctx.translate(e.x-camera,e.y);ctx.scale(1.3,1.2);drawTank({...e,x:camera,y:0,type:'rocket'});rect(-15,-61,10,29,'#40576e');rect(-5,-59,55,10,'#7293aa');rect(43,-62,20,15,'#74dfff');if(e.state==='alive'&&Math.sin(time*3)>.1){ctx.globalAlpha=.35;line([[59,-56],[69,-39],[69,1]],'#7cddff',3);ctx.globalAlpha=1;}ctx.restore();}
function drawBuildings(layer){for(let b of buildings){if(b.layer!==layer)continue;let x=b.x-camera,y=b.ground-b.h-30;if(x<-240||x>W+150)continue;ctx.save();if(layer===0)ctx.globalAlpha=.75;
if(b.dead){if(b.collapse<2.7){let t=b.collapse;for(let j=0;j<b.floorCount;j++){let sh=(b.h+40)/b.floorCount,local=Math.max(0,t-j*.035),fall=local*local*180,yy=y+j*sh+fall;if(yy>b.ground)continue;ctx.save();ctx.translate(x+b.w/2+Math.sin(j*2.1)*local*18,yy+sh/2);ctx.rotate(b.tilt*local*(b.floorCount-j));ctx.drawImage(b.texture,0,j*sh,b.w,sh,-b.w/2,-sh/2,b.w,sh+1);ctx.restore();}}for(let j=0;j<8;j++)rect(x+j*b.w/8,b.ground-4-(j%3)*7,b.w/7,10+j%3*7,['#263748','#4b5a6d','#1c293d'][j%3]);ctx.restore();continue;}
ctx.drawImage(b.texture,x,y,b.w,b.h+40);if(layer===2){ctx.globalAlpha=.24;rect(x,b.ground-b.h,b.w,b.h,'#070b1c');ctx.globalAlpha=1;}if(b.hit>0){ctx.globalAlpha=b.hit*2;rect(x,b.ground-b.h,b.w,b.h,'#ffe3b5');ctx.globalAlpha=1;}if(b.hp<b.max*.8){let ratio=1-b.hp/b.max;for(let j=0;j<3;j++){let yy=b.ground-b.h+60+j*b.h/3;line([[x+b.w*.7,yy-30],[x+b.w*.35,yy],[x+b.w*.62,yy+20],[x+b.w*.28,yy+55]],'#080d20',4+ratio*5);}fire(x+b.w*.64,b.ground-b.h*.55,20+ratio*45);}ctx.restore();}}
function drawForeground(){if(currentStage().key!=='city')return;for(let i=-1;i<9;i++){let x=i*840+100-camera*1.13;if(x<-190||x>W+100)continue;let w=148,h=155+i%3*44,y=H-h;rect(x,y,w,h,'#090f22');rect(x+7,y+6,130,h,'#102039');rect(x-10,y-6,w+20,12,'#24334a');for(let yy=y+20;yy<H;yy+=25)for(let xx=16;xx<w-10;xx+=25)rect(x+xx,yy,9,13,(xx+yy)%3===0?'#9d825d':'#29415a');rect(x+35,y-35,60,29,'#16263e');rect(x+45,y-31,9,20,'#35465d');rect(x+98,y-65,3,65,'#2b405a');line([[x+100,y-55],[x+320,y+10],[x+560,y-25]],'#080e1d',3);}}

// Silver/red tokusatsu giant: articulated pixel plates, facing the kaiju.
function updateSentinel(e,dt){
  const B=window.SentinelBoss;
  if(!bossChallengeStarted)return;
  if(e.introDone===false){
    if(!e.introStarted){if(Math.abs(e.x-p.x)>BOSS_IN_RANGE)return;e.introStarted=true;e.introTime=0;banner('上空高能反应','巨型生命体正在急速接近');sound('roar');}
    const previous=e.introTime;e.introTime=Math.min(B.INTRO.duration,e.introTime+dt);
    if(previous<B.INTRO.impact&&e.introTime>=B.INTRO.impact){
      shake=19;slow=.17;sound('boom');
      rings.push({x:e.x,y:G-3,r:30,life:1.1,color:'#d7edf4',type:'stomp'});
      rings.push({x:e.x,y:G-2,r:10,life:.7,color:'#7aefff',type:'stomp'});
      burst(e.x,G-5,80,['#d1bf9a','#7e8792','#a8c3cb'],330);
      for(let i=0;i<18;i++)particles.push({x:e.x+(i-9)*12,y:G-6,vx:(i-9)*23,vy:-18-Math.abs(i-9),gravity:0,size:16,life:.7,color:i%2?'#879399':'#b4b2a3',smoke:true});
      for(const b of buildings)if(!b.dead&&Math.abs(b.x+b.w/2-e.x)<250){b.dead=true;b.hp=0;b.collapse=3;burst(b.x+b.w/2,G-8,12,['#697a83','#b3a58c'],160);}
    }
    if(previous<3.25&&e.introTime>=3.25){banner('银曜巨人 · 降临','关底封锁 · 击破核心才能继续前进');sound('shot');}
    if(e.introTime>=B.INTRO.duration){e.introDone=true;e.announced=true;e.cd=1.1;save();}
    return;
  }
  if(Math.abs(e.x-p.x)>850)return;
  e.fired=Math.max(0,(e.fired||0)-dt);
  if(e.meleeTime!=null){
    const previous=e.meleeTime;e.meleeTime+=dt;
    if(previous<B.MELEE.hit&&e.meleeTime>=B.MELEE.hit){
      const fist=B.pose({...e,meleeTime:B.MELEE.hit},G).fist,hb=KaijuRig.hitbox(BS,p.x,G);
      sound('hit');
      if(fist.x>=hb.x0-22&&fist.x<=hb.x1+22&&fist.y>=hb.y0-22&&fist.y<=hb.y1+22){
        burst(fist.x,fist.y,30,['#fff6dc','#ff955a','#bfefff'],230);rings.push({x:fist.x,y:fist.y,r:8,life:.24,color:'#fff0c2',type:'blast'});
        p.recoil=.25;p.stagger=.32;hitFlash=.2;shake=12;slow=.11;
      }else burst(fist.x,fist.y,6,['#b9e5ee','#fff6df'],80);
    }
    if(e.meleeTime>=B.MELEE.duration){e.meleeTime=null;e.meleeTarget=null;e.cd=2.2;}
    return;
  }
  e.cd-=dt;
  // At close range prefer a clearly telegraphed body blow; retain occasional ranged attacks.
  if(e.cd<=1.4&&Math.abs(e.x-p.x)<285&&(e.meleeCount||0)%3!==2){
    const hb=KaijuRig.hitbox(BS,p.x,G);e.meleeTarget={x:hb.x1-12,y:hb.y0+(hb.y1-hb.y0)*.55};e.meleeTime=0;e.meleeCount=(e.meleeCount||0)+1;e.fired=0;return;
  }
  if(e.cd<=0){const m=B.pose(e,G).muzzle;shoot({...e,x:m.x,y:m.y+13,type:'aegis'});e.cd=5.2;e.fired=.38;e.meleeCount=(e.meleeCount||0)+1;shake=Math.max(shake,4);}
}
function drawSentinel(e){
  if(e.introDone===false&&!e.introStarted)return;
  if(e.introDone===false){
    const t=e.introTime,x=e.x-camera;
    ctx.save();ctx.globalAlpha=.35;ctx.fillStyle='#050b16';ctx.beginPath();ctx.ellipse(x,G,35+65*Math.min(1,t/1.5),9,0,0,Math.PI*2);ctx.fill();ctx.restore();
    if(t>.65&&t<1.5){for(let i=0;i<7;i++){const xx=x-65+i*22;line([[xx,G-650],[xx-22,G-110]],i%2?'#bdfaff88':'#59bccc66',i%2?4:2);}}
    if(t>=1.5){ctx.save();ctx.globalAlpha=Math.min(.75,(t-1.5)*5);for(let i=0;i<7;i++){let d=i%2?1:-1,xx=x+d*(20+i*13);line([[x,G+2],[xx,G+i%3*5],[xx+d*34,G+4+i%3*9]],'#18232c',3);}ctx.restore();}
  }
  const pose=sentinelRenderer.draw(ctx,e,camera,G);
  if(e.hit>0){ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha=.5;sentinelRenderer.draw(ctx,e,camera,G);ctx.restore();}
  if(alive(e)&&(e.introDone!==false||e.introTime>=3.25)){
    const x=e.x-camera,hudX=Math.min(x+115,W-260);
    rect(hudX,G-360,200,30,'#111c30');text('BOSS · 银曜巨人',hudX+100,G-341,16,'#f4dca9','center');
    rect(hudX,G-324,200,8,'#263346');rect(hudX,G-324,200*clamp(e.hp/e.max,0,1),8,'#df5469');
    if(pose.melee){text(e.meleeTime<.72?'重拳蓄势':'重拳突击',hudX+100,G-304,12,'#ffb48d','center');if(e.meleeTime>.5&&e.meleeTime<.84){const prev=window.SentinelBoss.pose({...e,meleeTime:Math.max(.46,e.meleeTime-.10)},G).fist;line([[prev.x-camera,prev.y],[pose.fist.x-camera,pose.fist.y]],'#d7faff99',9);}}
    if(pose.charge>0){text('核心蓄力',hudX+100,G-304,12,'#7bf0f3','center');const m=pose.muzzle;for(let i=0;i<6;i++){let a=i*Math.PI/3+e.phase*4,r=25*(1-pose.charge)+8;rect(m.x-camera+Math.cos(a)*r,m.y+Math.sin(a)*r,4,4,'#a5ffff');}}
    if(e.fired>0){const m=pose.muzzle;line([[m.x-camera,m.y],[m.x-camera-65,m.y]],'#abffff',6);}
  }
}

function drawEnemy(e){if(e.type==='sentinel'){if(e.state!=='gone'&&Math.abs(e.x-camera-W/2)<W)drawSentinel(e);return;}if(e.state==='gone'||e.state==='exploding')return;if(e.x-camera<-200||e.x-camera>W+180)return;ctx.save();let dying=e.state!=='alive';if(dying){ctx.translate(e.x-camera,e.y);ctx.rotate(e.rotation);}let temp=dying?{...e,x:camera,y:0,hit:0}:e;
let flying=/heli|gunship|jet|drone/.test(e.type);
/* 绘制函数由资产索引的 renderer 字段指定，不再是 if/else 分支链。 */
(UNIT_RENDERERS[TYPES[e.type].renderer]||drawTank)(temp);if(dying)fire(0,10,flying?30:20);ctx.restore();}
function drawJet(e){let x=e.x-camera,y=e.y,dir=e.x>p.x?-1:1;ctx.save();ctx.translate(x,y);ctx.scale(dir,1);
poly([[-34,-6],[18,-12],[34,-4],[30,4],[-30,8]],'#0c1726');poly([[-30,-4],[16,-9],[32,-3],[28,3],[-26,6]],'#3a4658');
rect(-6,-18,20,12,'#54627a');rect(2,-15,12,7,'#7fb4cf');rect(-34,-2,12,4,'#ffb13c');rect(10,-2,10,4,'#e0573a');rect(-22,2,4,12,'#27303f');
if(e.hit>0){ctx.globalAlpha=.5;rect(-34,-14,68,28,'#fff2bd');ctx.globalAlpha=1;}ctx.restore();}
function drawDrone(e){let x=e.x-camera,y=e.y,dir=e.x>p.x?-1:1;ctx.save();ctx.translate(x,y);ctx.scale(dir,1);let bob=Math.sin(time*8+e.phase)*3;ctx.translate(0,bob);
rect(-14,-6,28,12,'#1a2433');rect(-12,-4,24,8,'#33414f');rect(-22,-10,8,6,'#2a3340');rect(14,-10,8,6,'#2a3340');rect(-4,-12,8,4,'#7fb4cf');
poly([[-22,-4],[-28,4],[-18,4]],'#2a3340');poly([[22,-4],[28,4],[18,4]],'#2a3340');rect(-3,2,6,6,'#ff7a4a');
if(e.hit>0){ctx.globalAlpha=.5;rect(-24,-14,48,26,'#fff2bd');ctx.globalAlpha=1;}ctx.restore();}
function drawWalker(e){let x=e.x-camera,y=e.y;ctx.save();ctx.translate(x,y);let step=Math.sin(time*3+e.phase)*4;
poly([[-44,-30],[44,-30],[36,-8],[-36,-8]],'#1c2a3c');rect(-34,-78+step,26,52,'#4a5b6e');rect(10,-78-step,26,52,'#4a5b6e');rect(-10,-96,20,26,'#5d6f82');rect(-6,-92,12,10,'#ff6b63');
poly([[-50,-26],[-40,-78],[40,-78],[50,-26]],'#26384e');rect(-46,-30,92,10,'#33465c');
for(let s=-1;s<=1;s+=2){rect(s*18-4,6,8,18,'#2a3a4f');rect(s*18-4,22,8,10,'#1c2a3c');rect(-s*30-4,6,8,18,'#2a3a4f');rect(-s*30-4,22,8,10,'#1c2a3c');}
if(e.hit>0){ctx.globalAlpha=.4;rect(-50,-100,100,120,'#fff3bc');ctx.globalAlpha=1;}ctx.restore();}
function drawBunker(e){let x=e.x-camera,y=e.y;ctx.save();ctx.translate(x,y);
poly([[-52,-4],[52,-4],[44,-46],[-44,-46]],'#202c3e');rect(-44,-44,88,42,'#33465c');rect(-30,-40,18,18,'#0c1726');rect(8,-40,18,18,'#0c1726');rect(-6,-34,12,12,'#ff6b63');
rect(-14,-12,28,10,'#3a4a5e');rect(-8,-16,16,8,'#5d6f82');rect(-50,-6,100,8,'#1a2433');
if(e.hit>0){ctx.globalAlpha=.4;rect(-54,-50,108,56,'#fff3bc');ctx.globalAlpha=1;}ctx.restore();}
/* 绘制函数名 → 实现。名字由 assets/asset-index.js 的 ENEMY_UNITS[].renderer 给出，
 * 测试会校验每个登记单位的 renderer 都能在这张表里找到（漏写不会静默退化成坦克）。 */
const UNIT_RENDERERS={drawSentinel,drawTank,drawHeli,drawGunship,drawJet,drawDrone,drawMech,drawAegis,drawWalker,drawBunker};
function drawWrecks(){for(let w of wrecks){let x=w.x-camera;if(x<-200||x>W+100)continue;ctx.save();ctx.translate(x,w.y);ctx.rotate(w.angle);rect(-31,-18,65,20,'#141e2b');poly([[-20,-18],[-8,-35],[18,-29],[34,-15]],'#394352');rect(-26,-8,12,9,'#4c5b65');rect(15,-8,12,9,'#4c5b65');ctx.restore();}}
function drawGodzilla(sk,bs){syncGrowthSkin();const decor=Appearance.decor({form:Appearance.FORMS[economy.epochIndex()],epoch:economy.epoch(),level:data.level,morph:data.morph,talents:data.talents,elementColor:elementColor(),beamColor:beamColor()});skeleton.draw(ctx,sk,camera,bs);fins.draw(ctx,sk,camera,bs,decor.spikes);drawMorph(ctx,sk,camera,bs);let a=p.action;if(a.name==='beam'){let charge=clamp(a.t/.95,0,1),m=sk.muzzle;for(let i=0;i<11;i++){let tail=sk.bones.tail_base,head=sk.bones.head,x=tail.x+(head.x-tail.x)*i/10-50,y=tail.y+(head.y-tail.y)*i/10-50;if(a.t<3.6){let pulse=(Math.sin(time*15-i*.7)+1)/2;ctx.globalAlpha=pulse*.6*charge;rect(x-camera-7,y-7,14,14,a.super?'#ff8a5a':beamColor());}}ctx.globalAlpha=1;if(a.t<1.05){for(let i=0;i<13;i++){let angle=i/13*Math.PI*2+time*4,r=(1-charge)*55+5;rect(m.x-camera+Math.cos(angle)*r,m.y+Math.sin(angle)*r,4,4,'#9affff');}rect(m.x-camera-5,m.y-5,10,10,'#edffff');}}
if(a.name==='claw'&&a.t>.44&&a.t<.72){let c=sk.claw;for(let j=0;j<3;j++)line([[c.x-camera-75,c.y-80+j*17],[c.x-camera+20,c.y-22+j*17],[c.x-camera-10,c.y+25+j*17]],'#b6f5ff',4);}if(a.name==='tail'&&a.t>.6&&a.t<1.05){let c=sk.tail;line([[c.x-camera-25,c.y-40],[c.x-camera-60,c.y],[c.x-camera+50,c.y+20]],'#b3cee0aa',7);}}
/* 程序化绘制形态体征（背鳍、角、眼、护甲、辉光、体色），接在骨骼之上。
 * 「哪个突变改哪个槽的哪个轴」全部声明在 appearance.js 的 decor()，
 * 这里只负责把解算结果画出来 —— 以后加新体征改的是那张声明表，不是这条函数。 */
function spineAt(pts,f){let tot=0,seg=[];for(let i=0;i<pts.length-1;i++){let d=Math.hypot(pts[i+1].x-pts[i].x,pts[i+1].y-pts[i].y);seg.push(d);tot+=d;}let d=f*tot;for(let i=0;i<seg.length;i++){if(d<=seg[i]||i===seg.length-1){let u=seg[i]?d/seg[i]:0;return{x:pts[i].x+(pts[i+1].x-pts[i].x)*u,y:pts[i].y+(pts[i+1].y-pts[i].y)*u};}d-=seg[i];}}
function drawMorph(c,rs,cam,bs){const b=rs.bones,s=bs||1;
  /* level 必须传：背鳍等体征的解锁门槛（15 级）在 growth 里，decor() 不自己猜等级。 */
  const D=Appearance.decor({form:Appearance.FORMS[economy.epochIndex()],epoch:economy.epoch(),level:data.level,morph:data.morph,talents:data.talents,elementColor:elementColor(),beamColor:beamColor()});
  const col=D.spikes.color;
  /* 背鳍已由 FinRenderer 作为独立贴图组件绘制；这里不再画第二套程序化背鳍，
   * 否则 L1 的 nofin 身体会被这段重新长出鳍，且 L15 会出现双层背鳍。 */
  const hd=D.horns;if(hd.count){let h=b.head;for(let k=0;k<hd.blades;k++){let ox=(k?18:-14)*s;poly([[h.x-cam+ox-4*s,h.y-30*s],[h.x-cam+ox,h.y-hd.heightPx*s],[h.x-cam+ox+4*s,h.y-30*s]],'#dfe6ee');}}
  if(D.eye.glow){let h=b.head;c.save();c.globalAlpha=.6;c.fillStyle='#ff5a4a';c.beginPath();c.ellipse(h.x-cam-22*s,h.y-6*s,9*s,6*s,0,0,7);c.fill();c.restore();}
  if(D.eye.third){let h=b.head;c.save();c.globalAlpha=.85;c.fillStyle='#ffe06a';c.beginPath();c.arc(h.x-cam,h.y-26*s,5*s,0,7);c.fill();c.restore();}
  if(D.plates.on){let to=b.torso;c.save();c.globalAlpha=.5;c.strokeStyle='#0c1726';c.lineWidth=Math.max(1,3*s);for(let r=-1;r<=1;r++)for(let q=-1;q<=1;q++)c.strokeRect(to.x-cam+r*34*s-12*s,to.y+q*30*s-14*s,24*s,28*s);c.restore();}
  if(D.aura.on){let to=b.torso;c.save();c.globalAlpha=.35;for(let i=0;i<6;i++){let ang=time*.6+i/6*6.28,rr=(70+Math.sin(time*2+i)*8)*s;c.fillStyle=D.aura.color;c.beginPath();c.arc(to.x-cam+Math.cos(ang)*rr,to.y+Math.sin(ang)*rr,4*s,0,7);c.fill();}c.restore();}
  /* 体色现在使用同 alpha 的完整皮肤贴图，禁止向城市背景盖矩形叠色。 */
  if(D.tail.twin){let tt=b.tail_tip;c.save();c.translate(tt.x-cam,tt.y);c.scale(-1,1);poly([[-10*s,0],[20*s,-14*s],[34*s,0]],col);c.restore();}}
function drawBeam(){if(!beam)return;if(beam.fire){drawFlame(beam.x-camera,beam.y,beam.ex-camera,beam.ey,beam.super);for(let a of arcs)line([[a.x-camera,a.y],[(a.x+a.ex)/2-camera+Math.sin(time*30)*20,(a.y+a.ey)/2-20],[a.ex-camera,a.ey]],'#a4eeff',4);return;}
let {x,y,ex,ey}=beam;x-=camera;ex-=camera;let colors=beam.super?['#6e142d','#ef394a','#ff8e46','#ffe598','#fff7d5']:[beamColor(),'#9defff','#bff4ff','#e6ffff','#faffee'];[48,34,22,12,5].forEach((w,i)=>line([[x,y],[ex,ey]],colors[i],w));let d=Math.hypot(ex-x,ey-y);for(let i=0;i<d;i+=16){let t=i/d;rect(x+(ex-x)*t+Math.sin(i+time*40)*8,y+(ey-y)*t+Math.cos(i+time*33)*17,8,5,colors[i%3+2]);}for(let a of arcs)line([[a.x-camera,a.y],[(a.x+a.ex)/2-camera+Math.sin(time*30)*20,(a.y+a.ey)/2-20],[a.ex-camera,a.ey]],'#a4eeff',4);}
/* 火焰呼吸：与光束完全不同的造型——沿吐息方向张开的锥形火舌（多层叠色 + 飘动余烬），
 * 不是又细又直的光束。伤害由原子炉心 + 巨兽力量共同决定（见 updateBeam）。 */
function drawFlame(x,y,ex,ey,superB){let dx=ex-x,dy=ey-y,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,nx=-uy,ny=ux;let w1=86*(superB?1.35:1),w0=14;
for(let pass=0;pass<3;pass++){let col=['#b51a06','#ff5a1e','#ffb43a'][pass],wide=[1,0.7,0.42][pass];
  for(let i=15;i>=1;i--){let t=i/15,flick=Math.sin(time*22+i*1.7+pass)*9*wide;let w=(w0+(w1-w0)*t)*wide+flick;let bx=x+dx*t,by=y+dy*t,px=x+dx*(t-0.07),py=y+dy*(t-0.07);poly([[bx+nx*w,by+ny*w],[px,py],[bx-nx*w,by-ny*w]],col);}}
line([[x,y],[ex,ey]],'#ffe9a8',5+(superB?3:0));
for(let i=0;i<8;i++){let t=(i/8+(time*0.35)%1)%1;let bx=x+dx*t,by=y+dy*t,flick=Math.sin(time*30+i*2)*12;rect(bx+nx*flick-2,by+ny*flick-2,5,5,['#ffd36b','#ff7a1e','#ff3c10'][i%3]);}}
function drawParticles(){for(let a of particles){ctx.globalAlpha=clamp(a.life/(a.smoke?1.8:.3),0,1);let x=a.x-camera;rect(x-a.size/2,a.y-a.size/2,a.size,a.size,a.color);if(!a.smoke&&a.size>7)rect(x,a.y,a.size*.35,a.size*.35,'#ffe6a0');if(a.smoke)rect(x-a.size*.3,a.y-a.size*.7,a.size*.6,a.size*.35,a.color);}ctx.globalAlpha=1;for(let r of rings){ctx.globalAlpha=Math.min(1,r.life);ctx.strokeStyle=r.color;ctx.lineWidth=r.type==='blast'?9:4;ctx.beginPath();ctx.ellipse(r.x-camera,r.y,r.r,r.type==='stomp'?r.r*.17:r.r,0,0,Math.PI*2);ctx.stroke();}ctx.globalAlpha=1;for(let f of floaters){ctx.globalAlpha=Math.min(1,f.life);text(f.text,f.x-camera,f.y,13,f.color,'center');}ctx.globalAlpha=1;}
function drawWeather(){
  const weather=currentChapter().weather||{key:'rain',color:'#8dc6ef',density:.62,lightning:false};
  if(weather.key==='rain'||weather.key==='storm'){
    const count=Math.round(200*weather.density);
    for(let i=0;i<count;i++){let speed=430+i%5*90,x=((i*97-time*speed*.26-camera*.15)%1400+1400)%1400-40,y=(i*61+time*speed)%760-20;line([[x,y],[x-5-i%3,y+15+i%4*4]],i%4===0?weather.color+'b3':weather.color+'80',i%4===0?2:1);}
    for(let i=0;i<Math.round(32*weather.density);i++){let x=(i*153+Math.floor(time*8)*17)%1280,y=G+2+i%5*6,phase=(time*3+i*.2)%1;ctx.globalAlpha=(1-phase)*.45;line([[x-6*phase,y-2*phase],[x,y-6*phase],[x+6*phase,y-2*phase]],weather.color,2);}
  } else {
    ctx.globalAlpha=.12;
    for(let i=0;i<7;i++){let x=((i*241-time*9-camera*.04)%1500+1500)%1500-100,y=150+i%4*95;rect(x,y,260+i%3*90,34,weather.color);rect(x+40,y-18,150,42,weather.color);}
    ctx.globalAlpha=1;
  }
  if(weather.lightning&&lightning>0){ctx.globalAlpha=lightning*1.8;rect(0,0,W,H,'#758cfa');ctx.globalAlpha=1;line(bolt,'#668dff',10);line(bolt,'#eaf6ff',4);if(bolt.length>5)line([bolt[3],[bolt[3][0]+100,150],[bolt[3][0]+130,230]],'#99baff',3);}
  ctx.globalAlpha=1;
}
function drawCampaignRoute(){
  /* 版面尺寸 2026-09-20 按反馈整体放大（"进度条太小了"）。
   *
   * 预算来自实测，不是目测：.workbuddy/_route-metric.cjs 量出画面上那一排 DOM
   * 浮层在 1280×720 逻辑坐标里的真实占位 —— .camera-top 从 y=158 起、.ticker
   * 从 y=662 起、.action-caption 在左下 573~655。所以这条推图条可以用到 y≈150
   * 而不撞它们；改大这里任何数字之前先重跑那个探针。
   *
   * 现在的版面：底板 y 6~138，标题 22px 基线 40，轨道 10px 压在中线 y=78 上，
   * 节点 30px 方块（闸门开时套 40px 红框），右栏三行 18px。 */
  const r=currentRoute(),ready=bossChallengeAvailable(),x0=262,y=78,w=560,step=w/4,gap=24,inner=step-gap*2,exitLen=56;
  ctx.save();rect(x0-26,6,1010,132,'#071225f0');
  text(r.chapter.title+' / '+r.street.name+' · 第'+r.round+'轮',x0-10,40,22,r.street.color);
  /* 推图轨道与 5 个节点**画在同一条线**上（y=44），节点方块压在轨道上。
   *
   * 老实现把进度条单独画在 y=65：既不和节点同一条线，填充宽度 (w+16)*progress
   * 也完全不含当前节点序号 —— 站在第 2 个区、本区推进 0% 时条子照样从最左边
   * 一路铺开，看着像"快到章末了"；而节点之间那段连线只在 i<index 时变绿，
   * **正在推进的那一段永远是暗的**，所以"推图指示不会亮"。
   *
   * 现在的口径：走过的段绿、当前段按本区推进度填街道色、未到的段暗。
   * 本区推进度就是突破闸门的进度（12 栋建筑 / 8 个敌军，见 mapProgress()）。
   * 本章最后一个区（index 4）没有"下一段"，进度改填右侧那段「本章出口」。 */
  rect(x0,y-5,w,10,'#30445b');
  if(r.index===4)rect(x0+w,y-5,exitLen,10,'#30445b');
  for(let i=0;i<r.index&&i<4;i++)rect(x0+i*step+gap,y-5,inner,10,'#70e7b0');
  const fill=(r.index<4?inner:exitLen)*r.progress;
  if(fill>0)rect(x0+r.index*step+gap,y-5,fill,10,r.street.color);
  for(let i=0;i<5;i++){const x=x0+i*step,done=i<r.index,current=i===r.index;
    /* 闸门已开 = 可以进入下一城区，当前节点套一圈红框 —— 与按钮的红是同一个含义。 */
    if(current&&ready)rect(x-20,y-20,40,40,'#ff7780');
    rect(x-15,y-15,30,30,done?'#70e7b0':current?r.street.color:'#4b6075');
    text(String(r.nodes[i].district),x+22,y+6,16,current?'#fff3c4':'#94a9bd');}
  /* 右栏说清"下一个区落在哪一章"。老实现写的是 '下一城区 · '+章名（"下一城区 · 大阪"），
   * 大阪是城市不是城区，而"下一章 · 东京"这个真正要玩家等的信号反而没出现。
   * 红只留给**真的跨章**那一下 —— 同章内变红会把"可以切场景"这个信号稀释掉，
   * 开门（可推进）由当前节点的红圈和下面那行「已突破」负责。 */
  const cross=r.nextChapter.key!==r.chapter.key;
  text((cross?'下一章 · ':'本章 · ')+r.nextChapter.name,x0+w+56,42,18,(cross&&ready)?'#ff7780':'#b6cadc');
  text('下一城区 · '+r.nextStreet.name,x0+w+56,78,18,r.nextStreet.color);
  text(ready?'已突破 · 遥控器进入下一城区':'本区推进 '+Math.floor(r.progress*100)+'%',x0+w+56,114,18,ready?'#ff9aa2':'#b6cadc');ctx.restore();
}
/* 转台雪花。噪点是"第几帧 + 第几行"哈希出来的，不用 Math.random ——
 * 画面噪声不该消耗熵源，也不该随帧率抖成另一张图（这是外观表现，
 * 与项目里"外观只用 hashSeed+mulberry32"那条纪律同一个理由）。
 * 那道亮带压在世界替换的那一拍（t=rise）上，遮住"换的瞬间"本身。 */
function noiseGrain(a,b){const n=Math.sin(a*12.9898+b*78.233)*43758.5453;return n-Math.floor(n);}
function drawSceneSwitch(g){
  if(!sceneSwitch)return;
  const alpha=sceneSwitchAlpha(sceneSwitch.t);if(alpha<=0)return;
  const frame=Math.floor(sceneSwitch.t*30);
  g.setTransform(1,0,0,1,0,0);g.save();g.globalAlpha=alpha;
  g.fillStyle='#05070c';g.fillRect(0,0,W,H);
  for(let yy=0;yy<H;yy+=4){const n=noiseGrain(frame,yy),v=30+Math.floor(n*205);
    g.fillStyle='rgb('+v+','+Math.min(255,v+Math.floor(noiseGrain(frame,yy+1)*24))+','+Math.min(255,v+38)+')';
    g.fillRect(0,yy,W,4);}
  for(let i=0;i<6;i++){const ly=Math.floor(noiseGrain(frame*3+i,i*7)*H);
    g.fillStyle='#e6f3ff';g.fillRect(0,ly,W,2+Math.floor(noiseGrain(i,frame)*5));}
  const sweep=sceneSwitch.t-SCENE_SWITCH.rise;
  if(sweep>=-.12&&sweep<=.3){const ly=clamp((sweep+.12)/.42,0,1)*H;g.fillStyle='#ffffffdd';g.fillRect(0,ly-9,W,26);}
  g.fillStyle='#d8ecff';g.font='26px Pixel, monospace';g.textAlign='center';
  g.fillText('信号切换中 · GNN',W/2,H/2-6);
  g.globalAlpha=alpha*.7;g.font='16px Pixel, monospace';
  g.fillText('正在接收下一区域信号',W/2,H/2+24);
  g.restore();
}
function render(){ctx.setTransform(.5,0,0,.5,0,0);ctx.clearRect(0,0,W,H);drawSky();ctx.save();let center=p.x-camera,s=sceneZoom*zoom*.8;ctx.translate(center,H*.72);ctx.scale(s,s);ctx.translate(-center,-G);if(shake>0)ctx.translate(Math.sin(time*90)*shake,Math.cos(time*73)*shake*.45);drawSky();drawGround();drawBuildings(0);drawBuildings(1);drawWrecks();for(let e of enemies)if(alive(e))drawEnemy(e);drawGodzilla(SK,BS);drawBeam();for(let b of bullets){let t=b.trail.map(v=>[v[0]-camera,v[1]]);if(t.length>1)line(t,b.type==='electric'?'#84dfff':'#ffa155',3);rect(b.x-camera-5,b.y-3,10,6,b.type==='electric'?'#bfffff':'#fff0a2');}for(let e of enemies)if(!alive(e))drawEnemy(e);for(let f of fires)if(Math.abs(f.x-camera-W/2)<W){const fireScale=fxScale(f.jitter);fire(f.x-camera,f.y,f.size*3.2*fireScale*Math.min(1,(24-f.age)/8));}drawParticles();drawBuildings(2);drawForeground();drawWeather();ctx.restore();drawCampaignRoute();const shade=ctx.createLinearGradient(0,0,0,H);shade.addColorStop(0,'#01091b65');shade.addColorStop(.2,'#010a1900');shade.addColorStop(.75,'#010a1900');shade.addColorStop(1,'#02091b88');ctx.fillStyle=shade;ctx.fillRect(0,0,W,H);out.drawImage(buffer,0,0,W,H);
/* 换场雪花盖在最上面 —— 它必须压住推图条 / 暗角 / 频道画面，否则"遮满屏幕"
 * 这句话只在部分图层上成立。哪个画布在显示就画在哪个上（转台与直播两态都覆盖）。 */
if(channel!=='live')drawChannel();drawSceneSwitch(out);if(channel!=='live')drawSceneSwitch(channelCtx);}
const ACTIONS={walk:['持续跟踪','目标正在向城市深处移动'],claw:['现场：巨爪横扫','挥爪、击飞与建筑结构破坏'],beam:['高能预警：原子吐息','口部射线正在锁定前方目标'],stomp:['地震警报：巨兽重踏','地面冲击波席卷近处防线'],roar:['声压异常：震慑咆哮','空中编队失去稳定，炮弹被震散'],tail:['现场：尾部横扫','后方与前景建筑受到大范围撞击']};
const PROGRAMS={
  news:{label:'GNN 新闻台',short:'CH 02',title:'GNN 24H 新闻 · 东京特别报道',sub:'主播 林岚 / 现场记者持续连线',accent:'#ff5b6b'},
  variety:{label:'GNN 娱乐台',short:'CH 03',title:'巨兽娱乐现场 · 今晚最强综艺',sub:'主持人：小麦 / 城市挑战赛直播中',accent:'#ffcf5a'},
  drama:{label:'GNN 剧集台',short:'CH 04',title:'《霓虹防线》 · 第 12 集',sub:'本集：最后一栋楼的守望',accent:'#c58cff'},
  anime:{label:'GNN 动画台',short:'CH 05',title:'《小小怪兽队》 · 像素大冒险',sub:'下一站：彩虹废墟！',accent:'#6de5ff'},
  documentary:{label:'GNN 纪录台',short:'CH 06',title:'巨兽观察 · 城市生态志',sub:'解说：周墨 / 生物行为观察',accent:'#70e7b0'},
  weather:{label:'GNN 气象台',short:'CH 07',title:'城市气象 · 雷暴云团追踪',sub:'气象主播：苏晴 / 风暴路径实时更新',accent:'#8bd4ff'}
};
/* —— 电视转台：4 个不影响后台游戏的频道（测试图 / 气象雷达 / 雪花 / 档案）+ 直播。
 * 切台只盖住画面画布，update 始终在跑，所以游戏进度、核能、进化都不中断；
 * 切回直播即恢复游戏画面。 —— idle.cjs 默认停在直播频道，不会触发 drawChannel。 */
function channelName(ch){return ch==='live'?'直播':PROGRAMS[ch]?.label||ch;}
const CHANNEL_ORDER=['live','news','variety','drama','anime','documentary','weather'];
function setChannel(ch){channel=ch;channelNoise=.32;channelFlash=.12;channelCanvas.hidden=(ch==='live');$('stage').classList.toggle('channel-active',ch!=='live');let cyc=$('chan-cycle');if(cyc){cyc.classList.toggle('on',ch!=='live');let sp=cyc.querySelector('span');if(sp)sp.textContent=channelName(ch);}audioInit();noise(.16,.22,2400);tone(ch==='live'?180:92,.12,'square',.08, ch==='live'?320:55);if(ch==='live')notice('已返回 GNN 主直播');else notice('正在接收 '+channelName(ch)+' · '+PROGRAMS[ch].short);}
function cycleChannel(){let i=(CHANNEL_ORDER.indexOf(channel)+1)%CHANNEL_ORDER.length;setChannel(CHANNEL_ORDER[i]);}
function channelLabel(g,title,ch,accent='#9decef',sub=''){g.fillStyle='#071426';g.fillRect(0,0,1280,82);g.fillStyle=accent;g.fillRect(0,78,1280,4);g.fillStyle=accent;g.font='26px Pixel, monospace';g.textAlign='left';g.fillText(title,30,43);g.fillStyle='#fff';g.font='18px Pixel, monospace';g.fillText(sub,30,68);g.fillStyle=accent;g.fillRect(1168,18,84,40);g.fillStyle='#071426';g.font='22px Pixel, monospace';g.textAlign='center';g.fillText(ch,1210,45);g.textAlign='left';}
function presenter(g,x,y,name,color){g.fillStyle=color;g.fillRect(x,y,150,230);g.fillStyle='#f0c19b';g.fillRect(x+35,y+28,80,80);g.fillStyle='#1b243c';g.fillRect(x+23,y+112,105,118);g.fillStyle='#fff';g.font='18px Pixel, monospace';g.fillText(name,x+18,y+260);}
function drawProgram(ch,g){const q=PROGRAMS[ch];g.fillStyle='#101b35';g.fillRect(0,0,1280,720);g.fillStyle=q.accent;g.fillRect(0,82,1280,8);g.fillStyle='#e9f3ff';g.font='34px Pixel, monospace';g.fillText(q.title,42,135);g.fillStyle='#a6bdd2';g.font='20px Pixel, monospace';g.fillText(q.sub,44,170);presenter(g,80,245,ch==='news'?'林岚':ch==='variety'?'小麦':ch==='weather'?'苏晴':'主持人',q.accent);g.fillStyle='#152847';g.fillRect(320,225,850,300);g.strokeStyle=q.accent;g.lineWidth=4;g.strokeRect(320,225,850,300);g.fillStyle='#dcecff';g.font='28px Pixel, monospace';g.fillText(ch==='news'?'突发：巨兽已突破第 '+data.district+' 区防线':ch==='variety'?'城市挑战赛：谁能猜中下一栋倒塌的大楼？':ch==='drama'?'“如果城市注定要重建，我们就守到最后一秒。”':ch==='anime'?'小怪兽：出发！把坏蛋赶出彩虹废墟！':ch==='documentary'?'镜头记录：巨兽步态与城市生态正在共同变化。':'雷暴带向 '+cityTitle()+' 靠近，预计持续 '+(12+data.district)+' 分钟。',355,310);g.fillStyle='#87a9c5';g.font='20px Pixel, monospace';g.fillText('现场连线 / 节目正在播出 / GNN LIVE',355,372);g.fillStyle='#071426';g.fillRect(320,555,850,65);g.fillStyle=q.accent;g.font='23px Pixel, monospace';g.fillText('◆ '+q.label+'　◆　正在播报　◆　节目内容实时更新',345,595);channelLabel(g,q.title,q.short,q.accent,q.sub);}
function drawChannel(){const g=channelCtx;g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,1280,720);if(channel==='live')return;if(PROGRAMS[channel])drawProgram(channel,g);if(channelNoise>0){g.fillStyle='rgba(220,240,255,'+channelNoise+')';g.fillRect(0,0,1280,720);channelNoise=Math.max(0,channelNoise-.018);}if(channelFlash>0){g.fillStyle='#dffaff';g.fillRect(0,0,1280,720);channelFlash=Math.max(0,channelFlash-.06);}g.setTransform(1,0,0,1,0,0);}
function buildUI(){let icons={power:'✦',atomic:'◈',metabolism:'▥',stride:'↗'};$('statsPanel').innerHTML=Object.entries(P.STATS).map(([k,s])=>`<article class="upgrade-card"><div class="card-top"><span class="upgrade-icon">${icons[k]}</span><span class="level" id="lv-${k}">LV 01</span></div><h3>${s.name}</h3><p>${s.desc}</p><div class="effect" id="effect-${k}"></div><button id="up-${k}" aria-label="强化${s.name}"><span>强化 +1</span><b id="cost-${k}"></b></button></article>`).join('');for(let k in P.STATS)$('up-'+k).onclick=()=>{if(economy.upgrade(k)){notice(P.STATS[k].name+' 已强化');save();hud();}};
let branches={kinetic:['动能破坏','KINETIC'],atomic:['原子突变','ATOMIC'],evolution:['适应进化','EVOLUTION']};
$('skillsPanel').innerHTML=Object.entries(branches).map(([branch,names])=>`<section class="skill-branch"><h3>${names[0]} / ${names[1]}</h3><div class="skill-chain">${P.SKILLS.filter(s=>s.branch===branch).map((s,i)=>`<article class="skill-node" id="node-${s.id}" data-requires="${s.requires||''}"><span class="skill-order">0${i+1}</span><div class="skill-copy"><h4>${s.name}</h4><p>${s.desc}</p><p class="skill-prerequisite">${s.requires?'前置：'+P.SKILLS.find(n=>n.id===s.requires).name:'起始节点 · 无前置'} · ${s.cost} 突变点</p></div><button id="skill-${s.id}" aria-label="解锁${s.name}">${s.cost} 点</button></article>`).join('')}</div></section>`).join('');
for(let s of P.SKILLS)$('skill-'+s.id).onclick=()=>{if(economy.unlock(s.id)){notice('已解锁：'+s.name);save();hud();}};
$('resetSave').onclick=()=>{if(typeof window.__panelHost?.resetSave==='function')window.__panelHost?.resetSave();else $('resetSaveHint').textContent='请在桌宠中使用重置存档功能，并先导出或备份存档。';};
$('nextMap').onclick=()=>{if(panelMode){sendPanelCommand({id:'nextMap'});return;}const action=requestNextMap();if(action==='challenge'){notice('摧毁指令已确认：Boss 即将降临');hud();}else notice('尚未抵达可摧毁区域');};
for(let key of ['assign','talent','evo','stats','skills','news','settings']){let t=$(key+'Tab');if(t)t.onclick=()=>openPanel(key);let o=$('open-'+key);if(o)o.onclick=()=>openPanel(key,$('open-'+key));}$('closePanel').onclick=closePanel;
let cycBtn=$('chan-cycle');if(cycBtn)cycBtn.onclick=()=>cycleChannel();
document.addEventListener('keydown',e=>{if($('management').hidden)return;if(e.key==='Escape'){e.preventDefault();closePanel();}if(e.key==='Tab'){let items=[...$('management').querySelectorAll('button:not(:disabled),select,input')].filter(n=>n.getClientRects().length);let first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
$('auto').checked=data.auto;$('auto').onchange=()=>{data.auto=$('auto').checked;notice(data.auto?'自动进化已开启':'自动进化已关闭，可自行分配核能与突变点');save();};$('policy').value=data.policy;$('policy').onchange=()=>{data.policy=$('policy').value;save();notice('进化偏好已更新');};$('sound').textContent=muted?'开启现场声音':'现场声音：开';$('sound').onclick=()=>{audioInit();muted=!muted;data.muted=muted;$('sound').textContent=muted?'开启现场声音':'现场声音：开';save();};$('dismissOffline').onclick=()=>{$('offline').hidden=true;};bindGrowthUI();}

/* —— 成长面板：加点 / 天赋 / 进化 ——
 * 对应 doc/game-design/06、07。所有可点元素都有合法 id（^[A-Za-z][\w-]*$），
 * 且不用 open- 前缀 —— 面板的转发只认 id，这两条任何一条不满足，点了就没反应。 */
function bindGrowthUI(){
  buildAssignCards();buildTalentRings();
  $('assignSpread').onclick=()=>{let n=economy.assignSpread();if(n){notice('已均分 '+n+' 次加点');growthFeedback('全部分配 +'+n,'#9decef');save();hud();renderGrowthPanels();}else notice('没有可用的加点机会');};
  $('assignAll').onclick=()=>{let k=economy.chooseUpgrade();let used=0;while(economy.assignPoint(k))used++;if(used){notice('已全投「'+P.STATS[k].name+'」');growthFeedback(P.STATS[k].name+' 强化','#ffd76b');save();hud();renderGrowthPanels();}else notice('没有可用的加点机会');};
  for(let k in P.STATS){$('assign-'+k).onclick=()=>{if(economy.assignPoint(k)){notice(P.STATS[k].name+' 已加点');growthFeedback(P.STATS[k].name+' +1','#ffd76b');save();hud();renderGrowthPanels();}else notice('没有可用加点机会或已满级');};}
  for(let n of P.TALENT_NODES){$('talent-'+n.id).onclick=()=>{if(economy.talentUpgrade(n.id)){notice(n.name+' 已升级');growthFeedback('天赋 '+n.name,'#7ddc8a');save();hud();renderGrowthPanels();}else notice('天赋点不足或环未开启');};}
  $('talentReset').onclick=()=>{if(economy.talentReset()){notice('天赋已重置');growthFeedback('天赋重置','#9decef');save();hud();renderGrowthPanels();}else notice('核能不足，无法重置');};
  $('rollEvo').onclick=()=>rollEvoTap();
  $('evoSpeed').onclick=()=>{evoFast=!evoFast;$('evoSpeed').textContent=evoFast?'动画：快速':'动画：完整';};
}
let evoFast=false;

/* 四条横向属性行；每格对应一级，满十格再进入下一段。 */
function buildAssignCards(){
  $('assignCards').innerHTML=Object.entries(P.STATS).map(([k,s])=>`<article class="assign-stat"><div class="stat-heading"><h3>${s.name}</h3><span class="level" id="alv-${k}">LV 01</span><strong id="aeffect-${k}"></strong></div><p>${s.desc}</p><div class="stat-segment"><span id="arange-${k}"></span><div id="asegments-${k}" class="segment-cells" role="img">${Array.from({length:10},()=>'<i></i>').join('')}</div></div><div class="assign-btns"><button id="assign-${k}" class="pixel-button assign" aria-label="加点${s.name}">加点 +1</button><button id="buy-${k}" class="pixel-button buy" aria-label="购买${s.name}">核能购买</button></div></article>`).join('');
  for(let k in P.STATS){$('assign-'+k).onclick=()=>{if(economy.assignPoint(k)){notice(P.STATS[k].name+' 已加点');save();hud();renderGrowthPanels();}else notice('没有可用加点机会或已满级');};$('buy-'+k).onclick=()=>{if(economy.upgrade(k)){notice(P.STATS[k].name+' 已强化');save();hud();renderGrowthPanels();}else notice('核能不足或已满级');};}
}

/* 面板使用独立骨骼实例和低频时钟；不触碰直播姿态、战斗时钟或存档。 */
function syncAssignHologram(){
  if(!panelMode)return;
  const c=$('assignHologram');
  const state=syncAssignHologram.state||(syncAssignHologram.state={timer:null,key:'',rig:null,revision:0,lastDraw:''});
  if(document.hidden||$('management').hidden||$('assignPanel').hidden){clearTimeout(state.timer);state.timer=null;return;}
  if(state.timer!==null)return;
  const tick=()=>{
    state.timer=null;
    if(document.hidden||$('management').hidden||$('assignPanel').hidden)return;
    const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
    const key=economy.epochIndex()+':'+(data.morph.hue||'');
    if(key!==state.key||!state.rig){
      state.key=key;state.rig=new KaijuRig.Skeleton(Appearance.toParts(KaijuRig.RIG,Appearance.skinFor('godzilla',economy.epochIndex(),data.morph),'godzilla'));
      const rig=state.rig;rig.loaded.then(()=>{if(state.rig===rig){state.revision++;syncAssignHologram();}});
    }
    const signature=JSON.stringify([data.level,data.levels,data.talents,data.morph,data.district,data.skills,state.revision]);
    if(!reduced||signature!==state.lastDraw){drawAssignHologram(c,state.rig,reduced?0:performance.now()/1000);state.lastDraw=signature;}
    state.timer=setTimeout(tick,reduced?1000:125);
  };
  tick();
}
function drawAssignHologram(c,rig,t){
  const g=c.getContext('2d'),w=c.width,h=c.height;
  g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,w,h);g.imageSmoothingEnabled=false;
  g.fillStyle='#071c27';g.fillRect(0,0,w,h);
  g.strokeStyle='#19424a';g.lineWidth=1;
  for(let x=0;x<w;x+=24){g.beginPath();g.moveTo(x,0);g.lineTo(x,h);g.stroke();}
  for(let y=0;y<h;y+=24){g.beginPath();g.moveTo(0,y);g.lineTo(w,y);g.stroke();}
  const bs=Growth.bodyScale(data.level,data.talents,data.morph,P.EPOCHS),bounds=KaijuRig.BIND_BOUNDS;
  /* 归一化基准用"成长曲线终点"（curveTop），不用 Growth.CEIL —— 后者含天赋
   * 与突变那部分，拿它当分母会让裸档满级只占满框的 71%，看着像变小了。
   * 只有当叠满突变、体型超过曲线终点时才跟着放大基准，避免画出框外。 */
  const norm=Math.max(Growth.curveTop(P.EPOCHS),bs);
  const fit=Math.min(280/((bounds.x1-bounds.x0)*norm),192/((bounds.y1-bounds.y0)*norm));
  const ax=w/2-(bounds.x0+bounds.x1)*bs*fit/2,ay=242;
  const pose=KaijuRig.pose({x:0,ground:0,moving:false,step:0,action:{name:t?'walk':'neutral',t:0}},t);
  const sk=scaleRig(pose,bs,0,0);
  const decor=Appearance.decor({form:Appearance.FORMS[economy.epochIndex()],epoch:economy.epoch(),level:data.level,morph:data.morph,talents:data.talents,elementColor:elementColor(),beamColor:beamColor()});
  g.strokeStyle='#6ccaca';g.beginPath();g.ellipse(w/2,ay+5,145,12,0,0,Math.PI*2);g.stroke();
  if(rig.ready){
    g.save();g.translate(ax,ay);g.scale(fit,fit);g.globalAlpha=.92;
    g.filter='brightness(1.5) saturate(.7)';rig.draw(g,sk,0,bs);fins.draw(g,sk,0,bs,decor.spikes);g.filter='none';
    drawHologramDecor(g,sk,bs,decor,t);g.restore();
  }
  // 只覆盖低透明度扫描线，不改变真实部件轮廓，也不做整屏闪烁。
  g.fillStyle='#80ffff0c';for(let y=0;y<h;y+=4)g.fillRect(0,y,w,1);
  if(t){g.fillStyle='#7fffea12';g.fillRect(0,(t*16)%h,w,2);g.fillStyle='#7fffea09';for(let i=0;i<4;i++)g.fillRect((i*113+Math.floor(t*3)*17)%w,(i*67+Math.floor(t)*11)%h,12,1);}
  const labels=[
    {q:sk.claw,x:12,y:55,name:'前爪 / 力量',value:Math.round(economy.power())+' 伤害',side:1},
    {q:sk.bones.torso,x:12,y:160,name:'躯干 / 代谢',value:'+'+economy.passive().toFixed(1)+'/秒',side:1},
    {q:sk.muzzle,x:w-12,y:55,name:'口部 / 炉心',value:Math.round(economy.atomic())+' 伤害',side:-1},
    {q:sk.foot,x:w-12,y:190,name:'后肢 / 动能',value:'速度 '+Math.round(economy.speed()),side:-1}
  ];
  g.font='13px Pixel, monospace';
  labels.forEach(a=>{
    const x=ax+a.q.x*fit,y=ay+a.q.y*fit,edge=a.x+a.side*96;
    g.strokeStyle='#68acb6';g.beginPath();g.moveTo(x,y);g.lineTo(edge,a.y+25);g.lineTo(a.x,a.y+25);g.stroke();
    g.fillStyle='#a7f1ee';g.fillRect(x-2,y-2,4,4);
    g.fillStyle='#071c27ee';g.fillRect(a.side===1?a.x-3:a.x-103,a.y-14,106,37);
    g.textAlign=a.side===1?'left':'right';g.fillStyle='#bbdce4';g.fillText(a.name,a.x,a.y);g.fillStyle='#9affdd';g.fillText(a.value,a.x,a.y+17);
  });
  g.textAlign='center';g.fillStyle='#b9dfdc';g.font='12px Pixel, monospace';
  if(!rig.ready)g.fillText(rig.failures.length?'部件加载失败 · 请检查资源':'正在装配真实骨骼…',w/2,115);
  c.dataset.level=String(data.level);c.dataset.bodyScale=bs.toFixed(3);c.dataset.spines=String(decor.spikes.count);c.dataset.rigReady=String(rig.ready);
}
function drawHologramDecor(g,sk,s,D,t){
  const b=sk.bones;
  if(D.horns.count){for(let k=0;k<D.horns.blades;k++){let ox=(k?18:-14)*s;g.fillStyle='#dfe6ee';g.beginPath();g.moveTo(b.head.x+ox-4*s,b.head.y-30*s);g.lineTo(b.head.x+ox,b.head.y-D.horns.heightPx*s);g.lineTo(b.head.x+ox+4*s,b.head.y-30*s);g.fill();}}
  if(D.eye.glow){g.fillStyle='#ff5a4a';g.beginPath();g.ellipse(b.head.x-22*s,b.head.y-6*s,9*s,6*s,0,0,7);g.fill();}
  if(D.eye.third){g.fillStyle='#ffe06a';g.beginPath();g.arc(b.head.x,b.head.y-26*s,5*s,0,7);g.fill();}
  if(D.plates.on){g.strokeStyle='#0c1726';g.lineWidth=Math.max(1,3*s);for(let r=-1;r<=1;r++)for(let q=-1;q<=1;q++)g.strokeRect(b.torso.x+r*34*s-12*s,b.torso.y+q*30*s-14*s,24*s,28*s);}
  if(D.aura.on){g.save();g.globalAlpha=.35;g.fillStyle=D.aura.color;for(let i=0;i<6;i++){let angle=t*.6+i/6*6.28,rr=(70+Math.sin(t*2+i)*8)*s;g.beginPath();g.arc(b.torso.x+Math.cos(angle)*rr,b.torso.y+Math.sin(angle)*rr,4*s,0,7);g.fill();}g.restore();}
  if(D.tail.twin){g.save();g.translate(b.tail_tip.x,b.tail_tip.y);g.scale(-1,1);g.fillStyle=D.spikes.color;g.beginPath();g.moveTo(-10*s,0);g.lineTo(20*s,-14*s);g.lineTo(34*s,0);g.fill();g.restore();}
}

/* 生成天赋面板的三环 18 节点 */
function talentPixelIcon(id){
  const shapes={
    mass:'0011100/0111110/1111111/1111111/0111110/0110110/1100011',
    spines:'0001000/0101010/0111110/1111111/0111110/0011100/0001000',
    talons:'1001001/1001001/1101101/0100101/0111111/0011110/0001100',
    tailwhip:'1100000/0110000/0011000/0001100/0000111/0000011/0000110',
    carapace:'0111110/1101011/1011101/1101011/0111110/0011100/0001000',
    jaws:'1111111/1010101/1000001/0000000/1000001/1010101/0111110',
    pyro:'0001000/0011000/0011010/0111110/1111111/1101011/0111110',
    volt:'0001110/0011100/0111000/1111110/0001100/0011000/0110000',
    cryo:'1001001/0101010/0011100/1111111/0011100/0101010/1001001',
    venom:'0111110/1101011/1111111/0111110/0011100/0010100/0110110',
    radiant:'1001001/0001000/0011100/1111111/0011100/0001000/1001001',
    magma:'0001000/0011100/0010100/0110110/0111010/1110111/1111111',
    hunter:'0001000/0011100/0110110/1101011/0110110/0011100/0001000',
    stormcraft:'0000000/0111100/1111110/1111111/0000000/0101010/1010100',
    conductor:'0011100/0001000/0111110/0101010/1101011/0001000/0011100',
    rubblewalker:'0100010/1110111/0100010/0000000/0011000/0111100/1111111',
    nocturnal:'0011110/0110000/1100000/1100010/1100011/0110110/0011100',
    sleepless:'0000000/0111110/1101011/1011101/1101011/0111110/0000000'
  };
  return `<svg class="talent-icon" viewBox="0 0 9 9" aria-hidden="true" shape-rendering="crispEdges">${shapes[id].split('/').map((row,y)=>[...row].map((v,x)=>v==='1'?`<rect x="${x+1}" y="${y+1}" width="1" height="1"/>`:'').join('')).join('')}</svg>`;
}
function buildTalentRings(){
  $('talentRings').innerHTML='<p class="tree-legend">整环解锁 → 环内任选；连线表示环级分支，不是单节点前置。悬停或聚焦可查看锁定天赋。</p>'+P.TALENT_RINGS.map((ring,ri)=>`<section class="talent-ring" data-ring="${ring.key}"><div class="ring-head"><span class="ring-name">环 ${ri+1} · ${ring.name}</span><span class="ring-state"></span><p class="ring-desc">${ring.desc}</p></div><div class="tree-map"><svg class="tree-links" viewBox="0 0 600 248" preserveAspectRatio="none" aria-hidden="true"><path d="M300 0V12H6V136H500V148M6 12H500V24M100 12V24M300 12V24M100 136V148M300 136V148"/></svg><div class="ring-grid">${ring.nodes.map(n=>`<div class="talent-leaf"><button id="talent-${n.id}" class="talent-node" style="--node-color:${n.color||'#9decef'}" aria-label="天赋${n.name}" aria-describedby="tdesc-${n.id}">${talentPixelIcon(n.id)}<span class="tname">${n.name}</span><span class="tlv">0/3</span><span class="tbar" aria-hidden="true">▯▯▯</span></button><div id="tdesc-${n.id}" class="talent-tooltip" role="tooltip"><strong>${n.name}</strong> · ${n.desc}<span>${ri?'前置：上一环「'+P.TALENT_RINGS[ri-1].name+'」总投入 '+P.RING_GATE[ri]+' 点；无需指定节点。':'第一环开放，无节点前置。'} 每级消耗 1 天赋点，最多 3 级。</span><b class="talent-status"></b></div></div>`).join('')}</div></div><p class="ring-help">查看任一天赋以读取效果和解锁条件。<br>本环投入 <b class="ring-invest">0</b> 点</p></section>`).join('');
}

/* 在电视窗口里掷骰（权威执行）。结果返回后，主进程会把它回推给面板播动画。
 * 这里把结果挂到 el.__panelResult 上，panel:tap 的返回值会把它带出去。 */
function rollEvoTap(){
  let el=$('rollEvo');
  let r=economy.rollEvolution(weatherNow());
  if(!r){notice('升级获得进化机会');if(el)el.__panelResult=null;return;}
  save();hud();renderGrowthPanels();
  processMutationEvent(r);
  if(el)el.__panelResult=r;
}

function weatherNow(){return null;} /* 天气系统尚未落地，恒为无天气 */

/* 突变的事件表现：在电视窗口里播横幅（稀有度色），稀有以上加慢动作 */
function processMutationEvent(r){
  let col=r.color||'#c8ccd4';
  banner('体征变化 · '+r.rarityName+' · '+r.name, (r.part?'部位 '+r.part+' · ':'')+r.desc);
  broadcast('突变「'+r.name+'」已定型', r.desc, true);
  if(r.rarity==='rare'||r.rarity==='epic'||r.rarity==='legend'){flash=.12;hitFlash=Math.max(hitFlash,.12);}
  /* 原来这里还让画面 HUD 里那格「随机变异」闪一下；那格已随常驻 HUD 移除，
   * 体征变化的可见反馈就剩上面那条横幅 + 下面的闪屏。 */
  sound('pickup');
}

/* 加点 / 核能购买 / 掷骰进化这三组按钮"能不能点"，只由当前数值决定，
 * 与"观测面板是否可见"无关 —— 所以把门单独抽出来，挂在 hud() 的 200ms 心跳上。
 *
 * ⚠️ 治的是一个**只发生在电视窗口**的静默故障（2026-09-18 主人报的
 * "加点按钮和变异按钮按下去没反应"）：
 *   · renderGrowthPanels() 在电视窗口里一次都不会跑 —— tv-preload 的
 *     guardMainPanel() 用 MutationObserver 把 #management 永久按住 hidden，
 *     hud() 里那句重绘的守卫 `if(!$('management').hidden)` 于是恒为假，
 *     剩下的触发点只有"某个命令成功执行之后"那一次；
 *   · 于是这三个按钮带着**上一次成功操作那一刻**的 disabled 活着：
 *     用光点数被置灰 → 之后升级再把点数发回来 → 按钮仍然是灰的；
 *   · 而 panelCommand() 第一句就是 `if(!el||el.disabled)return null;`，
 *     面板点过来的命令被静默丢掉，两端都不报错，看起来就是"按下去没反应"。
 * 实测（.workbuddy/probe-growth-gate.cjs）：升级把点数发回来后，
 * 面板侧已亮、电视侧仍是灰的，命令返回 null 且数据不变。
 *
 * 门与 renderAssignPanel() 共用同一个 statGate()，不许出现第二份判据。 */
function statGate(k){
  const cap=500;
  return {assign:data.assign<=0||data.levels[k]>=cap,buy:data.energy<economy.cost(k)||data.levels[k]>=cap};
}
function syncGrowthGates(){
  for(const k in P.STATS){
    const gate=statGate(k),a=$('assign-'+k),b=$('buy-'+k);
    if(a)a.disabled=gate.assign;
    if(b)b.disabled=gate.buy;
  }
  const roll=$('rollEvo');if(roll)roll.disabled=(data.evoRolls<=0);
}

/* 渲染三个成长面板。每次点数变化后都要重画，因为它们都显示实时数字。 */
function renderGrowthPanels(){
  renderAssignPanel();renderTalentPanel();renderEvoPanel();
}

function renderAssignPanel(){
  let d=data;
  $('assignCount').textContent=d.assign;
  for(let k in P.STATS){
    let s=P.STATS[k];
    let lv=d.levels[k];
    let aBtn=$('assign-'+k),bBtn=$('buy-'+k),gate=statGate(k);
    if(bBtn){bBtn.textContent=fmt(economy.cost(k))+' 核能';bBtn.disabled=gate.buy;}
    if(aBtn){aBtn.disabled=gate.assign;aBtn.textContent='加点 +1';}
    let lvEl=$('lv-'+k);if(lvEl)lvEl.textContent='LV '+String(lv).padStart(2,'0');
    let alv=$('alv-'+k);if(alv)alv.textContent='LV '+String(lv).padStart(2,'0');
    let ef=$('effect-'+k),aef=$('aeffect-'+k),eff;
    if(k==='power')eff=Math.round(economy.power())+' 伤害';else if(k==='atomic')eff=Math.round(economy.atomic())+' 伤害';else if(k==='metabolism')eff='+'+economy.passive().toFixed(1)+'/秒';else eff='速度 '+Math.round(economy.speed());
    if(ef)ef.textContent=eff;if(aef)aef.textContent=eff;
    const start=Math.floor(Math.max(0,lv-1)/10)*10,filled=lv-start,cells=$('asegments-'+k);
    $('arange-'+k).textContent='区间 '+(start+1)+'–'+(start+10)+' · '+filled+'/10';
    cells.setAttribute('aria-label',s.name+' LV '+lv+'，当前区间 '+(start+1)+' 至 '+(start+10)+'，已亮 '+filled+' 格');
    [...cells.children].forEach((cell,i)=>cell.classList.toggle('lit',i<filled));
  }
  if(panelMode){
    const decor=Appearance.decor({form:Appearance.FORMS[economy.epochIndex()],epoch:economy.epoch(),level:d.level,morph:d.morph,talents:d.talents,elementColor:elementColor(),beamColor:beamColor()});
    $('holoStage').textContent=economy.epoch().name+' · LV '+d.level;
    $('holoReadout').textContent='体型 ×'+Growth.bodyScale(d.level,d.talents,d.morph,P.EPOCHS).toFixed(3)+' · 背鳍 '+decor.spikes.count+' 根 · 头角 '+decor.horns.count+' · 额外爪 '+decor.claw.count;
    syncAssignHologram();
  }
  if($('talentCount'))$('talentCount').textContent=d.talent;
  $('assignBadge').textContent=d.assign;$('assignBadge').hidden=(d.assign<=0);
  $('evoBadge').textContent=d.evoRolls;$('evoBadge').hidden=(d.evoRolls<=0);
}

function renderTalentPanel(){
  let d=data;
  $('talentCount2').textContent=d.talent;
  $('talentInvest').textContent=Object.values(d.talents).reduce((a,b)=>a+b,0);
  let main=economy.mainElement();
  $('talentMain').textContent=main?(P.TALENT_BY_ID[main].name+'（主元素）'):'尚未定型';
  let resetC=$('talentReset');if(resetC){let c=economy.talentResetCost();resetC.textContent=c===0?'重置（首次免费）':'重置（'+c+' 核能）';resetC.disabled=(d.energy<c);}
  for(let n of P.TALENT_NODES){
    let el=$('talent-'+n.id);if(!el)continue;
    let lv=d.talents[n.id]||0;
    let unlocked=economy.ringUnlocked(n.ring);
    el.classList.toggle('locked',!unlocked);
    el.classList.toggle('maxed',lv>=3);
    el.classList.toggle('is-main',main===n.id);
    const unavailable=!unlocked||lv>=3||d.talent<=0;
    el.disabled=false;
    el.setAttribute('aria-disabled',String(unavailable));
    el.setAttribute('aria-label','天赋'+n.name+'，'+lv+'/3 级');
    $('tdesc-'+n.id).querySelector('.talent-status').textContent=!unlocked?'当前：环未开启':lv>=3?'当前：已满级':d.talent<=0?'当前：天赋点不足':'当前：可投入 1 点';
    let bar=el.querySelector('.tbar');
    if(bar)bar.textContent='▮'.repeat(lv)+'▯'.repeat(3-lv);
    let lvEl=el.querySelector('.tlv');if(lvEl)lvEl.textContent=lv+'/3';
  }
  P.TALENT_RINGS.forEach((ring,ri)=>{
    const section=$('talentRings').querySelector('[data-ring="'+ring.key+'"]'),unlocked=economy.ringUnlocked(ring.key);
    section.classList.toggle('ring-locked',!unlocked);
    section.querySelector('.ring-invest').textContent=economy.ringInvested(ring.key);
    section.querySelector('.ring-state').textContent=ri?(unlocked?'已开启':'锁定')+' · 上一环 '+economy.ringInvested(P.TALENT_RINGS[ri-1].key)+' / '+P.RING_GATE[ri]+' 点':'起始环 · 自由投入';
  });
}

function renderEvoPanel(){
  let d=data;
  $('evoCount').textContent=d.evoRolls;
  $('rollEvo').disabled=(d.evoRolls<=0);
  $('rollEvo').textContent=d.evoRolls>0?'掷骰进化':'升级获得进化机会';
  $('evoHistory').innerHTML=economy.recentMutations(20).map(m=>`<div class="evo-row" style="--rc:${m.color}"><span class="evo-dot"></span><span class="evo-name">${m.name}</span><span class="evo-rarity">${m.rarityName}</span><span class="evo-desc">${m.desc}</span></div>`).join('')||'<p class="evo-empty">还没有进化记录</p>';
}

/* 骰子点阵：面 pips 用 1-6 的经典布局，画在 16×16 网格上，SVG rect 逐格填。
 * 点数就是稀有度、颜色就是稀有度色 —— 落定那一刻不用读文字就知道中了什么。 */
const DICE_PIPS={1:[[7,7]],2:[[4,4],[10,10]],3:[[4,4],[7,7],[10,10]],4:[[4,4],[4,10],[10,4],[10,10]],5:[[4,4],[4,10],[10,4],[10,10],[7,7]],6:[[4,4],[4,7],[4,10],[10,4],[10,7],[10,10]]};
function drawDiceFace(face,color){
  let svg=$('diceFace');if(!svg)return;
  let pips=DICE_PIPS[face]||DICE_PIPS[6];
  svg.innerHTML=pips.map(([x,y])=>`<rect x="${x}" y="${y}" width="2" height="2" fill="${color}"/>`).join('');
  let dice=$('dice');if(dice)dice.style.setProperty('--dfc',color);
}

/* 掷骰动画。结果 r 是电视窗口算好、经主进程回推来的，骰子只是落在已知的面上。 */
function playDiceRoll(r){
  let face=r.face||1,color=r.color||'#c8ccd4';
  let fast=evoFast||(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  let dice=$('dice'),res=$('evoResult');if(!dice)return;
  res.hidden=true;
  if(fast){drawDiceFace(face,color);showEvoResult(r);return;}
  let t=0,shuffle=[1,2,3,4,5,6,5,4,3,2];
  dice.classList.add('rolling');
  let int=setInterval(()=>{
    t++;
    drawDiceFace(shuffle[t%shuffle.length],'#c8ccd4');
    if(t>=10){clearInterval(int);dice.classList.remove('rolling');drawDiceFace(face,color);dice.classList.add('landed');showEvoResult(r);}
  },60);
}
function showEvoResult(r){
  let res=$('evoResult');if(!res)return;
  res.hidden=false;
  res.style.setProperty('--rc',r.color);
  res.innerHTML=`<span class="evo-rarity">${r.rarityName}</span><span class="evo-name">${r.name}</span><span class="evo-desc">${r.desc}</span>`;
  if(r.rarity==='legend'){document.body.classList.add('whiteflash');setTimeout(()=>document.body.classList.remove('whiteflash'),200);}
  if(r.rarity==='epic'||r.rarity==='legend')sound('pickup');
}
function hud(){const challenge=bossChallengeAvailable(),nextButton=$('nextMap');nextButton.disabled=!challenge;nextButton.classList.toggle('ready',challenge);nextButton.textContent=challenge?'摧毁这块区域':'进入下一张地图';tickerWidth=$('tickerText').offsetWidth||1200;headlineWidth=$('headline').offsetWidth||600;headlineViewport=$('headline').parentElement?.clientWidth||500; $('energy').textContent=fmt(data.energy);$('production').textContent='+'+economy.passive().toFixed(1)+' / 秒 · 另有破坏收益';$('level').textContent=String(data.level).padStart(2,'0');$('dna').textContent=fmt(data.dna);$('destroyed').textContent=fmt(data.cleared);$('distance').textContent='已推进 '+fmt(data.meters)+' m · 击破 '+fmt(data.kills);$('evoProgress').textContent=Math.floor(data.xp)+' / '+economy.nextXP()+' G-XP';$('xpFill').style.width=clamp(data.xp/economy.nextXP()*100,0,100)+'%';let effects={power:'破坏力 '+Math.round(economy.power()),atomic:'吐息 '+Math.round(economy.atomic())+' / 秒',metabolism:'收益倍率 ×'+economy.rewardMult().toFixed(2),stride:'基础步速 '+Math.round(economy.speed())+' / 秒'};for(let k in P.STATS){$('lv-'+k).textContent='LV '+String(data.levels[k]).padStart(2,'0');$('effect-'+k).textContent=effects[k];$('cost-'+k).textContent=fmt(economy.cost(k))+' 核能';$('up-'+k).disabled=data.energy<economy.cost(k)||data.levels[k]>=500;}syncGrowthGates();for(let s of P.SKILLS){let learned=economy.has(s.id),blocked=s.requires&&!economy.has(s.requires);$('node-'+s.id).classList.toggle('learned',learned);$('skill-'+s.id).textContent=learned?'已觉醒':blocked?'前置未解锁':s.cost+' 点';$('skill-'+s.id).disabled=learned||!!blocked||data.dna<s.cost;}
/* 这里原来还有一段写给画面常驻 HUD 的赋值（核能 / 等级 / 经验条 / 天赋点 /
 * 随机变异名）。那排 2026-09-17 按反馈从电视画面上移除了，元素不存在，
 * 继续写会直接抛在 $() 上 —— 所以整段删掉，不是加 if 守卫绕过去。
 * 这些数字仍然照常更新：它们在遥控器打开的观测面板里（上面的 $('energy')
 * / $('level') / $('xpFill') 那几条写的就是面板里的同一批数值）。 */
let label=ACTIONS[p.action.name];$('actionLabel').textContent=p.action.super?'红莲临界：超高热射线':label[0];$('actionSub').textContent=label[1];let strongest=enemies.filter(e=>alive(e)&&Math.abs(e.x-p.x)<1100).sort((a,b)=>TYPES[b.type].resistance-TYPES[a.type].resistance)[0];$('armyIntel').textContent='敌情：'+(strongest?TYPES[strongest.type].label:'防线崩溃')+' · 推进压制 '+Math.round(pressure()/(1+pressure())*100)+'%';$('clock').textContent=new Date().toLocaleTimeString('zh-CN',{hour12:false});$('tickerTime').textContent='LIVE '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});Object.assign(canvas.dataset,{mode:'idle',district:String(data.district),action:p.action.name,destroyed:String(data.cleared),kills:String(data.kills),level:String(data.level),energy:String(Math.floor(data.energy)),x:String(Math.round(p.x)),crashes:String(crashCount),boneCount:String(Object.keys(KaijuRig.PARTS).length+1),rigReady:String(skeleton.ready)});let hb=$('assignHudBadge');if(hb){hb.textContent=String(data.assign);hb.hidden=(data.assign<=0);}if(!$('management').hidden)renderGrowthPanels();}
function processEconomyEvents(){for(let e of economy.events){if(e.type==='evolution'){banner('巨兽进化 · LV '+e.level,'G-CELL MUTATION / 突变点 +1');broadcast('观察站：巨兽完成第 '+e.level+' 级进化，力量持续增强','进化获得 1 突变点，可用于分支技能树',true);sound('pickup');}else if(e.type==='skill'){let s=P.SKILLS.find(s=>s.id===e.id);broadcast('新的生物特征被确认：「'+s.name+'」已经觉醒',s.desc,true);}else if(e.type==='mutation'){let m=P.MUTATION_BY_ID[e.id];if(m){let col=(P.RARITY_BY_KEY[m.rarity]||{}).color||'#c8ccd4';banner('体征变化 · '+(P.RARITY_BY_KEY[m.rarity]||{}).name+' · '+m.name,(m.part?'部位 '+m.part+' · ':'')+m.desc);if(e.rarity==='rare'||e.rarity==='epic'||e.rarity==='legend'){flash=.12;hitFlash=Math.max(hitFlash,.12);}sound('pickup');}}else if(e.type==='talent'){let n=P.TALENT_BY_ID[e.id];if(n)banner('天赋 · '+n.name+' '+e.level+' 级','');}}economy.events=[];}
function catchUp(now){let report=economy.offline(now);if(report){$('offlineText').textContent='离线 '+Math.floor(report.seconds/60)+' 分钟，已入账 '+fmt(report.amount)+' 核能 · '+fmt(report.xp)+' 经验'+(report.capped?'（8 小时上限）':'')+'。';$('offline').hidden=false;broadcast('离线观测数据已归档，核能与经验自动入账','离线按被动产能折算，城市位置与破坏进度保留');save();}}
function update(dt,wallDt=dt){elapsed+=dt;time+=dt;economy.tick(wallDt);processEconomyEvents();scrollNews(wallDt);music(dt);headlineTimer-=dt;breakingCd=Math.max(0,breakingCd-dt);noticeTimer-=wallDt;if(noticeTimer<=0)$('notice').style.opacity=0;bannerTimer-=wallDt;if(bannerTimer<=0)$('eventBanner').hidden=true;const storm=currentChapter().weather?.lightning===true;nextLightning-=dt;if(storm&&nextLightning<=0){lightning=.34;nextLightning=rand(7,13);bolt=[];let x=rand(100,1180);for(let y=0;y<400;y+=35){x+=rand(-65,65);bolt.push([x,y]);}noise(1.5,.32,250);}if(!storm)lightning=0;else lightning=Math.max(0,lightning-dt);shake=Math.max(0,shake-dt*22);p.recoil=Math.max(0,p.recoil-dt);slow=Math.max(0,slow-wallDt);
updateAI(dt);updateBeam(dt);updateEnemies(dt);armNodeGate();camera+=(Math.max(0,cameraTarget())-camera)*Math.min(1,dt*3);zoom+=((p.action.name==='beam'?1.045:p.action.name==='roar'?1.025:1)-zoom)*Math.min(1,dt*2);sceneZoom+=(cameraScale()-sceneZoom)*Math.min(1,dt*1.5);
for(let b of buildings){b.hit=Math.max(0,b.hit-dt);if(b.dead&&b.collapse<3){b.collapse+=dt;if(Math.random()<dt*20)smoke(b.x+rand(0,b.w),b.ground-Math.max(0,b.h*(1-b.collapse*.6)),25);}else if(!b.dead&&b.hp<b.max*.65&&Math.random()<dt*7)smoke(b.x+b.w*.66,b.ground-b.h*.6,18);}
for(let f of fires){f.age+=dt;const smokeRate=data.level<15?5.5:11;if(Math.random()<dt*smokeRate){smoke(f.x+rand(-f.size/2,f.size/2),f.y-20,20*fxScale(f.jitter));}}fires=fires.filter(f=>f.age<24&&Math.abs(f.x-p.x)<1900).slice(-60);for(let w of wrecks)w.age+=dt;wrecks=wrecks.filter(w=>w.age<50&&Math.abs(w.x-p.x)<1900).slice(-40);
for(let a of particles){a.life-=dt;a.x+=a.vx*dt;a.y+=a.vy*dt;a.vy+=a.gravity*dt;if(a.smoke)a.size+=dt*11;else if(a.y>G+8){a.y=G+8;a.vy*=-.22;a.vx*=.7;}}particles=particles.filter(a=>a.life>0&&Math.abs(a.x-p.x)<1800).slice(-700);for(let r of rings){r.life-=dt;r.r+=dt*(r.type==='blast'?170:470);}rings=rings.filter(r=>r.life>0);for(let f of floaters){f.life-=dt;f.y-=dt*27;}floaters=floaters.filter(f=>f.life>0);if(p.moving&&Math.random()<dt*10)burst(p.x+25,G,2,['#629fbc','#b7dcf3'],80);
/* 换场雪花的时间轴。**世界替换不在这里** —— 它按 BOSS_FALL 那一拍由
 * completeBossChallenge 触发（见 updateEnemies），本段只负责爬升 / 维持 / 散开。
 * 这样"替换发生在雪花遮满的那一帧"由两个常量的大小关系保证，
 * 而不是靠这里的代码顺序 —— 顺序会被后来的人无意改掉。 */
if(sceneSwitch){sceneSwitch.t+=dt;if(sceneSwitchDone(sceneSwitch.t))endSceneSwitch();}
saveTimer+=wallDt;if(saveTimer>=5){saveTimer=0;save();}uiTimer+=wallDt;if(uiTimer>=.2){uiTimer=0;hud();}}
buildUI();
if(panelMode){openPanel('assign');hud();}
else{generateWorld(data.world);broadcast('巨兽观测恢复 · '+chapterLocation(),'累计行程 '+Math.floor(data.meters)+' m · 现场镜头持续跟踪',true);catchUp(Date.now());save();hud();}
if(!panelMode){
  document.addEventListener('pointerdown',()=>{if(!muted)audioInit();},{once:true});
  document.fonts?.ready.then(()=>{for(const b of buildings)b.texture=makeBuilding(b.x,b.w,b.h,b.index).texture;});
  window.addEventListener('pagehide',()=>{save();window.__tvBridge?.flush();});
  document.addEventListener('visibilitychange',()=>{save();last=performance.now();});
}else{
  document.documentElement.classList.add('panel-view');
  document.addEventListener('visibilitychange',syncAssignHologram);
  window.addEventListener('pagehide',()=>{clearTimeout(syncAssignHologram.state?.timer);});
  window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener('change',()=>{if(syncAssignHologram.state)syncAssignHologram.state.lastDraw='';syncAssignHologram();});
  fins.loaded.then(()=>{if(syncAssignHologram.state)syncAssignHologram.state.revision++;syncAssignHologram();});
  document.addEventListener('click',e=>{
    const el=e.target.closest?.('button,input');if(!el||!el.id||el.disabled)return;
    if(el.id.endsWith('Tab')||el.id.startsWith('open-')||['closePanel','evoSpeed','resetSave'].includes(el.id))return;
    if(el.getAttribute('aria-disabled')==='true'){e.preventDefault();e.stopImmediatePropagation();return;}
    if(el.id==='auto')return;
    e.preventDefault();e.stopImmediatePropagation();
    sendPanelCommand({id:el.id});
  },true);
  document.addEventListener('change',e=>{
    const el=e.target;if(!['auto','policy'].includes(el.id))return;
    e.stopImmediatePropagation();sendPanelCommand({id:el.id,checked:el.checked,value:el.value});
  },true);
}
/* 帧时序 —— wallDt（收入时钟）必须覆盖真实流逝的**全部**时间。
 *
 * 原实现把 wallDt 钳到 0.15s，而 catchUp 只在 rawDt>3 时触发，于是
 * rawDt ∈ (0.15, 3] 这一段既进不了 tick、也进不了离线结算 —— 时间直接蒸发：
 *   5fps 的机器每帧丢 25%；一次 2.9s 的卡顿全额丢弃。
 * 桌宠常年待在窗口角落、被系统降频、和别的重活抢 CPU，这不是边角情况。
 *
 * tick 是纯加法，不需要钳制 —— 钳制只对物理步长 dt 有意义。
 *
 * 长停顿（rawDt>3）仍走离线结算，避免追赶数万帧；但必须把离线**已认领**的时段
 * 从 wallDt 里扣掉，否则两处都不认账：offline() 对 <10s 的停顿直接 return null
 * （且 lastSeen 已经推进），实测一次 5s 卡顿只入账 1/60s。扣除后本帧计入的时长
 * 恒为 max(离线认领, rawDt) —— 既不多算，也不少算。
 */
function frame(now){if(panelMode||debugFrozen)return;let rawDt=last?(now-last)/1000:1/60;last=now;let wallDt=rawDt;if(rawDt>3){let seen=economy.data.lastSeen;catchUp(Date.now());wallDt=Math.max(0,rawDt-(economy.data.lastSeen-seen)/1000);rawDt=1/60;}let dt=Math.min(rawDt,.05)*(slow>0?.36:1);update(dt,wallDt);render();requestAnimationFrame(frame);}
let debugFrozen=false;
if(!panelMode)requestAnimationFrame(frame);

/* 交给桌宠侧的成长钩子。面板是另一个 tv 实例、存档只读，它靠这几个函数
 * 和电视窗口协作：
 *   playRoll   面板收到电视窗口回推的掷骰结果，播动画
 *   sync       主进程每次落盘后推来的 payload，面板用它重建并重渲染
 * 只暴露函数、不暴露内部状态，别把 economy 或 data 交出去。
 *
 * 它挂在 window 上是给**浏览器形态**用的（window.open 的副屏直接读
 * window.opener.__growth）。桌面外壳里两个世界是隔离的，preload 看不见
 * 页面全局，所以还要主动把同一份交进桥里（__tvBridge.register）——
 * 桥不在时那个 ?. 是空操作，浏览器形态照旧。 */
window.__growth={
  playRoll:(r)=>{try{playDiceRoll(r);}catch{}},
  sync:(payload)=>{if(!panelMode||typeof payload!=='string')return;let next=P.sanitize(JSON.parse(payload));Object.assign(data,next);$('auto').checked=data.auto;$('policy').value=data.policy;renderGrowthPanels();hud();},
  command:panelCommand,
  snapshot:()=>JSON.stringify(data),
  save,
  open:(key)=>{try{openPanel(key);}catch{}},
  panelState:()=>String(!$('management').hidden),
};
try{window.__tvBridge?.register(window.__growth);}catch{}
if(panelMode&&!window.__panelHost){
  try{if(window.opener?.__growth)window.__growth.sync(window.opener.__growth.snapshot());}catch{}
  openPanel(new URLSearchParams(pageSearch).get('tab')||'assign');
}
})();
