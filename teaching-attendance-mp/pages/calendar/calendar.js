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

  onUnload: function () {
    if (this._undoTimer) { clearTimeout(this._undoTimer); }
  },

  render: function () {
    var db = this.db, ym = this.data.ym;
    var y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10);
    var lead = (core.firstWeekdayOf(ym) + 6) % 7;
    var n = core.daysInMonth(ym);
    var today = core.todayKey();
    var cells = [];
    var i, d;

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
        id: k, key: k, blank: false, d: d, cls: cls,
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

  prevMonth: function () { this.setData({ ym: core.addMonths(this.data.ym, -1), sheet: null }); this.render(); },
  nextMonth: function () { this.setData({ ym: core.addMonths(this.data.ym, 1), sheet: null }); this.render(); },
  goToday: function () { this.setData({ ym: core.todayKey().slice(0, 7) }); this.render(); },
  pickMonth: function (e) {
    var v = e.detail.value;
    if (!core.isYm(v)) { return; }
    this.setData({ ym: v });
    this.render();
  },

  tapCell: function (e) {
    var k = e.currentTarget.dataset.key;
    if (!k) { return; }
    if (core.preStart(this.db, k)) {
      wx.showToast({ title: '这天在入职起算日之前，不计出勤', icon: 'none' });
      return;
    }
    this.openSheet(k);
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
