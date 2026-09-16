#!/bin/sh
# 巨兽都市桌宠 · 生成并安装可双击的 .app
#
# 用法：sh build/make-app.sh [安装目录]     默认 ~/Applications
#
# ── 为什么要包一层 .app ───────────────────────────────────────────────
# Electron 必须把「项目目录」作为第一个参数才能加载我们的主进程。但通过
# LaunchServices 启动时（双击 / open / 登录项），macOS 会自己往 argv 里插参数，
# 我们想传的路径根本到不了 Electron，它认不出应用目录，就退回自带的欢迎页
# （"To run a local app, execute the following on the command line..."）。
#
#   实测：open -a Electron.app --args <项目目录>  → 只出欢迎页，main.js 不执行
#   实测：launchctl submit（argv 完全可控）       → 被沙箱拒绝，不可用
#
# 所以把启动器做成 .app 的 CFBundleExecutable，argv 完全由我们自己拼。
#
# ── 为什么必须装在 ~/Documents 之外 ───────────────────────────────────
# 这不是洁癖，是硬约束。同一个包：
#
#   放在   ~/Documents/.../godzilla-pet/dist/  → 主进程活着，但不起任何
#         渲染/GPU 子进程，窗口不出现，也从不写存档；零报错、零日志，看起来
#         像"卡住了"。lsof 能看到它已加载 Electron Framework，就是走不下去。
#   放在   ~/Applications/                     → 一切正常
#
# 原因是 macOS 的「文稿」隐私保护：位于受保护目录内的 app 包，读取自身
# 资源会被拦，而 Chromium 要 fork 渲染/GPU 子进程，于是卡死在启动早期。
# 所以安装目标是 ~/Applications（桌面应用本来就该待的地方），而不是项目内。
set -eu

HERE="$(cd "$(dirname "$0")/.." && pwd)"                 # = godzilla-pet
TARGET_DIR="${1:-$HOME/Applications}"
OUT="$TARGET_DIR/巨兽都市桌宠.app"
ELECTRON="$HERE/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"

if [ ! -x "$ELECTRON" ]; then
  echo "找不到 Electron：$ELECTRON" >&2
  echo "先在 $HERE 执行 npm install" >&2
  exit 1
fi

# 重装时先停掉已经在跑的实例：单实例锁会让新启动的那个直接退出，
# 用户会以为"双击没反应"。
# 只在目标位置已经有包时才停——首次安装不会有东西在跑，装到临时目录做测试
# 时也不会误杀用户正在看的那个。
# 匹配用 Electron 可执行文件的完整路径，比按应用名匹配精确，
# 不会误伤命令行里恰好提到"巨兽都市桌宠"的其他进程。
if [ -d "$OUT" ] && pgrep -f "$HERE/node_modules/electron/dist/Electron.app" >/dev/null 2>&1; then
  pkill -f "$HERE/node_modules/electron/dist/Electron.app" 2>/dev/null || true
  sleep 1
fi

mkdir -p "$TARGET_DIR"
rm -rf "$OUT"
mkdir -p "$OUT/Contents/MacOS" "$OUT/Contents/Resources"

# ---- 启动器 ------------------------------------------------------------
# 1) 打包时把项目目录写死——包一旦离开项目目录，相对路径就失效了；
# 2) 留一条相对回退，万一把 .app 拷回项目里的 dist/ 也能用；
# 3) 两条都失效时弹一个说人话的提示，而不是静默退出。
#
# CFBundleExecutable 用 ASCII 名（launch），界面上的名字交给 Info.plist，
# 可执行文件名带中文容易在某些工具链上出幺蛾子。
cat > "$OUT/Contents/MacOS/launch" <<LAUNCHER
#!/bin/sh
# 由 build/make-app.sh 生成，不要手改。
set -eu
PROJ="$HERE"
ELECTRON="\$PROJ/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [ ! -x "\$ELECTRON" ]; then
  # 回退：包被放回了项目里的 dist/
  ALT="\$(cd "\$(dirname "\$0")/../../../.." 2>/dev/null && pwd || true)"
  if [ -n "\$ALT" ] && [ -x "\$ALT/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" ]; then
    PROJ="\$ALT"
    ELECTRON="\$PROJ/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
  fi
fi
if [ ! -x "\$ELECTRON" ]; then
  osascript -e 'display alert "巨兽都市桌宠" message "找不到 Electron 运行时。\n项目目录可能被移动了，请重新执行：\n\n  sh build/make-app.sh"' >/dev/null 2>&1 || true
  exit 1
fi
exec "\$ELECTRON" "\$PROJ"
LAUNCHER
chmod +x "$OUT/Contents/MacOS/launch"

# ---- 图标（可选）--------------------------------------------------------
ICON_KEY=""
SRC_ICON="$HERE/assets/appicon.png"
if [ -f "$SRC_ICON" ] && command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
  TMP="$(mktemp -d)"
  ISET="$TMP/AppIcon.iconset"
  mkdir -p "$ISET"
  # iconutil 只认这套固定文件名
  for spec in "16 16x16" "32 16x16@2x" "32 32x32" "64 32x32@2x" \
              "128 128x128" "256 128x128@2x" "256 256x256" "512 256x256@2x" \
              "512 512x512" "1024 512x512@2x"; do
    px="${spec%% *}"; name="${spec##* }"
    sips -z "$px" "$px" "$SRC_ICON" --out "$ISET/icon_${name}.png" >/dev/null 2>&1
  done
  if iconutil -c icns "$ISET" -o "$OUT/Contents/Resources/AppIcon.icns" >/dev/null 2>&1; then
    ICON_KEY='  <key>CFBundleIconFile</key><string>AppIcon</string>'
  fi
  rm -rf "$TMP"
fi

# ---- Info.plist ---------------------------------------------------------
# LSUIElement：这是个菜单栏挂件，不出现在 Dock 和 Cmd-Tab 里。
# （main.js 里也调了 app.dock.hide()，两边都做，谁先生效都不怕。）
cat > "$OUT/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIdentifier</key><string>com.summercards.godzilla-pet</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>巨兽都市桌宠</string>
  <key>CFBundleDisplayName</key><string>巨兽都市桌宠</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>2.6.0</string>
  <key>CFBundleVersion</key><string>26</string>
$ICON_KEY
  <key>LSMinimumSystemVersion</key><string>10.15</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# 让 LaunchServices 立刻认识这个包
touch "$OUT"

echo "已安装：$OUT"
echo "双击即可运行，或：open \"$OUT\""
if [ "$TARGET_DIR" = "$HERE" ] || [ "$TARGET_DIR" = "$HERE/dist" ]; then
  echo ""
  echo "⚠️  装在项目目录里（尤其 ~/Documents 下）会因为系统隐私保护而起不来。" >&2
  echo "    建议改用默认位置：sh build/make-app.sh" >&2
fi
