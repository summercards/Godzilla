/* Cabinet preferences are separate from creature progress. */
(()=>{'use strict';
document.documentElement.style.setProperty('--neon-right-controls',`url("${window.KaijuAssets.TV_SKINS.neon.controls}")`);
const root=document.documentElement,key='gnn-tv-skin',valid=new Set(['classic','neon']);
function apply(skin){skin=valid.has(skin)?skin:'neon';root.dataset.tvSkin=skin;document.querySelectorAll('[data-tv-skin-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tvSkinChoice===skin)));}
async function choose(skin){if(!valid.has(skin))return;try{if(window.__tvSkin){const saved=await window.__tvSkin.set(skin);apply(saved);}else{localStorage.setItem(key,skin);apply(skin);}}catch{document.getElementById('skinStatus').textContent='皮肤保存失败，请重试';}}
const settings=document.createElement('article');settings.className='tv-skin-settings';settings.innerHTML='<h3>电视外观</h3><div class="tv-skin-options"><button type="button" data-tv-skin-choice="classic" aria-pressed="false"><i class="skin-preview classic"><span></span></i><b>研究所终端</b><small>深蓝 · 金色饰边</small></button><button type="button" data-tv-skin-choice="neon" aria-pressed="false"><i class="skin-preview neon"><span></span></i><b>霓虹特摄</b><small>粉色灯带 · 双旋钮</small></button></div><p id="skinStatus">选择后立即更换，下次打开自动保留。</p>';
document.getElementById('settingsPanel').prepend(settings);settings.querySelectorAll('button').forEach(b=>b.onclick=()=>choose(b.dataset.tvSkinChoice));
const sidebar=document.querySelector('.tv-sidebar');
const extra=document.createElement('div');extra.className='skin-extra-buttons';extra.innerHTML='<button type="button" class="skin-feature" aria-label="切换电视节目"><span>▦</span>特集</button><button type="button" class="skin-settings" aria-label="打开电视外观设置"><span>⚙</span>设置</button><div class="skin-speaker-grid" aria-hidden="true"></div>';sidebar.append(extra);
const openSettings=()=>window.__tvHost?window.__tvHost.openPanel('settings'):window.__growth.open('settings');
extra.querySelector('.skin-settings').onclick=openSettings;extra.querySelector('.skin-feature').onclick=()=>document.getElementById('chan-cycle').click();
const controls=document.createElement('aside');controls.className='skin-right';controls.setAttribute('aria-label','电视旋钮');controls.innerHTML='<div class="skin-power-lamp" aria-hidden="true"></div><button class="skin-square" aria-label="电视外观设置"></button><button class="skin-dial" aria-label="转台" title="转台"></button><button class="skin-dial sound-dial" aria-label="切换现场声音" title="切换现场声音"></button><div class="skin-speaker-slots" aria-hidden="true"></div><div class="skin-trio" aria-hidden="true"><i></i><i></i><i></i></div>';
document.querySelector('.tv-body').append(controls);controls.querySelector('.skin-square').onclick=openSettings;controls.querySelector('.skin-dial').onclick=()=>document.getElementById('chan-cycle').click();controls.querySelector('.sound-dial').onclick=()=>document.getElementById('sound').click();
if(window.__tvSkin){window.__tvSkin.subscribe(apply);window.__tvSkin.get().then(apply).catch(()=>apply('neon'));}else{try{apply(localStorage.getItem(key)||'neon');}catch{apply('neon');}window.addEventListener('storage',e=>{if(e.key===key)apply(e.newValue);});}
const feet=document.createElement('div');feet.className='skin-feet';feet.setAttribute('aria-hidden','true');document.querySelector('.tv-cabinet').append(feet);
window.TVSkins={choose,apply};
})();
