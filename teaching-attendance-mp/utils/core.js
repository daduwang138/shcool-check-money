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
  },
  2027: {
    note: '国办发明电〔2026〕10号',
    spans: [
      ['2027-01-01', '2027-01-03'],
      ['2027-02-05', '2027-02-13'],
      ['2027-04-03', '2027-04-05'],
      ['2027-05-01', '2027-05-05'],
      ['2027-06-09', '2027-06-09'],
      ['2027-09-15', '2027-09-15'],
      ['2027-10-01', '2027-10-07']
    ],
    makeup: ['2027-01-31', '2027-02-14', '2027-05-08', '2027-09-26', '2027-10-09']
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

/* ---------- 法定工作日 ----------
   节假日来源三层，越靠前越优先：
   1. db.settings.holidays[年] —— 用户自己填的（国务院没公布前、或学校校历不同）
   2. HOLIDAYS[年]           —— 内置的国办发文件
   3. 朴素规则               —— 周一到周五上班，周六日休息
   自定义表只覆盖它显式写了的日子，没写的继续往下走，所以可以只补春节、国庆靠内置。 */
function table(y) { return HOLIDAYS[y] || null; }
function customOf(db, y) {
  var h = db && db.settings && db.settings.holidays;
  return (h && h[y]) || null;
}
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
function isWorkday(key, db) {
  var y = ymd(key)[0], t = table(y), c = customOf(db, y);
  /* 补班日排在最前：哪怕这天落在内置假期段里，用户说了算 */
  if (c && c.work && inSpan(key, c.work)) return true;
  if (c && c.off && inSpan(key, c.off)) return false;
  if (!t) return !isWeekendKey(key);
  if (t.makeup.indexOf(key) >= 0) return true;
  if (isWeekendKey(key)) return false;
  if (inSpan(key, t.spans)) return false;
  return true;
}
function autoWorkdays(y, m, db) {
  var n = new Date(y, m, 0).getDate(), c = 0;
  for (var d = 1; d <= n; d++) { if (isWorkday(dk(y, m, d), db)) c++; }
  return c;
}
function isHoliday(key, db) {
  var y = ymd(key)[0], t = table(y), c = customOf(db, y);
  if (c && c.work && inSpan(key, c.work)) return false;
  if (c && c.off && inSpan(key, c.off)) return true;
  if (!t) return false;
  return inSpan(key, t.spans);
}

/* ---------- 自定义放假安排 ----------
   存 db.settings.holidays[年] = { off: [[起, 止], ...], work: [[起, 止], ...] }
   和内置表同构（段数组），所以判定可以直接复用 inSpan，展示时也能整段删。 */
function holidayOf(db, y) {
  if (!db.settings.holidays) { db.settings.holidays = {}; }
  var e = db.settings.holidays[y];
  if (!e) { e = db.settings.holidays[y] = { off: [], work: [] }; }
  if (!e.off) { e.off = []; }
  if (!e.work) { e.work = []; }
  return e;
}
function addHolidaySpan(db, y, kind, from, to) {
  if (!from) { return false; }
  if (!to) { to = from; }
  if (to < from) { var t = from; from = to; to = t; }
  var e = holidayOf(db, y);
  var arr = kind === 'work' ? e.work : e.off;
  arr.push([from, to]);
  arr.sort(function (a, b) { return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0); });
  return true;
}
function delHolidaySpan(db, y, kind, idx) {
  var e = holidayOf(db, y);
  var arr = kind === 'work' ? e.work : e.off;
  if (idx < 0 || idx >= arr.length) { return false; }
  arr.splice(idx, 1);
  return true;
}
function clearHolidayYear(db, y) {
  if (db.settings.holidays && db.settings.holidays[y]) {
    delete db.settings.holidays[y];
    return true;
  }
  return false;
}
/* 自定义了哪几年：设置页和提示语要显示 */
function holidayYears(db) {
  var h = (db.settings && db.settings.holidays) || {};
  return Object.keys(h).filter(function (y) {
    var e = h[y];
    return e && ((e.off && e.off.length) || (e.work && e.work.length));
  }).map(function (y) { return parseInt(y, 10); }).sort();
}

