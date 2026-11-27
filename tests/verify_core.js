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

/* 电脑版注入了 CORE 段（core.js 全文的 IIFE），里面有同名的 qcsv / noteTags 等。
   下面这些「按名字找 HTML 函数」的定位必须从 CORE 段之后开始，否则会切进 IIFE 中间，
   拼出一段带裸 return 的代码。CORE 段本身留在 slice 里，vm 要先执行它才能拿到 Core。 */
const CORE_END_MARK = '/* >>> CORE:END <<< */';
const coreEndAt = html.indexOf(CORE_END_MARK);
const searchFrom = coreEndAt >= 0 ? coreEndAt + CORE_END_MARK.length : 0;

const csvStart = html.indexOf('function qcsv(', searchFrom);
const csvEnd = html.indexOf('/* 汇总页的「导出本月 CSV」');
if (csvStart < 0 || csvEnd < 0) throw new Error('CSV 切片失败');
const csvSlice = html.slice(csvStart, csvEnd);

const ctx = { console, document: { getElementById: () => null }, setTimeout, clearTimeout };
vm.createContext(ctx);
vm.runInContext(slice, ctx);
vm.runInContext(csvSlice, ctx);

/* 算法切片被「加密 / 存储」段切断，后面还有几个纯函数在两版都有同名实现。
   单独抽出来一起跑，别让它们悄悄落到测试覆盖之外。 */
function extractFn(text, mark) {
  const s = text.indexOf(mark, searchFrom);
  if (s < 0) { throw new Error('找不到 ' + mark); }
  const open = text.indexOf('{', s);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') { depth++; }
    else if (text[i] === '}') { depth--; if (depth === 0) { return text.slice(s, i + 1); } }
  }
  throw new Error('括号不配平 ' + mark);
}
const EXTRA_FNS = [
  'function ymOf(k){', 'function isYm(v){', 'function monthKeysOf(db){',
  'function hasContent(r){', 'function dayCount(db){', 'function localKeys(){',
  'function mergeMissingDays(src){',
  /* 备注/事项也是两版共用的纯函数，别落到覆盖之外 */
  'function noteTags(limit){', 'function monthNotes(ym){'
];
vm.runInContext(EXTRA_FNS.map(m => extractFn(html, m)).join('\n'), ctx);

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

/* 自己填的放假安排：2027 年另写一套春节（与内置不同，用来测自定义优先级）+ 2026 末尾补一天 + 一个补班周六 */
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

/* 晚修监考：按次给的补贴，不算课时、不占出勤半天 */
function mkNight() {
  const db = mkLegacy();
  /* 一个月 4 个晚上各监考一场，合计 4 次；不是「一晚 4 次」。
     单日上限 1 次由界面限幅，内核仍按次数累加，才接得住跨天合计与旧备份。 */
  db.days['2026-10-08'].night = 2;
  db.days['2026-10-10'].night = 1;
  /* 这天本来是默认上班日：从弹窗保存时 am/pm 会带上默认值，
     所以「只记晚修」不会把当天的出勤抹掉（下面另有专门断言） */
  db.days['2026-10-21'] = { am: 'work', pm: 'work', lessons: 0, note: '', night: 1 };
  return db;
}

const cases = [['空库', mkEmpty()], ['典型', mkLegacy()], ['半天周', mkAuto()],
  ['自定义假期', mkCustom()], ['多档单价', mkRates()], ['晚修监考', mkNight()]];

