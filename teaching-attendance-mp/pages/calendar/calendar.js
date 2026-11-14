var core = require('../../utils/core.js');
var store = require('../../utils/store.js');
var lock = require('../../utils/lock.js');

var OPTIONS = [
  { k: '', label: '空', cls: 's-empty' },
  { k: 'work', label: '上班', cls: 's-work' },
  { k: 'inv', label: '监考', cls: 's-inv' },
  { k: 'ot', label: '加班', cls: 's-ot' },
  { k: 'leave', label: '请假', cls: 's-leave' }
];

/* 批量设置：星期用 JS 的 getDay() 取值，周日是 0 */
var BULK_WD = [
  { v: 1, label: '周一' }, { v: 2, label: '周二' }, { v: 3, label: '周三' },
  { v: 4, label: '周四' }, { v: 5, label: '周五' }, { v: 6, label: '周六' },
  { v: 0, label: '周日' }
];
var BULK_ST = [
  { k: 'work', label: '上班' }, { k: 'inv', label: '监考' }, { k: 'ot', label: '加班' },
  { k: 'leave', label: '请假' }, { k: 'empty', label: '空' },
  { k: 'am', label: '只上午' }, { k: 'pm', label: '只下午' }
];

Page({
  data: {
    ym: '',
    monLabel: '',
    weekHead: ['一', '二', '三', '四', '五', '六', '日'],
    cells: [],
    chips: [],
    notes: [],
    legend: [],
    opts: OPTIONS,
    rates: [],
    nightHint: '',
    sheet: null,
    bulk: null,
    bulkWd: [],
    bulkSts: BULK_ST,
    undo: null,
    sel: false,
    selKeys: [],
    scope: 'both',
    clearLes: false,
    allowWk: false,
    tipsOpen: false,
    ready: false
  },

  onLoad: function () {
    var ym = core.todayKey().slice(0, 7);
    this.db = store.load();
    this.setData({ ym: ym });
    /* 锁着就别先画：onShow 的 guard 会跳锁屏，但那一帧已经把整月的账目画出来了 */
    if (!lock.guard()) { return; }
    this.render();
  },

  onShow: function () {
    if (!lock.guard()) { return; }
    if (!this.db) { this.db = store.load(); this.render(); return; }
    /* 设置页、课程表页可能改过数据，回来时重新读一次 */
    this.db = store.load();
    this.render();
  },

  onReady: function () {
    this.measureGrid();
  },

  /* 直接量真实格子尺寸：不同手机屏宽、字号缩放都不一样，换算位移要靠它 */
  measureGrid: function () {
    var that = this;
    var tries = 0;
    function once() {
      try {
        wx.createSelectorQuery().selectAll('.cell').boundingClientRect(function (rects) {
          if (!rects || rects.length < 2 || !rects[0].width) {
            if (tries++ < 2) { setTimeout(once, 120); }
            return;
          }
          var a = rects[0], b = rects[1];
          /* 同一行的相邻两格，left 差就是列距；万一第二颗已在下一行，退回用宽度 */
          var colStep = (Math.abs(b.top - a.top) < 4 && b.left > a.left) ? (b.left - a.left) : a.width;
          var rowStep = a.height;
          var i;
          for (i = 0; i < rects.length; i++) {
            if (rects[i].top - a.top > 4) { rowStep = rects[i].top - a.top; break; }
          }
          that._m = { w: colStep, h: rowStep, cellW: a.width, cellH: a.height };
        }).exec();
      } catch (e) { /* 量不到就退回估算 */ }
    }
    once();
  },

  onUnload: function () {
    if (this._undoTimer) { clearTimeout(this._undoTimer); }
    if (this._touch && this._touch.lp) { clearTimeout(this._touch.lp); }
  },

  render: function () {
    this._maybeAutoFill();
    var db = this.db, ym = this.data.ym;
    var y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10);
    var lead = (core.firstWeekdayOf(ym) + 6) % 7;
    var n = core.daysInMonth(ym);
    var today = core.todayKey();
    var cells = [];
    var i, d;

    var selSet = {};
    if (this.data.sel) {
      this.data.selKeys.forEach(function (k) { selSet[k] = 1; });
    }

    for (i = 0; i < lead; i++) { cells.push({ id: 'b' + i, blank: true }); }

    for (d = 1; d <= n; d++) {
      var k = core.dk(y, m, d);
      var pre = core.preStart(db, k);
      var am = pre ? '' : core.effHalf(db, k, 'am');
      var pm = pre ? '' : core.effHalf(db, k, 'pm');
      var r = core.peek(db, k);
      var les = (pre || !r) ? 0 : (parseInt(r.lessons, 10) || 0);
      var wk = core.isWorkday(k, db);
      var ghA = core.isGhostHalf(db, k, 'am');
      var ghP = core.isGhostHalf(db, k, 'pm');
      var rest = !wk;
      var miss = (k < today && wk && !db.settings.autoWork && !am && !pm && !pre);
      var exp = core.lessonsFor(db, k);
      var lset = !!(r && r.lset);

      var lesText = '', lesCls = '';
      if (les) { lesText = les + '节'; }
      else if (exp > 0 && lset) { lesText = '0节'; lesCls = 'zero'; }
      else if (exp > 0) { lesText = exp + '节?'; lesCls = 'zero ghost'; }
      /* 晚修监考跟课时挤在同一行：格子窄，多占一行会把日期挤散 */
      var ni = (pre || !r) ? 0 : (parseInt(r.night, 10) || 0);

      var tag = '', tagCls = '';
      if (k === today) { tag = '今'; tagCls = 'now'; }
      else if (pre) { tag = '未'; tagCls = 'pre'; }
      else if (rest) { tag = '休'; tagCls = 'rest'; }

      var cls = 'cell' + (miss ? ' miss' : '') + (k === today ? ' today' : '') +
        (pre ? ' pre' : '') + (rest ? ' rest' : '');

      cells.push({
        id: k, key: k, blank: false, d: d, cls: cls, sel: !!selSet[k],
        amCls: core.sl(am).cls + (ghA ? ' ghost' : ''),
        pmCls: core.sl(pm).cls + (ghP ? ' ghost' : ''),
        lesText: lesText, lesCls: lesCls, nightText: ni ? (ni > 1 ? '晚' + ni : '晚修') : '',
        /* 写了备注的日子给个小圆点：格子里塞不下中文，但得能一眼看出「这天记了事」 */
        hasNote: !!(r && String(r.note || '').trim()),
        tag: tag, tagCls: tagCls
      });
    }

    var c = core.computeMonth(db, ym);
    var chips = [
      { k: '应上班', v: c.workdays + ' 天' },
      { k: '实际出勤', v: core.fmtShort(c.actual) + ' 天' },
      { k: '课时', v: c.lessons + ' 节' },
      { k: '应发', v: '¥' + core.fmt(c.total), num: true }
    ];

    var notes = [];
    /* 有自定义就说明来源，别再说「按周一到周五估算」——那句话已经不成立了 */
    var hasCustom = core.holidayYears(db).indexOf(y) >= 0;
    if (hasCustom) {
      notes.push(y + ' 年放假安排按你填的算，可在「设置 → 放假安排」里改');
    } else if (!core.HOLIDAYS[y]) {
      notes.push(y + ' 年放假安排未内置，按周一到周五估算');
    }
    if (db.settings.startDate && db.settings.startDate.slice(0, 7) === ym) {
      var sd = core.ymd(db.settings.startDate);
      notes.push(sd[1] + ' 月 ' + sd[2] + ' 日起算');
    }
    if (c.checked) { notes.push('本月已标记核对'); }
    if (!db.settings.autoWork) { notes.push('默认出勤已关闭，需逐天填'); }

    this.setData({
      monLabel: y + ' 年 ' + m + ' 月',
      cells: cells,
      chips: chips,
      notes: notes,
      legend: [
        { k: 's-work', label: '上班' },
        { k: 's-inv', label: '监考' },
        { k: 's-ot', label: '加班' },
        { k: 's-leave', label: '请假' }
      ],
      ready: true
    });
  },

  prevMonth: function () { this.setData({ ym: core.addMonths(this.data.ym, -1), sheet: null, sel: false, selKeys: [], allowWk: false }); this.render(); },
  nextMonth: function () { this.setData({ ym: core.addMonths(this.data.ym, 1), sheet: null, sel: false, selKeys: [], allowWk: false }); this.render(); },
  goToday: function () { this.setData({ ym: core.todayKey().slice(0, 7), sel: false, selKeys: [], allowWk: false }); this.render(); },
  pickMonth: function (e) {
    var v = e.detail.value;
    if (!core.isYm(v)) { return; }
    this.setData({ ym: v, sel: false, selKeys: [], allowWk: false });
    this.render();
  },

  /* 点击兜底：桌面端鼠标点击可能只发 tap 不走 touch */
  tapCell: function (e) {
    if (Date.now() - (this._touchAt || 0) < 500) { return; }
    var k = e.currentTarget.dataset.key;
    if (!k) { return; }
    if (this.data.sel) { this.toggleKey(k); return; }
    if (core.preStart(this.db, k)) {
      wx.showToast({ title: '这天在入职起算日之前，不计出勤', icon: 'none' });
      return;
    }
    this.openSheet(k);
  },

  /* ---------- 滑动选择 ---------- */
  toggleSel: function () {
    if (this.data.sel) { this.exitSel(); return; }
    this.setData({ sel: true, selKeys: [], scope: 'both', clearLes: false, allowWk: false });
    this.paintSel();
  },

  exitSel: function () {
    this.setData({ sel: false, selKeys: [], clearLes: false, allowWk: false });
    this.paintSel();
  },

  /* 整月周六补课时用：打开后连选不再跳过周末（法定假期仍然跳过） */
  toggleAllowWk: function () {
    var v = !this.data.allowWk;
    this.setData({ allowWk: v });
    if (v) {
      wx.showToast({ title: '连选会带上周六日，法定假期仍跳过', icon: 'none' });
    }
  },

  toggleKey: function (k) {
    if (!k) { return; }
    if (core.preStart(this.db, k)) {
      wx.showToast({ title: '起算日之前的日期不参与批量修改', icon: 'none' });
      return;
    }
    var keys = this.data.selKeys.slice();
    var i = keys.indexOf(k);
    if (i >= 0) { keys.splice(i, 1); } else { keys.push(k); }
    keys.sort();
    this.setData({ selKeys: keys });
    this.paintSel();
  },

  /* 连选默认只吃工作日：周末和法定假日跳过，调休补班的周六日照常算。
     需要周末（监考、补课）就在格子上单点补选，手动不受这条限制；
     整月周六都有课，就在底栏把「含周末」打开，连选带上周六日，法定假期仍跳过。 */
  _selable: function (k) {
    if (!k) { return false; }
    if (core.preStart(this.db, k)) { return false; }
    if (this.data.allowWk) { return !core.isHoliday(k, this.db); }
    return core.isWorkday(k, this.db);
  },

  /* 一颗格子的宽高，用来把手指位移换算成跨了几格 */
  _metrics: function () {
    if (this._m && this._m.w > 4) { return this._m; }
    var w = 375;
    try { w = (wx.getSystemInfoSync() || {}).windowWidth || 375; } catch (e) { w = 375; }
    var r = w / 750;
    this._m = { w: (w - 48 * r - 36 * r) / 7, h: 116 * r + 6 * r };
    return this._m;
  },

  gridStart: function (e) {
    var t = e.touches && e.touches[0];
    if (!t) { return; }
    this._touchAt = Date.now();
    var idx = parseInt(e.currentTarget.dataset.idx, 10);
    if (isNaN(idx)) { idx = -1; }
    var key = e.currentTarget.dataset.key || '';
    var td = {
      x0: t.clientX, y0: t.clientY,
      key: key,
      idx0: idx, last: idx,
      moved: false, active: false, add: true
    };
    this._touch = td;

    /* 长按直接进选择模式：不想横向滑的人按住一会儿就行，之后上下滑也能选 */
    var that = this;
    td.lp = setTimeout(function () {
      if (that._touch !== td || td.moved || td.idx0 < 0) { return; }
      td.moved = true;
      td.active = true;
      td.add = !that._selable(td.key) || that.data.selKeys.indexOf(td.key) < 0;
      if (!that.data.sel) {
        that.setData({ sel: true, selKeys: [], scope: 'both', clearLes: false, allowWk: false });
        that.paintSel();
      }
      if (that._selable(td.key)) { that._slideApply([td.key]); }
      try { wx.vibrateShort({ type: 'medium' }); } catch (err) { /* 忽略 */ }
    }, 420);
  },

  gridMove: function (e) {
    var td = this._touch;
    var t = e.touches && e.touches[0];
    if (!td || !t || td.idx0 < 0) { return; }
    var dx = t.clientX - td.x0, dy = t.clientY - td.y0;

    /* 真动起来了就不算长按；几像素的抖动不算，否则长按永远触发不了 */
    if (td.lp && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      clearTimeout(td.lp);
      td.lp = null;
    }

    if (!td.moved) {
      var adx = Math.abs(dx), ady = Math.abs(dy);
      /* 手指刚起手时的几像素抖动，先不判定方向 */
      if (adx < 10 && ady < 10) { return; }
      if (this.data.sel) {
        /* 已经在选择模式里：方向不限，上下划也能连选（此时页面已锁滚动） */
        td.moved = true;
      } else {
        /* 纵向明显占优：这是想滚页面，让出去，本轮不再处理 */
        if (ady > adx * 1.2) {
          this._touch = null;
          return;
        }
        /* 横向占优但还没划够一格的一半，等下一帧，别急着丢弃 */
        if (adx < 14) { return; }
        td.moved = true;
        this.setData({ sel: true, selKeys: [], scope: 'both', clearLes: false, allowWk: false });
        this.paintSel();
        try { wx.vibrateShort({ type: 'light' }); } catch (err) { /* 部分机型不支持，忽略 */ }
      }
      /* 从月初的空白格起手也允许滑，只是空白格本身不选中 */
      td.add = !this._selable(td.key) || this.data.selKeys.indexOf(td.key) < 0;
      td.active = true;
      /* 起算日之前、周末与法定假日都不参与连选，滑过去之后的工作日照样能选 */
      if (this._selable(td.key)) { this._slideApply([td.key]); }
    }

    if (!td.active) { return; }
    var m = this._metrics();
    var idx = td.idx0 + Math.round(dy / m.h) * 7 + Math.round(dx / m.w);
    if (idx === td.last) { return; }
    var cells = this.data.cells;
    if (idx < 0) { idx = 0; }
    if (idx > cells.length - 1) { idx = cells.length - 1; }
    var step = idx > td.last ? 1 : -1;
    var add = [];
    for (var i = td.last + step; step > 0 ? i <= idx : i >= idx; i += step) {
      var c = cells[i];
      if (!c || c.blank || !c.key) { continue; }
      if (!this._selable(c.key)) { continue; }
      add.push(c.key);
    }
    td.last = idx;
    if (add.length) { this._slideApply(add); }
  },

  gridEnd: function () {
    var td = this._touch;
    this._touch = null;
    this._touchAt = Date.now();
    if (td && td.lp) { clearTimeout(td.lp); td.lp = null; }
    if (!td || td.moved || !td.key) { return; }
    if (this.data.sel) { this.toggleKey(td.key); return; }
    if (core.preStart(this.db, td.key)) {
      wx.showToast({ title: '这天在入职起算日之前，不计出勤', icon: 'none' });
      return;
    }
    this.openSheet(td.key);
  },

  /* 被系统打断（页面滚动、来电等）时别丢掉手势：手指还在，接着滑应该继续选 */
  gridCancel: function () {
    var td = this._touch;
    if (td && td.lp) { clearTimeout(td.lp); td.lp = null; }
    this._touchAt = Date.now();
  },

  /* 滑动经过的格子：起手是加选，整段就加选；起手是取消，整段就取消 */
  _slideApply: function (keys) {
    var td = this._touch;
    if (!td) { return; }
    var cur = this.data.selKeys.slice();
    var changed = false;
    keys.forEach(function (k) {
      var i = cur.indexOf(k);
      if (td.add) {
        if (i < 0) { cur.push(k); changed = true; }
      } else if (i >= 0) { cur.splice(i, 1); changed = true; }
    });
    if (!changed) { return; }
    cur.sort();
    this.setData({ selKeys: cur });
    this.paintSel();
  },

  selAllWorkdays: function () {
    var db = this.db, ym = this.data.ym;
    var y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10);
    var n = core.daysInMonth(ym), keys = [];
    for (var d = 1; d <= n; d++) {
      var k = core.dk(y, m, d);
      if (core.preStart(db, k)) { continue; }
      if (!core.isWorkday(k, this.db)) { continue; }
      keys.push(k);
    }
    this.setData({ selKeys: keys });
    this.paintSel();
    wx.showToast({ title: '选中 ' + keys.length + ' 个法定工作日', icon: 'none' });
  },

  selClearAll: function () {
    this.setData({ selKeys: [] });
    this.paintSel();
  },

  pickScope: function (e) {
    this.setData({ scope: e.currentTarget.dataset.s || 'both' });
  },

  toggleClearLes: function () {
    this.setData({ clearLes: !this.data.clearLes });
  },

  /* 用法说明默认收起：那两段话一年看两次，不该常驻占掉半屏 */
  toggleTips: function () {
    this.setData({ tipsOpen: !this.data.tipsOpen });
  },

  /* 只改变化的那几格的 sel 字段。
     整表替换 cells 会让 wx:for 重建节点，正在被按住的那一格一没，微信就把触摸序列掐断，
     手指后面怎么划都收不到 touchmove —— 滑动选择就彻底失效了。 */
  paintSel: function () {
    var set = {};
    this.data.selKeys.forEach(function (k) { set[k] = 1; });
    var on = this.data.sel;
    var cells = this.data.cells;
    var patch = {};
    var changed = false;
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      if (c.blank) { continue; }
      var v = on && !!set[c.key];
      if (!!c.sel === v) { continue; }
      c.sel = v;
      patch['cells[' + i + '].sel'] = v;
      changed = true;
    }
    if (changed) { this.setData(patch); }
  },

  /* ---------- 按日期范围 + 星期批量（电脑版「批量设置」同款，跨月也能用） ---------- */
  openBulk: function () {
    var ym = this.data.ym;
    var y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10);
    var b = {
      from: core.dk(y, m, 1),
      to: core.dk(y, m, core.daysInMonth(ym)),
      /* 默认只勾周一到周五：跟滑动连选「默认跳过周末」一个口径。
         以前默认七天全勾 + 上班，点开就「应用」等于把整月周末也记成上班。 */
      wd: [1, 2, 3, 4, 5],
      st: 'work',
      clearLes: false,
      count: 0,
      first: ''
    };
    this.setData({ bulk: b });
    this._bulkRefresh(b);
  },

  closeBulk: function () { this.setData({ bulk: null }); },

  pickBulkFrom: function (e) { this._bulkPatch({ from: e.detail.value }); },
  pickBulkTo: function (e) { this._bulkPatch({ to: e.detail.value }); },
  pickBulkSt: function (e) { this._bulkPatch({ st: e.currentTarget.dataset.st }); },
  toggleBulkClear: function () { this._bulkPatch({ clearLes: !this.data.bulk.clearLes }); },

  toggleBulkWd: function (e) {
    var w = parseInt(e.currentTarget.dataset.wd, 10);
    var wd = this.data.bulk.wd.slice();
    var i = wd.indexOf(w);
    if (i >= 0) { wd.splice(i, 1); } else { wd.push(w); }
    if (!wd.length) {
      wx.showToast({ title: '至少留一个星期', icon: 'none' });
      return;
    }
    this._bulkPatch({ wd: wd });
  },

  _bulkPatch: function (patch) {
    var b = Object.assign({}, this.data.bulk, patch);
    this.setData({ bulk: b });
    this._bulkRefresh(b);
  },

  _bulkRefresh: function (b) {
    var keys = this._bulkKeys(b);
    var on = {};
    b.wd.forEach(function (w) { on[w] = 1; });
    this.setData({
      bulkWd: BULK_WD.map(function (x) { return { v: x.v, label: x.label, on: !!on[x.v] }; }),
      'bulk.count': keys.length,
      'bulk.first': keys.length ? keys[0] : ''
    });
  },

  /* 范围的每一天先过星期筛，再过入职起算日；跨月不特殊处理，日期连续就行 */
  _bulkKeys: function (b) {
    b = b || this.data.bulk;
    if (!b || !b.from || !b.to || b.to < b.from) { return []; }
    var keys = [], that = this, guard = 0;
    var t = new Date(b.from.replace(/-/g, '/'));
    var end = new Date(b.to.replace(/-/g, '/'));
    while (t <= end && guard++ < 800) {
      if (b.wd.indexOf(t.getDay()) >= 0) {
        var k = core.dk(t.getFullYear(), t.getMonth() + 1, t.getDate());
        if (!core.preStart(that.db, k)) { keys.push(k); }
      }
      t.setDate(t.getDate() + 1);
    }
    return keys;
  },

  applyBulk: function () {
    var b = this.data.bulk;
    if (!b) { return; }
    var keys = this._bulkKeys(b);
    if (!keys.length) {
      wx.showToast({ title: '这个范围里没有可改的日期', icon: 'none' });
      return;
    }
    var scope = b.st === 'am' ? 'am' : (b.st === 'pm' ? 'pm' : 'both');
    var that = this;
    /* 面板等真正写入成功再关：已核对月份点了「取消」不该白填一遍 */
    this.applyToKeys(keys, b.st, scope, b.clearLes, function () { that.setData({ bulk: null }); });
  },

  applySel: function (e) {
    var st = e.currentTarget.dataset.st;
    var keys = this.data.selKeys.slice();
    if (!keys.length) {
      wx.showToast({ title: '先点几天再套用', icon: 'none' });
      return;
    }
    this.applyToKeys(keys, st, this.data.scope, this.data.clearLes);
  },

  /* 把一组日期整体设为某状态：scope 只在「只上午/只下午」时有意义 */
  applyToKeys: function (keys, st, scope, clearLes, onDone) {
    var db = this.db, that = this;
    keys = keys.filter(function (k) { return !core.preStart(db, k); });
    if (!keys.length) {
      wx.showToast({ title: '这些天都在起算日之前，没有可改的', icon: 'none' });
      return false;
    }
    var checked = {};
    keys.forEach(function (k) {
      var ym = k.slice(0, 7);
      var mp = db.months[ym] || {};
      if (mp.checked) { checked[ym] = 1; }
    });
    var cm = Object.keys(checked);

    var run = function () {
      var msnap = JSON.parse(JSON.stringify(db.months || {}));
      var snap = {};
      keys.forEach(function (k) {
        var r = db.days[k];
        snap[k] = r ? JSON.parse(JSON.stringify(r)) : null;
        var les = clearLes ? 0 : (r ? (parseInt(r.lessons, 10) || 0) : 0);
        var note = r ? (r.note || '') : '';
        var am, pm;
        if (st === 'am') { am = 'work'; pm = ''; }
        else if (st === 'pm') { am = ''; pm = 'work'; }
        else if (st === 'empty') { am = ''; pm = ''; }
        else if (scope === 'am') { am = st; pm = ''; }
        else if (scope === 'pm') { am = ''; pm = st; }
        else { am = st; pm = st; }
        /* 批量只改状态时，原来记的课还是那个档位；勾了清空课时，档位一起清掉 */
        core.setRecord(db, k, am, pm, les, note, clearLes ? true : (r ? !!r.lset : false),
          clearLes ? '' : (r ? r.rid : ''));
      });
      that._undo = { msg: that.data.ym, snap: snap, msnap: msnap };
      store.commit();
      that.setData({ sel: false, selKeys: [], clearLes: false, allowWk: false });
      that.render();
      that.showUndo('已修改 ' + keys.length + ' 天');
    };

    if (cm.length) {
      /* 已核对的确认本次进入页面只问一次，别让补记十几天点十几次 */
      this._allowEditMonths(cm, function () { run(); if (onDone) { onDone(); } });
      return true;
    }
    run();
    if (onDone) { onDone(); }
    return true;
  },

  openSheet: function (k) {
    /* 同一次面板会话里的翻天补记算一批，撤销一次就能全回去 */
    this._sheetBatch = 'sheet-' + k + '-' + Date.now();
    var db = this.db, r = core.peek(db, k);
    var am = r ? (r.am || '') : core.effHalf(db, k, 'am');
    var pm = r ? (r.pm || '') : core.effHalf(db, k, 'pm');
    var les = r ? (parseInt(r.lessons, 10) || 0) : 0;
    var note = r ? (r.note || '') : '';
    var exp = core.lessonsFor(db, k);
    var p = db.months[k.slice(0, 7)] || {};

    var kind;
    if (core.isHoliday(k, this.db)) { kind = '法定节假日'; }
    else if (core.isWorkday(k, this.db)) { kind = '法定上班日'; }
    else { kind = '休息日'; }
    var w = core.weekOf(db, k);
    var sub = '周' + core.dowLabel(k) + ' · ' + kind + (w > 0 ? ' · 第 ' + w + ' 周' : '');

    this._note = undefined;
    var ni = r ? (parseInt(r.night, 10) || 0) : 0;
    var nf = parseFloat(db.settings.nightFee) || 0;
    var nh = parseFloat(db.settings.nightHours) || 0;
    this.setData({
      /* 档位随设置页变动，每次点开重算一遍，别缓存到页面 data 里 */
      rates: core.ratesOf(db).map(function (r) { return { id: r.id, name: r.name, price: r.price }; }),
      nightHint: '一晚 1 次 · ' + core.fmtShort(nh) + ' 小时 · ' + core.fmtShort(nf) + ' 元',
      sheet: {
        key: k,
        title: parseInt(k.slice(5, 7), 10) + ' 月 ' + parseInt(k.slice(8), 10) + ' 日',
        sub: sub,
        am: am, pm: pm, lessons: les, note: note, exp: exp,
        /* 高频考试一点就填；账本里自己写过的考试名也跟着冒出来，不另存一份配置 */
        tags: core.noteTags(db),
        rid: (r && r.rid) ? r.rid : 'default',
        /* 学校发了这个钱才显示；以前记过、现在单价调成 0 的也显示，好让人把次数清掉 */
        night: ni, nightOn: (nf > 0 || ni > 0),
        checked: p.checked
      }
    });
  },

  closeSheet: function () {
    this.setData({ sheet: null });
    this._note = undefined;
  },

  /* 面板里备注是边打边存进 _note 的（不每次 setData，免得光标乱跳）。
     其它字段一变就会重渲染，输入框的 value 会按 sheet.note 拉回去，
     所以每次改面板先把已输入的备注补进 sheet.note，别让文字被顶掉。 */
  _patchSheet: function (patch) {
    if (this._note !== undefined) { patch['sheet.note'] = this._note; }
    this.setData(patch);
  },

  pickHalf: function (e) {
    var which = e.currentTarget.dataset.which;
    var v = e.currentTarget.dataset.v || '';
    var cur = this.data.sheet[which] || '';
    var next = (cur === v) ? '' : v;
    var patch = {};
    patch['sheet.' + which] = next;
    this._patchSheet(patch);
  },

  stepLesson: function (e) {
    var d = parseInt(e.currentTarget.dataset.d, 10);
    var v = (parseInt(this.data.sheet.lessons, 10) || 0) + d;
    if (v < 0) { v = 0; }
    if (v > 20) { v = 20; }
    this._patchSheet({ 'sheet.lessons': v });
  },

  /* 晚修监考一晚就一场：2 小时 10 元，定死的。上限设 1，误点第二下不会多算一笔钱。
     内核不设限——从旧备份或粘贴码里读进来的多次记录仍照实算，界面不替人改账。 */
  stepNight: function (e) {
    var d = parseInt(e.currentTarget.dataset.d, 10);
    var cur = (parseInt(this.data.sheet.night, 10) || 0);
    var v = cur + d;
    if (v < 0) { v = 0; }
    /* 到顶了给个响，不然连点没反应会被当成按钮坏了。
       旧数据本来就 >1 次时保持原值，界面不偷偷替人改账，点 − 可以自己减下来 */
    if (v > 1) {
      v = cur > 1 ? cur : 1;
      if (d > 0) { wx.showToast({ title: '一晚只记 1 次监考', icon: 'none' }); }
    }
    this._patchSheet({ 'sheet.night': v });
  },

  useSchedule: function () {
    var exp = this.data.sheet.exp;
    if (!exp) {
      wx.showToast({ title: '课程表上这天没有课', icon: 'none' });
      return;
    }
    this._patchSheet({ 'sheet.lessons': exp });
  },

  onNote: function (e) {
    this._note = e.detail.value;
  },

  /* 快捷标签：点了直接填进备注。_note 和 sheet.note 要一起改，
     否则后面 _patchSheet 会把输入框里的文字顶回旧值 */
  tapTag: function (e) {
    var v = e.currentTarget.dataset.v || '';
    var s = this.data.sheet;
    if (!s || !s.key) { return; }
    this._note = v;
    this.setData({ 'sheet.note': v });
  },

  /* 选了哪档课就记在哪天，没选算默认档 */
  pickRate: function (e) {
    var id = e.currentTarget.dataset.id || 'default';
    this._patchSheet({ 'sheet.rid': id });
  },

  clearSheet: function () {
    this.setData({ 'sheet.am': '', 'sheet.pm': '', 'sheet.lessons': 0, 'sheet.note': '', 'sheet.rid': 'default', 'sheet.night': 0 });
    this._note = '';
  },

  /* 已核对的月份挡一下误改，但别让老师补记 20 天点 20 次确认：
     本次进入页面里每个月只问一次（重进页面重新问）。 */
  _allowEdit: function (ym, go) {
    if (!this._checkedOk) { this._checkedOk = {}; }
    var mp = this.db.months[ym] || {};
    if (!mp.checked || this._checkedOk[ym]) { go.call(this); return; }
    var that = this;
    wx.showModal({
      title: '本月已标记核对',
      content: ym + ' 已标记核对，仍要修改吗？',
      confirmText: '继续改',
      success: function (res) { if (res.confirm) { that._checkedOk[ym] = true; go.call(that); } }
    });
  },

  _allowEditMonths: function (list, go) {
    if (!this._checkedOk) { this._checkedOk = {}; }
    var that = this;
    var todo = list.filter(function (ym) { return !that._checkedOk[ym]; });
    if (!todo.length) { go.call(this); return; }
    wx.showModal({
      title: '含已核对的月份',
      content: todo.join('、') + ' 已标记核对，仍要修改吗？',
      confirmText: '继续改',
      success: function (res) {
        if (res.confirm) {
          todo.forEach(function (ym) { that._checkedOk[ym] = true; });
          go.call(that);
        }
      }
    });
  },

  saveSheet: function () {
    var s = this.data.sheet;
    if (!s || !s.key) { return; }
    /* 管的是「这一天所在的月份」，不是当前翻到的月份：
       面板可以按「前一天 / 后一天」跨月，拿 data.ym 去查会把已核对的月份绕过去。
       电脑版 saveEditor 也是按 key 的月份查的，两边同口径。 */
    this._allowEdit(s.key.slice(0, 7), this.writeSheet);
  },

  /* 把面板内容写进库，关不关面板由调用方决定（翻天时要留着） */
  _commitSheet: function () {
    var s = this.data.sheet;
    if (!s || !s.key) { return; }
    var note = (this._note === undefined ? s.note : this._note) || '';
    this._beginUndo(this._sheetBatch, s.key.slice(0, 7));
    core.setRecord(this.db, s.key, s.am, s.pm, s.lessons, note, undefined, s.rid, s.night);
    store.commit();
  },

  writeSheet: function () {
    var s = this.data.sheet;
    if (!s || !s.key) { return; }
    this._commitSheet();
    this.setData({ sheet: null });
    this._note = undefined;
    this.render();
    this.showUndo('已记下 ' + s.title);
  },

  /* 连续补记一周是最常见的动作：翻天前先存下当前这天，面板不关，每天少两次点击 */
  stepDay: function (e) {
    var s = this.data.sheet;
    if (!s || !s.key) { return; }
    var delta = parseInt(e.currentTarget.dataset.d, 10);
    var p = s.key.split('-');
    var dt = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10) + delta);
    var k = core.dk(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
    if (core.preStart(this.db, k)) {
      wx.showToast({ title: '这天在入职起算日之前，不计出勤', icon: 'none' });
      return;
    }
    var that = this;
    this._allowEdit(s.key.slice(0, 7), function () {
      that._commitSheet();
      /* 翻天翻到别的月份，日历跟着翻过去：面板上的日期和背后的格子要对得上，
         不然「已核对」的确认问的是看不见的那个月，撤销也会拍错月份 */
      var kym = k.slice(0, 7);
      if (kym !== that.data.ym) { that.setData({ ym: kym }); }
      that.openSheet(k);
      that.render();
    });
  },

  fillCourse: function () {
    var db = this.db, ym = this.data.ym;
    if (!db.term.start) {
      wx.showModal({ title: '还差一步', content: '请先到「设置 → 课程表与教学周」填写第 1 教学周的周一，才能把周次换算成日期。', showCancel: false });
      return;
    }
    if (!db.courses.length) {
      wx.showModal({ title: '课程表还是空的', content: '先在「课程表」里添加课程，再来一键填充。', showCancel: false });
      return;
    }
    var that = this;
    var go = function () {
      that._beginUndo();
      var r = core.fillLessonsFromCourses(db, ym);
      store.commit();
      that.render();
      var msg = '填了 ' + r.filled + ' 天';
      if (r.skipped) { msg += '，跳过 ' + r.skipped + ' 天已有记录'; }
      if (r.hol) { msg += '，节假日 ' + r.hol + ' 天不填'; }
      wx.showToast({ title: msg, icon: 'none' });
      that.showUndo('已按课程表填入 ' + r.filled + ' 天课时');
    };
    this._allowEdit(ym, go);
  },

  restoreDefault: function () {
    var db = this.db, ym = this.data.ym;
    if (!db.settings.autoWork) {
      wx.showToast({ title: '默认出勤是关闭的，先在设置里打开', icon: 'none' });
      return;
    }
    var y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10);
    var n = core.daysInMonth(ym), cnt = 0;
    this._beginUndo();
    for (var d = 1; d <= n; d++) {
      var k = core.dk(y, m, d), r = core.peek(db, k);
      if (!r || !r.off) { continue; }
      if (!core.defaultHalf(db, k, 'am') && !core.defaultHalf(db, k, 'pm')) { continue; }
      if (!r.am && !r.pm && !r.lessons && !r.note) { delete db.days[k]; }
      else { r.off = false; r.upd = Date.now(); }
      cnt++;
    }
    if (!cnt) {
      this._undo = null;
      wx.showToast({ title: '本月没有需要恢复的日子', icon: 'none' });
      return;
    }
    core.freezeMonth(db, ym);
    store.commit();
    this.render();
    this.showUndo('已恢复默认出勤 ' + cnt + ' 天');
  },

  clearMonth: function () {
    var that = this, db = this.db, ym = this.data.ym;
    var doClear = function () {
      wx.showModal({
        title: '清空 ' + ym,
        content: '清空后出勤 0 天、课时 0 节、应发 ¥0，默认出勤也一并清掉。10 秒内可撤销。',
        confirmText: '清空',
        confirmColor: '#A33A28',
        success: function (res) {
          if (!res.confirm) { return; }
          that._beginUndo();
          var y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10);
          var n = core.daysInMonth(ym);
          for (var d = 1; d <= n; d++) {
            var k = core.dk(y, m, d);
            if (core.defaultHalf(db, k, 'am') || core.defaultHalf(db, k, 'pm')) {
              db.days[k] = { am: '', pm: '', lessons: 0, note: '', off: true, lset: false, upd: Date.now() };
            } else {
              delete db.days[k];
            }
          }
          /* 清空之后不该还挂着「已核对」——电脑版也是这么处理的 */
          core.monthP(db, ym).checked = false;
          core.freezeMonth(db, ym);
          store.commit();
          that.render();
          that.showUndo('已清空 ' + ym);
        }
      });
    };
    /* 已核对是「别再手滑改」的标记，但本次进入页面只问一次；
       清空本身还有一次破坏性确认，别让老师连点两个对话框 */
    if (core.monthP(db, ym).checked) {
      this._allowEdit(ym, doClear);
      return;
    }
    doClear();
  },

  /* 进入某月时把已过去的日子按课程表补齐。
     幂等（填过的日子有 lset），撤销后本会话不再自动填回来。 */
  _maybeAutoFill: function () {
    /* 撤销后紧跟的那次渲染不许把刚回滚的课时又自动填回来 */
    if (this._skipAutoOnce) { this._skipAutoOnce = false; return; }
    /* 面板开着就别顺手落账：面板翻天会触发重绘，这时候自动填进去的课时，
       既看不见也容易被误当成自己记的。关掉面板后的那次重绘本就会补上。 */
    if (this.data.sheet || this.data.bulk) { return; }
    var db = this.db, ym = this.data.ym;
    if (!db || !ym || (this._autoBlocked && this._autoBlocked[ym])) { return; }
    var prevUndo = this._undo;
    this._beginUndo();                    /* 必须在写入前拍快照，撤销才有意义 */
    var r = core.autoFillLessons(db, ym, core.todayKey());
    if (r.filled <= 0) { this._undo = prevUndo; return; }
    store.commit();
    this._undo.auto = true;
    this._undo.ym = ym;
    this.showUndo('已按课程表自动记入 ' + r.filled + ' 天课时');
  },

  /* 拍一个月的逐日快照。已经拍过的那天不覆盖——一批操作里要保留的是「这批之前」的状态 */
  _snapMonth: function (snap, ym) {
    var y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10);
    var n = core.daysInMonth(ym);
    for (var d = 1; d <= n; d++) {
      var k = core.dk(y, m, d);
      if (Object.prototype.hasOwnProperty.call(snap, k)) { continue; }
      snap[k] = this.db.days[k] ? JSON.parse(JSON.stringify(this.db.days[k])) : null;
    }
  },

  _beginUndo: function (batchKey, ym) {
    /* 面板翻天可以跨月，所以快照要按「真正要改的那天」所在的月份拍，
       不能一律拍 data.ym——否则撤销把错的月份还原回去，改过的那天还在，还照样提示「已撤销」。 */
    ym = ym || this.data.ym;
    /* 同一批连续操作（面板里翻天补记）沿用第一次的快照：
       一次撤销回到这一批操作之前，而不是只回滚最后一天；跨月的月份补进同一份快照。 */
    if (batchKey && this._undo && this._undo.batchKey === batchKey) {
      if (!this._undo.months) { this._undo.months = [this._undo.ym]; }
      if (this._undo.months.indexOf(ym) < 0) {
        this._snapMonth(this._undo.snap, ym);
        this._undo.months.push(ym);
      }
      this._undo.ym = ym;
      return;
    }
    var snap = {};
    this._snapMonth(snap, ym);
    this._undo = {
      msg: ym, ym: ym, months: [ym], snap: snap,
      msnap: JSON.parse(JSON.stringify(this.db.months || {})),
      batchKey: batchKey || null
    };
  },

  showUndo: function (label) {
    var that = this;
    if (this._undoTimer) { clearTimeout(this._undoTimer); }
    this.setData({ undo: { label: label } });
    this._undoTimer = setTimeout(function () {
      that._undo = null;
      that.setData({ undo: null });
    }, 10000);
  },

  hideUndo: function () {
    if (this._undoTimer) { clearTimeout(this._undoTimer); this._undoTimer = null; }
    this._undo = null;
    this.setData({ undo: null });
  },

  doUndo: function () {
    if (!this._undo) { return; }
    this._skipAutoOnce = true;
    /* 撤销自动落账：本月别再自动填回来，想永久关掉去设置页 */
    var autoUndo = !!this._undo.auto;
    var autoYm = this._undo.ym;
    if (autoUndo && autoYm) {
      if (!this._autoBlocked) { this._autoBlocked = {}; }
      this._autoBlocked[autoYm] = true;
    }
    var snap = this._undo.snap;
    Object.keys(snap).forEach(function (k) {
      if (snap[k] === null) { delete this.db.days[k]; }
      else { this.db.days[k] = snap[k]; }
    }, this);
    /* 「已核对」与当月冻结参数也是那次操作改掉的，撤销要一起还回去 */
    if (this._undo.msnap) { this.db.months = this._undo.msnap; }
    store.commit();
    this._undo = null;
    if (this._undoTimer) { clearTimeout(this._undoTimer); }
    this.setData({ undo: null });
    this.render();
    wx.showToast({ title: autoUndo ? '已撤销，本月不再自动填' : '已撤销', icon: 'none' });
  },

  /* 右上角「转发」：发给同事各自记账。数据存在各自手机上，转发不会带走自己的账 */
  onShareAppMessage: function () {
    return {
      title: '考勤记账本-个人版：出勤和课时分开记，工资自动算',
      path: 'pages/calendar/calendar'
    };
  },

  noop: function () {}
});
