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

function rd(p) { return fs.readFileSync(path.join(MP, p), 'utf8'); }

const PAGES = [
  { key: 'pages/calendar/calendar', title: '记账', isTab: true },
  { key: 'pages/summary/summary', title: '月汇总', isTab: true },
  { key: 'pages/settings/settings', title: '设置', isTab: true },
  { key: 'pages/courses/courses', title: '课程表', isTab: false }
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
  'utils/store.js': rd('utils/store.js')
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

/* 示例数据指纹：示例变了就重新种，用户在页面里改的数据则保留 */
const sig = (() => {
  const raw = JSON.stringify(sample);
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = (h * 31 + raw.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
})();

const esc = s => String(s).replace(/<\/script/gi, '<\\/script');

const shell = fs.readFileSync(path.join(__dirname, 'preview', 'shell.html'), 'utf8');
const runtime = fs.readFileSync(path.join(__dirname, 'preview', 'runtime.js'), 'utf8');

const boot = `(function () {
  var CFG = ${esc(JSON.stringify(payload))};
  var SAMPLE = ${esc(JSON.stringify(sample))};
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
fs.writeFileSync(OUT, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
console.log('已生成 ' + path.relative(ROOT, OUT) + '（' + kb + ' KB）');
console.log('页面：' + Object.keys(pages).length + ' 个，示例数据 ' + core.dayCount(sample) + ' 天记录');
