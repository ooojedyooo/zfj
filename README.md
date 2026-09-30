# 炸飞机 · zfj

微信**小游戏** · 双人实时对战。

在 9×9 棋盘上布置飞机，双方轮流报点轰炸，**击毁对方全部飞机者获胜**。
规则源自纸笔时代的经典对战游戏，数字化后支持在线房间、随机匹配与好友邀战。

---

## ⚠️ 先读：这是「小游戏」，不是「小程序」

微信把两者按**注册时的服务类目**区分，**且注册后不可逆**：

| | 微信小程序 | 微信小游戏 |
|---|---|---|
| 入口文件 | `app.json` + `app.js` | `game.json` + `game.js` |
| 界面 | WXML + WXSS，多页面路由 | **没有 WXML/WXSS/DOM，全靠 Canvas 手绘** |
| 本项目 | `miniprogram/`（保留作参考实现） | **`minigame/`（当前主线，用于上架）** |

本账号的服务类目是**游戏**，即小游戏账号 —— 用小程序工程去编译会直接报
`miniprogram/game.json: 未找到 或者文件读取失败`（工具按 **AppID 的账号类型**决定编译模式，
`project.config.json` 里的 `compileType` 改不动它）。

因此实际交付**重构为小游戏 Canvas 版**。好消息是：`config/`（规则 / 机型 / 道具 / 社交）、
`utils/`（形状 / 旋转 / 碰撞 / 判定）、`services/`（统一数据接口 / 离线引擎 / 最近对手）、
`cloudfunctions/`（云函数）**全部原样复用**——它们不依赖 WXML。只有渲染与交互层重写了。

---

## 两套端的关系

```
                         ┌──────────────────────────────────────────┐
                         │  共享真源 miniprogram/{config,utils,services} │
                         └──────────────────────────────────────────┘
                                   │ scripts/sync-shared.js 单向同步
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
cloudfunctions/*/shared/    minigame/js/shared/       （小程序自身的 config/utils/services）
  仅供云函数使用             小游戏端使用的副本
        │                          │
        ▼                          ▼
   云端权威判定            minigame/js/{core,widgets,scenes}  ← 只有这层是新的
```

- **逻辑唯一真源**：玩法逻辑只写一遍，小游戏端与云函数拿的都是同步出来的副本
- **改完 `miniprogram/{config,utils,services}` 必须重跑 `node scripts/sync-shared.js`**，
  并**重新上传 `room` / `game` 云函数**，否则两端逻辑会漂移
- 小程序端 `miniprogram/` 保留：它是逻辑真源，也是可运行的参照实现（有 WXML 时更容易改 UI）

---

## 玩法规则

| 规则项 | 说明 |
|---|---|
| 棋盘 | 9 × 9，坐标「横X竖Y」，左上角为原点 |
| 飞机 | 每架 **10 格** = 机头 1 + 机翼 5 + 机身 1 + 机尾 3 |
| 数量 | 最少 1 架，最多 3 架 |
| 方向 | 支持 4 向旋转，飞机之间不可重叠、不可出界 |
| 回合 | **严格交替**：无论是否命中，开一炮就换手 |
| 判定 | 击中机头 = 整机立即击毁；击中其余部位 = 击中；空白 = 未击中 |
| 关键规则 | 飞机被击毁后**不揭示形状与朝向**，需玩家自行推理 |
| 胜负 | 先击毁对方全部飞机者获胜 |

---

## 目录结构

