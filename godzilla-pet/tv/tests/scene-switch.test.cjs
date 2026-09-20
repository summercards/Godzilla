const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const game=fs.readFileSync(path.join(__dirname,'../game.js'),'utf8');
const style=fs.readFileSync(path.join(__dirname,'../style.css'),'utf8');

/* 换场雪花（2026-09-20 按反馈加的，取代原来的硬切）。
 *
 * 观感目标：Boss 落地后不是"画面跳一下"，而是像电视转台那样雪花糊满、再散开露出新区域。
 * 实现上真正需要被守住**只有一条**：世界替换必须发生在雪花遮满屏幕的那一帧。
 * 世界替换由 updateEnemies 的 falling 分支在 e.age>=BOSS_FALL 时触发（不能被这段代码
 * 顺序改动，所以这里只钉常量的大小关系），雪花透明度由纯函数 sceneSwitchAlpha 给。
 * 于是这条契约退化成三个数的不等式：
 *
 *     rise ≤ BOSS_FALL ≤ rise + hold
 *
 * 单独拉长 rise、或把 hold 压到 0，都会让"硬切"在雪花还没遮满时重新露出来 ——
 * 而那种时候画面只是看着"有点闪"，不会报错，正是最该由断言盯住的一类回归。
 *
 * 变异测试：把 SCENE_SWITCH.hold 改成 0，或把 rise 改到 BOSS_FALL 之后，第 1 条必红。 */

/* 从源码里取常量（连同声明一起取，避免 match 到别处的同名数字）。 */
function grab(re,label){const m=re.exec(game);assert.ok(m,`game.js 里定位不到 ${label}`);return m;}
const bossFall=Number(grab(/const BOSS_FALL=([\d.]+)/,'BOSS_FALL')[1]);
const sw=grab(/const SCENE_SWITCH=\{rise:([\d.]+),hold:([\d.]+),fall:([\d.]+)\}/,'SCENE_SWITCH');
const [rise,hold,fall]=sw.slice(1).map(Number);

test('1 · 世界替换的那一拍必须落在雪花遮满的窗口里（rise ≤ BOSS_FALL ≤ rise+hold）',()=>{
  assert.ok(rise>0,`SCENE_SWITCH.rise=${rise}，雪花没有爬升过程，等于瞬间盖死`);
  assert.ok(fall>0,`SCENE_SWITCH.fall=${fall}，雪花散去没有过渡`);
  assert.ok(rise<=bossFall,
    `rise(${rise}) > BOSS_FALL(${bossFall})：世界替换时雪花只遮到 ${Math.round(rise>0?bossFall/rise*100:0)}%，硬切会从抬头处露出来`);
  assert.ok(bossFall<=rise+hold,
    `BOSS_FALL(${bossFall}) > rise+hold(${rise+hold})：雪花已经开始散开了世界才换，玩家会看到"换"的那一下`);
});

test('2 · sceneSwitchAlpha 是纯函数，遮满窗口内恒为 1、窗口外为 0',()=>{
  const ctx=vm.createContext({SCENE_SWITCH:{rise,hold,fall}});
  // 只把纯函数切进沙箱：它不碰任何状态，正是为了能被这样单测
  vm.runInContext(game.slice(game.indexOf('function sceneSwitchAlpha('),game.indexOf('function sceneSwitchDone(')),ctx);
  const a=ctx.sceneSwitchAlpha;
  assert.equal(typeof a,'function','sceneSwitchAlpha 不见了或被改了名');

  assert.equal(a(0),0,'t=0 不该有雪花');
  assert.equal(a(-1),0,'负时间（还没开始）应当是 0，不能因为 !(t>0) 写成 NaN');
  assert.ok(a(rise/2)>0&&a(rise/2)<1,'爬升段透明度应当严格介于 0 与 1 之间');
  assert.equal(a(rise),1,'刚爬满（t=rise）必须正好是 1');
  assert.equal(a(bossFall),1,`世界替换那一拍（t=BOSS_FALL=${bossFall}）必须遮满，否则就是硬切`);
  /* t=rise+hold 恰好落在"维持段 / 散开段"的分界上，浮点会让结果落在 1±几 ULP，
   * 所以这里用容差判"遮满"，而不是严格 === 1。 */
  assert.ok(a(rise+hold)>=1-1e-9,'维持段末端仍应遮满');
  assert.ok(a(rise+hold+fall/2)>0&&a(rise+hold+fall/2)<1,'散开段透明度应当严格介于 0 与 1 之间');
  assert.equal(a(rise+hold+fall),0,'散开结束必须归零');
});

