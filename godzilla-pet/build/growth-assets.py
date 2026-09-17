#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""growth-assets.py —— 可复现地拆解 godzilla 部件贴图里的「背鳍」图层，并导出独立晶体精灵。

产物（全部 RGBA PNG，纯 stdlib 编解码，零第三方依赖）：

  parts/<槽位>/default.png 源图，只读、绝不修改
  parts/<槽位>/nofin.png   与 default.png 同尺寸；背鳍像素 alpha=0，其余像素原样保留
  parts/<槽位>/fin.png     与 default.png 同尺寸；只保留背鳍像素，其余透明
                          （nofin 与 fin 互补：「fin over nofin」逐像素等于 default）
  parts/<槽位>/clean.png   从 default 几何去鳍并补成实心体表（去掉外轮廓鳍残影、修复鳍根穿孔），
                          保留躯干鳞甲与剪影；无鳍槽位原样复制 default
  parts/<槽位>/jade.png    由 clean 按翠岩绿色带重着色（同尺寸同 alpha、保留黑描边与明暗层次）
  parts/<槽位>/frost.png   由 clean 按霜白蓝灰色带重着色
  parts/<槽位>/ember.png   由 clean 按熔岩红褐色带重着色
  parts/<槽位>/void.png    由 clean 按紫晶深紫色带重着色
  fins/crown.png           从 torso 背鳍里拆出的最大「王冠」晶体，独立透明精灵（不含身体）
  fins/blade.png           从 torso 背鳍里拆出的最细长「刀刃」晶体，独立透明精灵（不含身体）
  fins/palettes.json       四套身体皮肤的颜色带真源（仅 body colors，可手改）
  fins/manifest.json       记录 src SHA、像素数、尺寸、精灵挂点、clean/skin SHA 与统计，供 --check 复验

为什么优于早期的 cut-fins.py：

  cut-fins.py 只用「b-r>=30 的蓝种子 + 一圈 b-r>=16 过渡」判鳍，结果在晶体边缘
  残留一圈「暗青黑描边」——这些描边像素 b-r 很小（例如 0/1/2、1/2/12），过不了
  b-r>=16 的门槛，于是留在了 nofin 里。

  本脚本按要求改用「青色性质」识别这圈描边：fin 的暗描边是青的（g>r 且 b>r），
  而身体是灰紫的（r≈g≈b，或紫调 r>b）。注意：**绝不全图无脑用 b-r>=6 或
  g>r 且 b>r**——实测身体暗部岩石里也有大量 (g>r 且 b>r) 的像素（如 27/28/37），
  全图判据会把身体整片吃掉。所以本脚本把描边生长限制为两点：
    (1) 只能从「蓝种子 / 已确认的鳍像素」向外生长（8 连通 BFS，绝不跳到独立区域）；
    (2) 最多 BORDER_RINGS 圈，且必须满足 g>r 且 b>r 且 max(r,g,b)<=BORDER_MX。
  再加一层 ROI 兜底：蓝种子包围盒外扩 ROI_MARGIN，生长不能越出，彻底防误伤身体。

  最后，nofin 与 fin 是全尺寸互补层，「fin over nofin」逐像素等于 default.png，
  因此重组成图与原图完全一致（alpha 与颜色都不丢）。

用法：
  python growth-assets.py                    # 生成全部资产 + manifest + 检视图
  python growth-assets.py --check            # 只校验，不写盘
  python growth-assets.py --no-inspection    # 不产出 outputs/growth-skins-inspection.png
  python growth-assets.py --slots torso head # 只处理指定槽位（manifest 全量仍会校验）

