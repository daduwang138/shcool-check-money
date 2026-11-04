/* 口令输入页
   设置页的「设置/修改/关闭口令」都跳到这里：showModal 的 editable 是明文输入，
   旁边人一眼看到、输入法还会记词；单独一页能用 password 输入框，也能把两次输入放在同一屏。 */
var lock = require('../../utils/lock.js');

var TEXT = {
  set: {
    title: '设置口令',
    hint: '打开小程序要先输口令。口令至少 4 位，只存校验值不存原文。',
    btn: '开启'
  },
  change: {
    title: '修改口令',
    hint: '先验证当前口令，再设新的。',
    btn: '保存'
  },
  off: {
    title: '关闭口令',
    hint: '关闭后，拿到手机的人可以直接看到记录。',
    btn: '关闭'
  }
};

Page({
  data: {
    mode: 'set',
    title: '',
    hint: '',
    btn: '',
    cur: '',
    next: '',
    again: '',
    err: '',
    busy: false
  },

  onLoad: function (q) {
    var mode = (q && q.mode) || 'set';
    if (mode !== 'set' && !lock.isOn()) {
      /* 已经没口令了：修改/关闭都无从谈起，直接退回去 */
      if (mode === 'off') { wx.navigateBack(); return; }
      mode = 'set';
    }
    var t = TEXT[mode] || TEXT.set;
    this.setData({ mode: mode, title: t.title, hint: t.hint, btn: t.btn });
    wx.setNavigationBarTitle({ title: t.title });
  },

  onShow: function () {
    /* 停在这一页时被切到后台、回来又已经上锁，就别让它继续亮着 */
    if (!lock.guard()) { return; }
  },

  onInput: function (e) {
    var f = e.currentTarget.dataset.f;
    if (!f) { return; }
    var patch = { err: '' };
    patch[f] = e.detail.value || '';
    this.setData(patch);
  },

  back: function () {
    wx.navigateBack();
  },

  submit: function () {
    if (this.data.busy) { return; }
    var m = this.data.mode;
    var cur = this.data.cur || '', next = this.data.next || '', again = this.data.again || '';
    var that = this;

    /* 先做不需要算派生值的检查，别让人白等两百毫秒 */
    if (m === 'off') {
      if (!cur) { this.setData({ err: '请输入当前口令' }); return; }
    } else {
      if (m === 'change' && !cur) { this.setData({ err: '请输入当前口令' }); return; }
      if (next.length < 4) { this.setData({ err: '新口令至少 4 位' }); return; }
      if (next !== again) { this.setData({ err: '两次输入不一致' }); return; }
    }

    this.setData({ busy: true, err: '' });
    /* PBKDF2 要跑两百毫秒，先让「处理中」画出来 */
    setTimeout(function () {
      if (m === 'off' || m === 'change') {
        if (!lock.check(cur)) {
          that.setData({ busy: false, err: '当前口令不对', cur: '' });
          return;
        }
      }
      if (m === 'off') {
        lock.clear();
        that.setData({ busy: false });
        wx.showToast({ title: '已关闭口令', icon: 'none' });
        wx.navigateBack();
        return;
      }
      if (!lock.setPass(next)) {
        that.setData({ busy: false, err: '保存失败，本机存储可能不可写' });
        return;
      }
      that.setData({ busy: false });
      wx.showToast({ title: m === 'change' ? '口令已更新' : '已开启，下次打开要输口令', icon: 'none' });
      wx.navigateBack();
    }, 30);
  }
});
