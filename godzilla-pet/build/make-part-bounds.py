#!/usr/bin/env python3
"""巨兽都市桌宠 · 部件边界预计算

量出每个骨骼部件图里不透明像素的范围，写成 renderer/part-bounds.js。

为什么要离线算、而不是运行时读像素：桌宠走 file:// 协议，把本地图片绘进画布
会污染画布，此后任何 getImageData / toDataURL 都会被浏览器拒绝。所以渲染层
只能靠这份预先算好的表，再乘骨骼变换，反推出角色的包围盒。

用法：
  python3 build/make-part-bounds.py           # 重新生成 part-bounds.js
  python3 build/make-part-bounds.py --check   # 只校验现有文件是否过期（用于 CI）

换了部件图、改了 atlas 尺寸之后必须重跑，否则角色的包围盒会算错，
表现是"身高对不上、站位判定偏掉"。
"""

import json
import os
import sys

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
PARTS_DIR = os.path.join(ROOT, 'assets', 'parts')
OUT_FILE = os.path.join(ROOT, 'renderer', 'part-bounds.js')

# alpha 低于这个值当作全透明。留一点余量，抹掉抗锯齿边缘的一圈半透明像素，
# 否则包围盒会被虚边撑大一圈。
ALPHA_FLOOR = 8

HEADER = """/* 由 build/make-part-bounds.py 从部件图直接量出，不要手改。
 *
 * 每个部件在自身图像坐标系里的不透明范围 [x0,y0,x1,y1]。
 * 渲染层据此算出角色包围盒，把「屏幕身高」换算成骨骼缩放，因此运行时
 * 不需要 getImageData —— 桌宠走 file:// 协议，那条路会被画布污染规则挡住。
 */
(function (root) {
  'use strict';
  root.PartBounds = %s;
})(typeof window !== 'undefined' ? window : this);
"""


def measure(path):
    """返回不透明范围 [x0, y0, x1, y1]，全透明则返回 None。

    上界沿用 PIL getbbox() 的约定：左闭右开。渲染层只把这份表当作"轴的跨度"
    用（做坐标变换后取并集），开闭差 1 像素没有影响，保持一致才能让
    重新生成成为幂等操作。
    """
    with Image.open(path) as im:
        alpha = im.convert('RGBA').getchannel('A')
        # 用 point 把 alpha 二值化，再用 getbbox 一次拿到范围，比逐像素快得多
        box = alpha.point(lambda v: 255 if v > ALPHA_FLOOR else 0).getbbox()
    if box is None:
        return None
    return list(box)


def collect():
    bounds = {}
    for name in sorted(os.listdir(PARTS_DIR)):
        if not name.endswith('.png'):
            continue
        key = name[:-4]
        box = measure(os.path.join(PARTS_DIR, name))
        if box is None:
            raise SystemExit('部件图全透明，无法定位：' + name)
        bounds[key] = box
    if not bounds:
        raise SystemExit('没有找到任何部件图：' + PARTS_DIR)
    return bounds


def render(bounds):
    body = json.dumps(bounds, indent=2, ensure_ascii=False)
    lines = body.split('\n')
    # 首行是 `{`，直接接在 `= ` 后面；其余行整体缩进一层
    body = lines[0] + '\n' + '\n'.join('  ' + line for line in lines[1:])
    return HEADER % body


def main():
    bounds = collect()
    text = render(bounds)

    if '--check' in sys.argv:
        try:
            with open(OUT_FILE, encoding='utf-8') as f:
                current = f.read()
        except FileNotFoundError:
            raise SystemExit('缺少 ' + OUT_FILE + '，请先运行一次生成')
        if current.strip() != text.strip():
            raise SystemExit('part-bounds.js 已过期：部件图变过但没重新生成')
        print('part-bounds.js 是最新的（%d 个部件）' % len(bounds))
        return

    with open(OUT_FILE, 'w', encoding='utf-8') as f:
        f.write(text)

    print('已写入 %s' % os.path.relpath(OUT_FILE, ROOT))
    for key, (x0, y0, x1, y1) in bounds.items():
        print('  %-11s %4d,%4d → %4d,%4d   (%dx%d)' % (key, x0, y0, x1, y1, x1 - x0 + 1, y1 - y0 + 1))


if __name__ == '__main__':
    main()