退出码：0 成功 / 1 校验失败 / 2 参数错误。
"""
from __future__ import annotations

import hashlib
import json
import os
import struct
import sys
import zlib
from collections import deque

# ---------------------------------------------------------------- 路径
HERE = os.path.dirname(os.path.abspath(__file__))              # godzilla-pet/build
PROJ = os.path.dirname(HERE)                                   # godzilla-pet
GODZ = os.path.join(PROJ, 'tv', 'assets', 'monsters', 'godzilla')
PARTS = os.path.join(GODZ, 'parts')
FINS = os.path.join(GODZ, 'fins')
ROOT = os.path.dirname(PROJ)                                   # 仓库根
INSPECTION = os.path.join(ROOT, 'outputs', 'growth-skins-inspection.png')
MANIFEST = os.path.join(FINS, 'manifest.json')
PALETTES = os.path.join(FINS, 'palettes.json')                  # 身体皮肤调色真源

sys.path.insert(0, HERE)        # 让同目录的 growth_clean / growth_skins 可被 import
import growth_clean                                                      # noqa: E402
import growth_skins                                                      # noqa: E402

# 12 个部件槽位；default.png 一律只读、绝不修改
SLOTS = ['tail_tip', 'tail_mid', 'tail_base', 'far_thigh', 'far_shin', 'torso',
         'thigh', 'shin', 'upper_arm', 'forearm', 'jaw', 'head']

# 四套身体皮肤（由 clean 重着色得到），名称即 fins/palettes.json 里的主题键
SKINS = ['jade', 'frost', 'ember', 'void']

# ---------------------------------------------------------------- 算法参数
SEED_DELTA = 30     # 蓝种子：b - r >= 30（背鳍青蓝晶体的确定判据）
LUM_GROW = 105      # 白芯生长：亮度 >= 105（晶体内部高光，b-r 常常不到 30）
BLUE_GROW = 15      # 中蓝生长：b - r >= 15（蓝种子的直接延伸，仍属鳍）
BORDER_RINGS = 7    # 暗描边最多向外生长的圈数；运行时 nofin 不得留下空心鳍廓
BORDER_MX = 72      # 暗描边亮度上限：兼容黑色外轮廓与暗青过渡，但仍限制在鳍 ROI 内
ROI_MARGIN = 32     # 蓝种子包围盒外扩像素，作为防误伤的安全框
MIN_CRYSTAL = 800   # crown/blade 候选晶体的最小像素数（滤掉碎屑）
BAND_FRAC = 0.10    # 底部挂点取「最下 10% 高度」像素的横坐标质心

# 校验用：掩膜里每个像素都必须满足下面三条之一，否则视为误吃了身体
def _mask_ok(r: int, g: int, b: int) -> bool:
    if (b - r) >= BLUE_GROW:
        return True
    if (((r * 299 + g * 587 + b * 114) // 1000) >= LUM_GROW):
        return True
    if g > r and b > r and max(r, g, b) <= BORDER_MX:
        return True
    return False


def _looks_like_body(r: int, g: int, b: int) -> bool:
    """灰紫身体嫌疑：中调、蓝绿都不显著高于红。用于 --check 输出可疑残留计数。"""
    if (b - r) >= BLUE_GROW:
        return False
    lum = (r * 299 + g * 587 + b * 114) // 1000
    return 25 <= lum <= 120 and (b - g) < 12


# ---------------------------------------------------------------- PNG 编解码（stdlib）
def decode(path: str):
    """返回 (w, h, bytearray RGBA)。支持 8bit RGB/RGBA、非隔行。"""
    with open(path, 'rb') as fh:
        raw = fh.read()
    assert raw[:8] == b'\x89PNG\r\n\x1a\n', '不是 PNG: ' + path
    pos, idat = 8, b''
    w = h = ctype = None
    while pos < len(raw):
        (ln,) = struct.unpack('>I', raw[pos:pos + 4])
        typ = raw[pos + 4:pos + 8]
        data = raw[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if typ == b'IHDR':
            w, h, depth, ctype, _, _, inter = struct.unpack('>IIBBBBB', data)
            assert depth == 8 and ctype in (2, 6) and inter == 0, (depth, ctype, inter)
        elif typ == b'IDAT':
            idat += data
        elif typ == b'IEND':
            break
    bpp = 4 if ctype == 6 else 3
    buf = zlib.decompress(idat)
    stride = w * bpp
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = buf[p]
        p += 1
        line = bytearray(buf[p:p + stride])
        p += stride
        if f == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    if bpp == 3:
        rgba = bytearray(w * h * 4)
        for i in range(w * h):
            rgba[i * 4:i * 4 + 3] = out[i * 3:i * 3 + 3]
            rgba[i * 4 + 3] = 255
        out = rgba
    return w, h, out


def encode(path: str, w: int, h: int, px: bytes) -> None:
    data = encode_bytes(w, h, px)
    tmp = path + '.tmp'
    with open(tmp, 'wb') as fh:
        fh.write(data)
    os.replace(tmp, path)


def encode_bytes(w: int, h: int, px) -> bytes:
    stride = w * 4
    raw = bytearray(h * (stride + 1))
    p = 0
    for y in range(h):
        raw[p] = 0
        p += 1
        s = y * stride
        raw[p:p + stride] = px[s:s + stride]
        p += stride

    def chunk(typ: bytes, data: bytes) -> bytes:
        return (struct.pack('>I', len(data)) + typ + data
                + struct.pack('>I', zlib.crc32(typ + data) & 0xFFFFFFFF))

    out = b'\x89PNG\r\n\x1a\n'
    out += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    out += chunk(b'IDAT', zlib.compress(bytes(raw), 6))
    out += chunk(b'IEND', b'')
    return out


def sha256_file(path: str) -> str:
    with open(path, 'rb') as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------- 掩膜构建
def build_mask(w: int, h: int, px, want_origin: bool = False):
    """返回 (mask, origin, roi, seed_count)。

    mask[i]=1 表示该像素属于背鳍；origin[i] 是该像素的蓝种子连通域编号（0=未标记）；
    roi=(rx0,ry0,rx1,ry1) 为防误伤安全框（蓝种子包围盒外扩 ROI_MARGIN）。
    """
    n = w * h
    seed = bytearray(n)
    x0 = y0 = 1 << 30
    x1 = y1 = -1
    for i in range(n):
        if px[i * 4 + 3] < 128:
            continue
        if px[i * 4 + 2] - px[i * 4] >= SEED_DELTA:
            seed[i] = 1
            y, x = divmod(i, w)
            if x < x0:
                x0 = x
            if x > x1:
                x1 = x
            if y < y0:
                y0 = y
            if y > y1:
                y1 = y
    if x1 < 0:                                    # 该槽位没有背鳍
        return bytearray(n), ([] if want_origin else None), None, 0

    rx0 = max(0, x0 - ROI_MARGIN)
    ry0 = max(0, y0 - ROI_MARGIN)
    rx1 = min(w - 1, x1 + ROI_MARGIN)
    ry1 = min(h - 1, y1 + ROI_MARGIN)
    roi = (rx0, ry0, rx1, ry1)

    origin = [0] * n if want_origin else None
    mask = bytearray(seed)

    # 给蓝种子分连通域（4/8 连通皆可，这里 8 连通），仅 origin 模式需要
    if want_origin:
        cid = 0
        for i in range(n):
            if seed[i] and origin[i] == 0:
                cid += 1
                origin[i] = cid
                dq = deque([i])
                while dq:
                    p2 = dq.popleft()
                    yy, xx = divmod(p2, w)
                    for dy in (-1, 0, 1):
                        ny = yy + dy
                        if ny < 0 or ny >= h:
                            continue
                        for dx in (-1, 0, 1):
                            nx = xx + dx
                            if nx < 0 or nx >= w:
                                continue
                            q = ny * w + nx
                            if seed[q] and origin[q] == 0:
                                origin[q] = cid
                                dq.append(q)

    # 多源 BFS：从蓝种子向外生长（只吃「鳍样」像素，且不出 ROI）
    dq = deque()
    for i in range(n):
        if mask[i]:
            dq.append(i)
    while dq:
        p2 = dq.popleft()
        yy, xx = divmod(p2, w)
        base_o = origin[p2] if origin is not None else 0
        for dy in (-1, 0, 1):
            ny = yy + dy
            if ny < ry0 or ny > ry1:
                continue
            for dx in (-1, 0, 1):
                nx = xx + dx
                if nx < rx0 or nx > rx1:
                    continue
                q = ny * w + nx
                if mask[q]:
                    continue
                if px[q * 4 + 3] < 128:
                    continue
                r, g, b = px[q * 4], px[q * 4 + 1], px[q * 4 + 2]
                if (b - r) >= BLUE_GROW or ((r * 299 + g * 587 + b * 114) // 1000) >= LUM_GROW:
                    mask[q] = 1
                    if origin is not None:
                        origin[q] = base_o
                    dq.append(q)

    # 暗青黑描边：从当前掩膜边界向外最多 BORDER_RINGS 圈，只吃 g>r 且 b>r 且够暗的
    front = [i for i in range(n) if mask[i]]
    for _ in range(BORDER_RINGS):
        nxt = []
        for p2 in front:
            yy, xx = divmod(p2, w)
            base_o = origin[p2] if origin is not None else 0
            for dy in (-1, 0, 1):
                ny = yy + dy
                if ny < ry0 or ny > ry1:
                    continue
                for dx in (-1, 0, 1):
                    nx = xx + dx
                    if nx < rx0 or nx > rx1:
                        continue
                    q = ny * w + nx
                    if mask[q] or px[q * 4 + 3] < 128:
                        continue
                    r, g, b = px[q * 4], px[q * 4 + 1], px[q * 4 + 2]
                    if g > r and b > r and max(r, g, b) <= BORDER_MX:
                        mask[q] = 1
                        if origin is not None:
                            origin[q] = base_o
                        nxt.append(q)
        front = nxt
        if not front:
            break

    return mask, origin, roi, sum(seed)


def mask_bbox(w: int, mask) -> tuple | None:
    x0 = y0 = 1 << 30
    x1 = y1 = -1
    n = len(mask)
    for i in range(n):
        if mask[i]:
            y, x = divmod(i, w)
            if x < x0:
                x0 = x
            if x > x1:
                x1 = x
            if y < y0:
                y0 = y
            if y > y1:
                y1 = y
    if x1 < 0:
        return None
    return (x0, y0, x1, y1)


def split_layers(w: int, h: int, px, mask):
    """由 default 与掩膜导出全尺寸互补的 (nofin, fin)。fin over nofin == default。"""
    nofin = bytearray(px)
    fin = bytearray(w * h * 4)
    for i in range(w * h):
        if mask[i]:
            fin[i * 4:i * 4 + 4] = px[i * 4:i * 4 + 4]
            nofin[i * 4 + 3] = 0
    return nofin, fin


def residual_border(w: int, h: int, px, mask) -> int:
    """数一数：紧贴背鳍、颜色是「暗青黑」却仍留在 nofin 里的像素（越少越好）。

    这正是早期 cut-fins.py 的残留边框：不在掩膜里、但 8 邻域有掩膜像素，
    且本身 g>r 且 b>r 且 max(r,g,b)<=60（青黑描边特征）。
    """
    cnt = 0
    for i in range(w * h):
        if mask[i] or px[i * 4 + 3] < 128:
            continue
        y, x = divmod(i, w)
        near = False
        for dy in (-1, 0, 1):
            ny = y + dy
            if ny < 0 or ny >= h:
                continue
            for dx in (-1, 0, 1):
                nx = x + dx
                if 0 <= nx < w and mask[ny * w + nx]:
                    near = True
                    break
            if near:
                break
        if not near:
            continue
        r, g, b = px[i * 4], px[i * 4 + 1], px[i * 4 + 2]
        if g > r and b > r and max(r, g, b) <= 60:
            cnt += 1
    return cnt


# ---------------------------------------------------------------- 晶体精灵
def group_pixels(w: int, mask, origin, gid: int):
    return [i for i in range(len(mask)) if mask[i] and origin[i] == gid]


def extract_sprite(w: int, px, pixels, tag: str):
    """把某个连通晶体裁成独立透明精灵，并算底部挂点。返回 sprite 记录 dict。"""
    xs = [i % w for i in pixels]
    ys = [i // w for i in pixels]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    sprite = bytearray(bw * bh * 4)
    for i in pixels:
        y, x = divmod(i, w)
        di = (y - y0) * bw + (x - x0)
        sprite[di * 4:di * 4 + 4] = px[i * 4:i * 4 + 4]
    # 底部挂点：最下 BAND_FRAC 高度像素的横坐标质心，归一化到精灵框
    band_h = max(2, int(round(bh * BAND_FRAC)))
    band = [i for i in pixels if (i // w) >= y1 - band_h + 1]
    ax = (sum(i % w for i in band) / len(band) - x0)
    ax = ax / (bw - 1) if bw > 1 else 0.5
    ay = 1.0
    return {
        'name': tag,
        'dims': [bw, bh],
        'pixels': len(pixels),
        'src_bbox': [x0, y0, x1, y1],
        'anchor': [round(ax, 4), round(ay, 4)],
        '_rgba': sprite,
    }


def pick_crystals(w: int, h: int, px, mask, origin):
    """从 torso 背鳍掩膜里挑 2 个可用独立晶体：最大者为 crown，最细长者为 blade。"""
    counts = {}
    for i in range(len(mask)):
        if mask[i] and origin[i]:
            counts[origin[i]] = counts.get(origin[i], 0) + 1
    cands = [(gid, c) for gid, c in counts.items() if c >= MIN_CRYSTAL]
    if len(cands) < 1:
        return None
    def bbox_of(gid):
        pix = group_pixels(w, mask, origin, gid)
        xs = [i % w for i in pix]
        ys = [i // w for i in pix]
        return min(xs), max(xs), min(ys), max(ys)
    cands.sort(key=lambda kv: -kv[1])
    crown_gid = cands[0][0]
    bx0, bx1, by0, by1 = bbox_of(crown_gid)
    crown_aspect = (by1 - by0 + 1) / (bx1 - bx0 + 1)
    blade_gid, blade_aspect = None, -1.0
    for gid, c in cands:
        if gid == crown_gid:
            continue
        x0, x1, y0, y1 = bbox_of(gid)
        a = (y1 - y0 + 1) / (x1 - x0 + 1)
        if a > blade_aspect:
            blade_aspect, blade_gid = a, gid
    out = {}
    out['crown'] = extract_sprite(w, px, group_pixels(w, mask, origin, crown_gid), 'crown')
    out['crown']['aspect'] = round(crown_aspect, 4)
    if blade_gid is not None:
        out['blade'] = extract_sprite(w, px, group_pixels(w, mask, origin, blade_gid), 'blade')
        out['blade']['aspect'] = round(blade_aspect, 4)
    return out


# ---------------------------------------------------------------- 检视图
def _checker(px, w, h, x0, y0, x1, y1, cell=8):
    for y in range(max(0, y0), min(h, y1)):
        for x in range(max(0, x0), min(w, x1)):
            i = y * w + x
            c = 210 if ((x // cell + y // cell) & 1) else 232
            px[i * 4] = c
            px[i * 4 + 1] = c
            px[i * 4 + 2] = c
            px[i * 4 + 3] = 255


def _blit(dst, dw, dh, src, sw, sh, ox, oy, scale, bg_checker=True):
    """把 src 最近邻缩放（目标尺寸 tw×th）到 dst 的 (ox,oy) 处；透明像素填棋盘底。"""
    tw, th = int(round(sw * scale)), int(round(sh * scale))
    if bg_checker:
        _checker(dst, dw, dh, ox, oy, ox + tw, oy + th)
    for ty in range(th):
        sy = oy + ty
        if sy < 0 or sy >= dh:
            continue
        syy = ty * sh // th
        srow = syy * sw * 4
        drow = sy * dw * 4
        for tx in range(tw):
            sx = ox + tx
            if sx < 0 or sx >= dw:
                continue
            sxx = tx * sw // tw
            si = srow + sxx * 4
            a = src[si + 3]
            if a == 0:
                continue
            di = drow + sx * 4
            if a == 255:
                dst[di] = src[si]
                dst[di + 1] = src[si + 1]
                dst[di + 2] = src[si + 2]
                dst[di + 3] = 255
            else:                                   # 简单 over 合成到棋盘底
                inv = 255 - a
                dst[di] = (src[si] * a + dst[di] * inv) // 255
                dst[di + 1] = (src[si + 1] * a + dst[di + 1] * inv) // 255
                dst[di + 2] = (src[si + 2] * a + dst[di + 2] * inv) // 255
                dst[di + 3] = 255


def _crop(px, w, h, x0, y0, x1, y1):
    """裁出 [x0,y0)-[x1,y1) 子块（RGBA），返回 (sub, sw, sh)。"""
    sw = x1 - x0
    sh = y1 - y0
    sub = bytearray(sw * sh * 4)
    for yy in range(y0, y1):
        srow = yy * w * 4
        sub[(yy - y0) * sw * 4:(yy - y0 + 1) * sw * 4] = px[srow + x0 * 4:srow + x1 * 4]
    return sub, sw, sh


# 3x5 数字字形（仅用于行列编号，纯几何，不依赖任何字体文件）
_FONT3x5 = {
    '0': ("111", "101", "101", "101", "111"),
    '1': ("010", "110", "010", "010", "111"),
    '2': ("111", "001", "111", "100", "111"),
    '3': ("111", "001", "111", "001", "111"),
    '4': ("101", "101", "111", "001", "001"),
    '5': ("111", "100", "111", "001", "111"),
    '6': ("111", "100", "111", "101", "111"),
    '7': ("111", "001", "010", "010", "010"),
    '8': ("111", "101", "111", "101", "111"),
    '9': ("111", "101", "111", "001", "111"),
}


def _draw_digit(dst, W, H, d, x, y, color=(235, 235, 235), scale=2):
    pat = _FONT3x5[str(d)]
    for r in range(5):
        for c in range(3):
            if pat[r][c] == '1':
                for sy in range(scale):
                    for sx in range(scale):
                        px2 = x + c * scale + sx
                        py = y + r * scale + sy
                        if 0 <= px2 < W and 0 <= py < H:
                            i = (py * W + px2) * 4
                            dst[i], dst[i + 1], dst[i + 2], dst[i + 3] = color[0], color[1], color[2], 255


def _draw_chip(dst, W, H, x, y, cw, ch, color):
    for yy in range(y, y + ch):
        for xx in range(x, x + cw):
            if 0 <= xx < W and 0 <= yy < H:
                i = (yy * W + xx) * 4
                dst[i], dst[i + 1], dst[i + 2], dst[i + 3] = color[0], color[1], color[2], 255


def make_inspection(assets, sprites, out_path: str):
    """对照图：default | nofin | fin | clean | jade | frost | ember | void 八列，
    重点证明 clean 彻底去掉外轮廓鳍残影并修复鳍根穿孔；含 torso 背鳍区域放大对照。

    列序（同色块 + 数字编号）：
      1 default  2 nofin  3 fin  4 clean  5 jade  6 frost  7 ember  8 void
    行序（左栏数字）：1 torso  2 head  3 tail_base；最后一行是 torso 背鳍放大（同 1-4 列语义）。
    """
    order = ['default', 'nofin', 'fin', 'clean', 'jade', 'frost', 'ember', 'void']
    chip = {
        'default': (150, 150, 150), 'nofin': (214, 214, 214), 'fin': (70, 130, 222),
        'clean': (120, 200, 120), 'jade': (60, 170, 92), 'frost': (150, 182, 222),
        'ember': (214, 92, 42), 'void': (150, 82, 200),
    }
    gap, pad, LM = 10, 14, 26
    panel_w = 120
    chipH, digH = 8, 10
    header_h = chipH + digH + 6
    key_slots = ['torso', 'head', 'tail_base']

    rows = [(s, max(1, round(panel_w * assets[s]['h'] / assets[s]['w']))) for s in key_slots]

    # torso 背鳍放大裁剪框（用 torso 掩膜 bbox 外扩）
    tz = assets['torso']
    tw, th, tpx = tz['w'], tz['h'], tz['px']
    tmm, _, _troi, _ = build_mask(tw, th, tpx, want_origin=False)
    fb = mask_bbox(tw, tmm)
    if fb:
        cx0, cy0, cx1, cy1 = fb[0] - 24, fb[1] - 24, fb[2] + 24, fb[3] + 24
    else:
        cx0, cy0, cx1, cy1 = 0, 0, tw, max(1, th // 3)
    cx0, cy0 = max(0, cx0), max(0, cy0)
    cx1, cy1 = min(tw, cx1), min(th, cy1)
    crop_w, crop_h = max(1, cx1 - cx0), max(1, cy1 - cy0)
    zH = 230
    zsc = zH / crop_h
    zw = max(1, int(round(crop_w * zsc)))
    zoom_names = ('default', 'nofin', 'fin', 'clean')
    content_w = 8 * panel_w + 7 * gap
    max_zoom_w = (content_w - (len(zoom_names) - 1) * gap) // len(zoom_names)
    if zw > max_zoom_w:
        zsc = max_zoom_w / crop_w
        zw = max_zoom_w
    zh = max(1, int(round(crop_h * zsc)))

    spr_items = [(k, sprites[k]) for k in ('crown', 'blade') if k in sprites]
    spr_scale = {}
    spr_w = 0
    for k, s in spr_items:
        sc = 2 if max(s['dims']) * 2 <= 320 else 1
        spr_scale[k] = sc
        spr_w += s['dims'][0] * sc + gap
    spr_h = max([s['dims'][1] * spr_scale[k] for k, s in spr_items] or [0])

    W = LM + pad + content_w + pad
    H = (pad + sum(ph + gap + header_h for _, ph in rows)
         + header_h + zh + gap + spr_h + gap + pad)

    canvas = bytearray(W * H * 4)
    for i in range(W * H):
        canvas[i * 4:i * 4 + 4] = (18, 18, 22, 255)

    y = pad
    for (s, ph) in rows:
        a = assets[s]
        # 左栏行号
        _draw_digit(canvas, W, H, key_slots.index(s) + 1, LM - 16, y + ph // 2 - 5, scale=2)
        # 列头：色块 + 编号
        x = LM + pad
        for idx, name in enumerate(order):
            _draw_chip(canvas, W, H, x, y, panel_w, chipH, chip[name])
            _draw_digit(canvas, W, H, idx + 1, x + panel_w // 2 - 3, y + chipH + 2, scale=2)
            x += panel_w + gap
        y += header_h
        x = LM + pad
        layer_of = {'default': a['px'], 'nofin': a['nofin'], 'fin': a['fin'], 'clean': a['clean']}
        layer_of.update(a['skins'])
        for name in order:
            _blit_scaled(canvas, W, H, layer_of[name], a['w'], a['h'], x, y, panel_w, ph)
            x += panel_w + gap
        y += ph + gap

    # torso 背鳍放大行（同 1-4 列语义：default/nofin/fin/clean）
    x = LM + pad
    for idx, name in enumerate(zoom_names):
        _draw_chip(canvas, W, H, x, y, zw, chipH, chip[name])
        _draw_digit(canvas, W, H, idx + 1, x + zw // 2 - 3, y + chipH + 2, scale=2)
        x += zw + gap
    y += header_h
    x = LM + pad
    zlayers = {'default': tpx, 'nofin': tz['nofin'], 'fin': tz['fin'], 'clean': tz['clean']}
    for name in zoom_names:
        sub, sw, sh = _crop(zlayers[name], tw, th, cx0, cy0, cx1, cy1)
        _blit(canvas, W, H, sub, sw, sh, x, y, zsc)
        x += zw + gap
    y += zh + gap

    # crown / blade 精灵（透明处棋盘，红点为底部挂点）
    x = LM + pad
    for k, s in spr_items:
        sc = spr_scale[k]
        sw, sh = s['dims']
        _blit(canvas, W, H, s['_rgba'], sw, sh, x, y, sc)
        ax = int(s['anchor'][0] * (sw * sc - 1))
        ay = int(s['anchor'][1] * (sh * sc - 1))
        for dy in range(-4, 5):
            for dx in range(-4, 5):
                if dx * dx + dy * dy > 16:
                    continue
                gx, gy = x + ax + dx, y + ay + dy
                if 0 <= gx < W and 0 <= gy < H:
                    di = gy * W + gx
                    canvas[di * 4:di * 4 + 4] = (235, 60, 60, 255)
        x += sw * sc + gap

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    encode(out_path, W, H, canvas)
    return W, H


def _blit_scaled(dst, dw, dh, src, sw, sh, ox, oy, tw, th):
    """最近邻缩放到指定目标宽高 tw x th（不做棋盘底，默认该层不透明/自带透明）。"""
    _checker(dst, dw, dh, ox, oy, ox + tw, oy + th)
    for ty in range(th):
        sy = oy + ty
        if sy < 0 or sy >= dh:
            continue
        syy = ty * sh // th
        srow = syy * sw * 4
        drow = sy * dw * 4
        for tx in range(tw):
            sx = ox + tx
            if sx < 0 or sx >= dw:
                continue
            sxx = tx * sw // tw
            si = srow + sxx * 4
            a = src[si + 3]
            di = drow + sx * 4
            if a == 255:
                dst[di] = src[si]
                dst[di + 1] = src[si + 1]
                dst[di + 2] = src[si + 2]
                dst[di + 3] = 255
            elif a > 0:
                inv = 255 - a
                dst[di] = (src[si] * a + dst[di] * inv) // 255
                dst[di + 1] = (src[si + 1] * a + dst[di + 1] * inv) // 255
                dst[di + 2] = (src[si + 2] * a + dst[di + 2] * inv) // 255
                dst[di + 3] = 255


# ---------------------------------------------------------------- 构建
def build(slots=None, want_inspection=True, verbose=True):
    chosen = slots or SLOTS
    # 调色真源：存在则读取（可手改），不存在则落盘默认四套；脚本一律以它为基准
    palettes = growth_skins.load_palettes(PALETTES)

    manifest = {
        'generator': 'godzilla-pet/build/growth-assets.py',
        'version': 2,
        'algorithm': {
            'seed_delta': SEED_DELTA, 'lum_grow': LUM_GROW, 'blue_grow': BLUE_GROW,
            'border_rings': BORDER_RINGS, 'border_mx': BORDER_MX,
            'roi_margin': ROI_MARGIN, 'min_crystal': MIN_CRYSTAL, 'band_frac': BAND_FRAC,
            'clean': {
                'dark_max': growth_clean.DARK_MAX, 'blob_rings': growth_clean.BLOB_RINGS,
                'back_win': growth_clean.BACK_WIN, 'back_clamp_up': growth_clean.BACK_CLAMP_UP,
                'back_clamp_dn': growth_clean.BACK_CLAMP_DN,
                'edge_darken': growth_clean.EDGE_DARKEN,
                'island_min': growth_clean.ISLAND_MIN, 'island_margin': growth_clean.ISLAND_MARGIN,
                'blue_min': growth_clean.BLUE_MIN,
            },
        },
        'palette_sha256': sha256_file(PALETTES),
        'default_sha256': {},
        'parts': {},
        'fins': {},
    }
    assets_keep = {}
    sprites_out = {}

    for slot in SLOTS:
        src = os.path.join(PARTS, slot, 'default.png')
        if not os.path.isfile(src):
            raise SystemExit('缺少源文件: ' + src)
        manifest['default_sha256'][slot] = sha256_file(src)

    for slot in chosen:
        src = os.path.join(PARTS, slot, 'default.png')
        w, h, px = decode(src)
        want_origin = (slot == 'torso')
        mask, origin, roi, seedn = build_mask(w, h, px, want_origin=want_origin)
        nofin, fin = split_layers(w, h, px, mask)
        fin_px = sum(mask)
        resid = residual_border(w, h, px, mask) if fin_px else 0
        fbbox = mask_bbox(w, mask)

        # ---- 新增：clean（几何去鳍 + 实心补面）----
        clean, cstats = growth_clean.make_clean(w, h, px, mask, roi)

        # ---- 新增：四套身体皮肤（clean → 亮度色带重着色，alpha 不变）----
        skin_rgba = {}
        for skin in SKINS:
            skin_rgba[skin] = growth_skins.colorize(w, h, clean, palettes[skin])

        nofin_bytes = encode_bytes(w, h, nofin)
        fin_bytes = encode_bytes(w, h, fin)
        clean_bytes = encode_bytes(w, h, clean)
        encode(os.path.join(PARTS, slot, 'nofin.png'), w, h, nofin)
        encode(os.path.join(PARTS, slot, 'fin.png'), w, h, fin)
        encode(os.path.join(PARTS, slot, 'clean.png'), w, h, clean)
        skin_rec = {}
        for skin in SKINS:
            b = encode_bytes(w, h, skin_rgba[skin])
            encode(os.path.join(PARTS, slot, '%s.png' % skin), w, h, skin_rgba[skin])
            skin_rec[skin] = {'sha256': sha256_bytes(b), 'dims': [w, h]}

        manifest['parts'][slot] = {
            'src': 'parts/%s/default.png' % slot,
            'src_sha256': manifest['default_sha256'][slot],
            'dims': [w, h],
            'fin_pixels': fin_px,
            'fin_bbox': list(fbbox) if fbbox else None,
            'roi': list(roi) if roi else None,
            'residual_border_px': resid,
            'nofin_sha256': sha256_bytes(nofin_bytes),
            'fin_sha256': sha256_bytes(fin_bytes),
            'clean_sha256': sha256_bytes(clean_bytes),
            'clean_stats': cstats,
            'skins': skin_rec,
        }
        if slot in ('torso', 'head', 'tail_base'):
            assets_keep[slot] = {
                'w': w, 'h': h, 'px': px, 'nofin': nofin, 'fin': fin,
                'clean': clean, 'skins': skin_rgba,
            }
        if verbose:
            print('  %-11s %4dx%-4d  种子 %-6d fin %-7d (%.2f%%)  残留描边 %d  '
                  'clean 裁 %-6d 孤岛 %d' % (
                      slot, w, h, seedn, fin_px, fin_px * 100.0 / (w * h), resid,
                      cstats['cut_pixels'], cstats['dropped_islands']))

    # crown / blade：只认全量构建时的 torso
    if 'torso' in chosen:
        w, h, px = decode(os.path.join(PARTS, 'torso', 'default.png'))
        mask, origin, roi, seedn = build_mask(w, h, px, want_origin=True)
        crystal = pick_crystals(w, h, px, mask, origin)
        if not crystal or 'crown' not in crystal:
            raise SystemExit('torso 背鳍里没有找到可用晶体（阈值 MIN_CRYSTAL=%d）' % MIN_CRYSTAL)
        os.makedirs(FINS, exist_ok=True)
        for key, sp in crystal.items():
            b = encode_bytes(sp['dims'][0], sp['dims'][1], sp['_rgba'])
            path = os.path.join(FINS, '%s.png' % key)
            encode(path, sp['dims'][0], sp['dims'][1], sp['_rgba'])
            manifest['fins'][key] = {
                'src': 'torso',
                'path': 'fins/%s.png' % key,
                'dims': sp['dims'],
                'pixels': sp['pixels'],
                'src_bbox': sp['src_bbox'],
                'anchor': sp['anchor'],
                'aspect': sp['aspect'],
                'sha256': sha256_bytes(b),
            }
            sprites_out[key] = sp
            if verbose:
                print('  %-11s %4dx%-4d  pixels %-6d bbox %s anchor %s' % (
                    'fins/' + key, sp['dims'][0], sp['dims'][1], sp['pixels'],
                    sp['src_bbox'], sp['anchor']))
        # 参考图兜底：若 crown/blade 的对照槽位没在同一批构建里，则补解码
        for s in ('torso', 'head', 'tail_base'):
            if s not in assets_keep and os.path.isfile(os.path.join(PARTS, s, 'nofin.png')):
                ww, hh, pp = decode(os.path.join(PARTS, s, 'default.png'))
                mm, _, roi, _ = build_mask(ww, hh, pp)
                nn, ff = split_layers(ww, hh, pp, mm)
                clean2, _ = growth_clean.make_clean(ww, hh, pp, mm, roi)
                assets_keep[s] = {
                    'w': ww, 'h': hh, 'px': pp, 'nofin': nn, 'fin': ff,
                    'clean': clean2, 'skins': {
                        sk: growth_skins.colorize(ww, hh, clean2, palettes[sk])
                        for sk in SKINS},
                }

    with open(MANIFEST + '.tmp', 'w', encoding='utf-8') as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False, sort_keys=True)
        fh.write('\n')
    os.replace(MANIFEST + '.tmp', MANIFEST)

    if want_inspection:
        for s in ('torso', 'head', 'tail_base'):
            if s not in assets_keep:
                ww, hh, pp = decode(os.path.join(PARTS, s, 'default.png'))
                mm, _, roi, _ = build_mask(ww, hh, pp)
                nn, ff = split_layers(ww, hh, pp, mm)
                clean2, _ = growth_clean.make_clean(ww, hh, pp, mm, roi)
                assets_keep[s] = {
                    'w': ww, 'h': hh, 'px': pp, 'nofin': nn, 'fin': ff,
                    'clean': clean2, 'skins': {
                        sk: growth_skins.colorize(ww, hh, clean2, palettes[sk])
                        for sk in SKINS},
                }
        iw, ih = make_inspection(assets_keep, sprites_out, INSPECTION)
        if verbose:
            print('  检视图 → %s  (%dx%d)' % (INSPECTION, iw, ih))
    return manifest


# ---------------------------------------------------------------- 校验
def _composite_match(w: int, h: int, default, nofin, fin) -> int:
    """nofin 与 fin 是互补拆层；把 fin 叠到 nofin 上（over 合成）应逐像素等于 default。
    返回不匹配的像素数。这是「实际互补重组」的硬校验，不依赖 manifest 里的 SHA。"""
    n = w * h
    bad = 0
    for i in range(n):
        na = nofin[i * 4 + 3]
        fa = fin[i * 4 + 3]
        if fa == 0:
            cr, cg, cb, ca = nofin[i * 4], nofin[i * 4 + 1], nofin[i * 4 + 2], na
        elif na == 0:
            cr, cg, cb, ca = fin[i * 4], fin[i * 4 + 1], fin[i * 4 + 2], fa
        else:
            fa2 = fa / 255.0
            na2 = na / 255.0
            ca = fa + na * (1 - fa2)
            if ca <= 0:
                cr = cg = cb = 0
            else:
                cr = (fin[i * 4] * fa2 + nofin[i * 4] * na2 * (1 - fa2)) / ca
                cg = (fin[i * 4 + 1] * fa2 + nofin[i * 4 + 1] * na2 * (1 - fa2)) / ca
                cb = (fin[i * 4 + 2] * fa2 + nofin[i * 4 + 2] * na2 * (1 - fa2)) / ca
            ca = round(ca)
        dr, dg, db, da = default[i * 4], default[i * 4 + 1], default[i * 4 + 2], default[i * 4 + 3]
        if (round(cr), round(cg), round(cb), int(ca)) != (dr, dg, db, da):
            bad += 1
    return bad


def _alpha_bytes(px) -> bytes:
    a = bytearray(len(px) // 4)
    for i in range(len(a)):
        a[i] = px[i * 4 + 3]
    return bytes(a)


def check(verbose=True) -> int:
    if not os.path.isfile(MANIFEST):
        print('FAIL 缺 manifest: ' + MANIFEST)
        return 1
    with open(MANIFEST, encoding='utf-8') as fh:
        man = json.load(fh)
    fails = []

    # 1) default.png 一律未被改动
    for slot in SLOTS:
        src = os.path.join(PARTS, slot, 'default.png')
        cur = sha256_file(src)
        want = man.get('default_sha256', {}).get(slot)
        if want is None:
            fails.append('manifest 缺 default_sha256: ' + slot)
        elif cur != want:
            fails.append('default.png 被改动: %s (%s != %s)' % (slot, cur[:12], want[:12]))
    if verbose:
        print('  [1] default.png SHA 不变 ........ %s' % ('PASS' if not fails else 'FAIL'))

    # 2) 生成物 SHA 一致（nofin / fin / clean / 4 skins / crown / blade）
    stage2 = []
    for slot, rec in man.get('parts', {}).items():
        for kind, key in (('nofin', 'nofin_sha256'), ('fin', 'fin_sha256'),
                          ('clean', 'clean_sha256')):
            p = os.path.join(PARTS, slot, kind + '.png')
            if not os.path.isfile(p):
                stage2.append('缺生成物: ' + p)
            elif sha256_file(p) != rec.get(key):
                stage2.append('生成物与 manifest 不一致: ' + p)
        for skin in SKINS:
            p = os.path.join(PARTS, slot, skin + '.png')
            srec = rec.get('skins', {}).get(skin)
            if srec is None:
                stage2.append('manifest 缺 skin 记录: %s/%s' % (slot, skin))
            elif not os.path.isfile(p):
                stage2.append('缺生成物: ' + p)
            elif sha256_file(p) != srec.get('sha256'):
                stage2.append('生成物与 manifest 不一致: ' + p)
    for key, rec in man.get('fins', {}).items():
        p = os.path.join(GODZ, 'fins', key + '.png')
        if not os.path.isfile(p):
            stage2.append('缺生成物: ' + p)
        elif sha256_file(p) != rec.get('sha256'):
            stage2.append('生成物与 manifest 不一致: ' + p)
    fails += stage2
    if verbose:
        print('  [2] 生成物 SHA 一致 ............ %s' % ('PASS' if not stage2 else 'FAIL'))

    # 3) 实际互补重组：从磁盘读 nofin + fin，over 合成必须等于 default（不信任 manifest）
    stage3 = []
    for slot, rec in man.get('parts', {}).items():
        src = os.path.join(PARTS, slot, 'default.png')
        w, h, px = decode(src)
        nf = decode(os.path.join(PARTS, slot, 'nofin.png'))
        fn = decode(os.path.join(PARTS, slot, 'fin.png'))
        bad = _composite_match(w, h, px, nf[2], fn[2])
        if bad:
            stage3.append('%s nofin+fin 重组与 default 不符 %d 像素（互补拆层失效）' % (slot, bad))
    fails += stage3
    if verbose:
        print('  [3] nofin+fin 重组==default ..... %s' % ('PASS' if not stage3 else 'FAIL'))

    # 4) clean + 4 skins：尺寸==default，彼此 alpha 一致；clean 无强蓝鳍残点
    stage4 = []
    blue_report = {}
    comp_report = {}
    for slot, rec in man.get('parts', {}).items():
        src = os.path.join(PARTS, slot, 'default.png')
        w, h, px = decode(src)
        if [w, h] != rec['dims']:
            stage4.append('%s default 尺寸与 manifest 不符' % slot)
            continue
        _, _, clean = decode(os.path.join(PARTS, slot, 'clean.png'))
        if [w, h] != rec['dims']:
            stage4.append('%s clean 尺寸不符' % slot)
        calpha = _alpha_bytes(clean)
        for skin in SKINS:
            sw, sh, spx = decode(os.path.join(PARTS, slot, skin + '.png'))
            if [sw, sh] != [w, h]:
                stage4.append('%s %s 尺寸不符' % (slot, skin))
            elif _alpha_bytes(spx) != calpha:
                stage4.append('%s %s 与 clean 的 alpha 不一致（同尺寸同alpha 被破坏）' % (slot, skin))
        # 强蓝鳍残点：clean 在鳍框（外扩 margin）内不应再有 b-r>=BLUE_MIN 的像素
        fb = rec.get('fin_bbox')
        if fb:
            bx0, by0, bx1, by1 = (max(0, fb[0] - growth_clean.ISLAND_MARGIN),
                                  max(0, fb[1] - growth_clean.ISLAND_MARGIN),
                                  min(w - 1, fb[2] + growth_clean.ISLAND_MARGIN),
                                  min(h - 1, fb[3] + growth_clean.ISLAND_MARGIN))
            blue = 0
            for y in range(by0, by1 + 1):
                for x in range(bx0, bx1 + 1):
                    i = (y * w + x) * 4
                    if clean[i + 3] < 128:
                        continue
                    if (clean[i + 2] - clean[i]) >= growth_clean.BLUE_MIN:
                        blue += 1
            blue_report[slot] = blue
            if blue:
                stage4.append('%s clean 鳍框内仍有 %d 个强蓝鳍残点（外鳍残影）' % (slot, blue))
        # 诊断量（仅报告，不作判定）：clean 相对 default 的连通域/封闭孔变化，
        # 用以佐证「未新增空洞、未新增碎块」。注意：这不能证明修复区与真实体表一致。
        n_c_default = len(growth_clean.components(w, h, px))
        n_c_clean = len(growth_clean.components(w, h, clean))
        h_d, _ = growth_clean.enclosed_holes(w, h, px)
        h_c, _ = growth_clean.enclosed_holes(w, h, clean)
        comp_report[slot] = (n_c_default, n_c_clean, h_d, h_c)
    fails += stage4
    if verbose:
        print('  [4] clean+skins 尺寸/alpha/无残鳍 %s' % ('PASS' if not stage4 else 'FAIL'))
        if blue_report:
            print('      强蓝鳍残点(鳍框内, 期望0): ' +
                  ', '.join('%s=%d' % kv for kv in sorted(blue_report.items())))
        print('      [诊断] default→clean 连通域/封闭孔 (不用于判定):')
        for slot in sorted(comp_report):
            nd, nc, hd, hc = comp_report[slot]
            print('        %-11s 连通域 %d→%d  封闭孔 %d→%d' % (slot, nd, nc, hd, hc))

    # 5) crown / blade：像素确属 torso 背鳍、挂点在框内
    stage5 = []
    if 'torso' in man.get('parts', {}):
        w, h, px = decode(os.path.join(PARTS, 'torso', 'default.png'))
        mask, origin, roi, seedn = build_mask(w, h, px, want_origin=True)
        crystal = pick_crystals(w, h, px, mask, origin)
        for key, rec in man.get('fins', {}).items():
            sp = crystal.get(key) if crystal else None
            if sp is None:
                stage5.append('重算未得到晶体: ' + key)
                continue
            if sp['dims'] != rec['dims'] or sp['pixels'] != rec['pixels']:
                stage5.append('%s 尺寸/像素重算不符' % key)
            if sp['src_bbox'] != rec['src_bbox']:
                stage5.append('%s src_bbox 重算不符' % key)
            if sp['anchor'] != rec['anchor']:
                stage5.append('%s anchor 重算不符' % key)
            ax, ay = rec['anchor']
            if not (0.0 <= ax <= 1.0 and 0.0 <= ay <= 1.0):
                stage5.append('%s anchor 越界: %s' % (key, rec['anchor']))
            x0, y0, x1, y1 = rec['src_bbox']
            if not (0 <= x0 <= x1 < w and 0 <= y0 <= y1 < h):
                stage5.append('%s src_bbox 越界' % key)
            if rec['pixels'] <= 0:
                stage5.append('%s 像素数为 0' % key)
            sp_path = os.path.join(GODZ, 'fins', key + '.png')
            if os.path.isfile(sp_path):
                sw, sh, spx_px = decode(sp_path)
                if [sw, sh] != rec['dims']:
                    stage5.append('%s 磁盘精灵尺寸不符' % key)
                opaque = 0
                intruder = 0
                for yy in range(sh):
                    for xx in range(sw):
                        si = (yy * sw + xx) * 4
                        if spx_px[si + 3] == 0:
                            continue
                        opaque += 1
                        tx, ty = x0 + xx, y0 + yy
                        ti = ty * w + tx
                        if not (0 <= tx < w and 0 <= ty < h) or not mask[ti]:
                            intruder += 1
                        elif (spx_px[si], spx_px[si + 1], spx_px[si + 2], spx_px[si + 3]) != \
                                (px[ti * 4], px[ti * 4 + 1], px[ti * 4 + 2], px[ti * 4 + 3]):
                            intruder += 1
                if opaque != rec['pixels']:
                    stage5.append('%s 磁盘精灵不透明像素数 %d != %d' % (key, opaque, rec['pixels']))
                if intruder:
                    stage5.append('%s 精灵含 %d 个不属于 torso 背鳍掩膜的像素（可能带入身体）' % (key, intruder))
    fails += stage5
    if verbose:
        print('  [5] crown/blade 晶体有效 ........ %s' % ('PASS' if not stage5 else 'FAIL'))

    # 6) 调色真源 palettes.json 存在且为合法 JSON、含四套 ramp
    stage6 = []
    if not os.path.isfile(PALETTES):
        stage6.append('缺 palettes.json: ' + PALETTES)
    else:
        try:
            with open(PALETTES, encoding='utf-8') as fh:
                pal = json.load(fh)
            for skin in SKINS:
                if skin not in pal or 'ramp' not in pal[skin]:
                    stage6.append('palettes.json 缺主题 %s 的 ramp' % skin)
            want_pal_sha = man.get('palette_sha256')
            if want_pal_sha and sha256_file(PALETTES) != want_pal_sha:
                stage6.append('palettes.json SHA 与 manifest 不符（被改动）')
        except Exception as e:  # noqa: BLE001
            stage6.append('palettes.json 解析失败: %s' % e)
    fails += stage6
    if verbose:
        print('  [6] palettes.json 合法且完整 .... %s' % ('PASS' if not stage6 else 'FAIL'))

    if verbose:
        print('\n  [自动检测限度说明]')
        print('   · 本脚本只用「强蓝晶体 (b-r>=%d) 计数 + 连通域/封闭孔数差」做辅助诊断，' % growth_clean.BLUE_MIN)
        print('     不能证明 clean 修复区与原画被鳍遮挡的真实体表一致——那部分像素是几何合成的。')
        print('   · 「无身体损失」无法由本脚本自身判据自证；clean 是否自然以')
        print('     outputs/growth-skins-inspection.png 目视验收为准（head/torso/tail_base 必看）。')

    if fails:
        print('\nCHECK FAIL:')
        for f in fails:
            print('  - ' + f)
        return 1
    print('\nCHECK PASS: 生成物一致、default 未改动、nofin+fin 可重组回 default、'
          'clean+4 skins 尺寸/alpha 合规且无强蓝鳍残点。')
    return 0


# ---------------------------------------------------------------- CLI
def main(argv) -> int:
    args = argv[1:]
    mode_check = '--check' in args
    want_inspection = '--no-inspection' not in args
    slots = None
    if '--slots' in args:
        i = args.index('--slots')
        slots = [a for a in args[i + 1:] if not a.startswith('--')]
        if not slots:
            print('--slots 后面要给槽位名', file=sys.stderr)
            return 2
    if mode_check:
        return check()
    print('生成背鳍拆解资产（纯 stdlib）…')
    build(slots=slots, want_inspection=want_inspection)
    print('manifest → %s' % MANIFEST)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
