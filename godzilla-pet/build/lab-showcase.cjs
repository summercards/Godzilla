const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const C=require('../tv-config.js');
const assert=require('node:assert/strict');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'kaiju-lab-')));
const out=path.join(__dirname,'../../doc/lab-redesign');fs.mkdirSync(out,{recursive:true});
app.whenReady().then(async()=>{
 const errors=[],w=new BrowserWindow({show:false,width:1440,height:900,webPreferences:{backgroundThrottling:false}});w.showInactive();
 w.webContents.on('console-message',ev=>{if(ev.level==='error'||ev.level===3)errors.push(ev.message);});
 await w.loadFile(path.join(__dirname,'../tv/index.html'),{query:{panel:'1'}});
 await w.webContents.insertCSS(C.PANEL_ONLY_CSS);await w.webContents.insertCSS(C.PANEL_READABLE_CSS);
 await w.webContents.executeJavaScript('Promise.all([document.fonts.ready,...[...document.images].map(i=>i.decode().catch(()=>{}))]).then(()=>true)');
 await new Promise(r=>setTimeout(r,1000));
 for(const page of ['overview','assign','talent','evo','analysis','codex','nurture','settings']){
  console.log(await w.webContents.executeJavaScript(`LabUI.show('${page}');JSON.stringify({page:document.getElementById('management').dataset.page,hidden:document.getElementById('labOverview').hidden,title:document.getElementById('panelTitle').textContent})`));
  if(page==='overview'){await new Promise(r=>setTimeout(r,1350));await w.webContents.executeJavaScript("document.getElementById('assignHologram').dataset.scanStart=String(performance.now()/1000-1.55);true");await new Promise(r=>setTimeout(r,200));fs.writeFileSync(path.join(out,'overview-scan.png'),(await w.webContents.capturePage()).toPNG());}
  await new Promise(r=>setTimeout(r,page==='overview'?4950:600));
  fs.writeFileSync(path.join(out,page+'.png'),(await w.webContents.capturePage()).toPNG());
 }
 const checks=await w.webContents.executeJavaScript(`(()=>{LabUI.show('assign');return {viewport:[innerWidth,innerHeight],overflow:document.documentElement.scrollWidth>innerWidth,nav:[...document.querySelectorAll('.lab-nav button')].map(b=>({name:b.textContent,visible:b.getBoundingClientRect().bottom<=innerHeight})),pages:document.querySelectorAll('.lab-nav button').length};})()`);
 assert.equal(checks.overflow,false);assert.ok(checks.nav.every(n=>n.visible));
 const hologram=await w.webContents.executeJavaScript(`LabUI.show('overview');new Promise(resolve=>setTimeout(()=>{const c=document.getElementById('assignHologram');resolve({ready:c.dataset.rigReady,level:c.dataset.level,visible:c.getBoundingClientRect().width>0,portrait:getComputedStyle(document.documentElement).getPropertyValue('--lab-portrait').startsWith('url("data:image/png')})},500))`);
 assert.equal(hologram.ready,'true');assert.equal(hologram.level,'1');assert.ok(hologram.visible&&hologram.portrait);checks.hologram=hologram;
 await w.webContents.executeJavaScript(`window.__qaOriginal=__growth.snapshot();(()=>{const d=JSON.parse(__qaOriginal);d.level=65;d.morph.hue='crimson';d.talents.spines=3;__growth.sync(JSON.stringify(d));LabUI.show('overview')})()`);
 await new Promise(r=>setTimeout(r,1000));
 const grown=await w.webContents.executeJavaScript(`({...document.getElementById('assignHologram').dataset})`);
 assert.equal(grown.level,'65');assert.equal(grown.rigReady,'true');assert.ok(grown.skin.includes('ember'));assert.ok(Number(grown.spines)>0);
 fs.writeFileSync(path.join(out,'hologram-grown.png'),(await w.webContents.capturePage()).toPNG());checks.grown= grown;
 await w.webContents.executeJavaScript(`__growth.sync(__qaOriginal);true`);
 const assignment=await w.webContents.executeJavaScript(`(()=>{
 const d=JSON.parse(__growth.snapshot());d.assign=3;d.auto=false;__growth.sync(JSON.stringify(d));
 window.__sent=[];window.__panelHost={command:p=>__sent.push(p)};
 LabUI.show('assign');const click=s=>document.querySelector(s).click();
 click('[data-plus=power]');click('[data-plus=power]');click('[data-plus=power]');
 const budgetLocked=document.querySelector('[data-plus=atomic]').disabled;
 const previewChanged=document.querySelector('.preview-value').textContent!==document.querySelector('.plan-row>b').textContent;
 click('[data-plan-reset]');const resetLocked=document.querySelector('[data-plan-apply]').disabled;
 click('[data-plus=power]');click('[data-plus=atomic]');click('[data-plan-apply]');
 d.lastSeen=Date.now();localStorage.setItem('gnn-kaiju-idle-v3',JSON.stringify(d));
 return {budgetLocked,previewChanged,resetLocked,commands:__sent,baseline:d.levels};
 })()`);
 assert.ok(assignment.budgetLocked&&assignment.previewChanged&&assignment.resetLocked);
 assert.deepEqual(assignment.commands,[{id:'assign-power'},{id:'assign-atomic'}]);
 checks.assignment=assignment;
 const talent=await w.webContents.executeJavaScript(`(()=>{
 const d=JSON.parse(__growth.snapshot());d.talent=2;__growth.sync(JSON.stringify(d));window.__sent=[];LabUI.show('talent');
 document.getElementById('talent-cryo').click();const locked=document.querySelector('[data-learn]').disabled;
 document.getElementById('talent-spines').click();const noSpendOnSelection=__sent.length===0;
 document.querySelector('[data-learn]').click();d.lastSeen=Date.now();localStorage.setItem('gnn-kaiju-idle-v3',JSON.stringify(d));
 return {locked,noSpendOnSelection,commands:__sent};})()`);
 assert.ok(talent.locked&&talent.noSpendOnSelection);assert.deepEqual(talent.commands,[{id:'talent-spines'}]);checks.talent=talent;
 await w.setSize(640,760);await w.webContents.executeJavaScript("LabUI.show('assign');true");await new Promise(r=>setTimeout(r,200));fs.writeFileSync(path.join(out,'compact.png'),(await w.webContents.capturePage()).toPNG());
 for(const width of [960,1280,1560]){w.setSize(width,820);await new Promise(r=>setTimeout(r,150));for(const page of ['overview','assign','talent','evo','settings']){const fit=await w.webContents.executeJavaScript(`LabUI.show('${page}');(()=>{const b=document.querySelector('.lab-body');return b.scrollWidth<=b.clientWidth+1})()`);assert.ok(fit,'horizontal overflow: '+width+' '+page);}}
 await w.loadFile(path.join(__dirname,'../tv/index.html'));w.setSize(1120,736);await new Promise(r=>setTimeout(r,4500));
 const committed=await w.webContents.executeJavaScript(`(()=>{${[...assignment.commands,...talent.commands].map(p=>`__growth.command(${JSON.stringify(p)});`).join('')}return JSON.parse(__growth.snapshot())})()`);
 assert.equal(committed.assign,1);assert.equal(committed.levels.power,assignment.baseline.power+1);assert.equal(committed.levels.atomic,assignment.baseline.atomic+1);
 assert.equal(committed.talent,1);assert.equal(committed.talents.spines,1);
 checks.committed=true;fs.writeFileSync(path.join(out,'television.png'),(await w.webContents.capturePage()).toPNG());
 console.log(JSON.stringify({out,checks,errors}));app.exit(errors.length?1:0);
}).catch(e=>{console.error(e);app.exit(1);});
