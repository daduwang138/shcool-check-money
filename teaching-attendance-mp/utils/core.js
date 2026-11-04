/* 教学考勤·计算内核
   纯函数，不依赖 wx、不依赖 DOM，也不读写任何全局状态。
   与「教学考勤记账本.html」逐行对应，只是把隐式的全局 DB 改成显式传参。 */

var STATES = {
  '': { label: '空', cls: 's-empty', ch: '' },
  work: { label: '上班', cls: 's-work', ch: '班' },
  inv: { label: '监考', cls: 's-inv', ch: '监' },
  ot: { label: '加班', cls: 's-ot', ch: '加' },
  leave: { label: '请假', cls: 's-leave', ch: '假' }
};
var CYCLE = ['', 'work', 'inv', 'ot', 'leave'];

/* 国务院办公厅公布的放假安排；缺年份时按「周末休、工作日上」的朴素规则 */
var HOLIDAYS = {
  2026: {
    note: '国办发明电〔2025〕7号',
    spans: [
      ['2026-01-01', '2026-01-03'],
      ['2026-02-15', '2026-02-23'],
      ['2026-04-04', '2026-04-06'],
      ['2026-05-01', '2026-05-05'],
      ['2026-06-19', '2026-06-21'],
      ['2026-09-25', '2026-09-27'],
      ['2026-10-01', '2026-10-07']
    ],
    makeup: ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10']
  }
};

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function dk(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }
function ymd(key) {
  var a = String(key).split('-');
  return [parseInt(a[0], 10), parseInt(a[1], 10), parseInt(a[2], 10)];
}
function todayKey() {
  var t = new Date();
  return dk(t.getFullYear(), t.getMonth() + 1, t.getDate());
}
function round2(v) { return Math.round(v * 100) / 100; }
function num2(v) { return (Math.round(v * 100) / 100).toFixed(2); }
function fmtShort(n) {
  var r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}
