/* 用 Node 模拟小程序运行时，真实执行页面逻辑 */
const path = require('path');
const ROOT = path.resolve(__dirname, '..', 'teaching-attendance-mp');
const core = require(path.join(ROOT, 'utils/core.js'));

let pass = 0, fail = 0;
const bad = [];
function ok(cond, name, extra) {
  if (cond) { pass++; } else { fail++; bad.push(name + (extra ? '  → ' + extra : '')); }
}

/* ---------- wx 桩 ---------- */
const mem = {};
let toasts = [], modals = [], nextSheetPick = 0;
global.wx = {
  getStorageSync: k => (mem[k] === undefined ? '' : mem[k]),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: k => { delete mem[k]; },
  showToast: o => { toasts.push(o.title); },
  showModal: o => { modals.push(o.content); if (o.success) { o.success({ confirm: true, cancel: false }); } },
  showActionSheet: o => { if (o.success) { o.success({ tapIndex: nextSheetPick }); } },
  getDeviceInfo: () => ({ platform: 'ios' }),
  env: { USER_DATA_PATH: '/tmp' },
  getFileSystemManager: () => ({
    writeFile: o => { o.success && o.success(); },
    readFileSync: () => '{}'
  }),
  shareFileMessage: o => { o.success && o.success(); }
};

/* ---------- Page 桩 ---------- */
let captured = null;
global.Page = o => { captured = o; };

function setPath(obj, key, val) {
  const parts = key.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (o[parts[i]] == null) { o[parts[i]] = {}; }
    o = o[parts[i]];
  }
  o[parts[parts.length - 1]] = val;
}

function makePage(name) {
  const file = path.join(ROOT, 'pages', name, name + '.js');
  delete require.cache[require.resolve(file)];
  captured = null;
  require(file);
  const cfg = captured;
  const inst = Object.create(cfg);
  inst.data = JSON.parse(JSON.stringify(cfg.data || {}));
  inst.setData = function (patch, cb) {
    Object.keys(patch).forEach(k => {
      if (k.indexOf('.') >= 0) { setPath(inst.data, k, patch[k]); }
      else { inst.data[k] = patch[k]; }
    });
    if (cb) { cb(); }
  };
  return inst;
}

function seedDb(extra) {
  const db = core.normalize(Object.assign({
    v: 1, savedAt: 0,
    settings: {
      autoWork: true, weekPattern: [0, 1, 1, 1, 1, 1, 0],
      baseSalary: 8000, rate: 120, startDate: '2026-09-21', enableBase: true, enableLesson: true
    },
    months: {}, days: {}, term: { start: '2026-09-21', defaultWeeks: 16 },
    courses: [{ id: 'a', name: '语文', weekday: 1, lessons: 4, startWeek: 1, endWeek: 16, parity: 'all' }]
  }, extra || {}));
  mem['kqzb_db_v1'] = JSON.stringify(db);
  return db;
}
function current() {
  const raw = mem['kqzb_db_v1'];
  return raw ? JSON.parse(raw) : null;
}
function reset() { Object.keys(mem).forEach(k => delete mem[k]); toasts = []; modals = []; nextSheetPick = 0; }

/* ================= 记账页 ================= */
reset();
seedDb();
const cal = makePage('calendar');
cal.onLoad();

ok(cal.data.ym === core.todayKey().slice(0, 7), '记账页默认定位到本月', cal.data.ym);
ok(cal.data.cells.length > 27, '月历格子数量合理', cal.data.cells.length);
const blanks = cal.data.cells.filter(c => c.blank).length;
const nDays = core.daysInMonth(cal.data.ym);
ok(blanks + nDays === cal.data.cells.length, '空白格 + 日期格 = 总数');
ok(cal.data.cells.filter(c => !c.blank).every(c => c.lesText !== undefined), '每个日期格都有课时文案');

/* 状态与默认出勤 */
const firstWork = cal.data.cells.filter(c => !c.blank && /s-work/.test(c.amCls))[0];
ok(!!firstWork, '法定工作日显示为上班（默认出勤生效）');

/* 打开编辑面板 */
cal.tapCell({ currentTarget: { dataset: { key: '2026-11-03' } } });
ok(cal.data.sheet && cal.data.sheet.key === '2026-11-03', '点格子打开编辑面板');
ok(cal.data.sheet.am === 'work' && cal.data.sheet.pm === 'work', '面板带出当天默认状态', JSON.stringify(cal.data.sheet && { am: cal.data.sheet.am, pm: cal.data.sheet.pm }));
ok(/法定上班日/.test(cal.data.sheet.sub), '面板说明当天性质', cal.data.sheet.sub);

