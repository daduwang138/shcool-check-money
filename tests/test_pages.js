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
let toasts = [], modals = [], nextSheetPick = 0, clips = [];
let relaunched = [];
/* 跳转与返回、导航栏标题：口令相关的页面用它 */
let navigated = [], backCount = 0, titles = [];
const appStub = { globalData: {} };
global.getApp = () => appStub;
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
  setClipboardData: o => { clips.push(o.data); if (o.success) { o.success(); } },
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
  switchTab: o => { navigated.push(o.url); },
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
      baseSalary: 8000, rate: 120, startDate: '2026-09-21', enableBase: true, enableLesson: true,
      /* 旧测试测的是「手动填课时」的行为，先关掉自动落账隔离；新功能另有专门一节 */
      autoLessons: false
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
  appStub.globalData = {};
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

/* 撤销条：10 秒自动收起，也可点 × 立即关闭 */
const realST = global.setTimeout;
let undoDelay = null;
global.setTimeout = function (fn, ms) { undoDelay = ms; return realST(fn, 60000); };
cal.fillCourse();
global.setTimeout = realST;
ok(!!cal.data.undo, '操作后弹出撤销条', JSON.stringify(cal.data.undo));
ok(undoDelay === 10000, '撤销条 10 秒后自动收起', String(undoDelay));
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
cal.hideUndo();   /* 收掉撤销条的 10 秒计时器，别让进程空等 */

/* ================= 记账面板的课时档位 ================= */
reset();
const rdb = seedDb();
rdb.settings.rates.push({ id: 'eve', name: '晚自习', price: 80 });
mem['kqzb_db_v1'] = JSON.stringify(rdb);
const rcal = makePage('calendar');
rcal.onLoad();
const rkey = '2026-11-04';
rcal.openSheet(rkey);
ok(rcal.data.rates.length === 2, '面板带出两档单价', rcal.data.rates.length);
ok(rcal.data.sheet.rid === 'default', '没记过档位的日子默认正课');
rcal.pickRate({ currentTarget: { dataset: { id: 'eve' } } });
ok(rcal.data.sheet.rid === 'eve', '可以选晚自习');
rcal.setData({ 'sheet.lessons': 3 });
rcal.saveSheet();
ok(current().days[rkey].rid === 'eve', '档位随记录一起落盘');
ok(current().days[rkey].lessons === 3, '课时也记下了');
ok(core.computeMonth(current(), '2026-11').byRate.some(r => r.id === 'eve' && r.lessons === 3),
  '工资按晚自习档累加');
/* 改回正课后应该把 rid 字段去掉，不留下无效档 */
rcal.openSheet(rkey);
rcal.pickRate({ currentTarget: { dataset: { id: 'default' } } });
rcal.saveSheet();
ok(!current().days[rkey].rid, '改回正课时不写 rid，老结构不变');
/* 课时清零后档位区不显示，也不该留档位 */
rcal.openSheet(rkey);
rcal.pickRate({ currentTarget: { dataset: { id: 'eve' } } });
rcal.setData({ 'sheet.lessons': 0 });
rcal.saveSheet();
ok(!(current().days[rkey] || {}).rid, '没课时不留档位');

/* ================= 记账面板的晚修监考 ================= */
reset();
seedDb();
const ncal = makePage('calendar');
ncal.onLoad();
const nkey = '2026-11-06';
ncal.openSheet(nkey);
ok(ncal.data.sheet.nightOn === true, '有单价时面板显示晚修监考');
ok(ncal.data.sheet.night === 0, '没记过的日子是 0 次');
/* 面板里那块窄，提示拆成两行；三条事实（时长 / 单价 / 一晚上限）一个都不能少 */
const nightTxt = (ncal.data.nightHints || []).join(' ');
ok(/2 小时/.test(nightTxt) && /10 元/.test(nightTxt) && /最多 2 次/.test(nightTxt),
  '提示写清每次时长和钱、一晚上限', nightTxt);
ncal.stepNight({ currentTarget: { dataset: { d: 1 } } });
ok(ncal.data.sheet.night === 2, '点一下记 2 次');
ncal.stepNight({ currentTarget: { dataset: { d: 1 } } });
ok(ncal.data.sheet.night === 2, '一晚最多 2 次，误点不会多算钱', String(ncal.data.sheet.night));
ok(toasts.some(t => /一晚最多 2 次/.test(t)), '到顶给提示，不会被当成按钮坏了', toasts.join('/'));
ncal.saveSheet();
ok(current().days[nkey].night === 2, '晚修次数随记录落盘');
const nc = core.computeMonth(current(), '2026-11');
ok([nc.nightCount, nc.nightHours, nc.nightFee].join(',') === '2,4,20', '2 次 = 4 小时 = 20 元',
  [nc.nightCount, nc.nightHours, nc.nightFee].join(','));
ok(nc.lessons === 0, '晚修不算课时', String(nc.lessons));
const ncell = ncal.data.cells.find(c => c.key === nkey);
ok(ncell && ncell.nightText === '晚2', '日历格子上带晚修次数标记', ncell && ncell.nightText);
ncal.openSheet(nkey);
ok(ncal.data.sheet.night === 2, '重新打开面板带出已记的次数');
ncal.stepNight({ currentTarget: { dataset: { d: -1 } } });
ok(ncal.data.sheet.night === 0, '可以减回 0 次');
/* 界面限幅，但内核不替人改账：旧备份/粘贴码里读进来的多次记录仍照实算 */
const legacyNight = core.blankDB();
legacyNight.days['2026-11-06'] = { am: '', pm: '', lessons: 0, note: '', night: 3, upd: 1 };
ok(core.computeMonth(legacyNight, '2026-11').nightFee === 30, '导入的 3 次仍按 3 次算，界面不篡改旧账');
ncal.clearSheet();
ncal.saveSheet();
ok(!(current().days[nkey] || {}).night, '清空这天会连晚修一起清掉');
/* 单价填 0 时面板藏起来；但以前记过的仍要显示，好让人把次数清掉 */
ncal.db.settings.nightFee = 0;
require(path.join(ROOT, 'utils/store.js')).commit();
core.setRecord(ncal.db, nkey, 'work', 'work', 0, '', true, '', 1);
require(path.join(ROOT, 'utils/store.js')).commit();
ncal.openSheet(nkey);
ok(ncal.data.sheet.nightOn === true, '单价归零但记过次数仍显示');
ncal.hideUndo();

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

bcal.openSheet('2026-11-19');
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

/* 批量设置：日期范围 + 星期，可跨月 */
reset();
seedDb();
const bcal3 = makePage('calendar');
bcal3.onLoad();
bcal3.setData({ ym: '2026-09' });
bcal3.render();
bcal3.openBulk();
ok(bcal3.data.bulk.from === '2026-09-01' && bcal3.data.bulk.to === '2026-09-30',
  '批量·默认填当前整月', bcal3.data.bulk.from + '~' + bcal3.data.bulk.to);
ok(bcal3.data.bulk.count > 0, '批量·打开就算出影响天数', bcal3.data.bulk.count);
ok(bcal3.data.bulkWd.filter(x => x.on).map(x => x.v).join(',') === '1,2,3,4,5',
  '批量·默认只勾周一到周五（别一下把周末也记成上班）',
  bcal3.data.bulkWd.filter(x => x.on).map(x => x.v).join(','));

bcal3.setData({
  bulk: Object.assign({}, bcal3.data.bulk, {
    from: '2026-09-01', to: '2026-10-31', wd: [3], st: 'ot', les: 0
  })
});
bcal3._bulkRefresh(bcal3.data.bulk);
ok(bcal3.data.bulkWd.filter(x => x.on).length === 1 &&
  bcal3.data.bulkWd.filter(x => x.on)[0].v === 3, '批量·星期多选只亮周三');

const bkeys = bcal3._bulkKeys();
ok(bkeys.every(k => core.dowOf(k) === 3), '批量·只挑周三', bkeys.join(','));
ok(bkeys[0] === '2026-09-23' && bkeys.length === 6,
  '批量·跳过起算日之前、跨月算满', bkeys[0] + ' 共 ' + bkeys.length + ' 天');

bcal3.applyBulk();
const bdb = core.normalize(current());
ok(bdb.days['2026-09-23'] && bdb.days['2026-09-23'].am === 'ot' && bdb.days['2026-09-23'].pm === 'ot',
  '批量·跨月写进周三');
ok(bdb.days['2026-09-23'] && bdb.days['2026-09-23'].lessons === 0 &&
  bdb.days['2026-09-23'].lset === true, '批量·课时设0即清零并锁定',
  JSON.stringify(bdb.days['2026-09-23']));
ok(!bdb.days['2026-09-22'], '批量·非周三不动');
ok(!bdb.days['2026-09-02'], '批量·起算日之前不写');
ok(bcal3.data.bulk === null, '批量·应用后关掉面板');

bcal3.doUndo();
const budb = core.normalize(current());
ok(!budb.days['2026-09-23'], '批量·跨月改动也能撤销');

/* 批量课时步进：null=不改，+ 得 2 / − 得 0，之后 ±2 */
ok(core.bulkLessonStep(null, 2) === 2, '课时步进·不改时+得2');
ok(core.bulkLessonStep(null, -2) === 0, '课时步进·不改时−得0');
ok(core.bulkLessonStep(2, 2) === 4, '课时步进·2再加得4');
ok(core.bulkLessonStep(20, 2) === 20, '课时步进·封顶20');
ok(core.bulkLessonStep(0, -2) === 0, '课时步进·0减不越界');
/* 关键：测按钮事件本身（wxml 传方向 ±1，处理器要 ×2）。
   只测内核函数抓不到「wxml 传 1、处理器忘了乘 2」这类界面 bug。 */
