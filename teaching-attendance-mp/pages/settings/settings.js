var core = require('../../utils/core.js');
var store = require('../../utils/store.js');
var lock = require('../../utils/lock.js');

var WEEK_LABEL = ['日', '一', '二', '三', '四', '五', '六'];

function patText(v) {
  if (v >= 1) { return '班'; }
  if (v === 0.5) { return '半'; }
  return '休';
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
    lockOn: false
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
      lockOn: lock.isOn()
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
  /* 小程序没有 prompt，用 showModal 的 editable（基础库 2.17+）收口令 */
  _ask: function (title, placeholder, cb) {
    wx.showModal({
      title: title,
      editable: true,
      placeholderText: placeholder,
      confirmText: '确定',
      success: function (res) {
        if (!res.confirm) { cb(null); return; }
        if (res.content === undefined) {
          wx.showToast({ title: '微信版本太旧，无法输入口令', icon: 'none' });
          cb(null);
          return;
        }
        cb(String(res.content || '').trim());
      },
      fail: function () { cb(null); }
    });
  },

  toggleLock: function (e) {
    var that = this;
    var want = !!(e.detail && e.detail.value);
    if (want === this.data.lockOn) { return; }
    if (!want) {
      this._ask('关闭口令', '输入当前口令', function (p) {
        if (p === null) { that.render(); return; }
        if (!lock.check(p)) { wx.showToast({ title: '口令不对', icon: 'none' }); that.render(); return; }
        lock.clear();
        that.render();
        wx.showToast({ title: '已关闭口令', icon: 'none' });
      });
      return;
    }
    this._ask('设置口令', '至少 4 位', function (p1) {
      if (p1 === null) { that.render(); return; }
      if (p1.length < 4) { wx.showToast({ title: '口令至少 4 位', icon: 'none' }); that.render(); return; }
      that._ask('再输一次', '确认口令', function (p2) {
        if (p2 === null) { that.render(); return; }
        if (p1 !== p2) { wx.showToast({ title: '两次输入不一致', icon: 'none' }); that.render(); return; }
        if (!lock.setPass(p1)) { wx.showToast({ title: '保存失败', icon: 'none' }); that.render(); return; }
        that.render();
        wx.showToast({ title: '已开启，下次打开要输口令', icon: 'none' });
      });
    });
  },

  changePass: function () {
    var that = this;
    this._ask('验证当前口令', '输入现在的口令', function (p0) {
      if (p0 === null) { return; }
      if (!lock.check(p0)) { wx.showToast({ title: '口令不对', icon: 'none' }); return; }
      that._ask('设置新口令', '至少 4 位', function (p1) {
        if (p1 === null) { return; }
        if (p1.length < 4) { wx.showToast({ title: '口令至少 4 位', icon: 'none' }); return; }
        that._ask('再输一次', '确认新口令', function (p2) {
          if (p2 === null) { return; }
          if (p1 !== p2) { wx.showToast({ title: '两次输入不一致', icon: 'none' }); return; }
          lock.setPass(p1);
          that.render();
          wx.showToast({ title: '口令已更新', icon: 'none' });
        });
      });
    });
  },

  gotoCourses: function () {
    wx.navigateTo({ url: '/pages/courses/courses' });
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
