var lock = require('../../utils/lock.js');

var TRIES_KEY = 'kqzb_lock_tries';
var UNTIL_KEY = 'kqzb_lock_until';

Page({
  data: {
    pass: '',
    err: '',
    busy: false,
    waitLeft: 0,
    hasPass: false
  },

  onLoad: function () {
    if (!lock.isOn()) {
      wx.reLaunch({ url: '/pages/calendar/calendar' });
      return;
    }
    this.setData({ hasPass: true });
    this._tries = parseInt(wx.getStorageSync(TRIES_KEY), 10) || 0;
    this._blockUntil = parseInt(wx.getStorageSync(UNTIL_KEY), 10) || 0;
    this.tickWait();
  },

  onUnload: function () {
    if (this._timer) { clearInterval(this._timer); }
  },

  tickWait: function () {
    var that = this;
    var upd = function () {
      var left = Math.max(0, Math.ceil((that._blockUntil - Date.now()) / 1000));
      that.setData({ waitLeft: left });
      if (!left && that._timer) { clearInterval(that._timer); that._timer = null; }
    };
    upd();
    if (this.data.waitLeft > 0 && !this._timer) { this._timer = setInterval(upd, 500); }
  },

  onInput: function (e) {
    this.setData({ pass: e.detail.value || '', err: '' });
  },

  submit: function () {
    var that = this;
    if (this.data.busy) { return; }
    var pass = this.data.pass || '';
    if (pass.length < 4) { this.setData({ err: '口令至少 4 位' }); return; }
    if (Date.now() < this._blockUntil) {
      this.setData({ err: '错太多次了，等 ' + Math.ceil((this._blockUntil - Date.now()) / 1000) + ' 秒再试' });
      return;
    }
    /* 派生两万次要两三百毫秒，先让「验证中」画出来再算 */
    this.setData({ busy: true, err: '' });
    setTimeout(function () {
      var ok = false;
      try { ok = lock.unlock(pass); } catch (e) { ok = false; }
      if (ok) {
        try {
          wx.removeStorageSync(TRIES_KEY);
          wx.removeStorageSync(UNTIL_KEY);
        } catch (e) { /* 忽略 */ }
        that.setData({ busy: false, pass: '' });
        wx.reLaunch({ url: '/pages/calendar/calendar' });
        return;
      }
      that._tries++;
      var msg;
      if (that._tries >= 5) {
        that._blockUntil = Date.now() + 30000;
        that._tries = 0;
        msg = '连续错 5 次，等 30 秒再试';
      } else {
        msg = '口令不对，还能试 ' + (5 - that._tries) + ' 次';
      }
      try {
        wx.setStorageSync(TRIES_KEY, that._tries);
        wx.setStorageSync(UNTIL_KEY, that._blockUntil);
      } catch (e) { /* 忽略 */ }
      that.setData({ busy: false, err: msg, pass: '' });
      that.tickWait();
    }, 30);
  },

  /* 忘记口令只剩一条路：清空本机重新开始。记录本身没加密，清掉就没了，所以必须二次确认 */
  forgot: function () {
    var that = this;
    wx.showModal({
      title: '忘记口令',
      content: '口令只存在本机，无法找回。只能清空本机记录重新开始（之前导出的备份文件仍可再导入）。确定清空吗？',
      confirmText: '清空重来',
      confirmColor: '#A33A28',
      success: function (res) {
        if (!res.confirm) { return; }
        wx.showModal({
          title: '再确认一次',
          content: '清空后本机的出勤、课时、课程表和工资参数全部消失，且不能撤销。',
          confirmText: '确定清空',
          confirmColor: '#A33A28',
          success: function (m) {
            if (!m.confirm) { return; }
            try { wx.removeStorageSync('kqzb_db_v1'); } catch (e) { /* 忽略 */ }
            lock.clear();
            try {
              wx.removeStorageSync(TRIES_KEY);
              wx.removeStorageSync(UNTIL_KEY);
            } catch (e) { /* 忽略 */ }
            wx.reLaunch({ url: '/pages/calendar/calendar' });
          }
        });
      }
    });
  }
});
