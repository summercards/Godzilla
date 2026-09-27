/* Research station presentation. Commands still go through the authoritative game window. */
(()=>{'use strict';
const $=id=>document.getElementById(id),P=window.IdleProgression;
for(const [key,path] of Object.entries(window.KaijuAssets.LAB_ART))document.documentElement.style.setProperty('--lab-'+key,`url("${path}")`);
const symbols={home:'M2 11 12 2l10 9h-4v11h-5v-7h-3v7H5V11Z',stats:'M3 15h4v7H3zm7-7h4v14h-4zm7-6h4v20h-4z',star:'m12 1 3 7 8 1-6 5 2 9-7-5-7 5 2-9-6-5 8-1Z',dna:'M5 1h3v4l8 5 3 5v8h-3v-7L8 11 5 7Zm11 0h3v6l-3 4-8 5v7H5v-8l3-4 8-6ZM8 2h8v2H8Zm0 18h8v2H8Z',book:'M2 3h8l2 2 2-2h8v18h-8l-2 2-2-2H2Zm3 3v12h5V6Zm9 0v12h5V6Z',eye:'M1 12 6 5h12l5 7-5 7H6Zm8-4v8h6V8Z',gear:'M9 1h6l1 4 4 1 3 5-3 3-1 5-5 3-3-3-5-1-3-5 3-3 1-5Zm0 8v6h6V9Z',bolt:'M14 1 3 14h7l-1 9 12-14h-8Z',arrow:'m8 3 10 9-10 9-3-4 6-5-6-5Z',shield:'M3 3 12 0l9 3v11l-9 10-9-10Zm4 3v7l5 6 5-6V6l-5-2Z'};
const icon=(name)=>`<svg class="lab-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${symbols[name]||symbols.star}"/></svg>`;
document.querySelector('.brand-mark').innerHTML=icon('shield')+'<div><b>怪兽研究所</b><small>KAIJU LAB · FIELD TERMINAL</small></div><span>01</span>';
document.querySelector('.pb-tx').textContent='研究所';
$('open-assign').onclick=()=>window.__growth.open('overview');
document.querySelector('footer').innerHTML='<span>● 信号稳定</span><span>怪兽都市 / 实时观测</span><span>LAB–01</span>';
if(!document.documentElement.classList.contains('panel-view'))return;
const management=$('management'),content=$('growthContent');
management.classList.add('lab-management');
const mast=document.createElement('div');mast.className='lab-mast';
mast.innerHTML=`<div class="lab-brand">${icon('shield')}<div><b>怪兽研究所</b><small>观测 · 成长 · 无限进化</small></div></div><div class="lab-resources"></div><button class="lab-exit" data-close aria-label="关闭研究所">×</button>`;
management.prepend(mast);mast.querySelector('.lab-resources').append($('energy').parentElement,$('dna').parentElement,$('level').parentElement);
const title=$('panelTitle');title.parentElement.querySelector('.section-kicker').textContent='KAIJU RESEARCH DIVISION';
$('saveState').hidden=true;$('closePanel').textContent='返回电视';
const nav=document.createElement('nav');nav.className='lab-nav';nav.setAttribute('aria-label','研究所导航');
const pages=[['overview','总览','home'],['assign','加点','stats'],['analysis','分析','eye'],['talent','天赋','star'],['evo','变异','dna'],['codex','图鉴','book'],['nurture','培育','bolt'],['settings','设置','gear']];
nav.innerHTML=pages.map(([key,label,s])=>`<button data-page="${key}" aria-label="${label}">${icon(s)}<span>${label}</span></button>`).join('');management.append(nav);
const body=document.createElement('div');body.className='lab-body';content.prepend(body);
const hero=document.createElement('aside');hero.className='lab-hero';hero.innerHTML=`<div class="hero-label"><span>SPECIMEN 01</span><b>巨兽成长档案</b></div><div class="hero-name"><small>当前成长阶段</small><h2 data-form></h2><span data-level></span></div><div class="hero-actions"><button data-page="assign">${icon('stats')}<span>强化<small>分配成长点数</small></span></button><button data-page="talent">${icon('star')}<span>天赋<small>塑造战斗风格</small></span></button><button data-page="evo">${icon('dna')}<span>变异<small>探索新的形态</small></span></button></div>`;body.append(hero);
const work=document.createElement('div');work.className='lab-work';body.append(work);
for(const id of ['assignPanel','talentPanel','evoPanel','settingsPanel','newsPanel','statsPanel'])work.append($(id));
// The live rig is shared by every research page, rather than an illustrated substitute.
const monitor=$('assignPanel').querySelector('.monster-monitor');monitor.hidden=false;
hero.insertBefore(monitor,hero.querySelector('.hero-actions'));
$('assignHologram').width=720;$('assignHologram').height=560;
new ResizeObserver(()=>{const c=$('assignHologram');if(c.clientWidth>20&&c.clientHeight>20){const height=Math.round(720*c.clientHeight/c.clientWidth);if(c.height!==height){c.height=height;window.__growth.refreshHologram();}}}).observe($('assignHologram'));
monitor.querySelector('.monitor-caption').textContent='实时骨骼投影 · 部位引线追踪 · 自适应显示比例';
const overview=document.createElement('section');overview.id='labOverview';overview.className='lab-page';work.prepend(overview);
overview.innerHTML=`<article class="lab-card specimen"><div class="card-heading"><span>生体观测档案</span><b class="tag">已连接</b></div><div class="specimen-head"><div class="portrait"></div><div><div class="stars">★ ★ ★ <span>★ ★</span></div><h2 data-form></h2><p data-level></p></div></div><div class="lab-tags"><span>◆ 巨兽</span><span data-element>原子</span><span>持续成长</span></div><div class="xp-label"><span>成长经验</span><b data-xp></b></div><div class="lab-meter"><i data-xp-fill></i></div><div class="specimen-stats" data-stats></div><button class="lab-link" data-page="analysis">详细分析 ››</button></article><article class="lab-card"><div class="card-heading">下一步行动 <span>RESEARCH</span></div><div data-actions></div></article><article class="lab-card evolution-preview"><div class="card-heading">下一阶段 <b>进化预览</b></div><div class="evolution-flow"><div class="portrait"></div><span>› › ›</span><div class="evolution-silhouette"></div><div><h3 data-next></h3><p data-next-hint></p><button class="lab-link" data-page="nurture">查看成长条件 ››</button></div></div></article>`;
const extra=document.createElement('section');extra.className='lab-page lab-extra';extra.hidden=true;work.append(extra);
overview.querySelector('.stars').textContent='KAIJU / 生体档案';
overview.querySelector('.tag').textContent=window.__panelHost||window.opener?'实时同步':'本地预览';
const evo=$('evoPanel'),prob=document.createElement('div');prob.className='lab-card mutation-prob';prob.innerHTML='<div class="card-heading">变异概率 <span>实际权重</span></div><div data-probabilities></div><p>每次消耗 1 次进化机会。结果会影响外观或成长属性。</p>';evo.append(prob);$('rollEvo').textContent='开始变异';
// Preview assignments before committing; the original buttons remain for energy purchases.
const plan=document.createElement('section');plan.className='lab-card allocation-plan';plan.innerHTML='<div class="card-heading">属性加点 <span>当前值 → 预览值</span></div><div data-plan-rows></div><div class="plan-footer"><span data-plan-count></span><button data-plan-reset>重置方案</button><button class="gold" data-plan-apply>✓ 确认加点</button></div><p class="plan-feedback" role="status" aria-live="polite"></p>';$('assignPanel').prepend(plan);
const talentDetail=document.createElement('aside');talentDetail.className='lab-card talent-detail';$('talentPanel').append(talentDetail);
const talentReset=$('talentReset');
P.TALENT_NODES.forEach((n,i)=>{const art=$('talent-'+n.id).querySelector('svg');art.classList.add('has-art');art.style.backgroundImage='var(--lab-talent_icons)';art.style.backgroundSize='600% 300%';art.style.backgroundPosition=(i%6)*20+'% '+Math.floor(i/6)*50+'%';art.style.backgroundRepeat='no-repeat';});
const talentSpecimen=document.createElement('div');talentSpecimen.className='talent-specimen';hero.prepend(talentSpecimen);
let page='overview',pending={},last='',applying=false,selectedTalent='spines';
const snapshot=()=>JSON.parse(window.__growth.snapshot());
const stats=e=>({power:Math.round(e.power()),atomic:Math.round(e.atomic()),metabolism:e.passive().toFixed(1)+'/秒',stride:Math.round(e.speed())});
const send=(id)=>{if(window.__panelHost)window.__panelHost.command({id});else if(window.opener?.__growth)window.opener.__growth.command({id});};
function show(key,fromGame=false){
 if(key==='overview'&&page!==key)$('assignHologram').dataset.scanStart=String(performance.now()/1000);
 page=key;management.dataset.page=key;overview.hidden=key!=='overview';extra.hidden=!['analysis','codex','nurture'].includes(key);
 for(const id of ['assign','talent','evo','settings','news','stats'])$(id+'Panel').hidden=id!==key;
 document.querySelectorAll('.lab-nav button').forEach(b=>{b.setAttribute('aria-current',b.dataset.page===key?'page':'false');});
 title.textContent=({overview:'巨兽研究档案',assign:'属性强化',analysis:'成长分析',talent:'天赋树',evo:'变异实验室',codex:'怪兽图鉴',nurture:'培育计划',settings:'研究所设置'})[key];
 if(!fromGame&&['assign','talent','evo','settings'].includes(key)) originalOpen(key);
 content.scrollTop=0;last='';refresh();window.__growth.refreshHologram?.();
}
const originalOpen=window.__growth.open;window.__growth.open=key=>show(pages.some(p=>p[0]===key)?key:'overview');
const originalSync=window.__growth.sync;window.__growth.sync=payload=>{originalSync(payload);refresh();};
function refresh(){
 const d=snapshot(),sig=JSON.stringify([d,pending,page]);if(sig===last)return;last=sig;
 const e=new P.Economy(d),values=stats(e),stage=e.epoch(),next=P.EPOCHS[e.epochIndex()+1],fmt=n=>Number(n).toLocaleString('zh-CN');
 if(page==='talent'){
  const n=P.TALENT_BY_ID[selectedTalent],lv=d.talents[n.id]||0,unlocked=e.ringUnlocked(n.ring),ringIndex=P.TALENT_RINGS.findIndex(r=>r.key===n.ring),col=n.color||['#66d7ff','#fb638b','#ffd476'][ringIndex];
  document.querySelectorAll('.talent-node').forEach(b=>b.classList.toggle('selected',b.id==='talent-'+n.id));
  const node=$('talent-'+n.id),art=node.querySelector('svg').outerHTML;
  talentDetail.style.setProperty('--detail-color',col);
  talentDetail.innerHTML=`<div class="talent-detail-head">${art}<div><h2>${n.name}</h2><p>Lv.${lv} <span>/ 3</span></p></div></div><div class="detail-tag">${P.TALENT_RINGS[ringIndex].name}</div><p class="detail-description">${n.desc}</p><section><h3>当前等级</h3><p>${lv?'已投入 '+lv+' 点，效果已生效':'尚未学习'}</p></section><section><h3>下一等级</h3><p>${lv>=3?'已达到最高等级':'提升至 Lv.'+(lv+1)+' / 3'}</p><p>${unlocked?'本环已开放，可自由选择节点':'解锁条件：上一环累计投入 '+P.RING_GATE[ringIndex]+' 点'}</p></section><section><h3>学习消耗</h3><div class="talent-cost">${icon('star')}<b>1</b><span>天赋点 · 持有 ${d.talent}</span></div></section><button class="talent-learn" data-learn ${!unlocked||lv>=3||!d.talent?'disabled':''}>↑ ${lv>=3?'已满级':!unlocked?'尚未解锁':!d.talent?'天赋点不足':'学习'}</button>`;
  talentDetail.append(talentReset);
  talentSpecimen.innerHTML=`<div class="portrait"></div><h2>${stage.name}</h2><p>Lv.${d.level} <span>/ 100</span></p><div class="lab-meter"><i style="width:${Math.min(100,d.xp/e.nextXP()*100)}%"></i></div><div class="lab-tags"><span>巨兽</span><span>成长型</span></div><div class="talent-spec-stats">${Object.entries(P.STATS).map(([k,s])=>`<div><span>${s.name}</span><b>${values[k]}</b></div>`).join('')}</div><button class="lab-link" data-page="overview">‹ 返回总览</button>`;
 }
 management.querySelectorAll('[data-form]').forEach(x=>x.textContent=stage.name);management.querySelectorAll('[data-level]').forEach(x=>x.textContent='Lv.'+d.level+' / 100');
 overview.querySelector('[data-xp]').textContent=Math.floor(d.xp)+' / '+e.nextXP();overview.querySelector('[data-xp-fill]').style.width=Math.min(100,d.xp/e.nextXP()*100)+'%';
 overview.querySelector('[data-stats]').innerHTML=Object.entries(P.STATS).map(([k,s])=>`<div>${icon(k==='atomic'?'bolt':k==='stride'?'arrow':'stats')}<span>${s.name}</span><b>${values[k]}</b></div>`).join('');
 overview.querySelector('[data-actions]').innerHTML=[['assign','成长点数',d.assign+' 点可分配','stats'],['talent','天赋研究',d.talent+' 点可学习','star'],['evo','基因重组',d.evoRolls+' 次变异机会','dna']].map(([key,name,value,s])=>`<button class="action-row" data-page="${key}">${icon(s)}<span>${name}<small>${value}</small></span><b>›</b></button>`).join('');
 overview.querySelector('[data-next]').textContent=next?next.name+' · Lv.'+next.min:'终极成长阶段';overview.querySelector('[data-next-hint]').textContent=next?'达到 '+next.min+' 级后进入下一成长阶段':'继续通过天赋和变异强化巨兽';
 const trial=new P.Economy(d);for(const [k,n]of Object.entries(pending))for(let i=0;i<n;i++)trial.assignPoint(k);const preview=stats(trial),used=Object.values(pending).reduce((a,b)=>a+b,0);
 plan.querySelector('[data-plan-rows]').innerHTML=Object.entries(P.STATS).map(([k,s])=>`<div class="plan-row"><span>${icon(k==='atomic'?'bolt':'stats')}${s.name}</span><b>${values[k]}</b><button data-minus="${k}" aria-label="减少${s.name}" ${!pending[k]?'disabled':''}>−</button><strong>${pending[k]||0}</strong><button data-plus="${k}" aria-label="增加${s.name}" ${used>=d.assign||d.levels[k]+(pending[k]||0)>=500?'disabled':''}>+</button><span>››</span><b class="preview-value">${preview[k]}</b></div>`).join('');
 plan.querySelector('[data-plan-count]').textContent='剩余点数 '+Math.max(0,d.assign-used);plan.querySelector('[data-plan-apply]').disabled=!used||used>d.assign||applying;
 prob.querySelector('[data-probabilities]').innerHTML=P.RARITY.map(r=>`<div class="prob-row" style="--prob:${r.color}"><span>${r.name}</span><div><i style="width:${r.weight}%"></i></div><b>${r.weight}%</b></div>`).join('');
 if(page==='analysis')extra.innerHTML=`<article class="lab-card"><div class="card-heading">成长分析 <b>Lv.${d.level}</b></div><div class="analysis-grid">${Object.entries(P.STATS).map(([k,s])=>`<section><small>${s.name}</small><h2>${values[k]}</h2><div class="lab-meter"><i style="width:${Math.min(100,d.levels[k]/5)}%"></i></div><p>强化等级 ${d.levels[k]} / 500</p></section>`).join('')}</div></article><article class="lab-card"><div class="card-heading">区域探索</div><div class="analysis-grid"><section><small>当前区域</small><h2>${d.district}</h2></section><section><small>累计破坏</small><h2>${fmt(d.cleared)}</h2></section><section><small>击破单位</small><h2>${fmt(d.kills)}</h2></section><section><small>前进距离</small><h2>${fmt(Math.floor(d.meters))} m</h2></section></div></article>`;
 if(page==='codex')extra.innerHTML=`<article class="lab-card"><div class="card-heading">成长形态图鉴 <span>随等级解锁</span></div><div class="codex-grid">${P.EPOCHS.map((ep,i)=>`<div class="codex-card ${i>e.epochIndex()?'unrevealed':''}"><div class="portrait"></div><h3>${ep.name}</h3><p>${i<=e.epochIndex()?'已记录':'待解锁'}</p></div>`).join('')}</div></article><article class="lab-card"><div class="card-heading">已发现变异</div><p>${d.mutations.length?d.mutations.map(id=>P.MUTATION_BY_ID[id]?.name||id).join(' · '):'尚未发现变异，升级后可在变异实验室探索。'}</p></article>`;
 if(page==='nurture')extra.innerHTML=`<article class="lab-card"><div class="card-heading">培育计划 <b>持续成长</b></div><h2>让每次进化都有方向</h2><p>破坏建筑与击败敌人获得经验；升级后领取加点、天赋和变异机会。</p><div class="care-grid"><button data-page="assign">${icon('stats')}<b>属性强化</b><small>${d.assign} 点待分配</small></button><button data-page="talent">${icon('star')}<b>天赋塑形</b><small>${d.talent} 点待学习</small></button><button data-page="evo">${icon('dna')}<b>随机变异</b><small>${d.evoRolls} 次待探索</small></button></div><p>自动核能强化可在「加点」页开启，并选择偏好的成长路线。</p></article>`;
}
management.addEventListener('click',event=>{
 const b=event.target.closest('button');if(!b)return;
 if(b.hasAttribute('data-close')){$('closePanel').click();return;}
 if(b.dataset.page){show(b.dataset.page);return;}
 if(b.hasAttribute('data-learn')){const e=new P.Economy(snapshot()),n=P.TALENT_BY_ID[selectedTalent];if(e.data.talent>0&&e.ringUnlocked(n.ring)&&(e.data.talents[n.id]||0)<3){send('talent-'+n.id);b.disabled=true;b.textContent='正在同步…';}return;}
 if(b.dataset.plus){pending[b.dataset.plus]=(pending[b.dataset.plus]||0)+1;refresh();plan.querySelector(`[data-plus="${b.dataset.plus}"]`)?.focus({preventScroll:true});}
 if(b.dataset.minus){pending[b.dataset.minus]=Math.max(0,(pending[b.dataset.minus]||0)-1);refresh();plan.querySelector(`[data-minus="${b.dataset.minus}"]`)?.focus({preventScroll:true});}
 if(b.hasAttribute('data-plan-reset')){pending={};refresh();}
 if(b.hasAttribute('data-plan-apply')){
  if(!window.__panelHost&&!window.opener?.__growth){plan.querySelector('.plan-feedback').textContent='请从电视的「研究所」入口打开，以保存加点。';return;}
  const used=Object.values(pending).reduce((a,b)=>a+b,0);if(used>snapshot().assign)return;
  applying=true;for(const [k,n]of Object.entries(pending))for(let i=0;i<n;i++)send('assign-'+k);
  pending={};plan.querySelector('.plan-feedback').textContent='加点指令已提交，正在同步成长数据。';setTimeout(()=>{applying=false;refresh();},600);
 }
});
nav.addEventListener('keydown',ev=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(ev.key))return;const buttons=[...nav.querySelectorAll('button')],i=buttons.indexOf(document.activeElement);if(i<0)return;ev.preventDefault();buttons[ev.key==='Home'?0:ev.key==='End'?buttons.length-1:(i+(ev.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length].focus();});
function inspectTalent(button){selectedTalent=button.id.slice(7);last='';refresh();}
window.addEventListener('click',ev=>{const button=ev.target.closest?.('.talent-node');if(!button)return;ev.preventDefault();ev.stopImmediatePropagation();inspectTalent(button);},true);
$('talentRings').addEventListener('focusin',ev=>{const button=ev.target.closest?.('.talent-node');if(button)inspectTalent(button);});
window.LabUI={show,refresh,selected:key=>show(key,true)};show('overview');window.__growth.refreshHologram();setInterval(()=>{if(!document.hidden)refresh();},500);
})();
