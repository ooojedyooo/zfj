# 炸飞机 · 社交技术可行性报告（关系链 / 约局 / 聊天 / 邀请）

> 任务：T21 社交技术可行性与平台边界（只读研究）
> 角色：engineering-lead（程基岩）
> 范围：**只读研究，不改任何游戏代码、不提交 git**；本报告是给主理人与用户拍板的决策依据。
> 证据基准：微信开放文档 developers.weixin.qq.com（正文引用具体页面）+ 本项目当前代码逐行核对。
> 记录日期：2026-11-24　git HEAD：`e80ab39c40ab514ea0d338cb39e2d568e54292c3`　分支：`main`

---

## 0. 执行摘要（先读这一页）

**一句话结论**：约好友开局、聊天、房间邀请**技术上都能落地**，唯一要砍掉的是用户字面期待的「通讯录式好友列表 + 指定某人push邀请」——微信小游戏**不向主域开放好友列表**，好友关系数据只能在独立的「开放数据域」里读取并绘制成排行榜，主域无法拿到好友 openid 去点名邀请。取而代之的可达形态是：**同玩好友排行榜（开放域）+ 最近对手「再邀一局」（本地）+ 分享卡片房间号邀请（任意好友/群）**。

给主理人的四条拍板点（详见 §10；另策划 6 条核实项的结论见 §9）：

1. **好友列表口径**：用户要的「好友列表」缩水为「同玩好友排行榜 + 最近对手」，是否接受？这是平台硬边界，非实现取舍。
2. **聊天形态**：推荐先上「快捷表情/短语」（复用现成 `game.emote`，零审核风险）；自由文字聊天（云数据库 + watch + `msgSecCheck`）作为二期，是否同意分期？
3. **云端开关**：一切真实约局的前提是 `USE_CLOUD=true` + 配 `ENV_ID` + 上传 3 个云函数；这是运营动作（主理人/用户执行），不是代码动作。
4. **开放数据域**：好友排行榜需要新增 `openDataContext` 目录 + 改 `game.json`；且本项目 `libVersion 3.5.5` 低于 ScreenCanvas 所需的 3.6.6，只能用旧的 OffscreenCanvas 贴屏方案（详见 §1.5 知识缺口）。是否本阶段就做，还是先只做「最近对手」延期排行榜？

**审核红线一句话**：任何用户自由输入的文字（房间名、聊天、昵称）都必须过云调用 `security.msgSecCheck`，否则审核必被拒；分享不能「分享后得奖励」，隐私指引必须如实声明「微信好友关系 + 昵称头像」处理。

---

## 1. 微信小游戏关系链能力真实边界（本任务地基）

### 1.1 开放数据域（`wx.getOpenDataContext()` / 独立 canvas）

来源：官方《开放数据域》《关系链数据》《Open Data Domain》文档
（https://developers.weixin.qq.com/community/develop/doc/00042a6a278e688b69381ffce5b409 、
https://developers.weixin.qq.com/minigame/dev/guide/open-ability/open-data 、
https://developers.weixin.qq.com/minigame/en/dev/guide/open-ability/opendata/basic.html）

- **是什么**：一个封闭、独立的 JS 作用域（在 `game.json` 配 `openDataContext: "目录"` 开启，目录内放 `index.js` 入口）。它与主域**无共享变量、不能互相 `require`**。
- **能做什么**：
  - 在域内调用关系链 API（`wx.getFriendCloudStorage` / `wx.getGroupCloudStorage` / `wx.getPotentialFriendList`）拿到好友的 openid、昵称、头像、托管数据；
  - 用 2D 绘图 API 把这些数据**绘制到 `sharedCanvas`**（离屏画布）；
  - 主域通过 `openDataContext.canvas` 拿到 `sharedCanvas`，用 `ctx.drawImage()` 贴到上屏 canvas。
- **不能做什么（关键）**：
  - **只能主域 → 开放域单向通信**：`openDataContext.postMessage()` 下发，`wx.onMessage()` 监听；**开放域无法向主域回传任何数据**（官方原文：open data domain cannot send messages to the main domain）。
  - 开放域**不能调用网络、存储、文件 API**——所以它无法把好友数据发给你的服务器。
  - 主域只能拿到「画好的像素」，**永远拿不到好友的 openid / 昵称 / 托管数据本身**。
- **本项目含义**：好友关系数据**不可能**进入主域的房间/邀请逻辑。任何「在主域里列出好友并给他发邀请」的设计都跑不通。

### 1.2 `wx.getFriendCloudStorage` / `wx.setUserCloudStorage`（托管数据 / 同玩好友）

来源：官方《关系链数据》、
https://developers.weixin.qq.com/minigame/dev/api/open-api/data/wx.getFriendCloudStorage 、
https://developers.weixin.qq.com/minigame/dev/api/open-api/data/wx.setUserCloudStorage

- `wx.setUserCloudStorage()`：**主域和开放域都可调用**，把当前玩家的 KV 数据（分数/战绩/段位等）托管到微信后台。限制：每 openid 每游戏 ≤128 个 KV 对，单项 key+value ≤1KB，key ≤128 字节。
- `wx.getFriendCloudStorage({keyList})`：**只能在开放数据域调用**，返回**当前用户「也玩该小游戏」的好友**的托管数据（含 openid/昵称/头像/data）。
  - **不是通讯录好友**：只有「也玩这个游戏 + 托管过数据」的好友才会出现。未玩过、未托管的好友一律拿不到。
  - 需要用户授权 `scope.WxFriendInteraction`。
  - 官方明确：**新加微信好友后 2 小时内可能拉不到该好友数据**。
- `wx.getGroupCloudStorage({shareTicket|groupid, keyList})`：从**群分享卡片**进入时可拿群内同玩成员数据；只在开放域可用，需要授权（来源：https://developers.weixin.qq.com/minigame/dev/api/open-api/data/wx.getGroupCloudStorage）。
- `wx.getPotentialFriendList()`：拿到「可能对游戏感兴趣的**未注册**好友名单」，每次最多 5 个，只在开放域可用，需要授权（来源：https://developers.weixin.qq.com/minigame/dev/api/open-api/data/wx.getPotentialFriendList.html）。这是**微信侧数据**，只是名单，主域仍拿不到可用于点名邀请的 openid。

