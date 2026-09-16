/* Persistent idle economy. Also exported for deterministic tests. */
(function(root){
'use strict';
const STATS={power:{name:'巨兽力量',base:80,desc:'爪击、重踏与尾击伤害'},atomic:{name:'原子炉心',base:95,desc:'吐息伤害与高能强度'},metabolism:{name:'核能代谢',base:70,desc:'被动产能与破坏收益'},stride:{name:'巨躯动能',base:90,desc:'行进速度与抗封锁能力'}};
const SKILLS=[
{id:'impact',name:'震荡爪击',branch:'kinetic',cost:1,requires:null,desc:'爪击冲击相邻建筑，额外造成 40% 伤害'},
{id:'throw',name:'巨兽投掷',branch:'kinetic',cost:2,requires:'impact',desc:'被拍飞的残骸撞击其他敌人，造成连锁爆破'},
{id:'seismic',name:'地脉崩解',branch:'kinetic',cost:3,requires:'throw',desc:'重踏范围 +60%，建筑破坏伤害翻倍'},
{id:'pierce',name:'贯穿吐息',branch:'atomic',cost:1,requires:null,desc:'原子光束贯穿首个目标，追加攻击后方目标'},
{id:'chain',name:'电离连锁',branch:'atomic',cost:2,requires:'pierce',desc:'光束命中后向附近军队传导电弧'},
{id:'meltdown',name:'红莲临界',branch:'atomic',cost:3,requires:'chain',desc:'每第三次吐息转为红莲射线，伤害 ×2.5'},
{id:'harvest',name:'辐射汲取',branch:'evolution',cost:1,requires:null,desc:'所有核能获取 +25%，持续提高挂机收益'},
{id:'momentum',name:'不可阻挡',branch:'evolution',cost:2,requires:'harvest',desc:'军队对前进速度的压制降低 40%'},
{id:'overdrive',name:'原始觉醒',branch:'evolution',cost:3,requires:'momentum',desc:'技能冷却缩短 25%，离线收益效率提升至 90%'}
];
const finite=(v,d,min=0,max=1e15)=>Number.isFinite(+v)?Math.min(max,Math.max(min,+v)):d;
const defaults=()=>({version:3,energy:180,earned:0,xp:0,level:1,dna:0,district:1,cleared:0,kills:0,meters:0,levels:{power:1,atomic:1,metabolism:1,stride:1},skills:[],auto:true,policy:'balanced',muted:true,lastSeen:Date.now(),world:null});
function sanitize(raw){let a=defaults();if(!raw||raw.version!==3)return a;for(let k of ['energy','earned','xp','level','dna','district','cleared','kills','meters'])a[k]=finite(raw[k],a[k],k==='level'||k==='district'?1:0);a.level=Math.floor(a.level);a.district=Math.floor(a.district);a.dna=Math.floor(a.dna);for(let k in STATS)a.levels[k]=Math.floor(finite(raw.levels?.[k],1,1,500));a.skills=SKILLS.filter(s=>Array.isArray(raw.skills)&&raw.skills.includes(s.id)).map(s=>s.id);a.auto=raw.auto!==false;a.policy=['balanced','kinetic','atomic','evolution'].includes(raw.policy)?raw.policy:'balanced';a.muted=raw.muted!==false;a.lastSeen=finite(raw.lastSeen,Date.now(),0,Date.now());a.world=raw.world&&typeof raw.world==='object'?raw.world:null;return a;}
class Economy{
constructor(raw){this.data=sanitize(raw);this.autoClock=0;this.events=[];}
has(id){return this.data.skills.includes(id);}
mult(){return 1+(this.data.level-1)*.07;}
passive(){return (2.5+this.data.levels.metabolism*1.4)*this.mult()*(this.has('harvest')?1.25:1);}
rewardMult(){return (1+(this.data.levels.metabolism-1)*.12)*(this.has('harvest')?1.25:1);}
power(){return (54+this.data.levels.power*22)*this.mult();}
atomic(){return (85+this.data.levels.atomic*30)*this.mult();}
speed(){return 30+Math.sqrt(this.data.levels.stride)*8;}
nextXP(){return Math.round(260*Math.pow(this.data.level,1.28));}
cost(key){return Math.round(STATS[key].base*Math.pow(1.22,this.data.levels[key]-1));}
gain(n,xp=0){let d=this.data;d.energy+=n;d.earned+=n;d.xp+=xp;let guard=0;while(d.xp>=this.nextXP()&&guard++<100){d.xp-=this.nextXP();d.level++;d.dna++;this.events.push({type:'evolution',level:d.level});}}
upgrade(key){if(!STATS[key]||this.data.levels[key]>=500)return false;let cost=this.cost(key);if(this.data.energy<cost)return false;this.data.energy-=cost;this.data.levels[key]++;this.events.push({type:'upgrade',key,level:this.data.levels[key]});return true;}
unlock(id){let s=SKILLS.find(s=>s.id===id);if(!s||this.has(id)||this.data.dna<s.cost||(s.requires&&!this.has(s.requires)))return false;this.data.dna-=s.cost;this.data.skills.push(id);this.events.push({type:'skill',id});return true;}
chooseUpgrade(){let d=this.data,priority=d.policy==='kinetic'?['power','stride','atomic','metabolism']:d.policy==='atomic'?['atomic','metabolism','power','stride']:d.policy==='evolution'?['metabolism','stride','power','atomic']:['power','atomic','metabolism','stride'];return priority.map((k,i)=>({k,weight:this.cost(k)*(d.policy==='balanced'?1:i===0?.55:i===1?.85:1.3)})).sort((a,b)=>a.weight-b.weight)[0].k;}
autoSpend(){if(!this.data.auto)return;for(let i=0;i<4;i++){let k=this.chooseUpgrade();if(!this.upgrade(k))break;}const policy=this.data.policy;let choices=SKILLS.filter(s=>!this.has(s.id)&&(!s.requires||this.has(s.requires))).sort((a,b)=>(policy===a.branch?-10:0)+a.cost-((policy===b.branch?-10:0)+b.cost));for(let s of choices)if(this.unlock(s.id))break;}
tick(dt){this.gain(this.passive()*dt);this.autoClock+=dt;if(this.autoClock>=3){this.autoClock%=3;this.autoSpend();}}
offline(now){let seconds=Math.min(8*3600,Math.max(0,(now-this.data.lastSeen)/1000));this.data.lastSeen=now;if(seconds<10)return null;let efficiency=this.has('overdrive')?.9:.65;let rate=this.passive()+7*this.rewardMult();let amount=seconds*rate*efficiency;this.gain(amount);return {seconds,amount,efficiency,capped:seconds>=8*3600};}
serialize(now,world){this.data.lastSeen=now;if(world)this.data.world=world;return JSON.stringify(this.data);}
}
const api={Economy,STATS,SKILLS,defaults,sanitize};if(typeof module!=='undefined')module.exports=api;else root.IdleProgression=api;
})(typeof window!=='undefined'?window:this);
