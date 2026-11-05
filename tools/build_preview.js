/* 把小程序的真实源码打包成一个可以直接双击打开的单文件预览。
   用法：node tools/build_preview.js
   产物：preview/mp-preview.html */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MP = path.join(ROOT, 'teaching-attendance-mp');
const OUT_DIR = path.join(ROOT, 'preview');
const OUT = path.join(OUT_DIR, 'mp-preview.html');

const core = require(path.join(MP, 'utils/core.js'));

/* 读源码统一成 LF：源文件一旦被编辑器存成 CRLF，内嵌进去的源码字符串就跟着变，
   同一份代码构建两次产物不同。仓库约定是 LF，这里是防手滑的兜底。 */
function lf(s) { return s.replace(/\r\n/g, '\n'); }
function rd(p) { return lf(fs.readFileSync(path.join(MP, p), 'utf8')); }

const PAGES = [
  { key: 'pages/calendar/calendar', title: '记账', isTab: true },
  { key: 'pages/summary/summary', title: '月汇总', isTab: true },
  { key: 'pages/settings/settings', title: '设置', isTab: true },
  { key: 'pages/courses/courses', title: '课程表', isTab: false },
  { key: 'pages/holiday/holiday', title: '放假安排', isTab: false },
  { key: 'pages/pass/pass', title: '口令', isTab: false },
  { key: 'pages/lock/lock', title: '口令', isTab: false }
];

/* ---------------- 示例数据 ---------------- */
function tag(db, key, am, pm, note) {
  const prev = db.days[key];
  const les = prev ? (parseInt(prev.lessons, 10) || 0) : 0;
  core.setRecord(db, key, am, pm, les, note || '');
}

function makeSample() {
  let db = core.blankDB();
  db.settings.owner = '王老师';
  db.settings.baseSalary = 8000;
  db.settings.rate = 120;
  db.settings.startDate = '2026-09-21';
  db.term.start = '2026-08-31';
  db.courses = [
    { id: 'c1', name: '高一(3)班 语文', weekday: 1, lessons: 2, startWeek: 1, endWeek: 16, parity: 'all' },
    { id: 'c2', name: '高二(1)班 语文', weekday: 3, lessons: 2, startWeek: 1, endWeek: 16, parity: 'all' },
    { id: 'c3', name: '语文晚自习', weekday: 5, lessons: 1, startWeek: 1, endWeek: 16, parity: 'odd' }
  ];
  db = core.normalize(db);

  /* 9、10 月已经按课程表填过；11 月只填前半月，
     后半月留空，方便试「按课程表填课时」和看虚线提示 */
  ['2026-09', '2026-10', '2026-11'].forEach(ym => core.fillLessonsFromCourses(db, ym));
  Object.keys(db.days).forEach(k => {
    if (k >= '2026-11-16' && k <= '2026-11-30' && db.days[k] && db.days[k].lset) {
      delete db.days[k];
    }
  });

  tag(db, '2026-10-15', 'inv', 'inv', '月考监考');
  tag(db, '2026-10-24', 'ot', 'ot', '周末加班整理材料');
  tag(db, '2026-10-29', 'leave', 'work', '上午体检');
  tag(db, '2026-11-03', 'work', 'inv', '下午监考');
  tag(db, '2026-11-06', 'leave', 'leave', '事假');
  return db;
}

/* ---------------- 打包 ---------------- */
const sources = {
  'app.js': rd('app.js'),
  'utils/core.js': rd('utils/core.js'),
  'utils/store.js': rd('utils/store.js'),
  'utils/lock.js': rd('utils/lock.js')
};

const pages = {};
PAGES.forEach(p => {
  const wxml = rd(p.key + '.wxml');
  const wxss = rd(p.key + '.wxss');
  const js = rd(p.key + '.js');
  pages[p.key] = { title: p.title, isTab: p.isTab, wxml, wxss, js };
  sources[p.key + '.js'] = js;
});