const bcalStep = makePage('calendar');
bcalStep.onLoad();
bcalStep.openBulk();
bcalStep.stepBulkLes({ currentTarget: { dataset: { d: 1 } } });
ok(bcalStep.data.bulk.les === 2, '按钮·点一次+是2节不是1节', String(bcalStep.data.bulk.les));
bcalStep.stepBulkLes({ currentTarget: { dataset: { d: 1 } } });
ok(bcalStep.data.bulk.les === 4, '按钮·再点一次是4节', String(bcalStep.data.bulk.les));
bcalStep.stepBulkLes({ currentTarget: { dataset: { d: -1 } } });
ok(bcalStep.data.bulk.les === 2, '按钮·点一次−减2节', String(bcalStep.data.bulk.les));
bcalStep.resetBulkLes();
ok(bcalStep.data.bulk.les === null, '按钮·还原回不改', String(bcalStep.data.bulk.les));
bcalStep.stepBulkLes({ currentTarget: { dataset: { d: -1 } } });
ok(bcalStep.data.bulk.les === 0, '按钮·不改时点−是0节清零', String(bcalStep.data.bulk.les));
/* 批量设正数：这些天课时都变成 4，且算手填锁定 */
const bcalL = makePage('calendar');
bcalL.onLoad();
bcalL.setData({
  bulk: Object.assign({}, bcalL.data.bulk, {
    from: '2026-11-02', to: '2026-11-06', wd: [1, 2, 3, 4, 5], st: 'inv', les: 4
  })
});
bcalL._bulkRefresh(bcalL.data.bulk);
bcalL.applyBulk();
const ldb = core.normalize(current());
['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'].forEach(function (k) {
  ok(ldb.days[k] && ldb.days[k].lessons === 4 && ldb.days[k].lset === true,
    '批量·课时设为4 ' + k, JSON.stringify(ldb.days[k]));
});
/* null=不改：原有课时保留 */
const bcalN = makePage('calendar');
bcalN.onLoad();
seedDb({ days: { '2026-11-10': { am: 'work', pm: 'work', lessons: 3, lset: true, rid: 'x' } } });
bcalN.onLoad();
bcalN.setData({
  bulk: Object.assign({}, bcalN.data.bulk, {
    from: '2026-11-10', to: '2026-11-10', wd: [2], st: 'ot', les: null
  })
});
bcalN._bulkRefresh(bcalN.data.bulk);
bcalN.applyBulk();
const ndb = core.normalize(current());
ok(ndb.days['2026-11-10'].lessons === 3 && ndb.days['2026-11-10'].rid === 'x',
  '批量·不改课时保留原值与档位', JSON.stringify(ndb.days['2026-11-10']));

/* 面板按「后一天」跨到别的月份：已核对的确认不能失效，撤销也得真撤掉那天 */
reset();
seedDb();
const xdb = current();
xdb.settings.startDate = '';
xdb.months = { '2026-06': { checked: true } };
mem['kqzb_db_v1'] = JSON.stringify(xdb);
const xcal = makePage('calendar');
xcal.onLoad();
xcal.setData({ ym: '2026-05' });
xcal.render();
xcal.openSheet('2026-05-31');
ok(xcal.data.sheet.key === '2026-05-31', '面板·打开 5/31', xcal.data.sheet.key);

xcal.stepDay({ currentTarget: { dataset: { d: '1' } } });
ok(xcal.data.sheet.key === '2026-06-01', '面板·「后一天」落到 6/1', xcal.data.sheet.key);
ok(xcal.data.ym === '2026-06', '面板·跨月后日历跟着翻到 6 月', xcal.data.ym);

modals.length = 0;
xcal.setData({ 'sheet.lessons': 4 });
xcal.saveSheet();
ok(modals.some(m => m.indexOf('核对') >= 0),
  '面板·跨月后已核对的月份仍要二次确认', JSON.stringify(modals));

const xdb1 = core.normalize(current());
ok(!!(xdb1.days['2026-06-01'] && xdb1.days['2026-06-01'].lessons === 4),
  '面板·确认后照常写入 6/1', JSON.stringify(xdb1.days['2026-06-01'] || null));

xcal.doUndo();
const xdb2 = core.normalize(current());
ok(!xdb2.days['2026-06-01'], '面板·撤销要真的撤掉 6/1',
  JSON.stringify(xdb2.days['2026-06-01'] || null));
ok(!xdb2.days['2026-05-31'], '面板·同一批撤销连 5/31 一起回滚',
  JSON.stringify(xdb2.days['2026-05-31'] || null));

/* 冷启动先判锁：锁着不许把整月账目先画出来再跳锁屏 */
reset();
seedDb();
/* 直接摆一份口令元数据，省掉 20000 次派生；guard 只看「有没有口令 + 解没解锁」 */
mem['kqzb_lock_v1'] = JSON.stringify({ v: 1, salt: '00'.repeat(16), iter: 1, hash: '00'.repeat(32) });
require(path.join(ROOT, 'utils/lock.js')).lockNow();
relaunched.length = 0;
const lcal = makePage('calendar');
lcal.onLoad();
ok(lcal.data.cells.length === 0 && lcal.data.ready === false,
  '锁屏·冷启动不先渲染账目', '格子 ' + lcal.data.cells.length);
ok(relaunched.indexOf('/pages/lock/lock') >= 0, '锁屏·冷启动直接跳锁屏', relaunched.join(','));
relaunched.length = 0;   /* 后面锁屏页用例要数跳转次数，这里清干净 */

/* 只上午：下午清空 */
reset();
seedDb();
const bcal4 = makePage('calendar');
bcal4.onLoad();
bcal4.openBulk();
bcal4.setData({
  bulk: Object.assign({}, bcal4.data.bulk, {
    from: '2026-11-02', to: '2026-11-02', wd: [1], st: 'am'
  })
});
bcal4.applyBulk();
const bdb4 = core.normalize(current());
ok(bdb4.days['2026-11-02'].am === 'work' && bdb4.days['2026-11-02'].pm === '',
  '批量·只上午只改上午');

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

/* 课时分档后，计算过程要列出每档；只有一档时不该多这一行 */
reset();
seedDb();
const sumR = makePage('summary');
sumR.onLoad();
ok(!sumR.data.rows.some(r => r.k === '课时明细'), '只有一档时不多出明细行');
const ymR = sumR.data.ym;
sumR.db.settings.rates = [
  { id: 'default', name: '正课', price: 120 },
  { id: 'eve', name: '晚自习', price: 80 }
];
core.setRecord(sumR.db, ymR + '-05', 'work', 'work', 4, '', true, '');
core.setRecord(sumR.db, ymR + '-06', 'ot', 'ot', 2, '', true, 'eve');
require(path.join(ROOT, 'utils/store.js')).commit();
sumR.render();
const det = sumR.data.rows.find(r => r.k === '课时明细');
ok(!!det, '多档时列出课时明细');
ok(det && det.v.indexOf('正课') >= 0 && det.v.indexOf('晚自习') >= 0, '明细里有各档名称', det && det.v);
ok(det && det.v.indexOf('×') >= 0, '明细里带各档单价', det && det.v);
const cR = core.computeMonth(core.normalize(current()), ymR);
ok(cR.byRate.length === 2 && cR.lessonFee === 4 * 120 + 2 * 80, '两档课时费分别累加', cR.lessonFee);

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
stF.commit();
sumF.render();
ok(sumF.data.p.base === '12000', '改设置后没记过的月份跟着变', sumF.data.p.base);

sumF.setData({ ym: '2026-11' });          /* 记一天，第一次渲染时参数落盘 */
core.setRecord(sumF.db, '2026-11-03', 'work', 'work', 2, '');
stF.commit();
sumF.render();
sumF.db.settings.baseSalary = 20000;
stF.commit();
sumF.render();
ok(sumF.data.p.base === '12000', '记过的月份不受之后改设置影响', sumF.data.p.base);

/* 复制核对单 + 导出范围 */
reset();
seedDb({
  days: {
    '2026-09-22': { am: 'work', pm: 'work', lessons: 2, note: '', upd: 1 },
    '2026-11-03': { am: 'work', pm: 'inv', lessons: 3, note: '', upd: 2 }
  }
});
const sumC = makePage('summary');
sumC.onLoad();
clips.length = 0;
sumC.copySum();
ok(clips.length === 1 &&
  clips[0] === core.sumText(core.computeMonth(core.normalize(current()), sumC.data.ym)),
  '复制核对单与内核文本逐字一致');

const origExportCsv = stF.exportCsv;
let gotMonths = null;
stF.exportCsv = (db, months) => { gotMonths = months.slice(); return Promise.resolve('ok'); };

nextSheetPick = 0; sumC.exportPick();
ok(gotMonths && gotMonths.length === 1 && gotMonths[0] === sumC.data.ym, '导出范围·本月只出当月');
nextSheetPick = 1; sumC.exportPick();
ok(gotMonths && gotMonths.length === 3 && gotMonths[2] === core.todayKey().slice(0, 7),
  '导出范围·近三个月含当月并往前推两个月', gotMonths && gotMonths.join(','));
nextSheetPick = 2; sumC.exportPick();
ok(gotMonths && gotMonths[0].slice(5) === '01' && gotMonths[gotMonths.length - 1] === core.todayKey().slice(0, 7),
  '导出范围·今年从 1 月到当月', gotMonths && (gotMonths[0] + '~' + gotMonths[gotMonths.length - 1]));
nextSheetPick = 3; sumC.exportPick();
const allKeys = core.monthKeysOf(core.normalize(current()));
ok(gotMonths && gotMonths.length === allKeys.length && gotMonths.every(m => allKeys.indexOf(m) >= 0),
  '导出范围·全部只含有记录的月份', gotMonths && gotMonths.join(','));
stF.exportCsv = origExportCsv;

/* 没记录的月份不该给出空核对单 */
sumC.setData({ ym: '2025-01' });
sumC.render();
clips.length = 0;
sumC.copySum();
ok(clips.length === 0 && toasts[toasts.length - 1] === '这个月还没有记录',
  '空月份不复制核对单', toasts[toasts.length - 1]);

/* 晚修监考：计算过程带 ④，参数卡带只读价，核对单也带这一笔 */
reset();
seedDb({ days: { '2026-11-03': { am: 'work', pm: 'work', lessons: 2, note: '', night: 2, upd: 1 } } });
const sumN = makePage('summary');
sumN.onLoad();
const nrow = sumN.data.rows.find(r => r.k === '晚修监考费');
ok(!!nrow && nrow.v.indexOf('20.00') >= 0, '计算过程列出晚修监考费', nrow && nrow.v);
ok(sumN.data.nightEach === '每次 2 小时 · ¥10/次', '参数卡显示只读的晚修价', sumN.data.nightEach);
ok(sumN.data.total === core.fmt(core.computeMonth(core.normalize(current()), sumN.data.ym).total),
  '应发合计把晚修算进去了', sumN.data.total);
clips.length = 0;
sumN.copySum();
ok(clips[0] && clips[0].indexOf('④ 晚修监考费：20.00 元') >= 0, '核对单末尾有第 ④ 项');
/* 参数卡的「其他档位」也是只读的，用来一眼核对附加档单价 */
sumN.db.settings.rates = [
  { id: 'default', name: '正课', price: 120 },
  { id: 'eve', name: '晚自习', price: 80 }
];
require(path.join(ROOT, 'utils/store.js')).commit();
sumN.render();
ok(sumN.data.otherRates.indexOf('晚自习 ¥80/节') >= 0, '参数卡列出其他档位', sumN.data.otherRates);
ok(sumN.data.p.rate === '120', '只读行不影响可编辑的单价', sumN.data.p.rate);

