/* Source-faithful articulated boss. Geometry is generated from source/parts.json. */
(function(root){'use strict';
const R=root.SentinelRigData||(typeof require==='function'&&require('./assets/enemies/army/sentinel/rig.data.js'));
const A=root.KaijuAssets||(typeof require==='function'&&require('./assets/asset-index.js'));
const clamp=(v,a,b)=>Math.max(a,Math.min(v,b));
function point(b,x,y){return {x:b.x+x*Math.cos(b.a)-y*Math.sin(b.a),y:b.y+y*Math.cos(b.a)+x*Math.sin(b.a)};}
const INTRO={impact:1.5,duration:4.3},MELEE={hit:.72,duration:1.6};
function curve(t,keys){if(t<=keys[0][0])return keys[0][1];for(let i=1;i<keys.length;i++){if(t<=keys[i][0]){const f=clamp((t-keys[i-1][0])/(keys[i][0]-keys[i-1][0]),0,1),u=f*f*(3-2*f);return keys[i-1][1]+(keys[i][1]-keys[i-1][1])*u;}}return keys.at(-1)[1];}
// Solve a two-bone chain towards a world-space endpoint without stretching textures.
function solve(bones,upper,lower,end,target,bend=1){
 const a=bones[upper],b=bones[lower],u=R.slots[upper],v=R.slots[lower];
 const dx=(v.pivot[0]-u.pivot[0])*R.scale,dy=(v.pivot[1]-u.pivot[1])*R.scale;
 const ex=(end[0]-v.pivot[0])*R.scale,ey=(end[1]-v.pivot[1])*R.scale,l1=Math.hypot(dx,dy),l2=Math.hypot(ex,ey);
 const tx=target.x-a.x,ty=target.y-a.y,d=clamp(Math.hypot(tx,ty),Math.abs(l1-l2)+.01,l1+l2-.01),direction=Math.atan2(ty,tx);
 const joint=Math.acos(clamp((l1*l1+d*d-l2*l2)/(2*l1*d),-1,1));a.a=direction-bend*joint-Math.atan2(dy,dx);
 Object.assign(b,point(a,dx,dy));b.a=Math.atan2(target.y-b.y,target.x-b.x)-Math.atan2(ey,ex);
}
function pose(e,ground=590,bind=false){
 const dead=e.state==='falling',fall=dead?clamp(e.age/2.4,0,1):0;
 const entering=!dead&&e.introDone===false,entrance=e.introTime||0,melee=!dead&&e.meleeTime!=null,mt=e.meleeTime||0;
 const charge=!dead&&!entering&&!melee?Math.max(clamp((1.4-e.cd)/1.4,0,1),clamp((e.fired||0)/.38,0,1)):0,breath=Math.sin((e.phase||0)*2.4),hit=e.hit>0?Math.sin(clamp(e.hit/.15,0,1)*Math.PI):0;
 const angles=bind?{}:{torso:breath*.006+charge*.045-hit*.045+fall*.1,head:-charge*.10+breath*.013,arm:charge*.76+(e.fired>0?.09:0)+breath*.018,forearm:charge*.62,far_arm:charge*.5-breath*.014,far_forearm:charge*.85,thigh:fall*-.6,shin:fall*.8,far_thigh:fall*-.35,far_shin:fall*.5};
 const rootBone={x:e.x,y:ground+(bind?0:fall*12),a:bind?0:fall*1.4};
 const bones={root:rootBone};
 function visit(name){if(bones[name])return bones[name];const spec=R.slots[name],parent=spec.parent==='root'?rootBone:visit(spec.parent),ref=spec.parent==='root'?R.origin:R.slots[spec.parent].pivot;
  const v=point(parent,(spec.pivot[0]-ref[0])*R.scale,(spec.pivot[1]-ref[1])*R.scale);return bones[name]={...v,a:parent.a+(angles[name]||0)};}
 Object.keys(R.slots).forEach(visit);
 if(!bind&&!dead&&(entering||melee)){
  const descend=entering?curve(entrance,[[0,-830],[.65,-830],[1.15,-460],[1.5,0]]):0;
  const crouch=entering?curve(entrance,[[0,25],[1.3,25],[1.5,110],[1.72,126],[2.25,112],[3.65,0],[4.3,0]]):curve(mt,[[0,0],[.45,20],[.72,clamp((e.meleeTarget?.y||ground-145)-(ground-180),20,120)],[.88,clamp((e.meleeTarget?.y||ground-145)-(ground-180),20,120)],[1.6,0]]);
  const lean=entering?curve(entrance,[[0,0],[1.5,-24],[2.3,-24],[3.7,0]]):curve(mt,[[0,0],[.43,12],[.72,-75],[.88,-75],[1.6,0]]);
  for(const name of ['torso','head','arm','forearm','far_arm','far_forearm']){bones[name].y+=crouch+descend;bones[name].x+=lean;}
  for(const name of ['thigh','far_thigh']){bones[name].y+=crouch+descend;bones[name].x+=lean*.35;}
  for(const [upper,lower,end]of [['thigh','shin',[811,1370]],['far_thigh','far_shin',[355,1350]]]){
   solve(bones,upper,lower,end,{x:e.x+(end[0]-R.origin[0])*R.scale,y:ground+(end[1]-R.origin[1])*R.scale+descend},-1);
  }
  for(const name of ['foot','far_foot']){const spec=R.slots[name],parent=R.slots[spec.parent];Object.assign(bones[name],point(bones[spec.parent],(spec.pivot[0]-parent.pivot[0])*R.scale,(spec.pivot[1]-parent.pivot[1])*R.scale));bones[name].a=0;}
  if(entering){const press=curve(entrance,[[0,0],[1.3,0],[1.5,1],[2.4,1],[3.7,0]]);
   const neutral=point(bones.forearm,(805-774)*R.scale,(790-538)*R.scale);
   solve(bones,'arm','forearm',[805,790],{x:neutral.x+(e.x-45-neutral.x)*press,y:neutral.y+(ground-35+descend-neutral.y)*press});
   const guard=point(bones.far_forearm,(222-323)*R.scale,(793-561)*R.scale);
   solve(bones,'far_arm','far_forearm',[222,793],{x:guard.x-press*20,y:guard.y-press*50});
   bones.head.a+=curve(entrance,[[0,.15],[1.5,-.15],[2.3,-.15],[3.2,.08],[4.3,0]]);
  }else{
   const thrust=curve(mt,[[0,0],[.46,0],[.72,1],[.84,1],[1.6,0]]);
   const target=e.meleeTarget||{x:e.x-145,y:ground-145};
   const neutral=point(bones.forearm,(805-774)*R.scale,(790-538)*R.scale),coil=curve(mt,[[0,0],[.43,1],[1.0,1],[1.6,0]]);
   const wind={x:neutral.x+(e.x+68-neutral.x)*coil,y:neutral.y+(ground-205-neutral.y)*coil};
   solve(bones,'arm','forearm',[805,790],{x:wind.x+(target.x-wind.x)*thrust,y:wind.y+(target.y-wind.y)*thrust});
   const guard=point(bones.far_forearm,(222-323)*R.scale,(793-561)*R.scale);solve(bones,'far_arm','far_forearm',[222,793],{x:guard.x-12*coil,y:guard.y-20*coil});
  }
 }

 // Keep both boots above the street while the knees buckle and the body falls.
 if(dead&&!bind){const samples=[['shin',840,1518],['shin',890,1480],['far_shin',260,1460],['far_shin',160,1450]];let bottom=ground;
  for(const [name,x,y]of samples){const s=R.slots[name];bottom=Math.max(bottom,point(bones[name],(x-s.pivot[0])*R.scale,(y-s.pivot[1])*R.scale).y);}
  for(const b of Object.values(bones))b.y-=bottom-ground;
 }
 return {bones,charge,fall,entering,entrance,melee,fist:point(bones.forearm,(805-R.slots.forearm.pivot[0])*R.scale,(790-R.slots.forearm.pivot[1])*R.scale),muzzle:point(bones.far_forearm,(222-R.slots.far_forearm.pivot[0])*R.scale,(793-R.slots.far_forearm.pivot[1])*R.scale),core:point(bones.torso,(440-R.slots.torso.pivot[0])*R.scale,(396-R.slots.torso.pivot[1])*R.scale)};
}
class Renderer{
 constructor(ImageType=root.Image){this.images={};this.ready=false;this.failures=[];
 const jobs=[];for(const slot of Object.keys(R.slots))for(const kind of ['default',...(R.seams[slot]?['joint']:[])]){const image=new ImageType();this.images[slot+':'+kind]=image;jobs.push(new Promise(resolve=>{image.onload=()=>resolve(true);image.onerror=()=>{this.failures.push(slot+':'+kind);resolve(false);};image.src=A.file.enemyPart('army','sentinel',slot,kind);}));}
 this.loaded=Promise.all(jobs).then(ok=>this.ready=ok.every(Boolean));}
 draw(ctx,e,camera,ground,bind=false){const state=pose(e,ground,bind);if(!this.ready)return state;
 const draw=(img,b,x,y,w,h)=>{ctx.save();ctx.translate(b.x-camera,b.y);ctx.rotate(b.a);ctx.drawImage(img,x,y,w,h);ctx.restore();};
 // Joint caps use the same original pixels and only bridge opened rotation cuts.
 if(!bind)for(const name of Object.keys(R.seams)){const b=state.bones[name],parent=state.bones[R.slots[name].parent];if(Math.abs(b.a-parent.a)<.005)continue;const r=R.seams[name].radius*R.scale;draw(this.images[name+':joint'],{...b,a:(b.a+parent.a)/2},-r,-r,2*r,2*r);}
 for(const name of R.order){const spec=R.slots[name],[x,y,x1,y1]=spec.bounds;draw(this.images[name+':default'],state.bones[name],(x-spec.pivot[0])*R.scale,(y-spec.pivot[1])*R.scale,(x1-x)*R.scale,(y1-y)*R.scale);}
 return state;
 }
}
const api={RIG:R,INTRO,MELEE,pose,point,Renderer,curve};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SentinelBoss=api;
})(typeof window!=='undefined'?window:this);
