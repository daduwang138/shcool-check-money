/* 用 Node 把 HTML 里的原始实现和 core.js 并排跑，逐字段比对 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'teaching-attendance-mp');
const HTML = path.join(ROOT, '教学考勤记账本.html');
const core = require(path.join(MP, 'utils/core.js'));

const html = fs.readFileSync(HTML, 'utf8').replace(/\r\n/g, '\n');
const a = html.indexOf('var STATES={');
const b = html.indexOf('/* ---------- 加密 ---------- */');
if (a < 0 || b < 0) throw new Error('切片失败 ' + a + ' ' + b);
const slice = html.slice(a, b);

const csvStart = html.indexOf('function qcsv(');
const csvEnd = html.indexOf('/* 汇总页的「导出 Excel」');
if (csvStart < 0 || csvEnd < 0) throw new Error('CSV 切片失败');
const csvSlice = html.slice(csvStart, csvEnd);

const ctx = { console, document: { getElementById: () => null }, setTimeout, clearTimeout };
vm.createContext(ctx);
vm.runInContext(slice, ctx);
vm.runInContext(csvSlice, ctx);

let pass = 0, fail = 0;
const bad = [];
function eq(name, A, B) {
  const sa = JSON.stringify(A), sb = JSON.stringify(B);
  if (sa === sb) { pass++; return true; }
  fail++;
  if (bad.length < 6) bad.push(name + '\n  html=' + sa + '\n  core=' + sb);
  return false;
}

/* ---------- 造数据 ---------- */
function mkLegacy() {
  return {
    v: 1, savedAt: 123,
    settings: { baseSalary: 8000, rate: 120, startDate: '2026-09-21', weekPattern: [0, 1, 1, 1, 1, 1, 0] },
    months: { '2026-10': { workdays: 18, base: 8000, rate: 120, checked: true } },
    days: {
      '2026-09-21': { am: 'work', pm: 'work', lessons: 4, note: '' },
      '2026-09-22': { am: 'work', pm: 'inv', lessons: 3, note: '监考' },
      '2026-10-08': { am: 'work', pm: 'inv', lessons: 4, note: '' },
      '2026-10-09': { am: 'leave', pm: 'leave', lessons: 0, note: '病假' },
      '2026-10-10': { am: 'work', pm: 'work', lessons: 6, note: '调休补班' },
      '2026-10-17': { am: 'ot', pm: 'ot', lessons: 2, note: '' },
      '2026-10-18': { am: '', pm: '', lessons: 0, note: '', off: true },
      '2026-11-03': { am: 'work', pm: 'work', lessons: 4, note: '' },
      '2026-11-04': { am: 'inv', pm: 'inv', lessons: 0, note: '' },
      '2026-11-14': { am: 'ot', pm: 'inv', lessons: 2, note: '周末加班' },
      '2027-01-05': { am: 'work', pm: 'work', lessons: 5, note: '' }
    },
    term: { start: '2026-09-21', defaultWeeks: 16 },
    courses: [
      { id: 'a', name: '语文', weekday: 1, lessons: 4, startWeek: 1, endWeek: 16, parity: 'all' },
      { id: 'b', name: '数学', weekday: 3, lessons: 2, startWeek: 1, endWeek: 8, parity: 'odd' },
      { id: 'c', name: '英语', weekday: 5, lessons: 3, startWeek: 9, endWeek: 16, parity: 'even' }
    ]
  };
}
function mkEmpty() { return { v: 1, savedAt: 0, settings: {}, months: {}, days: {}, term: {}, courses: [] }; }
function mkAuto() {
  return {
    v: 1, savedAt: 0,
    settings: { autoWork: true, weekPattern: [0, 0.5, 1, 1, 1, 0.5, 0], baseSalary: 6000, rate: 100 },
    months: {}, days: { '2026-10-05': { am: 'ot', pm: 'ot', lessons: 3, note: '国庆加班' } },
    term: { start: '' }, courses: []
  };
}