/* ---------- 联网拿到的放假安排 ----------
   上游把国办发原文拆成逐日记录：{ year, papers: [原文链接], days: [{ name, date, isOffDay }] }
   这里折成和内置表同构的段，好在同一套判定里直接用。
   解析只认结构，不认来源，所以粘贴码和联网拿到的内容走的是同一条路。 */
function parseHolidayJson(raw, wantYear) {
  var o;
  try { o = (typeof raw === 'string') ? JSON.parse(raw) : raw; } catch (e) {
    return { ok: false, err: '内容不是合法的 JSON' };
  }
  if (!o || typeof o !== 'object') { return { ok: false, err: '内容不是合法的 JSON' }; }
  var y = parseInt(o.year, 10);
  if (wantYear && y && y !== wantYear) { return { ok: false, err: '拿到的是 ' + y + ' 年的数据' }; }
  if (!wantYear) { wantYear = y; }
  if (!o.days || !o.days.length) { return { ok: false, err: '这一年国务院还没公布，数据是空的' }; }
  var off = [], work = [], skipped = 0;
  for (var i = 0; i < o.days.length; i++) {
    var d = o.days[i] || {}, k = String(d.date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) { skipped++; continue; }
    if (wantYear && ymd(k)[0] !== wantYear) { skipped++; continue; }
    (d.isOffDay ? off : work).push(k);
  }
  if (!off.length && !work.length) { return { ok: false, err: '没有可用的日期' }; }
  off.sort();
  work.sort();
  var spans = [];
  for (var j = 0; j < off.length; j++) {
    if (j && dateNum(off[j]) - dateNum(off[j - 1]) === 86400000) {
      spans[spans.length - 1][1] = off[j];
    } else {
      spans.push([off[j], off[j]]);
    }
  }
  return {
    ok: true, year: wantYear, off: spans,
    work: work.map(function (k) { return [k, k]; }),
    offDays: off.length, workDays: work.length, skipped: skipped,
    note: (o.papers && o.papers.length) ? String(o.papers[0]) : ''
  };
}

/* 粘贴码：{ year, off: [[起, 止], ...], work: [[起, 止], ...] }
   和存储同构，一串一百多字节，从电脑版搬到手机上用。
   外部来的东西一律当脏数据洗一遍：格式不对、跨年、起止颠倒的都剔掉。 */
function parseHolidayPacket(raw, wantYear) {
  var o;
  try { o = (typeof raw === 'string') ? JSON.parse(raw) : raw; } catch (e) {
    return { ok: false, err: '内容不是合法的 JSON' };
  }
  if (!o || typeof o !== 'object') { return { ok: false, err: '内容不是合法的 JSON' }; }
  var y = parseInt(o.year, 10);
  if (!y) { return { ok: false, err: '缺少年份' }; }
  if (wantYear && y !== wantYear) { return { ok: false, err: '拿到的是 ' + y + ' 年的' }; }
  var bad = 0, off = [], work = [];
  var clean = function (arr, into) {
    if (!arr || !arr.length) { return; }
    for (var i = 0; i < arr.length; i++) {
      var s = arr[i];
      if (!s || s.length < 2) { bad++; continue; }
      var from = String(s[0] || ''), to = String(s[1] || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) { bad++; continue; }
      if (from > to) { var t = from; from = to; to = t; }
      if (ymd(from)[0] !== y || ymd(to)[0] !== y) { bad++; continue; }
      into.push([from, to]);
    }
  };
  clean(o.off, off);
  clean(o.work, work);
  if (!off.length && !work.length) { return { ok: false, err: '里面没有可用的日期' }; }
  var byFrom = function (a, b) { return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0); };
  off.sort(byFrom);
  work.sort(byFrom);
  return { ok: true, year: y, off: off, work: work, skipped: bad };
}

function dowOf(key) {
  var p = ymd(key);
  return new Date(p[0], p[1] - 1, p[2]).getDay();
}function weekdayOf(key) { return ((dowOf(key) + 6) % 7) + 1; }
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
  if (isHoliday(key, db)) return 0;
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

/* ---------- 课程表粘贴导入 ----------
   把 Excel 里复制出来的课表解析成课程数组。列顺序随意，靠内容认字段：
   星期（周一 / 星期四 / 礼拜5）、节数（3节 / 第1-2节）、周次（1-16周 / 第3周）、单双周、课程名。
   认不出的行不写入，连同行号和原因一起返回，让用户自己改。 */