/* 参数卡这两行必须取「本月实际生效的价」，不能取设置里的现价：
   11 月按 80 元/节、10 元/次记过账，后来调价到 150 / 25，回看 11 月还得是旧价，
   不然同一屏上「其他档位 ¥150」和计算过程里的「× ¥80」会自己打起来。 */
const ymN = sumN.data.ym;
sumN.db.settings.rates = [
  { id: 'default', name: '正课', price: 120 }, { id: 'eve', name: '晚自习', price: 80 }
];
sumN.db.settings.nightFee = 10;
var mpN = core.monthP(sumN.db, ymN);
delete mpN.rates;
delete mpN.night;
/* 渲染不再写库：改由写路径显式把 80 / 10 冻进本月 */
core.freezeMonth(sumN.db, ymN);
sumN.db.settings.rates[1].price = 150;
sumN.db.settings.nightFee = 25;
sumN.render();
ok(sumN.data.otherRates.indexOf('晚自习 ¥80/节') >= 0, '档位只读行用当月冻结价', sumN.data.otherRates);
ok(sumN.data.otherRates.indexOf('¥150') < 0, '档位只读行不跟新设置变', sumN.data.otherRates);
ok(sumN.data.nightEach === '每次 2 小时 · ¥10/次', '晚修只读行也用冻结价', sumN.data.nightEach);
ok(sumN.data.total === core.fmt(core.computeMonth(sumN.db, ymN).total), '金额与参数卡同口径');

/* 恢复默认参数只删三个可手改的值，档位与晚修的快照保留（记过账的月份不因调价变钱） */
const beforeSnap = JSON.stringify(sumN.db.months[ymN].rates);
sumN.resetParams();
ok(sumN.db.months[ymN].rates && JSON.stringify(sumN.db.months[ymN].rates) === beforeSnap,
  '恢复默认参数保留档位价快照');
ok(sumN.db.months[ymN].night && sumN.db.months[ymN].night.fee === 10,
  '恢复默认参数保留晚修价快照');

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
/* 聚焦时纯 0 清空，避免接着输入变 08500；0.5 等合法值不动 */
set.clearZero({ detail: { value: '0' } });
ok(set.data.baseSalary === '', '工资框聚焦清空前置0', JSON.stringify(set.data.baseSalary));
set.setData({ baseSalary: '0.5' });
set.clearZero({ detail: { value: '0.5' } });
ok(set.data.baseSalary === '0.5', '工资框不清合法小数', String(set.data.baseSalary));
set.setSalary({ detail: { value: '9000' } });
ok(current().settings.baseSalary === 9000, '基本工资可改');
/* 改工资同步当月及以后：历史冻结不动 */
const nowYm = core.todayKey().slice(0, 7);
const histYm = core.addMonths(nowYm, -1);
set.db.months[histYm] = { base: 8000 };
set.db.months[nowYm] = { base: 8000 };
set.setSalary({ detail: { value: '10000' } });
ok(set.db.months[histYm].base === 8000, '改工资不动历史月份', String(set.db.months[histYm].base));
ok(set.db.months[nowYm].base === 10000, '改工资同步当月冻结值', String(set.db.months[nowYm].base));

/* 课时单价与基本工资同一规则：改价同步当月及以后已冻结的价，历史月份保持原价。
   不做这一步的话，当月记了课却还按老价（常常是 0）算，看着像算错了。 */
set.db.months[histYm].rate = 120;
set.db.months[nowYm].rate = 120;
set.setRate({ detail: { value: '150' } });
ok(current().settings.rate === 150, '课时单价可改', String(current().settings.rate));
ok(set.db.months[histYm].rate === 120, '改课时单价不动历史月份', String(set.db.months[histYm].rate));
ok(set.db.months[nowYm].rate === 150, '改课时单价同步当月冻结值', String(set.db.months[nowYm].rate));
set.toggle({ currentTarget: { dataset: { key: 'autoWork' } }, detail: { value: false } });
ok(current().settings.autoWork === false, '默认出勤开关可关');
set.pickStart({ detail: { value: '2026-10-08' } });
ok(current().settings.startDate === '2026-10-08', '入职起算日可改');

/* 多档课时单价：加档、改名、改价、空名字不覆盖、删除 */
set.addRate();
let extra = current().settings.rates.filter(r => r.id !== 'default');
ok(extra.length === 1, '可以加一档', extra.length);
ok(set.data.rates.length === 1, '新档位立刻显示在界面上');
const rid0 = extra[0].id;
set.setRateName({ currentTarget: { dataset: { id: rid0 } }, detail: { value: '晚自习' } });
ok(current().settings.rates.filter(r => r.id === rid0)[0].name === '晚自习', '档位可改名');
set.setRatePrice({ currentTarget: { dataset: { id: rid0 } }, detail: { value: '80' } });
ok(current().settings.rates.filter(r => r.id === rid0)[0].price === 80, '档位可改价');
set.setRateName({ currentTarget: { dataset: { id: rid0 } }, detail: { value: '   ' } });
ok(current().settings.rates.filter(r => r.id === rid0)[0].name === '晚自习', '名字留空不覆盖原值');
set.setRatePrice({ currentTarget: { dataset: { id: rid0 } }, detail: { value: '-5' } });
ok(current().settings.rates.filter(r => r.id === rid0)[0].price === 80, '负单价不接受');
set.delRate({ currentTarget: { dataset: { id: rid0 } } });
ok(current().settings.rates.filter(r => r.id === rid0).length === 0, '档位可删除');
ok(current().settings.rates.filter(r => r.id === 'default').length === 1, '默认档删不掉');
/* 删掉后重新加一档，留给后面的记账面板测试用 */
set.addRate();
const rid1 = current().settings.rates.filter(r => r.id !== 'default')[0].id;
set.setRateName({ currentTarget: { dataset: { id: rid1 } }, detail: { value: '晚自习' } });
set.setRatePrice({ currentTarget: { dataset: { id: rid1 } }, detail: { value: '80' } });

/* 附加档位也走同一条同步规则：当月及以后已冻结的快照跟着改，历史月份不动 */
set.db.months[histYm].rates = {};
set.db.months[histYm].rates[rid1] = 80;
set.db.months[nowYm].rates = {};
set.db.months[nowYm].rates[rid1] = 80;
set.setRatePrice({ currentTarget: { dataset: { id: rid1 } }, detail: { value: '100' } });
ok(set.db.months[histYm].rates[rid1] === 80, '改档位价不动历史月份', String(set.db.months[histYm].rates[rid1]));
ok(set.db.months[nowYm].rates[rid1] === 100, '改档位价同步当月快照', String(set.db.months[nowYm].rates[rid1]));

/* 同步之后钱要对得上：当月 2 节课按新价 150 算 = 300 元 */
set.db.days[core.todayKey()] = { am: 'work', pm: 'work', lessons: 2, note: '', lset: true, upd: 1 };
ok(core.computeMonth(set.db, nowYm).lessonFee === 300, '改价后当月课时费按新单价算',
  String(core.computeMonth(set.db, nowYm).lessonFee));

/* 晚修监考的两个价：改完存进设置，界面跟着变，负数不接受 */
ok(set.data.nightHours === '2' && set.data.nightFee === '10', '设置页带出默认 2 小时 10 元',
  set.data.nightHours + ' / ' + set.data.nightFee);
set.setNightHours({ detail: { value: '3' } });
ok(current().settings.nightHours === 3 && set.data.nightHours === '3', '可改每次时长');
set.setNightFee({ detail: { value: '15' } });
ok(current().settings.nightFee === 15 && set.data.nightFee === '15', '可改每次金额');
set.setNightHours({ detail: { value: '-1' } });
set.setNightFee({ detail: { value: 'abc' } });
ok(current().settings.nightHours === 3 && current().settings.nightFee === 15, '负数与乱填不改原值');

/* 课程表页 */
reset();
seedDb();
const cr = makePage('courses');
cr.onLoad();
ok(cr.data.courses.length === 1, '带出已有课程');
cr.addCourse();
ok(cr.data.editing && cr.data.editing.id === '', '打开新增面板');
ok(cr.data.editing.weekdays.join(',') === '1', '新增时默认选中周一', String(cr.data.editing.weekdays));
cr.onName({ detail: { value: '数学' } });
cr.toggleWeekday({ currentTarget: { dataset: { v: '3' } } });
ok(cr.data.editing.weekdays.join(',') === '1,3', '星期几可以多选', String(cr.data.editing.weekdays));
cr.toggleWeekday({ currentTarget: { dataset: { v: '1' } } });
cr.toggleWeekday({ currentTarget: { dataset: { v: '5' } } });
ok(cr.data.editing.weekdays.join(',') === '3,5', '再点一下能取消某一天', String(cr.data.editing.weekdays));
ok(cr.data.weekdayChips.filter(x => x.on).length === 2, '面板上的星期按钮跟着高亮',
  JSON.stringify(cr.data.weekdayChips));
cr.setData({ 'editing.lessons': 2 });
cr.saveCourse();
ok(current().courses.length === 2, '新增课程已保存', current().courses.length);
const added = current().courses.filter(c => c.name === '数学')[0];
ok(added && added.weekday === 3 && added.weekdays.join(',') === '3,5' && added.lessons === 2,
  '新增课程字段正确（weekday 仍存首日，兼容旧读法）', JSON.stringify(added));
const mathRow = cr.data.courses.filter(x => x.name === '数学')[0];
ok(mathRow && /周三、周五/.test(mathRow.desc), '课程列表把多天都显示出来', mathRow && mathRow.desc);
cr.editCourse({ currentTarget: { dataset: { id: added.id } } });
ok(cr.data.editing.weekdays.join(',') === '3,5', '编辑时带出多天', String(cr.data.editing.weekdays));
cr.toggleWeekday({ currentTarget: { dataset: { v: '3' } } });
cr.toggleWeekday({ currentTarget: { dataset: { v: '5' } } });
ok(cr.data.editing.weekdays.join(',') === '5', '最后一天不允许取消', String(cr.data.editing.weekdays));
cr.stepWeek({ currentTarget: { dataset: { w: 'startWeek', d: '1' } } });
ok(cr.data.editing.startWeek === 2, '起止周可调');
cr.stepWeek({ currentTarget: { dataset: { w: 'endWeek', d: '-1' } } });
cr.stepWeek({ currentTarget: { dataset: { w: 'endWeek', d: '-1' } } });
ok(cr.data.editing.endWeek >= cr.data.editing.startWeek, '结束周不会小于起始周');
cr.saveCourse();
ok(current().courses.length === 2, '编辑不会新增一条');

/* 内核层：一门课排多天，只在本周那几天出课时，写重复的天不重复计 */
ok(core.courseDays({ weekday: 4 }).join(',') === '4', '老备份只有 weekday 也能读成数组');
ok(core.courseDays({ weekdays: [5, 1, 5, 3] }).join(',') === '1,3,5', 'weekdays 去重并排序',
  JSON.stringify(core.courseDays({ weekdays: [5, 1, 5, 3] })));
