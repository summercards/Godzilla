// Production renderer QA using isolated storage. No player save mutation.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'boss-preview-')));
const tv=path.join(__dirname,'../tv'),out=path.join(__dirname,'../../doc'),frames=path.join(out,'boss-frames');
app.whenReady().then(async()=>{
 fs.mkdirSync(frames,{recursive:true});
 const w=new BrowserWindow({show:false,width:1440,height:700,webPreferences:{offscreen:true}});
 const errors=[];w.webContents.on('console-message',(_e,...args)=>{if(args[0]===3)errors.push(args[1]);});
 await w.loadFile(path.join(tv,'index.html'));
 await w.webContents.executeJavaScript('window.requestAnimationFrame=()=>0;void 0');
 const source=fs.readFileSync(path.join(tv,'game.js'),'utf8');
 const instrumented=source.replace(/\}\)\(\);\s*$/, `window.bossQA={renderer:sentinelRenderer,ready:Promise.all([sentinelRenderer.loaded,skeleton.loaded]),scene:()=>{p.x=4140;camera=cameraTarget();for(const b of buildings)if(b.x>3900&&b.x<4700){b.dead=true;b.collapse=3;}const boss=enemies.find(e=>e.type==='sentinel');boss.cd=.4;boss.announced=true;boss.introDone=true;rigState=KaijuRig.pose(p,0);BS=bodyScale();SK=scaleRig(rigState,BS,p.x,G);SM=SK.muzzle;render();return canvas.toDataURL('image/png');}};})();`);
 await w.webContents.executeJavaScript(instrumented);
 await w.webContents.executeJavaScript('window.bossQA.ready.then(()=>true)');
 const save=(name,data)=>fs.writeFileSync(path.join(out,name),Buffer.from(data.split(',')[1],'base64'));
 save('boss-in-game.png',await w.webContents.executeJavaScript('window.bossQA.scene()'));
 await w.webContents.executeJavaScript(`window.reviewCanvas=document.createElement('canvas');reviewCanvas.width=1760;reviewCanvas.height=640;window.bossFrame=(phase,contact=false)=>{const c=reviewCanvas,g=c.getContext('2d');g.imageSmoothingEnabled=false;g.fillStyle='#0b1928';g.fillRect(0,0,c.width,c.height);g.fillStyle='#263b46';g.fillRect(0,535,c.width,105);const render=(x,t,cd,state,age)=>bossQA.renderer.draw(g,{x,phase:t,cd,state,age,hp:1800,max:2200,hit:0},0,535);if(contact){['待机','举臂蓄力','发射','倒地'].forEach((label,i)=>{render(160+i*400,1,i===1?.5:i===2?0:3,i===3?'falling':'alive',i===3?1.3:0);g.fillStyle='#dfecf5';g.font='24px Pixel,monospace';g.textAlign='center';g.fillText(label,160+i*400,598);});}else{render(360,phase,5.2-phase%5.2,'alive',0);render(970,phase,3,'falling',phase%5.2<2.4?phase%5.2:2.4);g.fillStyle='#dfecf5';g.font='22px Pixel,monospace';g.fillText('待机 → 蓄力 → 发射',180,600);g.fillText('屈膝 → 倒地',840,600);}return c.toDataURL('image/png');};void 0;`);
 save('boss-preview.png',await w.webContents.executeJavaScript('bossFrame(0,true)'));
 for(let i=0;i<52;i++)save('boss-frames/'+String(i).padStart(3,'0')+'.png',await w.webContents.executeJavaScript(`bossFrame(${i/10})`));
 console.log(JSON.stringify({ready:await w.webContents.executeJavaScript('bossQA.renderer.ready'),frames:52,errors}));app.quit();
}).catch(e=>{console.error(e);app.exit(1)});