### 1.3 `withShareTicket` / shareTicket 能拿到什么、在哪解

来源：官方《转发》、
https://developers.weixin.qq.com/minigame/dev/guide/open-ability/share/share.html 、
https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/share

- 通过 `wx.updateShareMenu({withShareTicket:true})`（小游戏侧；本项目用的是 `showShareMenu`）开启后：**只有转发到「群聊」**，从该卡片进入时 `wx.getEnterOptionsSync()` / `wx.onShow` 才返回 `shareTicket`；**单聊没有 shareTicket**。
- `shareTicket` 换取的信息：在小程序侧用 `wx.getShareInfo(shareTicket)` 解出 `openGId`（群唯一标识）；在小游戏侧，做法是**把 shareTicket 从主域 postMessage 给开放域，开放域调 `wx.getGroupCloudStorage`** 拿「该群同玩成员数据/群名」做群排行榜。
- **它不是好友身份凭证**：shareTicket 是群维度、且每次从卡片进入都不同；单聊场景完全没有。因此**不能用来做「指定某个好友」的邀请或身份识别**。
- 另一个平台事实（官方《分享功能调整》公告）：自基础库 2.3.0 起，`wx.shareAppMessage` 的 `success/fail/complete` 回调被回收——**开发者无法知道用户是否真的分享成功**，也拿不到分享后的 shareTicket。所以「分享成功 → 给奖励/解锁」这类设计既做不到也违规（见 §6）。

### 1.4 结论：小游戏到底能不能拿到「好友列表」？

**能，但不是用户想象的那个形态。** 分三档说清：

| 形态 | 能否拿到 | 在哪拿 | 主域能否读到 openid | 对应本项目 |
|---|---|---|---|---|
| 通讯录好友全量列表 | ❌ 不能 | 平台不提供 | — | 无解，别设计 |
| 同玩好友（也玩本游戏、托管过数据） | ✅ 能 | 开放域 `getFriendCloudStorage` | ❌ 不能 | 可做「好友排行榜」，见 §5.2 |
| 群内同玩成员 | ✅ 能 | 开放域 `getGroupCloudStorage`（需群分享进入） | ❌ 不能 | 可做「群排行榜」，二期 |
| 可能对游戏感兴趣的未注册好友（≤5） | ✅ 能 | 开放域 `getPotentialFriendList` | ❌ 不能 | 基本无实用价值 |
| 最近对战过的对手（含 openid） | ✅ 能 | **主域本地存储** | ✅ 能 | 现有 `rivals.js`，见 §5.1 |

**对用户需求「可以在点开好友列表、给他发游戏请求」的判定**：
- 「好友列表」→ 只能做成**开放域排行榜**（看得到同玩好友是谁、分数多少），或**本地最近对手列表**（能拿到 openid）。
- 「指定某人发请求」→ 平台**没有**「主域列出好友 → 选中 → 拿到其 openid → 推送邀请」的链路。可行的等价物是：**生成带房间号的分享卡片 → 用户自己转发给某个好友/群 → 谁点开谁进房**。这是「广播式邀请」，不是「点名式邀请」。需要向用户如实说明。

### 1.5 知识缺口 / 需真机验证（不臆造）

- 本项目 `libVersion 3.5.5`；开放域 **ScreenCanvas 模式需基础库 3.6.6+**（官方 Unity 开放域文档）。因此本项目只能用**旧 OffscreenCanvas**：开放域画到离屏 `sharedCanvas`，主域 rAF 每帧 `drawImage` 贴屏。好处是本项目本来就是 rAF 常驻重绘，贴屏循环天然契合；风险是触摸命中必须走主域自绘 zone（开放域无法回传点击事件）。**需在真机验证 3.5.5 下 sharedCanvas 贴屏与触摸的正确性**。
- `openDataContext` 一旦配置会「对游戏产生某些限制」（官方文档语），具体限制未在文档列全；本项目开启前需在真机完整跑一遍主流程回归。
- 上表 API 的授权态、新好友 2 小时延迟、`getPotentialFriendList` 的实际返回质量，均需真机/体验版验证。

---

## 2. 约好友开局的实现路径（分享卡片带房间号 → 好友点开进房）

### 2.1 现状核对（发现与 team-lead 描述不符，如实报告）

team-lead 的表述是「battle/lobby/result 都已 onShare，但 query 没带房间号」。逐行核对后，**实际情况比这更好，也比这更差一点**：

- ✅ **接收侧已完整实现**：`game.js:135-138`（`onShow` 读 `res.query.roomNo` → `setLaunchQuery` → `app.go('room',{mode:'join'})`）、`game.js:143-145`（冷启动同样处理）、`room.js:77-87`（从 `share.launchQuery()` 回填 `roomNo`/`pwd`）、`room.js:554-576`（`onJoin` 调 `api.joinRoom`）。
- ✅ **主动分享已带房间号**：`room.js:693-704` 的 `shareInfo()` 已经把 `roomNo`（密码房还带 `pwd`）用 `share.toQuery()` 拼进 query；`room.js:706-708` 的 `onInvite()` 用 `share.share()` 发出去。**即「房间号邀请」这条链的代码骨架已经存在**，不是从零写。
- ❌ **但有三个真实缺口**：
  1. `game.js:109-111`（全局被动 `onShare`）、`lobby.js:75-78`、`battle.js:114-117`、`result.js:50-53` 的 query 全是 `''`——**被动分享（右上角转发）不带房间号**；房间场景 `room.js` 本身没有注册 `share.onShare`，所以在房间里点右上角转发走的还是全局那条空 query。
  2. `room.js:99-103` 的自动动作分支只处理 `random → onMatch()`，其余 `→ onCreate()`；而 `game.js:137/145` 进房时**没有传 `auto:true`**。所以好友点开卡片后只是「房间号被预填进加入框」，**并不会自动加入**，仍需玩家点一次「加入」按钮。若简单加 `auto:true`，现有分支会误调 `onCreate()`（把 mode='join' 当成建房）——**必须新增 `else if (mode==='join') onJoin()` 分支**，这是个容易踩的坑。
  3. `pwd` 以明文进 query（`room.js:695`）：密码房邀请时密码随卡片下发。这是「邀请凭据」的既定设计，但需在报告里点明——拿到卡片 query 的人即拿到密码，仅适合发给可信好友，不适合公开群发。