/* 1. 逐日判定：2025-01 ~ 2027-12 每一天 */
let dayChecked = 0;
for (const [label, raw] of cases) {
  const hdb = ctx.normalize(JSON.parse(JSON.stringify(raw)));
  const cdb = core.normalize(JSON.parse(JSON.stringify(raw)));
  ctx.DB = hdb;

  eq(label + '·normalize', JSON.stringify(hdb), JSON.stringify(cdb));
  eq(label + '·noteTags', ctx.noteTags(), core.noteTags(cdb));
  for (const ym of ['2026-09', '2026-10', '2026-11', '2027-01']) {
    eq(label + '·monthNotes ' + ym, ctx.monthNotes(ym), core.monthNotes(cdb, ym));
  }

  for (let y = 2025; y <= 2027; y++) {
    for (let m = 1; m <= 12; m++) {
      eq(label + '·autoWorkdays ' + y + '-' + m, ctx.autoWorkdays(y, m), core.autoWorkdays(y, m, cdb));
      const n = new Date(y, m, 0).getDate();
      for (let d = 1; d <= n; d++) {
        const k = y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
        dayChecked++;
        eq(label + '·isWorkday ' + k, ctx.isWorkday(k), core.isWorkday(k, cdb));
        eq(label + '·isHoliday ' + k, ctx.isHoliday(k), core.isHoliday(k, cdb));
        eq(label + '·isoWeek ' + k, ctx.isoWeek(k), core.isoWeek(k));
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

  /* 记过账的月份把附加档价格也冻住：冻结是写操作，由 freezeMonth 显式完成 */
  ctx.freezeMonth('2026-10'); core.freezeMonth(c, '2026-10');
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

/* 4.5 五险一金：设置页可改，默认 616；不按月冻结，两版同口径 */
{
  eq('五险一金·老备份缺字段补默认 616', core.normalize({}).settings.socialMonthly, 616);
  const db = core.normalize({ settings: { baseSalary: 8000, socialMonthly: 700 } });
  core.setRecord(db, '2026-11-03', 'work', 'work', 1, '');
  const cc = core.computeMonth(db, '2026-11');
  eq('五险一金·设置值生效', cc.social, 700);
  eq('五险一金·估算到手按设置值算', cc.net, core.round2(cc.total - 700));
  eq('五险一金·核对单写设置值',
    core.sumText(cc).indexOf('五险一金（每月固定）：700.00 元') >= 0, true);
  const csv = core.buildExportCsv(db, ['2026-11'], true, false);
  eq('五险一金·CSV 参数行写设置值', csv.indexOf('五险一金 700 元/月') >= 0, true);
  eq('五险一金·CSV 说明行写设置值', csv.indexOf('五险一金按设置每月扣 700.00 元') >= 0, true);
  ctx.DB = JSON.parse(JSON.stringify(db));
  eq('五险一金·两版月度结果一致', ctx.computeMonth('2026-11'), cc);
  eq('五险一金·两版 CSV 一致', stripTime(ctx.buildExportCsv(['2026-11'], true, false)), stripTime(csv));
  db.settings.socialMonthly = 888;
  const yc = core.computeYear(db, 2026);
  eq('五险一金·年度按有记录月份数×设置值', yc.social, 888);
  ctx.DB = JSON.parse(JSON.stringify(db));
  eq('五险一金·两版年度一致', ctx.computeYear(2026), yc);
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

  /* 7.2 记过一天：写记录时就落定，之后改设置不影响 */
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
    /* 标记已核对是写操作，页面会在落盘前显式冻结 */
    ctx.freezeMonth('2026-11'); core.freezeMonth(c, '2026-11');
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

  /* 7.5 只读不改库：算工资、导出都是纯读；只有写记录才把参数定下来 */
  {
    const { h, c } = fresh();
    ctx.DB = h;
    const before = JSON.stringify(c.months);
    core.computeMonth(c, '2026-11');
    ctx.computeMonth('2026-11');
    eq('冻结·computeMonth 不改库(内核)', JSON.stringify(c.months), before);
    eq('冻结·computeMonth 不改库(电脑版)', JSON.stringify(h.months), before);
    core.buildExportCsv(c, ['2026-11'], true, true);
    eq('冻结·导出 CSV 不改库', JSON.stringify(c.months), before);
    /* 写一天后才定参数，且两版一致 */
    ctx.setRecord('2026-11-03', 'work', 'work', 2, '');
    core.setRecord(c, '2026-11-03', 'work', 'work', 2, '');
    eq('冻结·写记录才冻', core.monthP(c, '2026-11').base, 8000);
    eq('冻结·写记录两版一致', ctx.monthP('2026-11').base, core.monthP(c, '2026-11').base);
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
  eq('粘贴·没导入时按内置 2027 春节算', core.autoWorkdays(2027, 2, core.blankDB()), 15);
  eq('粘贴·内置表生效后两版仍一致', ctx.autoWorkdays(2027, 2), 15);
}

/* ---------- 8.5 2027 内置表：国办发明电〔2026〕10号（2026-11-05 发布） ----------
   逐日比对只保证两版一样，这里钉死官方原文：放假段、补班日，以及
   「联网获取解析出来的内容」必须与内置表逐段相同。数据来源 gov.cn 原文 +
   holiday-cn 的 2027.json，两者逐条核过。 */
{
  const off = [
    ['2027-01-01', '2027-01-03'],
    ['2027-02-05', '2027-02-13'],
    ['2027-04-03', '2027-04-05'],
    ['2027-05-01', '2027-05-05'],
    ['2027-06-09', '2027-06-09'],
    ['2027-09-15', '2027-09-15'],
    ['2027-10-01', '2027-10-07']
  ];
  const makeup = ['2027-01-31', '2027-02-14', '2027-05-08', '2027-09-26', '2027-10-09'];
  const db = core.blankDB();
  const wd = (k) => core.isWorkday(k, db);
  eq('2027·依据文号', ctx.HOLIDAYS[2027].note, '国办发明电〔2026〕10号');
  eq('2027·内置放假段', ctx.HOLIDAYS[2027].spans, off);
  eq('2027·内置补班日', ctx.HOLIDAYS[2027].makeup, makeup);
  eq('2027·内置年份清单', Object.keys(ctx.HOLIDAYS).sort(), ['2026', '2027']);

  /* 把官方逐日记录还原出来，走同一条解析路径，验证「抓到的 == 内置的」 */
  const days = [];
  off.forEach(function (s) {
    const a = Date.parse(s[0] + 'T00:00:00Z'), b = Date.parse(s[1] + 'T00:00:00Z');
    for (let t = a; t <= b; t += 86400000) { days.push({ date: new Date(t).toISOString().slice(0, 10), isOffDay: true }); }
  });
  makeup.forEach(function (k) { days.push({ date: k, isOffDay: false }); });
  const paper = 'https://www.gov.cn/zhengce/zhengceku/202611/content_7085102.htm';
  const raw = { year: 2027, papers: [paper], days: days };
  const parsed = core.parseHolidayJson(raw, 2027);
  eq('2027·解析出 7 段 29 天假', [parsed.off.length, parsed.offDays], [7, 29]);
  eq('2027·解析出 5 天补班', parsed.workDays, 5);
  eq('2027·解析与内置放假段一致', parsed.off, off);
  eq('2027·解析与内置补班一致', parsed.work.map((s) => s[0]), makeup);
  eq('2027·解析两版一致', ctx.parseHolidayJson(raw, 2027).off, parsed.off);
  eq('2027·带原文链接', parsed.note, paper);

  /* 官方通知逐条：一 Jan 3 天、春节 9 天、清明/劳动/国庆与 5 个补班日 */
  eq('2027·元旦 1/1~1/3 休，1/4 上班',
    ['2027-01-01', '2027-01-03', '2027-01-04'].map(wd), [false, false, true]);
  eq('2027·春节前 1/31 补班', wd('2027-01-31'), true);
  eq('2027·除夕 2/5 起连休到 2/13',
    ['2027-02-05', '2027-02-08', '2027-02-12', '2027-02-13'].map(wd), [false, false, false, false]);
  eq('2027·2/14 补班', wd('2027-02-14'), true);
  eq('2027·清明 4/3~4/5 不调休',
    ['2027-04-03', '2027-04-05', '2027-04-06'].map(wd), [false, false, true]);
  eq('2027·劳动节 5/1~5/5，5/8 补班',
    ['2027-05-01', '2027-05-05', '2027-05-08'].map(wd), [false, false, true]);
  eq('2027·端午只放 6/9 一天', [wd('2027-06-09'), wd('2027-06-10')], [false, true]);
  eq('2027·中秋只放 9/15 一天', [wd('2027-09-15'), wd('2027-09-16')], [false, true]);
  eq('2027·国庆 10/1~10/7，9/26 与 10/9 补班',
    ['2027-09-26', '2027-10-01', '2027-10-07', '2027-10-09'].map(wd), [true, false, false, true]);
  eq('2027·2 月应上班 15 天', core.autoWorkdays(2027, 2, db), 15);
  eq('2027·10 月应上班 17 天', core.autoWorkdays(2027, 10, db), 17);
  eq('2027·全年应上班 248 天',
    Array.from({ length: 12 }, (_, i) => core.autoWorkdays(2027, i + 1, db)).reduce((a, b) => a + b, 0), 248);
  /* 自定义只盖住自己写过的段，其余仍走内置；不是「有自定义就整年退回朴素规则」 */
  const mix = core.blankDB();
  mix.settings.holidays = { 2027: { off: [['2027-03-01', '2027-03-01']], work: [] } };
  eq('2027·自定义不影响内置春节', core.isWorkday('2027-02-08', mix), false);
  eq('2027·自定义自己那段生效', core.isWorkday('2027-03-01', mix), false);
}

/* ---------- 9. 晚修监考：两版一致之外，还得钉死「2 小时 10 元/次」这个业务口径 ---------- */
{
  const h = ctx.normalize(mkNight());
  const c = core.normalize(mkNight());
  ctx.DB = h;
  const plain = core.normalize(mkLegacy());
  const pc = core.computeMonth(plain, '2026-10');
  const hc = ctx.computeMonth('2026-10');
  const cc = core.computeMonth(c, '2026-10');

  eq('新库默认课时单价 30 元', [core.blankDB().settings.rate, core.blankDB().settings.rates[0].price], [30, 30]);
  eq('晚修·新库默认 2 小时 10 元', [core.blankDB().settings.nightHours, core.blankDB().settings.nightFee], [2, 10]);
  eq('晚修·老备份补上默认价', [plain.settings.nightHours, plain.settings.nightFee], [2, 10]);
  eq('晚修·两版逐字段一致', hc, cc);
  eq('晚修·次数', cc.nightCount, 4);
  eq('晚修·总时长', cc.nightHours, 8);
  eq('晚修·补贴金额', cc.nightFee, 40);
  eq('晚修·单价快照', [cc.nightHoursEach, cc.nightFeeEach], [2, 10]);
  eq('晚修·不进课时合计', cc.lessons, pc.lessons);
  eq('晚修·不占出勤半天', [cc.actual, cc.counted.work, cc.counted.inv, cc.counted.ot, cc.counted.leave],
    [pc.actual, pc.counted.work, pc.counted.inv, pc.counted.ot, pc.counted.leave]);
  eq('晚修·总额只多这一笔', cc.total, Math.round((pc.total + 40) * 100) / 100);
  eq('晚修·只记晚修也算有内容', core.hasContent(c.days['2026-10-21']), true);
  eq('晚修·有记录天数', cc.filledDays, pc.filledDays + 1);
  eq('晚修·天数与 hasContent 同口径', cc.filledDays,
    Object.keys(c.days).filter(k => k.slice(0, 7) === '2026-10' && core.hasContent(c.days[k])).length);

  const txt = core.sumText(cc);
  eq('晚修·核对单明细行', txt.indexOf('晚修监考：4 次 × 10 元/次 = 40.00 元（每次 2 小时，共 8 小时）') >= 0, true);
  eq('晚修·核对单有 ④', txt.indexOf('④ 晚修监考费：40.00 元') >= 0, true);
  eq('晚修·核对单两版一致', ctx.sumText(hc), txt);
  eq('晚修·没记就不出现 ④', core.sumText(pc).indexOf('④ 晚修监考费'), -1);

  const csv = core.buildExportCsv(c, ['2026-10'], true, true);
  eq('晚修·CSV 汇总有晚修列', csv.indexOf('晚修(次)') >= 0, true);
  eq('晚修·CSV 明细带次数', csv.split('\r\n').filter(l => l.indexOf('2026-10-21') >= 0)[0],
    '2026-10,2026-10-21,周三,上班,上班,0,,1,');
  eq('晚修·CSV 计薪参数带价格', csv.indexOf('晚修监考 2 小时 10 元/次') >= 0, true);
  eq('晚修·CSV 两版一致', ctx.buildExportCsv(['2026-10'], true, true)
    .split('\r\n').filter(l => l.indexOf('导出时间') < 0).join('\r\n'),
    csv.split('\r\n').filter(l => l.indexOf('导出时间') < 0).join('\r\n'));

  /* 记过账的月份按当时的价冻着，学校后来调价不追溯改旧账 */
  ctx.freezeMonth('2026-10'); core.freezeMonth(c, '2026-10');
  c.settings.nightFee = 25; h.settings.nightFee = 25;
  c.settings.nightHours = 3; h.settings.nightHours = 3;
  eq('晚修·改价不影响记过的月份', [core.computeMonth(c, '2026-10').nightFee, core.computeMonth(c, '2026-10').nightHours], [40, 8]);
  eq('晚修·两版冻结一致', [ctx.computeMonth('2026-10').nightFee, ctx.computeMonth('2026-10').nightHours], [40, 8]);
  eq('晚修·没记过的月份跟新价', core.nightOf(plain, '2028-01').fee, 10);

  /* 设置里改价后新建的记录按新价算 */
  const fresh = core.blankDB();
  fresh.settings.nightFee = 25;
  fresh.days['2026-11-03'] = { am: 'work', pm: 'work', lessons: 2, note: '', night: 2 };
  eq('晚修·新价生效', core.computeMonth(fresh, '2026-11').nightFee, 50);
  eq('晚修·nightOf 读设置', core.nightOf(fresh, '2026-11'), { hours: 2, fee: 25 });

  /* 学校口径「一次 2 小时、10 元」定死的：时长只写进核对单，不参与乘算。
     就算把时长改成 5 小时，一场也还是 10 元；这条钉死用户确认过的业务口径。 */
  const hrOnly = core.blankDB();
  hrOnly.settings.nightHours = 5;
  hrOnly.days['2026-11-03'] = { am: 'work', pm: 'work', lessons: 0, note: '', night: 1 };
  const hrC = core.computeMonth(hrOnly, '2026-11');
  eq('晚修·改时长不改金额', [hrC.nightFee, hrC.nightHours], [10, 5]);
  const hrH = ctx.normalize(core.blankDB());
  hrH.settings.nightHours = 5;
  hrH.days['2026-11-03'] = { am: 'work', pm: 'work', lessons: 0, note: '', night: 1 };
  ctx.DB = hrH;
  eq('晚修·改时长不改金额（两版一致）', ctx.computeMonth('2026-11').nightFee, 10);

  /* 改出勤、改课时不该顺手把晚修次数抹掉，只有显式传 0 才清 */
  const keep = core.blankDB();
  core.setRecord(keep, '2026-10-08', 'work', 'work', 4, '', true, 'default', 2);
  core.setRecord(keep, '2026-10-08', 'work', 'work', 3, '补一句');
  eq('晚修·改出勤沿用旧次数', keep.days['2026-10-08'].night, 2);
  core.setRecord(keep, '2026-10-08', 'work', 'work', 3, '补一句', true, 'default', 0);
  eq('晚修·显式传 0 才清掉', keep.days['2026-10-08'].night, undefined);
  const hk = ctx.normalize(core.blankDB());
  ctx.DB = hk;
  ctx.setRecord('2026-10-08', 'work', 'work', 4, '', true, 'default', 2);
  ctx.setRecord('2026-10-08', 'work', 'work', 3, '补一句');
  /* dayCount / localKeys 在算法切片之外（属于存储层），上面已经单独抽出来注入：
     只记了晚修的日子必须算「有记录」，也必须写进月份文件，否则绑定目录后会丢数据 */
  const nightOnly = { days: { '2026-10-21': { am: '', pm: '', lessons: 0, note: '', night: 1 } } };
  ctx.DB = nightOnly;
  eq('晚修·HTML dayCount 与内核同口径', ctx.dayCount(nightOnly), core.dayCount(nightOnly));
  eq('晚修·HTML dayCount 认晚修', ctx.dayCount(nightOnly), 1);
  eq('晚修·写盘清单认晚修', ctx.localKeys(), ['2026-10-21']);
  eq('晚修·hasContent 两版同判', ctx.hasContent(nightOnly.days['2026-10-21']), core.hasContent(nightOnly.days['2026-10-21']));
}

/* ---------- 10. 跨月对账：CSV 要看得见每个月实际按什么价算的 ----------
   上面大量断言是「两版一样」，这里钉的是「结果对不对」：
   10 月按旧价记过账，11 月才调价，导一份跨月 CSV 给财务，
   参数行如果只写当前设置价，旧月的金额就永远对不上账。 */
{
  const mkBoth = () => {
    const c = core.normalize(mkRates());
    const h = ctx.normalize(mkRates());
    [c, h].forEach(function (d) {
      d.days['2026-10-08'].night = 2;
      d.days['2026-11-03'].night = 1;
      d.days['2026-12-03'] = { am: 'work', pm: 'work', lessons: 2, note: '', night: 1 };
    });
    return { c, h };
  };
  const { c, h } = mkBoth();
  ctx.DB = h;
  /* 预置的账相当于「已经写过」，冻结走显式入口，不再靠渲染顺带触发 */
  ['2026-10', '2026-11', '2026-12'].forEach(function (ym) {
    core.freezeMonth(c, ym); ctx.freezeMonth(ym);
  });
  /* 学校从 11 月起涨价：正课 200、晚自习 150、晚修 3 小时 25 元/次 */
  [c, h].forEach(function (d) {
    d.settings.rate = 200;
    d.settings.rates[1].price = 150;
    d.settings.nightFee = 25;
    d.settings.nightHours = 3;
  });
  const months = ['2026-10', '2026-11', '2026-12', '2027-02'];
  const outC = core.buildExportCsv(c, months, true, false);
  const outH = ctx.buildExportCsv(months, true, false);
  eq('对账·冻价差异时两版 CSV 一致', stripTime(outH), stripTime(outC));

  const lines = outC.split('\r\n');
  const i = lines.findIndex(l => l.indexOf('各月实际采用的参数') >= 0);
  eq('对账·有逐月参数表', i >= 0, true);
  eq('对账·表头列全', lines[i + 1], '月份,基本工资(元/月),正课(元/节),晚自习(元/节),晚修每次(小时),晚修每次(元)');
  eq('对账·10 月按冻结的旧价', lines[i + 2], '2026-10,8000.00,120.00,80.00,2,10.00');
  eq('对账·11 月也按冻结的旧价', lines[i + 3], '2026-11,8000.00,120.00,80.00,2,10.00');
  eq('对账·12 月也按冻结的旧价', lines[i + 4], '2026-12,8000.00,120.00,80.00,2,10.00');
  eq('对账·没记过的月份跟新价', lines[i + 5], '2027-02,8000.00,200.00,150.00,3,25.00');
  eq('对账·当前设置行写的是新价', lines.some(l => l.indexOf('计薪参数（当前设置）') === 0
    && l.indexOf('晚修监考 3 小时 25 元/次') >= 0), true);
  eq('对账·10 月晚修补贴按 10 元算', core.computeMonth(c, '2026-10').nightFee, 20);
  eq('对账·2027-02 没记录不产生晚修费', core.computeMonth(c, '2027-02').nightFee, 0);
}

/* ---------- 10.5 文件合并：逐日按 upd 裁决，删除不被旧文件复活 ---------- */
{
  const local = ctx.normalize(mkLegacy());
  ctx.DB = local;
  const tomb = { am: '', pm: '', lessons: 0, note: '', off: true, upd: 9999999999999 };
  local.days['2026-10-08'] = tomb;
  const n1 = ctx.mergeMissingDays({ days: {
    '2026-10-08': { am: 'work', pm: 'work', lessons: 4, note: '文件里的旧记录', upd: 100 }
  }});
  eq('文件裁决·删除墓碑不被旧记录复活', local.days['2026-10-08'], tomb);
  eq('文件裁决·复活不算改动', n1, 0);
  ctx.mergeMissingDays({ days: {
    '2026-10-09': { am: 'inv', pm: 'inv', lessons: 1, note: '另一台电脑改的', upd: 9999999999998 }
  }});
  eq('文件裁决·文件较新的天被采用', local.days['2026-10-09'].note, '另一台电脑改的');
  const n3 = ctx.mergeMissingDays({ days: {
    '2026-11-20': { am: 'work', pm: 'work', lessons: 2, note: '文件独有的天', upd: 1 }
  }});
  eq('文件裁决·文件独有的天补进来', [n3, local.days['2026-11-20'].note], [1, '文件独有的天']);
}

/* ---------- 10.6 金额与口径：分项对得上、默认推算看得见、删档不伪装 ---------- */
{
  const r2 = function (x) { return Math.round(x * 100) / 100; };
  const amtDb = core.normalize(mkRates());
  ['2026-10', '2026-11', '2026-12'].forEach(function (ym) {
    const cc = core.computeMonth(amtDb, ym);
    eq('金额·' + ym + ' ①+② 等于一次舍入', r2(cc.basePart + cc.extraPart), r2(cc.dailyRate * cc.actual));
  });
  const g = core.blankDB();
  const gm = core.computeMonth(g, '2026-11');
  eq('默认推算·空库整月都被标出来', gm.ghostDays, gm.workdays);
  const g2 = ctx.normalize(core.blankDB());
  ctx.DB = g2;
  eq('默认推算·两版一致', ctx.computeMonth('2026-11').ghostDays, gm.ghostDays);
  eq('档位·删掉的档位不再伪装成正课', core.rateName(g, 'gone'), '已删除档位');
}

/* ---------- 10.7 口径：全勤只拿基本工资，课时费只来自真记的课时 ---------- */
{
  const q = core.blankDB();
  const qm = core.computeMonth(q, '2026-11');
  eq('口径·默认全勤只给基本工资', [qm.lessons, qm.lessonFee, qm.total], [0, 0, qm.base]);
  core.setRecord(q, '2026-11-03', 'work', 'work', 0, '');
  eq('口径·只记出勤没有课时费', core.computeMonth(q, '2026-11').lessonFee, 0);
  core.setRecord(q, '2026-11-04', 'work', 'work', 2, '');
  eq('口径·记 2 节才有 2 节的钱', core.computeMonth(q, '2026-11').lessonFee, 2 * core.monthRate(q, '2026-11'));
}

/* ---------- 10.8 手工导入放假安排：自动工作日重算，手填值保留 ---------- */
{
  const hw = core.blankDB();
  hw.months['2027-02'] = { workdays: core.autoWorkdays(2027, 2, hw), base: 8000, rate: 120 };
  hw.months['2027-03'] = { workdays: 17, base: 8000, rate: 120 };
  const hn = core.refreshWorkdays(hw, 2027);
  eq('放假导入·清掉自动值的月份数', hn, 1);
  eq('放假导入·自动值被清掉待重算', 'workdays' in hw.months['2027-02'], false);
  eq('放假导入·手填值保留', hw.months['2027-03'].workdays, 17);
  const hh = ctx.normalize(core.blankDB());
  ctx.DB = hh;
  hh.months['2027-02'] = { workdays: ctx.autoWorkdays(2027, 2), base: 8000, rate: 120 };
  hh.months['2027-03'] = { workdays: 17, base: 8000, rate: 120 };
  eq('放假导入·两版一致', ctx.refreshWorkdays(2027), hn);
  eq('放假导入·电脑版手填值也保留', hh.months['2027-03'].workdays, 17);
}

/* ---------- 10.5 金额快照：表驱动，钉死算法本身的正确性 ----------
   架构演进第 2 步之后两版是同一份源码，双版比对只能验「转发层映射对不对」，
   验不出「core.js 自己算错了」。这里用固定场景 + 人工核算出的期望值逐字段钉死
   computeMonth；以后加场景只要往 SNAP_CASES 里加一行数据，不用复制断言。

   基准日历：2026-11-01 是周日，全月 9 个周末日，内置放假表该月无调整
   → 21 个法定工作日。日薪 = 6000 / 21 ≈ 285.714…，出勤 3 天 → ① 857.14。 */
{
  function mkSnap(settings, days, months) {
    return core.normalize({
      v: 1, savedAt: 0,
      settings: Object.assign({
        baseSalary: 6000, rate: 100, startDate: '', weekPattern: [0, 1, 1, 1, 1, 1, 0],
        autoWork: false, autoLessons: false, enableBase: true, enableLesson: true,
        nightHours: 2, nightFee: 10, rates: [{ id: 'default', name: '正课', price: 100 }]
      }, settings || {}),
      months: months || {}, days: days || {},
      term: { start: '', defaultWeeks: 16 }, courses: []
    });
  }
  const DAYS_A = {
    '2026-11-02': { am: 'work', pm: 'work', lessons: 2, note: '' },
    '2026-11-03': { am: 'work', pm: 'work', lessons: 3, note: '', night: 1 },
    '2026-11-04': { am: 'inv', pm: 'ot', lessons: 0, note: '' }
  };
  const HOL_CUSTOM = {
    '2026': { off: [['2026-11-05', '2026-11-06']], work: [['2026-11-07', '2026-11-07']] }
  };

  /* expect 的键支持点路径（counted.work / byRate.1.fee），让用例保持纯数据。 */
  const SNAP_CASES = [
    {
      name: '基础四段式', db: mkSnap({}, DAYS_A),
      expect: {
        workdays: 21, half: 6, actual: 3, capped: 3, extra: 0,
        'counted.work': 4, 'counted.inv': 1, 'counted.ot': 1,
        basePart: 857.14, extraPart: 0, lessons: 5, lessonFee: 500,
        nightCount: 1, nightFee: 10, nightHours: 2, nightFeeEach: 10, nightHoursEach: 2,
        total: 1367.14
      }
    },
    {
      name: '多档单价', db: mkSnap({
        rate: 120,
        rates: [{ id: 'default', name: '正课', price: 120 }, { id: 'eve', name: '晚自习', price: 80 }]
      }, {
        '2026-11-02': { am: 'work', pm: 'work', lessons: 2, rid: 'eve' },
        '2026-11-03': { am: 'work', pm: 'work', lessons: 3, rid: 'default' }
      }),
      expect: {
        actual: 2, basePart: 571.43, lessons: 5, lessonFee: 520,
        'byRate.0.id': 'default', 'byRate.0.fee': 360,
        'byRate.1.id': 'eve', 'byRate.1.fee': 160,
        total: 1091.43
      }
    },
    {
      /* ①② 是同一次日薪乘算的拆分，尾差归 ②：3 天出勤、只算 1 天在编内 */
      name: '超出应上班天数', db: mkSnap({}, DAYS_A, { '2026-11': { workdays: 1 } }),
      expect: {
        workdays: 1, actual: 3, capped: 1, extra: 2,
        dailyRate: 6000, basePart: 6000, extraPart: 12000,
        lessonFee: 500, nightFee: 10, total: 18510
      }
    },
    {
      /* 2 小时只写进核对单，绝不按小时乘钱 */
      name: '晚修多次·时长不乘钱', db: mkSnap({}, {
        '2026-11-02': { am: 'work', pm: 'work', night: 1 },
        '2026-11-03': { am: 'work', pm: 'work', night: 1 }
      }),
      expect: {
        actual: 2, lessons: 0, nightCount: 2, nightFee: 20, nightHours: 4,
        nightFeeEach: 10, nightHoursEach: 2, total: 591.43
      }
    },
    {
      name: '自定义放假补班', db: mkSnap({ holidays: HOL_CUSTOM }, {}),
      expect: { workdays: 20, actual: 0, total: 0 }
    },
    {
      name: '入职起算', db: mkSnap({ startDate: '2026-11-03' }, DAYS_A),
      expect: {
        actual: 2, 'counted.work': 2, lessons: 3, lessonFee: 300,
        basePart: 571.43, nightFee: 10, total: 881.43
      }
    },
    {
      name: '关基本工资', db: mkSnap({ enableBase: false }, DAYS_A),
      expect: { dailyRate: 0, basePart: 0, extraPart: 0, lessonFee: 500, nightFee: 10, total: 510 }
    },
    {
      name: '关课时费', db: mkSnap({ enableLesson: false }, DAYS_A),
      expect: { basePart: 857.14, lessonFee: 0, nightFee: 10, total: 867.14 }
    },
    {
      /* 设置里改成 9000/200，当月仍按记账时冻住的 6000/100 算 */
      name: '冻结价不追溯', db: mkSnap({ baseSalary: 9000, rate: 200 }, DAYS_A,
        { '2026-11': { workdays: 21, base: 6000, rate: 100 } }),
      expect: { workdays: 21, basePart: 857.14, lessonFee: 500, total: 1367.14 }
    },
    {
      name: '空月份', db: mkSnap({}, {}),
      expect: { workdays: 21, actual: 0, ghostDays: 0, total: 0 }
    }
  ];

  function pick(o, path) {
    return path.split('.').reduce(function (v, k) { return v == null ? v : v[k]; }, o);
  }
  const r2 = function (v) { return Math.round(v * 100) / 100; };
  SNAP_CASES.forEach(function (t) {
    const c = core.computeMonth(t.db, '2026-11');
    Object.keys(t.expect).forEach(function (k) {
      eq('金额快照·' + t.name + '·' + k, pick(c, k), t.expect[k]);
    });
    eq('金额快照·' + t.name + '·总额等于注册表四项之和', c.total,
      r2(core.PAY_ITEMS.reduce(function (a, it) { return a + c[it.key]; }, 0)));
  });

  /* 自定义放假的逐日判定：11/5 周四原本上班改放假，11/7 周六原本休息改补班 */
  const holDb = mkSnap({ holidays: HOL_CUSTOM }, {});
  eq('金额快照·自定义放假·周四 11/5 不上班', core.isWorkday('2026-11-05', holDb), false);
  eq('金额快照·自定义放假·周六 11/7 补班', core.isWorkday('2026-11-07', holDb), true);

  /* 注册表每一项都必须在 computeMonth 结果里有对应金额，
     否则加新计薪项时会被 `|| 0` 静默吞掉、钱算少了却没人发现。 */
  const baseResult = core.computeMonth(SNAP_CASES[0].db, '2026-11');
  eq('计薪项注册表·每项都有对应金额字段',
    core.PAY_ITEMS.filter(function (it) { return baseResult[it.key] === undefined; })
      .map(function (it) { return it.key; }), []);
}

/* ---------- 备注标签分组：预设短词与自写长句分开 ---------- */
{
  const db = core.normalize(core.blankDB());
  ['考试一', '考试二', '考试三', '考试四', '考试五'].forEach(function (note, i) {
    db.days['2026-11-0' + (i + 1)] = { note: note, upd: 1000 + i };
  });
  const two = core.noteTags(db, 2);
  eq('标签·一行共8个（6预设+2最近）', two.length, 8);
  eq('标签·预设在前', two.slice(0, 6), core.NOTE_PRESETS);
  eq('标签·最近只取2个且按新到旧', two.slice(6), ['考试五', '考试四']);
  eq('标签·默认仍取4个（其它页面用）', core.noteTags(db).length, 10);
}

/* ---------- 10.6 schema 迁移框架 ---------- */
{
  eq('schema·当前版本', core.SCHEMA_VERSION, 3);
  eq('schema·日记录字段清单', core.DAY_FIELDS.map(function (f) { return f.key; }),
    ['am', 'pm', 'lessons', 'note', 'rid', 'night', 'off']);
  eq('schema·迁移表长度与版本匹配', core.MIGRATIONS.length, core.SCHEMA_VERSION - 1);
  const legacy = {
    v: 1, settings: {}, months: {}, term: {}, courses: [],
    days: { '2026-11-02': { am: 'inv', pm: 'ot', lessons: 1 } }
  };
  eq('schema·v1 数据原样保留', core.migrate(legacy).days['2026-11-02'].lessons, 1);
  eq('schema·v1 升到最新版本', core.migrate(legacy).v, 3);
  /* v1→v2：单价 0 升 30，手填过的价保留 */
  const oldRate = core.migrate({ v: 1, settings: { rate: 0, rates: [{ id: 'default', price: 0 }] } });
  eq('迁移·单价0升30', [oldRate.settings.rate, oldRate.settings.rates[0].price], [30, 30]);
  const keptRate = core.migrate({ v: 1, settings: { rate: 120, rates: [{ id: 'default', price: 120 }] } });
  eq('迁移·手填单价不动', [keptRate.settings.rate, keptRate.settings.rates[0].price], [120, 120]);
  const frozenRate = core.migrate({ v: 1, settings: { rate: 0 }, months: { '2026-10': { rate: 0 } } });
  eq('迁移·已冻结月份单价不动', frozenRate.months['2026-10'].rate, 0);

  /* v2→v3：当月及以后冻结价为 0 的按设置补齐（0 是「没填过价」不是「0 元」），历史月份仍不动 */
  const curYm = core.todayKey().slice(0, 7);
  const pastYm = core.addMonths(curYm, -1);
  const repair = {
    v: 2, term: {}, courses: [], days: {},
    settings: { rate: 30, rates: [{ id: 'default', price: 30 }, { id: 'eve', name: '晚自习', price: 80 }] },
    months: {}
  };
  repair.months[curYm] = { rate: 0, rates: { eve: 0 } };
  repair.months[pastYm] = { rate: 0, rates: { eve: 0 } };
  core.migrate(repair);
  eq('迁移·当月冻结单价0按设置补齐', repair.months[curYm].rate, 30);
  eq('迁移·当月档位快照0按设置补齐', repair.months[curYm].rates.eve, 80);
  eq('迁移·历史月份冻结价仍不动', [repair.months[pastYm].rate, repair.months[pastYm].rates.eve], [0, 0]);
  const future = {
    v: 99, settings: {}, months: {}, term: {}, courses: [],
    days: { '2026-11-02': { am: 'work', pm: 'work', lessons: 2 } }
  };
  eq('schema·未来版本不破坏数据', core.migrate(future).days['2026-11-02'].lessons, 2);
  eq('schema·未来版本不被降级', core.migrate(future).v, 99);
  eq('schema·normalize 走迁移后字段仍完整',
    core.normalize({ v: 1, days: { '2026-11-02': { am: 'work', lessons: 2 } } }).days['2026-11-02'].lessons, 2);
  /* 架构边界：MIGRATIONS 是行为（函数），只能住在 core.js。
     spec.js 会被 JSON.stringify 序列化成电脑版全局常量，函数会变成 null。 */
  const specMod = require(path.join(MP, 'utils', 'spec.js'));
  eq('schema·行为没被塞回可序列化的 spec.js',
    Object.prototype.hasOwnProperty.call(specMod, 'MIGRATIONS'), false);
  eq('schema·迁移表在 core.js 里且是函数容器', Array.isArray(core.MIGRATIONS), true);

  /* 生成链：spec.js 的每个导出都必须同时出现在电脑版的全局常量段
     （sync_spec 生成）和 CORE 段的 IIFE 参数里（gen_core_adapter 生成），
     否则 core 读到 undefined。检查产物而不是工具源码，自动生成/手写都能覆盖。 */
  const specKeys = Object.keys(require(path.join(MP, 'utils', 'spec.js')));
  const specSeg = html.slice(html.indexOf('/* >>> SPEC:START'), html.indexOf('/* >>> SPEC:END'));
  const coreSeg = html.slice(html.indexOf('/* >>> CORE:START'), html.indexOf('/* >>> CORE:END'));
  eq('生成链·spec 导出都生成了电脑版全局常量',
    specKeys.filter(function (k) { return specSeg.indexOf('var ' + k + '=') < 0; }), []);
  eq('生成链·spec 导出都进了 CORE 的 IIFE 参数',
    specKeys.filter(function (k) { return coreSeg.indexOf(k + ': ' + k) < 0; }), []);
}

/* ---------- 11. 覆盖哨兵：不许新函数悄悄落到测试之外 ----------
   架构演进第 2 步之后，HTML 的算法函数是 core.js 的转发层，CORE 段只是源码注入、
   **不算「被断言覆盖」**。所以这里只认真正生成了转发体的函数：core.js 里剩下的
   要么在 EXTRA_FNS 的单版断言里，要么在 MP_ONLY 白名单里并各有期望值断言。 */
{
  const collect = (text, re) => {
    const s = new Set(); let m; re.lastIndex = 0;
    while ((m = re.exec(text))) s.add(m[1]);
    return s;
  };
  const forwarded = collect(html.slice(searchFrom),
    /function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*return Core\./g);
  /* noteTags / monthNotes 放在 HTML 切片外，靠 EXTRA_FNS 抽取，上面已逐字段比对 */
  /* migrate 只在 core.js 内部被 normalize 调用，HTML 不需要转发；
     它有 10.6 节的单版期望值断言，不算落到测试之外。 */
  /* mondayOf 是 weekOf 的内部辅助，UI 不需要转发；它和 weekOf 一样有单版期望值断言 */
  const extra = new Set(['ymOf', 'isYm', 'monthKeysOf', 'hasContent', 'dayCount', 'localKeys',
    'noteTags', 'monthNotes', 'migrate', 'mondayOf']);
  const coreFns = collect(fs.readFileSync(path.join(MP, 'utils', 'core.js'), 'utf8'),
    /function\s+([A-Za-z_$][\w$]*)\s*\(/g);
  /* HTML 里是内联等价实现（或小程序页面专属），没法并排比，只能钉死期望值 */
  const MP_ONLY = ['addHolidaySpan', 'clearHolidayYear', 'daysInMonth', 'delHolidaySpan', 'dowLabel',
    'fillLessonsFromCourses', 'firstWeekdayOf', 'holidayOf', 'holidayYears'].sort();
  const uncovered = [...coreFns]
    .filter(n => !forwarded.has(n) && !extra.has(n) && MP_ONLY.indexOf(n) < 0).sort();
  eq('哨兵·core.js 里没有落到测试之外的函数', uncovered, []);
  eq('哨兵·白名单里的函数确实都导出了',
    MP_ONLY.filter(n => typeof core[n] !== 'function').length, 0);
  eq('哨兵·转发层数量（少一个说明 HTML 被手改过）', forwarded.size, 66);
  /* 内部函数（table / customOf / inSpan / toHalf / dateNum 等）没进 module.exports，
     但确实在 core.js 里、也被 CORE bundle 导出了，所以按源码函数清单判，不按导出对象判。 */
  eq('哨兵·转发层没有指向不存在的函数',
    [...forwarded].filter(n => !coreFns.has(n)).sort(), []);

  const legacy = core.normalize(mkLegacy());
  eq('额外抽取·monthKeysOf 两版一致', ctx.monthKeysOf(ctx.normalize(mkLegacy())), core.monthKeysOf(legacy));
  eq('额外抽取·monthKeysOf 钉死月份', core.monthKeysOf(legacy), ['2026-09', '2026-10', '2026-11', '2027-01']);
  eq('额外抽取·ymOf', core.ymOf('2026-10-08'), '2026-10');
  eq('额外抽取·isoWeek 跨年', [core.isoWeek('2026-01-01'), core.isoWeek('2026-12-31'),
    core.isoWeek('2027-01-01'), core.isoWeek('2026-11-17')], [1, 53, 53, 47]);
  eq('额外抽取·isYm', [core.isYm('2026-10'), core.isYm('2026-10-01'), core.isYm('x')], [true, false, false]);
  eq('额外抽取·hasContent 两版同判', ctx.hasContent({ night: 1 }), core.hasContent({ night: 1 }));
  eq('额外抽取·dayCount 两版同数', ctx.dayCount(legacy), core.dayCount(legacy));

  eq('小程序专属·daysInMonth', [core.daysInMonth('2026-02'), core.daysInMonth('2028-02'),
    core.daysInMonth('2026-10'), core.daysInMonth('2026-11')], [28, 29, 31, 30]);
  eq('小程序专属·firstWeekdayOf', core.firstWeekdayOf('2026-10'), 4);
  eq('小程序专属·dowLabel', core.dowLabel('2026-10-21'), '三');

  const hol = core.blankDB();
  eq('小程序专属·holidayOf 自动建表', core.holidayOf(hol, 2027), { off: [], work: [] });
  eq('小程序专属·addHolidaySpan 起止颠倒会纠正',
    (core.addHolidaySpan(hol, 2027, 'off', '2027-02-12', '2027-02-06'), hol.settings.holidays['2027'].off[0]),
    ['2027-02-06', '2027-02-12']);
  eq('小程序专属·holidayYears', core.holidayYears(hol), [2027]);
  eq('小程序专属·delHolidaySpan',
    [core.delHolidaySpan(hol, 2027, 'off', 0), core.delHolidaySpan(hol, 2027, 'off', 9)], [true, false]);
  eq('小程序专属·删空后不算自定义年份', core.holidayYears(hol), []);
  eq('小程序专属·clearHolidayYear',
    [core.clearHolidayYear(hol, 2027), core.clearHolidayYear(hol, 2027)], [true, false]);

  /* 按课程表填课时：不能覆盖已经手填过的日子，填进去的必须等于课程表推算值 */
  const fdb = core.normalize(mkLegacy());
  const kept = fdb.days['2026-10-08'].lessons;
  const before = new Set(Object.keys(fdb.days));
  const fr = core.fillLessonsFromCourses(fdb, '2026-10');
  eq('小程序专属·填课时不覆盖手填记录', fdb.days['2026-10-08'].lessons, kept);
  eq('小程序专属·确实填了新课时', fr.filled > 0, true);
  const badFill = Object.keys(fdb.days).filter(function (k) {
    return !before.has(k) && fdb.days[k].lessons !== core.lessonsFor(fdb, k);
  });
  eq('小程序专属·新填的都等于课程表推算值', badFill, []);
}

/* ---------- 11.5 课程表课时自动落账：两版并排 + 钉死口径 ---------- */
{
  const raw = mkLegacy();
  const hdb = ctx.normalize(JSON.parse(JSON.stringify(raw)));
  const cdb = core.normalize(JSON.parse(JSON.stringify(raw)));
  ctx.DB = hdb;
  const YM = '2026-11', TODAY = '2026-11-06';
  const rh = ctx.autoFillLessons(YM, TODAY);
  const rc = core.autoFillLessons(cdb, YM, TODAY);
  eq('自动落账·两版返回值一致', rh, rc);
  /* upd 是 Date.now()，两版跑在不同毫秒，比对时剔除 */
  const normDays = function (d) {
    const o = {};
    Object.keys(d.days).sort().forEach(function (k) {
      const r = Object.assign({}, d.days[k]); delete r.upd; o[k] = r;
    });
    return o;
  };
  eq('自动落账·两版落盘逐字段一致', normDays(hdb), normDays(cdb));
  eq('自动落账·钉死只补 1 天（周一 4 节）', rc.filled, 1);
  eq('自动落账·钉死跳过 1 天已手填', rc.skipped, 1);
  eq('自动落账·未来 24 天不预填', rc.future, 24);
  eq('自动落账·11-02 记入 4 节并钉死 lset',
    [cdb.days['2026-11-02'].lessons, cdb.days['2026-11-02'].lset], [4, true]);
  eq('自动落账·11-02 顺手带上默认出勤',
    [cdb.days['2026-11-02'].am, cdb.days['2026-11-02'].pm], ['work', 'work']);
  eq('自动落账·11-03 手填的 4 节没被覆盖', cdb.days['2026-11-03'].lessons, 4);
  eq('自动落账·11-04 手填的 0 节没被顶回课表', cdb.days['2026-11-04'].lessons, 0);
  eq('自动落账·未来日期没产生新记录',
    Object.keys(cdb.days).filter(k => k.slice(0, 7) === YM && k > TODAY && !raw.days[k]), []);
  eq('自动落账·幂等，再跑一次不重复写', core.autoFillLessons(cdb, YM, TODAY).filled, 0);
  /* 时间往后走，原先「未来」的日子变成过去，按当时的课程表补上 */
  const later = core.autoFillLessons(cdb, YM, '2026-11-20');
  eq('自动落账·日子过去后补 2 天', later.filled, 2);
  eq('自动落账·补上的仍等于课程表推算值',
    Object.keys(cdb.days).filter(function (k) {
      return k.slice(0, 7) === YM && k > TODAY && k <= '2026-11-20' && !raw.days[k] &&
        cdb.days[k].lessons !== core.lessonsFor(cdb, k);
    }), []);
  /* 三种「不该动账」的情形 */
  const off = core.normalize(JSON.parse(JSON.stringify(raw)));
  off.settings.autoLessons = false;
  eq('自动落账·关掉开关整月不动', core.autoFillLessons(off, YM, TODAY).reason, 'off');
  eq('自动落账·关掉开关不写记录', off.days['2026-11-02'], undefined);
  const ck = core.normalize(JSON.parse(JSON.stringify(raw)));
  ck.months[YM] = { checked: true };
  eq('自动落账·已核对月份整月不动', core.autoFillLessons(ck, YM, TODAY).reason, 'checked');
  eq('自动落账·已核对月份不写记录', ck.days['2026-11-02'], undefined);
  eq('自动落账·翻看旧月不改账',
    core.autoFillLessons(core.normalize(JSON.parse(JSON.stringify(raw))), '2026-10', TODAY).reason,
    'not-current');
  eq('自动落账·没课表直接跳过',
    core.autoFillLessons(core.normalize(mkEmpty()), YM, TODAY).reason, 'no-courses');
  eq('自动落账·老备份没这个字段时默认开',
    core.normalize(mkEmpty()).settings.autoLessons, true);
}

/* ---------- 12. 计薪开关：④ 是独立补贴，别被别的开关顺手关掉 ----------
   设置页文案已经写明「关课时费不影响晚修」「关加班不抹掉已记的记录」，
   这里把这几句话钉成断言，改文案或改实现时都会有人被提醒。 */
{
  const d = core.normalize(mkNight());
  const base = core.computeMonth(d, '2026-10');
  d.settings.enableLesson = false;
  const noLesson = core.computeMonth(d, '2026-10');
  eq('开关·关课时费③归零', noLesson.lessonFee, 0);
  eq('开关·关课时费④照给', noLesson.nightFee, base.nightFee);
  d.settings.enableLesson = true;
  d.settings.enableBase = false;
  const noBase = core.computeMonth(d, '2026-10');
  eq('开关·关基本工资①②归零', [noBase.basePart, noBase.extraPart], [0, 0]);
  eq('开关·关基本工资④照给', noBase.nightFee, base.nightFee);
  d.settings.enableBase = true;
  d.settings.enableOt = false;
  const noOt = core.computeMonth(d, '2026-10');
  eq('开关·关加班不抹掉已记的加班半天', noOt.counted.ot, base.counted.ot);
  eq('开关·关加班不抹掉④', noOt.nightFee, base.nightFee);
}

/* ---------- 教学周边界：年历右侧 W 列的取值口径 ---------- */
{
  const d = core.normalize(core.blankDB());
  eq('教学周·未设基准返回 null', core.weekOf(d, '2026-09-03'), null);
  d.term.start = '2026-09-03';              /* 用户场景：9 月 3 日开学，那一周是第 1 教学周 */
  eq('教学周·开学当天是 W1', core.weekOf(d, '2026-09-03'), 1);
  eq('教学周·同周内仍是 W1', core.weekOf(d, '2026-09-06'), 1);
  eq('教学周·下一自然周周一是 W2', core.weekOf(d, '2026-09-07'), 2);
  eq('教学周·W2 整周都是 W2', core.weekOf(d, '2026-09-10'), 2);
  eq('教学周·再下周一是 W3', core.weekOf(d, '2026-09-14'), 3);
  eq('教学周·同周内开学前的日子也算 W1', core.weekOf(d, '2026-09-02'), 1);
  eq('教学周·上一自然周返回 0', core.weekOf(d, '2026-08-30'), 0);
  eq('教学周·超出默认周数照实递增', core.weekOf(d, '2026-12-03'), 14);
  /* mondayOf 是 weekOf 的内部辅助，也钉死期望值，别成为覆盖哨兵的漏网之鱼 */
  eq('教学周·基准日归到所在周一', core.mondayOf('2026-09-03'), '2026-08-31');
  eq('教学周·周日归到本周一', core.mondayOf('2026-09-06'), '2026-08-31');
  /* 两版的年历都读这个口径，边界值必须在转发层也一致 */
  ctx.DB = d;
  eq('教学周·HTML 转发层 W1 一致', ctx.weekOf('2026-09-03'), core.weekOf(d, '2026-09-03'));
  eq('教学周·HTML 转发层下一周一致', ctx.weekOf('2026-09-07'), core.weekOf(d, '2026-09-07'));
  eq('教学周·HTML 转发层上一周一致', ctx.weekOf('2026-08-30'), core.weekOf(d, '2026-08-30'));
}

/* ---------- 年度汇总：逐月同口径累加，总额按注册表给 ---------- */
{
  /* 完全独立的账本：mkNight() 等前面被别的断言共享修改过，别拿来当年度基线 */
  const db = core.normalize(core.blankDB());
  db.settings.baseSalary = 6000;
  db.settings.rate = 100;
  db.days['2026-10-08'] = { am: 'work', pm: 'work', lessons: 4, note: '', night: 1, upd: 1 };
  db.days['2026-11-03'] = { am: 'work', pm: 'inv', lessons: 2, note: '', night: 0, upd: 2 };
  const yc = core.computeYear(db, 2026);
  const oct = core.computeMonth(db, '2026-10');
  const nov = core.computeMonth(db, '2026-11');
  eq('年度·12 个月都算到', yc.months.length, 12);
  eq('年度·有记录的月份数=2', yc.paidMonths, 2);
  /* 空月份按「默认全勤」也会算出勤和工资（项目既有口径），所以期望必须是 12 个月全加 */
  const sumOf = function (key) {
    return core.round2(yc.months.reduce(function (s, m) { return s + (m[key] || 0); }, 0));
  };
  eq('年度·课时=12 月之和', yc.lessons, yc.months.reduce(function (s, m) { return s + m.lessons; }, 0));
  eq('年度·晚修=12 月之和', yc.nightCount, yc.months.reduce(function (s, m) { return s + m.nightCount; }, 0));
  eq('年度·①=12 月之和', yc.basePart, sumOf('basePart'));
  eq('年度·③=12 月之和', yc.lessonFee, sumOf('lessonFee'));
  eq('年度·④=12 月之和', yc.nightFee, sumOf('nightFee'));
  eq('年度·总额=12 月之和', yc.total, sumOf('total'));
  eq('年度·总额=四段之和', yc.total,
    core.round2(yc.basePart + yc.extraPart + yc.lessonFee + yc.nightFee));
  eq('年度·出勤=12 月之和', yc.actual, sumOf('actual'));
  eq('年度·换年只算该年月份', core.computeYear(db, 2025).months[0].ym, '2025-01');
  eq('年度·换年不带入本年课时', core.computeYear(db, 2025).lessons, 0);
  eq('年度·非法年份返回 null', core.computeYear(db, 'xxxx'), null);
  /* 两版吃同一份数据；先重置 DB 再算，避免前面断言残留的 db 影响 */
  const hdb = JSON.parse(JSON.stringify(db));
  ctx.DB = hdb;
  const hy = ctx.computeYear(2026);
  eq('年度·HTML 版总计一致', hy.total, yc.total);
  eq('年度·HTML 版课时一致', hy.lessons, yc.lessons);
  eq('年度·HTML 版晚修一致', hy.nightCount, yc.nightCount);
  eq('年度·HTML 版月份数一致', hy.months.length, yc.months.length);
}

/* ---------- 改工资同步当月及以后：历史冻结不动 ---------- */
{
  const db = core.normalize(core.blankDB());
  /* 10 月（历史）、11 月（当月）、12 月（以后）都冻了旧值 8000；
     次年 1 月没冻结（base 为 null）不该被写入；另造一条历史未冻结的 9 月 */
  db.months['2026-10'] = { base: 8000 };
  db.months['2026-11'] = { base: 8000 };
  db.months['2026-12'] = { base: 8000 };
  db.months['2027-01'] = {};
  const n = core.syncBaseForward(db, 9000, '2026-11-20');
  eq('工资同步·改动月份数=2（当月+以后）', n, 2);
  eq('工资同步·历史10月不动', db.months['2026-10'].base, 8000);
  eq('工资同步·当月11月改新值', db.months['2026-11'].base, 9000);
  eq('工资同步·以后12月改新值', db.months['2026-12'].base, 9000);
  eq('工资同步·未冻结的次月不写入', db.months['2027-01'].base, undefined);
  eq('工资同步·重跑不再计数', core.syncBaseForward(db, 9000, '2026-11-20'), 0);
  /* 两版转发层一致 */
  ctx.DB = JSON.parse(JSON.stringify(db));
  ctx.DB.months['2026-11'].base = 8000;
  ctx.DB.months['2026-12'].base = 8000;
  eq('工资同步·HTML版当月改新值', ctx.syncBaseForward(9000, '2026-11-20'), 2);
  eq('工资同步·HTML版历史不动', ctx.DB.months['2026-10'].base, 8000);
}

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项；逐日核对 ' + dayChecked + ' 天');
if (bad.length) { console.log('\n失败样例：\n' + bad.join('\n')); process.exit(1); }
console.log('内核与 HTML 版完全一致');