const mdb = core.blankDB();
mdb.term.start = '2026-11-02';
mdb.settings.startDate = '';
mdb.courses = [{ id: 'm1', name: '语文', weekday: 1, weekdays: [1, 3, 5], lessons: 3,
  startWeek: 1, endWeek: 52, parity: 'all' }];
ok(core.lessonsFor(mdb, '2026-11-02') === 3, '多天课程：周一算 3 节');
ok(core.lessonsFor(mdb, '2026-11-04') === 3, '多天课程：周三算 3 节');
ok(core.lessonsFor(mdb, '2026-11-06') === 3, '多天课程：周五算 3 节');
ok(core.lessonsFor(mdb, '2026-11-03') === 0, '多天课程：没排的那天不算');

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

/* 粘贴框一键清空：只清文字，不退出导入页 */
cr.openImport();
cr.onImpText({ detail: { value: '周一 语文 3节 1-16周' } });
ok(cr.data.impText && cr.data.imp.ok === 1, '课表粘贴·输入后有文字和识别结果');
cr.clearImpText();
ok(cr.data.impText === '' && cr._impText === '', '课表粘贴·一键清空输入框');
ok(cr.data.imp && cr.data.imp.textLen === 0 && cr.data.imp.ok === 0,
  '课表粘贴·一键清空同时清掉识别结果');
ok(cr.data.imp !== null, '课表粘贴·清空后仍留在导入页');

/* 放假安排页：自己填的休假与补班日 */
const HY0 = new Date().getFullYear();
const seedDays = {};
seedDays[HY0 + '-03-02'] = { am: 'work', pm: 'work', lessons: 2, note: '', upd: 1 };
reset();
seedDb({ days: seedDays });
const hol = makePage('holiday');
hol.onLoad();
const HY = hol.data.y;
ok(HY === HY0, '默认停在当年', String(HY));
ok(hol.data.off.length === 0 && hol.data.custom === false, '新库里没有自定义假期');
hol.nextYear();
ok(hol.data.y === HY + 1 && /国办发明电〔2026〕10号/.test(hol.data.builtin),
  '翻到 2027 能看到内置的国办发安排', hol.data.builtin);
hol.prevYear();
ok(hol.data.y === HY, '翻回来还是当年', String(hol.data.y));

hol.pickFrom({ detail: { value: HY + '-02-06' } });
hol.pickTo({ detail: { value: HY + '-02-12' } });
hol.addOff();
ok(current().settings.holidays[HY].off.length === 1, '休假段已落盘', JSON.stringify(current().settings.holidays));
ok(hol.data.off.length === 1 && /2 月 6 日/.test(hol.data.off[0].text), '列表里显示这一段', hol.data.off[0].text);
ok(/7 天/.test(hol.data.off[0].text), '跨日段标出天数', hol.data.off[0].text);

/* 判定要跟着变：2026-02-09 是周一，本来该上班 */
ok(core.isWorkday(HY + '-02-09', current()) === false, '填了休假后那天不上班');
ok(core.isHoliday(HY + '-02-09', current()) === true, '填了休假后算作法定假期');

hol.pickOne({ detail: { value: HY + '-03-07' } });
hol.addWork();
ok(current().settings.holidays[HY].work.length === 1, '补班日已落盘');
ok(core.isWorkday(HY + '-03-07', current()) === true, '补班的周六算上班');

/* 跨年的段不收：两个 picker 各自限在年内，但用户能先选 12-30 再选次年 1-2 */
const offBefore = current().settings.holidays[HY].off.length;
hol.pickFrom({ detail: { value: HY + '-12-30' } });
hol.pickTo({ detail: { value: (HY + 1) + '-01-02' } });
hol.addOff();
ok(current().settings.holidays[HY].off.length === offBefore, '跨年的段拦住了');
ok(toasts.some(t => /跨年/.test(t)), '跨年给出提示', toasts.join(' / '));

/* 已记过账的月份要说明：自动算出的天数会重算，手填的保留 */
ok(new RegExp('3 月').test(hol.data.touched) && /重算/.test(hol.data.touched),
  '有记录的月份说明重算口径', hol.data.touched);

hol.delOff({ currentTarget: { dataset: { i: 0 } } });
ok(current().settings.holidays[HY].off.length === 0, '休假段可以删');
hol.delWork({ currentTarget: { dataset: { i: 0 } } });
ok(current().settings.holidays[HY].work.length === 0, '补班日可以删');

hol.pickFrom({ detail: { value: HY + '-05-01' } });
hol.pickTo({ detail: { value: HY + '-05-05' } });
hol.addOff();
hol.clearYear();
ok(!current().settings.holidays[HY], '清空这一年后不留空壳');
ok(hol.data.custom === false, '清空后不再是自定义状态');

/* 日期框没选之前显示的是占位「月/日」：picker 的 value 只能填具体日期（这年 1 月 1 日），
   但那个 1/1 以前会直接显示出来，跟上面「还没填」打架，手快点「加入」还落一段假假期 */
{
  const hol2 = makePage('holiday');
  hol2.onLoad();
  ok(hol2.data.fromText === '月/日' && hol2.data.oneText === '月/日',
    '没选日期前框里是占位，不是 1/1', hol2.data.fromText + ' / ' + hol2.data.oneText);
  hol2.addOff();
  hol2.addWork();
  const h2 = current().settings.holidays && current().settings.holidays[HY];
  ok(!h2 || (!h2.off.length && !h2.work.length), '没选日期点加入不写任何一段', JSON.stringify(h2));
  ok(toasts.some(t => /先选/.test(t)), '没选日期给出提示', toasts.join(' / '));
  hol2.pickFrom({ detail: { value: HY + '-02-06' } });
  ok(hol2.data.fromText === '2/6' && hol2.data.fromSet === true, '选过之后显示真实日期', hol2.data.fromText);
}

/* 从电脑粘贴导入：小程序配不了未备案的域名，联网获取只能放电脑版，
   这边负责把电脑版写出的那一串接住 */
{
  const PY = HY + 1;
  const packet = JSON.stringify({
    year: PY,
    off: [[PY + '-02-06', PY + '-02-12']],
    work: [[PY + '-02-20', PY + '-02-20']]
  });
  hol.openPaste();
  ok(hol.data.showPaste === true, '粘贴框能打开');
  hol.onPaste({ detail: { value: packet } });
  hol.doPaste();
  ok(hol.data.showPaste === false, '导入后自动收起');
  ok(current().settings.holidays[PY] && current().settings.holidays[PY].off.length === 1, '导入的年份已落盘');
  ok(hol.data.y === PY, '粘的是哪年就跳到哪年', String(hol.data.y));
  ok(hol.data.off.length === 1 && /2 月 6 日/.test(hol.data.off[0].text), '导入后列表即时刷新', hol.data.off[0] && hol.data.off[0].text);
  ok(core.isWorkday(PY + '-02-09', current()) === false, '导入的假期立刻影响判定');

  /* 看不懂的内容不许动已有数据 */
  const before = JSON.stringify(current().settings.holidays[PY]);
  hol.openPaste();
  hol.onPaste({ detail: { value: '春节放七天' } });
  hol.doPaste();
  ok(JSON.stringify(current().settings.holidays[PY]) === before, '看不懂的内容不改数据');
  ok(modals.some(m => /合法的 JSON/.test(m)), '看不懂时说明原因', modals[modals.length - 1]);

  /* 空着点导入 */
  hol.openPaste();
  hol.onPaste({ detail: { value: '   ' } });
  hol.doPaste();
  ok(toasts.some(t => /先粘贴/.test(t)), '空内容给提示');
  hol.closePaste();
  ok(hol.data.showPaste === false && hol.data.pasteText === '', '取消后清空输入');

  hol.openPaste();
  hol.onPaste({ detail: { value: packet } });
  hol.clearPaste();
  ok(hol.data.showPaste === true && hol.data.pasteText === '', '放假粘贴·一键清空后仍留在导入框');
}

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