/* 自己填的放假安排：2027 春节（国办发还没公布）+ 2026 末尾补一天 + 一个补班周六 */
function mkCustom() {
  const db = mkLegacy();
  db.settings.holidays = {
    '2027': {
      off: [['2027-02-06', '2027-02-12']],
      work: [['2027-02-13', '2027-02-13']]
    },
    '2026': {
      off: [['2026-12-31', '2026-12-31']],
      work: [['2026-11-14', '2026-11-14']]
    }
  };
  return db;
}

/* 多档课时单价：正课 120 / 晚自习 80，10 月里有两天记的是晚自习 */
function mkRates() {
  const db = mkLegacy();
  db.settings.rates = [
    { id: 'default', name: '正课', price: 120 },
    { id: 'eve', name: '晚自习', price: 80 }
  ];
  db.days['2026-10-08'].rid = 'eve';
  db.days['2026-10-10'].rid = 'eve';
  return db;
}

const cases = [['空库', mkEmpty()], ['典型', mkLegacy()], ['半天周', mkAuto()],
  ['自定义假期', mkCustom()], ['多档单价', mkRates()]];

/* 1. 逐日判定：2025-01 ~ 2027-12 每一天 */
let dayChecked = 0;
for (const [label, raw] of cases) {
  const hdb = ctx.normalize(JSON.parse(JSON.stringify(raw)));
  const cdb = core.normalize(JSON.parse(JSON.stringify(raw)));
  ctx.DB = hdb;

  eq(label + '·normalize', JSON.stringify(hdb), JSON.stringify(cdb));

  for (let y = 2025; y <= 2027; y++) {
    for (let m = 1; m <= 12; m++) {
      eq(label + '·autoWorkdays ' + y + '-' + m, ctx.autoWorkdays(y, m), core.autoWorkdays(y, m, cdb));
      const n = new Date(y, m, 0).getDate();
      for (let d = 1; d <= n; d++) {
        const k = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        dayChecked++;
        eq(label + '·isWorkday ' + k, ctx.isWorkday(k), core.isWorkday(k, cdb));
        eq(label + '·isHoliday ' + k, ctx.isHoliday(k), core.isHoliday(k, cdb));
        eq(label + '·defaultHalf ' + k, [ctx.defaultHalf(k, 'am'), ctx.defaultHalf(k, 'pm')],
          [core.defaultHalf(cdb, k, 'am'), core.defaultHalf(cdb, k, 'pm')]);
        eq(label + '·effHalf ' + k, [ctx.effHalf(k, 'am'), ctx.effHalf(k, 'pm')],
          [core.effHalf(cdb, k, 'am'), core.effHalf(cdb, k, 'pm')]);
        eq(label + '·isGhost ' + k, ctx.isGhost(k), core.isGhost(cdb, k));
        eq(label + '·lessonsFor ' + k, ctx.lessonsFor(k), core.lessonsFor(cdb, k));
        eq(label + '·weekOf ' + k, ctx.weekOf(k), core.weekOf(cdb, k));
      }
    }
  }

  /* 2. 每月工资 */
  for (let y = 2025; y <= 2027; y++) {
    for (let m = 1; m <= 12; m++) {
      const ym = y + '-' + String(m).padStart(2, '0');
      eq(label + '·computeMonth ' + ym, ctx.computeMonth(ym), core.computeMonth(cdb, ym));
    }
  }

  /* 2.5 核对单文本：电脑版与小程序拼出来的字必须逐字一样 */
  for (const ym of ['2025-03', '2026-10', '2027-01']) {
    eq(label + '·sumText ' + ym, ctx.sumText(ctx.computeMonth(ym)), core.sumText(core.computeMonth(cdb, ym)));
  }
}

