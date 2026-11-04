App({
  globalData: {
    appName: '教学考勤记账本',
    version: '1.0.0'
  },
  onLaunch: function () {
    var first = wx.getStorageSync('kqzb_first_open');
    if (!first) {
      wx.setStorageSync('kqzb_first_open', Date.now());
    }
  }
});
