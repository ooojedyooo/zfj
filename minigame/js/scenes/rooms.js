// minigame/js/scenes/rooms.js
// 房间列表 —— 「浏览公开房间」与「搜索房间名」共用这一个场景
//
// 为什么合成一个场景：
//   两种入口看到的是同一种东西（房间列表），差别只在「怎么筛」。
//   拆成两个场景就要复制一遍列表绘制、空态、点击加入 —— 以后改列表样式得改两处。
//
// 列表项必须让人一眼看全三件事：房间号、房间名、每步限时。
// 这三项决定「要不要进这局」，少一项玩家就得点进去再退出来。
const Scene = require('./base')
const theme = require('../core/theme')
const draw = require('../core/draw')
const Button = require('../widgets/button')
const ui = require('../widgets/ui')
const dialog = require('../core/dialog')
const api = require('../shared/services/cloudApi')
const { MAX_PLANES, TURN_DEFAULT } = require('../shared/config/rules')

const MAX_ITEMS = 6          // 一屏能看清的房间数，超过就提示用搜索
const ITEM_H = 116
const ITEM_GAP = 12

class Rooms extends Scene {
  constructor(app) {
    super(app)
    this.mode = 'public'
    this.keyword = ''
    this.all = []
    this.loading = false
    this.error = ''
    this.joining = ''
  }

  onEnter(params) {
    const p = params || {}
    this.mode = p.mode === 'search' ? 'search' : 'public'
    this.keyword = ''
    this.all = []
    this.error = ''
    this.joining = ''
    this.loading = false
    this.layout()
    this.load()
  }

  /* ---------------- 数据 ---------------- */

  load() {
    const self = this
    if (this.mode === 'search' && !this.keyword) {
      this.all = []
      this.loading = false
      this.layout()
      return
    }
    this.loading = true
    this.error = ''
    this.layout()

    const req = this.mode === 'search'
      ? api.searchRooms({ keyword: this.keyword })
      : api.listRooms()

    req.then(function (res) {
      self.all = (res && res.rooms) || []
      self.loading = false
      self.layout()
    }).catch(function (e) {
      self.loading = false
      self.error = (e && e.message) || '加载失败'
      self.layout()
    })
  }

  /** 一屏显示几条由屏幕高度决定（layout 里算好放 g.limit），多的靠搜索 */
  visible() {
    const n = (this.geo && this.geo.limit) || MAX_ITEMS
    return (this.all || []).slice(0, n)
  }

  /* ---------------- 布局 ---------------- */

  layout() {
    this.zones = []
    const u = this.u.bind(this)
    const L = this.layoutInfo
    const g = this.geo = {}
    const x = u(40)
    const w = L.W - u(80)

    g.x = x
    g.w = w
    g.back = { x: u(24), y: L.safeTop + u(16), w: u(140), h: u(56) }
    g.titleY = L.safeTop + u(120)
    g.refresh = { x: L.W - u(40) - u(120), y: L.safeTop + u(74), w: u(120), h: u(56) }
    this.zone(g.refresh.x, g.refresh.y, g.refresh.w, g.refresh.h, this.load.bind(this))

    let y = g.titleY + u(72)

    if (this.mode === 'search') {
      g.searchBox = { x: x, y: y, w: w, h: u(88) }
      this.zone(x, y, w, u(88), this.onEditKeyword.bind(this))
      y += u(88) + u(32)
    }

    g.listY = y

    // 底部操作先定位置，列表能放几条由「剩余高度」决定 ——
    // 写死 6 条在宽屏上会溢出（u() 按屏宽放大，纵向空间并不会同比变多），
    // 小屏又会浪费一整屏空白。
    const btnH = u(88)
    const by = L.H - L.safeBottom - u(24) - btnH
    g.actionY = by

    const avail = by - u(16) - g.listY
    const per = u(ITEM_H + ITEM_GAP)
    g.limit = Math.max(1, Math.min(MAX_ITEMS, Math.floor(avail / per)))

    const items = this.visible()
    g.items = []
    items.forEach(function (it, i) {
      const rect = {
        x: x,
        y: g.listY + i * u(ITEM_H + ITEM_GAP),
        w: w,
        h: u(ITEM_H),
        data: it
      }
      g.items.push(rect)
      this.zone(rect.x, rect.y, rect.w, rect.h, function () { this.onPick(it) }.bind(this))
    }, this)

    g.itemsBottom = g.listY + items.length * u(ITEM_H + ITEM_GAP)
    g.emptyY = g.listY + u(80)

    if (this.mode === 'search') {
      g.actionRects = Button.rowRects(x, by, w, btnH, u(20), 1)
      this.zone(x, by, w, btnH, this.onEnterRoomNo.bind(this))
    } else {
      g.actionRects = Button.rowRects(x, by, w, btnH, u(20), 2)
      this.zone(g.actionRects[0].x, by, g.actionRects[0].w, btnH, this.onMatch.bind(this))
      this.zone(g.actionRects[1].x, by, g.actionRects[1].w, btnH, this.onEnterRoomNo.bind(this))
    }
  }

