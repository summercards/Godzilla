/* 巨兽都市桌宠 · 渲染层
 *
 * 设计坐标固定为 320 × 256，JS 按窗口实际宽度写入 --s 并把画布变换到同一套坐标，
 * 因此三档窗口尺寸、任意 DPI 都用同一份布局数据，不需要分支。
 *
 * 与网页版《巨兽都市》的关系：骨骼动画模块（rig.js）逐字复用，动作时长与关键帧
 * 曲线完全一致；场景、AI 与成长曲线是为小窗口重写的，目标是「安静地待在桌面上」，
 * 而不是还原直播画面。
 */
'use strict';

(() => {
  const A = window.PetGrowth;
  const R = window.KaijuRig;
  const host = window.petHost || null;   // 普通浏览器预览时为 null

  /* ---------------------------------------------------------------- *
   * 常量
   * ---------------------------------------------------------------- */
  const DESIGN_W = 320;
  const DESIGN_H = 256;
  const GROUND = 214;            // 地面线：脚下那条人行道的顶边
  const SLAB = DESIGN_H - GROUND; // 底座厚度
  const SAVE = 'gnn-pet-v1';

  // 四个建筑位，横向铺开成一条小街
  const SLOTS = [40, 120, 200, 280];

  /* 前缘与目标楼之间保留的间距。
   * 角色又高又宽（带尾巴的长宽比约 2:1），接触判定必须用"身体前缘到楼边"
   * 的距离，而不是"中心到中心"——否则体型一大，整个人就站进楼里了。 */
  const FRONT_REACH = 5;

  /* 尾巴允许伸出画面的比例。
   * 尾巴尖又细又长，占了大半个体宽，若严格限制进画面，高等级时宠物就没地方
   * 走动了。允许末端 15% 出画几乎看不出来，却换回几十像素的活动范围。 */
  const TAIL_OVERHANG = 0.85;

  // 与 rig.js 关键帧曲线绑定的动作时长，任何改动都会让动作走形，不要动
  const DURATION = { walk: Infinity, claw: 1.18, roar: 2.1, beam: 4.2, stomp: 1.68, tail: 1.65 };
  const HIT_AT = { claw: 0.54, roar: 0.45, stomp: 1.0, tail: 0.83 };

  // 冷却（秒）。比网页版短，小窗口里动作稀疏会显得很呆
  const COOLDOWN = { claw: 0, roar: 12, beam: 18, stomp: 10, tail: 9 };

  // 各动作的伤害倍率与作用半径（设计坐标）
  const DAMAGE = {
    claw: { mult: 1.0, radius: 22 },
    roar: { mult: 1.3, radius: 92 },
    stomp: { mult: 4.0, radius: 84 },
    tail: { mult: 2.6, radius: 100 },
    beam: { mult: 1.6, radius: 0 },   // 每秒倍率，持续照射
  };

  const RECOLOR = {
    claw: ['#d8fbff', '#6bd8eb', '#ffdf9a'],
    beam: ['#c7ffff', '#5de5ff', '#fff1a1'],
    boom: ['#fff3b7', '#ffbb4d', '#fa622c', '#9a3940'],
    debris: ['#708299', '#485568', '#c5b9a3'],
  };

  /* ---------------------------------------------------------------- *
   * 工具
   * ---------------------------------------------------------------- */
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const mix = (a, b, t) => a + (b - a) * t;
  const ease = (t) => 1 - Math.pow(1 - t, 3);

  /* ---------------------------------------------------------------- *
   * 画布
   * ---------------------------------------------------------------- */
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  let scale = 1;        // 设计坐标 → 设备像素
  let viewScale = 1;    // 窗口宽度 / 240

  function resize() {
    const w = window.innerWidth || DESIGN_W;
    const h = window.innerHeight || DESIGN_H;
    const dpr = window.devicePixelRatio || 1;
    viewScale = w / DESIGN_W;
    document.documentElement.style.setProperty('--s', String(viewScale));

    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    // 把绘制坐标一次性归一到 320 × 256 的设计空间
    scale = (w / DESIGN_W) * dpr;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    rebuildSkyline();
  }

  /* ---------------------------------------------------------------- *
   * 状态
   * ---------------------------------------------------------------- */
  let growth = null;
  let skeleton = null;
  let rigInfo = { h: 400, dxLeft: -95, dxRight: 216, dyTop: -401, dyBottom: 0 };
  let ready = false;

  let time = 0;
  let elapsed = 0;
  let last = 0;

  const pet = {
    x: DESIGN_W / 2, dir: 1, step: 0, moving: false, angle: 0,
    /* ground 必须显式给出：rig 的骨架求解是 `root.y = ground - (1024-枢轴)*SCALE`，
     * 缺了它整条正向运动学会一路算出 NaN——因为 canvas 的 translate(NaN) 是静默
     * 空操作，画面不会报错，只会把部件按"枢轴坐标"草草摆放，看着像个站不稳的角色。
     * 这就是"哥斯拉浮在半空、还越长大浮得越高"的原因。 */
    ground: GROUND,
    action: { name: 'walk', t: 0 },
    // 所有技能冷却都必须预先置 0。留空对象的话 `cd.beam <= 0` 是
    // `undefined <= 0`，恒为 false，技能永远不会进入候选。
    cooldowns: { roar: 0, beam: 0, stomp: 0, tail: 0 },
    rest: 0, recoil: 0,
  };
  let rigState = null;

  let buildings = [];
  let particles = [];
  let fires = [];
  let rings = [];
  let floaters = [];
  let wrecks = [];
  let beam = null;
  let skyline = [];
  let flash = 0;

  // 身高做平滑插值，让升级时的长大是一个看得见的过程而不是瞬间跳变
  let shownHeight = 0;
  let targetHeight = 0;
  let debugFrozen = false;   // 供 QA 定格动画帧，正常运行始终为 false

  /* ---------------------------------------------------------------- *
   * 存档
   * ---------------------------------------------------------------- */
  function load() {
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(SAVE) || 'null'); } catch { /* 存档损坏则重来 */ }
    return raw;
  }

  function save() {
    try { localStorage.setItem(SAVE, growth.serialize(Date.now())); } catch { /* 无痕模式等场景忽略 */ }
  }

  /* ---------------------------------------------------------------- *
   * 骨骼包围盒
   *
   * 与其手写角色尺寸常量，不如按骨骼变换算一遍：取每个部件的不透明范围
   * （由 build/make-part-bounds.py 预先量好），把四个角按骨骼的平移与旋转
   * 变换到世界坐标后取并集。
   *
   * 之所以不在运行时用 getImageData 直接量像素：桌宠走 file:// 协议，
   * 把本地图片绘进画布会污染画布，读取像素会被浏览器直接拒绝。
   * ---------------------------------------------------------------- */
  function computeRigBox() {
    const B = window.PartBounds || {};
    const actor = {
      x: 0, ground: 0, moving: false, step: 0, angle: 0,
      action: { name: 'walk', t: 0 },
    };
    const state = R.pose(actor, 0);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (const key in R.PARTS) {
      const p = R.PARTS[key];
      const b = state.bones[key];
      const bb = B[key];
      if (!b || !bb) continue;
      const [x0, y0, x1, y1] = bb;
      // 图像像素坐标 → 以枢轴为原点的局部坐标（与 Skeleton.draw 的绘制方式一致）
      const l = (ix, iy) => [ix * p.scale - p.pivot[0], iy * p.scale - p.pivot[1]];
      const cos = Math.cos(b.a), sin = Math.sin(b.a);
      for (const [lx, ly] of [l(x0, y0), l(x1, y0), l(x1, y1), l(x0, y1)]) {
        const wx = b.x + lx * cos - ly * sin;
        const wy = b.y + lx * sin + ly * cos;
        if (wx < minX) minX = wx;
        if (wx > maxX) maxX = wx;
        if (wy < minY) minY = wy;
        if (wy > maxY) maxY = wy;
      }
    }
    if (!Number.isFinite(minX)) return rigInfo;
    // 探测时 ground 取 0，因此结果本身就是相对 (x=0, 脚底=y0) 的偏移
    return {
      h: Math.max(1, maxY - minY),
      dxLeft: minX,
      dxRight: maxX,
      dyTop: minY,
      dyBottom: maxY,
    };
  }

  /* ---------------------------------------------------------------- *
   * 城市
   * ---------------------------------------------------------------- */
  function spec(tier) { return A.BUILDINGS[tier] || A.BUILDINGS[1]; }

  function makeBuilding(slotIndex) {
    const tier = rollTier();
    const s = spec(tier);
    const w = Math.round(rand(s.w[0], s.w[1]));
    const h = Math.round(rand(s.h[0], s.h[1]));
    const x = SLOTS[slotIndex] - w / 2;
    const b = {
      slot: slotIndex, tier, x, w, h, hp: s.hp, max: s.hp,
      dead: false, collapse: 0, hit: 0, floors: s.floors,
      art: paintBuilding(w, h, s.floors, tier),
      rebuild: 0,
    };
    return b;
  }

  // 城市随阶段长高：低等级只有平房，高等级才会出现高楼
  function rollTier() {
    const cap = growth ? growth.cityTier : 1;
    if (cap <= 1) return 1;
    return Math.random() < 0.4 ? cap : 1 + Math.floor(Math.random() * cap);
  }

  function paintBuilding(w, h, floors, tier) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h + 6;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    const body = ['#24405e', '#2b4a6b', '#33628c', '#3d7396'][tier - 1] || '#24405e';
    const dark = ['#16283f', '#1a2f4a', '#1f3a58', '#254664'][tier - 1] || '#16283f';

    g.fillStyle = '#090f24';
    g.fillRect(0, 6, w, h);
    g.fillStyle = body;
    g.fillRect(1, 7, w - 2, h - 1);
    g.fillStyle = dark;
    g.fillRect(w - 6, 7, 5, h - 1);
    g.fillStyle = '#496480';
    g.fillRect(2, 8, 3, h - 2);
    g.fillStyle = '#46617c';
    g.fillRect(0, 6, w, 3);

    // 楼顶设施：档次越高越花哨，让高楼一眼可辨
    if (tier >= 2) { g.fillStyle = '#253b55'; g.fillRect(w * .2, 2, w * .45, 5); }
    if (tier >= 3) {
      g.fillStyle = '#436080';
      g.fillRect(w / 2 - 1, 0, 2, 6);
      g.fillStyle = tier >= 4 ? '#ff537b' : '#ffd477';
      g.fillRect(w / 2 - 1, 0, 2, 2);
    }

    // 窗户：按楼层横向铺设，亮灯比例略高于网页版，小窗口里更容易读出「楼」
    const fh = Math.max(6, Math.floor((h - 4) / floors));
    const cols = Math.max(2, Math.floor((w - 8) / 7));
    for (let f = 0; f < floors; f++) {
      const y = 9 + f * fh;
      if (y + fh > h + 4) break;
      for (let cx = 0; cx < cols; cx++) {
        const x = 4 + cx * ((w - 8) / cols);
        const lit = Math.random() > 0.34;
        g.fillStyle = lit ? pick(['#ffd477', '#ffe68e', '#f9bd55']) : '#34577a';
        g.fillRect(Math.round(x), Math.round(y), Math.max(2, Math.floor((w - 8) / cols) - 2), Math.max(2, fh - 3));
      }
    }
    return c;
  }

  function generateCity() {
    buildings = SLOTS.map((_, i) => makeBuilding(i));
  }

  function rebuildSkyline() {
    // 远景轮廓：几层剪影，只在底座上方一点点，制造城市纵深
    skyline = [];
    for (let layer = 0; layer < 2; layer++) {
      const row = [];
      let x = -20;
      while (x < DESIGN_W + 20) {
        const w = rand(14, 34);
        const h = rand(10, 12 + layer * 22);
        row.push({ x, w, h });
        x += w + rand(2, 7);
      }
      skyline.push(row);
    }
  }

  /* ---------------------------------------------------------------- *
   * 特效
   * ---------------------------------------------------------------- */
  function burst(x, y, n, colors, force) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const v = rand(14, force);
      particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 34,
        life: rand(.28, .95), size: rand(1.5, 4.5),
        color: pick(colors), gravity: 150,
      });
    }
  }

  function smoke(x, y, size) {
    particles.push({
      x, y, vx: rand(-9, -2), vy: rand(-22, -8),
      life: rand(1.1, 2.3), size: rand(size * .6, size * 1.4),
      color: pick(['#182234', '#263045', '#343a4c']), gravity: -4, smoke: true,
    });
  }

  function boom(x, y, power) {
    burst(x, y, Math.round(16 * power), RECOLOR.boom, 100 * power);
    rings.push({ x, y, r: 3, life: .34, color: '#ffd07b', flat: false });
    flash = Math.max(flash, .5 * power);
  }

  function floater(x, y, text, color) {
    floaters.push({ x, y, text, life: 1.1, color });
  }

  /* ---------------------------------------------------------------- *
   * 建筑伤害
   * ---------------------------------------------------------------- */
  function damage(b, amount) {
    if (b.dead) return;
    b.hp -= amount;
    b.hit = .12;
    if (Math.random() < .2) burst(b.x + rand(0, b.w), GROUND - b.h * .6, 2, RECOLOR.debris, 50);
    if (b.hp <= 0) collapse(b);
  }

  function collapse(b) {
    b.dead = true;
    b.hp = 0;
    b.collapse = .001;
    b.rebuild = rand(9, 17);
    boom(b.x + b.w / 2, GROUND - b.h * .45, .8 + b.tier * .22);
    for (let i = 0; i < 4; i++) smoke(b.x + rand(0, b.w), GROUND - b.h * .4, 9);
    fires.push({ x: b.x + b.w * .5, y: GROUND - 2, size: 12 + b.w * .18, age: 0 });
    wrecks.push({ x: b.x + b.w / 2, y: GROUND - 2, w: b.w, age: 0, seed: Math.random() });
    const levels = growth.wreck(b.tier);
    floater(b.x + b.w / 2, GROUND - b.h - 6, '+' + A.wreckXP(b.tier, growth.level), '#a0e9df');
    if (levels > 0) onLevelUp(levels);
  }

  /* ---------------------------------------------------------------- *
   * 宠物动作
   * ---------------------------------------------------------------- */
  function attackPower() { return 5 + growth.level * 0.55; }

  function begin(name, target) {
    // 出手前先转向目标，否则会朝反方向挥爪
    if (target) pet.dir = Math.sign(target.x + target.w / 2 - pet.x) || pet.dir;
    pet.action = { name, t: 0, hit: false, target };
    pet.moving = false;
    if (name !== 'walk') pet.cooldowns[name] = COOLDOWN[name] || 0;
  }

  /* ---- 身体几何 ----
   * 角色的枢轴在躯干，不在包围盒中心：头那一侧伸出 rigInfo.dxRight，
   * 尾巴那一侧伸出 rigInfo.dxLeft（负数，因为尾巴很长）。所有接触判定
   * 都基于这两个边缘，而不是宠物中心，这样体型变化时行为才不会走样。 */
  function petScale() { return shownHeight / rigInfo.h; }

  /* 骨骼空间 ↔ 设计坐标。
   *
   * drawPet 是一套「以 (pet.x, GROUND) 为不动点、按 dir×k 缩放」的变换，骨骼里
   * 解出来的附着点（嘴、背鳍）必须过同一套变换才能落到屏幕上该在的地方。
   * 把骨骼坐标直接当设计坐标用，光束就会从画面外射进来——这个坑踩过一次。 */
  function rigToDesign(p) {
    const k = petScale();
    return {
      x: pet.x + (p.x - pet.x) * pet.dir * k,
      y: GROUND + (p.y - GROUND) * k,
    };
  }

  /* 反向映射：把屏幕上的目标送回骨骼空间去算瞄准角。
   * 好处是骨骼空间里角色恒朝 +x，瞄准角天然是小角度，不必再按朝向翻转符号。 */
  function designToRig(p) {
    const k = petScale();
    return {
      x: pet.x + (p.x - pet.x) / (pet.dir * k),
      y: GROUND + (p.y - GROUND) / k,
    };
  }

  /* 头那一侧与尾巴那一侧的伸展长度（设计像素）。
   * 角色的枢轴在躯干而不是包围盒中心，尾巴比头长出两倍多，所以任何
   * "身体边缘"的计算都必须分开算两侧，不能用中心加减半个宽度。 */
  function reach() {
    const k = petScale();
    return { head: rigInfo.dxRight * k, tail: -rigInfo.dxLeft * k };
  }

  /* 接近方向：宠物在楼的左边记为 +1（转身朝右打），右边记为 -1。
   *
   * 这个值必须由几何位置直接得出，且必须先于朝向确定。早期版本用 pet.dir
   * 反推站位，而站位又会改 pet.dir，两者互相依赖，结果宠物在两栋楼中间
   * 反复翻面、原地抖动，既走不到也打不着。 */
  function approachSide(b) {
    return pet.x <= b.x + b.w / 2 ? 1 : -1;
  }

  function frontEdge() {
    const r = reach();
    return pet.dir > 0 ? pet.x + r.head : pet.x - r.head;
  }

  function bodySpan() {
    const r = reach();
    const back = pet.dir > 0 ? pet.x - r.tail : pet.x + r.tail;
    const f = frontEdge();
    return [Math.min(back, f), Math.max(back, f)];
  }

  /* 前缘到指定楼的间距。负数表示已经压进楼里 */
  function frontGapTo(b) {
    const f = frontEdge();
    return pet.dir > 0 ? b.x - f : f - (b.x + b.w);
  }

  /* 贴身判定：前缘贴住楼边（允许压进去一点），但不允许隔着距离挥爪 */
  function inMelee(b) {
    const g = frontGapTo(b);
    return g <= FRONT_REACH + 3 && g >= -(b.w + 4);
  }

  /* 站定位置：从 side 指示的那一侧贴上去，让前缘正好停在楼边外 FRONT_REACH 处 */
  function standX(b, side) {
    const r = reach();
    return side > 0
      ? b.x - r.head - FRONT_REACH
      : b.x + b.w + r.head + FRONT_REACH;
  }

  /* 走动范围随体型收缩。
   * 取两个朝向的公共区间，宠物转身时就不会因为越界而被瞬移；
   * 尾巴一侧只保留 TAIL_OVERHANG 的进画要求。 */
  function walkBounds() {
    const r = reach();
    let lo = r.tail * TAIL_OVERHANG + 3;
    let hi = DESIGN_W - r.head - 4;
    if (lo > hi) { lo = hi = DESIGN_W / 2; }   // 体型撑满时钉在中央
    return [lo, hi];
  }

  /* 站在建筑旁边时宠物应该在的 x；超出走动范围就取边界值 */
  function approachX(b, side) {
    const [lo, hi] = walkBounds();
    return clamp(standX(b, side), lo, hi);
  }

  function nearestBuilding() {
    let best = null, bestD = Infinity;
    for (const b of buildings) {
      if (b.dead) continue;
      const d = Math.abs(b.x + b.w / 2 - pet.x);
      if (d < bestD) { bestD = d; best = b; }
    }
    return best;
  }

  function chooseAction(b) {
    if (!b) return null;
    const near = inMelee(b);
    const cd = pet.cooldowns;
    const cluster = buildings.filter(o => !o.dead &&
      Math.abs(o.x + o.w / 2 - pet.x) < DAMAGE.stomp.radius).length;

    // 优先用范围技能：一次倒一片的观感，比反复拍一栋楼更值
    if (near && growth.can('stomp') && cd.stomp <= 0 && cluster >= 2) return 'stomp';
    if (near && growth.can('tail') && cd.tail <= 0) return 'tail';
    // 高楼够不着，或者离得还远，就远程吐息
    if (growth.can('beam') && cd.beam <= 0 && (b.tier >= 3 || !near)) return 'beam';
    if (near && growth.can('roar') && cd.roar <= 0) return 'roar';
    if (near) return 'claw';
    if (growth.can('beam') && cd.beam <= 0) return 'beam';
    return null;
  }

  function applyHit(name) {
    const b = pet.action.target;
    const d = DAMAGE[name];
    const power = attackPower() * d.mult;
    burst(frontEdge(), GROUND - shownHeight * .15, 6, RECOLOR.claw, 70);
    flash = Math.max(flash, .25);

    if (name === 'claw' || name === 'tail') {
      // 近战：只结算真正贴到前缘的楼，避免隔空挥爪
      for (const o of buildings) {
        if (!o.dead && inMelee(o)) damage(o, power);
      }
      if (name === 'tail') {
        // 尾扫把身体水平覆盖范围内的楼一起带走，这正是长尾巴的价值
        const [l, r] = bodySpan();
        for (const o of buildings) {
          if (o.dead) continue;
          const c = o.x + o.w / 2;
          if (c >= l - DAMAGE.tail.radius && c <= r + DAMAGE.tail.radius) damage(o, power * .5);
        }
      }
    } else if (name === 'roar' || name === 'stomp') {
      for (const o of buildings) {
        if (o.dead) continue;
        if (Math.abs(o.x + o.w / 2 - pet.x) <= d.radius) damage(o, power);
      }
      rings.push({ x: pet.x, y: GROUND, r: 6, life: .5, color: name === 'stomp' ? '#a5dfff' : '#81eaff', flat: name === 'stomp' });
    } else if (name === 'beam' && b && !b.dead) {
      damage(b, power);
    }
  }

  function onLevelUp(levels) {
    targetHeight = growth.height;
    const st = growth.stage;
    const first = growth.data.seenStages[growth.data.seenStages.length - 1] === st.id;
    showBanner(
      `LV ${String(growth.level).padStart(2, '0')} · ${st.name}`,
      first ? st.blurb : `体型正在长大 · ${Math.round(growth.height)}px`,
      first && growth.level >= 10,
    );
    if (levels > 0) {
      burst(pet.x, GROUND - 40, 20, ['#ffe08a', '#fff6cf', '#70f8ff'], 90);
      rings.push({ x: pet.x, y: GROUND - 30, r: 6, life: .7, color: '#ffe08a', flat: false });
      // 每一次长大都配一声低吼，让升级有手感
      if (!growth.data.muted) sound('level');
    }
  }

  /* ---------------------------------------------------------------- *
   * 更新
   * ---------------------------------------------------------------- */
  function update(dt, wall) {
    elapsed += wall;
    time += dt;

    // 身高平滑：升级后约 1.4 秒长到新尺寸
    targetHeight = growth.height;
    if (shownHeight <= 0) shownHeight = targetHeight;
    shownHeight = mix(shownHeight, targetHeight, clamp(dt * 2.2, 0, 1));

    growth.tick(wall);
    consumeEvents();

    // 冷却
    for (const k in pet.cooldowns) pet.cooldowns[k] = Math.max(0, pet.cooldowns[k] - dt);

    flash = Math.max(0, flash - wall * 2.2);
    if (pet.recoil > 0) pet.recoil = Math.max(0, pet.recoil - wall);

    updatePet(dt);
    rigState = R.pose(pet, time);

    updateBuildings(dt, wall);
    updateEffects(dt, wall);
    updateUI(wall);
  }

  function consumeEvents() {
    for (const e of growth.events) {
      if (e.type === 'stage') {
        showBanner(`阶段突破 · ${e.stage.name}`, e.stage.blurb, true);
        if (!growth.data.muted) sound('stage');
      }
    }
    growth.events.length = 0;
  }

  function updatePet(dt) {
    if (debugFrozen) return;    // 仅调试定格时生效
    const a = pet.action;
    a.t += dt;

    if (a.name === 'walk') {
      // 偶尔站着歇一会儿，比一直走来走去更像活物
      if (pet.rest > 0) {
        pet.rest -= dt;
        pet.moving = false;
        pet.step += dt * 1.1;
        return;
      }
      if (Math.random() < dt * 0.035) pet.rest = rand(1.6, 4.2);

      const b = nearestBuilding();
      const speed = 26 + growth.level * 0.12;   // 设计像素 / 秒
      const [lo, hi] = walkBounds();

      if (!b) {
        // 城市重建的空档：来回踱步
        pet.moving = true;
        pet.x = clamp(pet.x + pet.dir * speed * dt, lo, hi);
        if (pet.x <= lo && pet.dir < 0) pet.dir = 1;
        if (pet.x >= hi && pet.dir > 0) pet.dir = -1;
        pet.step += dt * 2.2;
        return;
      }

      // 先定接近方向与朝向，再判定能不能出手——顺序反了会互相打架
      const side = approachSide(b);
      pet.dir = side;

      const want = chooseAction(b);
      if (want) { begin(want, b); return; }

      // 还没贴到位，继续走到站位
      pet.moving = true;
      const stop = approachX(b, side);
      if (Math.abs(stop - pet.x) < 1) {
        pet.moving = false;
        begin('claw', b);
        return;
      }
      pet.x = clamp(pet.x + clamp(stop - pet.x, -speed * dt, speed * dt), lo, hi);
      pet.step += dt * 2.2;
      return;
    }

    // 动作中
    pet.moving = false;
    if (a.name === 'beam' && a.target && !a.target.dead) {
      const tx = a.target.x + a.target.w * .55;
      const ty = GROUND - a.target.h * .62;
      // 瞄准角在骨骼空间里算：那里角色恒朝 +x，不需要按朝向翻符号
      const mRig = rigState ? rigState.muzzle : designToRig({ x: pet.x, y: GROUND - 60 });
      const aim = designToRig({ x: tx, y: ty });
      const want = Math.atan2(aim.y - mRig.y, aim.x - mRig.x);
      pet.angle = mix(pet.angle, clamp(want, -0.5, 0.62), Math.min(1, dt * 5));
      // 照射窗口内持续结算伤害
      if (a.t >= .95 && a.t <= 3.55) {
        damage(a.target, attackPower() * DAMAGE.beam.mult * dt);
        if (Math.random() < dt * 18 && rigState) {
          const m2 = rigToDesign(rigState.muzzle);
          burst(m2.x + Math.cos(pet.angle) * rand(20, 60), m2.y + Math.sin(pet.angle) * rand(20, 60), 1, RECOLOR.beam, 40);
        }
      }
    } else {
      pet.angle = mix(pet.angle, 0, Math.min(1, dt * 3));
    }

    const hitAt = HIT_AT[a.name];
    if (hitAt !== undefined && !a.hit && a.t >= hitAt) {
      a.hit = true;
      applyHit(a.name);
      shot(a.name);
    }

    if (a.t >= DURATION[a.name]) {
      a.name = 'walk';
      a.t = 0;
      a.hit = false;
      if (pet.cooldowns.claw === 0) pet.cooldowns.claw = 0;
    }
  }

  function updateBuildings(dt, wall) {
    for (const b of buildings) {
      b.hit = Math.max(0, b.hit - dt);
      if (b.dead) {
        if (b.collapse < 3) {
          b.collapse += dt;
          if (Math.random() < dt * 12) smoke(b.x + rand(0, b.w), GROUND - Math.max(0, b.h * (1 - b.collapse * .6)), 7);
        }
        b.rebuild -= dt;
        if (b.rebuild <= 0) {
          const i = buildings.indexOf(b);
          buildings[i] = makeBuilding(b.slot);
        }
      } else if (b.hp < b.max * .7 && Math.random() < dt * 4) {
        smoke(b.x + b.w * .7, GROUND - b.h * .6, 5);
      }
    }
    for (const f of fires) {
      f.age += dt;
      if (Math.random() < dt * 6) smoke(f.x + rand(-f.size / 2, f.size / 2), f.y - 6, 6);
    }
    fires = fires.filter(f => f.age < 14).slice(-14);
    for (const w of wrecks) w.age += dt;
    wrecks = wrecks.filter(w => w.age < 22).slice(-6);
  }

  function updateEffects(dt, wall) {
    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.gravity * dt;
      if (p.smoke) p.size += dt * 5;
      else if (p.y > GROUND + 4) { p.y = GROUND + 4; p.vy *= -.22; p.vx *= .7; }
    }
    particles = particles.filter(p => p.life > 0).slice(-260);
    for (const r of rings) { r.life -= dt; r.r += dt * (r.flat ? 150 : 60); }
    rings = rings.filter(r => r.life > 0);
    for (const f of floaters) { f.life -= dt; f.y -= dt * 12; }
    floaters = floaters.filter(f => f.life > 0).slice(-12);
  }

  /* ---------------------------------------------------------------- *
   * 渲染
   * ---------------------------------------------------------------- */
  function render() {
    ctx.clearRect(0, 0, DESIGN_W, DESIGN_H);

    // 底座：一小片城市断面，让宠物在桌面上有立足点
    drawSlab();
    drawSkyline();

    for (const b of buildings) if (!b.dead || b.collapse < 2.6) drawBuilding(b);
    drawWrecks();
    for (const b of buildings) if (!b.dead || b.collapse < 2.6) drawHitFlash(b);

    drawPet();
    drawBeam();
    drawEffects();

    if (flash > 0.01) {
      ctx.globalAlpha = Math.min(.4, flash * .3);
      ctx.fillStyle = '#ffe8c0';
      ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
      ctx.globalAlpha = 1;
    }
  }

  function drawSlab() {
    // 人行道
    ctx.fillStyle = '#2b3446';
    ctx.fillRect(0, GROUND, DESIGN_W, 5);
    ctx.fillStyle = '#3c4859';
    ctx.fillRect(0, GROUND, DESIGN_W, 2);
    // 路缘线
    ctx.fillStyle = '#1b2333';
    ctx.fillRect(0, GROUND + 5, DESIGN_W, 1);
    // 地下断面：几层土色，读起来像一块被切开的街区
    ctx.fillStyle = '#141c2c';
    ctx.fillRect(0, GROUND + 6, DESIGN_W, SLAB - 6);
    ctx.fillStyle = '#1b2438';
    ctx.fillRect(0, GROUND + 6, DESIGN_W, 7);
    ctx.fillStyle = '#101725';
    ctx.fillRect(0, GROUND + 19, DESIGN_W, 3);
    ctx.fillStyle = '#1b2438';
    ctx.fillRect(0, GROUND + 26, DESIGN_W, 2);
    // 断面里的管线与地铁，增加「这是城市」的暗示
    for (let x = 6; x < DESIGN_W; x += 34) {
      ctx.fillStyle = '#25314a';
      ctx.fillRect(x, GROUND + 10, 20, 3);
      ctx.fillStyle = '#2f3d59';
      ctx.fillRect(x + 4, GROUND + 22, 12, 6);
      ctx.fillStyle = '#ffd47733';
      ctx.fillRect(x + 6, GROUND + 24, 3, 2);
    }
    ctx.fillStyle = '#0b111d';
    ctx.fillRect(0, DESIGN_H - 2, DESIGN_W, 2);
  }

  function drawSkyline() {
    for (let layer = 0; layer < skyline.length; layer++) {
      const alpha = layer === 0 ? .5 : .3;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = layer === 0 ? '#16233a' : '#1d2c46';
      for (const s of skyline[layer]) {
        ctx.fillRect(s.x, GROUND - s.h, s.w, s.h);
        // 窗灯点缀，让剪影不死板
        if (layer === 1) {
          ctx.fillStyle = '#ffd47722';
          for (let wy = GROUND - s.h + 3; wy < GROUND - 3; wy += 5) {
            ctx.fillRect(s.x + 3, wy, s.w - 6, 1);
          }
          ctx.fillStyle = '#1d2c46';
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawBuilding(b) {
    const sink = b.dead ? Math.min(1, b.collapse / 1.4) : 0;
    if (b.dead) {
      // 倒塌：楼层自上而下沉降并偏转
      ctx.save();
      ctx.globalAlpha = 1 - Math.max(0, (b.collapse - 1.8) / .8);
      ctx.translate(b.x + b.w / 2, GROUND);
      ctx.rotate(sink * .12);
      ctx.translate(-(b.x + b.w / 2), -GROUND);
      const visible = Math.max(0, 1 - sink);
      ctx.drawImage(b.art, 0, 0, b.w, Math.ceil((b.h + 6) * visible),
        b.x, GROUND - (b.h + 6) * visible, b.w, (b.h + 6) * visible);
      ctx.restore();
      return;
    }
    ctx.drawImage(b.art, b.x, GROUND - b.h - 6);
  }

  function drawHitFlash(b) {
    if (b.dead || b.hit <= 0) return;
    ctx.globalAlpha = Math.min(.7, b.hit * 5);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(b.x, GROUND - b.h, b.w, b.h);
    ctx.globalAlpha = 1;
  }

  function drawWrecks() {
    for (const w of wrecks) {
      const fade = w.age > 16 ? 1 - (w.age - 16) / 6 : 1;
      ctx.globalAlpha = clamp(fade, 0, 1) * .85;
      const h = 7 + (w.w % 5);
      ctx.fillStyle = '#141e2b';
      ctx.fillRect(w.x - w.w / 2, GROUND - h, w.w, h);
      ctx.fillStyle = '#394352';
      ctx.fillRect(w.x - w.w / 2 + 2, GROUND - h - 3, w.w - 8, 3);
      // 零星余烬
      ctx.fillStyle = Math.random() < .5 ? '#e07e57' : '#7a4a3a';
      ctx.fillRect(w.x - 3, GROUND - h - 4, 2, 2);
      ctx.globalAlpha = 1;
    }
  }

  function drawPet() {
    if (!rigState) return;
    const k = shownHeight / rigInfo.h;
    ctx.save();
    ctx.translate(pet.x, GROUND);
    ctx.scale(pet.dir * k, k);
    ctx.translate(-pet.x, -GROUND);
    skeleton.draw(ctx, rigState, 0);
    ctx.restore();

    // 阴影：没有它角色会显得悬浮
    ctx.globalAlpha = .3;
    ctx.fillStyle = '#050a14';
    const [bl, br] = bodySpan();
    const sw = Math.max(8, (br - bl) * .34);
    ctx.beginPath();
    ctx.ellipse((bl + br) / 2, GROUND + 1, sw, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawBeam() {
    beam = null;
    const a = pet.action;
    if (a.name !== 'beam' || !rigState) return;
    // 嘴部挂点在骨骼空间，先换算到设计坐标；这一步漏了光束就会从屏幕外射入
    const m = rigToDesign(rigState.muzzle);
    const active = a.t >= .95 && a.t <= 3.55;
    const target = a.target && !a.target.dead ? a.target : null;
    const ex = target ? target.x + target.w * .55 : m.x + Math.cos(pet.angle) * 200;
    const ey = target ? GROUND - target.h * .62 : m.y + Math.sin(pet.angle) * 200;

    if (!active) {
      // 蓄力：背鳍逐节亮起 + 嘴部汇聚。背脊线同样取自骨骼空间
      const charge = clamp(a.t / .95, 0, 1);
      const spineA = rigToDesign(rigState.bones.tail_base);
      const spineB = rigToDesign(rigState.bones.head);
      for (let i = 0; i < 11; i++) {
        const t = i / 10;
        const x = mix(spineA.x, spineB.x, t) - 8;
        const y = mix(spineA.y, spineB.y, t) - 8;
        if (Math.max(0, (1 - Math.abs(t - .82) * 3)) * charge > .35) {
          ctx.globalAlpha = clamp(charge * .8, 0, 1);
          ctx.fillStyle = '#70f8ff';
          ctx.fillRect(x, y, 3, 3);
        }
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#edffff';
      ctx.fillRect(m.x - 1.5, m.y - 1.5, 3, 3);
      return;
    }

    const colors = ['#063dab', '#087fff', '#3bdbff', '#bbffff', '#faffee'];
    const widths = [9, 6, 4, 2.5, 1];
    ctx.globalAlpha = .95;
    for (let i = 0; i < colors.length; i++) {
      ctx.strokeStyle = colors[i];
      ctx.lineWidth = widths[i];
      ctx.beginPath();
      ctx.moveTo(m.x, m.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    beam = { x: m.x, y: m.y, ex, ey };
    if (Math.random() < .6) boom(ex, ey, .25);
  }

  function drawEffects() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / (p.smoke ? 1.5 : .3), 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    for (const r of rings) {
      ctx.globalAlpha = Math.min(1, r.life * 1.6);
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.flat ? 2 : 1.5;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r, r.flat ? r.r * .2 : r.r, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (const f of floaters) {
      ctx.globalAlpha = Math.min(1, f.life);
      ctx.fillStyle = f.color;
      ctx.font = '8px Pixel, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    for (const f of fires) {
      const t = f.age * 6;
      for (let i = 0; i < 4; i++) {
        const h = Math.max(1, f.size * (1 - i / 4) * (.6 + Math.sin(t + i) * .3));
        ctx.fillStyle = ['#ffe598', '#ff9d3b', '#e5533a', '#8c2f28'][i];
        ctx.fillRect(f.x - h / 4, f.y - h * (i + 1) / 4, h / 2, h / 4 + 1);
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * 界面
   * ---------------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);
  const ui = {
    badge: $('badge'), badgeLevel: $('badgeLevel'), badgeBar: $('badgeBar').firstElementChild,
    card: $('hoverCard'), cardStage: $('cardStage'), cardStageEn: $('cardStageEn'),
    cardLevel: $('cardLevel'), cardBlurb: $('cardBlurb'), cardBar: $('cardBar'),
    cardXp: $('cardXp'), cardWrecks: $('cardWrecks'), cardTime: $('cardTime'), cardNext: $('cardNext'),
    banner: $('banner'), bannerTitle: $('bannerTitle'), bannerSub: $('bannerSub'),
    offline: $('offline'), offlineText: $('offlineText'),
  };
  let uiClock = 0;
  let bannerTimer = 0;
  let hovered = false;

  function showBanner(title, sub, big) {
    ui.bannerTitle.textContent = title;
    ui.bannerSub.textContent = sub || '';
    ui.banner.hidden = false;
    ui.banner.classList.toggle('stage', !!big);
    bannerTimer = big ? 4 : 2.6;
  }

  function humanTime(sec) {
    if (sec < 60) return `${Math.floor(sec)} 秒`;
    if (sec < 3600) return `${Math.floor(sec / 60)} 分`;
    if (sec < 86400) return `${Math.floor(sec / 3600)} 时`;
    return `${Math.floor(sec / 86400)} 天`;
  }

  function updateUI(wall) {
    if (bannerTimer > 0) {
      bannerTimer -= wall;
      if (bannerTimer <= 0) ui.banner.hidden = true;
    }
    uiClock += wall;
    if (uiClock < .2) return;
    uiClock = 0;

    const g = growth;
    const st = g.stage;
    const pct = Math.round(g.progress * 100);
    ui.badgeLevel.textContent = `LV ${String(g.level).padStart(2, '0')}`;
    ui.badgeBar.style.width = pct + '%';
    publishState();

    if (!hovered) return;
    ui.cardLevel.textContent = `LV ${String(g.level).padStart(2, '0')}`;
    ui.cardStage.textContent = st.name;
    ui.cardStageEn.textContent = st.en;
    ui.cardBlurb.textContent = st.blurb;
    ui.cardBar.style.width = pct + '%';
    ui.cardXp.textContent = `${Math.floor(g.data.xp)} / ${g.next}`;
    ui.cardWrecks.textContent = String(g.data.wrecks);
    ui.cardTime.textContent = humanTime(g.data.seconds);

    const nextStage = A.STAGES.find(s => s.min > g.level);
    ui.cardNext.textContent = nextStage ? `LV ${nextStage.min} ${nextStage.name}` : '已至顶阶';
  }

  // 把实时状态挂到画布上，便于自动化检查与排查（与网页版的做法一致）
  function publishState() {
    Object.assign(canvas.dataset, {
      level: String(growth.level),
      stage: growth.stage.id,
      height: shownHeight.toFixed(1),
      targetHeight: targetHeight.toFixed(1),
      wrecks: String(growth.data.wrecks),
      buildings: String(buildings.filter(b => !b.dead).length),
      action: pet.action.name,
      dir: String(pet.dir),
      x: pet.x.toFixed(1),
      parts: String(Object.keys(R.PARTS).length),
      partsReady: String(!!skeleton?.ready),
      rigHeight: rigInfo.h.toFixed(1),
      rigLeft: rigInfo.dxLeft.toFixed(0),
      rigRight: rigInfo.dxRight.toFixed(0),
      // 竖直方向的落点：脚底应当正好压在 GROUND 上，否则角色会显得悬空
      rigFeetY: (GROUND + rigInfo.dyBottom * (shownHeight / rigInfo.h)).toFixed(1),
      rigRootY: rigState ? String(rigState.bones.root.y) : 'n/a',
      dbgTarget: pet.action.target
        ? `${pet.action.target.slot}@${Math.round(pet.action.target.x)},${pet.action.target.h}`
        : 'none',
      dbgBeam: beam
        ? `${beam.x.toFixed(0)},${beam.y.toFixed(0)}->${beam.ex.toFixed(0)},${beam.ey.toFixed(0)}`
        : 'none',
      host: host ? 'desktop' : 'preview',
      // 调试字段：排查"宠物不动/不出手"这类问题时，比截图有用得多
      dbgRest: pet.rest.toFixed(1),
      dbgBounds: walkBounds().map((v) => v.toFixed(0)).join('-'),
      dbgCd: ['roar', 'beam', 'stomp', 'tail']
        .map((k) => `${k}=${pet.cooldowns[k] === undefined ? 'n/a' : pet.cooldowns[k].toFixed(1)}`)
        .join(' '),
      dbgNear: (() => {
        const b = nearestBuilding();
        return b ? `${b.slot}:gap=${frontGapTo(b).toFixed(0)}:melee=${inMelee(b)}` : 'none';
      })(),
    });
  }

  /* ---------------------------------------------------------------- *
   * 输入
   * ---------------------------------------------------------------- */
  const hit = { pet: false, ui: false };

  function pointInPet(x, y) {
    if (!rigState) return false;
    const k = shownHeight / rigInfo.h;
    let l = rigInfo.dxLeft * k, r = rigInfo.dxRight * k;
    if (pet.dir < 0) { const tmp = l; l = -r; r = -tmp; }
    const top = GROUND + rigInfo.dyTop * k;
    const bottom = GROUND + rigInfo.dyBottom * k;
    return x >= pet.x + l - 4 && x <= pet.x + r + 4 && y >= top - 4 && y <= bottom + 4;
  }

  function pointInSlab(x, y) { return y >= GROUND; }

  function pointInBuilding(x, y) {
    for (const b of buildings) {
      if (b.dead) continue;
      if (x >= b.x && x <= b.x + b.w && y >= GROUND - b.h && y <= GROUND) return true;
    }
    return false;
  }

  function toDesign(ev) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * DESIGN_W,
      y: ((ev.clientY - rect.top) / rect.height) * DESIGN_H,
    };
  }

  let drag = null;   // { offsetX, offsetY, moved }

  canvas.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    const p = toDesign(ev);
    hit.pet = pointInPet(p.x, p.y);
    hit.ui = pointInBuilding(p.x, p.y);
    const interactive = hit.pet || hit.ui || pointInSlab(p.x, p.y);
    if (!interactive) return;

    canvas.setPointerCapture(ev.pointerId);
    drag = {
      offsetX: ev.screenX - window.screenX,
      offsetY: ev.screenY - window.screenY,
      moved: false, startX: ev.screenX, startY: ev.screenY, onPet: hit.pet,
    };
  });

  canvas.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const dx = ev.screenX - drag.startX;
    const dy = ev.screenY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > 4) {
      drag.moved = true;
      document.body.classList.add('dragging');
    }
    if (!drag.moved) return;
    host?.drag(Math.round(ev.screenX - drag.offsetX), Math.round(ev.screenY - drag.offsetY));
  });

  canvas.addEventListener('pointerup', (ev) => {
    canvas.releasePointerCapture?.(ev.pointerId);
    document.body.classList.remove('dragging');
    if (drag && !drag.moved && drag.onPet) poke();
    if (drag?.moved) host?.dragEnd();
    drag = null;
  });

  canvas.addEventListener('pointercancel', () => {
    document.body.classList.remove('dragging');
    if (drag?.moved) host?.dragEnd();
    drag = null;
  });

  // 摸头：给一点经验，并让宠物当场做出反应
  function poke() {
    const fresh = growth.pet();
    if (!fresh) {
      // 冷却中仍然回应，只是不给经验，避免点了没反馈
      if (pet.action.name === 'walk') begin(growth.can('roar') ? 'roar' : 'claw', nearestBuilding());
      return;
    }
    pet.recoil = .35;
    targetHeight = growth.height;
    floater(pet.x, GROUND - shownHeight - 6, `+${A.PET_XP}`, '#ffe08a');
    burst(pet.x, GROUND - shownHeight * .5, 10, ['#ffe08a', '#fff6cf', '#a0e9df'], 60);
    rings.push({ x: pet.x, y: GROUND - shownHeight * .4, r: 4, life: .55, color: '#ffe08a', flat: false });
    if (pet.action.name === 'walk') {
      begin('roar', nearestBuilding());
    }
    if (!growth.data.muted) sound('pet');
    /** 触发一次升级时也要立刻看到长大 */
    if (growth.events.length) consumeEvents();
  }

  canvas.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    host?.menu({
      title: '巨兽都市桌宠',
      subtitle: `LV ${growth.level} · ${growth.stage.name} · 已拆 ${growth.data.wrecks} 栋`,
      paused: growth.data.paused,
      muted: growth.data.muted,
    });
  });

  /* 悬停卡片由指针位置驱动，而不是 mouseenter / mouseleave：
   * 窗口处于穿透状态时，进出事件并不可靠，只有被转发的位移是稳的。 */
  function setHovered(on) {
    if (on === hovered) return;
    hovered = on;
    ui.card.hidden = !on;
    document.body.classList.toggle('card', on);
  }

  // 浏览器预览时没有穿透机制，用常规进出事件兜底
  if (!host) {
    document.addEventListener('mouseenter', () => setHovered(true));
    document.addEventListener('mouseleave', () => setHovered(false));
  }

  ui.offline.addEventListener('click', () => { ui.offline.hidden = true; });

  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) save();
    else { const r = growth.offline(Date.now()); if (r) showOffline(r); last = performance.now(); }
  });

  /* 主进程发来的开关 */
  if (host) {
    host.onCommand((cmd) => {
      if (!cmd) return;
      if (cmd.type === 'togglePause') {
        growth.data.paused = !growth.data.paused;
        showBanner(growth.data.paused ? '已暂停' : '继续拆楼', growth.data.paused ? '哥斯拉原地待机' : '自动破坏恢复');
        save();
      } else if (cmd.type === 'toggleMute') {
        growth.data.muted = !growth.data.muted;
        showBanner(growth.data.muted ? '已静音' : '音效已开启', '');
        save();
      }
    });

    /* 自动穿透
     *
     * 透明窗口默认会吃掉整块矩形上的点击，桌面上就出现一片看不见的死区。
     * 所以启动时先让窗口完全穿透，再靠 forward:true 转发过来的指针位移判断
     * 光标是否压在实体像素（哥斯拉、底座、建筑）上：压住就收回穿透，离开就恢复。
     * 用户勾选「穿透点击（只观赏）」时强制保持穿透，不再自动收回。 */
    let forcing = false;
    let ignoring = true;
    const notify = (next) => {
      if (next === ignoring) return;
      ignoring = next;
      host.setIgnoreMouse?.(next);
    };
    host.setIgnoreMouse?.(true);
    host.onFlags((f) => {
      forcing = !!f.clickThrough;
      if (forcing) notify(true);
    });

    canvas.addEventListener('pointermove', (ev) => {
      if (drag || forcing) return;
      const p = toDesign(ev);
      const solid = pointInPet(p.x, p.y) || pointInSlab(p.x, p.y) || pointInBuilding(p.x, p.y);
      setHovered(solid);
      notify(!solid);
    });
  }

  function showOffline(report) {
    ui.offlineText.textContent =
      `离开 ${humanTime(report.seconds)}，替你攒下 ${Math.round(report.amount)} 经验` +
      (report.levels > 0 ? `，升了 ${report.levels} 级。` : '。') +
      (report.capped ? '（按 8 小时上限结算）' : '');
    ui.offline.hidden = false;
    setTimeout(() => { ui.offline.hidden = true; }, 9000);
  }

  /* ---------------------------------------------------------------- *
   * 声音：与网页版同源的最小合成，默认关闭
   * ---------------------------------------------------------------- */
  let audio = null;
  let master = null;

  function audioReady() {
    if (audio || growth.data.muted) return;
    try {
      audio = new (window.AudioContext || window.webkitAudioContext)();
      master = audio.createGain();
      master.gain.value = .22;
      master.connect(audio.destination);
    } catch { growth.data.muted = true; }
  }

  function tone(f, d, type, v, end) {
    if (!audio || growth.data.muted) return;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, audio.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(10, end), audio.currentTime + d);
    g.gain.setValueAtTime(v, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, audio.currentTime + d);
    o.connect(g); g.connect(master);
    o.start(); o.stop(audio.currentTime + d);
  }

  function sound(kind) {
    audioReady();
    if (!audio || growth.data.muted) return;
    if (kind === 'level') { tone(420, .16, 'square', .10, 720); }
    if (kind === 'stage') { tone(300, .5, 'sawtooth', .16, 60); tone(151, .6, 'sine', .12, 40); }
    if (kind === 'pet') { tone(560, .13, 'sine', .11, 940); }
  }

  function shot(name) {
    if (!audio || growth.data.muted) return;
    if (name === 'claw' || name === 'tail') { tone(90, .13, 'sawtooth', .10, 30); }
    if (name === 'stomp') { tone(58, .4, 'sine', .16, 18); }
    if (name === 'roar') { tone(76, .8, 'sawtooth', .14, 26); }
    if (name === 'beam') { tone(110, .22, 'sawtooth', .07, 170); }
  }

  /* ---------------------------------------------------------------- *
   * 主循环
   * ---------------------------------------------------------------- */
  function frame(now) {
    const raw = last ? (now - last) / 1000 : 1 / 60;
    last = now;

    if (!document.hidden) {
      if (raw > 3) {                  // 长时间挂起后不追帧，改走离线结算
        const r = growth.offline(Date.now());
        if (r) showOffline(r);
        update(1 / 60, 1 / 60);
      } else {
        const wall = Math.min(raw, .2);
        update(Math.min(raw, .05), wall);
      }
      render();
    }
    requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------------- *
   * 启动
   * ---------------------------------------------------------------- */
  function boot() {
    growth = new A.Growth(load());
    targetHeight = growth.height;
    shownHeight = growth.height;

    // 普通浏览器预览时补一层深色底，否则透明画布上看不清构图
    if (!host) document.body.classList.add('preview');

    resize();
    generateCity();

    // 包围盒只依赖部件元数据与骨骼变换，不依赖图片是否加载完成，可以同步算出
    rigInfo = computeRigBox();
    ready = true;

    skeleton = new R.Skeleton();
    skeleton.loaded.then(() => { ready = skeleton.ready; });

    const report = growth.offline(Date.now());
    if (report) showOffline(report);
    updateUI(1);

    requestAnimationFrame(frame);
  }

  /* ---------------------------------------------------------------- *
   * 开发期调试入口
   *
   * QA 脚本靠它定格某个动作、直接跳到某个等级，从而逐个核对动画质量；
   * 人手在浏览器里预览时也用得上。不参与任何游戏逻辑，正常运行不会调用。
   * ---------------------------------------------------------------- */
  window.__petDebug = {
    snapshot: () => ({ ...canvas.dataset }),
    buildings: () => buildings.map((b) => ({
      slot: b.slot, tier: b.tier, x: Math.round(b.x),
      w: b.w, h: b.h, hp: Math.round(b.hp), dead: b.dead,
    })),
    setLevel(lv) {
      growth.data.level = Math.max(1, Math.floor(lv) || 1);
      growth.data.xp = 0;
      growth.data.seenStages = A.STAGES.filter((s) => s.min <= growth.data.level).map((s) => s.id);
      targetHeight = growth.height;
      shownHeight = growth.height;
      for (const key of buildings.keys()) buildings[key] = makeBuilding(buildings[key].slot);
    },
    /* 强制播放某个动作，并把目标楼摆到宠物正前方，便于逐帧核对 */
    force(name, slot) {
      const target = buildings.find((o) => !o.dead && (slot === undefined || o.slot === slot))
        || nearestBuilding();
      if (!target) return false;
      if (slot !== undefined) pet.x = clamp(standX(target, 1), DESIGN_W * 0.3, DESIGN_W * 0.7);
      begin(name, target);
      return true;
    },
    /* 冻结动作推进，配合 seek 定格某一帧用于逐帧核对 */
    freeze(on) { debugFrozen = on === true; },
    seek(t) { pet.action.t = Number(t) || 0; },
  };

  boot();
})();
