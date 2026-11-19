/* 截图核对：把预览页（小程序）或电脑版单文件复制一份，追加「自动切页 / 点开某天 / 塞一份示例数据」
   的小脚本，再调可用的 headless 浏览器截一张 PNG（和冒烟共用同一套浏览器发现）。
   产物全落在系统临时目录，不进仓库、不参与构建。
   用法：node tools/shot.js            小程序三页 + 记账面板，外加电脑版
         node tools/shot.js summary    只截指定的那几个
   产物路径直接打印出来，拿去比对就行。 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MP_SRC = path.join(ROOT, 'preview', 'mp-preview.html');
const PC_SRC = path.join(ROOT, '教学考勤记账本.html');
const OUT = path.join(os.tmpdir(), 'kqzb-shots');

/* 小程序只截 tabBar 上的三页：课程表 / 放假安排要走页面里的入口，这里不模拟跳转。
   pc 为真时截电脑版单文件，顺带塞一份 2026-11 的示例账（不然月历是空的，看不出颜色）。 */
const SHOTS = [
  { name: 'calendar', path: 'pages/calendar/calendar' },
  { name: 'summary', path: 'pages/summary/summary' },
  { name: 'summary-2', path: 'pages/summary/summary', scrollY: 760 },
  /* 常态示例数据的设置值与冻结值一致，参数卡的差异块不会出现；
     这个场景专门造一份不一致的数据，让新增 UI 每次都被真实渲染到。 */
  { name: 'summary-diff', path: 'pages/summary/summary', scrollY: 760,
    diffBase: { setting: 9000, frozen: 8000 } },
  /* 年度视图是条件渲染的，常态截图看不到，必须进页面点切换后再截 */
  { name: 'summary-year', path: 'pages/summary/summary', viaText: '年度' },
  { name: 'settings', path: 'pages/settings/settings' },
  { name: 'sheet', path: 'pages/calendar/calendar', tapDay: '19' },
  /* 放假安排 / 课程表 / 口令都不在 tabBar 上，只能从设置页那一行点进去 */
  { name: 'courses', path: 'pages/settings/settings', viaText: '课程表' },
  { name: 'year', path: 'pages/settings/settings', viaText: '年历总览' },
  { name: 'holiday', path: 'pages/settings/settings', viaText: '放假安排' },
  { name: 'pass', path: 'pages/settings/settings', viaText: '修改口令' },
  { name: 'pc', pc: true, width: 1440, height: 1020, scale: 1 },
  { name: 'pc-year', pc: true, pcView: 'year', width: 1440, height: 1020, scale: 1 }
];

/* 复用 tests/browser.js 的发现逻辑：逐个自检、优先 chrome-headless-shell。
   本机 Edge/Chrome 157 的新版 headless 启动即退出，硬编码这两个路径只会拿到假成功。 */
const browser = require('../tests/browser.js');
function findEdge() {
  const exe = browser.findBrowser();
  if (!exe) {
    throw new Error('没有可用的 headless 浏览器；跑 node tools/install_headless_shell.js 装一个');
  }
  return exe;
}

/* 电脑版是单文件应用，数据只从 localStorage 读；在 <head> 塞一条写入语句就等于先存了一份账 */
function pcDemo(shot) {
  const days = {};
  for (let d = 1; d <= 31; d++) {
    const k = '2026-11-' + String(d).padStart(2, '0');
    const w = new Date(2026, 10, d).getDay();
    if (w >= 1 && w <= 5) { days[k] = { am: 'work', pm: 'work', lessons: 4, note: '', lset: false }; }
  }
  days['2026-11-06'] = { am: 'inv', pm: 'inv', lessons: 0, note: '期中监考', night: 1 };
  days['2026-11-13'] = { am: 'ot', pm: 'work', lessons: 2, note: '', lset: false };
  days['2026-11-19'] = { am: 'work', pm: '', lessons: 2, note: '', lset: false };
  days['2026-11-20'] = { am: 'leave', pm: 'leave', lessons: 0, note: '事假' };
  const db = {
    v: 1, savedAt: Date.now(),
    settings: { baseSalary: 8000, rate: 120, weekPattern: [0, 1, 1, 1, 1, 1, 0], autoWork: true },
    months: {}, days, term: { start: '' }, courses: []
  };
  /* 注入到临时演示页的代码；隐私模式下 localStorage 不可用，塞不进示例账就显示空月历 */
  let code = 'try{localStorage.setItem("kqzb_data_v1",' + JSON.stringify(JSON.stringify(db))
    + ');}catch(e){/* 忽略：隐私模式没有 localStorage */}';
  if (shot.pcView) {
    code += "window.addEventListener('load',function(){setTimeout(function(){"
      + "var b=document.querySelector('.tab[data-view=\"" + shot.pcView + "\"]');"
      + 'if(b){b.click();}},350);});';
  }
  const inject = '<script>' + code + '</scr' + 'ipt>';
  return fs.readFileSync(PC_SRC, 'utf8').replace('<head>', '<head>' + inject);
}