  /* ---------------- 渲染 ---------------- */

  render(ctx) {
    const u = this.u.bind(this)
    const L = this.layoutInfo
    const g = this.geo
    const c = theme.color

    draw.text(ctx, this.mode === 'search' ? '搜索房间' : '公开房间', L.W / 2, g.titleY, {
      size: u(theme.size.h2), weight: 500, color: c.text, align: 'center'
    })

    // 返回
    draw.fillRect(ctx, g.back.x, g.back.y, g.back.w, g.back.h, c.gray, u(theme.radius.pill))
    draw.text(ctx, '‹ 返回', g.back.x + g.back.w / 2, g.back.y + g.back.h / 2, {
      size: u(theme.size.small), color: c.text, align: 'center'
    })

    // 刷新
    draw.text(ctx, this.loading ? '刷新中…' : '刷新', g.refresh.x + g.refresh.w, g.refresh.y + g.refresh.h / 2, {
      size: u(theme.size.small), color: this.loading ? c.textMuted : c.primary, align: 'right'
    })

    if (g.searchBox) {
      const box = g.searchBox
      draw.fillRect(ctx, box.x, box.y, box.w, box.h, c.card, u(theme.radius.md))
      draw.strokeRect(ctx, box.x, box.y, box.w, box.h, c.border, u(theme.radius.md), 1)
      const has = !!this.keyword
      draw.text(ctx, has ? draw.ellipsis(ctx, this.keyword, box.w - u(48), u(theme.size.body)) : '点这里输入房间名',
        box.x + u(24), box.y + box.h / 2, {
          size: u(theme.size.body), color: has ? c.text : c.textMuted
        })
    }

    if (g.items.length) {
      g.items.forEach(function (r) { this.drawItem(ctx, r, r.data) }, this)
    } else {
      this.drawEmpty(ctx)
    }

    // 底部按钮
    if (this.mode === 'search') {
      Button.render(ctx, Object.assign({}, g.actionRects[0], { label: '输入房间号加入', kind: 'outline' }))
    } else {
      Button.render(ctx, Object.assign({}, g.actionRects[0], { label: '一键匹配', kind: 'primary' }))
      Button.render(ctx, Object.assign({}, g.actionRects[1], { label: '输房间号', kind: 'outline' }))
    }

    if (!api.isCloud) {
      draw.text(ctx, '离线试玩 · 列表为演示数据，私密房示例密码 8888',
        L.W / 2, g.actionY - u(26), {
          size: u(theme.size.tiny), color: c.textMuted, align: 'center'
        })
    }
  }