/* ---------- 转发：五个业务页都能发，落点必须是 app.json 里真实存在的页面 ---------- */
const appJson = JSON.parse(require('fs').readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
['calendar', 'summary', 'settings', 'courses', 'year', 'holiday'].forEach(function (name) {
  reset();
  const p = makePage(name);
  ok(typeof p.onShareAppMessage === 'function', name + ' 定义了转发');
  const s = p.onShareAppMessage ? p.onShareAppMessage({ from: 'menu' }) : {};
  ok(appJson.pages.indexOf(s.path) >= 0, name + ' 转发落点存在', s.path);
  ok(!!s.title && s.title.length <= 30, name + ' 转发标题长度合适', s.title);
});

/* 冷却倒计时是 setInterval，不收掉的话 node 要空等 30 秒才退出 */
lk.onUnload();
lk2.onUnload();

global.setTimeout = realSTLock;

/* ================= 以人为本：连续记账、输入不丢、少弹窗、撤销还全 ================= */
reset();
const udb = seedDb();
mem['kqzb_db_v1'] = JSON.stringify(udb);
const ucal = makePage('calendar');
ucal.onLoad();
const uk1 = '2026-11-04';
ucal.openSheet(uk1);
ucal.setData({ 'sheet.lessons': 4 });
ucal.stepDay({ currentTarget: { dataset: { d: 1 } } });
ok(!!ucal.data.sheet && ucal.data.sheet.key === '2026-11-05',
  '翻天后面板不关、直接跳到次日', ucal.data.sheet && ucal.data.sheet.key);
ok((current().days[uk1] || {}).lessons === 4,
  '翻天前自动存下当前这天', JSON.stringify(current().days[uk1] || null));
ucal.onNote({ detail: { value: '期中监考' } });
ucal.pickRate({ currentTarget: { dataset: { id: 'default' } } });
ok(ucal.data.sheet.note === '期中监考',
  '选档位不会把刚打的备注从界面上抹掉', String(ucal.data.sheet.note));

/* 已核对的确认：本次进入页面只问一次，别让补记十几天点十几次 */
reset();
const c5db = seedDb();
c5db.months['2026-11'] = { checked: true, workdays: 20, base: 8000, rate: 120 };
mem['kqzb_db_v1'] = JSON.stringify(c5db);
const c5 = makePage('calendar');
c5.onLoad();
modals = [];
c5.openSheet('2026-11-06');
c5.saveSheet();
c5.openSheet('2026-11-07');
c5.saveSheet();
ok(modals.filter(m => /已标记核对/.test(m || '')).length === 1,
  '已核对月份本次进入页面只确认一次', modals.join(' / '));

/* 撤销要连「已核对」标记一起还回来 */
reset();
const u6db = seedDb();
u6db.months['2026-11'] = { checked: true, workdays: 20, base: 8000, rate: 120 };
mem['kqzb_db_v1'] = JSON.stringify(u6db);
const u6 = makePage('calendar');
u6.onLoad();
u6._checkedOk = { '2026-11': true };
u6.clearMonth();
ok(current().months['2026-11'].checked === false, '清空后已核对标记去掉');
u6.doUndo();
ok(current().months['2026-11'].checked === true,
  '撤销把已核对标记也还回来', String(current().months['2026-11'].checked));

/* 翻到没记过账的月份，应上班天数不能显示字符串 undefined */
reset();
const s7db = seedDb();
s7db.months['2026-12'] = {};
mem['kqzb_db_v1'] = JSON.stringify(s7db);
const s7 = makePage('summary');
s7.onLoad();
s7.setData({ ym: '2026-12' });
s7.render();
ok(s7.data.p.workdays !== 'undefined' && String(s7.data.p.workdays).length > 0,
  '空月份的应上班天数显示现算值', String(s7.data.p.workdays));

/* 课程编辑：改节数不该把刚输入的课程名抹掉 */
reset();
mem['kqzb_db_v1'] = JSON.stringify(seedDb());
const cr2 = makePage('courses');
cr2.onLoad();
cr2.addCourse();
cr2.onName({ detail: { value: '高一物理' } });
cr2.stepLessons({ currentTarget: { dataset: { d: 1 } } });
ok(cr2.data.editing.name === '高一物理',
  '改节数不会把刚输入的课程名抹掉', String(cr2.data.editing.name));

/* ================= 课程表课时自动落账（默认开、只补今天及以前） ================= */
/* 造一个「当月每天都有课」的课程表，保证任何日期跑测试都会触发自动落账 */
function autoSeed() {
  const d = seedDb();
  const ym = core.todayKey().slice(0, 7);
  d.settings.autoLessons = true;
  d.settings.startDate = '';
  d.term.start = ym + '-01';
  d.courses = [];
  for (let w = 1; w <= 7; w++) {
    d.courses.push({ id: 'w' + w, name: '课' + w, weekday: w, lessons: 2,
      startWeek: 1, endWeek: 52, parity: 'all' });
  }
  Object.keys(d.days).forEach(k => { if (k.slice(0, 7) === ym) delete d.days[k]; });
  delete d.months[ym];
  return d;
}
const afYm = core.todayKey().slice(0, 7), afToday = core.todayKey();
reset();
const afdb = autoSeed();
let afExpect = 0;
for (let d = 1; d <= parseInt(afToday.slice(8, 10), 10); d++) {
  afExpect += core.lessonsFor(afdb, afYm + '-' + String(d).padStart(2, '0'));
}
mem['kqzb_db_v1'] = JSON.stringify(afdb);
const af = makePage('calendar');
af.onLoad();
ok(afExpect > 0, '测试种子：当月已过去的日子确实有课', String(afExpect));
ok(!!af.data.undo && /自动记入/.test(af.data.undo.label || ''),
  '自动落账后弹出撤销条', JSON.stringify(af.data.undo));
ok(core.computeMonth(current(), afYm).lessons === afExpect,
  '当月已过去的日子按课程表记上课时',
  core.computeMonth(current(), afYm).lessons + ' / 期望 ' + afExpect);
ok(Object.keys(current().days).filter(k => k.slice(0, 7) === afYm && k > afToday).length === 0,
  '未来的日子不预填');
af.doUndo();
ok(core.computeMonth(current(), afYm).lessons === 0, '撤销把自动落账清掉');
ok(toasts.some(t => /本月不再自动填/.test(t)), '撤销提示本月不再自动填', toasts.join('/'));
/* render 只读：不管怎么重画都不许往账里写字（以前它顺手补课时，撤销之后会自己长回来） */
const daysBeforeRender = JSON.stringify(current().days);
af.render();
ok(JSON.stringify(current().days) === daysBeforeRender, 'render 只读，不改账');
ok(core.computeMonth(current(), afYm).lessons === 0, '撤销后本次打开不再自动填回来');
/* 撤销过的月份，即使再触发一次自动落账也不填（靠 _autoBlocked，不靠「跳过一帧」） */
af._ensureAutoFill();
ok(core.computeMonth(current(), afYm).lessons === 0, '撤销过的月份不会再被自动填回来');

/* 关掉开关 / 已核对的月份：都不该动账 */
reset();
mem['kqzb_db_v1'] = JSON.stringify(seedDb());   /* 种子里 autoLessons=false */
const afOff = makePage('calendar');
afOff.onLoad();
ok(!afOff.data.undo, '关掉开关后不弹自动落账撤销条');
ok(core.computeMonth(current(), afYm).lessons === 0, '关掉开关后不写课时');

reset();
const afCkDb = autoSeed();
afCkDb.months[afYm] = { checked: true, workdays: 20, base: 8000, rate: 120 };
mem['kqzb_db_v1'] = JSON.stringify(afCkDb);
const afCk = makePage('calendar');
afCk.onLoad();
ok(!afCk.data.undo, '已核对月份不自动落账');
ok(core.computeMonth(current(), afYm).lessons === 0, '已核对月份整月不动');

/* 设置页能把开关拨开 */
reset();
mem['kqzb_db_v1'] = JSON.stringify(seedDb());
const afSet = makePage('settings');
afSet.onLoad();
ok(afSet.data.autoLessons === false, '设置页带出自动落账开关状态');
afSet.toggle({ currentTarget: { dataset: { key: 'autoLessons' } }, detail: { value: true } });
ok(current().settings.autoLessons === true && afSet.data.autoLessons === true,
  '设置页能打开自动落账并同步界面');

/* 新增用例留下的撤销条计时器也收掉，否则 node 要多等 10 秒才退出 */
[c5, u6, af].forEach(function (p) { if (p.hideUndo) { p.hideUndo(); } });

/* 批量套用留下的撤销条计时器也收掉，否则 node 要多等 10 秒才退出 */
if (typeof bcal !== 'undefined' && bcal.hideUndo) { bcal.hideUndo(); }

/* 跨页面共用一份数据引用：避免 A 页面的旧副本把 B 页面刚写的数据整库盖掉 */
reset();
const stShared = require(path.join(ROOT, 'utils/store.js'));
mem['kqzb_db_v1'] = JSON.stringify(seedDb());
const sharedA = stShared.load();
const sharedB = stShared.load();
ok(sharedA === sharedB, 'store.load 内容未变时共用同一份数据引用');
sharedA.days['2026-11-20'] = { am: 'work', pm: 'work', lessons: 1, note: 'A 页面写的', upd: Date.now() };
stShared.commit();
const sharedC = stShared.load();
ok(sharedB.days['2026-11-20'] && sharedB.days['2026-11-20'].note === 'A 页面写的',
  'B 页面持有的引用能看到 A 页面刚保存的记录');
ok(sharedC === sharedB, '保存后 load 仍是同一份引用');

/* 导入合并：时钟超前的设备不能吞掉本机新账，冲突要看得见 */
const mLocal = core.blankDB();
mLocal.days['2026-11-03'] = { am: 'work', pm: 'work', lessons: 2, note: '本机新', upd: Date.now() };
const mIncoming = core.blankDB();
mIncoming.days['2026-11-03'] = { am: 'work', pm: 'work', lessons: 9, note: '时钟快一天', upd: Date.now() + 86400000 };
mIncoming.days['2026-11-04'] = { am: 'work', pm: 'work', lessons: 1, note: '新的一天', upd: Date.now() };
const mres = stShared.mergeInto(mLocal, mIncoming);
ok(mLocal.days['2026-11-03'].lessons === 2, '时间戳超前的导入记录不覆盖本机新账');
ok(mres.future === 1, '返回未来时间戳的条数');
ok(mres.conflicts >= 1, '两边不一致的日子被记为冲突');
ok(!!mLocal.days['2026-11-04'], '没有冲突的新日子照常导入');

/* 连续操作合并为一个撤销点：撤销条还在时沿用最早那份快照 */
reset();
mem['kqzb_db_v1'] = JSON.stringify(seedDb());
const uCal = makePage('calendar');
uCal.db = stShared.load();
uCal.data.ym = '2026-11';
uCal.hideUndo();
uCal._beginUndo('sheet-A');
const snapFirst = uCal._undo.snap;
uCal.showUndo('第一次');
uCal.db.days['2026-11-05'] = { am: 'work', pm: 'work', lessons: 1, note: '第二次操作', upd: Date.now() };
uCal._beginUndo('sheet-A');
ok(uCal._undo.snap === snapFirst, '同一批连续操作沿用最早的快照');
uCal._beginUndo('sheet-B');
ok(uCal._undo.snap !== snapFirst, '不同批次重新拍快照');
uCal.hideUndo();

/* ================= 备注 / 本月事项 =================
   周末监考、加班往往是不同的考试，填了还得事后找得着。 */
reset();
{
  const db = seedDb();
  db.days['2026-11-14'] = { am: 'ot', pm: 'inv', lessons: 0, note: '四六级监考', upd: 100 };
  db.days['2026-11-15'] = { am: '', pm: 'ot', lessons: 0, note: '竞赛阅卷', upd: 200 };
  db.days['2026-11-16'] = { am: 'work', pm: 'work', lessons: 2, note: '', upd: 300 };
  db.days['2026-11-20'] = { am: '', pm: '', lessons: 0, note: '学科竞赛复赛', upd: 400 };
  mem['kqzb_db_v1'] = JSON.stringify(db);

  const tags = core.noteTags(db);
  ok(tags.slice(0, 6).join(',') === '四六级,竞赛,期中,期末,月考,模考',
    '快捷标签·前六个是预设考试', tags.slice(0, 6).join(','));
  ok(tags.indexOf('学科竞赛复赛') >= 0 && tags.indexOf('四六级监考') >= 0,
    '快捷标签·自己写过的考试名会冒出来', tags.join(','));
  ok(tags.length === 9 && tags[6] === '学科竞赛复赛',
    '快捷标签·最近改过的自定义排最前', tags.join(','));
  ok(core.noteTags(db, 0).length === 6, '快捷标签·上限为 0 时只留预设', String(core.noteTags(db, 0).length));

  const list = core.monthNotes(db, '2026-11');
  ok(list.length === 3, '本月事项·只列写了备注的日子', String(list.length));
  ok(list.map(x => x.key).join(',') === '2026-11-14,2026-11-15,2026-11-20',
    '本月事项·按日期升序', list.map(x => x.key).join(','));
  ok(list[0].weekend && list[1].weekend && !list[2].weekend,
    '本月事项·周末标记只给周六周日', list.map(x => String(x.weekend)).join(','));
  ok(list[0].dow === '周六' && list[0].kinds === '加班 / 监考',
    '本月事项·带上星期和手填状态', list[0].dow + ' / ' + list[0].kinds);
  ok(list[0].note === '四六级监考', '本月事项·备注原文不截断', list[0].note);
  ok(core.monthNotes(core.blankDB(), '2026-12').length === 0,
    '本月事项·没备注的月份不显示卡片');

  const nCal = makePage('calendar');
  nCal.onLoad();
  nCal.data.ym = '2026-11';
  nCal.render();
  const c14 = nCal.data.cells.filter(c => c.key === '2026-11-14')[0];
  const c16 = nCal.data.cells.filter(c => c.key === '2026-11-16')[0];
  ok(c14 && c14.hasNote === true, '日历·写了备注的日子有小圆点');
  ok(c16 && !c16.hasNote, '日历·没写备注的不点亮');

  nCal.openSheet('2026-11-15');
  /* 备注不折叠；预设 6 个固定在前面，最近写过的跟在后面（上限 4 个），都完整显示 */
  ok(nCal.data.sheet.tags.length === 6 && nCal.data.sheet.recentTags.length === 3,
    '编辑页·标签两组（6 预设 + 最近写过，上限 4）',
    nCal.data.sheet.tags.length + '+' + nCal.data.sheet.recentTags.length);
  ok(nCal.data.sheet.tags.join(',') === '四六级,竞赛,期中,期末,月考,模考',
    '面板·预设6个完整', nCal.data.sheet.tags.join(','));
  nCal.tapTag({ currentTarget: { dataset: { v: '四六级' } } });
  ok(nCal.data.sheet.note === '四六级' && nCal._note === '四六级',
    '面板·点标签同时改输入框和暂存值', nCal.data.sheet.note + ' / ' + nCal._note);
  nCal.saveSheet();
  ok(current().days['2026-11-15'].note === '四六级',
    '面板·标签填的备注真的落进账里', current().days['2026-11-15'].note);

  const nSum = makePage('summary');
  nSum.onLoad();
  nSum.data.ym = '2026-11';
  nSum.render();
  ok(nSum.data.noteRows.length === 3, '汇总·本月事项列出全部三条', String(nSum.data.noteRows.length));
  ok(nSum.data.noteRows[0].date === '11/14' && nSum.data.noteRows[0].weekend === true,
    '汇总·周末日子带标记', JSON.stringify(nSum.data.noteRows[0]));
  ok(nSum.data.noteRows[0].note === '四六级监考', '汇总·显示备注原文', nSum.data.noteRows[0].note);
  ok(nSum.data.noteRows[0].meta.indexOf('加班') >= 0,
    '汇总·事项带上当天状态', nSum.data.noteRows[0].meta);
}

/* ================= 改价不追溯：设置页 vs 汇总页 =================
   10 月记过账后，当时工资会冻进 months['2026-10'].base；设置页改的是以后的默认值，
   只有汇总页的「本月参数」或「让本月用设置里的新工资」能改到这个月。 */
reset();
{
  const db = seedDb();
  core.setRecord(db, '2026-10-08', 'work', 'work', 40, '');
  core.setRecord(db, '2026-10-09', 'work', 'inv', 40, '');
  mem['kqzb_db_v1'] = JSON.stringify(db);

  ok(db.months['2026-10'] && db.months['2026-10'].base === 8000,
    '改价不追溯·记过账就把当时的工资冻进月份', JSON.stringify(db.months['2026-10']));
  const before = core.computeMonth(db, '2026-10');
  db.settings.baseSalary = 600;
  const afterSetting = core.computeMonth(db, '2026-10');
  ok(afterSetting.total === before.total && afterSetting.base === 8000,
    '改价不追溯·设置页改全局工资不动已冻结的 10 月',
    before.total + ' → ' + afterSetting.total + ' / base=' + afterSetting.base);

  const pSum = makePage('summary');
  pSum.onLoad();
  pSum.data.ym = '2026-10';
  pSum.render();
  ok(pSum.data.p.base === '8000',
    '汇总页·参数卡显示的是本月冻结价，不是设置里的新值', pSum.data.p.base);

  const cBefore = core.computeMonth(pSum.db, '2026-10');
  pSum.setBase({ detail: { value: '600' } });
  const cAfter = core.computeMonth(pSum.db, '2026-10');
  ok(cAfter.base === 600, '汇总页·改「本月参数」写进冻结值', String(cAfter.base));
  ok(cAfter.total < cBefore.total,
    '汇总页·改完应发立刻跟着变', cBefore.total + ' → ' + cAfter.total);

  /* resetParams 以前拿 monthP 的 q.workdays 拼 toast，那个函数不填价格，所以提示是
     「应上班 undefined 天」。钉住它别再退回去。 */
  pSum.db.settings.baseSalary = 600;
  stShared.commit();
  const toastFrom = toasts.length;
  pSum.resetParams();
  const cReset = core.computeMonth(pSum.db, '2026-10');
  ok(!pSum.db.months['2026-10'].base, '重置·删掉当月冻结的工资');
  ok(cReset.base === 600, '重置·当月回到设置里的当前工资', String(cReset.base));
  const newToasts = toasts.slice(toastFrom).join(' / ');
  ok(newToasts.indexOf('undefined') < 0 && newToasts.indexOf('天') >= 0,
    '重置·提示里不再出现 undefined', newToasts);

  pSum.db.settings.enableBase = false;
  pSum.db.settings.enableLesson = false;
  const cOff = core.computeMonth(pSum.db, '2026-10');
  ok(cOff.base === 0 && cOff.basePart === 0 && cOff.extraPart === 0,
    '开关·关掉「启用基本工资」①②归零，改工资也不该影响总额',
    JSON.stringify([cOff.base, cOff.basePart, cOff.extraPart]));

  /* 参数卡得跟着开关走：以前开关关了框还能改，改完 computeMonth 不采信，
     看起来就像「工资改了总额没变」。 */
  pSum.render();
  ok(pSum.data.enableBase === false && pSum.data.enableLesson === false,
    '参数卡·关掉开关后 render 把两个禁用状态带出来',
    JSON.stringify([pSum.data.enableBase, pSum.data.enableLesson]));
  pSum.db.settings.enableBase = true;
  pSum.db.settings.enableLesson = true;
  pSum.render();
  ok(pSum.data.enableBase === true && pSum.data.enableLesson === true,
    '参数卡·重新打开开关后恢复可改',
    JSON.stringify([pSum.data.enableBase, pSum.data.enableLesson]));
}

/* ================= 状态矩阵：开关 × 冻结 × 空月份 =================
   以前所有用例都跑在 seedDb() 的「开关全开」这一条路径上，交叉状态从没被测到，
   所以「关掉开关后界面还让不让人改」「空月份会不会蹦出 undefined」只能靠肉眼撞见。
   把组合摊开：以后每加一个用户可见的状态分支，先来这里加一行。 */
reset();
{
  const combos = [
    { base: true,  lesson: true,  frozen: true,  empty: false },
    { base: false, lesson: true,  frozen: true,  empty: false },
    { base: true,  lesson: false, frozen: true,  empty: false },
    { base: false, lesson: false, frozen: true,  empty: false },
    { base: true,  lesson: true,  frozen: false, empty: false },
    { base: false, lesson: false, frozen: false, empty: false },
    { base: true,  lesson: true,  frozen: false, empty: true  }
  ];
  combos.forEach(function (cfg) {
    const db = seedDb();
    db.settings.enableBase = cfg.base;
    db.settings.enableLesson = cfg.lesson;
    if (cfg.frozen) { core.setRecord(db, '2026-10-08', 'work', 'work', 40, ''); }
    if (!cfg.empty) { core.setRecord(db, '2026-11-03', 'work', 'inv', 0, ''); }
    mem['kqzb_db_v1'] = JSON.stringify(db);

    const p = makePage('summary');
    p.onLoad();
    p.data.ym = cfg.empty ? '2027-02' : (cfg.frozen ? '2026-10' : '2026-11');
    p.render();
    const tag = 'base=' + cfg.base + ' lesson=' + cfg.lesson
      + ' frozen=' + cfg.frozen + ' empty=' + cfg.empty;

    ok(p.data.enableBase === cfg.base && p.data.enableLesson === cfg.lesson,
      '矩阵·开关状态带进参数卡 ' + tag,
      JSON.stringify([p.data.enableBase, p.data.enableLesson]));

    const c = core.computeMonth(db, p.data.ym);
    ok(cfg.base ? c.base >= 0 : (c.base === 0 && c.basePart === 0 && c.extraPart === 0),
      '矩阵·开关与金额一致 ' + tag, JSON.stringify([c.base, c.basePart, c.extraPart]));

    ok(['workdays', 'base', 'rate'].every(function (k) {
      return String(p.data.p[k]) !== 'undefined' && String(p.data.p[k]) !== 'NaN';
    }), '矩阵·参数卡不出现 undefined/NaN ' + tag, JSON.stringify(p.data.p));

    ok(p.data.total !== 'NaN' && p.data.total !== 'undefined' && !/NaN|undefined/.test(p.data.total),
      '矩阵·应发金额可读 ' + tag, p.data.total);

    /* 用户可见输出也算验收面：每个组合都点一次「恢复默认」，提示不能带 undefined */
    const from = toasts.length;
    p.resetParams();
    const t = toasts.slice(from).join(' / ');
    ok(t.indexOf('undefined') < 0 && t.indexOf('NaN') < 0 && t.indexOf('天') >= 0,
      '矩阵·重置提示可读 ' + tag, t);
  });
}

/* ================= schema：DAY_FIELDS 必须真的驱动合并冲突判断 =================
   以前 dayBody 手写 7 个字段，加日记录字段忘了补，就会把「两边内容不同」
   误判成相同、静默吞掉一边的数据。这里逐字段验一遍。 */
reset();
{
  const st = require(path.join(ROOT, 'utils/store.js'));
  const probes = core.DAY_FIELDS.map(function (f) {
    const base = { am: '', pm: '', lessons: 0, note: '', rid: '', night: 0, off: false, upd: 100 };
    const variant = Object.assign({}, base, { upd: 50 });
    variant[f.key] = f.kind === 'int' ? 9 : (f.kind === 'bool' ? true : 'X');
    const local = seedDb();
    local.days['2026-11-02'] = base;
    const incoming = { v: 1, settings: {}, months: {}, term: {}, courses: [],
      days: { '2026-11-02': variant } };
    return [f.key, st.mergeInto(local, incoming).conflicts];
  });
  ok(probes.every(function (x) { return x[1] >= 1; }),
    'schema·DAY_FIELDS 每个字段都参与合并冲突判断', JSON.stringify(probes));
  const l2 = seedDb();
  l2.days['2026-11-02'] = { am: 'work', pm: 'work', lessons: 0, note: '', rid: '', night: 0, off: false, upd: 100 };
  const i2 = { v: 1, settings: {}, months: {}, term: {}, courses: [],
    days: { '2026-11-02': Object.assign({}, l2.days['2026-11-02'], { upd: 50 }) } };
  ok(st.mergeInto(l2, i2).conflicts === 0, 'schema·只改 upd 不算内容冲突');
}

/* ================= 设置默认值 vs 本月冻结值：差异要可见、可一键消除 =================
   同一个字段在两页显示不同数字曾被当成 bug 反复问，界面必须把差异摆出来，
   并且「只想同步工资」不能连带改掉本月单独设过的天数与单价。 */
reset();
{
  const db = seedDb();
  core.setRecord(db, '2026-10-08', 'work', 'work', 40, '');   /* 冻住 base=8000 */
  db.settings.baseSalary = 9000;                              /* 用户在设置页改了 */
  mem['kqzb_db_v1'] = JSON.stringify(db);
  const p = makePage('summary');
  p.onLoad();
  p.data.ym = '2026-10';
  p.render();
  ok(p.data.baseDiff === true, '差异·冻结值与设置值不同时标出来', String(p.data.baseDiff));
  ok(p.data.settingBase === '9000', '差异·显示设置里的新值', p.data.settingBase);
  ok(p.data.p.base === '8000', '差异·本月仍显示冻结值', p.data.p.base);
  ok(p.data.resetLabel.indexOf('9000') >= 0, '差异·按钮文案带上新值', p.data.resetLabel);

  /* 本月单独设过天数与单价，一键只能改工资 */
  core.monthP(p.db, '2026-10').workdays = 20;
  core.monthP(p.db, '2026-10').rate = 150;
  p.render();
  p.useSettingBase();
  const c2 = core.computeMonth(p.db, '2026-10');
  ok(c2.base === 9000, '差异·一键后本月工资跟随设置', String(c2.base));
  ok(p.db.months['2026-10'].workdays === 20 && p.db.months['2026-10'].rate === 150,
    '差异·一键不动应上班天数与单价', JSON.stringify(p.db.months['2026-10']));
  ok(p.data.baseDiff === false, '差异·同步后提示消失', String(p.data.baseDiff));
}

/* ================= 备份往返：导出 JSON → 导入必须逐字段无损 =================
   数据全在本机，导出/导入是唯一保命路径；这条链路以前没有任何断言（只有 mergeInto 有）。
   exportBackup 就是 JSON.stringify(db, null, 2)，所以这里用同样的文本喂给 parseBackup。 */
reset();
{
  const st = require(path.join(ROOT, 'utils/store.js'));
  /* 递归稳定序列化：键排序后比较，避免「对象键顺序不同」造成假失败 */
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).sort()
        .map(function (k) { return JSON.stringify(k) + ':' + stable(v[k]); }).join(',') + '}';
    }
    return JSON.stringify(v);
  }
  const db = seedDb();
  db.settings.rates = [
    { id: 'default', name: '正课', price: 120 },
    { id: 'eve', name: '晚自习', price: 80 }
  ];
  db.settings.holidays = {
    '2026': { off: [['2026-11-05', '2026-11-06']], work: [['2026-11-07', '2026-11-07']] }
  };
  db.settings.nightFee = 15;
  db.months['2026-10'] = {
    workdays: 18, base: 8000, rate: 120,
    rates: [{ id: 'default', price: 120 }, { id: 'eve', price: 80 }],
    night: { hours: 2, fee: 15 }, checked: true
  };
  db.days['2026-10-08'] = { am: 'work', pm: 'inv', lessons: 4, note: '月考监考', rid: 'eve', night: 1, upd: 1000 };
  db.days['2026-11-03'] = { am: 'ot', pm: 'leave', lessons: 2, note: '', rid: 'default', night: 0, off: true, upd: 2000 };
  db.courses = [{ id: 'a', name: '语文', weekdays: [1, 3], lessons: 2, startWeek: 1, endWeek: 16, parity: 'odd' }];
  db.term = { start: '2026-09-01', defaultWeeks: 18 };

  const before = core.normalize(db);
  let back = null, err = '';
  try { back = st.parseBackup(JSON.stringify(before, null, 2)); } catch (e) { err = e.message; }
  ok(!err, '备份往返·能解析导出的 JSON', err);
  if (back) {
    ok(stable(Object.keys(back.days).sort()) === stable(Object.keys(before.days).sort()),
      '备份往返·日记录键集合一致');
    function canon(r, f) {
      if (f.kind === 'int') return parseInt(r[f.key], 10) || 0;
      if (f.kind === 'bool') return !!r[f.key];
      return r[f.key] || '';
    }
    ok(Object.keys(before.days).every(function (k) {
      const a = before.days[k], b = back.days[k];
      return b && core.DAY_FIELDS.every(function (f) { return canon(a, f) === canon(b, f); });
    }), '备份往返·每条日记录的业务字段无损');
    ok(stable(back.months) === stable(before.months), '备份往返·冻结参数无损');
    ok(stable(back.settings) === stable(before.settings), '备份往返·设置无损');
    ok(stable(back.courses) === stable(before.courses), '备份往返·课程表无损');
    ok(stable(back.term) === stable(before.term), '备份往返·学期设置无损');
    ok(core.computeMonth(back, '2026-10').total === core.computeMonth(before, '2026-10').total,
      '备份往返·导入后应发金额不变');
  }
  let threw = false; try { st.parseBackup('{坏掉的'); } catch (e) { threw = true; }
  ok(threw, '备份往返·损坏 JSON 会报错');
  threw = false; try { st.parseBackup('{}'); } catch (e) { threw = true; }
  ok(threw, '备份往返·空对象会报错');
  ok(!!st.parseBackup('{"days":{}}').settings, '备份往返·只有 days 的旧备份也能读');
  ok(!!st.parseBackup('{"settings":{}}').days, '备份往返·只有 settings 的旧备份也能读');
  const legacy = st.parseBackup('{"v":1,"days":{"2026-10-08":{"am":"work","pm":"work","lessons":2}},"settings":{}}');
  ok(legacy.days['2026-10-08'].lset === true && legacy.days['2026-10-08'].lessons === 2,
    '备份往返·老备份补齐 lset 且不丢记录');
}