### 2.2 query 字段设计（建议，保持向后兼容）

```
roomNo=123456&pwd=1234&invite=1&from=<openid尾4或空>&t=<timestamp>
```

- `roomNo`（必填，6 位）：`room.js` 已用此字段，不改。
- `pwd`（密码房才有）：沿用现有字段，不改。
- `invite=1`（新增，可选）：标识这是一张「邀请卡」，用于埋点统计邀请转化率、区分「随手转发」与「定向邀请」。
- `from` / `t`（新增，可选）：邀请人展示与时效判断（超过 N 小时提示房间可能已过期）。**不要放明文 openid 做身份凭证**——query 是公开的，仅可作展示。

### 2.3 热启动 / 冷启动接法

- 冷启动：`share.js:8-15` 在模块加载时读 `wx.getLaunchOptionsSync().query` → `launchQuery()`；`game.js:143-145` 已按 `roomNo` 跳房。**已具备**。
- 热启动（游戏已在后台，好友点卡片）：`wx.onShow(res)` → `share.setLaunchQuery(res.query)` → `app.go('room',{mode:'join'})`。**已具备**，但需按 §2.1-② 补自动加入分支，并注意 `onShow` 在普通切前台时 `res.query` 可能为空——`setLaunchQuery` 目前会**覆盖**成空 query（`share.js:23-25`），建议在切前台且 `res.query` 为空时不清空，避免把尚在展示的房间号冲掉（这是一个已存在的边界 bug，社交上线后会被放大）。
- **注意**：小游戏没有页面路由 path，`query` 是全局的。所有场景共享同一份 `LAUNCH.query`，需要在使用后按需清理，防止陈旧 `roomNo` 在后续流程误触发。

### 2.4 `getRoom` / `joinRoom` 怎么调

- 进房后统一走 `api.joinRoom({roomNo, password})`（`cloudApi.js:37` → `cloudImpl.js:68` → 云函数 `room.join`）。
- 云函数 `room.join`（`cloudfunctions/room/index.js:148-180`）已实现：幂等（已在房内直接返回）、校验 `status==='waiting'`（否则 `STARTED`）、校验 `players.length<2`（否则 `FULL`）、校验密码（`WRONG_PASSWORD`）。**房间满/已开局的处理天然内建**，客户端只需把 `e.code` 映射成友好文案（见 §4.2）。
- `getRoom`（`room.js` 云函数 `:245-249`）是按 `roomId` 查，分享卡只有 `roomNo`，所以**不要**用 getRoom 预检；直接 `joinRoom`，让服务端做原子判定。若要在点卡片前显示「房间还在吗」，可新增 `room.getByNo` action（需扩云函数，见 §7）。

### 2.5 与现有 random match 池子共存

- `room.match`（`cloudfunctions/room/index.js:195-231`）：优先撮合同架数的公开等待房，否则自己开公开房。**邀约房（私密/指定好友）与匹配池物理隔离**——只要邀约房设了密码（`hasPassword=true` → `isPublic=false`），就不会被 `match` 池捞到（`match` 只查 `isPublic:true`）。
- 若邀约房不设密码则是公开房，**会被随机匹配的人占用第二个席位**——这是产品决策点：建议「分享邀请房」默认带一个 4 位随机密码（复用 `room.js:28` 已生成的 `this.password`），既防陌生人混入，又让收到卡片的人免输入（`pwd` 已在 query 里）。这样邀约房与 match 池零冲突。

---

## 3. 聊天的可行路径对比（至少三条，给推荐）

### 3.1 三/四条路径对比表

| 方案 | 实现成本 | 延迟 | 费用 | 内容安全 | 能否满足「简单聊天」 | 推荐度 |
|---|---|---|---|---|---|---|
| **A. 复用 `game.emote` 快捷表情/短语** | **极低**（云函数已有，仅需扩白名单 + 客户端按钮） | 实时（写入 `battle.emote`，双方 `watchRoom` 收到） | 几乎为零（沿用现有 watch） | **白名单固定文案，不属于 UGC，无需 msgSecCheck** | 表情 + 固定短语（如「准备好了」「漂亮」「再来一局」）基本够 | ⭐⭐⭐⭐⭐ **一期推荐** |
| B. 云数据库存消息 + watch | 中高（需新集合 `messages` + 云函数扩 `chat` action + 客户端输入面板/消息列表/未读） | 亚秒级（watch 推送） | 中：每次发消息 1 次云函数调用 + 1 次写；每个在线成员 1 条 watch 长连接（按连接时长/次数计费）+ 消息存储 | **必须**每条文本过 `security.msgSecCheck` 云调用；否则审核红线 | 完整自由聊天 | ⭐⭐⭐ 二期 |
| C. 微信订阅消息 / 服务通知 | 中（模板配置 + 云调用 `subscribeMessage.send` + 用户授权引导） | 异步、离线可达 | 低（订阅消息本身按条计费） | 模板内容平台审核，用户不可自由输入 → 不涉及 msgSecCheck | **只能做离线邀请/召回，不是聊天**（一问一答做不到） | ⭐⭐⭐ 仅用于离线邀请 |
| D. 第三方 IM（腾讯云 TIM / TRTC） | 高（引入 SDK、账号打通、合规配置） | 实时 | 高 | SDK 通常自带审核，但接入复杂 | 完整 | ⭐ 不推荐（小游戏体量不值） |

### 3.2 推荐路径：分期

**一期（推荐立即做）**：方案 A。
- `cloudfunctions/game/index.js:318-336` 的 `emote()` 已经实现「白名单 + 递增 seq + 写入 `battle.emote` + 双方 watch 实时收到」，且白名单来自 `config/social.js` 的 `EMOTE_LIST`（客户端与云端同源）。
- 扩展方式：在 `EMOTES` 里增加「短语」（如 `label:'准备好了'`、`emoji:'👌'` 或专门的 phrase 类型），云函数用同一份白名单校验。**因为发送内容完全来自服务端下发的固定列表，用户不能自由输入文字，不构成 UGC，不触发 msgSecCheck 义务**。
- 局限：只能在**对局中**发（`emote` 要求 `room.battle` 存在且未结束）；大厅/房间等待期的「聊天」需要另外路径（可复用同样的「快捷短语」机制，写到 `room` 上而非 `battle`，需在云函数加一个轻量 action——见 §7）。