test('3 · 同一条时间轴：defeat 起雪花、updateEnemies 在 BOSS_FALL 换世界、update 推时钟',()=>{
  // 起：Boss 被击败 → 推入 falling 并启动雪花（就这一处）
  assert.match(game,/if\(e\.type==='sentinel'\)\{e\.state='falling';e\.age=0;shake=12;beginSceneSwitch\(\);/,
    'defeat 里没有在 Boss 倒地那一刻启动换场雪花');
  // 换：世界替换仍在 e.age>=BOSS_FALL 那一拍，且用的是同一个常量（不写死 2.4）
  assert.match(game,/if\(e\.age>=BOSS_FALL\)\{e\.state='gone';explosion\(e\.x,G-20,2\);shake=10;if\(e\.type==='sentinel'&&bossChallengeStarted\)completeBossChallenge\(\);\}/,
    'updateEnemies 的世界替换点改了形状，或没再用 BOSS_FALL 判定');
  assert.ok(!/e\.age>=2\.4/.test(game),'世界替换点又写死成 2.4 了 —— 必须走 BOSS_FALL，否则改了常量两边会脱节');
  // 推：时钟在 update 里前进，到点自动收尾（不依赖下一次 defeat）
  assert.match(game,/if\(sceneSwitch\)\{sceneSwitch\.t\+=dt;if\(sceneSwitchDone\(sceneSwitch\.t\)\)endSceneSwitch\(\);\}/,
    'update 里没有推进换场时钟，雪花会永远停在最后一帧');
});

test('4 · 雪花必须压在所有图层之上，且两个画布（直播 / 转台）都覆盖',()=>{
  // 画在 render 末尾：推图条 / 暗角 / 频道画面都已经画完，雪花才盖上去
  assert.match(game,/if\(channel!=='live'\)drawChannel\(\);drawSceneSwitch\(out\);if\(channel!=='live'\)drawSceneSwitch\(channelCtx\);\}/,
    'drawSceneSwitch 没有盖在 render 的最后（会在推图条或频道画面之下，遮不满）');
  // 噪点用 hash 而非 Math.random —— 画面噪声不该消耗熵源（同"外观只用 hashSeed+mulberry32"）
  assert.match(game,/function noiseGrain\(a,b\)\{const n=Math\.sin\(a\*12\.9898\+b\*78\.233\)\*43758\.5453;return n-Math\.floor\(n\);\}/,
    'noiseGrain 不是 hash 噪声了（改用 Math.random 会让画面随帧率抖成另一张图）');
  const draw=game.slice(game.indexOf('function drawSceneSwitch('),game.indexOf('function render('));
  assert.ok(!/Math\.random/.test(draw),'drawSceneSwitch 里出现了 Math.random —— 雪花应当由帧号哈希决定，不去抢熵源');
});

test('5 · 雪花是画布上的，DOM 浮层必须用 #stage.scene-switching 一起让位',()=>{
  const css=style.replace(/\/\*[\s\S]*?\*\//g,'');
  assert.match(css,/#stage\.scene-switching[^{]*\{[^}]*opacity:0/,
    'style.css 里没有 #stage.scene-switching 的浮层让位规则 —— 横幅会浮在雪花上面，一眼看出是"遮罩"不是"转台"');
  // 让位的应当是直播包装，画面本体与侧栏不受影响
  const rule=css.slice(css.indexOf('#stage.scene-switching'));
  const block=rule.slice(0,rule.indexOf('}'));
  assert.ok(!/#playerFrame|\.shell|\.tv-sidebar/.test(block),
    '让位规则波及了画面本体或侧栏 —— 换场只该藏直播包装，不该动产品定义');
});
