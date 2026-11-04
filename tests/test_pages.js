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
let relaunched = [];
/* 跳转与返回、导航栏标题：口令相关的页面用它 */
let navigated = [], backCount = 0, titles = [];
global.wx = {
  getStorageSync: k => (mem[k] === undefined ? '' : mem[k]),
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: k => { delete mem[k]; },
  showToast: o => { toasts.push(o.title); },
  showModal: o => {
    modals.push(o.content);
    if (o.success) { o.success({ confirm: true, cancel: false }); }
  },
  showActionSheet: o => { if (o.success) { o.success({ tapIndex: nextSheetPick }); } },
  getDeviceInfo: () => ({ platform: 'ios' }),
  env: { USER_DATA_PATH: '/tmp' },
  getFileSystemManager: () => ({
    writeFile: o => { o.success && o.success(); },
    readFileSync: () => '{}'
  }),
  shareFileMessage: o => { o.success && o.success(); },
  reLaunch: o => { relaunched.push(o.url); },
  redirectTo: o => { relaunched.push(o.url); },
  navigateTo: o => { navigated.push(o.url); },
  navigateBack: () => { backCount++; },
  setNavigationBarTitle: o => { titles.push(o.title); }
};

/* ---------- Page 桩 ---------- */
let captured = null;
global.Page = o => { captured = o; };