/* 2.6 多档单价：分档累加、冻结、两版一致 */
{
  const h = ctx.normalize(mkRates());
  const c = core.normalize(mkRates());
  ctx.DB = h;
  const hc = ctx.computeMonth('2026-10');
  const cc = core.computeMonth(c, '2026-10');
  eq('多档·两版结果一致', hc, cc);
  eq('多档·档位顺序默认在前', cc.byRate.map(r => r.id), ['default', 'eve']);
  const eve = cc.byRate.filter(r => r.id === 'eve')[0];
  eq('多档·晚自习课时数', eve.lessons, 10);
  eq('多档·晚自习按 80 计价', eve.fee, 800);
  /* 10 月记了课时的只有：10-17 正课 2 节、10-08 与 10-10 晚自习 4+6 节 */
  eq('多档·课时费合计', cc.lessonFee, 2 * 120 + (4 + 6) * 80);
  eq('多档·总额', cc.total, Math.round((cc.basePart + cc.extraPart + cc.lessonFee) * 100) / 100);

  /* 记过账的月份把附加档价格也冻住 */
  ctx.computeMonth('2026-10'); core.computeMonth(c, '2026-10');
  c.settings.rates[1].price = 999; h.settings.rates[1].price = 999;
  eq('多档·改价不影响记过的月份', core.computeMonth(c, '2026-10').lessonFee, cc.lessonFee);
  eq('多档·两版冻结一致', ctx.computeMonth('2026-10').lessonFee, core.computeMonth(c, '2026-10').lessonFee);
  eq('多档·下个月跟新价', core.computeMonth(c, '2026-12').byRate.length, 0);
}

/* 3. setRecord 的墓碑行为 */
const scenarios = [
  ['清空法定工作日', '2026-10-09', '', '', 0, ''],
  ['清空普通周末', '2026-10-17', '', '', 0, ''],
  ['清空入职前', '2026-09-01', '', '', 0, ''],
  ['只填课时', '2026-10-20', '', '', 4, ''],
  ['填备注', '2026-10-21', 'work', 'work', 0, '开会'],
  ['半天', '2026-10-22', 'work', '', 2, '']
];
for (const [nm, key, am, pm, les, note] of scenarios) {
  const hdb = ctx.normalize(mkLegacy());
  const cdb = core.normalize(mkLegacy());
  ctx.DB = hdb;
  ctx.setRecord(key, am, pm, les, note);
  core.setRecord(cdb, key, am, pm, les, note);
  const ha = hdb.days[key] ? Object.assign({}, hdb.days[key]) : null;
  const ca = cdb.days[key] ? Object.assign({}, cdb.days[key]) : null;
  if (ha) { delete ha.upd; } if (ca) { delete ca.upd; }
  eq('setRecord·' + nm, ha, ca);
  eq('setRecord·' + nm + '·后算月', ctx.computeMonth('2026-10').total, core.computeMonth(cdb, '2026-10').total);
}

/* 4. CSV 输出 */
const months = ['2026-09', '2026-10', '2026-11', '2027-01'];
const hdb = ctx.normalize(mkLegacy());
const cdb = core.normalize(mkLegacy());
ctx.DB = hdb;
const stripTime = s => s.split('\r\n').filter(l => !l.startsWith('"导出时间"') && !l.startsWith('导出时间')).join('\r\n');
const csvH = stripTime(ctx.buildExportCsv(months, true, true));
const csvC = stripTime(core.buildExportCsv(cdb, months, true, true));
eq('CSV 全文', csvH, csvC);
if (csvH !== csvC) {
  const lh = csvH.split('\r\n'), lc = csvC.split('\r\n');
  for (let i = 0; i < Math.max(lh.length, lc.length); i++) {
    if (lh[i] !== lc[i]) { console.log('首个差异行 ' + i + '\n html: ' + lh[i] + '\n core: ' + lc[i]); break; }
  }
}

/* 5. 工具函数 */
eq('addMonths', ['2025-12', '2026-02', '2026-12'], [core.addMonths('2026-01', -1), core.addMonths('2026-01', 1), core.addMonths('2026-11', 1)]);
eq('monthsBetween', ['2026-11', '2026-12', '2027-01'], core.monthsBetween('2026-11', '2027-01'));
eq('qcsv 逗号', '"a,b"', core.qcsv('a,b'));
eq('qcsv 引号', '"he said ""hi"""', core.qcsv('he said "hi"'));
eq('fmt', '1,234.50', core.fmt(1234.5));

