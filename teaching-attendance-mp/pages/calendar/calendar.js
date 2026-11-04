var core = require('../../utils/core.js');
var store = require('../../utils/store.js');

var OPTIONS = [
  { k: '', label: '空', cls: 's-empty' },
  { k: 'work', label: '上班', cls: 's-work' },
  { k: 'inv', label: '监考', cls: 's-inv' },
  { k: 'ot', label: '加班', cls: 's-ot' },
  { k: 'leave', label: '请假', cls: 's-leave' }
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
    sheet: null,
    undo: null,
    sel: false,
    selKeys: [],
    scope: 'both',
    clearLes: false,
    allowWk: false,
    ready: false
  },

  onLoad: function () {
    var ym = core.todayKey().slice(0, 7);
    this.db = store.load();
    this.setData({ ym: ym });
    this.render();
  },

  onShow: function () {
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
      var wk = core.isWorkday(k);
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
        lesText: lesText, lesCls: lesCls, tag: tag, tagCls: tagCls
      });
    }

    var c = core.computeMonth(db, ym);
    var chips = [
      { k: '应上班', v: c.workdays + ' 天' },
      { k: '实际出勤', v: core.fmtShort(c.actual) + ' 天' },
      { k: '课时', v: c.lessons + ' 节' },
      { k: '应发', v: '¥' + core.fmt(c.total) }
    ];

    var notes = [];
    if (!core.HOLIDAYS[y]) { notes.push(y + ' 年放假安排未内置，按周一到周五估算'); }
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
    if (this.data.allowWk) { return !core.isHoliday(k); }
    return core.isWorkday(k);
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
      if (!core.isWorkday(k)) { continue; }
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
  applyToKeys: function (keys, st, scope, clearLes) {
    var db = this.db, that = this;
    keys = keys.filter(function (k) { return !core.preStart(db, k); });
    if (!keys.length) {
      wx.showToast({ title: '这些天都在起算日之前，没有可改的', icon: 'none' });
      return false;
    }
    var checked = {};
    keys.forEach(function (k) {
      var ym = k.slice(0, 7);
      if (core.monthP(db, ym).checked) { checked[ym] = 1; }
    });
    var cm = Object.keys(checked);

    var run = function () {
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
        core.setRecord(db, k, am, pm, les, note, clearLes ? true : (r ? !!r.lset : false));
      });
      that._undo = { msg: that.data.ym, snap: snap };
      store.save(db);
      that.setData({ sel: false, selKeys: [], clearLes: false, allowWk: false });
      that.render();
      that.showUndo('已修改 ' + keys.length + ' 天');
    };

    if (cm.length) {
      wx.showModal({
        title: '含已核对的月份',
        content: cm.join('、') + ' 已标记核对，仍要修改吗？',
        confirmText: '继续改',
        success: function (res) { if (res.confirm) { run(); } }
      });
      return true;
    }
    run();
    return true;
  },

  openSheet: function (k) {
    var db = this.db, r = core.peek(db, k);
    var am = r ? (r.am || '') : core.effHalf(db, k, 'am');
    var pm = r ? (r.pm || '') : core.effHalf(db, k, 'pm');
    var les = r ? (parseInt(r.lessons, 10) || 0) : 0;
    var note = r ? (r.note || '') : '';
    var exp = core.lessonsFor(db, k);
    var p = core.monthP(db, k.slice(0, 7));

    var kind;
    if (core.isHoliday(k)) { kind = '法定节假日'; }
    else if (core.isWorkday(k)) { kind = '法定上班日'; }
    else { kind = '休息日'; }
    var w = core.weekOf(db, k);
    var sub = '周' + core.dowLabel(k) + ' · ' + kind + (w > 0 ? ' · 第 ' + w + ' 周' : '');

    this._note = undefined;
    this.setData({
      sheet: {
        key: k,
        title: parseInt(k.slice(5, 7), 10) + ' 月 ' + parseInt(k.slice(8), 10) + ' 日',
        sub: sub,
        am: am, pm: pm, lessons: les, note: note, exp: exp,
        checked: p.checked
      }
    });
  },

  closeSheet: function () {
    this.setData({ sheet: null });
    this._note = undefined;
  },

  pickHalf: function (e) {
    var which = e.currentTarget.dataset.which;
    var v = e.currentTarget.dataset.v || '';
    var cur = this.data.sheet[which] || '';
    var next = (cur === v) ? '' : v;
    var patch = {};
    patch['sheet.' + which] = next;
    this.setData(patch);
  },

  stepLesson: function (e) {
    var d = parseInt(e.currentTarget.dataset.d, 10);
    var v = (parseInt(this.data.sheet.lessons, 10) || 0) + d;
    if (v < 0) { v = 0; }
    if (v > 20) { v = 20; }
    this.setData({ 'sheet.lessons': v });
  },

  useSchedule: function () {
    var exp = this.data.sheet.exp;
    if (!exp) {
      wx.showToast({ title: '课程表上这天没有课', icon: 'none' });
      return;
    }
    this.setData({ 'sheet.lessons': exp });
  },

  onNote: function (e) {
    this._note = e.detail.value;
  },

  clearSheet: function () {
    this.setData({ 'sheet.am': '', 'sheet.pm': '', 'sheet.lessons': 0, 'sheet.note': '' });
    this._note = '';
  },

  saveSheet: function () {
    var s = this.data.sheet;
    if (!s) { return; }
    if (s.checked) {
      var that = this;
      wx.showModal({
        title: '本月已标记核对',
        content: '仍然要修改这一天的记录吗？',
        confirmText: '继续改',
        success: function (res) { if (res.confirm) { that.writeSheet(); } }
      });
      return;
    }
    this.writeSheet();
  },

  writeSheet: function () {
    var s = this.data.sheet;
    var note = (this._note === undefined ? s.note : this._note) || '';
    this._beginUndo();
    core.setRecord(this.db, s.key, s.am, s.pm, s.lessons, note);
    store.save(this.db);
    this.setData({ sheet: null });
    this._note = undefined;
    this.render();
    this.showUndo('已记下 ' + s.title);
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
    var p = core.monthP(db, ym);
    var go = function () {
      that._beginUndo();
      var r = core.fillLessonsFromCourses(db, ym);
      store.save(db);
      that.render();
      var msg = '填了 ' + r.filled + ' 天';
      if (r.skipped) { msg += '，跳过 ' + r.skipped + ' 天已有记录'; }
      if (r.hol) { msg += '，节假日 ' + r.hol + ' 天不填'; }
      wx.showToast({ title: msg, icon: 'none' });
      that.showUndo('已按课程表填入 ' + r.filled + ' 天课时');
    };
    if (p.checked) {
      wx.showModal({
        title: '本月已标记核对', content: '仍然要按课程表填充课时吗？', confirmText: '继续',
        success: function (res) { if (res.confirm) { go(); } }
      });
      return;
    }
    go();
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
    store.save(db);
    this.render();
    this.showUndo('已恢复默认出勤 ' + cnt + ' 天');
  },

  clearMonth: function () {
    var that = this, db = this.db, ym = this.data.ym;
    wx.showModal({
      title: '清空 ' + ym,
      content: '清空后出勤 0 天、课时 0 节、应发 ¥0，默认出勤也一并清掉。5 秒内可撤销。',
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
        store.save(db);
        that.render();
        that.showUndo('已清空 ' + ym);
      }
    });
  },

  _beginUndo: function () {
    var db = this.db, ym = this.data.ym;
    var y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10);
    var n = core.daysInMonth(ym), snap = {};
    for (var d = 1; d <= n; d++) {
      var k = core.dk(y, m, d);
      snap[k] = db.days[k] ? JSON.parse(JSON.stringify(db.days[k])) : null;
    }
    this._undo = { msg: ym, snap: snap };
  },

  showUndo: function (label) {
    var that = this;
    if (this._undoTimer) { clearTimeout(this._undoTimer); }
    this.setData({ undo: { label: label } });
    this._undoTimer = setTimeout(function () {
      that._undo = null;
      that.setData({ undo: null });
    }, 5000);
  },

  hideUndo: function () {
    if (this._undoTimer) { clearTimeout(this._undoTimer); this._undoTimer = null; }
    this._undo = null;
    this.setData({ undo: null });
  },

  doUndo: function () {
    if (!this._undo) { return; }
    var snap = this._undo.snap;
    Object.keys(snap).forEach(function (k) {
      if (snap[k] === null) { delete this.db.days[k]; }
      else { this.db.days[k] = snap[k]; }
    }, this);
    store.save(this.db);
    this._undo = null;
    if (this._undoTimer) { clearTimeout(this._undoTimer); }
    this.setData({ undo: null });
    this.render();
    wx.showToast({ title: '已撤销', icon: 'none' });
  },

  noop: function () {}
});
