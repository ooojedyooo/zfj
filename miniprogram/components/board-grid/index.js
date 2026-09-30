// components/board-grid/index.js
// 9×9 棋盘组件 —— 同时服务于「我方海域」与「敌方海域」
//
// 设计要点：
//   - 只负责渲染与点选，不承载业务逻辑
//   - 通过 cells（9×9 状态二维数组）由外部驱动显示内容
//   - selectable 控制是否允许点选（敌方海域且轮到我方时为 true）
Component({
  properties: {
    // 棋盘尺寸，固定 9
    size: {
      type: Number,
      value: 9
    },
    // 9×9 状态二维数组，元素取值：'' | 'plane' | 'hit' | 'kill' | 'miss'
    cells: {
      type: Array,
      value: []
    },
    // 是否可点选（对应 PRD BAT-07：已攻击格位不可选中）
    selectable: {
      type: Boolean,
      value: false
    },
    // 当前选中格 { row, col }
    selected: {
      type: Object,
      value: null
    },
    // 已攻击过的格位集合 { 'row,col': true }，用于置灰
    disabledMap: {
      type: Object,
      value: {}
    }
  },

  methods: {
    onTapCell(e) {
      const { row, col } = e.currentTarget.dataset
      const r = Number(row)
      const c = Number(col)
      const k = r + ',' + c

      if (!this.data.selectable) return
      if (this.data.disabledMap[k]) return // 已轰炸过，不可选中

      this.triggerEvent('celltap', { row: r, col: c })
    }
  }
})
