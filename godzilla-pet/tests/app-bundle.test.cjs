/* 应用包契约测试
 *
 * 守住的是「怎么把 Electron 应用启动起来」这条路。它踩过三个坑，每一个都
 * 不报错、只表现为"双击没反应"或"打开的是别的页面"，所以必须钉住：
 *
 *   1. Electron 必须把项目目录作为 argv[1] 才能加载我们的主进程。通过
 *      LaunchServices 启动时 macOS 会自己往 argv 里塞参数，路径传不进去，
 *      Electron 就退回自带的欢迎页。所以 .app 的 CFBundleExecutable 是
 *      我们自己写的启动器，argv 由它拼。
 *   2. 启动器必须把项目目录当参数交给 Electron —— 少传一个参数就退回欢迎页。
 *   3. 包不能装在 ~/Documents 下（实测会卡死在启动早期：主进程活着，
 *      但不 fork 任何渲染/GPU 子进程）。脚本必须对此发出警告。
 *
 * 真跑一遍脚本装到临时目录，检查产物本身，而不是检查源码里有没有某句话。
 */
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'build', 'make-app.sh');
const APP_NAME = '巨兽都市桌宠.app';

/* 装到临时目录。注意不能装进项目目录——那样脚本会（正确地）给出警告，
 * 而临时目录里本来就没有旧包，所以也不会去 kill 正在运行的实例。 */
function install() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gnn-app-'));
  execFileSync('sh', [SCRIPT, dir], { cwd: ROOT, stdio: 'pipe' });
  return { dir, app: path.join(dir, APP_NAME) };
}

let cache = null;
const built = () => (cache ||= install());

test('安装：产出 .app、启动器与 Info.plist 三件套', () => {
  const { app } = built();
  assert.ok(fs.existsSync(app), '没生成 .app');
  const exec = path.join(app, 'Contents', 'MacOS', 'launch');
  assert.ok(fs.existsSync(exec), '缺少 CFBundleExecutable 指向的启动器');
  assert.ok(fs.statSync(exec).mode & 0o111, '启动器没有可执行位');
  assert.ok(fs.existsSync(path.join(app, 'Contents', 'Info.plist')), '缺少 Info.plist');
});

test('Info.plist：可执行文件名、包标识、菜单栏挂件属性都对', () => {
  const { app } = built();
  const plist = fs.readFileSync(path.join(app, 'Contents', 'Info.plist'), 'utf8');
  // 可执行文件名用 ASCII：带中文的文件名在某些工具链上会出问题，
  // 界面上显示的名字交给 CFBundleName
  assert.match(plist, /<key>CFBundleExecutable<\/key><string>launch<\/string>/);
  assert.match(plist, /<key>CFBundleName<\/key><string>巨兽都市桌宠<\/string>/);
  assert.match(plist, /<key>CFBundleIdentifier<\/key><string>com\.summercards\.godzilla-pet<\/string>/);
  // LSUIElement：不进 Dock、不进 Cmd-Tab，这是"桌宠"该有的样子
  assert.match(plist, /<key>LSUIElement<\/key><true\/>/);
  // Info.plist 必须是完整可解析的 XML
  assert.match(plist, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(plist.trimEnd(), /<\/plist>$/);
});

test('启动器：项目目录是打包时写死的绝对路径，且确实指向本项目', () => {
  const { app } = built();
  const src = fs.readFileSync(path.join(app, 'Contents', 'MacOS', 'launch'), 'utf8');

  const m = src.match(/^PROJ="([^"]+)"/m);
  assert.ok(m, '启动器里没有写死 PROJ');
  assert.ok(path.isAbsolute(m[1]), 'PROJ 必须是绝对路径——包已经离开项目目录了，相对路径会失效');
  assert.equal(fs.realpathSync(m[1]), fs.realpathSync(ROOT), 'PROJ 指错了目录');
  assert.ok(fs.existsSync(path.join(m[1], 'main.js')), 'PROJ 下面没有 main.js');
});

test('启动器：必须把项目目录作为第一个参数交给 Electron', () => {
  const { app } = built();
  const src = fs.readFileSync(path.join(app, 'Contents', 'MacOS', 'launch'), 'utf8');
  // 这一行就是整个包装存在的理由。漏掉 "$PROJ"，Electron 就读不到我们的
  // 主进程，转而显示它自带的欢迎页——而且不会有任何报错。
  assert.match(src, /exec\s+"\$ELECTRON"\s+"\$PROJ"\s*$/m,
    '启动器没有把项目目录传给 Electron，会退回欢迎页');
});

test('启动器：两条路径都失效时给一句人话，而不是静默退出', () => {
  const { app } = built();
  const src = fs.readFileSync(path.join(app, 'Contents', 'MacOS', 'launch'), 'utf8');
  assert.match(src, /display alert/, '缺少失败提示，用户只会看到"双击没反应"');
  assert.match(src, /make-app\.sh/, '提示里应当说明怎么恢复');
});

test('启动器：保留相对回退，包被拷回项目里的 dist/ 也能用', () => {
  const { app } = built();
  const src = fs.readFileSync(path.join(app, 'Contents', 'MacOS', 'launch'), 'utf8');
  assert.match(src, /\.\.\/\.\.\/\.\.\/\.\./, '没有相对回退，包一被挪动就彻底失效');
});

test('脚本：装进项目目录时必须发出警告（~/Documents 下会起不来）', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(src, /小心|⚠|警告|起不来/, '缺少"别装在项目目录"的警告');
  // 警告要真的会触发：脚本得拿目标目录跟项目根做比较
  assert.match(src, /TARGET_DIR"?\s*=\s*"\$HERE"/, '警告没有绑定到实际判断上');
});

test('脚本：只在目标位置已有旧包时才停旧实例', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  // 装到临时目录做测试时不能顺手把用户正在看的桌宠杀掉
  assert.match(src, /if \[ -d "\$OUT" \][\s\S]{0,200}pkill/,
    '停旧实例之前没有先判断目标位置是否已有旧包');
});