/* ---------- 年历总览 ---------- */
reset();
lock.clear();
{
  const cy = String(new Date().getFullYear());
  const ydb = seedDb();
  ydb.settings.holidays = {
    [cy]: { off: [[cy + '-11-05', cy + '-11-06']], work: [[cy + '-11-07', cy + '-11-07']] }
  };
  mem['kqzb_db_v1'] = JSON.stringify(ydb);
  const yp = makePage('year');
  yp.onLoad();
  ok(yp.data.months.length === 12, '年历一次渲染 12 个月', String(yp.data.months.length));
  const ycells = [];
  yp.data.months.forEach(function (mo) {
    mo.weeks.forEach(function (wk) { wk.cells.forEach(function (c) { ycells.push(c); }); });
  });
  ok(ycells.some(function (c) { return c.cls.indexOf('ycl-hol') >= 0; }), '法定休假有单独标记');
  ok(ycells.some(function (c) { return c.cls.indexOf('ycl-mk') >= 0; }), '调休补班有单独标记');
  ok(yp.data.months.every(function (mo) {
    return mo.weeks.every(function (wk) { return /^\d+$/.test(wk.num); });
  }), '每个月的每一周都有周序号');
  ok(yp.data.tip.indexOf('法定休假') >= 0, '年历顶部给出全年假期统计');
  yp.prevYear();
  ok(yp.data.year === new Date().getFullYear() - 1, '可以翻到上一年');
  yp.goThisYear();
  yp.openMonth({ currentTarget: { dataset: { ym: '2026-11' } } });
  ok(appStub.globalData.yearJump === '2026-11', '点月份记下要跳的月份');
  ok(navigated.indexOf('/pages/calendar/calendar') >= 0, '点月份跳到记账页');
}