/* 改成加班 + 4 节，保存 */
cal.pickHalf({ currentTarget: { dataset: { which: 'am', v: 'ot' } } });
ok(cal.data.sheet.am === 'ot', '上午改成加班');
cal.setData({ 'sheet.lessons': 4 });
cal.onNote({ detail: { value: '晚自习' } });
cal.saveSheet();
const db1 = current();
ok(db1.days['2026-11-03'] && db1.days['2026-11-03'].am === 'ot', '保存后写入本地存储', JSON.stringify(db1.days['2026-11-03']));
ok(db1.days['2026-11-03'].note === '晚自习', '备注一并保存');
ok(db1.days['2026-11-03'].lessons === 4, '课时一并保存');
ok(cal.data.sheet === null, '保存后面板关闭');

/* 再点同一天，取消上午（点同一个值应清空） */
cal.tapCell({ currentTarget: { dataset: { key: '2026-11-03' } } });
cal.pickHalf({ currentTarget: { dataset: { which: 'am', v: 'ot' } } });
ok(cal.data.sheet.am === '', '再次点同一状态会清空该半天');
cal.closeSheet();

/* 入职前不允许编辑 */
cal.tapCell({ currentTarget: { dataset: { key: '2026-09-01' } } });
ok(cal.data.sheet === null && toasts.some(t => /入职起算日/.test(t)), '入职前的日子拒绝编辑');

/* 按课程表填课时 */
const before = core.computeMonth(core.normalize(current()), cal.data.ym);
cal.fillCourse();
const after = core.computeMonth(core.normalize(current()), cal.data.ym);
ok(after.lessons > 0, '按课程表填入了课时', after.lessons + ' 节');
ok(after.actual === before.actual, '填空课时没有破坏出勤天数', before.actual + ' → ' + after.actual);

/* 撤销：填课时后撤销，应回到填之前 */
cal.doUndo();
const afterUndo = core.computeMonth(core.normalize(current()), cal.data.ym);
ok(afterUndo.lessons === before.lessons, '撤销把课时恢复原状', before.lessons + ' → ' + afterUndo.lessons);

/* 撤销条：5 秒自动收起，也可点 × 立即关闭 */
const realST = global.setTimeout;
let undoDelay = null;
global.setTimeout = function (fn, ms) { undoDelay = ms; return realST(fn, 60000); };
cal.fillCourse();
global.setTimeout = realST;
ok(!!cal.data.undo, '操作后弹出撤销条', JSON.stringify(cal.data.undo));
ok(undoDelay === 5000, '撤销条 5 秒后自动收起', String(undoDelay));
cal.hideUndo();
ok(cal.data.undo === null, '点 × 立即关闭撤销条');
ok(cal._undo === null && !cal._undoTimer, '关闭后撤销快照与计时器一并清掉');

/* 清空一个法定工作日：要留下"明确不上班"的墓碑，不能被默认值顶回来 */
cal.tapCell({ currentTarget: { dataset: { key: '2026-11-04' } } });
cal.clearSheet();
cal.saveSheet();
const tomb = current().days['2026-11-04'];
ok(tomb && tomb.off === true, '清空法定工作日留下 off 墓碑', JSON.stringify(tomb));
ok(core.effHalf(core.normalize(current()), '2026-11-04', 'am') === '', '清空后该日不再算上班');

/* ================= 多选 + 批量套用 ================= */
reset();
seedDb();
const bcal = makePage('calendar');
bcal.onLoad();
ok(bcal.data.ym === '2026-11', '批量测试固定在 2026-11', bcal.data.ym);

bcal.toggleSel();
ok(bcal.data.sel === true, '点「多选」进入选择模式');
bcal.toggleSelKey({ currentTarget: { dataset: { key: '2026-11-05' } } });
bcal.toggleSelKey({ currentTarget: { dataset: { key: '2026-11-06' } } });
ok(bcal.data.selKeys.length === 2, '点日期加入选区', JSON.stringify(bcal.data.selKeys));
ok(bcal.data.cells.filter(c => c.sel).length === 2, '选中的格子带高亮标记');
bcal.toggleSelKey({ currentTarget: { dataset: { key: '2026-11-06' } } });
ok(bcal.data.selKeys.length === 1, '再点一次取消选中');
bcal.toggleSelKey({ currentTarget: { dataset: { key: '2026-11-06' } } });

