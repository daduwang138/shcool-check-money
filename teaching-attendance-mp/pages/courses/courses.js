var core = require('../../utils/core.js');
var store = require('../../utils/store.js');

var WEEKDAY = ['', '一', '二', '三', '四', '五', '六', '日'];
var PARITY = { all: '每周', odd: '单周', even: '双周' };

Page({
  data: {
    termStart: '',
    termStartText: '未设置',
    courses: [],
    preview: '',
    editing: null,
    weekdayOpts: [1, 2, 3, 4, 5, 6, 7],
    parityOpts: [
      { v: 'all', label: '每周' },
      { v: 'odd', label: '单周' },
      { v: 'even', label: '双周' }
    ]
  },

  onLoad: function () {
    this.db = store.load();
    this.render();
  },

  onShow: function () {
    this.db = store.load();
    this.render();
  },

  render: function () {
    var db = this.db;
    var list = db.courses.map(function (c) {
      var parts = [];
      parts.push('周' + (WEEKDAY[c.weekday] || '?'));
      parts.push(c.lessons + ' 节');
      parts.push('第 ' + c.startWeek + '–' + c.endWeek + ' 周');
      if (c.parity !== 'all') { parts.push(PARITY[c.parity]); }
      return {
        id: c.id,
        name: c.name || '未命名课程',
        desc: parts.join(' · ')
      };
    });

    var ym = core.todayKey().slice(0, 7);
    var preview = '';
    if (!db.term.start) {
      preview = '先填第 1 教学周的周一，才能把周次换算成日期。';
    } else if (!db.courses.length) {
      preview = '还没有课程，点下面的「添加课程」。';
    } else {
      var y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10);
      var n = core.daysInMonth(ym), tot = 0, days = 0;
      for (var d = 1; d <= n; d++) {
        var v = core.lessonsFor(db, core.dk(y, m, d));
        if (v > 0) { tot += v; days++; }
      }
      preview = '按当前课程表，' + y + ' 年 ' + m + ' 月共 ' + tot + ' 节，分布在 ' + days + ' 天。';
    }

    this.setData({
      termStart: db.term.start || '',
      termStartText: db.term.start ? db.term.start.replace(/-/g, ' / ') : '未设置',
      courses: list,
      preview: preview
    });
  },

  pickTerm: function (e) {
    this.db.term.start = e.detail.value || '';
    store.save(this.db);
    this.render();
  },

  clearTerm: function () {
    this.db.term.start = '';
    store.save(this.db);
    this.render();
  },

  addCourse: function () {
    this._name = undefined;
    this.setData({
      editing: {
        id: '',
        title: '添加课程',
        name: '',
        weekday: 1,
        lessons: 2,
        startWeek: 1,
        endWeek: 16,
        parity: 'all'
      }
    });
  },

  editCourse: function (e) {
    var id = e.currentTarget.dataset.id;
    var c = null;
    for (var i = 0; i < this.db.courses.length; i++) {
      if (this.db.courses[i].id === id) { c = this.db.courses[i]; break; }
    }
    if (!c) { return; }
    this._name = undefined;
    this.setData({
      editing: {
        id: c.id,
        title: '编辑课程',
        name: c.name || '',
        weekday: c.weekday,
        lessons: c.lessons,
        startWeek: c.startWeek,
        endWeek: c.endWeek,
        parity: c.parity
      }
    });
  },

  closeEdit: function () {
    this.setData({ editing: null });
    this._name = undefined;
  },

  onName: function (e) {
    this._name = e.detail.value;
  },

  setWeekday: function (e) {
    this.setData({ 'editing.weekday': parseInt(e.currentTarget.dataset.v, 10) });
  },

  setParity: function (e) {
    this.setData({ 'editing.parity': e.currentTarget.dataset.v });
  },

  stepLessons: function (e) {
    var d = parseInt(e.currentTarget.dataset.d, 10);
    var v = (parseInt(this.data.editing.lessons, 10) || 0) + d;
    if (v < 0) { v = 0; }
    if (v > 12) { v = 12; }
    this.setData({ 'editing.lessons': v });
  },

  stepWeek: function (e) {
    var which = e.currentTarget.dataset.w;
    var d = parseInt(e.currentTarget.dataset.d, 10);
    var cur = parseInt(this.data.editing[which], 10) || 1;
    var v = cur + d;
    if (v < 1) { v = 1; }
    if (v > 30) { v = 30; }
    var patch = {};
    patch['editing.' + which] = v;
    /* 起始周不能晚于结束周，反之亦然 */
    if (which === 'startWeek' && v > this.data.editing.endWeek) { patch['editing.endWeek'] = v; }
    if (which === 'endWeek' && v < this.data.editing.startWeek) { patch['editing.startWeek'] = v; }
    this.setData(patch);
  },

  saveCourse: function () {
    var e = this.data.editing;
    if (!e) { return; }
    var name = (this._name === undefined ? e.name : this._name) || '';
    var db = this.db;
    if (e.id) {
      for (var i = 0; i < db.courses.length; i++) {
        if (db.courses[i].id === e.id) {
          db.courses[i] = {
            id: e.id, name: name, weekday: e.weekday, lessons: e.lessons,
            startWeek: e.startWeek, endWeek: e.endWeek, parity: e.parity
          };
          break;
        }
      }
    } else {
      db.courses.push({
        id: 'c' + Math.random().toString(36).slice(2, 8),
        name: name,
        weekday: e.weekday,
        lessons: e.lessons,
        startWeek: e.startWeek,
        endWeek: e.endWeek,
        parity: e.parity
      });
    }
    store.save(db);
    this.setData({ editing: null });
    this._name = undefined;
    this.render();
    wx.showToast({ title: '已保存', icon: 'none' });
  },

  deleteCourse: function () {
    var that = this;
    var e = this.data.editing;
    if (!e || !e.id) { return; }
    wx.showModal({
      title: '删除这门课',
      content: '删除后，这门课不再参与课时推算。已经填过课时的日子不受影响。',
      confirmText: '删除',
      confirmColor: '#A33A28',
      success: function (res) {
        if (!res.confirm) { return; }
        that.db.courses = that.db.courses.filter(function (c) { return c.id !== e.id; });
        store.save(that.db);
        that.setData({ editing: null });
        that.render();
        wx.showToast({ title: '已删除', icon: 'none' });
      }
    });
  },

  noop: function () {}
});