/* ================= 备份提醒 ================= */
{
  const bkstore = require(path.join(ROOT, 'utils/store.js'));
  reset();
  ok(bkstore.backupDue(), '备份提醒·从没导出过就该提醒');
  ok(bkstore.backupDays() === -1, '备份提醒·没导出过天数返回 -1', String(bkstore.backupDays()));
  mem['kqzb_backup_at'] = String(Date.now() - 2 * 86400000);
  ok(!bkstore.backupDue(), '备份提醒·两天前导出过不提醒');
  ok(bkstore.backupDays() === 2, '备份提醒·算得出距上次多少天', String(bkstore.backupDays()));
  mem['kqzb_backup_at'] = String(Date.now() - 40 * 86400000);
  ok(bkstore.backupDue(), '备份提醒·超过 30 天重新提醒');
  bkstore.snoozeBackup(7);
  ok(!bkstore.backupDue(), '备份提醒·点了「稍后」按下次再说');
  delete mem['kqzb_backup_snooze'];

  /* 记账页那条提醒：有记录才出现，点 ✕ 推迟一周 */
  reset();
  const bkdb = seedDb();
  bkdb.days['2026-11-03'] = { am: 'work', pm: 'work', lessons: 0, note: '', lset: false, upd: 1 };
  mem['kqzb_db_v1'] = JSON.stringify(bkdb);
  const bp = makePage('calendar');
  bp.onLoad();
  ok(/还没有导出过备份/.test(bp.data.backupTip), '备份提醒·记账页顶部出现提示', bp.data.backupTip);
  bp.hideBackupTip();
  ok(bp.data.backupTip === '' && !!mem['kqzb_backup_snooze'], '备份提醒·点 × 推迟一周');

  /* 没有记录就不打扰新用户 */
  reset();
  const emptyDb = seedDb();
  mem['kqzb_db_v1'] = JSON.stringify(emptyDb);
  const ep = makePage('calendar');
  ep.onLoad();
  ok(ep.data.backupTip === '', '备份提醒·一条记录都没有时不打扰', ep.data.backupTip);
}

/* ================= 课时单价为 0 的告警 ================= */
{
  reset();
  const ymz = core.todayKey().slice(0, 7);
  const zdb = seedDb();
  zdb.v = core.SCHEMA_VERSION;          /* 别再让 v2→v3 迁移把 0 补成 30 */
  zdb.settings.rate = 0;
  zdb.settings.autoLessons = false;
  zdb.months = {};
  zdb.days[ymz + '-02'] = { am: 'work', pm: 'work', lessons: 4, note: '', lset: true, upd: 1 };
  mem['kqzb_db_v1'] = JSON.stringify(zdb);

  const zp = makePage('calendar');
  zp.onLoad();
  const lessonChip = zp.data.chips.filter(c => c.k === '课时')[0];
  ok(!!lessonChip && lessonChip.warn === true, '单价0·记账页「课时」格子标红');
  ok(zp.data.notes.some(t => /课时单价为 0/.test(t)), '单价0·记账页补一句说明');

  const sp = makePage('summary');
  sp.onLoad();
  sp.setData({ ym: ymz });
  sp.render();
  ok(sp.data.rateZero === true, '单价0·汇总页出现告警');

  /* 单价改回 30 之后告警消失（同一条记录，不该一直红着） */
  const back = current();
  back.months = {};
  back.settings.rate = 30;
  mem['kqzb_db_v1'] = JSON.stringify(back);
  sp.db = null;
  sp.onShow();
  sp.setData({ ym: ymz });
  sp.render();
  ok(sp.data.rateZero === false, '单价0·填上单价后告警消失');
}

