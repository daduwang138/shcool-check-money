var core = require('../../utils/core.js');
var store = require('../../utils/store.js');
var lock = require('../../utils/lock.js');

var WEEK_HEAD = ['一', '二', '三', '四', '五', '六', '日'];

function inRanges(key, ranges) {
  if (!ranges) { return false; }
  for (var i = 0; i < ranges.length; i++) {
    if (key >= ranges[i][0] && key <= ranges[i][1]) { return true; }
  }
  return false;
}

/* 一个月的总览数据。周序号用 ISO 周（和教学周 weekOf 不是一回事）：
   行首若是上个月的日子，那一行的周序号仍按该周本身算。 */
function buildMonth(year, month, db, today) {
  var ym = year + '-' + core.pad(month);
  var lead = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  var total = core.daysInMonth(ym);
  var rows = Math.ceil((lead + total) / 7);
  var firstWeek = core.isoWeek(core.dk(year, month, 1));
  var lastWeek = core.isoWeek(core.dk(year, month, total));
  var custom = (db.settings.holidays && db.settings.holidays[year]) || null;
  var builtin = core.HOLIDAYS[year] || null;
  var heads = WEEK_HEAD.map(function (text, idx) {
    return { t: text, cls: idx > 4 ? 'yw yw-we' : 'yw' };
  });
  var weeks = [], holCount = 0, mkCount = 0;

  for (var r = 0; r < rows; r++) {
    var start = 1 + r * 7 - lead, cells = [];
    for (var col = 0; col < 7; col++) {
      var d = start + col;
      if (d < 1 || d > total) {
        cells.push({ id: 'b' + r + '-' + col, d: '', cls: 'ycl-blank', mark: '' });
        continue;
      }
      var key = core.dk(year, month, d);
      var hol = core.isHoliday(key, db);
      var mk = !hol && !!(inRanges(key, custom && custom.work)
        || (builtin && builtin.makeup.indexOf(key) >= 0));
      var cls = 'ycl';
      if (hol) { cls += ' ycl-hol'; holCount++; }
      else if (mk) { cls += ' ycl-mk'; mkCount++; }
      else if (core.isWeekendKey(key)) { cls += ' ycl-we'; }
      if (key === today) { cls += ' ycl-today'; }
      cells.push({ id: key, d: String(d), cls: cls, mark: hol ? '休' : (mk ? '班' : '') });
    }
    var inRow = start > 0 ? start : 1;
    weeks.push({
      id: 'w' + r,
      num: String(core.isoWeek(core.dk(year, month, inRow))),
      cells: cells
    });
  }

  return {
    hol: holCount,
    mk: mkCount,
    month: {
      key: ym,
      ym: ym,
      label: month + ' 月',
      range: '第 ' + firstWeek + (lastWeek === firstWeek ? '' : '–' + lastWeek) + ' 周',
      heads: heads,
      weeks: weeks
    }
  };
}

Page({
  data: {
    year: 0,
    months: [],
    tip: ''
  },

  onLoad: function () {
    this.db = store.load();
    this.setData({ year: new Date().getFullYear() });
    if (!lock.guard()) { return; }
    this.render();
  },

  onShow: function () {
    if (!lock.guard()) { return; }
    this.db = store.load();
    this.render();
  },

  render: function () {
    var db = this.db, year = this.data.year, today = core.todayKey();
    var months = [], holN = 0, mkN = 0;
    for (var m = 1; m <= 12; m++) {
      var one = buildMonth(year, m, db, today);
      months.push(one.month);
      holN += one.hol;
      mkN += one.mk;
    }
    var tip = year + ' 年法定休假 ' + holN + ' 天 · 调休补班 ' + mkN + ' 天。';
    var custom = db.settings.holidays && db.settings.holidays[year];
    if (custom && ((custom.off && custom.off.length) || (custom.work && custom.work.length))) {
      tip += '放假安排按你填的算。';
    } else if (!core.HOLIDAYS[year]) {
      tip += '该年放假安排未内置，未填的日子按周一至周五估算；可在设置里补。';
    } else {
      tip += '点月份名可直接去那个月记账。';
    }
    this.setData({ months: months, tip: tip });
  },

  setYear: function (year) {
    this.setData({ year: year });
    this.render();
  },

  prevYear: function () { this.setYear(this.data.year - 1); },
  nextYear: function () { this.setYear(this.data.year + 1); },
  goThisYear: function () { this.setYear(new Date().getFullYear()); },

  openMonth: function (e) {
    var app = typeof getApp === "function" ? getApp() : null;
    if (!app) { return; }
    if (!app.globalData) { app.globalData = {}; }
    app.globalData.yearJump = e.currentTarget.dataset.ym;
    wx.switchTab({ url: '/pages/calendar/calendar' });
  },

  onShareAppMessage: function () {
    return { title: '考勤记账本-个人版 · 年历', path: 'pages/calendar/calendar' };
  }
});
