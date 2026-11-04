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