/* ================= 全年事项 ================= */
{
  reset();
  const nYear = new Date().getFullYear();
  const ndb = seedDb();
  ndb.v = core.SCHEMA_VERSION;
  ndb.days[nYear + '-01-05'] = { am: 'inv', pm: '', lessons: 0, note: '期末监考', lset: false, upd: 1 };
  ndb.days[nYear + '-11-06'] = { am: '', pm: 'ot', lessons: 0, note: '周末加班', lset: false, upd: 2 };
  mem['kqzb_db_v1'] = JSON.stringify(ndb);
  const np = makePage('summary');
  np.onLoad();
  np.setData({ mode: 'year', year: nYear });
  np.render();
  ok(np.data.yearNotes.length === 2, '全年事项·跨月两条都列出', String(np.data.yearNotes.length));
  ok(np.data.yearNotes[0].note === '期末监考' && np.data.yearNotes[1].note === '周末加班',
    '全年事项·按日期顺序', np.data.yearNotes.map(x => x.note).join('/'));
  ok(np.data.yearNotes[1].weekend === true || np.data.yearNotes[1].meta.indexOf('周') >= 0,
    '全年事项·带上星期与状态');
}

/* ================= 备注一键清空 ================= */
{
  reset();
  seedDb();
  const notePage = makePage('calendar');
  notePage.onLoad();
  notePage.openSheet('2026-11-15');
  ok(notePage.data.noteHasValue === false, '备注清空·没内容时不显示按钮');
  notePage.onNote({ detail: { value: '数学静思啊' } });
  ok(notePage.data.noteHasValue === true && notePage._note === '数学静思啊',
    '备注清空·有内容时显示按钮且暂存文字不丢', JSON.stringify([notePage.data.noteHasValue, notePage._note]));
  notePage.clearNote();
  ok(notePage.data.noteHasValue === false && notePage.data.sheet.note === '' && notePage._note === '',
    '备注清空·点一次输入框和暂存值都清掉');
  notePage.tapTag({ currentTarget: { dataset: { v: '四六级' } } });
  ok(notePage.data.noteHasValue === true && notePage.data.sheet.note === '四六级' && notePage._note === '四六级',
    '备注清空·标签重新填备注时按钮恢复');
}

/* ================= 代码审查 1122：小程序端回归 ================= */
{
  const stFix = require(path.join(ROOT, 'utils/store.js'));

  /* 1. commit 失败回滚内存，页面不再报成功 */
  reset();
  const freshForFail = seedDb();
  const stDb = stFix.replace(freshForFail);
  const rawBeforeFail = mem['kqzb_db_v1'];
  const ownerBeforeFail = stDb.settings.owner;
  const setSync = global.wx.setStorageSync;
  global.wx.setStorageSync = function () { throw new Error('storage full'); };
  stDb.settings.owner = '未落盘的改动';
  const commitOk = stFix.commit();
  global.wx.setStorageSync = setSync;
  ok(commitOk === false, '保存失败·commit 返回 false');
  ok(stDb.settings.owner === ownerBeforeFail, '保存失败·内存改动已回滚', String(stDb.settings.owner));
  ok(mem['kqzb_db_v1'] === rawBeforeFail, '保存失败·磁盘内容未被改写');
  ok(toasts.some(t => /本地保存失败/.test(t)), '保存失败·给出明确提示', toasts.join('/'));

  reset();
  seedDb();
  const failCal = makePage('calendar');
  failCal.onLoad();
  failCal.openSheet('2026-11-10');
  const setSync2 = global.wx.setStorageSync;
  global.wx.setStorageSync = function () { throw new Error('storage full'); };
  failCal.saveSheet();
  global.wx.setStorageSync = setSync2;
  ok(!!failCal.data.sheet, '保存失败·单日面板保持打开可重试');
  ok(!toasts.some(t => t === '已记下 11 月 10 日'), '保存失败·不再提示已记下', toasts.join('/'));

  /* 2. 清空失败不能再报“已清空” */
  reset();
  const clearDb = seedDb();
  clearDb.days['2026-11-10'] = { am: 'work', pm: '', lessons: 2, note: '', lset: true, upd: 1 };
  mem['kqzb_db_v1'] = JSON.stringify(clearDb);
  const failSet = makePage('settings');
  failSet.onLoad();
  const removeSync = global.wx.removeStorageSync;
  global.wx.removeStorageSync = function () { throw new Error('denied'); };
  failSet.clearAll();
  global.wx.removeStorageSync = removeSync;
  ok(!toasts.some(t => t === '已清空'), '清空失败·不再提示已清空', toasts.join('/'));
  ok(!!current() && Object.keys(current().days).length > 0, '清空失败·本机数据仍在');

  /* 3/4. 已核对月份的汇总页参数修改要二次确认 */
  reset();
  seedDb();
  const checkedYm = core.todayKey().slice(0, 7);
  const checkedDb = current();
  checkedDb.months[checkedYm] = { checked: true, workdays: 20, base: 1000, rate: 30 };
  mem['kqzb_db_v1'] = JSON.stringify(checkedDb);
  const checkedSum = makePage('summary');
  checkedSum.onLoad();
  checkedSum.setData({ ym: checkedYm });
  checkedSum.render();
  const modalBefore = modals.length;
  checkedSum.setBase({ detail: { value: '9000' } });
  ok(modals.length === modalBefore + 1, '已核对·改本月工资弹出确认', String(modals.length - modalBefore));
  ok(current().months[checkedYm].base === 9000, '已核对·确认后修改生效');
  checkedSum.setRate({ detail: { value: '120' } });
  ok(modals.length === modalBefore + 1, '已核对·同月参数只问一次', String(modals.length - modalBefore));
  ok(current().months[checkedYm].rate === 120, '已核对·同批修改仍生效');

  /* 5. 非法日期字段不会让整月出勤/课时失效 */
  const dirty = core.normalize({
    v: core.SCHEMA_VERSION,
    settings: { startDate: 'abc', rate: 30 },
    months: {}, days: {}, term: { start: 'oops', defaultWeeks: 16 },
    courses: []
  });
  ok(dirty.settings.startDate === '' && dirty.term.start === '', '脏日期·normalize 清空非法基准日');
  const rawBadTerm = {
    settings: { startDate: '' },
    term: { start: 'oops' },
    courses: [{ weekday: 1, lessons: 4, startWeek: 1, endWeek: 16 }]
  };
  ok(core.weekOf(rawBadTerm, '2026-11-10') === 0, '脏日期·weekOf 返回 0 而非 NaN');
  ok(core.lessonsFor(rawBadTerm, '2026-11-10') === 0, '脏日期·不会所有课程天天命中');

  /* 6. upd 字符串时间戳统一成数字，避免字典序比较 */
  reset();
  const updDb = seedDb();
  const updKey = core.todayKey();
  updDb.days[updKey] = { am: 'work', pm: '', lessons: 0, note: '', lset: true, upd: '90000000000' };
  const normalizedUpd = core.normalize(updDb);
  ok(typeof normalizedUpd.days[updKey].upd === 'number', '合并·字符串 upd 被规范成数字',
    typeof normalizedUpd.days[updKey].upd);
  const localUpd = core.blankDB();
  localUpd.days[updKey] = { am: 'inv', pm: '', lessons: 2, note: '本机新记录', lset: true, upd: 1795000000000 };
  const incomingUpd = core.normalize(JSON.parse(JSON.stringify(localUpd)));
  incomingUpd.days[updKey].am = 'work';
  incomingUpd.days[updKey].note = '导入旧记录';
  incomingUpd.days[updKey].upd = '90000000000';
  core.normalize(incomingUpd);
  stFix.mergeInto(localUpd, incomingUpd);
  ok(localUpd.days[updKey].note === '本机新记录', '合并·不会因字典序让旧记录盖掉新记录',
    localUpd.days[updKey].note);

  /* 7. 全新空白库合并导入会接管设置与课程表 */
  reset();
  const blankLocal = core.blankDB();
  const incomingAll = seedDb();
  incomingAll.settings.owner = '导入者';
  incomingAll.term.start = '2026-09-21';
  incomingAll.courses.push({ id: 'imported', weekday: 2, weekdays: [2], lessons: 2, startWeek: 1, endWeek: 16 });
  stFix.mergeInto(blankLocal, incomingAll);
  ok(blankLocal.settings.owner === '导入者', '合并·空白库接管导入的工资参数', String(blankLocal.settings.owner));
  ok(blankLocal.term.start === '2026-09-21' && blankLocal.courses.length > 0,
    '合并·空白库接管导入的课程表');

  /* 8. 无可恢复日子时不冲掉上一条撤销 */
  reset();
  seedDb();
  const restoreCal = makePage('calendar');
  restoreCal.onLoad();
  restoreCal._undo = { msg: 'keep-me' };
  restoreCal.restoreDefault();
  ok(restoreCal._undo && restoreCal._undo.msg === 'keep-me', '空操作·保留上一条撤销',
    JSON.stringify(restoreCal._undo));
}

/* 备份交付判定是异步 Promise，放在最后单独断言 */
Promise.resolve().then(function () {
  reset();
  const stBackup = require(path.join(ROOT, 'utils/store.js'));
  const origShare = global.wx.shareFileMessage;
  global.wx.shareFileMessage = function (o) { if (o.fail) { o.fail(new Error('cancel')); } };
  return stBackup.exportBackup(stBackup.load()).then(function (msg) {
    global.wx.shareFileMessage = origShare;
    ok(/剪贴板/.test(msg), '备份·文件失败时仍给出剪贴板兜底文案', msg);
    ok(stBackup.backupAt() === 0, '备份·复制剪贴板不算已备份，提醒保持开启');
  }, function (err) {
    global.wx.shareFileMessage = origShare;
    ok(false, '备份·剪贴板兜底不应 reject', String(err && err.message));
  });
}).then(function () {
  console.log('\n通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (bad.length) { console.log('\n失败项：\n- ' + bad.join('\n- ')); process.exit(1); }
  console.log('页面逻辑全部通过');
});