/* 6. 课程表粘贴解析：两版必须给出一样的课表 */
const courseSamples = [
  '课程\t星期\t节数\t起止周\t单双周\n语文\t周一\t3\t1-16周\t每周\n数学\t星期三\t2\t1-8周\t单周\n英语\t礼拜5\t2\t9-16周\t双周',
  '高二（3）班课表\n周一 第1-2节 语文 1-16周\n周二，数学，3节，第3周\n周三 英语 2 1~16 双周\n周五 自习\n乱七八糟一行',
  '星期\t课程\t节数\t周次\n星期二\t物理\t第3-4节\t第1至16周\n星期四\t化学\t4节\t单周',
  '周一,语文,3节,1-16周,每周\n周三,数学,2节,1-8周,单周\n周三,数学,2节,9-16周,双周\n周日,补课,2节,1-16周',
  '只有课程名没有星期\n周一 只有星期\n',
  /* 没写周次的一行：两版都要落成「第 1 周到教学周末」，不能缩成一周 */
  '周三\t数学\t3节\n周五\t英语\t2节\t20-12周'
];
courseSamples.forEach(function (t, i) {
  eq('parseCourses#' + i, ctx.parseCourses(t, 16), core.parseCourses(t, 16));
});

/* 默认周次单独钉一下：跨版本比对只能证明两版一样，证明不了它对 */
eq('parseCourses 默认周次', [1, 16, 12, 20],
  (function (r) { return [r.ok[0].startWeek, r.ok[0].endWeek, r.ok[1].startWeek, r.ok[1].endWeek]; })(core.parseCourses('周三\t数学\t3节\n周五\t英语\t2节\t20-12周', 16)));

/* 6.5 自定义放假安排的语义：同样只能钉死期望值，两版一致不代表对 */
{
  const db = core.normalize(mkCustom());
  const wd = k => core.isWorkday(k, db);
  const hol = k => core.isHoliday(k, db);
  eq('自定义·春节里的周一不上班', false, wd('2027-02-08'));
  eq('自定义·春节算法定假期', true, hol('2027-02-08'));
  eq('自定义·补班的周六要上班', true, wd('2027-02-13'));
  eq('自定义·补班日不算假期', false, hol('2027-02-13'));
  /* 20 个周一到周五，减掉 2/8–2/12 五天假，加回 2/13 一天补班 */
  eq('自定义·2027 年 2 月应上班天数', 16, core.autoWorkdays(2027, 2, db));
  /* 内置有表的年份，自定义照样能改 */
  eq('自定义·能覆盖内置年份的单日', false, wd('2026-12-31'));
  eq('自定义·2026 的补班周六生效', true, wd('2026-11-14'));
  /* 没填的日子继续走内置表，不能因为填了自定义就整年失效 */
  eq('自定义·2026 国庆仍按内置表', false, wd('2026-10-01'));
  /* 2027 表外的工作日仍按朴素规则 */
  eq('自定义·2027-03-01 普通周一上班', true, wd('2027-03-01'));
}

/* 7. 工资参数冻结：只有「真记过」的月份才冻住，只是翻看过的不冻 */
{
  const fresh = () => {
    const h = ctx.normalize(mkLegacy());
    const c = core.normalize(mkLegacy());
    h.months = {}; h.days = {};
    c.months = {}; c.days = {};
    return { h, c };
  };

  /* 7.1 只是翻看了一眼：不落 base/rate，之后改设置要跟得上 */
  {
    const { h, c } = fresh();
    ctx.DB = h;
    const hp = ctx.monthP('2026-11');
    const cp = core.monthP(c, '2026-11');
    eq('冻结·只看过的月份不落参数', [hp.base, hp.rate], [cp.base, cp.rate]);
    eq('冻结·两版都还是空', [hp.base, cp.base], [undefined, undefined]);
    h.settings.baseSalary = 12345; c.settings.baseSalary = 12345;
    eq('冻结·只看过的月份跟着设置走', core.computeMonth(c, '2026-11').base, 12345);
    eq('冻结·两版一致', ctx.computeMonth('2026-11').base, core.computeMonth(c, '2026-11').base);
  }

  /* 7.2 记过一天：第一次渲染时落盘，之后改设置不影响 */
  {
    const { h, c } = fresh();
    ctx.DB = h;
    ctx.setRecord('2026-11-03', 'work', 'work', 2, '');
    core.setRecord(c, '2026-11-03', 'work', 'work', 2, '');
    ctx.computeMonth('2026-11'); core.computeMonth(c, '2026-11');
    h.settings.baseSalary = 20000; c.settings.baseSalary = 20000;
    eq('冻结·记过的月份不跟设置变', core.computeMonth(c, '2026-11').base, 8000);
    eq('冻结·两版一致', ctx.computeMonth('2026-11').base, core.computeMonth(c, '2026-11').base);
  }

  /* 7.3 只标了「已核对」也算经手过 */
  {
    const { h, c } = fresh();
    ctx.DB = h;
    ctx.monthP('2026-11').checked = true;
    core.monthP(c, '2026-11').checked = true;
    ctx.computeMonth('2026-11'); core.computeMonth(c, '2026-11');
    h.settings.rate = 300; c.settings.rate = 300;
    eq('冻结·标过核对的月份不跟设置变', core.computeMonth(c, '2026-11').rate, 120);
    eq('冻结·两版一致', ctx.computeMonth('2026-11').rate, core.computeMonth(c, '2026-11').rate);
  }

  /* 7.4 手动把某月基数填 0：0 也是「已定」，不能被设置值顶回来 */
  {
    const { h, c } = fresh();
    ctx.DB = h;
    ctx.monthP('2026-11').base = 0;
    core.monthP(c, '2026-11').base = 0;
    h.settings.baseSalary = 20000; c.settings.baseSalary = 20000;
    eq('冻结·手填 0 也算已定', core.computeMonth(c, '2026-11').base, 0);
    eq('冻结·两版一致', ctx.computeMonth('2026-11').base, core.computeMonth(c, '2026-11').base);
  }
}

