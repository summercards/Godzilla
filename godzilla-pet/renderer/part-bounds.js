/* 由 build/make-part-bounds.py 从部件图直接量出，不要手改。
 *
 * 每个部件在自身图像坐标系里的不透明范围 [x0,y0,x1,y1]。
 * 渲染层据此算出角色包围盒，把「屏幕身高」换算成骨骼缩放，因此运行时
 * 不需要 getImageData —— 桌宠走 file:// 协议，那条路会被画布污染规则挡住。
 */
(function (root) {
  'use strict';
  root.PartBounds = {
    "far_shin": [
      2,
      0,
      259,
      213
    ],
    "far_thigh": [
      2,
      0,
      219,
      285
    ],
    "forearm": [
      0,
      5,
      252,
      153
    ],
    "head": [
      1,
      25,
      351,
      254
    ],
    "jaw": [
      0,
      0,
      128,
      109
    ],
    "shin": [
      30,
      0,
      392,
      177
    ],
    "tail_base": [
      0,
      5,
      409,
      371
    ],
    "tail_mid": [
      0,
      68,
      307,
      337
    ],
    "tail_tip": [
      18,
      70,
      346,
      339
    ],
    "thigh": [
      0,
      0,
      389,
      364
    ],
    "torso": [
      171,
      81,
      1270,
      918
    ],
    "upper_arm": [
      0,
      0,
      213,
      210
    ]
  };
})(typeof window !== 'undefined' ? window : this);
