var core = require('../../utils/core.js');
var store = require('../../utils/store.js');
var lock = require('../../utils/lock.js');

var WEEK_LABEL = ['日', '一', '二', '三', '四', '五', '六'];

function patText(v) {
  if (v >= 1) { return '班'; }
  if (v === 0.5) { return '半'; }
  return '休';
}

/* 设置页那一行的小字：说清哪些年内置了、哪些是自己补的 */
function holidayText(db) {
  var mine = core.holidayYears(db);
  var builtin = Object.keys(core.HOLIDAYS).map(function (y) { return parseInt(y, 10); }).sort();
  if (mine.length) {
    return '自己补了 ' + mine.join('、') + ' 年' + (builtin.length ? '；内置 ' + builtin.join('、') + ' 年' : '');
  }
  if (builtin.length) {
    return '内置 ' + builtin.join('、') + ' 年，其他年份按周一到周五估';
  }
  return '按周一到周五估，可以自己补';
}

Page({
  data: {
    owner: '',
    baseSalary: '',
    rate: '',
    enableBase: true,
    enableLesson: true,
    enableInv: true,
    enableOt: true,
    autoWork: true,
    weekPattern: [],
    startDate: '',
    startDateText: '未设置',
    termStart: '',
    courseCount: 0,
    dayCount: 0,
    isPC: false,
    lockOn: false,
    holidayText: ''
  },

  onLoad: function () {
    this.db = store.load();
    this.render();
  },

  onShow: function () {
    if (!lock.guard()) { return; }
    this.db = store.load();
    this.render();
  },

  render: function () {
    var db = this.db, s = db.settings;
    var week = [];
    for (var i = 0; i < 7; i++) {
      var v = s.weekPattern[i];
      week.push({ i: i, label: WEEK_LABEL[i], txt: patText(v), on: v >= 1, half: v === 0.5 });
    }
    this.setData({
      owner: s.owner || '',
      baseSalary: String(s.baseSalary || 0),
      rate: String(s.rate || 0),
      enableBase: !!s.enableBase,
      enableLesson: !!s.enableLesson,
      enableInv: !!s.enableInv,
      enableOt: !!s.enableOt,
      autoWork: !!s.autoWork,
      weekPattern: week,
      startDate: s.startDate || '',
      startDateText: s.startDate ? s.startDate.replace(/-/g, ' / ') : '未设置（从第 1 条记录算起）',
      termStart: db.term.start || '未设置',
      courseCount: db.courses.length,
      dayCount: core.dayCount(db),
      isPC: store.isPC(),
      lockOn: lock.isOn(),
      holidayText: holidayText(db)
    });
  },

  setOwner: function (e) {
    this.db.settings.owner = e.detail.value || '';
    store.save(this.db);
  },

  setSalary: function (e) {
    var v = parseFloat(e.detail.value);
    if (isNaN(v) || v < 0) { this.render(); return; }
    this.db.settings.baseSalary = v;
    store.save(this.db);
    this.render();
  },

  setRate: function (e) {
    var v = parseFloat(e.detail.value);
    if (isNaN(v) || v < 0) { this.render(); return; }
    this.db.settings.rate = v;
    store.save(this.db);
    this.render();
  },

  toggle: function (e) {
    var key = e.currentTarget.dataset.key;
    this.db.settings[key] = !!e.detail.value;
    store.save(this.db);
    this.render();
  },

  cycleWeek: function (e) {
    var i = parseInt(e.currentTarget.dataset.i, 10);
    var cur = this.db.settings.weekPattern[i];
    var next = cur >= 1 ? 0.5 : (cur === 0.5 ? 0 : 1);
    this.db.settings.weekPattern[i] = next;
    store.save(this.db);
    this.render();
  },

  pickStart: function (e) {
    this.db.settings.startDate = e.detail.value || '';
    store.save(this.db);
    this.render();
    wx.showToast({ title: this.db.settings.startDate ? '已设为 ' + this.db.settings.startDate : '已清除', icon: 'none' });
  },

  clearStart: function () {
    this.db.settings.startDate = '';
    store.save(this.db);
    this.render();
  },

  /* ---------- 口令锁 ---------- */
  /* 输入口令走独立页面（pages/pass），不用 showModal：弹窗里的 editable 是明文，
     旁边人一眼看到、输入法还会记词；密码页能用 password 框，两次输入也能放在同一屏。 */
  gotoCourses: function () {
    wx.navigateTo({ url: '/pages/courses/courses' });
  },

  gotoHoliday: function () {
    wx.navigateTo({ url: '/pages/holiday/holiday' });
  },

  openPass: function (mode) {
    wx.navigateTo({ url: '/pages/pass/pass?mode=' + mode });
  },

  /* 原生 switch 只在绑定值变化时才重绘：用户拨了一下、数据却还是原值，它会停在新位置。
     先写一个相反值把差异造出来，下一帧再写回真实值，开关就弹回去了。 */
  _resetSwitch: function () {
    var that = this;
    var real = lock.isOn();
    this.setData({ lockOn: !real });
    var back = function () { that.setData({ lockOn: real }); };
    if (typeof wx.nextTick === 'function') { wx.nextTick(back); } else { setTimeout(back, 0); }
  },

  toggleLock: function (e) {
    var want = !!(e.detail && e.detail.value);
    if (want === this.data.lockOn) { return; }
    /* 真正的状态等密码页回来由 onShow 重读，这里先把开关摆回原样 */
    this._resetSwitch();
    this.openPass(want ? 'set' : 'off');
  },

  changePass: function () {
    this.openPass('change');
  },

  exportBackup: function () {
    store.exportBackup(this.db).then(function (msg) {
      wx.showToast({ title: msg, icon: 'none' });
    }).catch(function (err) {
      wx.showToast({ title: (err && err.message) || '导出失败', icon: 'none' });
    });
  },

  importBackup: function () {
    var that = this;
    store.readFromChat().then(function (file) {
      var incoming = store.parseBackup(file.text);
      var n = core.dayCount(incoming);
      wx.showActionSheet({
        alertText: file.name + '（' + n + ' 天记录）',
        itemList: ['合并到本机（逐日取较新）', '用文件覆盖本机'],
        success: function (res) {
          if (res.tapIndex === 0) {
            var r = store.mergeInto(that.db, incoming);
            store.save(that.db);
            that.render();
            wx.showToast({ title: '已合并：新增 ' + r.added + ' 天，更新 ' + r.updated + ' 天', icon: 'none' });
          } else if (res.tapIndex === 1) {
            wx.showModal({
              title: '确认覆盖',
              content: '本机现有的记录会被文件里这 ' + n + ' 天替换，工资参数也一并换成文件里的。确定吗？',
              confirmText: '覆盖',
              confirmColor: '#A33A28',
              success: function (m) {
                if (!m.confirm) { return; }
                that.db = incoming;
                store.save(that.db);
                that.render();
                wx.showToast({ title: '已覆盖，当前 ' + n + ' 天', icon: 'none' });
              }
            });
          }
        }
      });
    }).catch(function (err) {
      var msg = (err && err.message) || '没有读取到文件';
      wx.showToast({ title: msg, icon: 'none' });
    });
  },

  clearAll: function () {
    var that = this;
    wx.showModal({
      title: '清空全部数据',
      content: '这会删掉本机所有记录、课程表和参数，且无法撤销。建议先导出备份。',
      confirmText: '仍要清空',
      confirmColor: '#A33A28',
      success: function (res) {
        if (!res.confirm) { return; }
        store.reset();
        that.db = store.load();
        that.render();
        wx.showToast({ title: '已清空', icon: 'none' });
      }
    });
  }
});