  drawItem(ctx, rect, it) {
    if (!it) return
    const u = this.u.bind(this)
    const c = theme.color
    ui.card(ctx, this.layoutInfo, rect.x, rect.y, rect.w, rect.h)

    // 房间名（主信息）
    draw.text(ctx, draw.ellipsis(ctx, it.roomName || '未命名房间', rect.w - u(220), u(theme.size.h3), 500),
      rect.x + u(28), rect.y + u(40), {
        size: u(theme.size.h3), weight: 500, color: c.text
      })

    // 房间号 + 单步限时（决定要不要进的关键信息）
    draw.text(ctx, '#' + it.roomNo + '  ·  每步 ' + (it.stepSeconds || TURN_DEFAULT) + ' 秒',
      rect.x + u(28), rect.y + u(82), {
        size: u(theme.size.small), color: c.textMuted
      })

    if (it.hasPassword) {
      ui.tag(ctx, this.layoutInfo, rect.x + rect.w - u(28) - u(88), rect.y + u(22), '私密',
        c.warnDark, c.warnLight)
      draw.text(ctx, (it.players || 1) + '/2 人', rect.x + rect.w - u(28), rect.y + u(84), {
        size: u(theme.size.tiny), color: c.textMuted, align: 'right'
      })
    } else {
      draw.text(ctx, '›', rect.x + rect.w - u(28), rect.y + rect.h / 2, {
        size: u(theme.size.h2), color: c.textMuted, align: 'right'
      })
      draw.text(ctx, (it.players || 1) + '/2 人', rect.x + rect.w - u(56), rect.y + rect.h / 2, {
        size: u(theme.size.tiny), color: c.textMuted, align: 'right'
      })
    }
  }

  drawEmpty(ctx) {
    const u = this.u.bind(this)
    const c = theme.color
    const L = this.layoutInfo
    let text = ''
    if (this.loading) text = '正在加载房间…'
    else if (this.error) text = this.error
    else if (this.mode === 'search' && !this.keyword) text = '输入房间名，找朋友开的那一局'
    else if (this.mode === 'search') text = '没有找到「' + this.keyword + '」，换个名字再试'
    else text = '暂时没有公开房间，可以自己开一间'

    draw.text(ctx, text, L.W / 2, this.geo.emptyY, {
      size: u(theme.size.body), color: c.textMuted, align: 'center'
    })
    if (this.mode === 'search' && this.keyword && !this.loading) {
      draw.text(ctx, '房名支持模糊匹配，记得也行', L.W / 2, this.geo.emptyY + u(44), {
        size: u(theme.size.tiny), color: c.textMuted, align: 'center'
      })
    }
  }

  /* ---------------- 交互 ---------------- */

  onEditKeyword() {
    dialog.input({
      title: '按房间名搜索',
      value: this.keyword,
      placeholder: '输入房间名的一部分即可',
      onOk: function (v) {
        this.keyword = String(v || '').trim()
        this.load()
      }.bind(this)
    })
  }

  /** 点房间：私密房先要密码 */
  onPick(it) {
    if (!it || this.joining) return
    if (it.hasPassword) {
      const self = this
      dialog.input({
        title: '输入房间密码',
        placeholder: '4 位数字',
        onOk: function (v) { self.doJoin(it, String(v || '')) }
      })
      return
    }
    this.doJoin(it, '')
  }

  doJoin(it, password) {
    const self = this
    const app = this.app
    this.joining = it.roomNo
    app.busy('加入中…')
    api.joinRoom({ roomNo: it.roomNo, password: password }).then(function (data) {
      app.hideBusy()
      self.joining = ''
      app.replace('room', { joined: Object.assign({ matched: true }, data) })
    }).catch(function (e) {
      app.hideBusy()
      self.joining = ''
      app.toast((e && e.message) || '加入失败')
    })
  }

  onMatch() {
    const self = this
    const app = this.app
    if (this.joining) return
    this.joining = 'match'
    app.busy('匹配中…')
    api.matchRoom({ planeCount: MAX_PLANES }).then(function (data) {
      app.hideBusy()
      self.joining = ''
      app.replace('room', { joined: data })
    }).catch(function (e) {
      app.hideBusy()
      self.joining = ''
      app.toast((e && e.message) || '匹配失败')
    })
  }

  onEnterRoomNo() {
    this.app.replace('room', { mode: 'join' })
  }
}

module.exports = function (app) { return new Rooms(app) }
