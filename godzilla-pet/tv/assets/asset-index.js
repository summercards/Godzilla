/* ------------------------------------------------------------------ *
 * asset-index.js —— 资产位置与清单的唯一真相
 *
 * 这个文件只回答两个问题：资产放在哪（路径），有哪些（清单）。
 * 它不含任何绘制逻辑、不含价格/血量等数值，也不含形态与轴的定义
 * （那是 appearance.js 的事）。
 *
 * 目录约定见 docs/资产规范.md，三大类各自独立：
 *   assets/monsters/<怪兽>/                 怪兽本体
 *   assets/enemies/<阵营>/<单位>/            敌对单位
 *   assets/buildings/<幕>/<建筑种类>/         建筑
 *
 * 浏览器用 <script src> 加载，Node 用 require —— 沿用项目既有的 UMD 写法。
 * ------------------------------------------------------------------ */
(function (root) {
  'use strict';

  const ROOT = 'assets';
  const MONSTER_DIR = 'monsters';
  const ENEMY_DIR = 'enemies';
  const BUILDING_DIR = 'buildings';

  /** 骨骼槽：与 rig.js 的 12 个变换节点一一对应。
   *  这些名字同时就是 parts/ 下的目录名，改名等于改骨骼契约，
   *  必须同步跑 build/derive-rig.cjs 与全量回归。
   *  绘制顺序不在这里 —— 那是装配顺序，归 rig.json 的 order 管。 */
  const SLOTS = ['tail_tip', 'tail_mid', 'tail_base', 'far_thigh', 'far_shin', 'torso', 'thigh', 'shin', 'upper_arm', 'forearm', 'jaw', 'head'];

  /** 装饰槽：不参与骨骼，叠加在身体之上。
   *  目前由 game.js 的 drawMorph() 程序化绘制，未来可换成同结构的贴图资产。
   *  它们是"进化过程中会变化的部分"，因此必须在框架里有正式名字。 */
  const DECOR_SLOTS = ['spikes', 'plates', 'horns', 'eye', 'aura', 'claw', 'tail_fin'];

  const join = (...p) => p.filter(Boolean).join('/');

  /* ---------------- 怪兽 ---------------- *
   * forms 指向形态样式集的落点；每个形态下每个骨骼槽可以有自己的贴图目录，
   * 缺图时按 appearance.js 的样式回退链退到 default。 */
  const MONSTERS = {
    godzilla: {
      id: 'godzilla',
      name: '哥斯拉',
      alias: 'Godzilla',
      label: {
        /* 界面里显示的体型档位名，随等级推进（EPOCHS 的呈现层）。 */
        juvenile: '幼兽', subadult: '亚成体', adult: '成体', perfect: '完全体', cataclysm: '灾厄体',
      },
      slots: SLOTS,
      decorSlots: DECOR_SLOTS,
      defaultStyle: 'default',
      files: {
        sourceImage: 'source/godzilla-pixel.png',   // 母图：拆件与 QA 复现的唯一来源
        atlas: 'source/parts.json',                 // 母图空间裁切元数据（手写）
        rig: 'rig.json',                            // 运行空间骨骼数据（生成）
        rigRuntime: 'rig.data.js',                  // 同上，浏览器可直接加载的形态（生成）
      },
      /** 已存在的样式，用于校验：某个形态引用了不存在的样式必须在测试里报错。 */
      styles: {
        default: { label: '原图重组基准' }, nofin: { label: '互补拆层身体（仅校验）' },
        fin: { label: '互补背鳍层（仅校验）' }, clean: { label: '玄岩幼兽' },
        jade: { label: '翠岩' }, frost: { label: '霜蓝' },
        ember: { label: '熔岩' }, void: { label: '紫晶' },
      },
      finSprites: {
        crown: { path: 'fins/crown.png', anchor: [0.5654, 1] },
        blade: { path: 'fins/blade.png', anchor: [0.777, 1] },
      },
    },
  };

  /* ---------------- 敌人 ---------------- *
   * faction 目录下按单位分目录；每个单位声明自己的部件槽。
   * source:'procedural' 表示当前由代码矢量绘制，尚未落成贴图。
   * 一旦单位目录里出现 parts/<部件>/<样式>.png，把 source 改成对应值即可，
   * 游戏侧不需要改代码。 */
  const ENEMY_FACTIONS = {
    army: { id: 'army', name: '防卫军', color: '#617132' },
  };

  const ENEMY_UNITS = {
    tank: { faction: 'army', label: '主战坦克', slots: ['track', 'hull', 'turret', 'barrel'], source: 'procedural', renderer: 'drawTank' },
    heli: { faction: 'army', label: '武装直升机', slots: ['tailboom', 'fuselage', 'rotor', 'stub_wing'], source: 'procedural', renderer: 'drawHeli' },
    rocket: { faction: 'army', label: '火箭炮车', slots: ['track', 'hull', 'launcher'], source: 'procedural', renderer: 'drawTank' },
    gunship: { faction: 'army', label: '重装武装直升机', slots: ['tailboom', 'fuselage', 'rotor', 'stub_wing', 'pod'], source: 'procedural', renderer: 'drawGunship' },
    aegis: { faction: 'army', label: '电磁装甲车', slots: ['track', 'hull', 'railgun', 'emitter'], source: 'procedural', renderer: 'drawAegis' },
    mech: { faction: 'army', label: '重型攻城机甲', slots: ['leg', 'torso', 'arm', 'cannon'], source: 'procedural', renderer: 'drawMech' },
    jet: { faction: 'army', label: '喷气战机', slots: ['fuselage', 'wing', 'canopy'], source: 'procedural', renderer: 'drawJet' },
    drone: { faction: 'army', label: '侦察无人机', slots: ['body', 'rotor', 'camera'], source: 'procedural', renderer: 'drawDrone' },
    walker: { faction: 'army', label: '四足攻城兽', slots: ['leg', 'body', 'core'], source: 'procedural', renderer: 'drawWalker' },
    sentinel: { faction: 'army', label: '银曜巨人 · 关底 BOSS', slots: ['head', 'torso', 'arm', 'forearm', 'far_arm', 'far_forearm', 'thigh', 'shin', 'far_thigh', 'far_shin', 'foot', 'far_foot'], source: 'imagegen_skeletal', renderer: 'drawSentinel' },
    bunker: { faction: 'army', label: '要塞炮台', slots: ['base', 'turret', 'barrel'], source: 'procedural', renderer: 'drawBunker' },
  };

  /* ---------------- 建筑 ---------------- *
   * 按 STAGES 的幕（village/suburb/city）分目录，幕内按建筑种类分目录。
   * 同敌人：source:'procedural' 是"尚未落贴图"的显式标记，不是占位符。 */
  const BUILDING_KINDS = {
    village: {
      label: '现代村庄',
      kinds: {
        house: { label: '民房', slots: ['wall', 'roof', 'window', 'door', 'sign'], source: 'procedural', renderer: 'makeVillageBuilding' },
        shop: { label: '临街商铺', slots: ['wall', 'roof', 'awning', 'window', 'sign'], source: 'procedural', renderer: 'makeVillageBuilding' },
      },
    },
    suburb: {
      label: '城郊防线',
      kinds: {
        house: { label: '民房', slots: ['wall', 'roof', 'window', 'door'], source: 'procedural', renderer: 'makeVillageBuilding' },
        shop: { label: '临街商铺', slots: ['wall', 'roof', 'awning', 'window', 'sign'], source: 'procedural', renderer: 'makeVillageBuilding' },
        midrise: { label: '低层公寓', slots: ['wall', 'roof', 'window', 'facade'], source: 'procedural', renderer: 'makeVillageBuilding' },
      },
    },
    city: {
      label: '城区核心',
      kinds: {
        tower: { label: '商业塔楼', slots: ['wall', 'crown', 'window', 'facade', 'neon'], source: 'procedural', renderer: 'makeBuilding' },
        block: { label: '街区大楼', slots: ['wall', 'crown', 'window', 'facade'], source: 'procedural', renderer: 'makeBuilding' },
      },
    },
  };

  /* ---------------- 路径构造 ---------------- */

  const dir = {
    monsters: () => join(ROOT, MONSTER_DIR),
    monster: (monster) => join(ROOT, MONSTER_DIR, monster),
    monsterParts: (monster, slot) => join(ROOT, MONSTER_DIR, monster, 'parts', slot),
    enemies: () => join(ROOT, ENEMY_DIR),
    enemyFaction: (faction) => join(ROOT, ENEMY_DIR, faction),
    enemy: (faction, unit) => join(ROOT, ENEMY_DIR, faction, unit),
    buildings: () => join(ROOT, BUILDING_DIR),
    buildingStage: (stage) => join(ROOT, BUILDING_DIR, stage),
    building: (stage, kind) => join(ROOT, BUILDING_DIR, stage, kind),
  };

  const file = {
    /** 某个怪兽某个槽位某个样式的部件贴图。 */
    monsterPart: (monster, slot, style) => join(dir.monster(monster), 'parts', slot, (style || 'default') + '.png'),
    monsterSourceImage: (monster) => join(dir.monster(monster), MONSTERS[monster].files.sourceImage),
    monsterAtlas: (monster) => join(dir.monster(monster), MONSTERS[monster].files.atlas),
    monsterRig: (monster) => join(dir.monster(monster), MONSTERS[monster].files.rig),
    monsterRigRuntime: (monster) => join(dir.monster(monster), MONSTERS[monster].files.rigRuntime),
    /** 敌人单位的部件贴图。 */
    enemyPart: (faction, unit, part, style) => join(dir.enemy(faction, unit), 'parts', part, (style || 'default') + '.png'),
    /** 建筑贴图。建筑按幕分目录，同一幕内可复用的部件放在 _shared/。 */
    buildingPart: (stage, kind, part, style) => join(dir.building(stage, kind), 'parts', part, (style || 'default') + '.png'),
    buildingShared: (stage, part, style) => join(dir.buildingStage(stage), '_shared', part, (style || 'default') + '.png'),
  };

  const api = {
    ROOT, MONSTER_DIR, ENEMY_DIR, BUILDING_DIR,
    SLOTS, DECOR_SLOTS, MONSTERS, ENEMY_FACTIONS, ENEMY_UNITS, BUILDING_KINDS,
    dir, file,
    monster: (id) => MONSTERS[id] || null,
    enemyUnit: (type) => ENEMY_UNITS[type] || null,
    buildingKind: (stage, kind) => (BUILDING_KINDS[stage] && BUILDING_KINDS[stage].kinds[kind]) || null,
    /** 敌人单位的资产路径前缀，game.js 用它给单位打 assetId。 */
    enemyAssetId: (type, style) => {
      const u = ENEMY_UNITS[type];
      return u ? join(ENEMY_DIR, u.faction, type) + (style && style !== 'default' ? '#' + style : '') : null;
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KaijuAssets = api;
})(typeof window !== 'undefined' ? window : this);
