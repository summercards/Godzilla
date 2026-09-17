#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""growth_clean.py —— 从 default 部件贴图里「彻底」去掉背鳍，得到自然实心体表 clean。

被 build/growth-assets.py 调用（本文件必须留在 build/ 目录）。

为什么需要它
------------------------------------------------------------------
原 growth-assets.py 只做「互补拆层」：把背鳍像素（青蓝晶体）挖到 fin.png，
其余留在 nofin.png。但背鳍除晶体外还有一圈**青黑描边**，且这圈描边的颜色
与体表暗部几乎同色（实测近邻暗像素 r>=g 占多数，r-g 落在 [-9,0] 一带），
**纯颜色判据无法把它和身体分开**。于是 nofin 里留下清晰的「黑色空心鳍边框」，
并且挖走晶体的地方变成透明穿孔 —— 不能当「没长鳍的身体」用。

算法（三步，几何为主）
------------------------------------------------------------------
1) 鳍团块 blob = 晶体 mask ∪ 从晶体沿「暗像素」向外生长的 BLOB_RINGS 圈
   （只吃 max(r,g,b)<=DARK_MAX 的像素，且不越出 ROI）。这圈暗像素主要就是
   鳍的描边与暗根部，也会顺带吃掉鳍根附近一点体表 —— 这正是我们要修复的区域。
2) 修复：洋葱皮 inpaint。以「非 blob 的不透明像素」为源，一层层向 blob 内部
   取邻域均值，把 blob 填成连续的体表色（保留周围鳞甲的明暗梯度）。
3) 裁形：背鳍是长在背脊上的附肢，去掉后应按「背脊线」收口。背脊线取每列
   晶体最深 y（=鳍根），做 BACK_WIN 列滑动平均，并 clamp 在
   [鳍根-BACK_CLAMP_UP, 鳍根+BACK_CLAMP_DN]，避免过切体表或留鳍桩；
   无晶体的列直接用体表顶线（不裁）。背脊线以上的不透明像素置为 alpha=0，
   并沿新背脊补 1px 暗边，贴合原画的剪影描边风格。

