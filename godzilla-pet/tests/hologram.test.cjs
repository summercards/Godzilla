'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const P=require('../tv/progression.js'),R=require('../tv/rig.js'),A=require('../tv/appearance.js'),G=require('../tv/growth.js');
const source=fs.readFileSync(path.join(__dirname,'../tv/game.js'),'utf8');
function fixture(){
 const economy=new P.Economy(),data=economy.data,callbacks=new Map(),listeners=new Map(),draws=[];
 let nextId=0,now=0,reduced=false;
 const gradient={addColorStop(){}};
 function canvas(){
  const ctx=new Proxy({filter:'none',createLinearGradient:()=>gradient,createRadialGradient:()=>gradient},
   {get:(t,k)=>k in t?t[k]:()=>{}});
  return {width:720,height:560,dataset:{},getContext:()=>ctx,getClientRects:()=>[{}],toDataURL:()=>''};
 }
 const c=canvas(),management={hidden:false,dataset:{page:'overview'}},document={hidden:false,
  createElement:canvas,documentElement:{style:{setProperty(){}}}};
 class Skeleton{
  constructor(parts){this.parts=parts;this.ready=true;this.failures=[];this.loaded=new Promise(()=>{});}
  draw(ctx){draws.push(ctx.filter);}
 }
 const sandbox={document,window:{matchMedia:()=>({matches:reduced})},performance:{now:()=>now},
  requestAnimationFrame:fn=>{const id=++nextId;callbacks.set(id,fn);return id;},cancelAnimationFrame:id=>callbacks.delete(id),
  $:id=>id==='management'?management:c,panelMode:true,economy,data,KaijuRig:{...R,Skeleton},Appearance:A,Growth:G,P,
  fins:{draw(){}},harborArt:{complete:false},elementColor:()=>null,beamColor:()=> '#70f8ff'};
 const scale=source.slice(source.indexOf('function scaleRig('),source.indexOf('\nfunction beamColor('));
 const hologram=source.slice(source.indexOf('function syncAssignHologram('),source.indexOf('/* 生成天赋面板'));
 vm.runInNewContext(scale+'\n'+hologram+'\nthis.api={sync:syncAssignHologram,draw:drawAssignHologram};',sandbox);
 return {sandbox,c,management,document,data,draws,callbacks,api:sandbox.api,
  setReduced:v=>{reduced=v;},frame:time=>{now=time;const pending=[...callbacks.values()];callbacks.clear();for(const fn of pending)fn(time);}};
}
test('hologram filters the assembled body once and reuses all 24 poses',()=>{
 const f=fixture();f.api.sync();const rig=f.api.sync.state.rig;
 f.draws.length=0;f.api.draw.frameKey='';
 for(let i=0;i<24;i++)f.api.draw(f.c,rig,12+i/24);
 assert.equal(f.api.draw.frames.filter(Boolean).length,24);
 assert.equal(f.draws.length,24);
 assert.ok(f.draws.every(filter=>filter==='none'),'bone and seam draws must not run through a filter');
 for(let i=0;i<24;i++)f.api.draw(f.c,rig,12+i/24);
 assert.equal(f.draws.length,24,'a second loop only composites cached poses');
 f.api.sync.state.revision++;f.api.draw(f.c,rig,12);
 assert.equal(f.draws.length,25,'late-loaded fin assets invalidate cached poses');
 f.data.level=15;f.api.draw(f.c,rig,12);
 assert.equal(f.draws.length,26,'growth changes invalidate cached poses');
});
test('hologram uses one display-synced clock capped at 30 FPS and stops when hidden',()=>{
 const f=fixture();f.api.sync();f.api.sync();assert.equal(f.callbacks.size,1);
 const calls=f.draws.length;f.frame(16);assert.equal(f.draws.length,calls,'skip frames before the budget');
 f.frame(34);assert.equal(f.callbacks.size,1);
 f.document.hidden=true;f.api.sync();assert.equal(f.callbacks.size,0);
 f.document.hidden=false;f.api.sync();assert.equal(f.callbacks.size,1);
 f.c.getClientRects=()=>[];f.frame(100);assert.equal(f.callbacks.size,0,'hidden tabs stop scheduling');
});
test('reduced motion draws only changed state, including research tab switches',()=>{
 const f=fixture();f.setReduced(true);f.api.sync();
 const before=f.draws.length;f.frame(1001);assert.equal(f.draws.length,before);
 f.management.dataset.page='assign';f.frame(2002);
 assert.ok(f.draws.length>before,'changing pages must redraw even with reduced motion');
 f.management.hidden=true;f.api.sync();assert.equal(f.callbacks.size,0);
});