function boot(shot) {
  const lines = [
    '<script>',
    'window.addEventListener("load", function () {',
    '  setTimeout(function () {',
    '    var t = document.querySelector("[data-path=\\"' + shot.path + '\\"]");',
    '    if (t) { t.click(); }'
  ];
  if (shot.tapDay) {
    /* 格子是按「日」渲染的，按日期数字找比记 key 稳（key 不是 DOM 属性） */
    lines.push(
      '    setTimeout(function () {',
      '      var cs = [].slice.call(document.querySelectorAll(".cell"));',
      '      for (var i = 0; i < cs.length; i++) {',
      '        var dn = cs[i].querySelector(".dn");',
      '        if (dn && dn.textContent.trim() === "' + shot.tapDay + '") { cs[i].click(); break; }',
      '      }',
      '    }, 300);'
    );
  }
  if (shot.viaText) {
    /* 二级页没有 tabBar 入口：在设置页里找「文字最短、又带 tap 绑定」的那个元素点进去。
       取最短是因为 bindtap 挂在外层 .row 上，子节点只是文字，取最短的正好是那一行本身。 */
    lines.push(
      '    setTimeout(function () {',
      '      var all = [].slice.call(document.querySelectorAll("[data-mp-ev-tap],[data-mp-cv-tap]"));',
      '      var best = null;',
      '      for (var i = 0; i < all.length; i++) {',
      '        var t = (all[i].textContent || "").replace(/\\s+/g, "");',
      '        if (t.indexOf("' + shot.viaText + '") >= 0 && (!best || t.length < best.t.length)) {',
      '          best = { el: all[i], t: t };',
      '        }',
      '      }',
      '      if (best) { best.el.click(); }',
      '    }, 600);'
    );
  }
  if (shot.scrollY) {
    /* 页面滚在 .mp-body 里（不是 window），往下推多少才看得到下半张卡 */
    lines.push(
      '    setTimeout(function () {',
      '      var b = document.querySelector(".mp-body");',
      '      if (b) { b.scrollTop = ' + shot.scrollY + '; }',
      '    }, 500);'
    );
  }
  lines.push('  }, 400);', '});', '</scr' + 'ipt>');
  return lines.join('\n');
}

/* 差异场景：改写预览页内联的 SAMPLE，造一份「设置默认工资 != 本月冻结工资」的数据。
   不碰仓库里的预览产物，只在内存里替换后写到临时目录。 */
function mpDiff(shot, src) {
  const marker = 'var SAMPLE = ';
  const a = src.indexOf(marker);
  if (a < 0) throw new Error('预览页里找不到 SAMPLE，差异场景没法构造');
  const start = a + marker.length;
  let d = 0, end = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error('SAMPLE 括号不配平');
  const sample = JSON.parse(src.slice(start, end));
  sample.settings.baseSalary = shot.diffBase.setting;
  sample.months = sample.months || {};
  sample.months['2026-11'] = Object.assign({}, sample.months['2026-11'] || {},
    { base: shot.diffBase.frozen });
  return (src.slice(0, start) + JSON.stringify(sample) + src.slice(end))
    .replace('</body>', boot(shot) + '\n</body>');
}

const only = process.argv.slice(2);
const list = only.length ? SHOTS.filter(s => only.indexOf(s.name) >= 0) : SHOTS;
if (!list.length) { throw new Error('没有匹配的截图名：' + only.join(', ')); }
if (!fs.existsSync(OUT)) { fs.mkdirSync(OUT, { recursive: true }); }

const edge = findEdge();
const mpHtml = fs.readFileSync(MP_SRC, 'utf8');

for (const shot of list) {
  const page = path.join(OUT, shot.name + '.html');
  const png = path.join(OUT, shot.name + '.png');
  const html = shot.pc ? pcDemo(shot)
    : (shot.diffBase ? mpDiff(shot, mpHtml) : mpHtml.replace('</body>', boot(shot) + '\n</body>'));
  fs.writeFileSync(page, html, 'utf8');
  /* 旧 PNG 会让 existsSync 假成功：Edge headless 静默失效时一个字节都不产，
     工具却报「截图成功」并把上一次的图当本次结果给人看。先删掉再按本次产物判断。 */
  try { fs.unlinkSync(png); } catch (e) { /* 第一次跑本来就没有 */ }
  const r = spawnSync(edge, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=' + (shot.scale || 2),
    '--window-size=' + (shot.width || 420) + ',' + (shot.height || 860),
    '--virtual-time-budget=2800',
    '--screenshot=' + png,
    'file:///' + page.replace(/\\/g, '/')
  ], { stdio: 'ignore' });
  if (r.error || r.status !== 0 || !fs.existsSync(png) || fs.statSync(png).size === 0) {
    throw new Error(shot.name + ' 截图失败：浏览器没产出 PNG（本机 headless 浏览器可能不可用，'
      + '可设 BROWSER=路径 换一个）；不要用上一次留下的旧图冒充本次结果');
  }
  console.log(png + '  ' + Math.round(fs.statSync(png).size / 1024) + ' KB');
}