```
zfj/
├── minigame/                     # ★ 微信小游戏（当前主线，上架用）
│   ├── game.js                   #   入口：建 canvas、DPR 缩放、装触摸、驱动场景栈
│   ├── game.json                 #   小游戏配置（竖屏、网络超时）
│   └── js/
│       ├── core/                 #   自研「小游戏版 UI 框架」
│       │   ├── app.js            #     场景栈 + 主循环(rAF) + 触摸分发 + 全局浮层
│       │   ├── layout.js         #     以 750 设计稿为基准的等比换算 + 安全区
│       │   ├── geom.js           #     矩形命中 / zones 分发 / 棋盘格切分
│       │   ├── draw.js           #     圆角矩形 / 文字 / 省略号 / 背景等绘制原语
│       │   ├── theme.js          #     颜色与字号（与小程序 app.wxss 同源）
│       │   ├── dialog.js         #     wx.showModal 封装（小游戏没有表单控件）
│       │   └── share.js          #     转发（小游戏用 query 串，不是 path）
│       ├── widgets/              #   可复用绘制组件
│       │   ├── button.js         #     按钮（primary / outline / danger / ghost）
│       │   ├── board.js          #     9×9 棋盘（双棋盘共用，支持置灰 / 选中 / 命中态）
│       │   └── ui.js             #     卡片 / 标题 / 数据行 / 转圈 / 标签
│       ├── scenes/               #   5 个场景，逐个对应小程序 page
│       │   ├── base.js           #     Scene 基类（zone 注册 + tap 分发）
│       │   ├── lobby.js          #     大厅（含最近对手入口）
│       │   ├── room.js           #     创建 / 加入 / 匹配 / 等待 / 邀战分享
│       │   ├── deploy.js         #     布阵（点选放置 + 旋转 + 清空 + 随机）
│       │   ├── battle.js         #     对战（上下双棋盘 + 两步式出招 + 快捷表情）
│       │   └── result.js         #     结算（战报分享 / 邀请再战）
│       └── shared/               #   ← sync-shared.js 同步产出，勿手改
├── miniprogram/                  # 小程序版（逻辑真源 + 参照实现）
│   ├── app.js / app.json / app.wxss
│   ├── config/                   # 【数据驱动配置】新增内容不改核心代码
│   │   ├── rules.js              #   游戏规则常量
│   │   ├── planes.js             #   机型配置（形状 / 格数 / 机头下标）
│   │   ├── items.js              #   道具配置（V2 预留）
│   │   ├── social.js             #   社交配置（表情白名单 / 最近对手数量）
│   │   └── cloud.js              #   云环境 ID 与 USE_CLOUD 开关
│   ├── utils/                    # 纯函数逻辑层（可单测）
│   │   ├── board.js              #   棋盘与坐标工具
│   │   ├── plane.js              #   飞机形状 / 旋转 / 碰撞 / 随机布阵
│   │   └── judge.js              #   命中判定
│   ├── services/
│   │   ├── cloudApi.js           # ★ 对外统一数据接口（按 USE_CLOUD 分派）
│   │   ├── cloudImpl.js          #   云端实现：云函数调用 + 实时监听
│   │   ├── offlineGame.js        #   离线实现：本地对手 AI，签名与云端一致
│   │   ├── localGame.js          #   本地对局引擎（offlineGame 的内核）
│   │   └── rivals.js             #   最近对手本地存储
│   ├── components/
│   │   └── board-grid/           # 9×9 棋盘组件（双棋盘共用）
│   └── pages/
│       ├── index/ room/ deploy/ battle/ result/
├── cloudfunctions/               # 云函数（微信云开发，两套端共用）
│   ├── room/                     #   建房 / 加入 / 随机匹配 / 退出
│   ├── game/                     #   布阵校验 / 开火判定 / 投降 / 回合超时 / 快捷表情
│   │   └── shared/               #   由 scripts/sync-shared.js 同步的共用逻辑
│   └── cleanup/                  #   定时清理超时房间
├── docs/                         # 产品文档
│   ├── 炸飞机_PRD_v1.1.html
│   └── 云开发部署说明.md
├── scripts/
│   ├── test-core.js              # 核心玩法逻辑自测（纯函数）
│   ├── test-offline-flow.js      # 离线全流程集成测试（状态机）
│   ├── test-minigame.js          # 小游戏端测试（桩 canvas/wx + 真实触摸驱动）
│   └── sync-shared.js            # 同步共用逻辑到云函数与小游戏目录
└── project.config.json           # compileType: "game"，miniprogramRoot: minigame/
```

