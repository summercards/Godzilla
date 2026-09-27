/* Source-faithful articulated boss. Geometry is generated from source/parts.json. */
(function(root){'use strict';
const R=root.SentinelRigData||(typeof require==='function'&&require('./assets/enemies/army/sentinel/rig.data.js'));
const A=root.KaijuAssets||(typeof require==='function'&&require('./assets/asset-index.js'));
const clamp=(v,a,b)=>Math.max(a,Math.min(v,b));
function point(b,x,y){return {x:b.x+x*Math.cos(b.a)-y*Math.sin(b.a),y:b.y+y*Math.cos(b.a)+x*Math.sin(b.a)};}
// The title film is part of the saved entrance clock; the drop starts after it exits.
const INTRO={cutin:3.8,impact:5.3,reveal:7.05,duration:8.1};
const MELEES=[
 {id:'jab',name:'疾风直拳',hit:.48,duration:1.15,hand:'far'},
 {id:'cross',name:'正义重拳',hit:.72,duration:1.65,hand:'near'},
 {id:'chop',name:'银曜手刀',hit:.68,duration:1.55,hand:'near'},
 {id:'uppercut',name:'升龙勾拳',hit:.66,duration:1.6,hand:'near'},
 {id:'kick',name:'流星前踢',hit:.78,duration:1.85,hand:'foot'}
];
const MELEE=MELEES[1],BEAM={charge:1.5,fire:1.15,recover:.65,duration:3.3};
function meleeSpec(e){return MELEES.find(m=>m.id===e.meleeKind)||MELEE;}
function curve(t,keys){if(t<=keys[0][0])return keys[0][1];for(let i=1;i<keys.length;i++){if(t<=keys[i][0]){const f=clamp((t-keys[i-1][0])/(keys[i][0]-keys[i-1][0]),0,1),u=f*f*(3-2*f);return keys[i-1][1]+(keys[i][1]-keys[i-1][1])*u;}}return keys.at(-1)[1];}
// Solve a two-bone chain towards a world-space endpoint without stretching textures.
function solve(bones,upper,lower,end,target,bend=1){
 const a=bones[upper],b=bones[lower],u=R.slots[upper],v=R.slots[lower];
 const dx=(v.pivot[0]-u.pivot[0])*R.scale,dy=(v.pivot[1]-u.pivot[1])*R.scale;
 const ex=(end[0]-v.pivot[0])*R.scale,ey=(end[1]-v.pivot[1])*R.scale,l1=Math.hypot(dx,dy),l2=Math.hypot(ex,ey);
 const tx=target.x-a.x,ty=target.y-a.y,d=clamp(Math.hypot(tx,ty),Math.abs(l1-l2)+.01,l1+l2-.01),direction=Math.atan2(ty,tx);
 const joint=Math.acos(clamp((l1*l1+d*d-l2*l2)/(2*l1*d),-1,1));a.a=direction-bend*joint-Math.atan2(dy,dx);
 const distance=Math.hypot(tx,ty)||1,reach={x:a.x+tx*d/distance,y:a.y+ty*d/distance};
 Object.assign(b,point(a,dx,dy));b.a=Math.atan2(reach.y-b.y,reach.x-b.x)-Math.atan2(ey,ex);
}
// Authored segment directions + elbow flexion. Both arms bend in the same anatomical
// direction; no moving hand target is allowed to pick a different IK branch.
const RAD=Math.PI/180;
const GUARD={near:[82,112],far:[115,105],lean:0,hip:0,dip:0};
const ACTING={
 jab:{wind:{near:[72,118],far:[65,132],lean:.12,hip:16,dip:12},strike:{near:[82,112],far:[170,12],lean:-.14,hip:-28,dip:23}},
 cross:{wind:{near:[32,123],far:[118,108],lean:.20,hip:22,dip:22},strike:{near:[175,12],far:[100,122],lean:-.27,hip:-48,dip:47}},
 chop:{wind:{near:[238,66],far:[122,104],lean:.12,hip:10,dip:10},strike:{near:[186,38],far:[105,115],lean:-.22,hip:-30,dip:30}},
 uppercut:{wind:{near:[52,85],far:[120,106],lean:.17,hip:18,dip:56},strike:{near:[190,76],far:[118,110],lean:-.14,hip:-22,dip:12}},
 kick:{wind:{near:[85,115],far:[120,110],lean:.16,hip:12,dip:22},strike:{near:[40,120],far:[152,70],lean:.26,hip:10,dip:10}}
};
function blendPose(a,b,t){const out={};for(const k of ['lean','hip','dip'])out[k]=a[k]+(b[k]-a[k])*t;for(const k of ['near','far'])out[k]=a[k].map((v,i)=>v+(b[k][i]-v)*t);return out;}
function actingPose(spec,t){
 const poses=ACTING[spec.id],windEnd=spec.hit*.65,hold=spec.hit+.14;
 if(t<windEnd)return blendPose(GUARD,poses.wind,curve(t,[[0,0],[windEnd,1]]));
 if(t<spec.hit)return blendPose(poses.wind,poses.strike,curve(t,[[windEnd,0],[spec.hit,1]]));
 if(t<hold)return poses.strike;
 return blendPose(poses.strike,GUARD,curve(t,[[hold,0],[spec.duration,1]]));
}
function chain(bones,upper,lower,end,angle,flex){
 const u=R.slots[upper],v=R.slots[lower],dx=(v.pivot[0]-u.pivot[0])*R.scale,dy=(v.pivot[1]-u.pivot[1])*R.scale;
 bones[upper].a=angle-Math.atan2(dy,dx);
 Object.assign(bones[lower],point(bones[upper],dx,dy));
 bones[lower].a=angle+flex-Math.atan2(end[1]-v.pivot[1],end[0]-v.pivot[0]);
}
function pose(e,ground=590,bind=false){
 const dead=e.state==='falling',fall=dead?clamp(e.age/2.4,0,1):0;
 const entering=!dead&&e.introDone===false,entrance=Math.max(0,(e.introTime||0)-INTRO.cutin),melee=!dead&&!entering&&e.meleeTime!=null,mt=e.meleeTime||0,spec=meleeSpec(e);
 const bt=e.beamTime,beaming=!dead&&!entering&&!melee&&bt!=null;
 const charge=beaming?curve(bt,[[0,0],[.85,1],[BEAM.charge+BEAM.fire,1],[BEAM.duration,0]]):0;
 const breath=Math.sin((e.phase||0)*2.4),hit=e.hit>0?Math.sin(clamp(e.hit/.15,0,1)*Math.PI):0;
 let acting=melee?actingPose(spec,mt):GUARD,descent=0;
 if(entering){
  descent=curve(entrance,[[0,-830],[.65,-830],[1.15,-460],[1.5,0]]);
  const land=curve(entrance,[[0,0],[1.28,0],[1.58,1],[2.25,1],[3.8,0]]);
  acting=blendPose({near:[225,80],far:[120,80],lean:0,hip:0,dip:22},{near:[123,20],far:[112,110],lean:-.22,hip:-20,dip:128},land);
  if(entrance>2.25)acting=blendPose({near:[123,20],far:[112,110],lean:-.22,hip:-20,dip:128},GUARD,curve(entrance,[[2.25,0],[3.8,1]]));
 }
 const rootBone={x:e.x+(bind||dead?0:acting.hip),y:ground+(bind?0:dead?fall*12:acting.dip+descent),a:bind?0:fall*1.4};
 const angles=bind?{}:{torso:dead?fall*.1:acting.lean+breath*.006-hit*.04,head:dead?0:-acting.lean*.55+breath*.008,thigh:fall*-.6,shin:fall*.8,far_thigh:fall*-.35,far_shin:fall*.5};
 const bones={root:rootBone};
 function visit(name){if(bones[name])return bones[name];const spec=R.slots[name],parent=spec.parent==='root'?rootBone:visit(spec.parent),ref=spec.parent==='root'?R.origin:R.slots[spec.parent].pivot;
  return bones[name]={...point(parent,(spec.pivot[0]-ref[0])*R.scale,(spec.pivot[1]-ref[1])*R.scale),a:parent.a+(angles[name]||0)};}
 Object.keys(R.slots).forEach(visit);
 if(!bind&&!dead){
  // Knee IK is only for planted soles. Clamp the endpoint, keep a fixed forward
  // knee branch, and reconstruct each child from its parent after every rotation.
  for(const [upper,lower,end]of [['thigh','shin',[811,1370]],['far_thigh','far_shin',[355,1350]]]){
   solve(bones,upper,lower,end,{x:e.x+(end[0]-R.origin[0])*R.scale,y:ground+(end[1]-R.origin[1])*R.scale+descent},-1);
  }
  if(melee&&spec.id==='kick'){
   const lift=curve(mt,[[0,0],[.42,1],[1.08,1],[spec.duration,0]]),extend=curve(mt,[[0,0],[.52,0],[spec.hit,1],[spec.hit+.14,1],[spec.duration,0]]);
   const upper=bones.thigh,lower=bones.shin,u=R.slots.thigh,v=R.slots.shin;
   const restUpper=upper.a+Math.atan2(v.pivot[1]-u.pivot[1],v.pivot[0]-u.pivot[0]);
   const restLower=lower.a+Math.atan2(1370-v.pivot[1],811-v.pivot[0]);
   const angle=restUpper+((218-20*extend)*RAD-restUpper)*lift;
   const flex=(restLower-restUpper)*(1-lift)+(-108+100*extend)*RAD*lift;
   chain(bones,'thigh','shin',[811,1370],angle,flex);
  }
  for(const name of ['foot','far_foot']){const s=R.slots[name],p=R.slots[s.parent];Object.assign(bones[name],point(bones[s.parent],(s.pivot[0]-p.pivot[0])*R.scale,(s.pivot[1]-p.pivot[1])*R.scale));bones[name].a=name==='foot'&&melee&&spec.id==='kick'?curve(mt,[[0,0],[.42,.5],[spec.hit,1.05],[spec.hit+.14,1.05],[spec.duration,0]]):0;}
  for(const [side,upper,lower,end]of [['near','arm','forearm',[805,790]],['far','far_arm','far_forearm',[222,793]]]){
   const values=acting[side];let angle=values[0]*RAD+bones.torso.a,flex=clamp(values[1],8,140)*RAD;
   if(beaming){
    // Cross above the chest: upright emitter, supporting forearm horizontal.
    const targetUpper=side==='near'?Math.PI-.1:220*RAD,targetLower=side==='near'?Math.PI*1.5:Math.PI*2;
    angle+=(targetUpper-angle)*charge;flex+=(targetLower-targetUpper-flex)*charge;
   }
   chain(bones,upper,lower,end,angle,flex);
  }
 }
 if(dead&&!bind){const samples=[['shin',840,1518],['shin',890,1480],['far_shin',260,1460],['far_shin',160,1450]];let bottom=ground;
  for(const [name,x,y]of samples){const s=R.slots[name];bottom=Math.max(bottom,point(bones[name],(x-s.pivot[0])*R.scale,(y-s.pivot[1])*R.scale).y);}
  for(const b of Object.values(bones))b.y-=bottom-ground;
 }
 const fist=point(bones.forearm,(805-R.slots.forearm.pivot[0])*R.scale,(790-R.slots.forearm.pivot[1])*R.scale),farFist=point(bones.far_forearm,(222-R.slots.far_forearm.pivot[0])*R.scale,(793-R.slots.far_forearm.pivot[1])*R.scale);
 const contact=spec.hand==='foot'?point(bones.foot,-8,15):spec.hand==='far'?farFist:fist;
 return {bones,charge,fall,entering,entrance,melee,meleeSpec:spec,beaming,beamActive:beaming&&bt>=BEAM.charge&&bt<BEAM.charge+BEAM.fire,fist,farFist,contact,muzzle:{x:bones.forearm.x+(fist.x-bones.forearm.x)*.6,y:bones.forearm.y+(fist.y-bones.forearm.y)*.6},core:point(bones.torso,(440-R.slots.torso.pivot[0])*R.scale,(396-R.slots.torso.pivot[1])*R.scale)};
}
// Conservative left edge of all textured parts throughout the fight, relative to the Boss root.
// The spacing guard uses this rather than the root because the suit, fists and kicks extend left.
function leftEdge(e){let left=Infinity;const bones=pose(e).bones;
 for(const [name,slot] of Object.entries(R.slots)){
  const b=bones[name],[x0,y0,x1,y1]=slot.visibleBounds||slot.bounds;
  for(const x of [x0,x1])for(const y of [y0,y1])left=Math.min(left,point(b,(x-slot.pivot[0])*R.scale,(y-slot.pivot[1])*R.scale).x);
 }return left-e.x;
}
const LEFT_REACH=Math.ceil(Math.max(0,-Math.min(
 leftEdge({x:0,state:'alive',phase:0,hit:0,introDone:true}),
 ...MELEES.flatMap(m=>Array.from({length:33},(_,i)=>leftEdge({x:0,state:'alive',phase:0,hit:0,introDone:true,meleeKind:m.id,meleeTime:m.duration*i/32}))),
 ...Array.from({length:33},(_,i)=>leftEdge({x:0,state:'alive',phase:0,hit:0,introDone:true,beamTime:BEAM.duration*i/32})),
 ...Array.from({length:33},(_,i)=>leftEdge({x:0,state:'alive',phase:0,hit:0,introDone:false,introTime:INTRO.cutin+(INTRO.duration-INTRO.cutin)*i/32}))
)))+8;
const INTRO_LEFT_REACH=Math.ceil(Math.max(...Array.from({length:65},(_,i)=>-leftEdge({x:0,state:'alive',phase:0,hit:0,introDone:false,introTime:INTRO.cutin+(INTRO.duration-INTRO.cutin)*i/64}))))+8;
class Renderer{
 constructor(ImageType=root.Image){this.images={};this.ready=false;this.failures=[];
 const jobs=[];for(const slot of Object.keys(R.slots))for(const kind of ['default',...(R.seams[slot]?['joint']:[])]){const image=new ImageType();this.images[slot+':'+kind]=image;jobs.push(new Promise(resolve=>{image.onload=()=>resolve(true);image.onerror=()=>{this.failures.push(slot+':'+kind);resolve(false);};image.src=A.file.enemyPart('army','sentinel',slot,kind);}));}
 this.loaded=Promise.all(jobs).then(ok=>this.ready=ok.every(Boolean));}
 drawCutin(ctx,t,w=1280,h=720){
  if(t<0||t>=INTRO.cutin)return false;
  const tick=Math.floor(t*24),u=curve(t,[[0,0],[.12,1],[3.55,1],[3.8,0]]);
  ctx.save();ctx.globalAlpha=u;ctx.fillStyle='#b52c22';ctx.fillRect(0,0,w,h);
  // Painted, flat-color optical streaks, stepped at film cadence instead of neon gradients.
  const cx=w*.3,cy=h*.48;
  for(let i=0;i<46;i++){
   const a=i*Math.PI*2/46+.015*Math.sin(tick*.2),r=100+(i*79+tick*47)%500,l=220+i%5*60,spread=.008+i%3*.006;
   ctx.fillStyle=i%3?'#efb450':'#f8ddb0';ctx.globalAlpha=u*(i%3?.33:.75);
   ctx.beginPath();ctx.moveTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r);ctx.lineTo(cx+Math.cos(a-spread)*(r+l),cy+Math.sin(a-spread)*(r+l));ctx.lineTo(cx+Math.cos(a+spread)*(r+l),cy+Math.sin(a+spread)*(r+l));ctx.fill();
  }
  ctx.globalAlpha=u;ctx.save();
  ctx.beginPath();ctx.moveTo(0,30);ctx.lineTo(690,30);ctx.lineTo(550,h-30);ctx.lineTo(0,h-30);ctx.closePath();ctx.clip();
  // The portrait uses the actual rig plates, so mask, eyes and suit match the combat actor.
  const slide=curve(t,[[0,-760],[.2,-760],[.62,20],[.78,0],[3.12,0],[3.56,-900]]);
  ctx.translate(w*.24+slide+(tick%3-1)*.7,1490);ctx.scale(3.4,3.4);
  this.draw(ctx,{x:0,state:'alive',phase:0,cd:3},0,0,true);ctx.restore();
  const words=(word,y,start,leave)=>{
   ctx.save();ctx.font='900 100px "Songti SC", "Noto Serif CJK SC", serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';
   for(let i=0;i<word.length;i++){
    const local=t-start-i*.055,exit=clamp((t-leave-i*.055)/.24,0,1);if(local<0)continue;
    const enter=1-Math.pow(1-clamp(local/.24,0,1),3),x=780+(i-(word.length-1)/2)*104+(1-enter)*1100-exit*1500;
    ctx.save();ctx.translate(x,y);ctx.rotate(-.055);ctx.lineWidth=12;ctx.strokeStyle='#351c22';ctx.strokeText(word[i],7,8);ctx.fillStyle='#351c22';ctx.fillText(word[i],7,8);
    ctx.lineWidth=5;ctx.strokeStyle='#351c22';ctx.strokeText(word[i],0,0);ctx.fillStyle='#ffeab7';ctx.fillText(word[i],0,0);ctx.restore();
   }ctx.restore();
  };
  words('为了正义!',282,.8,2.92);words('我来了!',436,1.48,3.13);
  ctx.fillStyle='#241d24';ctx.fillRect(0,0,w,26);ctx.fillRect(0,h-26,w,26);
  ctx.font='bold 19px "Songti SC", serif';ctx.textAlign='left';ctx.fillStyle='#ffe4a8';ctx.fillText('银 曜 巨 人   ·   出 战',54,66);
  ctx.textAlign='right';ctx.fillText('正 義 の 閃 光',w-50,h-53);
  // Subtle print misregistration, scratches and gate weave evoke a 1970s title film.
  ctx.globalAlpha=u*.12;ctx.fillStyle='#201b27';for(let y=tick%4;y<h;y+=4)ctx.fillRect(0,y,w,1);
  for(let i=0;i<70;i++){const x=(i*193+tick*71)%w,y=(i*137+tick*43)%h;ctx.fillStyle=i%2?'#fff1c4':'#261c24';ctx.fillRect(x,y,2+i%3,1+i%2);}
  ctx.restore();return true;
 }
 draw(ctx,e,camera,ground,bind=false){const state=pose(e,ground,bind);if(!this.ready)return state;
 const draw=(img,b,x,y,w,h)=>{ctx.save();ctx.translate(b.x-camera,b.y);ctx.rotate(b.a);ctx.drawImage(img,x,y,w,h);ctx.restore();};
 // The far upper arm is behind the chest, but its bent forearm guards in front.
 // Keeping both behind the torso would visually sever the wrist/cross-beam support.
 const order=bind?R.order:R.order.filter(n=>n!=='far_forearm');
 if(!bind)order.splice(order.indexOf('arm'),0,'far_forearm');
 for(const name of order){const spec=R.slots[name],[x,y,x1,y1]=spec.bounds;
  // Cap after the parent plate and before this child, not beneath the entire actor.
  // Circular caps do not inherit an averaged Euler angle (which jumps across ±pi).
  if(!bind&&R.seams[name]){const b=state.bones[name],parent=state.bones[spec.parent],r=R.seams[name].radius*R.scale;if(Math.abs(b.a-parent.a)>.005)draw(this.images[name+':joint'],{...b,a:b.a},-r,-r,2*r,2*r);}
  const open=!bind&&(name==='forearm'&&(state.charge>.4||state.melee&&state.meleeSpec.id==='chop')||name==='far_forearm'&&state.charge>.4);
  if(open){
   // A blade hand needs an open silhouette: replace only the glove beyond the cuff.
   // Canvas-native silver facets use the same suit palette; the source plates remain intact.
   const end=name==='forearm'?[805,790]:[222,793],dx=end[0]-spec.pivot[0],dy=end[1]-spec.pivot[1],len=Math.hypot(dx,dy),ux=dx/len,uy=dy/len;
   const wx=end[0]-ux*45,wy=end[1]-uy*45,rot=Math.atan2(dy,dx)-Math.PI/2,b=state.bones[name];
   ctx.save();ctx.translate(b.x-camera,b.y);ctx.rotate(b.a);ctx.scale(R.scale,R.scale);ctx.translate(wx-spec.pivot[0],wy-spec.pivot[1]);ctx.rotate(rot);
   ctx.save();ctx.beginPath();ctx.rect(-1000,-1500,2000,1500);ctx.clip();ctx.rotate(-rot);ctx.drawImage(this.images[name+':default'],x-wx,y-wy,x1-x,y1-y);ctx.restore();
   ctx.beginPath();for(const [i,v]of [[-27,-3],[27,-3],[30,22],[23,106],[15,125],[-15,125],[-25,113],[-31,32],[-46,56],[-54,48],[-48,22]].entries()){i?ctx.lineTo(...v):ctx.moveTo(...v);}ctx.closePath();ctx.fillStyle='#9caabd';ctx.fill();ctx.lineWidth=6;ctx.strokeStyle='#111b2b';ctx.stroke();
   ctx.fillStyle='#e4e7e5';ctx.fillRect(-17,6,13,98);ctx.fillRect(-12,103,25,10);ctx.fillStyle='#61738c';ctx.fillRect(13,13,9,85);
   ctx.strokeStyle='#37465d';ctx.lineWidth=3;for(const fx of [-9,2,12]){ctx.beginPath();ctx.moveTo(fx,52);ctx.lineTo(fx-2,113);ctx.stroke();}ctx.restore();
  }else draw(this.images[name+':default'],state.bones[name],(x-spec.pivot[0])*R.scale,(y-spec.pivot[1])*R.scale,(x1-x)*R.scale,(y1-y)*R.scale);
 }
 return state;
 }
}
const api={RIG:R,INTRO,MELEE,MELEES,BEAM,LEFT_REACH,INTRO_LEFT_REACH,meleeSpec,pose,point,leftEdge,Renderer,curve};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SentinelBoss=api;
})(typeof window!=='undefined'?window:this);