**二期（用户强烈要求自由输入时）**：方案 B。要点：
- 新增 `messages` 集合；每条消息字段 `{roomId, fromOpenid, text, safe, ts, seq}`；`safe` 为内容安全结果，未通过不入库。
- 云函数 `chat.send`：先 `security.msgSecCheck`，再写库；`watch` 用 roomId 过滤。
- 客户端要有：输入框（Canvas 自绘 + `wx.showKeyboard` / `onKeyboardInput`，符合「不建原生覆盖按钮」铁律）、消息气泡、敏感词拦截提示、举报入口（审核加分项）。
- 成本与性能预算：单房 2 人，消息量低（建议限流 1 条/秒、单条 ≤200 字），watch 连接数 = 在线人数；费用可控，但**每个 UI 都要测 watch 断开重连**。

### 3.3 内容安全 `msgSecCheck`（审核红线，必须查准）

来源：官方《文本内容安全识别》
https://developers.weixin.qq.com/miniprogram/dev/server/API/sec-center/sec-check/api_msgseccheck.html

- **接口只能在服务器端调用，不可在前端直接调用**。云开发用**云调用**：`cloud.openapi.security.msgSecCheck({content, version:2, scene})`。
- 参数：`content`（UTF-8，≤2500 字）、`version`（固定 `2`）、`scene`（场景枚举：1 资料、2 评论、3 论坛、4 社交日志等，按实际选）。
- 判定：返回 `errCode === 87014` 即违规内容，必须拦截、提示用户重输，**不得入库/展示**。
- **强制性与后果**：官方社区多处明确「有用户输入文字就必须用文本安全检测，否则审核不通过」「微信检查到未使用安全审核机制会警告要求使用，否则封禁搜索功能」。对**用户个人资料违规文字、用户发表的评论、游戏内用户上传的素材**都是明确适用场景。
- **本项目的直接风险点**：
  - 房间名 `roomName`（`room.js` 用户输入，`room.create` 用 `normalizeRoomName` 规范化后入库并展示在公开列表 `rooms.js:216`）——**这是 UGC 文本，严格意义上应过 msgSecCheck**。当前云函数 `create` **没有做**。这是社交上线前必须补的红线项。
  - 昵称 `profile.setNickname`（`profile.js:38-42`，用户输入）同样应过检。
  - 二期自由聊天文本：每条必过。
- **规避**：一期用白名单表情/短语（无自由输入）可显著降低风险；但仍建议把「房间名 + 昵称」的 msgSecCheck 作为开云端同批补齐，否则公开房间列表就是未审核 UGC。
- **图片**：本方案不涉及用户上传图片，无需 `imgSecCheck`；若未来加头像自定义/截图分享图 UGC，需补 `imgSecCheck`。

---

## 4. 房间游戏请求（给好友发邀请）

### 4.1 通过分享卡片落地

- 入口：房间场景的「邀请好友」按钮（`room.js:706 onInvite`）→ `share.share(shareInfo())`，卡片标题已含房间号，query 带 `roomNo[/pwd]`（§2.2）。这是**唯一合规的邀请下发方式**（用户自发转发）。
- 好友点开 → 冷/热启动按 §2.3 进房 → `joinRoom`（§2.4）。
- 被动分享补齐：给 room 场景注册 `share.onShare(this.shareInfo.bind(this))`，让用户从房间页点右上角「转发」也带房间号；`game.js`/`lobby`/`battle`/`result` 的全局分享视产品需要决定是否带「我在房间 XXXX」——注意 battle 中房间已开局，带房间号没有意义（好友进来会拿到 `STARTED`），更适合带「观战/再来一局」文案。

### 4.2 好友点开时房间满了 / 已开局怎么处理

云函数 `room.join` 已返回明确错误码（`cloudfunctions/room/index.js:164-171`）：

| 服务端 code | 含义 | 客户端建议文案与动作 |
|---|---|---|
| `FULL` | 房间已满（2 人） | 「房间已经满人啦」→ 提供「随机匹配一局 / 自己开一间房」按钮（复用 `app.go('rooms')` / `onCreate`） |
| `STARTED` | 已开局 | 「这局已经开始啦」→ 同上引导；二期可做「观战」 |
| `NOT_FOUND` | 房间不存在（过期/已解散） | 「房间已过期」→ 引导回大厅 |
| `WRONG_PASSWORD` | 密码错误（一般是 pwd 未随卡片带全） | 「请输入房间密码」→ 弹出密码输入 |
| `BAD_ROOM_NO` | 房间号格式错误 | 提示检查卡片 |

客户端需把 `e.code`（`cloudImpl.js:28-30` 已把 code 挂到 Error 上）映射成上述文案，当前 `room.js:570-575` 只弹 `e.message`，体验较生硬，建议补一张 code→文案表（纯客户端映射，不动云函数）。

### 4.3 能不能「指定邀请某人」——如实说

**不能点名。** 理由链：
1. 主域拿不到好友 openid（§1.1）→ 无法在主域维护「可选好友列表 + 目标 openid」。
2. shareTicket 只有群维度、单聊没有（§1.3）→ 无法用它识别「分享给了谁」。
3. `wx.shareAppMessage` 的分享成功回调已被平台回收（§1.3）→ 连「是否分享给了某人」都无从得知。

**可达的近似**：
- 「指定一个群」：用 `groupid`/群分享卡进入，可做**群内排行榜**（开放域），但依旧不能点名邀请。
- 「指定知道房间号的人」：私密房 + 随机密码（§2.5）——只有拿到卡片的人能进，实质是「凭据式邀请」，最接近用户需求且完全合规。
- 「邀请记录」：本地存「我发过邀请的房间号/时间/对手」（`rivals.js` 可扩展），给「再邀一次」用；记录的是房间不是好友身份。

---

