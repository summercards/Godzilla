#!/usr/bin/env python3
"""巨兽都市桌宠 · 托盘图标生成

托盘图标只有 16px，细节一律会糊掉，所以这里不做写实哥斯拉，只保留三个
一眼可辨的特征：粗壮的身躯、右侧的吻部、左下的长尾，外加背上的三片背鳍。
图形先在 32×32 的设计坐标里用几何图元拼出来，再按 8 倍超采样下采样，
这样边缘自带抗锯齿，缩到 16px 也不会锯齿横飞。

产出：
  assets/trayTemplate.png     16×16   macOS 模板图（纯黑 + alpha，菜单栏自动反色）
  assets/trayTemplate@2x.png  32×32   Retina 变体，Electron 按同目录约定自动加载
  assets/tray.png             32×32   带色版本，给 Windows / Linux 用
  assets/appicon.png          256×256 应用图标（打包时可用）

用法：
  python3 build/make-icons.py            # 生成图标
  python3 build/make-icons.py --preview  # 生成后顺便在终端打印 ASCII 预览
"""

import os
import sys
from PIL import Image, ImageDraw

# 设计坐标：32 × 32，原点在左上。所有图元都按这个尺度描述。
DESIGN = 32
SS = 8                      # 超采样倍数
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')


def _poly(*pts):
    """把设计坐标点列表整体放大到超采样尺度。"""
    return [(x * SS, y * SS) for x, y in pts]


def draw_silhouette():
    """返回 32×32 的单色剪影遮罩（L 模式，255 = 实体）。

    构图自下而上、自后而前地叠：尾巴 → 双腿 → 脚掌 → 躯干 → 背鳍 → 头颈。
    先画被遮住的、再画压在上面的，就不需要做布尔运算。
    """
    size = DESIGN * SS
    mask = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(mask)

    # ---- 尾巴：从躯干左下角收细到左边缘，尾尖略微上翘 ----
    d.polygon(_poly(
        (11, 19), (9.5, 25), (3, 28), (0.5, 26),
        (2.5, 23.5), (6.5, 22), (8.5, 18.5),
    ), fill=255)
    d.polygon(_poly(  # 尾尖补一小块，避免收得太突兀
        (3, 28), (0.5, 26), (0.5, 27.5), (3.5, 29),
    ), fill=255)

    # ---- 双腿：两条粗短立柱，中间留 3 格空档，缩下去仍能读出"两条腿" -
    d.rectangle([11.5 * SS, 20 * SS, 15.5 * SS, 28.5 * SS], fill=255)
    d.rectangle([18.5 * SS, 20 * SS, 22.5 * SS, 28.5 * SS], fill=255)
    d.rectangle([9 * SS, 27 * SS, 15.5 * SS, 30 * SS], fill=255)    # 后脚掌
    d.rectangle([18.5 * SS, 27 * SS, 25 * SS, 30 * SS], fill=255)   # 前脚掌

    # ---- 躯干：蛋形，上窄下宽压出重心 ----
    d.ellipse([7.5 * SS, 10 * SS, 24.5 * SS, 23.5 * SS], fill=255)

    # ---- 背鳍：三片三角立在背脊上，最高的那片偏后 -
    for cx, peak, w in ((10.5, 6.0, 3.4), (14.5, 4.0, 3.6), (18.6, 6.5, 3.4)):
        d.polygon(_poly(
            (cx - w / 2, 12), (cx, peak), (cx + w / 2, 12),
        ), fill=255)

    # ---- 头颈：向右伸出的吻部。上下颌分两块画，中间那道缝就是嘴 -
    d.polygon(_poly(   # 上颌（含额头）
        (15, 6), (19, 4.5), (24, 5.5), (30, 7.5),
        (30, 9.5), (24, 9.5), (17, 10),
    ), fill=255)
    d.polygon(_poly(   # 下颌
        (18, 12), (27, 12), (29, 13.5), (24, 15), (18, 13.5),
    ), fill=255)

    # ---- 眼睛：在额头挖掉一小块，让"头"立刻能读出来 ----
    d.ellipse([22.6 * SS, 6.8 * SS, 24.6 * SS, 8.8 * SS], fill=0)

    return mask.resize((DESIGN, DESIGN), Image.LANCZOS)


def tinted(mask, rgb):
    """把单色遮罩染色成 RGBA，alpha 直接取遮罩灰度。"""
    img = Image.new('RGBA', mask.size, rgb + (0,))
    img.putalpha(mask)
    return img


def ascii_preview(mask, label):
    """把遮罩打成 ASCII，用于在没有图形界面的环境里核对形状。"""
    print('--- %s (%d×%d) ---' % (label, mask.width, mask.height))
    for y in range(mask.height):
        row = ''.join(
            '#' if mask.getpixel((x, y)) > 170 else ('+' if mask.getpixel((x, y)) > 80 else '.')
            for x in range(mask.width)
        )
        print(row)
    print('')


def main():
    os.makedirs(OUT, exist_ok=True)
    mask32 = draw_silhouette()
    mask16 = mask32.resize((16, 16), Image.LANCZOS)

    # macOS：模板图必须是纯黑 + alpha，系统会按菜单栏明暗自动反色
    mask16.save(os.path.join(OUT, 'trayTemplate.png'))
    mask32.save(os.path.join(OUT, 'trayTemplate@2x.png'))

    # Windows / Linux：给一点颜色，深色任务栏上也看得见
    tinted(mask32, (58, 200, 150)).save(os.path.join(OUT, 'tray.png'))

    # 应用图标：放大版本，深色描边保证浅色背景上也有边界
    app = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    big = mask32.resize((224, 224), Image.LANCZOS)
    app.paste(tinted(big, (26, 32, 30)), (16, 16), big)
    app.save(os.path.join(OUT, 'appicon.png'))

    print('已写入：')
    for f in ('trayTemplate.png', 'trayTemplate@2x.png', 'tray.png', 'appicon.png'):
        p = os.path.join(OUT, f)
        print('  %-22s %6d bytes' % (f, os.path.getsize(p)))

    if '--preview' in sys.argv:
        ascii_preview(mask32, 'trayTemplate@2x')
        ascii_preview(mask16, 'trayTemplate')


if __name__ == '__main__':
    main()
