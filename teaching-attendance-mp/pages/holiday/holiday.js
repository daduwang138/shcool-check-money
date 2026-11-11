var core = require('../../utils/core.js');
var store = require('../../utils/store.js');
var lock = require('../../utils/lock.js');

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function ymOfYear(y, m) { return y + '-' + pad(m); }

/* '2027-02-06' → '2/6'，picker 里要短 */
function short(k) {
  var p = core.ymd(k);
  return p[1] + '/' + p[2];
}

/* 列表里要看得懂：单日带星期，跨日带天数 */
function spanText(from, to) {
  var a = core.ymd(from), b = core.ymd(to);
  var head = a[1] + ' 月 ' + a[2] + ' 日';
  if (from === to) { return head + '（周' + core.dowLabel(from) + '）'; }
  var days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;
  return head + ' – ' + b[1] + ' 月 ' + b[2] + ' 日 · ' + days + ' 天';
}

Page({
  data: {
    y: 0,
    yMin: '', yMax: '',
    off: [],
    work: [],
    from: '', to: '', one: '',
    fromText: '', toText: '', oneText: '',
    /* 三个 picker 的 value 必须是个具体日期（就填这年 1 月 1 日），但「填了什么」和
       「打开时显示什么」不是一回事：没选之前显示「月/日」，不然框里那个 1/1 看着像已经填好了 */
    fromSet: false, toSet: false, oneSet: false,
    builtin: '', custom: false, touched: '',
    showPaste: false, pasteText: '',
    ready: false
  },

  onLoad: function () {
    var y = new Date().getFullYear();
    this.db = store.load();
    this.setYear(y);
  },

  onShow: function () {
    if (!lock.guard()) { return; }
    this.db = store.load();
    this.render();
  },

  setYear: function (y) {
    this.setData({
      y: y,
      yMin: y + '-01-01', yMax: y + '-12-31',
      from: y + '-01-01', to: y + '-01-01', one: y + '-01-01',
      fromText: '月/日', toText: '月/日', oneText: '月/日',
      fromSet: false, toSet: false, oneSet: false
    });
    this.render();
  },

  render: function () {
    var db = this.db, y = this.data.y, that = this;
    var e = core.holidayOf(db, y);

    var off = e.off.map(function (s, i) {
      return { i: i, text: spanText(s[0], s[1]) };
    });
    var work = e.work.map(function (s, i) {
      return { i: i, text: spanText(s[0], s[1]) };
    });

    /* 内置表里有这年就说清楚，没有就说明现在是按周一到周五估的 */
    var t = core.HOLIDAYS[y];
    var builtin = t
      ? '内置国办发安排：' + t.note
      : y + ' 年的国办发安排还没内置，没填的日子里按周一到周五算上班';

    /* 已经记过账的月份，应上班天数被固定了，改假期不会回头重算 */
    var touched = [];
    for (var m = 1; m <= 12; m++) {
      if (core.monthTouched(db, ymOfYear(y, m))) { touched.push(m); }
    }

    this.setData({
      off: off,
      work: work,
      custom: off.length + work.length > 0,
      builtin: builtin,
      touched: touched.length ? (touched.join('、') + ' 月已经记过账；改这里会按新假期重算自动算出的应上班天数，汇总页手填过的「法定工作日」保持不变') : '',
      ready: true
    });
  },

  prevYear: function () { this.setYear(this.data.y - 1); },
  nextYear: function () { this.setYear(this.data.y + 1); },

  pickFrom: function (e) {
    var v = e.detail.value;
    var patch = { from: v, fromText: short(v), fromSet: true };
    if (this.data.to < v) { patch.to = v; patch.toText = short(v); patch.toSet = true; }
    this.setData(patch);
  },
  pickTo: function (e) {
    var v = e.detail.value;
    if (v < this.data.from) {
      wx.showToast({ title: '结束日期不能早于开始', icon: 'none' });
      return;
    }
    this.setData({ to: v, toText: short(v), toSet: true });
  },
  pickOne: function (e) {
    var v = e.detail.value;
    this.setData({ one: v, oneText: short(v), oneSet: true });
  },

  addOff: function () {
    var f = this.data.from, t = this.data.to, y = this.data.y;
    if (!this.data.fromSet) {
      wx.showToast({ title: '先选起止日期', icon: 'none' });
      return;
    }
    if (!this._sameYear(f, y) || !this._sameYear(t, y)) {
      wx.showToast({ title: '跨年的假期请分两次填', icon: 'none' });
      return;
    }
    core.refreshWorkdays(this.db, y);
    core.addHolidaySpan(this.db, y, 'off', f, t);
    store.save(this.db);
    this.render();
    wx.showToast({ title: '已加入', icon: 'none' });
  },

  addWork: function () {
    var k = this.data.one, y = this.data.y;
    if (!this.data.oneSet) {
      wx.showToast({ title: '先选日期', icon: 'none' });
      return;
    }
    if (!this._sameYear(k, y)) {
      wx.showToast({ title: '日期要在 ' + y + ' 年内', icon: 'none' });
      return;
    }
    core.refreshWorkdays(this.db, y);
    core.addHolidaySpan(this.db, y, 'work', k, k);
    store.save(this.db);
    this.render();
    wx.showToast({ title: '已加入', icon: 'none' });
  },

  _sameYear: function (k, y) {
    return core.ymd(k)[0] === y;
  },

  delOff: function (e) {
    var i = parseInt(e.currentTarget.dataset.i, 10);
    core.refreshWorkdays(this.db, this.data.y);
    core.delHolidaySpan(this.db, this.data.y, 'off', i);
    store.save(this.db);
    this.render();
  },

  delWork: function (e) {
    var i = parseInt(e.currentTarget.dataset.i, 10);
    core.refreshWorkdays(this.db, this.data.y);
    core.delHolidaySpan(this.db, this.data.y, 'work', i);
    store.save(this.db);
    this.render();
  },

  /* 小程序不能自己联网：request 合法域名必须是备案过的，公共数据源没备案，
     配不进去。所以自动获取放在电脑版，这边负责把结果接住。 */
  openPaste: function () {
    this.setData({ showPaste: true, pasteText: '' });
  },
  closePaste: function () {
    this.setData({ showPaste: false, pasteText: '' });
  },
  onPaste: function (e) {
    this.setData({ pasteText: e.detail.value });
  },
  doPaste: function () {
    var that = this;
    var txt = String(this.data.pasteText || '').trim();
    if (!txt) {
      wx.showToast({ title: '先粘贴内容', icon: 'none' });
      return;
    }
    /* 不限定年份：粘的是哪一年就导入哪一年，省得先切过去 */
    var r = core.parseHolidayPacket(txt, 0);
    if (!r.ok) {
      wx.showModal({ title: '这份内容用不了', content: r.err, showCancel: false, confirmText: '知道了' });
      return;
    }
    var y = r.year;
    wx.showModal({
      title: '导入 ' + y + ' 年',
      content: '休 ' + r.off.length + ' 段、补班 ' + r.work.length + ' 天'
        + (r.skipped ? '，另有 ' + r.skipped + ' 条格式不对会忽略' : '')
        + '。会覆盖 ' + y + ' 年现在填的内容。',
      confirmText: '覆盖导入',
      success: function (res) {
        if (!res.confirm) { return; }
        if (!that.db.settings.holidays) { that.db.settings.holidays = {}; }
        core.refreshWorkdays(that.db, y);
        that.db.settings.holidays[y] = { off: r.off, work: r.work };
        store.save(that.db);
        that.setData({ showPaste: false, pasteText: '' });
        if (that.data.y !== y) { that.setYear(y); } else { that.render(); }
        wx.showToast({ title: '已导入', icon: 'none' });
      }
    });
  },

  clearYear: function () {
    var that = this, y = this.data.y;
    wx.showModal({
      title: '清空 ' + y + ' 年',
      content: '会删掉你自己填的全部休假与补班日，内置的国办发安排不受影响。',
      confirmText: '清空',
      confirmColor: '#A33A28',
      success: function (res) {
        if (!res.confirm) { return; }
        core.refreshWorkdays(that.db, y);
        core.clearHolidayYear(that.db, y);
        store.save(that.db);
        that.render();
        wx.showToast({ title: '已清空', icon: 'none' });
      }
    });
  },

  /* 右上角「转发」：发给同事各自记账 */
  onShareAppMessage: function () {
    return {
      title: '考勤记账本-个人版：出勤和课时分开记，工资自动算',
      path: 'pages/calendar/calendar'
    };
  }
});