已知限度（--check 会原样标注）：本模块只能**几何上**去掉鳍并补面，
无法证明「修复区与真实（被晶体遮住的）体表一致」——那部分像素原作没有，
是合成的。因此 clean 的质量必须靠人眼看 outputs/growth-skins-inspection.png。
"""
from __future__ import annotations

from collections import deque

# ---------------------------------------------------------------- 参数
DARK_MAX = 76        # blob 生长时「暗像素」上限（鳍描边/暗根部都在这以下）
BLOB_RINGS = 14      # blob 从晶体向外最多生长圈数
BACK_WIN = 55        # 背脊包络的滑动平均窗口（列）
BACK_CLAMP_UP = 10   # 背脊线最多比鳍根「高」多少像素（限制多切体表）
BACK_CLAMP_DN = 6    # 背脊线最多比鳍根「低」多少像素（限制残留鳍桩）
EDGE_DARKEN = True   # 是否沿新背脊补 1~2px 暗边
ISLAND_MIN = 600     # clean 中「比它小、且整体落在鳍框附近」的不透明孤岛 → 判为残留并抹掉
ISLAND_MARGIN = 24   # 鳍框外扩像素，界定「鳍附近」
BLUE_MIN = 25        # b-r 达到它即视为「强蓝=鳍晶体」；clean 里不该有（实测体表 b-r<=17）


def blob_grow(w: int, h: int, px, mask, roi):
    """晶体 mask 沿暗像素向外生长，得到「鳍团块」（含描边/暗根部）。"""
    n = w * h
    blob = bytearray(mask)
    rx0, ry0, rx1, ry1 = roi
    front = [i for i in range(n) if mask[i]]
    for _ in range(BLOB_RINGS):
        nxt = []
        for p in front:
            y, x = divmod(p, w)
            for dy in (-1, 0, 1):
                ny = y + dy
                if ny < ry0 or ny > ry1:
                    continue
                for dx in (-1, 0, 1):
                    nx = x + dx
                    if nx < rx0 or nx > rx1:
                        continue
                    q = ny * w + nx
                    if blob[q] or px[q * 4 + 3] < 128:
                        continue
                    if max(px[q * 4], px[q * 4 + 1], px[q * 4 + 2]) <= DARK_MAX:
                        blob[q] = 1
                        nxt.append(q)
        front = nxt
        if not front:
            break
    return blob


def inpaint(w: int, h: int, px, blob):
    """洋葱皮填充：把 blob 用「非 blob 不透明邻居」的均值一层层填成体表色。

    未被填到的孤立 blob 像素保留原色原 alpha —— 绝不制造新的透明孔。
    """
    n = w * h
    out = bytearray(px)
    unknown = bytearray(blob)
    frontier = deque()
    for i in range(n):
        if not unknown[i]:
            continue
        y, x = divmod(i, w)
        found = False
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w:
                    q = ny * w + nx
                    if not unknown[q] and px[q * 4 + 3] >= 128:
                        found = True
        if found:
            frontier.append(i)
    while frontier:
        i = frontier.popleft()
        if not unknown[i]:
            continue
        y, x = divmod(i, w)
        rs = gs = bs = cnt = 0
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w:
                    q = ny * w + nx
                    if not unknown[q] and px[q * 4 + 3] >= 128:
                        rs += out[q * 4]
                        gs += out[q * 4 + 1]
                        bs += out[q * 4 + 2]
                        cnt += 1
        if not cnt:
            continue
        out[i * 4], out[i * 4 + 1], out[i * 4 + 2], out[i * 4 + 3] = \
            rs // cnt, gs // cnt, bs // cnt, 255
        unknown[i] = 0
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and unknown[ny * w + nx]:
                    frontier.append(ny * w + nx)
    return out


def _col_bounds(w: int, h: int, px, mask):
    """返回 (crystal_bottom[x], body_top[x])：每列晶体最深 y / 体表顶线。"""
    cbot = [None] * w
    btop = [None] * w
    for x in range(w):
        lo = -1
        for y in range(h):
            if mask[y * w + x]:
                lo = y
        if lo >= 0:
            cbot[x] = lo
        ty = -1
        for y in range(h):
            if px[(y * w + x) * 4 + 3] >= 128:
                ty = y
                break
        if ty >= 0:
            btop[x] = ty
    return cbot, btop


def _smooth(vals, win: int):
    half = win // 2
    out = []
    for i in range(len(vals)):
        acc = c = 0
        for j in range(max(0, i - half), min(len(vals), i + half + 1)):
            if vals[j] is not None:
                acc += vals[j]
                c += 1
        out.append(acc / c if c else None)
    return out


def back_line(w: int, h: int, px, mask):
    """背脊线 cut[x]：背脊线以上的不透明像素应被置为透明。None=该列不裁。"""
    cbot, btop = _col_bounds(w, h, px, mask)
    raw = [cbot[x] if cbot[x] is not None else btop[x] for x in range(w)]
    prof = _smooth(raw, BACK_WIN)
    cut = [None] * w
    for x in range(w):
        if cbot[x] is None:
            cut[x] = None                       # 无鳍的列：保持原剪影
            continue
        p = prof[x]
        if p is None:
            p = cbot[x]
        p = min(p, cbot[x] + BACK_CLAMP_DN)
        p = max(p, cbot[x] - BACK_CLAMP_UP)
        cut[x] = int(round(p))
    return cut


def components(w: int, h: int, px):
    """8 连通的不透明连通域。返回 [(size, (x0,y0,x1,y1), [indices...]), ...]，按 size 降序。"""
    n = w * h
    seen = bytearray(n)
    out = []
    for i in range(n):
        if seen[i] or px[i * 4 + 3] < 128:
            continue
        seen[i] = 1
        dq = deque([i])
        cnt = 0
        x0 = y0 = 1 << 30
        x1 = y1 = -1
        pix = []
        while dq:
            p = dq.popleft()
            cnt += 1
            pix.append(p)
            y, x = divmod(p, w)
            if x < x0:
                x0 = x
            if x > x1:
                x1 = x
            if y < y0:
                y0 = y
            if y > y1:
                y1 = y
            for dy in (-1, 0, 1):
                ny = y + dy
                if ny < 0 or ny >= h:
                    continue
                for dx in (-1, 0, 1):
                    nx = x + dx
                    if nx < 0 or nx >= w:
                        continue
                    q = ny * w + nx
                    if not seen[q] and px[q * 4 + 3] >= 128:
                        seen[q] = 1
                        dq.append(q)
        out.append((cnt, (x0, y0, x1, y1), pix))
    out.sort(key=lambda t: -t[0])
    return out


def drop_islands(w: int, h: int, out, bbox, min_size: int = ISLAND_MIN,
                 margin: int = ISLAND_MARGIN):
    """抹掉「落鳍框附近的小孤岛」——裁形后在背鳍附近断开、飘着的暗描边碎条。

    只动 bbox 外扩 margin 之内的、size<min_size 的连通域；离鳍远的身体小部件不动。
    返回被抹掉的孤岛数。
    """
    if bbox is None:
        return 0
    bx0, by0, bx1, by1 = bbox
    bx0 -= margin
    by0 -= margin
    bx1 += margin
    by1 += margin
    dropped = 0
    for cnt, (x0, y0, x1, y1), pix in components(w, h, out):
        if cnt >= min_size:
            continue
        if x0 >= bx0 and y0 >= by0 and x1 <= bx1 and y1 <= by1:
            for p in pix:
                out[p * 4 + 3] = 0
            dropped += 1
    return dropped


def make_clean(w: int, h: int, px, mask, roi):
    """返回 (clean_rgba, stats)。clean 与 default 同尺寸；有鳍处补成实心体表。

    无鳍槽位（mask 全 0 / roi 为 None）直接原样返回 default 的副本。
    """
    if roi is None or not any(mask):
        return bytearray(px), {
            'blob_pixels': 0, 'blob_extra': 0, 'cut_pixels': 0,
            'edge_pixels': 0, 'dropped_islands': 0, 'blue_healed': 0,
        }
    blob = blob_grow(w, h, px, mask, roi)
    # 强蓝残点（孤立的鳍晶体碎屑）一并纳入 blob，交给 inpaint 补成体表色，避免留蓝点/穿孔
    fbbox0 = mask_bbox(w, mask)
    blue_healed = 0
    if fbbox0 is not None:
        rx0, ry0, rx1, ry1 = roi
        for y in range(ry0, ry1 + 1):
            for x in range(rx0, rx1 + 1):
                i = y * w + x
                if blob[i] or px[i * 4 + 3] < 128:
                    continue
                if (px[i * 4 + 2] - px[i * 4]) >= BLUE_MIN:
                    blob[i] = 1
                    blue_healed += 1
    filled = inpaint(w, h, px, blob)
    cut = back_line(w, h, px, mask)
    out = bytearray(filled)
    edge = []
    for x in range(w):
        p = cut[x]
        if p is None:
            continue
        for y in range(0, p):
            i = y * w + x
            if out[i * 4 + 3] >= 128:
                out[i * 4 + 3] = 0
        for dy in (0, 1):
            y = p + dy
            if 0 <= y < h and out[(y * w + x) * 4 + 3] >= 128:
                edge.append((x, y))
    if EDGE_DARKEN:
        for (x, y) in edge:
            i = y * w + x
            r, g, b = out[i * 4], out[i * 4 + 1], out[i * 4 + 2]
            out[i * 4] = max(2, r // 6)
            out[i * 4 + 1] = max(2, g // 6)
            out[i * 4 + 2] = max(4, b // 6)
    dropped = drop_islands(w, h, out, fbbox0)
    # 统计：被裁掉（变成透明）的像素数、被修复的 blob 像素数
    cut_px = 0
    for i in range(w * h):
        if px[i * 4 + 3] >= 128 and out[i * 4 + 3] == 0:
            cut_px += 1
    stats = {
        'blob_pixels': sum(blob),
        'blob_extra': sum(blob) - sum(mask),
        'cut_pixels': cut_px,
        'edge_pixels': len(edge) if EDGE_DARKEN else 0,
        'dropped_islands': dropped,
        'blue_healed': blue_healed,
    }
    return out, stats


def mask_bbox(w: int, mask):
    x0 = y0 = 1 << 30
    x1 = y1 = -1
    for i in range(len(mask)):
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


def enclosed_holes(w: int, h: int, px):
    """数「封闭透明孔」：透明像素中，不与图像边界连通的那些。

    用于 --check：clean 不应比 default 多出封闭孔（=鳍根穿孔已修复）。
    返回 (count, set_of_indices)。
    """
    n = w * h
    seen = bytearray(n)
    dq = deque()
    for x in range(w):
        for y in (0, h - 1):
            i = y * w + x
            if px[i * 4 + 3] < 128 and not seen[i]:
                seen[i] = 1
                dq.append(i)
    for y in range(h):
        for x in (0, w - 1):
            i = y * w + x
            if px[i * 4 + 3] < 128 and not seen[i]:
                seen[i] = 1
                dq.append(i)
    while dq:
        i = dq.popleft()
        y, x = divmod(i, w)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w:
                    q = ny * w + nx
                    if not seen[q] and px[q * 4 + 3] < 128:
                        seen[q] = 1
                        dq.append(q)
    holes = set()
    for i in range(n):
        if px[i * 4 + 3] < 128 and not seen[i]:
            holes.add(i)
    return len(holes), holes
