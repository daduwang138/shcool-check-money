var core = require('../../utils/core.js');
var store = require('../../utils/store.js');
var lock = require('../../utils/lock.js');

Page({
  data: {
    /* 默认月度：老用户进来看到的还是当月，年度要手动切 */
    mode: 'month',
    /* 年度四标签：应发是总览层，其余三个是它的构成下钻 */
    yearTab: 'pay',
    yearTabs: [
      { k: 'pay', t: '应发·总览' }, { k: 'att', t: '出勤' },
      { k: 'les', t: '课时' }, { k: 'nig', t: '晚修' }
    ],
    year: 0,
    yearLabel: '',
    ym: '',
    monLabel: '',
    total: '0.00',
    rows: [],
    heroSubs: [],
    halfRows: [],
    p: { workdays: '', base: '', rate: '' },
    enableBase: true,
    enableLesson: true,
    otherRates: '',
    nightEach: '',
    checked: false,
    dayCount: 0,
    hasRecord: false,
    noteRows: [],
    yearNotes: []
  },

  onLoad: function () {
    var ym = core.todayKey().slice(0, 7);
    this.db = store.load();
    this.setData({ ym: ym });
    /* 锁着就先别画：应发金额别在跳锁屏前闪一帧 */
    if (!lock.guard()) { return; }
    this.render();
  },

  onShow: function () {
    if (!lock.guard()) { return; }
    this.db = store.load();
    this.render();
  },

  render: function () {
    if (this.data.mode === 'year') { this.renderYear(); return; }
    var db = this.db, ym = this.data.ym;
    var c = core.computeMonth(db, ym);
    /* 设置页的「基本工资」是以后月份的默认值，这里的「本月基本工资」是当月实际采用的
       （记过账就冻结）。两者不同时把差异显式摆出来，别只靠一句常驻灰字让人自己猜。 */
    var mb = core.monthBase(db, ym);
    var sb = parseFloat(db.settings.baseSalary) || 0;
    var baseDiff = !!db.settings.enableBase && Math.abs(mb - sb) > 0.005;
    /* 有课时、单价却是 0：课时费会静默算成 ¥0，最容易被当成「程序算错了」。
       开关是关着的时候不算异常（界面另有说明），只有开着且价为 0 才提示。 */
    var rateZero = !!db.settings.enableLesson && c.lessons > 0 && !(core.monthRate(db, ym) > 0);
    /* 只读渲染：不再借 monthP 顺手把当月参数冻上 */
    var y = parseInt(ym.slice(0, 4), 10), m = parseInt(ym.slice(5, 7), 10);

    var rows = [
      { k: '法定工作日', v: c.workdays + ' 天', strong: false },
      { k: '实际出勤', v: core.fmtShort(c.actual) + ' 天', strong: false },
      { k: '折算日薪', v: '¥' + core.fmt(c.dailyRate), strong: false },
      { k: '基本工资部分', v: '¥' + core.fmt(c.basePart), strong: false },
      { k: '超出天数部分', v: '¥' + core.fmt(c.extraPart), strong: false },
      /* 课时合计并进这一行：原来单独一行写「9 节」，混在一列全是元的数字里，
         单位对不上，还多占一行 */
      { k: '课时费', v: '¥' + core.fmt(c.lessonFee) + (c.lessons ? '（' + c.lessons + ' 节）' : ''), strong: false }
    ];

    /* 晚修监考没记就不占一行，免得每个月都挂一条 ¥0.00 */
    if (c.nightCount > 0) {
      rows.push({ k: '晚修监考费', v: '¥' + core.fmt(c.nightFee) + '（' + c.nightCount + ' 次）', strong: false });
    }

    /* 分了档就列出每档各多少节、什么价，否则「64 节 ¥7040」这行没人算得出来 */
    if (c.byRate && c.byRate.length > 1) {
      rows.push({
        k: '课时明细',
        v: c.byRate.map(function (r) { return r.name + ' ' + r.lessons + '×' + core.fmtShort(r.price); }).join(' + '),
        strong: false
      });
    }

    /* 用「天」而不是「半天」：以前写「上班 39 半天」，得自己除 2 才知道是 19.5 天，
       跟上面的「实际出勤 20 天」看着对不上（监考那 1 个半天折 0.5 天）。零值那格不占位。 */
    var halfRows = [
      { k: '上班', v: core.fmtShort(c.counted.work / 2), cls: 's-work' },
      { k: '监考', v: core.fmtShort(c.counted.inv / 2), cls: 's-inv' },
      { k: '加班', v: core.fmtShort(c.counted.ot / 2), cls: 's-ot' },
      { k: '请假', v: core.fmtShort(c.counted.leave / 2), cls: 's-leave' }
    ].filter(function (x, i) { return i === 0 || parseFloat(x.v) > 0; });

    this.setData({
      monLabel: y + ' 年 ' + m + ' 月',
      total: core.fmt(c.total),
      rows: rows,
      heroSubs: rows.slice(0, 3),
      halfRows: halfRows,
      /* 只读：档位价和晚修价在设置里改，这里给一眼核对用。
         档位价必须取本月实际生效的价（记过账的月份冻着旧价），
         否则回看旧月份时，参数卡写 100、③ 课时明细里却是 80，自己跟自己对不上 */
      otherRates: core.ratesOf(db).filter(function (r) { return r.id !== 'default'; })
        .map(function (r) { return r.name + ' ¥' + core.fmtShort(core.priceOf(db, ym, r.id)) + '/节'; }).join(' · '),
      nightEach: (c.nightFeeEach > 0 || c.nightCount > 0)
        ? ('每次 ' + core.fmtShort(c.nightHoursEach) + ' 小时 · ¥' + core.fmtShort(c.nightFeeEach) + '/次')
        : '',
      p: {
        /* 没记过账的月份 p.workdays 还是 undefined，输入框会显示 "undefined" 并卡死；取现算值 */
        workdays: String(c.workdays),
        base: String(mb),
        rate: String(core.monthRate(db, ym))
      },
      settingBase: core.fmtShort(sb),
      baseDiff: baseDiff,
      rateZero: rateZero,
      resetLabel: baseDiff
        ? ('让本月改用设置里的 ¥' + core.fmtShort(sb) + '（只改工资，别的参数不动）')
        : '让本月重新跟随设置（档位价、晚修价保留不动）',
      /* 开关关着还让人改工资／单价，改完 computeMonth 不采信，最像「算错了」。
         参数卡跟着设置页的开关走：灰掉 + 禁用 + 一句原因 */
      enableBase: !!db.settings.enableBase,
      enableLesson: !!db.settings.enableLesson,
      ghostDays: core.fmtShort(c.ghostDays),
      checked: c.checked,
      dayCount: c.filledDays,
      hasRecord: c.filledDays > 0,
      /* 本月写了备注的日子集中列一遍：日历格子里放不下考试名，
         月底想知道「那个周末干的啥」不用再一天天点开找 */
      noteRows: core.monthNotes(db, ym).map(function (x) {
        return {
          key: x.key, date: x.date, weekend: x.weekend, note: x.note,
          meta: x.dow + (x.kinds ? ' · ' + x.kinds : '') + (x.night ? ' · 晚修' : '')
        };
      })
    });
  },

  /* 年度视图：逐月同口径累加。四个标签共用一份 computeYear 结果，
     只是取不同字段展示；标签切换纯 UI，不重算、不写库。
     工资/单价参数卡只对单月有意义，年度模式一律不显示。 */
  renderYear: function () {
    var db = this.db, year = this.data.year, tab = this.data.yearTab;
    var c = core.computeYear(db, year);
    var months = c.months;

    /* 全年事项：备注之前只有「本月事项」，找某场考试得一个月一个月翻。
       和四个标签无关，常驻在年度页下面，按月顺手列完（只列写了备注的日子）。 */
    var yearNotes = [];
    for (var mn = 1; mn <= 12; mn++) {
      (function (ymOfNote) {
        core.monthNotes(db, ymOfNote).forEach(function (x) {
          yearNotes.push({
            key: x.key, date: x.date, weekend: x.weekend,
            meta: x.dow + (x.kinds ? ' · ' + x.kinds : '') + (x.night ? ' · 晚修' : ''),
            note: x.note
          });
        });
      })(year + '-' + core.pad(mn));
    }

    /* 逐月横条：按当前标签的值相对全年最大月缩放，最大值 0 时给 0% 不除零 */
    var makeBars = function (pick, valueText) {
      var vals = months.map(pick);
      var max = Math.max.apply(null, vals.concat([0]));
      return months.map(function (m, i) {
        return {
          ym: m.ym, label: parseInt(m.ym.slice(5, 7), 10) + ' 月',
          pct: max > 0 ? Math.round(vals[i] / max * 100) : 0,
          value: valueText(m), raw: vals[i]
        };
      });
    };

    var head, cards = [], bars = [], empty = '';
    if (tab === 'att') {
      head = {
        label: '全年实际出勤', cur: '', value: core.fmtShort(c.actual) + ' 天',
        sub: '应上班 ' + c.workdays + ' 天 · 待确认 ' + core.fmtShort(c.ghostDays) + ' 天'
      };
      cards = [
        { k: '上班', v: core.fmtShort(c.counted.work / 2) + ' 天' },
        { k: '监考', v: core.fmtShort(c.counted.inv / 2) + ' 天' },
        { k: '加班', v: core.fmtShort(c.counted.ot / 2) + ' 天' },
        { k: '请假', v: core.fmtShort(c.counted.leave / 2) + ' 天' }
      ];
      bars = makeBars(function (m) { return m.actual; }, function (m) {
        return core.fmtShort(m.actual) + ' / ' + m.workdays;
      });
      empty = '全年还没有出勤记录';
    } else if (tab === 'les') {
      head = {
        label: '全年课时', cur: '', value: c.lessons + ' 节',
        sub: '课时费 ¥' + core.fmt(c.lessonFee)
      };
      cards = (c.byRateList || []).map(function (r) {
        return { k: r.name, v: r.lessons + ' 节 · ¥' + core.fmtShort(r.fee) };
      });
      if (!cards.length) { cards = [{ k: '课时', v: '0 节' }]; }
      bars = makeBars(function (m) { return m.lessons; }, function (m) { return String(m.lessons); });
      empty = '全年还没有课时记录';
    } else if (tab === 'nig') {
      head = {
        label: '全年晚修监考', cur: '', value: c.nightCount + ' 次 · ¥' + core.fmt(c.nightFee),
        sub: '共 ' + core.fmtShort(c.nightHours) + ' 小时'
      };
      cards = [
        { k: '次数', v: c.nightCount + ' 次' },
        { k: '金额', v: '¥' + core.fmtShort(c.nightFee) },
        { k: '小时', v: core.fmtShort(c.nightHours) + ' 小时' }
      ];
      bars = makeBars(function (m) { return m.nightCount; }, function (m) { return String(m.nightCount); });
      empty = '全年没有晚修记录';
    } else {
      tab = 'pay';  /* 未知标签一律回到总览，不让页面空白 */
      head = {
        label: '全年应发', cur: '¥', value: core.fmt(c.total),
        sub: c.paidMonths + ' 个月 · ' + core.fmtShort(c.actual) + ' 天 · ' + c.lessons + ' 节 · ' + c.nightCount + ' 次晚修'
      };
      cards = [
        { k: '① 基本', v: '¥' + core.fmtShort(c.basePart) },
        { k: '② 超出', v: '¥' + core.fmtShort(c.extraPart) },
        { k: '③ 课时', v: '¥' + core.fmtShort(c.lessonFee) },
        { k: '④ 晚修', v: '¥' + core.fmtShort(c.nightFee) }
      ];
      bars = makeBars(function (m) { return m.total; }, function (m) { return '¥' + core.fmt(m.total); });
      empty = '全年还没有记录';
    }

    /* 有值才画横条：整年为 0 的标签显示空提示，而不是 12 行 0 */
    var hasData = bars.some(function (b) { return b.raw > 0; });
    this.setData({
      yearTab: tab,
      yearLabel: year + ' 年',
      yearHead: head,
      yearCards: cards,
      yearBars: hasData ? bars : [],
      yearEmpty: hasData ? '' : empty,
      paidMonths: c.paidMonths,
      checkedMonths: c.checkedMonths,
      total: core.fmt(c.total),
      noteRows: [],
      yearNotes: yearNotes,
      ghostDays: core.fmtShort(c.ghostDays),
      checked: false,
      dayCount: c.filledDays,
      hasRecord: c.filledDays > 0,
      /* 年度只读：下面这些只属于单月，置空让 wxml 的 wx:if 自动收起 */
      otherRates: '', nightEach: '', baseDiff: false,
      p: { workdays: '', base: '', rate: '' }
    });
  },

  setYearTab: function (e) {
    var t = e.currentTarget.dataset.tab;
    if (!t || t === this.data.yearTab) { return; }
    this.setData({ yearTab: t });
    this.render();
  },

  setMode: function (e) {
    var mode = e.currentTarget.dataset.mode;
    if (mode !== 'month' && mode !== 'year') { return; }
    if (mode === this.data.mode) { return; }
    if (mode === 'year' && !this.data.year) {
      this.setData({ mode: mode, year: parseInt(this.data.ym.slice(0, 4), 10) });
    } else {
      this.setData({ mode: mode });
    }
    this.render();
  },
  openYearMonth: function (e) {
    var ym = e.currentTarget.dataset.ym;
    if (!core.isYm(ym)) { return; }
    this.setData({ mode: 'month', ym: ym });
    this.render();
  },
  prevYear: function () { this.setData({ year: this.data.year - 1 }); this.render(); },
  nextYear: function () { this.setData({ year: this.data.year + 1 }); this.render(); },
  pickYear: function (e) {
    var v = parseInt(e.detail.value, 10);
    if (!v || v < 1) { return; }
    this.setData({ year: v });
    this.render();
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
    core.freezeMonth(this.db, this.data.ym);
    store.commit();
    this.render();
  },

  setBase: function (e) {
    var v = parseFloat(e.detail.value);
    if (isNaN(v) || v < 0) { this.render(); return; }
    var p = core.monthP(this.db, this.data.ym);
    p.base = v;
    core.freezeMonth(this.db, this.data.ym);
    store.commit();
    this.render();
  },

  setRate: function (e) {
    var v = parseFloat(e.detail.value);
    if (isNaN(v) || v < 0) { this.render(); return; }
    var p = core.monthP(this.db, this.data.ym);
    p.rate = v;
    core.freezeMonth(this.db, this.data.ym);
    store.commit();
    this.render();
  },

  toggleChecked: function (e) {
    var p = core.monthP(this.db, this.data.ym);
    p.checked = !!e.detail.value;
    core.freezeMonth(this.db, this.data.ym);
    store.commit();
    this.render();
    wx.showToast({ title: p.checked ? '本月已标记核对' : '已取消核对标记', icon: 'none' });
  },

  /* 差异提示上的精准操作：只让本月工资跟随设置。
     原来的 resetParams 会一次删掉 workdays / base / rate 三个参数，
     用户只想同步工资时不该把本月单独设过的单价和天数也连带改掉。 */
  /* 单价为 0 的提示点一下直达设置页；tab 页只能 switchTab */
  gotoSettings: function () {
    wx.switchTab({ url: '/pages/settings/settings' });
  },

  useSettingBase: function () {
    var p = core.monthP(this.db, this.data.ym);
    delete p.base;
    store.commit();
    this.render();
    wx.showToast({ title: '本月已改用设置里的工资', icon: 'none' });
  },

  resetParams: function () {
    var p = core.monthP(this.db, this.data.ym);
    delete p.workdays;
    delete p.base;
    delete p.rate;
    /* monthP 只负责拿到可写的参数对象、不填价格；删完之后再读一次 q.workdays
       只会是 undefined（toast 里会显示「应上班 undefined 天」）。render() 已经重算过，
       直接取它写回 data 的结果就行 */
    store.commit();
    this.render();
    wx.showToast({ title: '已回到设置默认值（应上班 ' + this.data.p.workdays + ' 天）', icon: 'none' });
  },

  /* 复制核对单：和电脑版拼的是同一个函数（core.sumText），两边复制出来一字不差 */
  copySum: function () {
    if (this.data.mode === 'year') {
      wx.showToast({ title: '核对单按月复制，请切回月度', icon: 'none' });
      return;
    }
    var c = core.computeMonth(this.db, this.data.ym);
    if (!c.filledDays) {
      wx.showToast({ title: '这个月还没有记录', icon: 'none' });
      return;
    }
    wx.setClipboardData({
      data: core.sumText(c),
      success: function () {
        wx.showToast({ title: '已复制，可粘给财务', icon: 'none' });
      },
      fail: function () {
        wx.showToast({ title: '复制失败，请重试', icon: 'none' });
      }
    });
  },

  /* 导出范围：口径与电脑版「导出多月统计」一致 */
  exportPick: function () {
    var that = this;
    wx.showActionSheet({
      itemList: ['本月', '近三个月', '今年', '全部记录'],
      success: function (res) { that.doExport(res.tapIndex); }
    });
  },

  doExport: function (kind) {
    this._export(kind);
  },

  exportMonth: function () { this._export(0); },
  exportAll: function () { this._export(3); },

  _export: function (kind) {
    var db = this.db, ym = this.data.ym;
    var now = core.todayKey().slice(0, 7);
    var cy = now.slice(0, 4);
    var months = [];
    if (kind === 0) {
      months = [ym];
    } else if (kind === 1) {
      months = core.monthsBetween(core.addMonths(now, -2), now);
    } else if (kind === 2) {
      months = core.monthsBetween(cy + '-01', now);
    } else {
      /* monthKeysOf 会把「只翻看过、还没记过」的月份也算进来（monthP 建了空壳），
         再筛一遍只留真有日记录的月份，避免 CSV 里出现整月空行 */
      var keys = core.monthKeysOf(db).filter(function (m) {
        return Object.keys(db.days || {}).some(function (k) {
          return k.slice(0, 7) === m && core.hasContent(db.days[k]);
        });
      });
      if (!keys.length) {
        wx.showToast({ title: '还没有任何记录', icon: 'none' });
        return;
      }
      months = keys.slice();
    }
    if (!months.length) {
      wx.showToast({ title: '这个范围里没有月份', icon: 'none' });
      return;
    }
    store.exportCsv(db, months, true, true).then(function (msg) {
      wx.showToast({ title: msg, icon: 'none' });
    }).catch(function (err) {
      wx.showToast({ title: (err && err.message) || '导出失败', icon: 'none' });
    });
  },

  /* 右上角「转发」：发给同事各自记账，对方的库是空的，不会看到这边的账 */
  onShareAppMessage: function () {
    return {
      title: '考勤记账本-个人版：出勤和课时分开记，工资自动算',
      path: 'pages/calendar/calendar'
    };
  }
});