## 5. 好友列表的替代形态（拿不到通讯录前提下）

| 形态 | 能展示什么 | 需要什么权限 / API | 主域能否拿到 openid | 本期可行 |
|---|---|---|---|---|
| **5.1 最近对手升级**（推荐一期） | 最近 5 位对手的昵称/尾号、胜负、时间；「再邀一局」 | 无新权限；现有 `rivals.js` + `config/social.js MAX_RECENT_RIVALS=5`；开云端后对手 openid 来自房间 players | ✅ 能 | ✅ 现在就能做，改动最小 |
| **5.2 同玩好友排行榜**（开放域） | 也玩本游戏且托管过数据的好友的昵称/头像/分数；「下一个超越的好友」 | `openDataContext` 目录 + `game.json` 配置；`wx.setUserCloudStorage` 上报分数；开放域 `getFriendCloudStorage`；授权 `scope.WxFriendInteraction`；隐私指引声明「微信好友关系」 | ❌ 不能（只能绘制像素） | ⚠️ 需新增开放域目录 + 真机验证（§1.5） |
| **5.3 群同玩成员排行榜** | 某群内同玩成员的排名 | 群分享卡进入 + shareTicket/groupid；开放域 `getGroupCloudStorage`；`withShareTicket:true` | ❌ 不能 | 二期 |
| **5.4 邀请记录 / 收藏的房间** | 我发起过的邀请、我常一起玩的人（按房间/昵称维度） | 本地存储或云端按 openid 存；无新平台权限 | ✅ 本地记录维度 | ✅ 一期可做 |
| **5.5 潜在好友**（未注册） | 至多 5 个「可能对游戏感兴趣」的好友名单 | 开放域 `getPotentialFriendList`；授权 | ❌ 不能 | ❌ 实用性低，不建议做 |

**组合建议**：一期做 5.1 + 5.4（「最近对手 / 再邀一局」），二期视真机验证结果补 5.2 排行榜。向用户解释：「微信不允许小游戏读取你的好友名单，所以我们把'好友列表'做成了'最近一起玩的人 + 好友排行榜 + 分享邀请'三件套」。

---

## 6. 审核红线与隐私合规

| 风险点 | 涉及本方案功能 | 后果 | 规避措施 |
|---|---|---|---|
| **UGC 文字未过内容安全** | 房间名（已入库并公开展示）、昵称、二期聊天文本 | 审核拒；线上被查到会警告，否则封禁搜索功能；违规内容致封号 | 云调用 `security.msgSecCheck`（§3.3）；一期用白名单表情/短语规避自由输入；房间名/昵称开云端同批补检 |
| **诱导分享** | 「邀请好友」「再邀一局」按钮 | 平台明令禁止：分享后给奖励、分享解锁功能、红点暗示、标题党 | 邀请是**纯功能性分享**（分享房间号让好友来玩），无奖励、无解锁；文案真实；**不要**加「分享得金币/道具」「分享3次解锁」 |
| **分享成功回调已回收** | 任何「判断是否分享成功」的逻辑 | 2.3.0+ 无法拿到 `success` 回调，功能直接失效且属违规设计 | 不依赖分享回调做状态变更；分享后保留原按钮并提示「一个房间只能进两人」即可 |
| **隐私指引缺失/不实** | 关系链（好友关系）、昵称头像、在线状态 | 2021-11-01 起提审必须材料；声明与实际调用不符会导致**相关接口被禁调用**，直接影响线上运营 | MP 后台「设置→服务内容声明→用户隐私保护指引」如实声明：**微信好友关系**（`getFriendCloudStorage` 等）、**昵称头像**（`getUserInfo` 等）；配置隐私授权弹窗并上报授权结果；用户撤权后删除对应数据 |
| **用户信息授权** | `wx.getUserInfo` 自 2.27.1 返回匿名数据 | 拿不到真实昵称 | 项目已用「手填昵称 → 能拿到就用 → 兜底名」策略（`profile.js`），符合预期；勿用原生 `createUserInfoButton` 覆盖画布（违反铁律） |
| **点击行为限制** | 订阅消息 `wx.requestSubscribeMessage` | 非点击回调调用会失败（`can only be invoked by user TAP gesture`） | 必须在 `wx.onTouchEnd` / `showModal` / `showActionSheet` 回调中调用——本项目 Canvas 自绘 zone 的触摸链天然满足（§3.2/C） |
| **订阅消息特性** | 离线邀请 | 「从服务通知进入时 query 不能携带数据」（官方 Q&A：暂不支持）；除「游戏更新提醒」外均为一次性订阅 | 订阅消息**只做召回/提醒**，不做「点卡片带房间号直接进房」；进房仍靠分享卡 query |
| **逃避审核的 UGC 形态** | 自定义房间名做导流/广告 | 平台打击 | 房间名白名单字符 + msgSecCheck + 举报入口 |

---

## 7. 对现有代码的影响面（分层）

### 7.1 开云端就有（几乎零新代码，但有前置运营动作）

前置：`config/cloud.js` 的 `USE_CLOUD: true` + `ENV_ID` 填值；微信开发者工具上传 `cloudfunctions/{room,game,cleanup}` 三个云函数；按 `docs/云开发部署说明.md` 建 `rooms`/`games` 集合与权限。

| 能力 | 现状 |
|---|---|
| 建房 / 按房间号加入 / 随机匹配 / 列表 / 搜索 / 查询 / 离开 | `cloudApi.js` + `cloudImpl.js` + `room` 云函数已全实现 |
| 对局部署 / 开火 / 表情 / 投降 / tick / sync | `game` 云函数已实现 |
| 房间实时监听 | `watchRoom`（`cloudImpl.js:48-60`）已实现 |
| **分享卡片带房间号**（主动） | `room.js:693-708` 已实现 |
| **冷/热启动按 roomNo 进房**（接收） | `game.js:135-145` + `room.js:77-87` 已实现 |
| 满房/已开局/密码错误等错误码 | `room.join` 已返回 code |

→ **「约好友开局」的骨架其实已经写好，缺的是运营开关 + 三处小修补**（§2.1 的被动分享 query、自动加入分支、onShow 清空 query 的边界 bug）。

### 7.2 要新开发（本期/二期）