function setPath(obj, key, val) {
  const parts = key.replace(/\[(\d+)\]/g, '.').split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (o[parts[i]] == null) { o[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {}; }
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
  inst.__keys = [];
  inst.setData = function (patch, cb) {
    inst.__keys.push(Object.keys(patch));
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
function reset() {
  Object.keys(mem).forEach(k => delete mem[k]);
  toasts = []; modals = []; nextSheetPick = 0;
  navigated = []; backCount = 0; titles = [];
}

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

/* 备注边打边存：改面板其它字段时不能被顶掉 */
cal.tapCell({ currentTarget: { dataset: { key: '2026-11-05' } } });
cal.onNote({ detail: { value: '教研活动' } });
cal.pickHalf({ currentTarget: { dataset: { which: 'am', v: 'inv' } } });
ok(cal.data.sheet.note === '教研活动', '改状态时已输入的备注还在', cal.data.sheet.note);
cal.stepLesson({ currentTarget: { dataset: { d: '1' } } });
ok(cal.data.sheet.note === '教研活动', '加课时后备注也还在', cal.data.sheet.note);
cal.saveSheet();
ok(current().days['2026-11-05'].note === '教研活动', '备注随记录一起存进库', current().days['2026-11-05'].note);

/* 已核对的月份：清空要先问一句，清完把核对标记去掉 */
modals = [];
const cp = core.monthP(core.normalize(current()), cal.data.ym);
cp.checked = true;
mem['kqzb_db_v1'] = JSON.stringify(core.normalize(Object.assign(current(), { months: { [cal.data.ym]: cp } })));
cal.db = require(path.join(ROOT, 'utils/store.js')).load();
cal.clearMonth();
ok(modals.some(m => /已标记核对/.test(m || '')), '已核对的月份清空前先确认', modals.join(' / '));
ok(cal.db.months[cal.data.ym].checked === false, '清空后核对标记一并去掉');
cal.hideUndo();   /* 收掉撤销条的 5 秒计时器，别让进程空等 */

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

bcal.__keys = [];   /* 从这里开始记 setData 的字段，只看滑动期间做了什么 */
bcal.toggleSel();
ok(bcal.data.sel === true, '点「选择」进入选择模式');

slide(bcal, '2026-11-09', 3 * 48, 0);
ok(bcal.data.selKeys.join(',') === '2026-11-09,2026-11-10,2026-11-11,2026-11-12',
  '横滑 3 格连选 4 天', bcal.data.selKeys.join(','));
ok(bcal.data.cells.filter(c => c.sel).length === 4, '选中的格子带高亮标记');
ok(bcal.__keys.some(ks => ks.some(k => /^cells\[\d+\]\.sel$/.test(k))),
  '选中只 patch 单格 sel 字段，不整表替换 cells（整表替换会让 wx:for 重建节点、掐断触摸）');
ok(!bcal.__keys.some(ks => ks.indexOf('cells') >= 0),
  '滑动过程中从未整表 setData cells');

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

/* 连选默认跳过周末：11-13 周五 → 11-16 周一，中间的 14、15 不进选区 */
slide(bcal, '2026-11-13', 3 * 48, 0);
ok(bcal.data.selKeys.join(',') === '2026-11-13,2026-11-16',
  '跨周末横滑只选工作日', bcal.data.selKeys.join(',') || '空');
ok(bcal.data.selKeys.every(k => core.isWorkday(k)), '连选出来的都是工作日');

bcal.exitSel();
slide(bcal, '2026-11-14', 3 * 48, 0);
ok(bcal.data.selKeys.join(',') === '2026-11-16,2026-11-17',
  '从周六起手滑动，周末格本身不入选区', bcal.data.selKeys.join(',') || '空');

bcal.exitSel();
slide(bcal, '2026-11-16', -3 * 48, 0);
ok(bcal.data.selKeys.join(',') === '2026-11-13,2026-11-16',
  '反向跨周末同样跳过周末', bcal.data.selKeys.join(',') || '空');

bcal.exitSel();
bcal.toggleSel();
bcal.toggleKey('2026-11-15');
ok(bcal.data.selKeys.join(',') === '2026-11-15', '周末仍可单点补选（监考、补课）');
bcal.exitSel();
ok(core.isWorkday('2026-10-10'), '调休补班的周六算工作日，连选不会误跳');

/* 「含周末」开关：整月周六补课时用 */
bcal.toggleSel();
bcal.toggleAllowWk();
ok(bcal.data.allowWk === true, '「含周末」可以打开');
slide(bcal, '2026-11-13', 3 * 48, 0);
ok(bcal.data.selKeys.join(',') === '2026-11-13,2026-11-14,2026-11-15,2026-11-16',
  '含周末时跨周末连选带上周六日', bcal.data.selKeys.join(',') || '空');
ok(bcal._selable('2026-10-03') === false, '含周末也不选法定假期里的日子');
bcal.exitSel();
ok(bcal.data.allowWk === false, '退出选择后「含周末」自动复位');
bcal.toggleSel();
bcal.toggleAllowWk();
bcal.nextMonth();
ok(bcal.data.allowWk === false, '切换月份后「含周末」回到默认关');
bcal.prevMonth();

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

/* 工资参数冻结：记过账的月份冻住，只是翻看过的不冻 */
reset();
seedDb();
const sumF = makePage('summary');
sumF.onLoad();
const stF = require(path.join(ROOT, 'utils/store.js'));

sumF.setData({ ym: '2026-03' });          /* 这个月一条记录都没有 */
sumF.render();
ok(sumF.data.p.base === '8000', '没记过的月份显示设置里的基数', sumF.data.p.base);
sumF.db.settings.baseSalary = 12000;
stF.save(sumF.db);
sumF.render();
ok(sumF.data.p.base === '12000', '改设置后没记过的月份跟着变', sumF.data.p.base);

sumF.setData({ ym: '2026-11' });          /* 记一天，第一次渲染时参数落盘 */
core.setRecord(sumF.db, '2026-11-03', 'work', 'work', 2, '');
stF.save(sumF.db);
sumF.render();
sumF.db.settings.baseSalary = 20000;
stF.save(sumF.db);
sumF.render();
ok(sumF.data.p.base === '12000', '记过的月份不受之后改设置影响', sumF.data.p.base);

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

/* 从 Excel 粘贴导入课表 */
cr.openImport();
ok(cr.data.imp && cr.data.imp.ok === 0, '打开导入面板，初始没有识别结果');
cr.onImpText({
  detail: {
    value: '课程\t星期\t节数\t起止周\t单双周\n语文\t周一\t3\t1-16周\t每周\n化学\t星期四\t第3-4节\t第2-9周\t双周\n英语\t周五\t2\t1-16周\n这行认不出来'
  }
});
ok(cr.data.imp.ok === 3, '识别出 3 门课程', JSON.stringify(cr.data.imp.items));
ok(cr.data.imp.badCount === 1, '认不出的行被列出来', cr.data.imp.badCount);
ok(/周四|星期四/.test(cr.data.imp.items[1].desc) || cr.data.imp.items[1].desc.indexOf('周四') >= 0,
  '星期四被换算成 4', cr.data.imp.items[1].desc);

cr.applyImport({ currentTarget: { dataset: { mode: 'append' } } });
ok(cr.data.imp === null, '导入后回到课程列表');
const names = current().courses.map(c => c.name).sort();
ok(names.join(',') === '化学,数学,英语,语文', '追加导入后课程齐全', names.join(','));
const chem = current().courses.filter(c => c.name === '化学')[0];
ok(chem && chem.weekday === 4 && chem.lessons === 2 && chem.startWeek === 2 && chem.endWeek === 9 && chem.parity === 'even',
  '第3-4节 / 第2-9周 / 双周 都解析对了', JSON.stringify(chem));

/* 同一批再导一次不会产生重复 */
cr.openImport();
cr.onImpText({ detail: { value: '化学\t星期四\t第3-4节\t第2-9周\t双周' } });
cr.applyImport({ currentTarget: { dataset: { mode: 'append' } } });
ok(current().courses.length === 4, '重复课程不会再加一条', current().courses.length);

/* 换成「清空后只留这些」 */
cr.openImport();
cr.onImpText({ detail: { value: '周一 语文 3节 1-16周\n周三 数学 2节 1-8周' } });
cr.applyImport({ currentTarget: { dataset: { mode: 'replace' } } });
ok(current().courses.length === 2, '替换模式只留粘贴的课程', current().courses.map(c => c.name).join(','));

/* 只写了星期和节数、没写周次：默认铺满教学周，不能缩成一周 */
cr.openImport();
cr.onImpText({ detail: { value: '周三 数学 3节 1-16周\n周二 物理 第1-2节' } });
cr.applyImport({ currentTarget: { dataset: { mode: 'replace' } } });
const phy = current().courses.filter(c => c.name === '物理')[0];
ok(phy && phy.startWeek === 1 && phy.endWeek === (current().term.defaultWeeks || 16),
  '没写周次的课程铺满教学周', phy && (phy.startWeek + '–' + phy.endWeek));

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

/* ---------- 口令锁 ---------- */
reset();
seedDb();
const lock = require(path.join(ROOT, 'utils/lock.js'));
lock.clear();

/* 设口令要跑一次 PBKDF2，页面里用 setTimeout 让「处理中」先画出来；测试里改成同步 */
const realSTLock = global.setTimeout;
global.setTimeout = function (fn) { fn(); return 0; };

const st = makePage('settings');
st.onLoad();
ok(st.data.lockOn === false, '默认没有口令');

/* 开关只是跳转，不再用明文弹窗收口令 */
st.toggleLock({ detail: { value: true } });
ok(navigated.join(',') === '/pages/pass/pass?mode=set', '打开开关跳到密码页', navigated.join(','));
ok(st.data.lockOn === false, '没设成之前开关弹回关闭');

let ps = makePage('pass');
ps.onLoad({ mode: 'set' });
ok(titles[titles.length - 1] === '设置口令', '密码页标题跟着模式变', titles.join(','));
ps.setData({ next: '12', again: '12' });
ps.submit();
ok(lock.isOn() === false, '少于 4 位不接受');
ok(/至少 4 位/.test(ps.data.err), '少于 4 位给出提示', ps.data.err);

ps.setData({ next: 'abcd', again: 'abce' });
ps.submit();
ok(lock.isOn() === false, '两次输入不一致不开启');
ok(/不一致/.test(ps.data.err), '不一致给出提示', ps.data.err);

ps.setData({ next: 'abcd', again: 'abcd' });
ps.submit();
ok(lock.isOn() === true, '两次一致后开启口令');
ok(lock.check('abcd') === true, '存校验值，能验证通过');
ok(lock.check('abcde') === false, '错误口令验证不通过');
ok(backCount === 1, '设完自动返回设置页', String(backCount));

/* 改口令：先验旧的 */
navigated = []; backCount = 0;
st.onShow();
ok(st.data.lockOn === true, '回到设置页读到了新状态');
st.changePass();
ok(navigated.join(',') === '/pages/pass/pass?mode=change', '修改口令跳到密码页', navigated.join(','));

ps = makePage('pass');
ps.onLoad({ mode: 'change' });
ps.setData({ cur: 'wrong', next: 'efgh', again: 'efgh' });
ps.submit();
ok(lock.check('abcd') === true, '旧口令不对时不改');
ok(/当前口令不对/.test(ps.data.err), '旧口令不对有提示', ps.data.err);

ps.setData({ cur: 'abcd', next: 'efgh', again: 'efgh' });
ps.submit();
ok(lock.check('efgh') === true && lock.check('abcd') === false, '口令已换成新的');

/* 关闭口令 */
navigated = []; backCount = 0;
st.onShow();
st.toggleLock({ detail: { value: false } });
ok(navigated.join(',') === '/pages/pass/pass?mode=off', '关开关跳到密码页', navigated.join(','));

ps = makePage('pass');
ps.onLoad({ mode: 'off' });
ps.setData({ cur: 'nope' });
ps.submit();
ok(lock.isOn() === true, '口令不对关不掉');

ps.setData({ cur: 'efgh' });
ps.submit();
ok(lock.isOn() === false, '口令正确才能关闭');
ok(lock.isUnlocked() === true, '关闭后不再拦人');

/* 没有口令时点「修改/关闭」不该留在密码页 */
backCount = 0;
ps = makePage('pass');
ps.onLoad({ mode: 'off' });
ok(backCount === 1, '没口令时关闭页直接退回', String(backCount));

/* 重新开一个口令，供锁屏页用例 */
ps = makePage('pass');
ps.onLoad({ mode: 'set' });
ps.setData({ next: 'abcd', again: 'abcd' });
ps.submit();

/* 锁屏页：内部同样用 setTimeout，仍是同步桩 */
lock.lockNow();
const lk = makePage('lock');
lk.onLoad();
ok(lk.data.hasPass === true, '锁屏页识别到已设口令');
ok(lock.isUnlocked() === false, '刚冷启动是锁着的');

lk.setData({ pass: 'wrongpass' });
lk.submit();
ok(lock.isUnlocked() === false, '错误口令解不开');
ok(/口令不对/.test(lk.data.err), '错误口令给出提示', lk.data.err);
ok(relaunched.length === 0, '没解锁不该跳页面');

lk.setData({ pass: 'abcd' });
lk.submit();
ok(lock.isUnlocked() === true, '正确口令解开');
ok(relaunched.join(',') === '/pages/calendar/calendar', '解锁后回到记账页', relaunched.join(','));

/* 连续错 5 次进入冷却 */
lock.lockNow();
relaunched.length = 0;
const lk2 = makePage('lock');
lk2.onLoad();
for (let i = 0; i < 5; i++) { lk2.setData({ pass: 'wrongpass' }); lk2.submit(); }
ok(lk2._blockUntil > Date.now(), '连错 5 次进入 30 秒冷却', String(lk2._blockUntil - Date.now()));
lk2.setData({ pass: 'abcd' });
lk2.submit();
ok(lock.isUnlocked() === false, '冷却期间即使口令对也先拦住');

/* 冷却倒计时是 setInterval，不收掉的话 node 要空等 30 秒才退出 */
lk.onUnload();
lk2.onUnload();

global.setTimeout = realSTLock;

/* 批量套用留下的撤销条计时器也收掉，否则 node 要多等 5 秒才退出 */
if (typeof bcal !== 'undefined' && bcal.hideUndo) { bcal.hideUndo(); }

console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (bad.length) { console.log('\n失败项：\n- ' + bad.join('\n- ')); process.exit(1); }
console.log('页面逻辑全部通过');