function toHalf(s) {
  return String(s == null ? '' : s)
    .replace(/[\uFF01-\uFF5E]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
    .replace(/\u3000/g, ' ');
}
var WEEK_CH = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7 };
var COL_HEAD = /^(课程|课名|科目|名称|星期|周几|周次|节次|节数|时间|单双周|单\/双周|备注|地点|教室)$/;

function parseCourses(text, defEndWeek) {
  var ok = [], bad = [];
  var lines = String(text || '').split(/\r?\n/);
  var i, j;

  for (i = 0; i < lines.length; i++) {
    var raw = lines[i];
    if (!raw || !raw.trim()) { continue; }
    var line = toHalf(raw).trim();
    /* 表头行：既有「课程/科目」又有「星期/周次」这类词，直接略过 */
    if (/课程|科目|课名/.test(line) && /星期|周几|周次|节次|单双/.test(line)) { continue; }
    /* 标题行：「高二（3）班课表」这种，没有星期也没有数字 */
    if (/课表|课程表|作息|时间表/.test(line) && !/(?:周|星期|礼拜)\s*[一二三四五六日天1-7]/.test(line)) { continue; }

    var segs = line.split(/[\t,;|]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    if (segs.length < 3) {
      var bySpace = line.split(/\s+/).filter(Boolean);
      if (bySpace.length > segs.length) { segs = bySpace; }
    }

    var weekday = 0, lessons = 0, startWeek = 1, endWeek = 0, parity = 'all';
    var names = [], m;

    for (j = 0; j < segs.length; j++) {
      var seg = segs[j];
      if (COL_HEAD.test(seg)) { continue; }

      m = /^(?:周|星期|礼拜)\s*([一二三四五六日天1-7])$/.exec(seg);
      if (m) { weekday = WEEK_CH[m[1]]; continue; }

      if (/^(单周|单|odd)$/i.test(seg)) { parity = 'odd'; continue; }
      if (/^(双周|双|even)$/i.test(seg)) { parity = 'even'; continue; }

      /* 周次：1-16周 / 第1~16周 / 1至16周 */
      m = /第?\s*(\d{1,2})\s*[-–—~～至到]\s*(\d{1,2})\s*周/.exec(seg);
      if (m) { startWeek = parseInt(m[1], 10); endWeek = parseInt(m[2], 10); continue; }

      /* 节数范围：第1-2节 → 两节 */
      m = /第?\s*(\d{1,2})\s*[-–—~～至到]\s*(\d{1,2})\s*节/.exec(seg);
      if (m) { var a = parseInt(m[1], 10), b = parseInt(m[2], 10); lessons = b >= a ? b - a + 1 : 1; continue; }

      /* 单值周次：第3周 */
      m = /第?\s*(\d{1,2})\s*周/.exec(seg);
      if (m) { startWeek = endWeek = parseInt(m[1], 10); continue; }

      /* 单值节数：3节 */
      m = /第?\s*(\d{1,2})\s*节/.exec(seg);
      if (m) { lessons = parseInt(m[1], 10); continue; }

      /* 光秃秃的 1-16 当周次 */
      m = /^(\d{1,2})\s*[-–—~～至到]\s*(\d{1,2})$/.exec(seg);
      if (m) { startWeek = parseInt(m[1], 10); endWeek = parseInt(m[2], 10); continue; }

      /* 光秃秃的单个数字当节数 */
      m = /^\d{1,2}$/.exec(seg);
      if (m) { if (!lessons) { lessons = parseInt(m[0], 10); } continue; }

      names.push(seg);
    }

    if (!weekday) { bad.push({ line: i + 1, text: raw.trim(), why: '没认出星期几' }); continue; }
    if (!lessons) { bad.push({ line: i + 1, text: raw.trim(), why: '没认出节数' }); continue; }

    if (!startWeek) { startWeek = 1; }
    /* 没写周次就用教学周默认长度，不能缩成一周 —— 否则只有第 1 周有课，后面十几周的课时全丢 */
    if (!endWeek) { endWeek = parseInt(defEndWeek, 10) || 16; }
    if (endWeek < startWeek) { var t = startWeek; startWeek = endWeek; endWeek = t; }

    names.sort(function (x, y) { return y.length - x.length; });
    ok.push({
      name: names[0] || '未命名课程',
      weekday: weekday,
      lessons: lessons,
      startWeek: startWeek,
      endWeek: endWeek,
      parity: parity
    });
  }

  return { ok: ok, bad: bad };
}

/* ---------- 数据 ---------- */
function blankDB() {
  return {
    v: 1, savedAt: 0,
    settings: {
      owner: '', baseSalary: 0, rate: 0,
      rates: [{ id: 'default', name: '正课', price: 0 }],
      /* 晚修监考：按次计，不算课时也不占出勤半天 */
      nightHours: 2, nightFee: 10,
      enableBase: true, enableLesson: true, enableInv: true, enableOt: true, autoWork: true,
      /* 课程表课时自动落账：默认开，只补当月「今天及以前」且没手填过的日子 */
      autoLessons: true,
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
  /* 晚修监考的两个价：存成字符串也认，负数归零 */
  db.settings.nightHours = Math.max(0, parseFloat(db.settings.nightHours) || 0);
  db.settings.nightFee = Math.max(0, parseFloat(db.settings.nightFee) || 0);
  /* 老备份没有这个开关时默认开；只有显式关掉才关 */
  db.settings.autoLessons = db.settings.autoLessons !== false;
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
function hasContent(r) { return !!(r && (r.am || r.pm || r.lessons || r.note || r.night)); }
function dayCount(db) {
  return Object.keys((db && db.days) || {}).filter(function (k) {
    return hasContent(db.days[k]);
  }).length;
}
function defaultHalf(db, key, which) {
  if (!db.settings.autoWork) return '';
  if (preStart(db, key)) return '';
  if (isWorkday(key, db)) return 'work';
  if (isHoliday(key, db)) return '';
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
function setRecord(db, key, am, pm, lessons, note, lset, rid, night) {
  var prev = db.days[key];
  var kept = (lset === undefined) ? (prev ? !!prev.lset : ((parseInt(lessons, 10) || 0) > 0)) : !!lset;
  /* 档位只有非默认档才落盘，默认档不写字段——这样老数据、老备份读进来结构还是一样的 */
  /* 档位只对「有课时」有意义，0 节的日子不必留个空档位 */
  var useRid = (rid && rid !== 'default' && (parseInt(lessons, 10) || 0) > 0) ? rid : '';
  /* 晚修监考次数：不传就沿用原值。批量改出勤、切换上下午都不该顺手把晚修抹掉 */
  var ni = (night === undefined) ? ((prev && parseInt(prev.night, 10)) || 0) : (parseInt(night, 10) || 0);
  if (ni < 0) { ni = 0; }
  if (!am && !pm && !lessons && !note && !ni) {
    if (defaultHalf(db, key, 'am') || defaultHalf(db, key, 'pm')) {
      db.days[key] = { am: '', pm: '', lessons: 0, note: '', off: true, lset: kept, upd: Date.now() };
      if (useRid) { db.days[key].rid = useRid; }
    } else {
      delete db.days[key];
    }
  } else {
    db.days[key] = { am: am, pm: pm, lessons: lessons, note: note, off: false, lset: kept, upd: Date.now() };
    if (useRid) { db.days[key].rid = useRid; }
    /* 0 次不写字段，跟 rid 一个道理：数据能少一个键就少一个 */
    if (ni > 0) { db.days[key].night = ni; }
  }
  /* 写过这个月，就把当月计薪参数定下来；不靠「什么时候渲染」来决定 */
  if (typeof key === 'string' && key.length >= 7) { freezeMonth(db, key.slice(0, 7)); }
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
    if (isHoliday(k, db)) { hol++; continue; }
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
  if (filled > 0) { freezeMonth(db, ym); }
  return { filled: filled, skipped: skipped, hol: hol };
}

/* 课程表课时自动落账：只补「今天及以前、没手填过」的日子。
   未来日期不预填——课表中途换了，还没到的日子下次会按新课表算；
   已核对的月份是定稿，整月不动；翻看旧月也不改账。
   手填过的日子靠 lset / 已有课时跳过，绝不覆盖。 */
function autoFillLessons(db, ym, today) {
  var res = { filled: 0, skipped: 0, hol: 0, future: 0, reason: '' };
  if (!db.settings.autoLessons) { res.reason = 'off'; return res; }
  if (!db.term || !db.term.start || !db.courses || !db.courses.length) { res.reason = 'no-courses'; return res; }
  if (ym !== today.slice(0, 7)) { res.reason = 'not-current'; return res; }
  var mp = db.months[ym];
  if (mp && mp.checked) { res.reason = 'checked'; return res; }
  var q = ymd(ym + '-01'), y = q[0], m = q[1];
  var n = new Date(y, m, 0).getDate();
  for (var d = 1; d <= n; d++) {
    var k = dk(y, m, d);
    if (k > today) { res.future++; continue; }
    if (isHoliday(k, db)) { res.hol++; continue; }
    var v = lessonsFor(db, k);
    if (v <= 0) continue;
    var ex = db.days[k];
    if (ex && (ex.off || ex.am === 'leave' || ex.pm === 'leave')) { res.skipped++; continue; }
    if (ex && (ex.lset || (parseInt(ex.lessons, 10) || 0) > 0)) { res.skipped++; continue; }
    var a = effHalf(db, k, 'am'), b = effHalf(db, k, 'pm');
    var r = db.days[k];
    if (!r) { r = db.days[k] = { am: '', pm: '', lessons: 0, note: '', upd: 0 }; }
    if (!r.am) r.am = a || '';
    if (!r.pm) r.pm = b || '';
    r.lessons = v;
    r.lset = true;
    r.upd = Date.now();
    res.filled++;
  }
  if (res.filled > 0) { freezeMonth(db, ym); }
  return res;
}

/* 这月有没有经手过：落过任意一条日记录，或标记过已核对。
   用来区分「真的记过」和「只是翻看了一眼」——只有前者才冻结工资参数。 */
function monthTouched(db, ym) {
  var m = db.months[ym];
  if (m && m.checked) { return true; }
  var days = db.days || {};
  for (var k in days) {
    if (k.slice(0, 7) === ym) { return true; }
  }
  return false;
}

/* 只负责「拿到这个月可写的参数对象」，不填价格、不冻结。
   读参数一律直接用 db.months[ym] || {}；渲染、汇总、导出都不许改库。
   冻结是写操作，统一由 freezeMonth() 在写日记录 / 标记核对时显式调用。 */
function monthP(db, ym) {
  if (!db.months) { db.months = {}; }
  var p = db.months[ym];
  if (!p) { p = db.months[ym] = {}; }
  if (p.checked == null) { p.checked = false; }
  return p;
}

/* 冻结当月参数：只有「真经手过」的月份才定下来（落过日记录或标过已核对）。
   只补缺失的字段：手动把某月工资改成 0 也算已定，不能因为 0 是 falsy 又跟回设置值。
   workdays 也一起冻：不然先记完账再补春节假期，这月不会重算，用户会以为填了没生效。 */
function freezeMonth(db, ym) {
  var p = monthP(db, ym);
  if (!monthTouched(db, ym)) { return p; }
  var q = ymd(ym + '-01'), y = q[0], m = q[1];
  if (p.workdays == null) { p.workdays = autoWorkdays(y, m, db); }
  if (p.base == null) { p.base = db.settings.baseSalary; }
  if (p.rate == null) { p.rate = db.settings.rate; }
  /* 附加档位（晚自习之类）：记过账的月份不能因为后来调价而变钱 */
  if (p.rates == null) {
    var snap = {};
    ratesOf(db).forEach(function (r) { if (r.id !== 'default') { snap[r.id] = r.price; } });
    p.rates = snap;
  }
  /* 晚修监考的次数单价同理 */
  if (p.night == null) {
    p.night = { hours: parseFloat(db.settings.nightHours) || 0, fee: parseFloat(db.settings.nightFee) || 0 };
  }
  return p;
}

/* 本月实际生效的基数与单价：有冻结值用冻结值，没有就跟当前设置 */
function monthBase(db, ym) {
  var p = db.months[ym];
  return (p && p.base != null) ? p.base : db.settings.baseSalary;
}
function monthRate(db, ym) {
  var p = db.months[ym];
  return (p && p.rate != null) ? p.rate : db.settings.rate;
}

/* 课时档位：默认档（正课）的价格仍由 settings.rate 管，其余档放 settings.rates。
   两版都从这一个函数取，避免「界面显示 120、算出来 100」这类对不上。 */
function ratesOf(db) {
  var out = [{ id: 'default', name: '正课', price: parseFloat(db.settings.rate) || 0 }];
  var list = (db.settings.rates || []);
  list.forEach(function (r) {
    if (!r || !r.id || r.id === 'default') { return; }
    out.push({ id: r.id, name: r.name || '档位', price: parseFloat(r.price) || 0 });
  });
  return out;
}
function rateName(db, rid) {
  var l = ratesOf(db);
  for (var i = 0; i < l.length; i++) { if (l[i].id === rid) { return l[i].name; } }
  return l[0].name;
}
/* 某天某档的单价：默认档走月度冻结价，附加档走月度快照，没快照才用设置里的现价 */
function priceOf(db, ym, rid) {
  if (!rid || rid === 'default') { return monthRate(db, ym); }
  var p = db.months[ym];
  if (p && p.rates && p.rates[rid] != null) { return p.rates[rid]; }
  var l = ratesOf(db);
  for (var i = 0; i < l.length; i++) { if (l[i].id === rid) { return l[i].price; } }
  return monthRate(db, ym);
}
/* 晚修监考：一次算几个小时、给多少钱。月里有快照就用快照 */
function nightOf(db, ym) {
  var p = db.months[ym];
  if (p && p.night) {
    return { hours: parseFloat(p.night.hours) || 0, fee: parseFloat(p.night.fee) || 0 };
  }
  return {
    hours: parseFloat(db.settings.nightHours) || 0,
    fee: parseFloat(db.settings.nightFee) || 0
  };
}
/* 四段式：①日薪×min(实际,应上) + ②日薪×超出天数 + ③课时×单价 + ④晚修监考次数×每次 */
function computeMonth(db, ym) {
  var q = ymd(ym + '-01'), y = q[0], m = q[1];
  var n = new Date(y, m, 0).getDate();
  var half = 0, lessons = 0, filledDays = 0, byMap = {}, nightCount = 0;
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
      var ln = parseInt(rec0.lessons, 10) || 0;
      lessons += ln;
      /* 晚修监考按次记，不进课时合计，也不占出勤半天 */
      var ni = parseInt(rec0.night, 10) || 0;
      if (ni > 0) { nightCount += ni; }
      /* 多档单价：按当天记的档位分别累加，没记档位算默认档 */
      if (ln > 0) {
        var rid = rec0.rid || 'default';
        var pr = priceOf(db, ym, rid);
        if (!byMap[rid]) { byMap[rid] = { id: rid, name: rateName(db, rid), lessons: 0, price: pr, fee: 0 }; }
        byMap[rid].lessons += ln;
        byMap[rid].fee += ln * pr;
      }
      if (rec0.am || rec0.pm || rec0.lessons || rec0.note || rec0.night) filledDays++;
    }
  }
  /* 纯读：算工资、导出、复制核对单都不许顺手把当月参数冻上 */
  var p = (db.months || {})[ym] || {};
  var workdays = (p.workdays != null) ? p.workdays : autoWorkdays(y, m, db);
  var base = db.settings.enableBase ? (monthBase(db, ym) || 0) : 0;
  var rate = db.settings.enableLesson ? (monthRate(db, ym) || 0) : 0;
  var dailyRate = workdays > 0 ? base / workdays : 0;
  var actual = half / 2;
  var capped = Math.min(actual, workdays);
  var extra = Math.max(actual - workdays, 0);
  var basePart = round2(dailyRate * capped);
  var extraPart = round2(dailyRate * extra);
  var byRate = [], lessonFee = 0;
  if (db.settings.enableLesson) {
    ratesOf(db).forEach(function (r) { if (byMap[r.id]) { byRate.push(byMap[r.id]); } });
    Object.keys(byMap).forEach(function (id) {
      var hit = false;
      byRate.forEach(function (r) { if (r.id === id) { hit = true; } });
      if (!hit) { byRate.push(byMap[id]); }
    });
    byRate.forEach(function (r) { lessonFee += r.fee; });
    lessonFee = round2(lessonFee);
  }
  /* 晚修监考：跟课时费一样，关掉课时费不影响这一项，它是独立的补贴 */
  var np = nightOf(db, ym);
  var nightHours = round2(nightCount * np.hours);
  var nightFee = round2(nightCount * np.fee);
  return {
    ym: ym, workdays: workdays, actual: actual, half: half, lessons: lessons, filledDays: filledDays,
    dailyRate: dailyRate, base: base, rate: rate, byRate: byRate,
    capped: capped, extra: extra, basePart: basePart, extraPart: extraPart, lessonFee: lessonFee,
    nightCount: nightCount, nightHours: nightHours, nightFee: nightFee,
    nightHoursEach: np.hours, nightFeeEach: np.fee,
    total: round2(basePart + extraPart + lessonFee + nightFee), counted: counted, checked: !!p.checked,
    start: db.settings.startDate || ''
  };
}

/* 核对单文本：电脑版复制到剪贴板、小程序复制到微信，两版必须逐字一致 */
function sumText(c){
  var p=ymd(c.ym+"-01");
  var L=[];
  L.push(p[0]+" 年 "+p[1]+" 月 工资核对");
  L.push("————————————————");
  L.push("法定工作日："+c.workdays+" 天");
  L.push("实际出勤："+fmtShort(c.actual)+" 天（上班 "+c.counted.work+" / 监考 "+c.counted.inv+" / 加班 "+c.counted.ot+" 半天，请假 "+c.counted.leave+" 半天）");
  L.push("课时合计："+c.lessons+" 节");
  /* 用了多档单价才列明细，只有一档时不必多一行 */
  if(c.byRate&&c.byRate.length>1){
    L.push("课时明细："+c.byRate.map(function(r){return r.name+" "+r.lessons+" 节 × "+fmtShort(r.price)+" = "+fmt(r.fee)+" 元";}).join("；"));
  }
  /* 晚修监考单独一行：不进课时合计，财务那边也是两笔 */
  if(c.nightCount>0){
    L.push("晚修监考："+c.nightCount+" 次 × "+fmtShort(c.nightFeeEach)+" 元/次 = "+fmt(c.nightFee)+" 元（每次 "+fmtShort(c.nightHoursEach)+" 小时，共 "+fmtShort(c.nightHours)+" 小时）");
  }
  L.push("————————————————");
  L.push("折算日薪："+fmt(c.dailyRate)+" 元");
  L.push("① 基本工资部分："+fmt(c.basePart)+" 元");
  L.push("② 超出天数部分："+fmt(c.extraPart)+" 元");
  L.push("③ 课时费："+fmt(c.lessonFee)+" 元");
  if(c.nightCount>0){L.push("④ 晚修监考费："+fmt(c.nightFee)+" 元");}
  L.push("应发合计："+fmt(c.total)+" 元");
  return L.join("\n");
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
  var rateTxt = ratesOf(db).map(function (r) { return r.name + ' ' + fmtShort(r.price) + ' 元/节'; }).join('；');
  var nightTxt = db.settings.nightFee > 0
    ? '；晚修监考 ' + fmtShort(db.settings.nightHours) + ' 小时 ' + fmtShort(db.settings.nightFee) + ' 元/次'
    : '';
  L.push(csvRow(['计薪参数（当前设置）', '基本工资 ' + fmtShort(db.settings.baseSalary) + ' 元/月；课时单价 ' + rateTxt + nightTxt]));
  /* 上面那行只是「现在设置里填的价」。跨月导出时，记过账的月份用的是当月冻结价，
     两者可能不一样；财务拿这份表对账，得看得见每个月到底按哪个价算出来的。
     开关关掉的项仍列出参数值（那是记录里的值），只是不计入金额。 */
  var rlist = ratesOf(db);
  L.push(csvRow(['各月实际采用的参数（记过账的月份按当时价格冻结）']));
  L.push(csvRow(['月份', '基本工资(元/月)'].concat(rlist.map(function (r) { return r.name + '(元/节)'; }))
    .concat(['晚修每次(小时)', '晚修每次(元)'])));
  months.forEach(function (ym) {
    var np = nightOf(db, ym);
    L.push(csvRow([ym, num2(monthBase(db, ym))].concat(rlist.map(function (r) {
      return num2(priceOf(db, ym, r.id));
    })).concat([fmtShort(np.hours), num2(np.fee)])));
  });
  L.push('');
  var tot = { actual: 0, les: 0, base: 0, extra: 0, fee: 0, night: 0, nfee: 0, all: 0 };
  if (incSum) {
    L.push(csvRow(['月度汇总']));
    L.push(csvRow(['月份', '法定工作日', '实际出勤(天)', '上班(半天)', '监考(半天)', '加班(半天)', '请假(半天)',
      '课时(节)', '折算日薪', '基本工资部分', '超出天数部分', '课时费', '晚修(次)', '晚修补贴', '应发合计', '状态']));
    months.forEach(function (ym) {
      var c = computeMonth(db, ym);
      tot.actual += c.actual; tot.les += c.lessons; tot.base += c.basePart;
      tot.extra += c.extraPart; tot.fee += c.lessonFee; tot.night += c.nightCount;
      tot.nfee += c.nightFee; tot.all += c.total;
      L.push(csvRow([ym, c.workdays, fmtShort(c.actual), c.counted.work, c.counted.inv, c.counted.ot,
        c.counted.leave, c.lessons, num2(c.dailyRate), num2(c.basePart), num2(c.extraPart),
        num2(c.lessonFee), c.nightCount, num2(c.nightFee), num2(c.total), c.checked ? '已核对' : '未核对']));
    });
    L.push(csvRow(['合计', months.length + ' 个月', fmtShort(tot.actual), '', '', '', '', tot.les, '',
      num2(tot.base), num2(tot.extra), num2(tot.fee), tot.night, num2(tot.nfee), num2(tot.all), '']));
    L.push('');
  }
  if (incDay) {
    L.push(csvRow(['每日明细']));
    L.push(csvRow(['月份', '日期', '星期', '上午', '下午', '课时', '档位', '晚修(次)', '备注']));
    months.forEach(function (ym) {
      var q = ymd(ym + '-01'), y = q[0], m = q[1], n = new Date(y, m, 0).getDate();
      for (var d = 1; d <= n; d++) {
        var k = dk(y, m, d);
        if (preStart(db, k)) continue;
        var r = peek(db, k), a = effHalf(db, k, 'am'), b = effHalf(db, k, 'pm');
        var les = r ? (parseInt(r.lessons, 10) || 0) : 0, note = r ? (r.note || '') : '';
        var ni = r ? (parseInt(r.night, 10) || 0) : 0;
        if (!a && !b && !les && !note && !ni) continue;
        /* 档位只在真有课时才写，空的写了反而像“这天是正课” */
        var rn = les > 0 ? rateName(db, (r && r.rid) || 'default') : '';
        L.push(csvRow([ym, k, '周' + dowLabel(k), a ? sl(a).label : '', b ? sl(b).label : '', les, rn, ni, note]));
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
  holidayOf: holidayOf, addHolidaySpan: addHolidaySpan, delHolidaySpan: delHolidaySpan,
  clearHolidayYear: clearHolidayYear, holidayYears: holidayYears,
  parseHolidayJson: parseHolidayJson, parseHolidayPacket: parseHolidayPacket,
  dowOf: dowOf, weekdayOf: weekdayOf, dowLabel: dowLabel, isWeekendKey: isWeekendKey,
  weekOf: weekOf, preStart: preStart, lessonsFor: lessonsFor, parseCourses: parseCourses,
  blankDB: blankDB, normalize: normalize, peek: peek, hasContent: hasContent, dayCount: dayCount,
  defaultHalf: defaultHalf, effHalf: effHalf, isGhostHalf: isGhostHalf, isGhost: isGhost,
  setRecord: setRecord, monthP: monthP, freezeMonth: freezeMonth, computeMonth: computeMonth,
  sumText: sumText, ratesOf: ratesOf, rateName: rateName, priceOf: priceOf, nightOf: nightOf,
  monthTouched: monthTouched, monthBase: monthBase, monthRate: monthRate,
  fillLessonsFromCourses: fillLessonsFromCourses, autoFillLessons: autoFillLessons,
  ymOf: ymOf, isYm: isYm, addMonths: addMonths, monthsBetween: monthsBetween,
  monthKeysOf: monthKeysOf, daysInMonth: daysInMonth, firstWeekdayOf: firstWeekdayOf,
  qcsv: qcsv, csvRow: csvRow, buildExportCsv: buildExportCsv
};
