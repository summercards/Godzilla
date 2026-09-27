// Isolated native-canvas QA. No access to the player's running game or save directory.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'sentinel-showcase-')));
const tv=path.join(__dirname,'../tv'),out=path.join(__dirname,'../../doc/boss-showcase'),frames=fs.mkdtempSync(path.join(os.tmpdir(),'sentinel-frames-'));
fs.mkdirSync(out,{recursive:true});
app.whenReady().then(async()=>{
 const w=new BrowserWindow({show:false,width:1280,height:720});
 const errors=[];w.webContents.on('console-message',event=>{if(event.level==='error'||event.level===3)errors.push(event.message);});
 await w.loadFile(path.join(tv,'index.html'));
 await w.webContents.executeJavaScript('window.requestAnimationFrame=()=>0;void 0');
 await new Promise(r=>setTimeout(r,100));
 const source=fs.readFileSync(path.join(tv,'game.js'),'utf8').replace(/\}\)\(\);\s*$/,`window.showcase={
 ready:Promise.all([sentinelRenderer.loaded,skeleton.loaded,document.fonts.ready]),
 setup(){p.x=4000;nodeArmed=true;camera=cameraTarget();p.cooldowns={beam:999,stomp:999,tail:999,roar:999};
 for(const b of buildings){b.dead=true;b.collapse=3;}enemies=enemies.filter(e=>e.type==='sentinel');enemies[0].hp=enemies[0].max=999999;requestNextMap();},
 frame(){update(.05,.05);render();return canvas.toDataURL('image/png');},
 still(t){const e=sentinel();e.introStarted=true;e.introTime=t;render();return canvas.toDataURL('image/png');},
 place(scale){const e=sentinel(),right=KaijuRig.hitbox(scale,p.x,G).x1-p.x,gap=10/(sceneZoom*zoom*.8)+14;e.x=p.x+right+Math.max(0,-SentinelBoss.leftEdge(e))+gap;},
 combat(kind,t,hpRatio=1){const e=sentinel();e.hp=e.max*hpRatio;e.introDone=true;e.beamTime=kind==='beam'?t:null;e.meleeTime=kind==='beam'?null:t;e.meleeKind=kind;this.place(BS);render();return canvas.toDataURL('image/png');},
 impact(kind,scale){const e=sentinel();e.introDone=true;e.cd=999;e.beamTime=kind==='beam'?SentinelBoss.BEAM.charge-.01:null;e.beamHit=false;e.beamImpactCd=0;e.meleeTime=kind==='beam'?null:0;e.meleeKind=kind;BS=scale;rigState=KaijuRig.pose(p,time);SK=scaleRig(rigState,BS,p.x,G);this.place(scale);p.recoil=0;p.stagger=0;shake=0;hitFlash=0;particles=[];rings=[];updateSentinel(e,kind==='beam'?.02:SentinelBoss.meleeSpec(e).hit+.01);render();return canvas.toDataURL('image/png');}
 };})();`);
 await w.webContents.executeJavaScript(source);
 await w.webContents.executeJavaScript('showcase.ready.then(()=>{showcase.setup();return true;})');
 const save=(name,url)=>fs.writeFileSync(path.join(/^(attack-)?\d/.test(name)?frames:out,name),Buffer.from(url.split(',')[1],'base64'));
 for(let i=0;i<170;i++){
  const png=await w.webContents.executeJavaScript('showcase.frame()');save(String(i).padStart(3,'0')+'.png',png);if(i===43)save('cutin.png',png);
  if(i===43||i===169){const hidden=await w.webContents.executeJavaScript("getComputedStyle(document.querySelector('.camera-top')).visibility==='hidden'");if(hidden!==(i===43))throw new Error('Title film did not hide/restore broadcast overlays');}
 }
 const moves=await w.webContents.executeJavaScript('SentinelBoss.MELEES.map(m=>({id:m.id,duration:m.duration})).concat([{id:"beam",duration:SentinelBoss.BEAM.duration}])');
 let frame=0;for(const m of moves)for(let t=0;t<m.duration+.25;t+=.05)save('attack-'+String(frame++).padStart(3,'0')+'.png',await w.webContents.executeJavaScript(`showcase.combat(${JSON.stringify(m.id)},${Math.min(t,m.duration)})`));
 save('beam.png',await w.webContents.executeJavaScript("showcase.combat('beam',1.8,.64)"));
 save('combat.png',await w.webContents.executeJavaScript("showcase.combat('cross',.72,.64)"));
 save('impact-small.png',await w.webContents.executeJavaScript("showcase.impact('beam',.34)"));
 save('impact-large.png',await w.webContents.executeJavaScript("showcase.impact('beam',1.5)"));
 save('impact-melee.png',await w.webContents.executeJavaScript("showcase.impact('cross',.34)"));
 const sheet=await w.webContents.executeJavaScript(`(async()=>{
 const c=document.createElement('canvas');c.width=1500;c.height=1100;const g=c.getContext('2d');g.imageSmoothingEnabled=false;
 const r=new SentinelBoss.Renderer(Image);await r.loaded;g.fillStyle='#152733';g.fillRect(0,0,c.width,c.height);
 const moves=[...SentinelBoss.MELEES,{id:'beam',name:'十字光线',hit:1.8}];
 moves.forEach((m,i)=>{const x=(i%3)*500+280,y=Math.floor(i/3)*550+460;g.fillStyle='#314751';g.fillRect(i%3*500,y,500,5);
 const e={x,state:'alive',introDone:true,phase:0,cd:3,meleeTime:m.id==='beam'?null:m.hit,meleeKind:m.id,beamTime:m.id==='beam'?m.hit:null};
 const p=r.draw(g,e,0,y);if(m.id==='beam'){g.fillStyle='#9cdfee';g.fillRect(i%3*500,p.muzzle.y-8,p.muzzle.x-i%3*500,16);g.fillStyle='#fff6ce';g.fillRect(i%3*500,p.muzzle.y-3,p.muzzle.x-i%3*500,6);}
 g.font='bold 26px sans-serif';g.textAlign='center';g.fillStyle='#ffe1a6';g.fillText(m.name,i%3*500+250,y+48);});
 return c.toDataURL('image/png');})()`);
 save('moves.png',sheet);
 const stages=await w.webContents.executeJavaScript(`(async()=>{
 const c=document.createElement('canvas');c.width=1500;c.height=2750;const g=c.getContext('2d');g.imageSmoothingEnabled=false;
 const r=new SentinelBoss.Renderer(Image);await r.loaded;g.fillStyle='#152733';g.fillRect(0,0,c.width,c.height);
 SentinelBoss.MELEES.forEach((m,row)=>[m.hit*.65,m.hit,m.duration*.87].forEach((t,col)=>{
 const x=col*500+290,y=row*550+460;g.fillStyle='#314751';g.fillRect(col*500,y,500,5);
 r.draw(g,{x,state:'alive',introDone:true,phase:0,cd:3,meleeTime:t,meleeKind:m.id},0,y);
 g.font='bold 24px sans-serif';g.textAlign='center';g.fillStyle='#ffe1a6';g.fillText(m.name+' / '+['蓄势','出手','收势'][col],col*500+250,y+48);
 }));return c.toDataURL('image/png');})()`);
 save('stages.png',stages);
 if(errors.length)throw new Error(errors.join('\n'));
 console.log(JSON.stringify({frames,out,entranceFrames:170,attackFrames:frame,errors}));app.quit();
}).catch(err=>{console.error(err);app.exit(1)});
