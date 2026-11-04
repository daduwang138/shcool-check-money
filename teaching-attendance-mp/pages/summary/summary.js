var core = require('../../utils/core.js');
var store = require('../../utils/store.js');

Page({
  data: {
    ym: '',
    monLabel: '',
    total: '0.00',
    rows: [],
    halfRows: [],
    p: { workdays: '', base: '', rate: '' },
    checked: false,
    dayCount: 0,
    hasRecord: false
  },

  onLoad: function () {
    var ym = core.todayKey().slice(0, 7);
    this.db = store.load();
    this.setData({ ym: ym });
    this.render();
  },

  onShow: function () {
    this.db = store.load();
    this.render();
  },

  render: function () {
    var db = this.db, ym = this.data.ym;
    var c = core.computeMonth(db, ym);
    var p = core.monthP(db, ym);
    var y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10);

    var rows = [
      { k: '法定工作日', v: c.workdays + ' 天', strong: false },
      { k: '实际出勤', v: core.fmtShort(c.actual) + ' 天', strong: false },
      { k: '折算日薪', v: '¥' + core.fmt(c.dailyRate), strong: false },
      { k: '基本工资部分', v: '¥' + core.fmt(c.basePart), strong: false },
      { k: '超出天数部分', v: '¥' + core.fmt(c.extraPart), strong: false },
      { k: '课时费', v: '¥' + core.fmt(c.lessonFee), strong: false },
      { k: '课时合计', v: c.lessons + ' 节', strong: false }
    ];

    var halfRows = [
      { k: '上班', v: c.counted.work, cls: 's-work' },
      { k: '监考', v: c.counted.inv, cls: 's-inv' },
      { k: '加班', v: c.counted.ot, cls: 's-ot' },
      { k: '请假', v: c.counted.leave, cls: 's-leave' }
    ];

    this.setData({
      monLabel: y + ' 年 ' + m + ' 月',
      total: core.fmt(c.total),
      rows: rows,
      heroSubs: rows.slice(0, 3),
      halfRows: halfRows,
      p: { workdays: String(p.workdays), base: String(p.base || 0), rate: String(p.rate || 0) },
      checked: c.checked,
      dayCount: c.filledDays,
      hasRecord: c.filledDays > 0
    });
  },

  prevMonth: function () { this.setData({ ym: core.addMonths(this.data.ym, -1) }); this.render(); },
  nextMonth: function () { this.setData({ ym: core.addMonths(this.data.ym, 1) }); this.render(); },
  pickMonth: function (e) {
    if (!core.isYm(e.detail.value)) { return; }
    this.setData({ ym: e.detail.value });
    this.render();
  },

  setWorkdays: function (e) {
    var v = parseInt(e.detail.value, 10);
    if (isNaN(v) || v < 0 || v > 31) { this.render(); return; }
    var p = core.monthP(this.db, this.data.ym);
    p.workdays = v;
    store.save(this.db);
    this.render();
  },

  setBase: function (e) {
    var v = parseFloat(e.detail.value);
    if (isNaN(v) || v < 0) { this.render(); return; }
    var p = core.monthP(this.db, this.data.ym);
    p.base = v;
    store.save(this.db);
    this.render();
  },

  setRate: function (e) {
    var v = parseFloat(e.detail.value);
    if (isNaN(v) || v < 0) { this.render(); return; }
    var p = core.monthP(this.db, this.data.ym);
    p.rate = v;
    store.save(this.db);
    this.render();
  },

  toggleChecked: function (e) {
    var p = core.monthP(this.db, this.data.ym);
    p.checked = !!e.detail.value;
    store.save(this.db);
    this.render();
    wx.showToast({ title: p.checked ? '本月已标记核对' : '已取消核对标记', icon: 'none' });
  },

  resetParams: function () {
    var p = core.monthP(this.db, this.data.ym);
    delete p.workdays;
    delete p.base;
    delete p.rate;
    var q = core.monthP(this.db, this.data.ym);
    store.save(this.db);
    this.render();
    wx.showToast({ title: '已回到默认参数（应上班 ' + q.workdays + ' 天）', icon: 'none' });
  },

  exportMonth: function () {
    var that = this, ym = this.data.ym;
    /* 核对过的月份，导出前再确认一次口径 */
    store.exportCsv(this.db, [ym], true, true).then(function (msg) {
      wx.showToast({ title: msg, icon: 'none' });
    }).catch(function (err) {
      wx.showToast({ title: (err && err.message) || '导出失败', icon: 'none' });
    });
  },

  exportAll: function () {
    var db = this.db;
    var keys = core.monthKeysOf(db);
    if (!keys.length) {
      wx.showToast({ title: '还没有任何记录', icon: 'none' });
      return;
    }
    var months = core.monthsBetween(keys[0], keys[keys.length - 1]);
    /* 中间没记录的月份不必导出，只保留首尾之间的有记录月份，避免空行 */
    months = months.filter(function (ym) { return keys.indexOf(ym) >= 0; });
    store.exportCsv(db, months, true, true).then(function (msg) {
      wx.showToast({ title: msg, icon: 'none' });
    }).catch(function (err) {
      wx.showToast({ title: (err && err.message) || '导出失败', icon: 'none' });
    });
  }
});