---

## 技术设计要点

### 1. 数据驱动（可扩展性的关键）

机型与道具均以**配置**描述，而非写死在逻辑里：

```js
// config/planes.js —— 新增机型只需追加一条记录
{
  id: 'standard',
  name: '标准机',
  cellCount: 10,
  headIndex: 0,          // 机头在 cells 中的下标
  cells: [ [0,2], [1,0], ... ]   // 相对坐标 [row, col]
}
```

- 摆放校验、命中判定、棋盘渲染全部复用同一套逻辑
- 新增机型 / 新增道具（如「超级导弹」）**无需改动核心代码**

### 2. 逻辑与界面分离

`utils/` 下全部为纯函数，不依赖任何宿主 API（小程序也好、小游戏也好），可用 Node 直接运行测试。

这是能从小程序平滑迁到小游戏的根本原因 —— **玩法的正确性从不由 UI 承担**。

### 3. 小游戏端为什么需要自研一层「UI 框架」

小游戏没有 WXML/WXSS，没有 `<view>`/`<button>`，只有一块 canvas。所以 `minigame/js/core/`
里补了一套最小可用的替代品，思路是把「页面开发习惯」重新做出来：

| 小程序里的东西 | 小游戏端的对应实现 |
|---|---|
| `App.globalData` | `app.globalData` |
| `wx.navigateTo` / `redirectTo` / `navigateBack` | `app.go` / `app.replace` / `app.back`（自己维护场景栈） |
| `Page({ data, setData })` | `Scene` 子类：属性直接赋值 + `layout()` 重算 zones |
| WXML 布局 | `layout()` 里算好每个区域的 `{x,y,w,h}`，元素各画各的 |
| `bindtap` | `this.zone(x, y, w, h, onTap)` 注册命中区，`app` 统一分发 |
| `wx.showModal` | `core/dialog.js` 封装（小游戏没有表单控件，用 `editable` 弹窗代替） |
| WXSS 里的颜色字号 | `core/theme.js`（与小程序 `app.wxss` 同源常量） |

触摸分发上做了两个小细节：**后注册的 zone 优先命中**（浮层盖住底层时天然正确），
以及**拖动超过 10px 就不算点击**（避免滑动误触发）。

### 4. 关键规则在代码中的落地

| 规则 | 落地位置 |
|---|---|
| 击毁不揭示形状（T-08） | `judge.js` 只返回命中结果，绝不下发飞机完整格位；**架构级保障**：飞机布阵存在权限为「所有用户不可读写」的 `games` 集合，客户端根本读不到 |
| 已攻击格不可重复选中（T-04） | 两端都在界面层根治：小程序是 `board-grid` 组件的 `disabledMap` 置灰，小游戏是 `widgets/board.js` 的 `selectable` + `disabled` 标记；服务端二次校验兜底 |
| 严格交替 | `localGame.js` 中 `fire()` 后立即换手，云端 `game.fire` 同步换手 |
| 布阵超时兜底（T-03） | `plane.js` 的 `randomDeploy()` |
| 表情内容安全 | `config/social.js` 白名单，客户端渲染与云端校验**同源**（`sync-shared.js` 保证） |
| 双棋盘不出屏 | 小游戏端 `scenes/battle.js` 按屏高动态分配上下两块棋盘尺寸，`test-minigame.js` 有断言 |

### 5. 一套接口，两种数据源

场景 / 页面只 `require('shared/services/cloudApi')`，拿到的方法在任何模式下都一样：

```
             ┌─ USE_CLOUD = true  → shared/services/cloudImpl.js    （云函数 + 云数据库 watch）
cloudApi.js ─┤
             └─ USE_CLOUD = false → shared/services/offlineGame.js （本地对手 AI + 本地事件广播）
```

好处：