| 能力 | 改动点 | 工作量 |
|---|---|---|
| 被动分享带房间号 + 自动加入 + 错误码文案 | `room.js`（注册 `onShare`、加 `mode==='join'` 自动加入分支、code→文案表）、`game.js`（onShow 不清空 query）、`share.js`（可选 invite/from/t 字段） | 小（1 天内） |
| 快捷短语（聊天一期） | `config/social.js` 扩 `EMOTES`；`battle.js` 表情栏 UI 增短语；等待期短语需在 `game` 云函数加写 `room` 的轻量 action（**扩云函数，需主理人裁决**） | 小~中 |
| 最近对手 / 邀请记录升级 | `rivals.js` 扩字段与「再邀」入口；`result.js`/`lobby.js` UI | 小 |
| 房间名/昵称 msgSecCheck | `room`、`game`(或新 `profile`) 云函数加 `security.msgSecCheck` 云调用；需在 MP 后台开通云调用权限 | 中（**扩云函数，需裁决**） |
| 自由文字聊天（二期） | 新 `messages` 集合 + `game` 云函数加 `chat.send` action + 客户端输入/消息列表 | 大 |
| 订阅消息离线邀请（二期） | MP 后台配模板 + 云调用 `subscribeMessage.send` + 客户端授权引导（点击链内） | 中 |
| 同玩好友排行榜（二期） | 新增 `openDataContext` 目录（`index.js` + 自绘排行榜）、改 `game.json`（`openDataContext`）、主域 `drawImage(sharedCanvas)` 贴屏 + zone 命中、分数上报 `wx.setUserCloudStorage`、隐私指引声明 | 中~大 + 真机验证 |

### 7.3 平台根本不支持（不要排期）

- 通讯录好友全量列表；主域读取好友 openid / 昵称 / 关系链。
- 点名邀请某个好友并推送（无 API、shareTicket 是群维度且单聊没有、分享回调已回收）。
- 从订阅消息卡片携带 query 直接进指定房间（官方 Q&A：暂不支持）。
- 开放域向主域回传数据 / 开放域内发网络请求（架构禁止）。
- 判断「用户是否真的分享成功」（2.3.0+ 已回收）。

### 7.4 铁律复核（不破坏既有架构）

- 皮肤/音频不进 shared：本方案新增逻辑均落在 `js/core`（分享/键盘）、`js/shared`（rivals/消息模型）与开放域独立目录，**不把皮肤/音频塞进 shared**。
- 不建原生覆盖按钮：聊天输入框用 `wx.showKeyboard` + Canvas 自绘 + zone；排行榜在开放域 `sharedCanvas` 内绘制，点击由主域 zone 拦截后用 `postMessage` 通知开放域翻页——**不引入 `createUserInfoButton` 等原生覆盖按钮**。
- 云函数「零改动」是近期定案：本报告中§7.2 明确列出 4 处**必须扩云函数**的需求（等待期短语、msgSecCheck、聊天、按房间号预检）。**是否解禁由主理人裁决**，本报告不擅自改。

---

## 8. 基线记录（供后续实现对照）

**git HEAD**：`e80ab39c40ab514ea0d338cb39e2d568e54292c3`（分支 `main`，工作区本报告为唯一新增文件，未提交）。

**测试基线（2026-11-24 实跑，全部通过）**：

| 测试 | 命令 | 结果 |
|---|---|---|
| 核心玩法 | `node scripts/test-core.js` | 通过 **44** 项，失败 0 |
| 小游戏端 | `node scripts/test-minigame.js` | 通过 **213** 项，失败 0 |
| 离线全流程 | `node scripts/test-offline-flow.js` | 通过 **46** 项，失败 0 |
| 多分辨率布局 | `node scripts/test-layout.js` | **6** 种屏幕尺寸全部通过（iPhone Plus / 平板等，格子 ≥30px，不出屏/不重叠） |
| 皮肤 token（strict） | `node scripts/check-skin-tokens.js --strict` | 通过 **29** 项，失败 0 |

Node 版本：`v22.22.2`。后续任何社交功能实现，须保持上述五项数字不回退，并新增对应的分享 query / 邀请流程 / 消息安全测试用例（建议补进 `test-minigame.js` 与 `test-offline-flow.js`）。

---

## 9. 策划 §7 六条技术核实项 · 逐条结论

> 输入：`design/gdd/social/social-plan.md` §7（文策渊 / design-strategist，经主理人中转）。
> 本节逐条给「核实结果 + 与默认方案不同时怎么调整」。结论基于本报告前文证据与当前代码逐行核对。
> 摘要：**6 条全部核实完成，其中 2 条比默认预估更乐观（emote 已接线、query 可靠），3 条与默认方案一致，1 条（观战）确认默认不做合理。**

### 核实项 1 — 开放数据域/关系链能否拿好友列表、能否主动发起游戏邀请

- **核实结果**：见本报告 §1（官方《开放数据域》《关系链数据》）。**主域拿不到好友列表**；开放数据域只能拿「也玩本游戏且托管过数据」的好友并绘制排行榜，主域拿不到 openid、无法回传。**主动发起邀请不可能**：没有「给指定好友 push 邀请」的 API；shareTicket 仅群维度且单聊没有（§1.3）；分享成功回调自 2.3.0 起被回收。
- **与默认方案对比**：**一致**。策划默认「不依赖该能力，用转发邀请 + 最近对手」正确，可照此做。
- **调整**：无。观察期若要好友榜，只能按 §5.2 走开放域排行榜（libVersion 3.5.5 需 OffscreenCanvas 贴屏 + 真机验证），且依旧不能点名邀请——这条预期不要变。

### 核实项 2 — 转发卡片 query 在「群/会话点开冷启动」是否完整保留、有无长度限制

