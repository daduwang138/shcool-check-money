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

/* ================= 滑动选择 + 批量套用 ================= */
reset();
seedDb();
const bcal = makePage('calendar');
bcal.onLoad();
ok(bcal.data.ym === '2026-11', '批量测试固定在 2026-11', bcal.data.ym);

function idxOf(pg, key) {
  return pg.data.cells.findIndex(c => key === '' ? c.blank : c.key === key);
}
/* 模拟手指：从某格起手，横向划 dx 像素、纵向划 dy 像素 */
function slide(pg, key, dx, dy) {
  pg.gridStart({
    currentTarget: { dataset: { key: key, idx: String(idxOf(pg, key)) } },
    touches: [{ clientX: 100, clientY: 300 }]
  });
  pg.gridMove({ touches: [{ clientX: 100 + dx, clientY: 300 + (dy || 0) }] });
  pg.gridEnd({});
}

bcal.toggleSel();
ok(bcal.data.sel === true, '点「选择」进入选择模式');

slide(bcal, '2026-11-09', 3 * 48, 0);
ok(bcal.data.selKeys.join(',') === '2026-11-09,2026-11-10,2026-11-11,2026-11-12',
  '横滑 3 格连选 4 天', bcal.data.selKeys.join(','));
ok(bcal.data.cells.filter(c => c.sel).length === 4, '选中的格子带高亮标记');

bcal.toggleKey('2026-11-13');
ok(bcal.data.selKeys.length === 5, '点单格可追加');
bcal.toggleKey('2026-11-13');
ok(bcal.data.selKeys.length === 4, '再点一次取消选中');

slide(bcal, '2026-11-09', 3 * 48, 0);
ok(bcal.data.selKeys.length === 0, '从已选的格子起手滑动是整段取消',
  bcal.data.selKeys.join(',') || '空');

bcal.exitSel();
slide(bcal, '2026-11-09', 4, 60);
ok(!bcal.data.sel && !bcal.data.selKeys.length, '纵向滑动不触发选择，留给页面滚动');

slide(bcal, '2026-11-09', 3 * 48, 0);
ok(bcal.data.sel === true && bcal.data.selKeys.length === 4,
  '不点按钮，横向滑动也能直接进入选择并选中', bcal.data.selKeys.join(','));

/* 真机第一次 touchmove 往往只有几像素，方向判定不能一帧定生死 */
bcal.exitSel();
function slideSteps(pg, key, steps) {
  var x0 = 100, y0 = 300;
  pg.gridStart({
    currentTarget: { dataset: { key: key, idx: String(idxOf(pg, key)) } },
    touches: [{ clientX: x0, clientY: y0 }]
  });
  steps.forEach(function (s) {
    pg.gridMove({ touches: [{ clientX: x0 + s[0], clientY: y0 + (s[1] || 0) }] });
  });
  pg.gridEnd({});
}

slideSteps(bcal, '2026-11-09', [[4, 0], [8, 0], [12, 0], [16, 0], [24, 0], [32, 0], [40, 0], [48, 0]]);
ok(bcal.data.sel === true && bcal.data.selKeys.length >= 2,
  '每步 4px 的慢速横拖也能选中', bcal.data.selKeys.join(','));

bcal.exitSel();
slideSteps(bcal, '2026-11-09', [[2, 6], [6, 4], [12, 0], [24, 0], [36, 0], [48, 0]]);
ok(bcal.data.selKeys.length >= 2,
  '起手抖几像素再横拖，不当作纵向丢弃', bcal.data.selKeys.join(','));

bcal.exitSel();
slideSteps(bcal, '2026-11-10', [[3, 10], [5, 20], [6, 40], [7, 60], [8, 90]]);
ok(!bcal.data.sel, '纵向为主的手势整体放弃，不进入选择');

bcal.exitSel();
bcal.gridStart({
  currentTarget: { dataset: { key: '2026-11-11', idx: String(idxOf(bcal, '2026-11-11')) } },
  touches: [{ clientX: 100, clientY: 300 }]
});
bcal.gridMove({ touches: [{ clientX: 110, clientY: 300 }] });
ok(!bcal.data.sel, '横向位移不足 14px 先按兵不动');
bcal.gridEnd({});
ok(!!bcal.data.sheet, '位移太小按点击处理，弹出当天编辑面板');
bcal.setData({ sheet: null });
/* 长按：起手挂定时器，抬手清掉（长按进入选择由浏览器端冒烟用例覆盖） */
bcal.gridStart({
  currentTarget: { dataset: { key: '2026-11-12', idx: String(idxOf(bcal, '2026-11-12')) } },
  touches: [{ clientX: 100, clientY: 300 }]
});
ok(!!bcal._touch.lp, '起手挂上长按定时器');
bcal._touch.key = '';
bcal.gridEnd({});
ok(!bcal._touch, '抬手清掉手势状态与长按定时器');