const payload = {
  sources,
  pages,
  appWxss: rd('app.wxss'),
  first: PAGES[0].key
};

const sample = makeSample();

/* setRecord 等写入会打 Date.now()，这些时间戳被内联进了产物，于是同一份源码
   构建两次结果不同，git 永远显示「有改动」。统一钉成示例月份里的同一时刻，
   预览里这个字段只用于跨文件裁决，不参与任何显示。 */
const SAMPLE_STAMP = Date.parse('2026-11-04T20:30:00+08:00');
const STAMP_KEYS = /^(upd|at|ts|savedAt|frozenAt)$/;
const sampleStable = JSON.parse(JSON.stringify(sample, function (k, v) {
  return (k && STAMP_KEYS.test(k)) ? SAMPLE_STAMP : v;
}));

/* 示例数据指纹：示例变了就重新种，用户在页面里改的数据则保留 */
const sig = (() => {
  const raw = JSON.stringify(sampleStable);
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = (h * 31 + raw.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
})();

const esc = s => String(s).replace(/<\/script/gi, '<\\/script');

const shell = lf(fs.readFileSync(path.join(__dirname, 'preview', 'shell.html'), 'utf8'));
const runtime = lf(fs.readFileSync(path.join(__dirname, 'preview', 'runtime.js'), 'utf8'));

const boot = `(function () {
  var CFG = ${esc(JSON.stringify(payload))};
  var SAMPLE = ${esc(JSON.stringify(sampleStable))};
  var SIG = '${sig}';
  var SIG_KEY = 'kqzb_preview_sig';
  var KEY = 'kqzb_preview_storage';

  function seed() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ kqzb_db_v1: JSON.stringify(SAMPLE) }));
    } catch (e) { /* 隐私模式下忽略 */ }
  }

  var curSig = null;
  try { curSig = localStorage.getItem(SIG_KEY); } catch (e) { curSig = null; }
  if (curSig !== SIG) {
    seed();
    try { localStorage.setItem(SIG_KEY, SIG); } catch (e) { /* 忽略 */ }
  }

  MPPreview.boot(CFG);

  document.addEventListener('click', function (e) {
    var b = e.target.closest('.ops button');
    if (!b) { return; }
    var act = b.getAttribute('data-act');
    if (act === 'sample') {
      seed();
      location.reload();
    } else if (act === 'reset') {
      localStorage.removeItem(KEY);
      try { localStorage.setItem(SIG_KEY, SIG); } catch (err) { /* 忽略 */ }
      location.reload();
    }
  });

  /* 窗口不够大时整体缩小 */
  var stage = document.querySelector('.stage');
  function fit() {
    var w = window.innerWidth - 60;
    var h = window.innerHeight - 40;
    var wide = w > 760 + 300;
    var availW = wide ? w - 344 : w;
    var s = Math.min(1, h / 812, availW / 375);
    stage.style.transform = s < 0.999 ? 'scale(' + s.toFixed(3) + ')' : '';
  }
  fit();
  window.addEventListener('resize', fit);
})();`;

let html = shell
  .replace('/*__SOURCES__*/', () => 'window.__MP_PAYLOAD__ = ' + esc(JSON.stringify(payload)) + ';')
  .replace('/*__RUNTIME__*/', () => runtime)
  .replace('/*__BOOT__*/', () => boot);

fs.mkdirSync(OUT_DIR, { recursive: true });
/* 出口再归一化一次：模板字符串的换行取的是本文件自己的行尾，
   本文件要是被编辑器存成 CRLF，产物里就会混进 CRLF。 */
fs.writeFileSync(OUT, lf(html), 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log('已生成 ' + path.relative(ROOT, OUT) + '（' + kb + ' KB）');
console.log('页面：' + Object.keys(pages).length + ' 个，示例数据 ' + core.dayCount(sample) + ' 天记录');
