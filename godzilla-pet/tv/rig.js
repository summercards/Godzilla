/* Source-faithful anatomical cutouts. Bind pose reconstructs approved original.
 *
 * 部件表不再手写在本文件里，改成三层来源组装：
 *   结构（槽位 / 父子 / 枢轴比例 / 基准尺寸）  assets/monsters/<怪兽>/rig.data.js
 *                                              ← 由 build/derive-rig.cjs 从母图裁切元数据生成
 *   路径（贴图在哪）                          assets/asset-index.js
 *   样式 / 颜色 / 大小（形态）                appearance.js 的 FORMS 与 skinFor()
 * 换某个形态的贴图 → 改 appearance.js；换怪兽 → 改 asset-index.js + 母图元数据。
 * 注意：关节世界坐标只由 RIG.scale 决定，与单槽位大小无关。
 */
(function(root){'use strict';
const RIG=(root.KaijuMonsters&&root.KaijuMonsters.godzilla)||require('./assets/monsters/godzilla/rig.data.js');
const ASSETS=root.KaijuAssets||require('./assets/asset-index.js');
const Appearance=root.KaijuAppearance||require('./appearance.js');
/* 默认皮肤 = 形态 0（幼兽）下的基准装配，即已被视觉验收的那一套。 */
const SKIN=Appearance.skinFor(RIG.monster,0,null);
const PARTS=Appearance.toParts(RIG,SKIN,RIG.monster);
const SCALE=RIG.scale,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),mix=(a,b,t)=>a+(b-a)*t;
function curve(t,keys){if(t<=keys[0][0])return keys[0][1];for(let i=1;i<keys.length;i++)if(t<=keys[i][0]){let f=(t-keys[i-1][0])/(keys[i][0]-keys[i-1][0]);f=f*f*(3-2*f);return mix(keys[i-1][1],keys[i][1],f);}return keys.at(-1)[1];}
function bone(parent,x,y,a=0){let c=Math.cos(parent.a),s=Math.sin(parent.a);return{x:parent.x+x*c-y*s,y:parent.y+x*s+y*c,a:parent.a+a};}
function point(b,x,y){return{x:b.x+x*Math.cos(b.a)-y*Math.sin(b.a),y:b.y+x*Math.sin(b.a)+y*Math.cos(b.a)};}
/* 父子关系来自 rig.data.js 的槽位定义，不再手写第二份。 */
const PARENTS={};for(const k in RIG.slots)PARENTS[k]=RIG.slots[k].parent;
// Interior skin follows the parent bone, so lifted limbs never expose the city through the torso.
const SEAMS=[['torso',1183,203,80,64],['torso',1180,405,74,83],['upper_arm',1260,470,48,50],['torso',1030,724,137,153],['torso',1280,760,80,105],['thigh',1060,867,64,55],['far_thigh',1320,851,64,55],['torso',801,792,95,87],['tail_base',617,716,65,82],['tail_mid',345,630,53,70]];
function pose(actor,t){let act=actor.action||{name:'walk',t:0},u=act.t,neutral=act.name==='neutral',phase=actor.step||0,walking=actor.moving?1:0,swing=Math.sin(phase)*walking;
let body=neutral?0:Math.sin(t*1.8)*.004-swing*.008,head=neutral?0:Math.sin(t*1.5)*.008,jaw=neutral?0:-.10,upper=-swing*.06,fore=-swing*.04,ft=swing*.115,bt=-swing*.12,fs=-swing*.09,bs=swing*.10,tail=neutral?0:Math.sin(t*1.4)*.028,mid=neutral?0:Math.sin(t*1.4-.6)*.045,tip=neutral?0:Math.sin(t*1.4-1.2)*.06;
let bob=neutral?0:Math.sin(t*1.8)*1.5+Math.abs(Math.sin(phase))*2*walking;
if(act.name==='claw'){body+=curve(u,[[0,0],[.28,-.045],[.57,.065],[1.18,0]]);upper+=curve(u,[[0,0],[.28,-.58],[.55,.13],[.73,.26],[1.18,0]]);fore+=curve(u,[[0,0],[.28,-.45],[.55,-.12],[.8,.10],[1.18,0]]);jaw=curve(u,[[0,-.1],[.5,.04],[1.18,-.1]]);}
if(act.name==='beam'){body+=curve(u,[[0,0],[.85,-.045],[1.1,.012],[3.55,.016],[4.2,0]]);head=clamp(actor.angle||0,-.32,.45)*.75-body;jaw=curve(u,[[0,-.1],[.8,.14],[3.55,.14],[4.2,-.1]]);upper=-.075;fore=.05;}
if(act.name==='stomp'){ft+=curve(u,[[0,0],[.55,-.40],[.86,-.44],[1,.09],[1.68,0]]);fs+=curve(u,[[0,0],[.55,.13],[.86,.17],[1,-.07],[1.68,0]]);bob+=curve(u,[[0,0],[.6,-10],[.87,-8],[1.04,12],[1.68,0]]);body+=curve(u,[[0,0],[.6,-.05],[1,.05],[1.68,0]]);upper=-.1;}
if(act.name==='roar'){let weight=curve(u,[[0,0],[.42,1],[1.5,1],[2.1,0]]);body=-.035*weight;head=-.14*weight;jaw=.2*weight;upper=-.14*weight;fore=-.09*weight;tail+=Math.sin(t*7)*.06*weight;}
if(act.name==='tail'){body+=curve(u,[[0,0],[.4,.05],[.85,-.06],[1.65,0]]);tail+=curve(u,[[0,0],[.4,.18],[.85,-.24],[1.65,0]]);mid+=curve(u,[[0,0],[.45,.15],[.91,-.28],[1.65,0]]);tip+=curve(u,[[0,0],[.5,.17],[.97,-.3],[1.65,0]]);}
const origin=PARTS.torso.sourcePivot,angles={torso:body,head,jaw,upper_arm:upper,forearm:fore,thigh:ft,shin:fs,far_thigh:bt,far_shin:bs,tail_base:tail,tail_mid:mid,tail_tip:tip};
const b={root:{x:actor.x,y:actor.ground-(1024-origin[1])*SCALE+bob,a:0}};
function build(name){let parent=PARENTS[name],offset=PARTS[name].sourcePivot,base=parent?PARTS[parent].sourcePivot:origin;b[name]=bone(parent?b[parent]:b.root,(offset[0]-base[0])*SCALE,(offset[1]-base[1])*SCALE,angles[name]);}
['torso','tail_base','tail_mid','tail_tip','far_thigh','far_shin','head','jaw','thigh','shin','upper_arm','forearm'].forEach(build);b.body=b.torso;
const locate=(name,x,y)=>point(b[name],(x-PARTS[name].sourcePivot[0])*SCALE,(y-PARTS[name].sourcePivot[1])*SCALE);
const seams=neutral?[]:SEAMS.map(([parent,x,y,rx,ry])=>({...locate(parent,x,y),a:b[parent].a,rx:rx*SCALE,ry:ry*SCALE}));
return{seams,bones:b,muzzle:locate('head',1420,220),claw:locate('forearm',1435,484),foot:locate('shin',1055,1000),tail:locate('tail_tip',70,734),neutral};}
class Skeleton{
/* parts 可注入：换形态/换皮肤时传入另一套 toParts() 结果即可，渲染顺序不变。 */
constructor(parts){this.parts=parts||PARTS;this.images={};this.ready=false;this.failures=[];this.loaded=Promise.all(Object.entries(this.parts).map(([key,p])=>new Promise(resolve=>{let im=new Image();im.onload=()=>resolve();im.onerror=()=>{this.failures.push(key);resolve();};im.src=p.src;this.images[key]=im;}))).then(()=>this.ready=this.failures.length===0);}
draw(ctx,state,camera=0,drawScale=1){const order=RIG.order;
// Small stepped scale patches sit under moving joints, never above the source artwork.
for(let patch of state.seams||[]){ctx.save();ctx.translate(patch.x-camera,patch.y);ctx.rotate(patch.a);const {rx,ry}=patch;for(let y=-ry;y<ry;y+=4){for(let x=-rx;x<rx;x+=4){if((x*x)/(rx*rx)+(y*y)/(ry*ry)>1)continue;ctx.fillStyle=((Math.floor(x/4)+Math.floor(y/8))%3===0)?'#303342':'#202331';ctx.fillRect(Math.floor(x/4)*4,Math.floor(y/4)*4,4,4);}}ctx.restore();}
for(let key of order){let b=state.bones[key],p=this.parts[key],im=this.images[key];if(!im?.complete||!im.naturalWidth)continue;ctx.save();ctx.translate(b.x-camera,b.y);ctx.rotate(b.a);ctx.drawImage(im,-p.pivot[0]*drawScale,-p.pivot[1]*drawScale,p.width*p.scale*drawScale,p.height*p.scale*drawScale);ctx.restore();}}}
const api={RIG,ASSETS,Appearance,SKIN,PARTS,PARENTS,SEAMS,pose,point,bone,curve,Skeleton};if(typeof module!=='undefined')module.exports=api;else root.KaijuRig=api;
})(typeof window!=='undefined'?window:this);