/* 从月初的空白格起手也能进选择，只是空白格本身不选 */
bcal.exitSel();
ok(bcal.data.cells[0].blank === true, '月初前有空白填充格');
slideSteps(bcal, '', [[30, 0], [60, 0], [90, 0]]);
ok(bcal.data.sel === true, '从空白格起手横滑也能进入选择模式');
ok(bcal.data.selKeys.every(function (k) { return !!k; }), '空白格本身不会被选中');
bcal.exitSel();

/* 恢复一份 09~12 的选区，供后面的套用用例使用 */
slide(bcal, '2026-11-09', 3 * 48, 0);
ok(bcal.data.selKeys.join(',') === '2026-11-09,2026-11-10,2026-11-11,2026-11-12',
  '重新滑动重建选区', bcal.data.selKeys.join(','));

bcal.applySel({ currentTarget: { dataset: { st: 'inv' } } });
const inv9 = current().days['2026-11-09'], inv12 = current().days['2026-11-12'];
ok(inv9 && inv9.am === 'inv' && inv9.pm === 'inv', '整片套用监考（上午下午都设）', JSON.stringify(inv9));
ok(inv12 && inv12.pm === 'inv', '选区末端的格子同样被套用');
ok(bcal.data.sel === false && !bcal.data.selKeys.length, '套用后自动退出选择模式');
ok(!!bcal.data.undo, '批量套用后弹出撤销条');
bcal.doUndo();
ok(!current().days['2026-11-09'] && !current().days['2026-11-12'], '批量套用可整体撤销');

/* 只上午 / 课时清零 */
bcal.toggleSel();
bcal.toggleKey('2026-11-18');
bcal.pickScope({ currentTarget: { dataset: { s: 'am' } } });
bcal.applySel({ currentTarget: { dataset: { st: 'work' } } });
const am18 = current().days['2026-11-18'];
ok(am18 && am18.am === 'work' && am18.pm === '', '「只上午」只设上午', JSON.stringify(am18));
ok(core.effHalf(core.normalize(current()), '2026-11-18', 'pm') === '', '下午仍为空，没被顺手设成上班');

bcal.tapCell({ currentTarget: { dataset: { key: '2026-11-19' } } });
bcal.setData({ 'sheet.lessons': 4 });
bcal.saveSheet();
bcal.toggleSel();
bcal.toggleKey('2026-11-19');
bcal.toggleClearLes();
ok(bcal.data.clearLes === true, '「课时清零」可切换');
bcal.applySel({ currentTarget: { dataset: { st: 'work' } } });
const cl19 = current().days['2026-11-19'];
ok(cl19.lessons === 0 && cl19.lset === true, '连课时清零后记成明确 0 节', JSON.stringify(cl19));

/* 全月工作日 */
bcal.toggleSel();
bcal.selAllWorkdays();
let wdNov = 0;
for (let d = 1; d <= 30; d++) { if (core.isWorkday(core.dk(2026, 11, d))) { wdNov++; } }
ok(bcal.data.selKeys.length === wdNov, '「全月工作日」选中全部法定工作日',
  bcal.data.selKeys.length + ' vs ' + wdNov);
ok(bcal.data.selKeys.every(k => core.isWorkday(k)), '选中的都是法定工作日');
bcal.exitSel();
ok(bcal.data.sel === false && !bcal.data.selKeys.length, '退出选择后清空选区');

/* 起算日之前的日期不参与滑动选择 */
reset();
seedDb();
const db2 = current();
db2.settings.startDate = '2026-11-16';
mem['kqzb_db_v1'] = JSON.stringify(db2);
const bcal2 = makePage('calendar');
bcal2.onLoad();
bcal2.toggleSel();
slide(bcal2, '2026-11-12', 6 * 48, 0);
ok(bcal2.data.selKeys.length > 0 && bcal2.data.selKeys.every(k => k >= '2026-11-16'),
  '滑动连选会自动跳过起算日前的日期', bcal2.data.selKeys.join(',') || '空');

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
