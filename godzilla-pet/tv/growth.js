/* ------------------------------------------------------------------ *
 * growth.js —— 成长系统的单一真源
 *
 * 三条链路在这里各自只有一个出处，改数值只改本文件：
 *
 *   等级 → 体型         BODY    baseScale() / bodyScale()
 *   等级 → 体征解锁     GATES   unlocked() / spineCount()
 *   等级 → 战斗数值     COMBAT  districtScale()
 *
 * 设计约定（2026-09-17 定，后续策划案接这里）：
 *   · 1 级就是初始形态：初始体型、初始攻击力、**一根背鳍都没有**；
 *   · 体型随等级一路慢慢变大，不是"前几级长满、之后不动"；
 *   · 背鳍 15 级才出现；随机背鳍（分叉 / 加粗 / 增多）一律限 15 级之后；
 *   · 受击盒必须跟着体型走。几何在 rig.js 的 hitbox()，这里只给体型系数 ——
 *     原来瞄准点与命中判定都按满体型写死，小体型时子弹全打在空中。
 *
 * ⚠️ 两条硬边界，动之前先读：
 *   ① 总上限 CEIL = 1.12。再大就会盖住页眉或底部新闻条（渲染层约束）。
 *   ② 体型绕**脚底锚点**缩放（见 rig.js 的 pose()/scaleRig()）。
 *      所以受击盒也必须绕同一个锚点缩放，否则小体型一定被打在空中。
 * ------------------------------------------------------------------ */