/* ---------- 8. 联网 / 粘贴进来的放假安排 ---------- */
{
  /* 2026 的真实摘录（把国办发明电〔2025〕7号拆成逐日），
     用它折回来的结果必须和内置表一字不差 —— 这是解析逻辑唯一的对错标准 */
  const D26 = [['2026-01-01', 1], ['2026-01-02', 1], ['2026-01-03', 1], ['2026-01-04', 0], ['2026-02-14', 0], ['2026-02-15', 1], ['2026-02-16', 1], ['2026-02-17', 1], ['2026-02-18', 1], ['2026-02-19', 1], ['2026-02-20', 1], ['2026-02-21', 1], ['2026-02-22', 1], ['2026-02-23', 1], ['2026-02-28', 0], ['2026-04-04', 1], ['2026-04-05', 1], ['2026-04-06', 1], ['2026-05-01', 1], ['2026-05-02', 1], ['2026-05-03', 1], ['2026-05-04', 1], ['2026-05-05', 1], ['2026-05-09', 0], ['2026-06-19', 1], ['2026-06-20', 1], ['2026-06-21', 1], ['2026-09-20', 0], ['2026-09-25', 1], ['2026-09-26', 1], ['2026-09-27', 1], ['2026-10-01', 1], ['2026-10-02', 1], ['2026-10-03', 1], ['2026-10-04', 1], ['2026-10-05', 1], ['2026-10-06', 1], ['2026-10-07', 1], ['2026-10-10', 0]];
  const pack = (arr, y) => JSON.stringify({
    year: y || 2026,
    papers: ['https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm'],
    days: arr.map((d) => ({ date: d[0], isOffDay: !!d[1] }))
  });
  const raw = pack(D26);

  const h = ctx.parseHolidayJson(raw, 2026);
  const c = core.parseHolidayJson(raw, 2026);
  eq('解析·两版逐字段一致', h, c);
  eq('解析·成功', h.ok, true);
  eq('解析·休假段与原表一致', h.off, core.HOLIDAYS[2026].spans);
  eq('解析·补班日与原表一致', h.work.map((s) => s[0]), core.HOLIDAYS[2026].makeup);
  eq('解析·休假天数', h.offDays, 33);
  eq('解析·补班天数', h.workDays, 6);
  eq('解析·带上原文链接', /gov\.cn/.test(h.note), true);

  /* 还没公布：文件在、但 days 是空的 */
  const e1 = core.parseHolidayJson(JSON.stringify({ year: 2027 }), 2027);
  eq('解析·没公布要说清楚', e1.ok === false && /还没公布/.test(e1.err), true);
  eq('解析·没公布两版一致', ctx.parseHolidayJson(JSON.stringify({ year: 2027 }), 2027).err, e1.err);

  eq('解析·年份不符要拒绝', core.parseHolidayJson(raw, 2027).ok, false);
  eq('解析·年份不符提到实际年份', /2026/.test(core.parseHolidayJson(raw, 2027).err), true);
  eq('解析·非 JSON 拒绝', core.parseHolidayJson('休 2月6到12', 2027).ok, false);
  eq('解析·脏输入两版同判', ctx.parseHolidayJson('x').ok, core.parseHolidayJson('x').ok);

  const mx = core.parseHolidayJson(pack(D26.concat([['2027-01-01', 1], ['bad-date', 1]]), 2026), 2026);
  eq('解析·跨年与坏日期被跳过', mx.skipped, 2);
  eq('解析·跳过不影响正常段', mx.off.length, 7);

  const seg = core.parseHolidayJson(pack([['2027-03-01', 1], ['2027-03-02', 1], ['2027-03-03', 1], ['2027-03-05', 1]], 2027), 2027);
  eq('解析·连续日并段、断开另起', seg.off, [['2027-03-01', '2027-03-03'], ['2027-03-05', '2027-03-05']]);
}

