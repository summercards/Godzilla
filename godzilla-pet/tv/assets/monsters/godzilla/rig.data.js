/* 由 build/derive-rig.cjs 从 assets/monsters/godzilla/rig.json 生成 —— 不要手改，改母图元数据后重跑脚本。 */
(function(root){'use strict';
var RIG={
  "monster": "godzilla",
  "version": 1,
  "scale": 0.4,
  "order": [
    "tail_tip",
    "tail_mid",
    "tail_base",
    "far_thigh",
    "far_shin",
    "torso",
    "thigh",
    "shin",
    "upper_arm",
    "forearm",
    "jaw",
    "head"
  ],
  "slots": {
    "tail_tip": {
      "parent": "tail_mid",
      "png": "parts/tail_tip/default.png",
      "size": [
        346,
        350
      ],
      "scale": 0.4,
      "pivotOffset": [
        322,
        142
      ],
      "atlas": {
        "origin": [
          0,
          514
        ],
        "sourcePivot": [
          322,
          656
        ]
      }
    },
    "tail_mid": {
      "parent": "tail_base",
      "png": "parts/tail_mid/default.png",
      "size": [
        307,
        337
      ],
      "scale": 0.4,
      "pivotOffset": [
        260,
        197
      ],
      "atlas": {
        "origin": [
          345,
          533
        ],
        "sourcePivot": [
          605,
          730
        ]
      }
    },
    "tail_base": {
      "parent": "torso",
      "png": "parts/tail_base/default.png",
      "size": [
        409,
        385
      ],
      "scale": 0.4,
      "pivotOffset": [
        318,
        234
      ],
      "atlas": {
        "origin": [
          499,
          568
        ],
        "sourcePivot": [
          817,
          802
        ]
      }
    },
    "far_thigh": {
      "parent": "torso",
      "png": "parts/far_thigh/default.png",
      "size": [
        298,
        285
      ],
      "scale": 0.4,
      "pivotOffset": [
        83,
        84
      ],
      "atlas": {
        "origin": [
          1161,
          603
        ],
        "sourcePivot": [
          1244,
          687
        ]
      }
    },
    "far_shin": {
      "parent": "far_thigh",
      "png": "parts/far_shin/default.png",
      "size": [
        261,
        217
      ],
      "scale": 0.4,
      "pivotOffset": [
        127,
        61
      ],
      "atlas": {
        "origin": [
          1182,
          792
        ],
        "sourcePivot": [
          1309,
          853
        ]
      }
    },
    "torso": {
      "parent": null,
      "png": "parts/torso/default.png",
      "size": [
        1445,
        979
      ],
      "scale": 0.4,
      "pivotOffset": [
        907,
        652
      ],
      "atlas": {
        "origin": [
          81,
          21
        ],
        "sourcePivot": [
          988,
          673
        ]
      }
    },
    "thigh": {
      "parent": "torso",
      "png": "parts/thigh/default.png",
      "size": [
        389,
        364
      ],
      "scale": 0.4,
      "pivotOffset": [
        181,
        127
      ],
      "atlas": {
        "origin": [
          807,
          546
        ],
        "sourcePivot": [
          988,
          673
        ]
      }
    },
    "shin": {
      "parent": "thigh",
      "png": "parts/shin/default.png",
      "size": [
        392,
        188
      ],
      "scale": 0.4,
      "pivotOffset": [
        259,
        45
      ],
      "atlas": {
        "origin": [
          802,
          836
        ],
        "sourcePivot": [
          1061,
          881
        ]
      }
    },
    "upper_arm": {
      "parent": "torso",
      "png": "parts/upper_arm/default.png",
      "size": [
        213,
        210
      ],
      "scale": 0.4,
      "pivotOffset": [
        43,
        54
      ],
      "atlas": {
        "origin": [
          1100,
          316
        ],
        "sourcePivot": [
          1143,
          370
        ]
      }
    },
    "forearm": {
      "parent": "upper_arm",
      "png": "parts/forearm/default.png",
      "size": [
        312,
        182
      ],
      "scale": 0.4,
      "pivotOffset": [
        41,
        82
      ],
      "atlas": {
        "origin": [
          1216,
          390
        ],
        "sourcePivot": [
          1257,
          472
        ]
      }
    },
    "jaw": {
      "parent": "head",
      "png": "parts/jaw/default.png",
      "size": [
        134,
        114
      ],
      "scale": 0.4,
      "pivotOffset": [
        22,
        23
      ],
      "atlas": {
        "origin": [
          1270,
          176
        ],
        "sourcePivot": [
          1292,
          199
        ]
      }
    },
    "head": {
      "parent": "torso",
      "png": "parts/head/default.png",
      "size": [
        391,
        289
      ],
      "scale": 0.4,
      "pivotOffset": [
        85,
        187
      ],
      "atlas": {
        "origin": [
          1095,
          23
        ],
        "sourcePivot": [
          1180,
          210
        ]
      }
    }
  }
};
if(typeof module!=='undefined'&&module.exports)module.exports=RIG;
else{(root.KaijuMonsters=root.KaijuMonsters||{})[RIG.monster]=RIG;}
})(typeof window!=='undefined'?window:this);
