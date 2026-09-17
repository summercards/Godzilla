'use strict';
// Isolated product capture: no real profile, save, or installed application.
const {app,BrowserWindow,protocol}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const TV=path.resolve(__dirname,'../tv'),OUT=path.resolve(__dirname,'../../outputs');
app.setPath('userData',path.join(OUT,'optimization-probe-profile'));
app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([{scheme:'review',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const errors=[],results=[];
const hook=`window.__review={openTab:openPanel,async city(d){debugFrozen=true;data.district=d;generateWorld();await skeleton.loaded;await fins.loaded;time=0;camera=cameraTarget();sceneZoom=cameraScale();hud();render();return canvas.toDataURL('image/png');},async panel(level){data.level=level;data.auto=false;data.energy=10000;data.assign=12;data.talent=12;data.dna=12;data.talents={};data.morph={spikes:0,spikeScale:1};renderGrowthPanels();hud();await skeleton.loaded;await fins.loaded;return true;}};`;
app.whenReady().then(async()=>{
 protocol.handle('review',req=>{const u=new URL(req.url),rel=decodeURIComponent(u.pathname).replace(/^\//,'')||'index.html',p=path.resolve(TV,rel);if(!p.startsWith(TV+path.sep))return new Response('',{status:403});let content=fs.readFileSync(p);if(rel==='game.js'){let s=content.toString().replace(/\}\)\(\);\s*$/,hook+'})();');s=`window.__tvBridge={storage:{getItem:()=>JSON.stringify({version:4,seed:12345,level:15,auto:false,muted:true,lastSeen:Date.now(),morph:{}}),setItem(){}},register(){}};\n`+s;content=Buffer.from(s);}return new Response(content,{headers:{'content-type':({'.js':'application/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.woff2':'font/woff2'})[path.extname(p)]||'application/octet-stream'}});});
 const windows=[];
 async function open(w,h,panel){const win=new BrowserWindow({show:false,width:w,height:h,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});windows.push(win);win.webContents.on('console-message',e=>{if(e.level==='error'||e.level===3)errors.push(e.message);});await win.loadURL('review://local/index.html'+(panel?'?panel=1':''));await win.webContents.executeJavaScript('document.fonts.ready');return win;}
 const run=(win,s)=>win.webContents.executeJavaScript(s);
 const wait=(win)=>run(win,'new Promise(r=>setTimeout(r,700))');
 async function capture(win,name){await wait(win);fs.writeFileSync(path.join(OUT,name+'.png'),(await win.webContents.capturePage()).toPNG());}
 try{
  const tv=await open(1280,850,false);
  for(const [d,name] of [[1,'osaka'],[6,'tokyo'],[11,'newyork']]){const png=await run(tv,`window.__review.city(${d})`);fs.writeFileSync(path.join(OUT,'chapter-'+name+'.png'),Buffer.from(png.split(',')[1],'base64'));}
  const panel=await open(620,1000,true);
  // Include the production panel-only/readability injection, not just file CSS.
  const cfg=require('../tv-config.js');await panel.webContents.insertCSS(cfg.PANEL_ONLY_CSS);await panel.webContents.insertCSS(cfg.PANEL_READABLE_CSS);
  for(const level of [1,14,15,50]){await run(panel,`window.__review.panel(${level})`);await wait(panel);const probe=await run(panel,`(()=>{const c=document.getElementById('assignHologram');return {level:${level},...c.dataset,visible:getComputedStyle(c).display,overflow:document.getElementById('growthContent').scrollWidth>document.getElementById('growthContent').clientWidth};})()`);results.push(probe);assert.equal(probe.rigReady,'true');assert.equal(Number(probe.spines),level<15?0:level===15?2:4);assert.notEqual(probe.visible,'none');await capture(panel,'monitor-L'+level);}
  // Real panel forwarding into the authority TV, then syncing payload back.
  await run(tv,`window.__review.panel(15)`);
  await run(panel,`window.__growth.sync(${JSON.stringify(await run(tv,'window.__growth.snapshot()'))});window.__panelHost={command:c=>window.__lastCommand=c};document.getElementById('assign-power').click();`);
  const command=await run(panel,'window.__lastCommand');assert.equal(command.id,'assign-power');
  await run(tv,`window.__growth.command(${JSON.stringify(command)})`);
  await run(panel,`window.__growth.sync(${JSON.stringify(await run(tv,'window.__growth.snapshot()'))})`);
  const assigned=await run(panel,`({lv:document.getElementById('alv-power').textContent,lit:document.querySelectorAll('#asegments-power .lit').length,html:document.getElementById('asegments-power').innerHTML})`);results.push({assigned});assert.match(assigned.lv,/02/);
  await run(panel,`window.__review.openTab('talent')`);await capture(panel,'talent-tree');
  await run(panel,`document.getElementById('talent-mass').focus()`);await capture(panel,'talent-tooltip');
  await run(panel,`document.getElementById('skillsPanel').scrollIntoView({block:'start'})`);await capture(panel,'skill-learning');
  await run(panel,`window.__review.openTab('settings')`);await capture(panel,'settings-reset');
  await run(panel,`window.__review.openTab('assign');document.getElementById('assignCards').scrollIntoView({block:'start'})`);await capture(panel,'horizontal-assign');
  for(const width of [420,520]){panel.setSize(width,850);await wait(panel);const r=await run(panel,`({width:${width},overflow:document.getElementById('growthContent').scrollWidth>document.getElementById('growthContent').clientWidth})`);results.push(r);assert.equal(r.overflow,false);}
  assert.deepEqual(errors,[]);console.log('PASS product chapters, monitor L1/L14/L15/L50, panel command forwarding, narrow layouts');
 }catch(e){errors.push(e.stack||String(e));process.exitCode=1;}finally{fs.writeFileSync(path.join(OUT,'optimization-visual.json'),JSON.stringify({results,errors},null,2));for(const w of windows)w.destroy();app.exit(process.exitCode||0);}
});