{
  /* 粘贴码：电脑版写出的东西，手机端洗一遍再落库 */
  const p = JSON.stringify({
    year: 2027,
    off: [['2027-02-06', '2027-02-12'], ['2027-02-10', '2027-02-09']],
    work: [['2027-02-20', '2027-02-20']],
    junk: 1
  });
  const c = core.parseHolidayPacket(p, 0);
  eq('粘贴·两版一致', ctx.parseHolidayPacket(p, 0), c);
  eq('粘贴·年份', c.year, 2027);
  eq('粘贴·起止颠倒会纠正', c.off[1], ['2027-02-09', '2027-02-10']);
  eq('粘贴·按开始日期排序', c.off.map((s) => s[0]), ['2027-02-06', '2027-02-09']);
  eq('粘贴·补班', c.work, [['2027-02-20', '2027-02-20']]);
  eq('粘贴·多余的键不管', c.skipped, 0);

  const x = core.parseHolidayPacket(JSON.stringify({ year: 2027, off: [['2027-12-30', '2028-01-02']] }), 0);
  eq('粘贴·跨年的段整份不认', x.ok === false && /没有可用/.test(x.err), true);
  eq('粘贴·跨年两版同判', ctx.parseHolidayPacket(JSON.stringify({ year: 2027, off: [['2027-12-30', '2028-01-02']] }), 0).err, x.err);
  eq('粘贴·年份不符拒绝', core.parseHolidayPacket(p, 2026).ok, false);
  eq('粘贴·缺年份拒绝', core.parseHolidayPacket(JSON.stringify({ off: [] })).ok, false);
  eq('粘贴·空的拒绝', core.parseHolidayPacket(JSON.stringify({ year: 2027, off: [], work: [] })).ok, false);
  eq('粘贴·非 JSON 拒绝', core.parseHolidayPacket('春节 2 月 6 日到 12 日').ok, false);
  eq('粘贴·两版同判空', ctx.parseHolidayPacket('{}').err, core.parseHolidayPacket('{}').err);

  /* 落库之后要真的影响判定 */
  const db = core.blankDB();
  const q = core.parseHolidayPacket(JSON.stringify({
    year: 2027, off: [['2027-02-06', '2027-02-12']], work: [['2027-02-20', '2027-02-20']]
  }), 0);
  db.settings.holidays = { 2027: { off: q.off, work: q.work } };
  eq('粘贴·导入后春节算休息', core.isWorkday('2027-02-08', db), false);
  eq('粘贴·导入后补班日算上班', core.isWorkday('2027-02-20', db), true);
  eq('粘贴·导入后 2 月应上班', core.autoWorkdays(2027, 2, db), 16);
  eq('粘贴·没导入时 2 月应上班', core.autoWorkdays(2027, 2, core.blankDB()), 20);
}

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项；逐日核对 ' + dayChecked + ' 天');
if (bad.length) { console.log('\n失败样例：\n' + bad.join('\n')); process.exit(1); }
console.log('内核与 HTML 版完全一致');
