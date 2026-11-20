var lock = require('./utils/lock.js');

App({
  globalData: {
    appName: '考勤记账本-个人版',
    version: '1.1.8'
  },
  onLaunch: function () {
    var first = wx.getStorageSync('kqzb_first_open');
    if (!first) {
      wx.setStorageSync('kqzb_first_open', Date.now());
    }
  },

  /* 切到后台超过 5 分钟，回来要求重新输口令；不然「打开过就一直开着」等于没锁 */
  onHide: function () {
    this._hideAt = Date.now();
  },
  onShow: function () {
    if (this._hideAt && lock.isOn() && Date.now() - this._hideAt > 5 * 60 * 1000) {
      lock.lockNow();
    }
    this._hideAt = 0;
  }
});
