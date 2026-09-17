/* Isolated Electron rendering of actual product modules. No real save access. */
'use strict';
const {app,BrowserWindow,protocol}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const TV=path.resolve(__dirname,'../tv'),OUT=path.resolve(__dirname,'../../outputs');
app.setPath('userData',path.join(OUT,'growth-probe-profile'));
app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([{scheme:'growth',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const errors=[];
let current={level:1,hue:null};
const hook=`window.__visual={async shot(level,hue){debugFrozen=true;data.level=level;data.morph={spikes:0,spikeScale:1,hue};data.talents={};syncGrowthSkin();await new Promise(r=>setTimeout(r,180));await skeleton.loaded;await fins.loaded;time=0;p.x=420;p.action={name:'walk',t:0};p.moving=false;p.step=0;p.recoil=0;p.stagger=0;shake=0;rigState=KaijuRig.pose(p,0);BS=bodyScale();SK=scaleRig(rigState,BS,p.x,G);camera=cameraTarget();sceneZoom=cameraScale();render();const png=canvas.toDataURL('image/png');const c=document.createElement('canvas');c.width=820;c.height=480;const g=c.getContext('2d');g.imageSmoothingEnabled=false;g.fillStyle='#111827';g.fillRect(0,0,820,480);const rs=scaleRig(KaijuRig.pose({x:460,ground:440,step:0,moving:false,action:{name:'neutral',t:0}},0),BS,460,440);const D=Appearance.decor({form:Appearance.FORMS[economy.epochIndex()],level:data.level,morph:data.morph,talents:{}});skeleton.draw(g,rs,0,BS);fins.draw(g,rs,0,BS,D.spikes);return {level,hue,style:skeleton.parts.torso.style,scale:BS,count:D.spikes.count,failures:[...skeleton.failures,...fins.failures],png,body:c.toDataURL('image/png')};}};`;
app.whenReady().then(async()=>{
 protocol.handle('growth',req=>{const u=new URL(req.url),rel=decodeURIComponent(u.pathname).replace(/^\//,'')||'index.html',p=path.resolve(TV,rel);if(!p.startsWith(TV+path.sep))return new Response('',{status:403});let content=fs.readFileSync(p);if(rel==='game.js'){let s=content.toString();s=s.replace(/\}\)\(\);\s*$/,hook+'})();');s=`window.__tvBridge={storage:{getItem:()=>JSON.stringify({version:4,seed:12345,level:${current.level},auto:false,muted:true,lastSeen:Date.now(),morph:{hue:${JSON.stringify(current.hue)}}}),setItem(){}}};\n`+s;content=Buffer.from(s);}return new Response(content,{headers:{'content-type':({'.js':'application/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.woff2':'font/woff2'})[path.extname(p)]||'application/octet-stream'}});});
 let win;
 try{
  win=new BrowserWindow({show:false,width:1280,height:850,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.on('console-message',e=>{if(e.level==='error'||e.level===3)errors.push(e.message);});
  await win.loadURL('growth://local/index.html');
  await win.webContents.executeJavaScript('document.fonts.ready');
  const shots=[];
  for(const [level,hue] of [[1,null],[14,null],[15,null],[25,null],[50,null],[75,null],[100,null],[50,'jade'],[50,'crimson'],[50,'albino'],[50,'obsidian'],[1,null]]){
   const r=await win.webContents.executeJavaScript(`window.__visual.shot(${level},${JSON.stringify(hue)})`);
   const name='growth-L'+level+(hue?'-'+hue:'');
   fs.writeFileSync(path.join(OUT,name+'.png'),Buffer.from(r.png.split(',')[1],'base64'));
   fs.writeFileSync(path.join(OUT,name+'-body.png'),Buffer.from(r.body.split(',')[1],'base64'));
   delete r.png;delete r.body;shots.push(r);
  }
  fs.writeFileSync(path.join(OUT,'growth-visual.json'),JSON.stringify({shots,errors},null,2));
  if(errors.length||shots.some(s=>s.failures.length))throw Error(JSON.stringify({errors,shots}));
  console.log('PASS product canvas, live skin transitions, L14/L15 gate, downgrade, four hue overrides');
 }catch(e){console.error(e);process.exitCode=1;}finally{if(win)win.destroy();app.exit(process.exitCode||0);}
});
