#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""growth_skins.py —— 身体皮肤调色：把 clean.png 按「亮度→主题色带」重着色。

被 build/growth-assets.py 调用（本文件必须留在 build/ 目录）。

设计要点
------------------------------------------------------------------
* 只做 body colors：色带（ramp）是从暗到亮的若干控制点 (t, r, g, b)，t=L/255。
* 重着色保证 **alpha 逐像素不变**（同尺寸同 alpha），因此换皮肤不改剪影。
* 用「亮度→主题色」映射（而不是简单相乘/加色）可以**保留原来的明暗层次**
  （鳞甲的暗沟、亮面依旧暗/亮），并且低亮度端接近纯黑 —— **黑色描边被保留**。
* 主题色定义放在 fins/palettes.json，脚本以它为真源：存在则读取（可手改），
  不存在则用 DEFAULT_PALETTES 落盘一份。

已知限度：色带是线性插值的近似，不保证与原画材质的色彩科学一致；
「颜色肉眼明显」「描边仍黑」「层次未丢」属视觉判据，--check 不做自动断言。
"""
from __future__ import annotations

import json
import os

# 真源默认值：t=L/255 → (r,g,b)。低 t 端刻意压到近黑以保留描边。
DEFAULT_PALETTES = {
    'jade': {
        'label': '翠岩绿',
        'ramp': [
            [0.00, 1, 5, 3],
            [0.08, 10, 34, 22],
            [0.18, 26, 74, 48],
            [0.32, 44, 116, 74],
            [0.55, 86, 160, 108],
            [0.75, 150, 202, 158],
            [1.00, 222, 244, 224],
        ],
    },
    'frost': {
        'label': '霜白蓝灰',
        'ramp': [
            [0.00, 2, 4, 8],
            [0.08, 16, 26, 42],
            [0.18, 44, 66, 96],
            [0.32, 86, 116, 152],
            [0.55, 140, 168, 200],
            [0.75, 196, 216, 236],
            [1.00, 246, 250, 254],
        ],
    },
    'ember': {
        'label': '熔岩红褐',
        'ramp': [
            [0.00, 7, 2, 1],
            [0.08, 40, 12, 6],
            [0.18, 92, 30, 10],
            [0.32, 146, 56, 14],
            [0.55, 198, 92, 24],
            [0.75, 238, 150, 48],
            [1.00, 254, 220, 140],
        ],
    },
    'void': {
        'label': '紫晶深紫',
        'ramp': [
            [0.00, 4, 2, 8],
            [0.08, 28, 12, 46],
            [0.18, 62, 28, 98],
            [0.32, 98, 46, 146],
            [0.55, 146, 82, 190],
            [0.75, 192, 136, 226],
            [1.00, 238, 208, 252],
        ],
    },
}

SKIN_ORDER = ['jade', 'frost', 'ember', 'void']


def load_palettes(path: str) -> dict:
    """读取 palettes.json（真源）。不存在则落盘默认值再读回。"""
    if not os.path.isfile(path):
        save_palettes(path, DEFAULT_PALETTES)
    with open(path, encoding='utf-8') as fh:
        data = json.load(fh)
    # 只认 body colors：每个主题必须有 ramp
    for k in SKIN_ORDER:
        if k not in data or 'ramp' not in data[k]:
            raise SystemExit('palettes.json 缺少主题 %s 的 ramp' % k)
    return data


def save_palettes(path: str, data: dict) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False, sort_keys=True)
        fh.write('\n')
    os.replace(tmp, path)


def _ramp_lookup(ramp):
    """把控制点整理成可线性插值的函数。"""
    pts = sorted((float(t), int(r), int(g), int(b)) for (t, r, g, b) in ramp)
    ts = [p[0] for p in pts]

    def f(t: float):
        if t <= ts[0]:
            return pts[0][1], pts[0][2], pts[0][3]
        if t >= ts[-1]:
            return pts[-1][1], pts[-1][2], pts[-1][3]
        lo = 0
        for i in range(1, len(ts)):
            if t <= ts[i]:
                lo = i - 1
                break
        t0, r0, g0, b0 = pts[lo]
        t1, r1, g1, b1 = pts[lo + 1]
        f0 = (t - t0) / (t1 - t0) if t1 > t0 else 0.0
        return (int(round(r0 + (r1 - r0) * f0)),
                int(round(g0 + (g1 - g0) * f0)),
                int(round(b0 + (b1 - b0) * f0)))
    return f


def colorize(w: int, h: int, px, palette: dict) -> bytearray:
    """按亮度重着色；alpha 逐像素保留（同尺寸同 alpha）。"""
    f = _ramp_lookup(palette['ramp'])
    out = bytearray(px)
    n = w * h
    for i in range(n):
        a = px[i * 4 + 3]
        if a == 0:
            continue
        r, g, b = px[i * 4], px[i * 4 + 1], px[i * 4 + 2]
        # 保留眼睛/口腔暖色和牙爪近白色，皮肤主题不把眼牙一起染成单色。
        if (r > g * 1.6 and r > b * 1.6 and r > 80) or (min(r, g, b) > 155 and max(r, g, b) - min(r, g, b) < 42):
            continue
        lum = (r * 299 + g * 587 + b * 114) // 1000
        nr, ng, nb = f(lum / 255.0)
        out[i * 4], out[i * 4 + 1], out[i * 4 + 2] = nr, ng, nb
    return out