- **云环境没配好也能把游戏完整玩一遍**，验证玩法与交互
- 切换数据源只改 `config/cloud.js` 一个开关，场景 / 页面代码零改动
- 离线引擎也是纯逻辑，可用 Node 跑全流程集成测试（见 `scripts/test-offline-flow.js`）
- 同一套接口也是小游戏端能复用小程序端全部数据层的原因

---

## 本地运行

### 方式一：离线试玩（当前默认，免配置）

`miniprogram/config/cloud.js`（小游戏端读的是同步出来的 `minigame/js/shared/config/cloud.js`）
里 `USE_CLOUD: false`，用**微信开发者工具**导入本目录即可：

```
创建房间 → 约 2.5 秒后「对手」自动加入 → 布阵 → 随机先手 → 轮流开火 → 结算
```

对手由 `services/offlineGame.js` 驱动的本地 AI 扮演（会优先追打已命中格的相邻格），
除对手是 AI 外，其余流程、界面与真实联机完全一致。

> ⚠️ **`project.config.json` 里的 `appid` 必须是本账号的小游戏 AppID**。
> 若填 `touristappid`（游客模式），工具无法判定账号类型，小游戏工程可能编译不起来。
> 反过来，如果把这个 **小游戏 AppID 填进小程序工程**，就会报
> 「`miniprogram/game.json` 未找到」——因为工具是按账号类型决定编译模式的。
> 改完 `appid` 后**需移除项目再重新导入**才生效。

### 方式二：接入云开发（真实双人对战）

1. 把 `miniprogram/config/cloud.js` 的 `USE_CLOUD` 改成 `true`，然后 **`node scripts/sync-shared.js`**
2. 开通云开发并创建环境，把环境 ID 填进 `miniprogram/config/cloud.js`（同样要重跑同步脚本）
3. 在云开发控制台创建 `rooms`、`games` 两个集合并设置权限（见部署文档）
4. 上传 `cloudfunctions/` 下的 `room`、`game`、`cleanup` 三个云函数
5. 编译后即可与另一台设备真实对战

> 完整步骤见 **[docs/云开发部署说明.md](docs/云开发部署说明.md)**

### 运行自测

```bash
node scripts/test-core.js          # 22 项：形状 / 旋转 / 碰撞 / 判定 / 胜负 / 随机布阵
node scripts/test-offline-flow.js  # 45 项：建房 → 布阵 → 开局 → 开火 → 结算 全链路
node scripts/test-minigame.js      # 58 项：小游戏端渲染 + 触摸分发（桩 canvas/wx 跑真流程）
node scripts/sync-shared.js        # 改完 miniprogram/{config,utils,services} 后必须重跑
```

`test-minigame.js` 值得单独说一句：小游戏没有 DOM、没有 WXML，通常被认为「没法自动化测」。
但它整个界面层就是「纯计算 + Canvas 调用」，所以只要：

- 用桩 `canvas.getContext('2d')` 顶掉绘制（记录调用序列，可断言「这一帧到底画了什么」）
- 用桩 `wx` 顶掉原生能力（存储 / 弹窗 / 转发 / 触摸注册）
- 再调 `app.touchStart(x,y)` + `app.touchEnd(x,y)` 走**真实触摸分发**

就能从大厅一路点到结算，顺带断言 T-08（敌方棋盘不出现 `plane` 格）、双棋盘不出屏、
已炸格置灰不可再选等关键规则。

---

## 发布流程（正式上架）

本项目目标是**正式上架发布**，小游戏的标准链路：

| 步骤 | 操作 | 说明 |
|---|---|---|
| 1 | 补齐资质 | 小游戏需**游戏类目**资质（软著 / 版号视类目与变现方式而定）；未齐时只能做体验版 |
| 2 | 云环境转正式 | 云开发环境确认已付费/正式，`cloud.js` 填正式环境 ID，重跑 `sync-shared.js`，重传三个云函数 |
| 3 | 上传代码 | 开发者工具「上传」→ 填版本号与描述，成为**开发版** |
| 4 | 设为体验版 | 后台版本管理 → 选开发版设为体验版，加体验成员真机验收 |
| 5 | 提交审核 | 后台提交审核（填功能页面 / 测试账号 / 玩法说明；双人游戏建议备好两个账号给审核员） |
| 6 | 发布 | 审核通过后点「发布」，全量上线；之后每次改动走同样链路 |

