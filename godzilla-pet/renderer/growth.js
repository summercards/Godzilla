/* 巨兽都市桌宠 · 成长系统
 *
 * 纯逻辑模块，不依赖 DOM 与 Canvas，可直接被 node require 做确定性测试。
 * 设计目标：等级、经验、阶段、体型四者由同一套公式推导，任何时刻都可重算，
 * 因此存档只需要保存 level 与 xp，其余全部是派生值，不存在状态漂移。
 */
(function (root) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 体型曲线
   *
   * 屏幕上的身高（设计像素）。使用饱和曲线而不是分段台阶，理由是分段会让
   * "长大"变成几次跳变，而这条曲线每一级都在涨、涨幅逐级收窄：
   *
   *   1 级 62px → 10 级 75px → 25 级 90px → 50 级 103px → 90 级 114px
   *
   * 上限 140 不是随手取的，是窗口尺寸反推出来的：角色原图连尾巴的长宽比
   * 约 2.03:1（尾巴极长），而走动范围要求身体两侧至少各留几十像素，
   * 否则体型一大就会既被裁掉、又走不到楼边上。曲线渐近于 140 而永不触及，
   * 所以无论挂多久都不会撑破窗口。
   * ------------------------------------------------------------------ */
  const SIZE = {
    newborn: 62,   // 1 级身高
    ceiling: 140,  // 渐近上限，由窗口宽高比决定
    span: 44,      // 越大越平缓：达到上限一半所需等级约为 span
  };

  function bodyHeight(level) {
    const lv = Math.max(1, Math.floor(level) || 1);
    const t = 1 - 1 / (1 + (lv - 1) / SIZE.span);
    return SIZE.newborn + (SIZE.ceiling - SIZE.newborn) * t;
  }

  /* ------------------------------------------------------------------ *
   * 成长阶段
   *
   * 每个阶段解锁一项能力，同时抬高城市高度上限。两者必须同步推进：
   * 只解锁能力而城市不长高，玩家看不到变化；只长高而能力不变，会卡住进度。
   * ------------------------------------------------------------------ */
  const STAGES = [
    {
      id: 'hatchling', name: '幼体', en: 'HATCHLING', min: 1,
      unlock: 'claw', cityTier: 1,
      blurb: '刚孵化的小家伙，只能拍碎路边的平房。',
    },
    {
      id: 'juvenile', name: '少年', en: 'JUVENILE', min: 10,
      unlock: 'roar', cityTier: 2,
      blurb: '学会了咆哮，声波能震裂矮楼的墙皮。',
    },
    {
      id: 'adolescent', name: '青年', en: 'ADOLESCENT', min: 25,
      unlock: 'beam', cityTier: 3,
      blurb: '背鳍亮起蓝光，原子吐息开始成型。',
    },
    {
      id: 'mature', name: '成熟', en: 'MATURE', min: 50,
      unlock: 'stomp', cityTier: 3,
      blurb: '每一次落脚都在改写街区的地形。',
    },
    {
      id: 'apex', name: '完全体', en: 'APEX', min: 90,
      unlock: 'tail', cityTier: 4,
      blurb: '尾部横扫所过之处，再无完整的高楼。',
    },
  ];

  // 能力解锁表：阶段到达即拥有，不再回退。爪击是初始能力。
  const ABILITY_LEVEL = { claw: 1, roar: 10, beam: 25, stomp: 50, tail: 90 };

  function stageOf(level) {
    const lv = Math.max(1, Math.floor(level) || 1);
    let found = STAGES[0];
    for (const s of STAGES) if (lv >= s.min) found = s;
    return found;
  }

  function unlocked(level) {
    const lv = Math.max(1, Math.floor(level) || 1);
    return Object.keys(ABILITY_LEVEL).filter(k => lv >= ABILITY_LEVEL[k]);
  }

  function has(level, ability) {
    return Math.max(1, Math.floor(level) || 1) >= (ABILITY_LEVEL[ability] || Infinity);
  }

  /* ------------------------------------------------------------------ *
   * 经验
   * ------------------------------------------------------------------ */
  // 升级需求。指数 1.36 让前几级几乎立刻到手（有即时反馈），后期缓慢拉长。
  function nextXP(level) {
    return Math.round(26 * Math.pow(Math.max(1, Math.floor(level) || 1), 1.36));
  }

// 挂机基础产速（经验 / 秒）。随等级小幅提高，避免高等级时彻底停滞。
// 与 bodyHeight / wreckXP 一致，先把等级钳到 1，避免非法存档算出不符合直觉的产速。
function idleRate(level) {
  return 1.6 + Math.max(1, Math.floor(level) || 1) * 0.1;
}

  // 拆楼收益。按建筑档次给，且随等级线性放大，保证高等级时拆楼仍是主要来源。
  const TIER_XP = { 1: 8, 2: 20, 3: 45, 4: 90 };
  function wreckXP(tier, level) {
    const base = TIER_XP[tier] || TIER_XP[1];
    return Math.round(base * (1 + (Math.max(1, Math.floor(level) || 1) - 1) * 0.03));
  }

  // 摸头奖励，带冷却，防止连点刷级。
  const PET_XP = 6;
  const PET_COOLDOWN = 4;

  /* ------------------------------------------------------------------ *
   * 建筑档次
   *
   * 尺寸与窗口（320 宽 / 地面在 214）配套：最高的高楼略矮于宠物成年身高，
   * 这样"城市随宠物一起长高"看得出来，又不至于喧宾夺主。
   * ------------------------------------------------------------------ */
  const BUILDINGS = {
    1: { name: '平房', hp: 16, w: [18, 24], h: [18, 28], floors: 2 },
    2: { name: '小楼', hp: 40, w: [20, 28], h: [30, 46], floors: 4 },
    3: { name: '大楼', hp: 95, w: [24, 34], h: [48, 72], floors: 6 },
    4: { name: '高楼', hp: 200, w: [26, 38], h: [76, 104], floors: 9 },
  };

  /* ------------------------------------------------------------------ *
   * 存档
   * ------------------------------------------------------------------ */
  function defaults() {
    return {
      version: 1,
      level: 1,
      xp: 0,
      wrecks: 0,      // 累计拆除建筑
      pets: 0,        // 累计被摸次数
      seconds: 0,     // 累计陪伴时长（秒）
      muted: true,
      paused: false,
      clickThrough: false,
      lastSeen: Date.now(),
      seenStages: ['hatchling'],
    };
  }

  const num = (v, d, min, max) =>
    Number.isFinite(+v) ? Math.min(max, Math.max(min, +v)) : d;

  function sanitize(raw) {
    const a = defaults();
    if (!raw || typeof raw !== 'object' || raw.version !== 1) return a;
    a.level = Math.floor(num(raw.level, 1, 1, 9999));
    a.xp = num(raw.xp, 0, 0, 1e15);
    a.wrecks = Math.floor(num(raw.wrecks, 0, 0, 1e12));
    a.pets = Math.floor(num(raw.pets, 0, 0, 1e12));
    a.seconds = num(raw.seconds, 0, 0, 1e12);
    a.muted = raw.muted !== false;
    a.paused = raw.paused === true;
    a.clickThrough = raw.clickThrough === true;
    a.lastSeen = num(raw.lastSeen, Date.now(), 0, Date.now());
    // 已完成阶段只增不减，避免存档被改小后重放阶段提示
    const valid = new Set(STAGES.map(s => s.id));
    a.seenStages = Array.isArray(raw.seenStages)
      ? [...new Set(raw.seenStages.filter(id => valid.has(id)))]
      : ['hatchling'];
    if (!a.seenStages.includes('hatchling')) a.seenStages.unshift('hatchling');
    return a;
  }

  /* ------------------------------------------------------------------ *
   * 主体
   * ------------------------------------------------------------------ */
  class Growth {
    constructor(raw) {
      this.data = sanitize(raw);
      this.events = [];       // 供渲染层消费后清空
      this.petClock = 0;      // 摸头冷却计时
    }

    // ---- 派生值 ----
    get level() { return this.data.level; }
    get stage() { return stageOf(this.data.level); }
    get height() { return bodyHeight(this.data.level); }
    get next() { return nextXP(this.data.level); }
    get progress() { return Math.min(1, this.data.xp / this.next); }
    get cityTier() { return this.stage.cityTier; }
    get rate() { return idleRate(this.data.level); }
    abilities() { return unlocked(this.data.level); }
    can(ability) { return has(this.data.level, ability); }

    /* 累计总经验，仅用于展示与排行，不参与任何计算 */
    totalXP() {
      let sum = 0;
      for (let l = 1; l < this.data.level; l++) sum += nextXP(l);
      return sum + this.data.xp;
    }

    /* 距离下一级还需要的挂机时间（秒），用于悬停卡片显示 */
    etaSeconds() {
      if (this.data.paused) return Infinity;
      return (this.next - this.data.xp) / this.rate;
    }

    /* 给经验并处理连续升级。返回本次升级的级数，便于渲染层放特效。 */
    gain(amount) {
      if (!Number.isFinite(amount) || amount <= 0) return 0;
      const d = this.data;
      d.xp += amount;
      let gained = 0;
      let guard = 0;
      while (d.xp >= nextXP(d.level) && guard++ < 500) {
        d.xp -= nextXP(d.level);
        d.level++;
        gained++;
        const st = stageOf(d.level);
        const isNewStage = !d.seenStages.includes(st.id);
        if (isNewStage) d.seenStages.push(st.id);
        this.events.push({
          type: isNewStage ? 'stage' : 'level',
          level: d.level,
          stage: st,
        });
      }
      // 极端的存档异常（例如经验巨量溢出）时兜底，防止死循环
      if (guard >= 500) d.xp = 0;
      return gained;
    }

    /* 拆除一栋建筑。tier 决定收益，由渲染层按实际建筑档次传入。 */
    wreck(tier) {
      this.data.wrecks++;
      return this.gain(wreckXP(tier, this.data.level));
    }

    /* 摸头。冷却内返回 false，渲染层据此决定是否播放反应动画。 */
    pet() {
      if (this.petClock > 0) return false;
      this.petClock = PET_COOLDOWN;
      this.data.pets++;
      this.gain(PET_XP);
      return true;
    }

    /* ---- 推进 ---- */
    tick(dt) {
      if (!(dt > 0)) return;
      this.petClock = Math.max(0, this.petClock - dt);
      this.data.seconds += dt;
      if (this.data.paused) return;
      this.gain(this.rate * dt);
    }

    /* 离线结算：只给经验，不伪造拆楼与时长，最多 8 小时、效率 55%。 */
    offline(now) {
      const elapsed = Math.max(0, (now - this.data.lastSeen) / 1000);
      this.data.lastSeen = now;
      if (elapsed < 60) return null;         // 短暂停顿不打扰
      const seconds = Math.min(28800, elapsed);
      const amount = seconds * this.rate * 0.55;
      const levels = this.gain(amount);
      return { seconds, amount, levels, capped: elapsed >= 28800 };
    }

    serialize(now) {
      this.data.lastSeen = now;
      return JSON.stringify(this.data);
    }
  }

  const api = {
    Growth, STAGES, SIZE, BUILDINGS, ABILITY_LEVEL, TIER_XP,
    PET_XP, PET_COOLDOWN,
    bodyHeight, stageOf, unlocked, has, nextXP, idleRate, wreckXP,
    defaults, sanitize,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PetGrowth = api;
})(typeof window !== 'undefined' ? window : this);