- **核实结果（比默认更乐观）**：
  - **冷启动保留**：官方文档 `wx.shareAppMessage` / `wx.onShareAppMessage` 明确写明「从这条转发消息进入后，可通过 `wx.getLaunchOptionsSync()` 或 `wx.onShow()` 获取启动参数中的 query」；`wx.getLaunchOptionsSync` 返回值含 `query` 与 `shareTicket`（https://developers.weixin.qq.com/minigame/dev/api/base/app/life-cycle/wx.getLaunchOptionsSync）。群/会话点开都适用，query 是**官方支持的邀请参数通道**，不是灰色能力。本项目 `game.js:135-145` 已按此实现冷/热启动读取。
  - **长度限制**：微信开放社区官方运营专员答复 **query 最大长度 2048 字符**（https://developers.weixin.qq.com/community/develop/doc/0000a25e0d4c10e8c3898cb8156c00）；超限会截断导致 `JSON.parse` 失败。本项目建议的 `roomNo=123456&pwd=1234&invite=1&from=xxxx&t=...` 约 50 字符，**远低于上限**。
  - **保留前提**：`query` 必须是 `key1=val1&key2=val2` 纯字符串格式（`share.js:toQuery` 已做 `encodeURIComponent`，正确）；不要塞 JSON 大对象。
- **与默认方案对比**：**一致且更稳**。策划默认「只带房间号等极短参数、详情走 room.get 补齐」依然是最优解；2048 上限意味着连中等长度参数都放得下，但**不建议**把房间全量信息塞进 query——因为 query 是明文随卡片下发的，且 `room.get` 已能按 roomId 补齐（§2.4）。
- **调整**：无需启用「短邀请码」或「纯快速匹配兜底」。但**仍必须做**过期/满员降级（§4.2 的 code→文案表），因为房间状态会变而 query 是静态的——这与 query 是否可靠无关。

### 核实项 3 — game.emote 是否已接线到客户端 UI、有无频率限制

- **核实结果（比默认更乐观，但有一处要补）**：
  - **已完全接线**：`battle.js` 里表情栏按钮（`battle.js:553-567` 生成 `emoteRects` + zone 绑定 `sendEmote`）、发送调用（`battle.js:858 api.emote({roomId, emoji})`）、接收展示（`:308-310` 按 `b.emote.seq` 去重 + `:863-872 showEmote` 气泡 + `EMOTE_HIDE_MS=2200` 自动消失）、离线实现（`offlineGame.js:345-346`）**全都在**。云函数 `game.emote`（`cloudfunctions/game/index.js:318-336`）也完整。即策划 MVP 三件里的「表情互动」**客户端零新增接线**，只需在真机验证一次。
  - **无频率限制**：云端 `emote()` 只校验「在对局中 + 是玩家 + 表情在白名单」，**没有节流/限频**；客户端 `sendEmote` 也没有节流（只有接收端 seq 去重）。理论上可连点刷表情 → 高频写 `rooms.battle` + watch 推送刷屏 + 云开发写次数费用。
  - **白名单注意**：表情白名单来自 `config/social.js` 的 `EMOTE_LIST`（客户端渲染与云端校验同源），当前是 6 个 emoji（👍😄😱🎯💣🙏）。策划文档 §3.2 写「禁 emoji，沿用项目铁律」——**与现有代码不符**，实际用的就是 emoji 字符；若确有「禁 emoji」铁律需另确认，否则建议沿用现状（表情是预设白名单，非 UGC，无审核风险）。
- **与默认方案对比**：默认「动作已存在、客户端需接 UI（成本 低）」——**实际连 UI 都已接好，成本比预估更低（近乎零）**；但「限频」这一条默认没覆盖，需补。
- **调整**：MVP F2 表情互动可标记为「已完成，待真机验证」，把省下的工时投到 F1 邀请闭环。**补一个轻量限频**：客户端 `sendEmote` 加 300~500ms 节流（按钮点击后短暂禁用），云端 `emote()` 可选加「同一 openid 1 秒内 ≤N 次」的软限制（**需扩云函数，属 §7.2 裁决项**）——MVP 阶段仅客户端节流即可，云端限频可延后。

### 核实项 4 — 内容安全 msgSecCheck 云调用可用性与接入成本

- **核实结果**：见本报告 §3.3（官方《文本内容安全识别》）。**可用**：云调用 `cloud.openapi.security.msgSecCheck({content, version:2, scene})`，云函数端调用，`errCode 87014` 判违规。`msgSecCheck` 已集成进 `wx-server-sdk`，接入代码量小（社区示例十几行）。**成本**：主要是云函数调用次数 + 内容安全接口配额；本项目消息量极低（2 人房、限流后），成本可忽略，但**精确计费需查腾讯云开发价格页**（本报告未测，列 §11 知识缺口）。
- **与默认方案对比**：**一致**。策划默认「以接内容安全为文字聊天上线前置，做不到就不上」正确。
- **调整**：无。补充一条比策划更强的提醒：不只是文字聊天，**现有房间名 `roomName` 与昵称 `nickname` 已是未过滤 UGC**（见核实项 5），开云端前就应补检，否则公开房间列表是裸 UGC。若主理人判断接入成本不可接受，按策划默认降级为「预设短语 / 只保留表情」——但那只是规避聊天 UGC，房间名/昵称的红线仍在。

### 核实项 5 — 昵称（profile.js）展示在战报卡/排行榜时是否已有内容过滤

- **核实结果（确认默认担忧属实）**：`profile.js` **没有任何内容过滤**。`setNickname`（`profile.js:38-42`）只做「去换行/制表符 + trim + 按 `ROOM_NAME_MAX` 截断」，纯格式清洗，**无 msgSecCheck、无敏感词、无兜底匿名名判断**；`fetchWechatNickname`（`:48-66`）拿到的微信昵称只要不是「微信用户/WeChat User」就直接用。房间名走云函数 `room.create` 的 `normalizeRoomName`（`cloudfunctions/room/index.js:86`），同样只做规范化、无内容安全校验。二者都会进入客户端可读可 watch 的 `rooms` 集合并展示在公开房间列表（`rooms.js:216`）。
- **与默认方案对比**：**一致**——目前确实无过滤，策划默认「对外展示前过滤/兜底匿名名」是必须的，不是可选。
- **调整**：把昵称治理提前到「战报卡 / 排行榜（F3/F7）上线前必须完成」，具体两条：①写入侧：`setNickname` 与 `room.create` 纳入 `msgSecCheck`（**扩云函数，属 §7.2 裁决项**）；②展示侧：客户端加一层「违规昵称兜底为 `defaultName()` 匿名名」的渲染守卫，即使历史脏数据流入也不外显。MVP 三件不涉及昵称公开展示（房间名展示是现有能力，开云端即有风险），建议至少做展示侧兜底。