function fmt(n) {
  var s = num2(n).split('.');
  return s[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + s[1];
}
function sl(v) { return STATES[v] || STATES['']; }

/* ---------- 法定工作日 ---------- */
function table(y) { return HOLIDAYS[y] || null; }
function isWeekendKey(key) {
  var p = ymd(key);
  var w = new Date(p[0], p[1] - 1, p[2]).getDay();
  return w === 0 || w === 6;
}
function inSpan(key, spans) {
  for (var i = 0; i < spans.length; i++) {
    if (key >= spans[i][0] && key <= spans[i][1]) return true;
  }
  return false;
}
function isWorkday(key) {
  var y = ymd(key)[0], t = table(y);
  if (!t) return !isWeekendKey(key);
  if (t.makeup.indexOf(key) >= 0) return true;
  if (isWeekendKey(key)) return false;
  if (inSpan(key, t.spans)) return false;
  return true;
}
function autoWorkdays(y, m) {
  var n = new Date(y, m, 0).getDate(), c = 0;
  for (var d = 1; d <= n; d++) { if (isWorkday(dk(y, m, d))) c++; }
  return c;
}
function isHoliday(key) {
  var y = ymd(key)[0], t = table(y);
  if (!t) return false;
  return inSpan(key, t.spans);
}
function dowOf(key) {
  var p = ymd(key);
  return new Date(p[0], p[1] - 1, p[2]).getDay();
}
function weekdayOf(key) { return ((dowOf(key) + 6) % 7) + 1; }
function dateNum(key) {
  var p = ymd(key);
  return new Date(p[0], p[1] - 1, p[2]).getTime();
}
function dowLabel(key) { return ['日', '一', '二', '三', '四', '五', '六'][dowOf(key)]; }

/* ---------- 教学周 ---------- */
function weekOf(db, key) {
  if (!db.term || !db.term.start) return null;
  var diff = Math.floor((dateNum(key) - dateNum(db.term.start)) / 86400000);
  if (diff < 0) return 0;
  return Math.floor(diff / 7) + 1;
}
function preStart(db, key) {
  var s = db.settings.startDate;
  return !!(s && key < s);
}
function lessonsFor(db, key) {
  if (preStart(db, key)) return 0;
  var w = weekOf(db, key);
  if (w === null || w < 1) return 0;
  if (isHoliday(key)) return 0;
  var wd = weekdayOf(key), sum = 0;
  var cs = db.courses || [];
  for (var i = 0; i < cs.length; i++) {
    var c = cs[i];
    if (parseInt(c.weekday, 10) !== wd) continue;
    if (w < (c.startWeek || 1) || w > (c.endWeek || 16)) continue;
    if (c.parity === 'odd' && w % 2 === 0) continue;
    if (c.parity === 'even' && w % 2 === 1) continue;
    sum += parseInt(c.lessons, 10) || 0;
  }
  return sum;
}

/* ---------- 数据 ---------- */
function blankDB() {
  return {
    v: 1, savedAt: 0,
    settings: {
      owner: '', baseSalary: 0, rate: 0,
      rates: [{ id: 'default', name: '正课', price: 0 }],
      enableBase: true, enableLesson: true, enableInv: true, enableOt: true, autoWork: true,
      weekPattern: [0, 1, 1, 1, 1, 1, 0],
      startDate: '',
      fileBase: '考勤数据',
      fileName: '考勤数据.json',
      dirTipOff: false
    },
    months: {},
    days: {},
    term: { start: '', defaultWeeks: 16 },
    courses: []
  };
}
function normalize(db) {
  var b = blankDB();
  if (!db || typeof db !== 'object') return b;
  db.settings = Object.assign(b.settings, db.settings || {});
  if (!Array.isArray(db.settings.rates) || !db.settings.rates.length) db.settings.rates = b.settings.rates;
  var wp = db.settings.weekPattern;
  if (!Array.isArray(wp) || wp.length !== 7) db.settings.weekPattern = b.settings.weekPattern.slice();
  else {
    db.settings.weekPattern = wp.map(function (v) {
      v = parseFloat(v);
      return v === 0.5 ? 0.5 : (v ? 1 : 0);
    });
  }
  if (typeof db.settings.startDate !== 'string') db.settings.startDate = '';
  if (!db.months || typeof db.months !== 'object') db.months = {};
  if (!db.days || typeof db.days !== 'object') db.days = {};
  Object.keys(db.days).forEach(function (k) {
    var r = db.days[k];
    if (!r || typeof r !== 'object') return;
    if (r.lset == null) r.lset = true;
  });
  db.term = Object.assign(b.term, db.term || {});
  if (!Array.isArray(db.courses)) db.courses = [];
  db.courses = db.courses.map(function (c) {
    return {
      id: c.id || ('c' + Math.random().toString(36).slice(2, 8)),
      name: c.name || '',
      weekday: parseInt(c.weekday, 10) || 1,
      lessons: parseInt(c.lessons, 10) || 0,
      startWeek: parseInt(c.startWeek, 10) || 1,
      endWeek: parseInt(c.endWeek, 10) || 16,
      parity: c.parity || 'all'
    };
  });
  return db;
}
function peek(db, key) { return db.days[key] || null; }
function hasContent(r) { return !!(r && (r.am || r.pm || r.lessons || r.note)); }
function dayCount(db) {
  return Object.keys((db && db.days) || {}).filter(function (k) {
    return hasContent(db.days[k]);
  }).length;
}
function defaultHalf(db, key, which) {
  if (!db.settings.autoWork) return '';
  if (preStart(db, key)) return '';
  if (isWorkday(key)) return 'work';
  if (isHoliday(key)) return '';
  var wp = db.settings.weekPattern || [];
  var v = wp[dowOf(key)];
  if (v >= 1) return 'work';
  if (v === 0.5 && which === 'am') return 'work';
  return '';
}
function effHalf(db, key, which) {
  var r = db.days[key];
  if (r) return r[which] || '';
  return defaultHalf(db, key, which);
}
function isGhostHalf(db, key, which) {
  return !db.days[key] && defaultHalf(db, key, which) !== '';
}
function isGhost(db, key) {
  return isGhostHalf(db, key, 'am') || isGhostHalf(db, key, 'pm');
}
function setRecord(db, key, am, pm, lessons, note, lset) {
  var prev = db.days[key];
  var kept = (lset === undefined) ? (prev ? !!prev.lset : ((parseInt(lessons, 10) || 0) > 0)) : !!lset;
  if (!am && !pm && !lessons && !note) {
    if (defaultHalf(db, key, 'am') || defaultHalf(db, key, 'pm')) {
      db.days[key] = { am: '', pm: '', lessons: 0, note: '', off: true, lset: kept, upd: Date.now() };
    } else {
      delete db.days[key];
    }
  } else {
    db.days[key] = { am: am, pm: pm, lessons: lessons, note: note, off: false, lset: kept, upd: Date.now() };
  }
}
/* 按课程表填本月课时。
   注意：新建记录时必须把当天"原本会默认上班"的状态写进去，
   否则一条 am/pm 为空的记录会盖掉默认出勤，出勤天数凭空减少（原版缺陷）。 */
function fillLessonsFromCourses(db, ym) {
  var q = ymd(ym + '-01'), y = q[0], m = q[1];
  var n = new Date(y, m, 0).getDate();
  var filled = 0, skipped = 0, hol = 0;
  for (var d = 1; d <= n; d++) {
    var k = dk(y, m, d);
    if (isHoliday(k)) { hol++; continue; }
    var v = lessonsFor(db, k);
    if (v <= 0) continue;
    var ex = db.days[k];
    if (ex && (ex.off || ex.am === 'leave' || ex.pm === 'leave')) { skipped++; continue; }
    if (ex && (ex.lset || (parseInt(ex.lessons, 10) || 0) > 0)) { skipped++; continue; }
    var a = effHalf(db, k, 'am'), b = effHalf(db, k, 'pm');
    var r = db.days[k];
    if (!r) { r = db.days[k] = { am: '', pm: '', lessons: 0, note: '', upd: 0 }; }
    if (!r.am) r.am = a || '';
    if (!r.pm) r.pm = b || '';
    r.lessons = v;
    r.lset = true;
    r.upd = Date.now();
    filled++;
  }
  return { filled: filled, skipped: skipped, hol: hol };
}

function monthP(db, ym) {  var p = db.months[ym];
  if (!p) { p = db.months[ym] = {}; }
  var q = ymd(ym + '-01'), y = q[0], m = q[1];
  if (p.workdays == null) p.workdays = autoWorkdays(y, m);
  if (!p.base) p.base = db.settings.baseSalary;
  if (!p.rate) p.rate = db.settings.rate;
  if (p.checked == null) p.checked = false;
  return p;
}
/* 三段式：①日薪×min(实际,应上) + ②日薪×超出天数 + ③课时×单价 */
function computeMonth(db, ym) {
  var q = ymd(ym + '-01'), y = q[0], m = q[1];
  var n = new Date(y, m, 0).getDate();
  var half = 0, lessons = 0, filledDays = 0;
  var counted = { work: 0, inv: 0, ot: 0, leave: 0 };
  for (var d = 1; d <= n; d++) {
    var k = dk(y, m, d), rec0 = peek(db, k);
    if (preStart(db, k)) continue;
    var a = effHalf(db, k, 'am'), b = effHalf(db, k, 'pm');
    if (a === 'work' || a === 'inv' || a === 'ot') { half++; counted[a]++; }
    else if (a === 'leave') { counted.leave++; }
    if (b === 'work' || b === 'inv' || b === 'ot') { half++; counted[b]++; }
    else if (b === 'leave') { counted.leave++; }
    if (rec0) {
      lessons += rec0.lessons || 0;
      if (rec0.am || rec0.pm || rec0.lessons || rec0.note) filledDays++;
    }
  }
  var p = monthP(db, ym);
  var workdays = p.workdays || autoWorkdays(y, m);
  var base = db.settings.enableBase ? (p.base || 0) : 0;
  var rate = db.settings.enableLesson ? (p.rate || 0) : 0;
  var dailyRate = workdays > 0 ? base / workdays : 0;
  var actual = half / 2;
  var capped = Math.min(actual, workdays);
  var extra = Math.max(actual - workdays, 0);
  var basePart = round2(dailyRate * capped);
  var extraPart = round2(dailyRate * extra);
  var lessonFee = round2(lessons * rate);
  return {
    ym: ym, workdays: workdays, actual: actual, half: half, lessons: lessons, filledDays: filledDays,
    dailyRate: dailyRate, base: base, rate: rate,
    capped: capped, extra: extra, basePart: basePart, extraPart: extraPart, lessonFee: lessonFee,
    total: round2(basePart + extraPart + lessonFee), counted: counted, checked: !!p.checked,
    start: db.settings.startDate || ''
  };
}

/* ---------- 月份工具 ---------- */
function ymOf(k) { return String(k).slice(0, 7); }
function isYm(v) { return /^\d{4}-\d{2}$/.test(v); }
function addMonths(ym, delta) {
  var p = ymd(ym + '-01');
  var dt = new Date(p[0], p[1] - 1 + delta, 1);
  return dt.getFullYear() + '-' + pad(dt.getMonth() + 1);
}
function monthsBetween(a, b) {
  if (!a || !b) return [];
  var out = [], cur = a, guard = 0;
  while (cur <= b && guard++ < 600) { out.push(cur); cur = addMonths(cur, 1); }
  return out;
}
function monthKeysOf(db) {
  var m = {};
  Object.keys(db.days || {}).forEach(function (k) { m[ymOf(k)] = 1; });
  Object.keys(db.months || {}).forEach(function (k) { if (isYm(k)) m[k] = 1; });
  return Object.keys(m).sort();
}
function daysInMonth(ym) {
  var q = ymd(ym + '-01');
  return new Date(q[0], q[1], 0).getDate();
}
function firstWeekdayOf(ym) {
  var q = ymd(ym + '-01');
  return new Date(q[0], q[1] - 1, 1).getDay();
}

/* ---------- CSV ---------- */
function qcsv(v) {
  var s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(a) { return a.map(qcsv).join(','); }
function buildExportCsv(db, months, incSum, incDay) {
  var L = [];
  L.push(csvRow(['考勤统计', months[0] + ' 至 ' + months[months.length - 1]]));
  L.push(csvRow(['导出时间', new Date().toLocaleString()]));
  if (db.settings.startDate) L.push(csvRow(['入职起算日', db.settings.startDate]));
  L.push(csvRow(['计薪参数', '基本工资 ' + fmtShort(db.settings.baseSalary) + ' 元/月；课时单价 ' + fmtShort(db.settings.rate) + ' 元/节']));
  L.push('');
  var tot = { actual: 0, les: 0, base: 0, extra: 0, fee: 0, all: 0 };
  if (incSum) {
    L.push(csvRow(['月度汇总']));
    L.push(csvRow(['月份', '法定工作日', '实际出勤(天)', '上班(半天)', '监考(半天)', '加班(半天)', '请假(半天)',
      '课时(节)', '折算日薪', '基本工资部分', '超出天数部分', '课时费', '应发合计', '状态']));
    months.forEach(function (ym) {
      var c = computeMonth(db, ym);
      tot.actual += c.actual; tot.les += c.lessons; tot.base += c.basePart;
      tot.extra += c.extraPart; tot.fee += c.lessonFee; tot.all += c.total;
      L.push(csvRow([ym, c.workdays, fmtShort(c.actual), c.counted.work, c.counted.inv, c.counted.ot,
        c.counted.leave, c.lessons, num2(c.dailyRate), num2(c.basePart), num2(c.extraPart),
        num2(c.lessonFee), num2(c.total), c.checked ? '已核对' : '未核对']));
    });
    L.push(csvRow(['合计', months.length + ' 个月', fmtShort(tot.actual), '', '', '', '', tot.les, '',
      num2(tot.base), num2(tot.extra), num2(tot.fee), num2(tot.all), '']));
    L.push('');
  }
  if (incDay) {
    L.push(csvRow(['每日明细']));
    L.push(csvRow(['月份', '日期', '星期', '上午', '下午', '课时', '备注']));
    months.forEach(function (ym) {
      var q = ymd(ym + '-01'), y = q[0], m = q[1], n = new Date(y, m, 0).getDate();
      for (var d = 1; d <= n; d++) {
        var k = dk(y, m, d);
        if (preStart(db, k)) continue;
        var r = peek(db, k), a = effHalf(db, k, 'am'), b = effHalf(db, k, 'pm');
        var les = r ? (parseInt(r.lessons, 10) || 0) : 0, note = r ? (r.note || '') : '';
        if (!a && !b && !les && !note) continue;
        L.push(csvRow([ym, k, '周' + dowLabel(k), a ? sl(a).label : '', b ? sl(b).label : '', les, note]));
      }
    });
    L.push('');
  }
  return '\ufeff' + L.join('\r\n');
}

module.exports = {
  STATES: STATES, CYCLE: CYCLE, HOLIDAYS: HOLIDAYS,
  pad: pad, dk: dk, ymd: ymd, todayKey: todayKey,
  round2: round2, num2: num2, fmt: fmt, fmtShort: fmtShort, sl: sl,
  isWorkday: isWorkday, autoWorkdays: autoWorkdays, isHoliday: isHoliday,
  dowOf: dowOf, weekdayOf: weekdayOf, dowLabel: dowLabel, isWeekendKey: isWeekendKey,
  weekOf: weekOf, preStart: preStart, lessonsFor: lessonsFor,
  blankDB: blankDB, normalize: normalize, peek: peek, hasContent: hasContent, dayCount: dayCount,
  defaultHalf: defaultHalf, effHalf: effHalf, isGhostHalf: isGhostHalf, isGhost: isGhost,
  setRecord: setRecord, monthP: monthP, computeMonth: computeMonth,
  fillLessonsFromCourses: fillLessonsFromCourses,
  ymOf: ymOf, isYm: isYm, addMonths: addMonths, monthsBetween: monthsBetween,
  monthKeysOf: monthKeysOf, daysInMonth: daysInMonth, firstWeekdayOf: firstWeekdayOf,
  qcsv: qcsv, csvRow: csvRow, buildExportCsv: buildExportCsv
};