上架前自检清单（本项目相关）：

- [ ] `USE_CLOUD: true` 且云环境 ID 为正式环境
- [ ] 云函数 `room` / `game` / `cleanup` 均为最新（跑过 `sync-shared.js` 后重传）
- [ ] `rooms` 集合权限=所有用户可读、仅创建者可写；`games` 集合权限=**所有用户不可读写**
- [ ] `cleanup` 定时触发器已开启（清理超时房间与过期对局）
- [ ] 转发路径在真机上验证：好友点开邀战卡片能直达加入页并回填房间号
- [ ] 真机验证断线重连（60 秒保留）、回合超时（30 秒）、投降二次确认
- [ ] 分包 / 包体积检查（小游戏首包上限 4MB）

---

## 社交功能（本期已做）

| 功能 | 说明 | 落地位置 |
|---|---|---|
| 分享邀战卡片 | 房间等待页「邀请好友加入」→ 好友点开直达加入页并回填房间号 / 密码 | `scenes/room` |
| 最近对手一键再邀 | 对局结束自动记下对手（本地存最近 5 位），大厅 / 结算页可「再邀一局」，转发文案带上对方名字 | `shared/services/rivals.js` |
| 局内快捷表情 | 6 个白名单表情，实时气泡展示（自己右侧、对方左侧），自动消失 | `scenes/battle` + `cloudfunctions/game` |
| 分享战报 | 结算页按胜负生成不同文案的转发卡片 | `scenes/result` |

> 本期**不做**观战与弹幕（按需求方确认）。

---

## 当前进度

- [x] 核心玩法逻辑（含单元测试 22 项）
- [x] 数据驱动的机型 / 道具配置
- [x] 本地单机对局闭环（用于验证）
- [x] **云端联机**：房间服务 + 实时对战同步（微信云开发）
- [x] 服务端布阵校验与命中判定（防作弊 / T-08 保障）
- [x] 回合超时、投降、断线兜底
- [x] **统一数据接口层**：一套 API 分派云端 / 离线两种实现
- [x] **离线引擎**：无云环境也能跑通完整对局（含 45 项集成测试）
- [x] **社交**：分享邀战卡片、最近对手一键再邀、局内快捷表情、分享战报
- [x] 小程序版工程（`miniprogram/`）—— 逻辑真源 + 参照实现
- [x] **小游戏 Canvas 版工程**（`minigame/`）—— 5 场景 + 自研 UI 框架 + 58 项端到端测试
- [ ] 体验版真机验收（需云环境就绪）
- [ ] 上架资质与审核材料
- [ ] V2：积分等级体系、多机型、道具系统
- [ ] V3：观战、弹幕

详见 [docs/炸飞机_PRD_v1.1.html](docs/炸飞机_PRD_v1.1.html)

---

## 后端方案

**已采用微信云开发**：云函数 + 云数据库实时监听（`watch`），无需自建服务器、无需配置服务器域名。

架构分层：

| 层 | 位置 | 职责 |
|---|---|---|
| 客户端 | `minigame/` | 只做渲染与交互，**不做任何判定** |
| 云函数 | `cloudfunctions/room` | 房间生命周期管理 |
| 云函数 | `cloudfunctions/game` | 布阵校验、开火判定、胜负结算 |
| 公开数据 | `rooms` 集合 | 战况视图，客户端可读、可实时监听 |
| 私密数据 | `games` 集合 | 双方飞机布阵，**仅云函数可访问** |

> 为什么判定必须放服务端：否则客户端可以直接查库看到对方飞机位置，T-08 就形同虚设。
> 详见 [docs/云开发部署说明.md](docs/云开发部署说明.md) 第六节。