(function (root) {
  'use strict';

  const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

  /* ------------------------------------------------------------------ *
   * 1 · 体型
   *
   * 公式：形态区间之间分段线性，区间写在 progression.js 的 EPOCHS[].scale。
   *
   *   base(L) = lo + (hi - lo) × (L - 本档 min) / (下一档 min - 本档 min)
   *
   *   幼兽   1 → 25    0.34 → 0.58      L1  = 0.34（初始体型）
   *   亚成体 25 → 50   0.58 → 0.76      L15 = 0.48
   *   成体   50 → 75   0.76 → 0.90      L25 = 0.58
   *   完全体 75 → 100  0.90 → 1.00      L50 = 0.76
   *   灾厄体 100+      1.00（基础饱和） L100 = 1.00
   *
   * 为什么改成线性：老公式 0.333 + 0.667×(1-e^(-(L-1)/9)) 在 L15 就到 0.86，
   * 之后基本不动 —— 观感上只有前 15 级在长。线性让每一档都有肉眼可见的成长，
   * 也让"形态"这件事在体型上有对应的分量。
   *
   * 基础体型到 1.00 封顶，继续长靠天赋 / 突变（grow 因子），总上限 CEIL。
   * ------------------------------------------------------------------ */
  const CEIL = 1.12;

  function baseScale(level, epochs) {
    const L = Math.max(1, Number(level) || 1);
    if (!Array.isArray(epochs) || !epochs.length) return 1;
    let i = 0;
    for (let k = 0; k < epochs.length; k++) if (L >= epochs[k].min) i = k;
    const cur = epochs[i];
    const span = Array.isArray(cur.scale) ? cur.scale : [1, 1];
    const lo = Number(span[0]) || 1;
    const hi = Number(span[1] == null ? lo : span[1]) || lo;
    const next = epochs[i + 1];
    /* 最后一档没有"下一档 min"可插值，直接停在区间上限。 */
    if (!next) return hi;
    const from = Number(cur.min) || 1;
    const to = Number(next.min) || from;
    const t = to > from ? clamp01((L - from) / (to - from)) : 1;
    return lo + (hi - lo) * t;
  }

  /* 天赋 / 突变对体型的乘数。与等级解耦 —— 这是"额外挂件"，不是成长主线。 */
  function growFactor(talents, morph) {
    const t = talents || {};
    const m = morph || {};
    return 1
      + 0.02 * (t.mass || 0)
      + 0.03 * (t.magma || 0)
      + 0.03 * (m.colossal || 0)
      + (m.extraScale || 0);
  }

  /** 最终体型系数。渲染层与受击盒都只认这一个值。 */
  function bodyScale(level, talents, morph, epochs) {
    return Math.min(CEIL, baseScale(level, epochs) * growFactor(talents, morph));
  }

  /* ------------------------------------------------------------------ *
   * 2 · 体征解锁
   *
   * 每个体征一个等级门槛。低于门槛时，解算层一律给"没有"，
   * 不依赖突变池是否抽到 —— 抽到了也不该提前长出来（旧档尤其如此）。
   * ------------------------------------------------------------------ */
  const GATES = {
    spines: 15,   // 背鳍：出现、分叉、加粗、增多，全部在这条线之后
  };

  /* 等级够不够某个体征的门槛。
   *
   * ⚠️ 未登记的 feature 一律**不解锁**，不是"无门槛"。
   * 老写法是 `(GATES[feature] || 0)` —— 策划案把 'spines' 敲成 'spine' 时
   * 会拿到门槛 0，于是"任何等级都解锁"，而且**零报错**：画面照跑，
   * 只是 1 级就长出了背鳍。门禁是对玩家的外观承诺，静默失效比报错难查得多。
   * 要对某个体征表达"没有门槛"，就显式登记成 0（那是被记录的意图，不是兜底）。 */
  function unlocked(feature, level) {
    if (!Object.prototype.hasOwnProperty.call(GATES, feature)) return false;
    return (Number(level) || 1) >= GATES[feature];
  }

  /* 背鳍根数：15 级起 2 根，之后每 12 级 +1。
   *   L15 = 2   L27 = 3   L39 = 4   L51 = 5   L63 = 6
   *   L75 = 7   L87 = 8   L99 = 9（与旧"灾厄体 9 根"的观感对齐）
   * 天赋与突变只做加法，不改变解锁门槛本身。 */
  const SPINE = { base: 2, step: 12 };

  function spineCount(level, bonus = 0) {
    if (!unlocked('spines', level)) return 0;
    const extra = Math.floor((Number(level) - GATES.spines) / SPINE.step);
    return SPINE.base + Math.max(0, extra) + Math.max(0, Number(bonus) || 0);
  }

  /* ------------------------------------------------------------------ *
   * 3 · 战斗数值
   *
   * "攻击力回到初始状态"：伤害不再随**等级**膨胀（老公式乘了
   * mult() = 1 + (L-1)×0.07，50 级时是初始的 4.4 倍）。
   * 改由**区域**推进驱动，系数与建筑耐久同源。
   *
   *   power(L, district) = base(L的加点) × (1 + (district-1) × DISTRICT.coef)
   *
   * 把 districtScaling 关掉就是纯初始状态；把 levelScaling 打开可回退旧行为。
   * ------------------------------------------------------------------ */
  /* 区域强度系数 —— 巨兽伤害与建筑耐久**共用这一个数**。
   *
   * 为什么必须同源：建筑耐久 = 基础值 × (1+(d-1)×本系数)（见 game.js 的
   * generateWorld 用 P.Kb），巨兽伤害也乘同一个倍率。两边一旦分叉，
   * 走上几十个区域就会显形：要么建筑成了纸糊的，要么后期怎么打都打不动。
   *
   * 所以这个数只写一份，progression.js 的 Kb 直接读它（那边不再写 0.22）。
   * 注意 Kb 取的是**系数**而不是 districtScale() —— 后者受 districtScaling
   * 开关管辖（那个开关只该影响巨兽伤害），建筑耐久曲线不该被它连坐。 */
  const DISTRICT = { coef: 0.22 };

  const COMBAT = {
    levelScaling: false,      // 等级是否放大伤害
    districtScaling: true,    // 区域是否放大伤害
  };

  function districtScale(district) {
    if (!COMBAT.districtScaling) return 1;
    const d = Math.max(1, Number(district) || 1);
    return 1 + (d - 1) * DISTRICT.coef;
  }

  /* 等级对伤害的乘数。levelScaling 关掉时恒为 1 —— 这就是"回到初始状态"。 */
  function levelMult(level) {
    if (!COMBAT.levelScaling) return 1;
    return 1 + (Math.max(1, Number(level) || 1) - 1) * 0.07;
  }

  /* ------------------------------------------------------------------ *
   * 4 · 受击盒
   *
   * 几何真源在 rig.js：BIND_BOUNDS（从骨骼数据推出的 bind pose 包围盒）
   * 与 hitbox(bs, x, ground)（绕脚底锚点缩放，与 scaleRig() 同一个锚点）。
   * 本文件不重复实现，只负责保证喂进去的体型系数与 bodyScale() 是同一个值。
   * ------------------------------------------------------------------ */

  const api = {
    CEIL, GATES, SPINE, COMBAT, DISTRICT,
    baseScale, growFactor, bodyScale,
    unlocked, spineCount,
    districtScale, levelMult,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KaijuGrowth = api;
})(typeof window !== 'undefined' ? window : this);