### 核实项 6 — games 集合读权限与观战脱敏可行性（能否只呈现已公开的开火结果）

- **核实结果**：
  - **权限已隔离**：`docs/云开发部署说明.md` 明确 `rooms` = 所有用户可读（供 watch）、`games` = **所有用户不可读写，仅云函数管理端可访问**；布阵 `deploys` 只写在 `games`（`cloudfunctions/game/index.js:100-118`），密码也在 `games.meta`（T-08）。
  - **开火结果在公开视图**：`rooms.battle`（客户端可读可 watch）含 `marks[A]`（A 的轰炸记录）、`incoming[A]`（A 棋盘被炸记录）、`stats`、`counts`、`lastMove`（`game/index.js:141-170, 215-240`）——这些是**已发生的开火结果**，且明确注释「只暴露数量，不暴露形状/朝向（T-08 不变）」。`sync` 只返回自己的布阵 `myDeploy`（`:429-440`）。
  - **结论**：技术上「只呈现已公开开火结果」**现有数据结构就能做到**——观战者读 `rooms.battle` 的 marks/incoming 即可，天然不含布阵、不破坏 T-08。**但**要成为完整观战功能仍需新开发：观战身份（非玩家）鉴权、观战入口/UI、观战视角的 sync 分支、以及 roomId→观战的引导（云函数 `isPlayer` 校验会拒绝非玩家发言/操作，但读 `rooms` 是公开的）。这是「数据层已具备、产品层要新建」，不是「根本做不到」。
- **与默认方案对比**：**一致**——策划默认「不做观战」合理。理由不是技术上不可能，而是：①观战者同时看到双方 `incoming/marks` 虽有 T-08 保护但体验上仍是「全知视角」，与炸飞机的隐藏信息乐趣相悖；②收益不明、成本不低；③属观察期功能。
- **调整**：无。维持「不做」；若未来重评，**优先做「战报回放」（只读已结束对局）而非实时观战**——复用 `rooms.battle` 最终态 + F3 战报卡，成本更低、合规更稳。

### 六条核实结论速览表

| # | 核实项 | 核实结论 | 与默认方案 | 需要采取的调整 |
|---|---|---|---|---|
| 1 | 关系链/好友列表/主动邀请 | 主域拿不到好友列表；主动邀请不可能 | 一致 | 无，按转发邀请 + 最近对手做 |
| 2 | query 冷启动保留/长度 | 官方支持冷启动读取；上限 2048 字符，本方案约 50 字符 | 一致且更乐观 | 无需短码兜底；仍做过期/满员降级 |
| 3 | emote 接线/限频 | **UI 已全接线**（成本比预估更低）；无限频 | 更乐观 + 一处缺口 | 标记「待真机验证」；补客户端节流；云端限频可选 |
| 4 | msgSecCheck 可用性/成本 | 云调用可用、已集成 SDK、代码量小 | 一致 | 文字聊天以其为上线前置；房间名/昵称同批补检 |
| 5 | 昵称内容过滤 | **确认无过滤**，房间名也无 | 一致（担忧属实） | F3/F7 上线前补 msgSecCheck + 展示兜底匿名名 |
| 6 | games 权限/观战脱敏 | 权限已隔离；开火结果在公开视图，数据层可脱敏 | 一致（默认不做合理） | 无；若重评优先做战报回放而非实时观战 |

---

## 10. 待用户/主理人拍板的决策点

1. **好友列表口径**：接受「同玩好友排行榜 + 最近对手 + 分享邀请」三件套，替代「通讯录好友列表 + 点名邀请」？（平台硬边界，只能接受或不做）
2. **聊天分期**：一期只做快捷表情/短语（零审核风险），二期再上自由文字（msgSecCheck + 新集合 + 扩云函数）——是否同意？
3. **云函数解禁**：§7.2 列出 4 处必须扩云函数的场景（等待期短语 / msgSecCheck / 自由聊天 / 按房号预检）。近期「云函数零改动」定案是否解除？由谁、何时执行上传？
4. **开云端运营动作**：`USE_CLOUD=true` + `ENV_ID` + 上传 3 个云函数 + 建集合权限 + MP 后台隐私指引/内容安全权限——谁来执行、什么时间点？（代码侧只保留开关）
5. **开放域是否本期做**：考虑 libVersion 3.5.5 < 3.6.6 的限制与真机验证成本，排行榜放一期还是二期？
6. **私密房默认带密码**：分享邀请房默认生成一个 4 位密码随卡片下发（防匹配池串入 + 防陌生人），是否采纳？（影响产品体验与安全）

### 核实项补充的知识缺口

- query 2048 字符上限来自官方社区运营专员答复，非 API 文档正文；不同基础库版本可能有出入——**需真机验证**长参数截断行为（本方案仅用约 50 字符，风险极低）。
- emote「禁 emoji」铁律与现有代码用 emoji 字符的冲突，需主理人/策划确认哪版为准（见核实项 3）。

---

## 11. 原有知识缺口清单（诚实标注）

- 开放域 ScreenCanvas 需 3.6.6+，本项目 3.5.5 只能用 OffscreenCanvas 贴屏——**需在真机验证**渲染同步与触摸命中（§1.5）。
- `openDataContext` 开启后「某些限制」的具体清单官方文档未列全——**需真机回归全套主流程**。
- `wx.getFriendCloudStorage` 的授权态、新好友 2 小时延迟、`getPotentialFriendList` 实际返回质量——**需体验版验证**。
- 云开发 watch 长连接的计费口径、订阅消息单条计费、`msgSecCheck` 接口配额——**需查当前腾讯云开发价格页**，本报告未做精确成本测算（不在只读研究范围）。
- 若未来引入自由文字/图片 UGC，`imgSecCheck`、举报与人工审核后台的接入方案未展开（二期范围）。

---

*本报告基于只读研究与官方文档核对；所有 API 名称/参数均引自 developers.weixin.qq.com，未臆造。发现与任务描述不符之处（§2.1）已如实列出。*