bcal.applySel({ currentTarget: { dataset: { st: 'inv' } } });
const inv5 = current().days['2026-11-05'], inv6 = current().days['2026-11-06'];
ok(inv5 && inv5.am === 'inv' && inv5.pm === 'inv', '整片套用监考（上午下午都设）', JSON.stringify(inv5));
ok(inv6 && inv6.pm === 'inv', '选区里的第二天同样被套用');
ok(bcal.data.sel === false && !bcal.data.selKeys.length, '套用后自动退出选择模式');
ok(!!bcal.data.undo, '批量套用后弹出撤销条');
bcal.doUndo();
ok(!current().days['2026-11-05'] && !current().days['2026-11-06'], '批量套用可整体撤销');

bcal.toggleSel();
bcal.toggleSelKey({ currentTarget: { dataset: { key: '2026-11-09' } } });
bcal.pickScope({ currentTarget: { dataset: { s: 'am' } } });
bcal.applySel({ currentTarget: { dataset: { st: 'work' } } });
const am9 = current().days['2026-11-09'];
ok(am9 && am9.am === 'work' && am9.pm === '', '「只上午」只设上午', JSON.stringify(am9));
ok(core.effHalf(core.normalize(current()), '2026-11-09', 'pm') === '', '下午仍为空，没有被顺手设成上班');

bcal.tapCell({ currentTarget: { dataset: { key: '2026-11-10' } } });
bcal.setData({ 'sheet.lessons': 4 });
bcal.saveSheet();
bcal.toggleSel();
bcal.toggleSelKey({ currentTarget: { dataset: { key: '2026-11-10' } } });
bcal.toggleClearLes();
ok(bcal.data.clearLes === true, '「课时清零」可切换');
bcal.applySel({ currentTarget: { dataset: { st: 'work' } } });
const cl10 = current().days['2026-11-10'];
ok(cl10.lessons === 0 && cl10.lset === true, '连课时清零后记成明确 0 节', JSON.stringify(cl10));

bcal.toggleSel();
bcal.selAllWorkdays();
let wdNov = 0;
for (let d = 1; d <= 30; d++) { if (core.isWorkday(core.dk(2026, 11, d))) { wdNov++; } }
ok(bcal.data.selKeys.length === wdNov, '「全月工作日」选中全部法定工作日',
  bcal.data.selKeys.length + ' vs ' + wdNov);
ok(bcal.data.selKeys.every(k => core.isWorkday(k)), '选中的都是法定工作日');
bcal.exitSel();
ok(bcal.data.sel === false && !bcal.data.selKeys.length, '退出多选后清空选区');

/* 批量设置：日期范围 + 星期 */
bcal.openBulk();
const bk0 = bcal.data.bulk;
ok(bk0 && bk0.from === '2026-11-01' && bk0.to === '2026-11-30', '批量设置默认当月 1 号到月末',
  bk0 && (bk0.from + ' ~ ' + bk0.to));
ok(bk0.count === 30, '默认七天全选，影响整月 30 天', String(bk0.count));
bcal.bulkWd({ currentTarget: { dataset: { i: 0 } } });
bcal.bulkWd({ currentTarget: { dataset: { i: 6 } } });
let expectWd = 0;
for (let d = 1; d <= 30; d++) {
  const w = core.dowOf(core.dk(2026, 11, d));
  if (w !== 0 && w !== 6) { expectWd++; }
}
ok(bcal.data.bulk.count === expectWd, '去掉周末后影响天数随之减少',
  bcal.data.bulk.count + ' vs ' + expectWd);
bcal.setData({ 'bulk.state': 'ot' });
bcal.applyBulk();
const otDay = current().days['2026-11-03'];
ok(otDay && otDay.am === 'ot' && otDay.pm === 'ot', '批量设置把工作日设为加班', JSON.stringify(otDay));
ok(!current().days['2026-11-01'] && !current().days['2026-11-07'], '周末没有被改动');
ok(bcal.data.bulk === null, '应用后关闭批量弹窗');
bcal.doUndo();
ok(!current().days['2026-11-03'], '批量设置同样能撤销');

/* 批量范围自动剔除起算日之前 */
reset();
seedDb();
const db2 = current();
db2.settings.startDate = '2026-11-16';
mem['kqzb_db_v1'] = JSON.stringify(db2);
const bcal2 = makePage('calendar');
bcal2.onLoad();
bcal2.openBulk();
const bkKeys = bcal2.bulkKeys();
ok(bkKeys.length > 0 && bkKeys.every(k => k >= '2026-11-16'), '批量范围剔除起算日前的日期',
  bkKeys.length + ' 天，最早 ' + bkKeys[0]);
