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

const cases = [['空库', mkEmpty()], ['典型', mkLegacy()], ['半天周', mkAuto()]];

/* 1. 逐日判定：2025-01 ~ 2027-12 每一天 */
let dayChecked = 0;
for (const [label, raw] of cases) {
  const hdb = ctx.normalize(JSON.parse(JSON.stringify(raw)));
  const cdb = core.normalize(JSON.parse(JSON.stringify(raw)));
  ctx.DB = hdb;

  eq(label + '·normalize', JSON.stringify(hdb), JSON.stringify(cdb));

  for (let y = 2025; y <= 2027; y++) {
    for (let m = 1; m <= 12; m++) {
      eq(label + '·autoWorkdays ' + y + '-' + m, ctx.autoWorkdays(y, m), core.autoWorkdays(y, m));
      const n = new Date(y, m, 0).getDate();
      for (let d = 1; d <= n; d++) {
        const k = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        dayChecked++;
        eq(label + '·isWorkday ' + k, ctx.isWorkday(k), core.isWorkday(k));
        eq(label + '·isHoliday ' + k, ctx.isHoliday(k), core.isHoliday(k));
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
  '只有课程名没有星期\n周一 只有星期\n'
];
courseSamples.forEach(function (t, i) {
  eq('parseCourses#' + i, ctx.parseCourses(t, 16), core.parseCourses(t, 16));
});

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项；逐日核对 ' + dayChecked + ' 天');
if (bad.length) { console.log('\n失败样例：\n' + bad.join('\n')); process.exit(1); }
console.log('内核与 HTML 版完全一致');