bcal2.setData({ 'bulk.state': 'am' });
bcal2.applyBulk();
const amDay = current().days['2026-11-17'];
ok(amDay && amDay.am === 'work' && amDay.pm === '', '批量设「只上午」时只写上午');
ok(!current().days['2026-11-13'], '起算日前的日期没有被写记录');

/* 汇总页 */
reset();
seedDb();
const sum = makePage('summary');
sum.onLoad();
const c0 = core.computeMonth(core.normalize(current()), sum.data.ym);
ok(sum.data.total === core.fmt(c0.total), '汇总页应发金额与内核一致', sum.data.total + ' vs ' + core.fmt(c0.total));
sum.setWorkdays({ detail: { value: '20' } });
const c1 = core.computeMonth(core.normalize(current()), sum.data.ym);
ok(c1.workdays === 20, '手改应上班天数生效', c1.workdays);
ok(Math.abs(c1.dailyRate - 400) < 1e-9, '日薪随之重算', c1.dailyRate);
sum.resetParams();
ok(core.computeMonth(core.normalize(current()), sum.data.ym).workdays !== 20, '恢复默认参数生效');

/* 设置页 */
reset();
seedDb();
const set = makePage('settings');
set.onLoad();
ok(set.data.weekPattern.length === 7, '常规周 7 格');
ok(set.data.weekPattern[1].txt === '班', '周一是班');
set.cycleWeek({ currentTarget: { dataset: { i: 1 } } });
ok(current().settings.weekPattern[1] === 0.5, '点一下变半天', current().settings.weekPattern[1]);
set.cycleWeek({ currentTarget: { dataset: { i: 1 } } });
ok(current().settings.weekPattern[1] === 0, '再点变休息');
set.setSalary({ detail: { value: '9000' } });
ok(current().settings.baseSalary === 9000, '基本工资可改');
set.toggle({ currentTarget: { dataset: { key: 'autoWork' } }, detail: { value: false } });
ok(current().settings.autoWork === false, '默认出勤开关可关');
set.pickStart({ detail: { value: '2026-10-08' } });
ok(current().settings.startDate === '2026-10-08', '入职起算日可改');

/* 课程表页 */
reset();
seedDb();
const cr = makePage('courses');
cr.onLoad();
ok(cr.data.courses.length === 1, '带出已有课程');
cr.addCourse();
ok(cr.data.editing && cr.data.editing.id === '', '打开新增面板');
cr.onName({ detail: { value: '数学' } });
cr.setWeekday({ currentTarget: { dataset: { v: '3' } } });
cr.setData({ 'editing.lessons': 2 });
cr.saveCourse();
ok(current().courses.length === 2, '新增课程已保存', current().courses.length);
const added = current().courses.filter(c => c.name === '数学')[0];
ok(added && added.weekday === 3 && added.lessons === 2, '新增课程字段正确', JSON.stringify(added));
cr.editCourse({ currentTarget: { dataset: { id: added.id } } });
cr.stepWeek({ currentTarget: { dataset: { w: 'startWeek', d: '1' } } });
ok(cr.data.editing.startWeek === 2, '起止周可调');
cr.stepWeek({ currentTarget: { dataset: { w: 'endWeek', d: '-1' } } });
cr.stepWeek({ currentTarget: { dataset: { w: 'endWeek', d: '-1' } } });
ok(cr.data.editing.endWeek >= cr.data.editing.startWeek, '结束周不会小于起始周');
cr.saveCourse();
ok(current().courses.length === 2, '编辑不会新增一条');

/* 导入合并 */
reset();
seedDb();
const set2 = makePage('settings');
set2.onLoad();
const incoming = core.normalize({
  v: 1, savedAt: 0, settings: { baseSalary: 1 }, months: {}, term: {},
  days: { '2026-11-10': { am: 'inv', pm: 'inv', lessons: 0, note: '', upd: Date.now() + 1000 } }
});
const r = require(path.join(ROOT, 'utils/store.js')).mergeInto(set2.db, incoming);
ok(r.added === 1, '合并时新增 1 天');
ok(set2.db.settings.baseSalary === 8000, '合并保留本机工资参数', set2.db.settings.baseSalary);

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (bad.length) { console.log('\n失败项：\n- ' + bad.join('\n- ')); process.exit(1); }
console.log('页面逻辑全部通过');
