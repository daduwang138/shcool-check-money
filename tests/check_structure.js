/* 结构自检：wxml 标签闭合、绑定的事件方法是否存在、wxss 花括号配平、用到的 class 是否有样式
   覆盖 teaching-attendance-mp/pages 下的全部页面 */
const fs = require('fs');
const path = require('path');
const PAGES = path.resolve(__dirname, '..', 'teaching-attendance-mp', 'pages');
const APP_WXSS = path.resolve(__dirname, '..', 'teaching-attendance-mp', 'app.wxss');

let bad = [];
const appWxss = fs.readFileSync(APP_WXSS, 'utf8');

function checkWxml(name, src) {
  const stack = [];
  const re = /<(\/?)([a-zA-Z-]+)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(src))) {
    const [, close, tag, , self] = m;
    if (self || ['input', 'image', 'icon'].includes(tag)) continue;
    if (close) {
      const top = stack.pop();
      if (top !== tag) bad.push(name + ' 标签不匹配：</' + tag + '> 对上 <' + top + '>');
    } else stack.push(tag);
  }
  if (stack.length) bad.push(name + ' 未闭合标签：' + stack.join(','));
}

let hCount = 0, cCount = 0, rCount = 0, bCount = 0, dCount = 0;
fs.readdirSync(PAGES).forEach(function (dir) {
  const base = path.join(PAGES, dir, dir);
  if (!fs.existsSync(base + '.wxml')) { return; }
  const wxml = fs.readFileSync(base + '.wxml', 'utf8');
  const js = fs.readFileSync(base + '.js', 'utf8');
  const wxss = fs.readFileSync(base + '.wxss', 'utf8');

  checkWxml(dir, wxml);

  const handlers = new Set();
  wxml.replace(/bind(?:tap|change|input|touchstart|touchmove|touchend|touchcancel)="([^"]+)"/g, (_, h) => { handlers.add(h); });
  wxml.replace(/catch(?:tap|touchmove)="([^"]+)"/g, (_, h) => { handlers.add(h); });
  handlers.forEach(h => {
    if (!new RegExp('\\b' + h + '\\s*:\\s*function').test(js)) bad.push(dir + ' 缺方法：' + h);
  });
  hCount += handlers.size;

  const open = (wxss.match(/{/g) || []).length, close = (wxss.match(/}/g) || []).length;
  if (open !== close) bad.push(dir + ' wxss 花括号不配平：' + open + ' vs ' + close);
  rCount += open;

  const classes = new Set();
  wxml.replace(/class="([^"]+)"/g, (_, v) => {
    v.replace(/\{\{[^}]*\}\}/g, ' ')
      .split(/\s+/)
      .forEach(c => { if (/^[a-zA-Z][\w-]*$/.test(c)) classes.add(c); });
  });
  const missing = [...classes].filter(c => !wxss.includes('.' + c) && !appWxss.includes('.' + c));
  if (missing.length) bad.push(dir + ' 样式缺失：' + missing.join(', '));
  cCount += classes.size;

  /* 插值里的字面量 class（如 {{on ? 'dim' : ''}}）以前整段被抹成空格，等于没查。
     参数框灰掉、标签选中这类「状态样式」全靠它，漏了就是界面看上去没反应。 */
  const dynClasses = new Set();
  wxml.replace(/class="([^"]+)"/g, function (_, v) {
    /* 只取三元的结果分支：条件里 {{scope === 'both' ? 'on' : ''}} 的 'both'
       是比较值、不是 class，把它算进来会误报。'on' / '' 才是真正的类名。 */
    let tm;
    const ternRe = /\?\s*['"]([a-zA-Z][\w-]*)?['"]\s*:\s*['"]([a-zA-Z][\w-]*)?['"]/g;
    while ((tm = ternRe.exec(v))) {
      if (tm[1]) dynClasses.add(tm[1]);
      if (tm[2]) dynClasses.add(tm[2]);
    }
  });
  const dynMissing = [...dynClasses].filter(c => !wxss.includes('.' + c) && !appWxss.includes('.' + c));
  if (dynMissing.length) bad.push(dir + ' 动态 class 缺样式：' + dynMissing.join(', '));
  dCount += dynClasses.size;

  /* 绑定契约：见文件末尾 orphanBindings()。 */
  const binding = orphanBindings(wxml, js);
  binding.orphans.forEach(function (name) {
    bad.push(dir + ' wxml 绑定了「' + name + '」，但页面 js 找不到这个 data 字段 / setData 键');
  });
  bCount += binding.names.length;
});

/* 文案哨兵：这些说明曾经和代码对不上，钉住别再漂回去。
   填 0 是「学校不发这笔钱」的开关：没记过的日子不显示录入区，已记过的仍显示以便清零。 */
const HTML_SRC = path.resolve(__dirname, '..', '教学考勤记账本.html');
const htmlSrc = fs.readFileSync(HTML_SRC, 'utf8');
const mpSet = fs.readFileSync(path.join(PAGES, 'settings', 'settings.wxml'), 'utf8');
[['电脑版', htmlSrc], ['小程序版', mpSet]].forEach(function (p) {
  if (/次数照常可记|算 0 元/.test(p[1])) bad.push(p[0] + '设置页仍承诺「填 0 也能照常记」，但录入区实际会隐藏');
  if (p[1].indexOf('填 0 就') < 0) bad.push(p[0] + '设置页没写清「填 0 即关闭晚修录入」');
});
/* 冻结价说明哨兵：设置页改的是「以后的默认值」，不是回改已记账的月份。
   两版设置页以前都没写这句，用户改完全局工资以为当月总额会跟着变。 */
[['电脑版', htmlSrc], ['小程序版', mpSet]].forEach(function (p) {
  if (p[1].indexOf('已记账的月份不跟着变') < 0) {
    bad.push(p[0] + '设置页没写清「改的是默认值、已记账月份不跟着变」');
  }
});
/* 参数卡口径哨兵：两版输入框都是失焦保存，提示必须成对出现。
   曾只给小程序加了这句、电脑版漏了，用户改完以为没生效。 */
const mpSum = fs.readFileSync(path.join(PAGES, 'summary', 'summary.wxml'), 'utf8');
[['电脑版', htmlSrc], ['小程序版', mpSum]].forEach(function (p) {
  if (p[1].indexOf('别处才生效') < 0) {
    bad.push(p[0] + '参数卡没写「改完点一下别处才生效」');
  }
});
/* 口径常量唯一真源：spec.js 改了却没生成 HTML，这里要拦住。
   以前放假表 / 状态定义是两版各抄一份，加年份得改两处，还容易漏。 */
const syncSpec = require('../tools/sync_spec.js');
const specState = syncSpec.check(htmlSrc);
if (!specState.ok) {
  bad.push('双版口径常量不同步：' + specState.reason
    + '；改了 utils/spec.js 请跑 node tools/sync_spec.js');
}
/* 变异自检：故意把生成段改坏，check() 必须抓到，别让护栏变成摆设 */
if (syncSpec.check(htmlSrc.replace(/"cls": "s-work"/, '"cls": "s-WORK"')).ok) {
  bad.push('SPEC 同步自检·常量被改动却没抓到，护栏形同虚设');
}

/* 算法转发层护栏：HTML 里不该再有手写的算法实现，60 个函数都应是 core.js 的转发体。
   core.js 改了没跑生成器、或有人把转发体改回手写实现，这里都会拦住。 */
const genAdapter = require('../tools/gen_core_adapter.js');
const adapterState = genAdapter.check(htmlSrc);
if (!adapterState.ok) {
  bad.push('算法转发层不同步：' + adapterState.reason
    + '；改了 utils/core.js 请跑 node tools/gen_core_adapter.js --write');
}
if (genAdapter.check(htmlSrc.replace('return Core.pad(', 'return Core.PAD(')).ok) {
  bad.push('转发层同步自检·转发体被改坏却没抓到，护栏形同虚设');
}
if (htmlSrc.indexOf('法定工作日内置 2026 年（') >= 0) bad.push('电脑版说明卡写死只内置 2026 年，新增年份会漏');
const ruleLine = (htmlSrc.match(/<p class="muted">计算规则：[^\n]*<\/p>/) || [''])[0];
if (!/④/.test(ruleLine)) bad.push('电脑版说明卡的应发公式漏了 ④ 晚修监考费');

/* 自动落账口径哨兵：开关说明必须与 autoFillLessons() 一致——
   默认开、未来不预填、已核对不动、10 秒可撤销、撤销后本月不再自动填。 */
function near(src, marker, back, fwd) {
  const i = src.indexOf(marker);
  return i < 0 ? '' : src.slice(Math.max(0, i - back), i + fwd);
}
[['电脑版', near(htmlSrc, 'data-k="autoLessons"', 500, 100)],
 ['小程序版', near(mpSet, 'data-key="autoLessons"', 500, 100)]].forEach(function (p) {
  const t = p[1];
  if (!t) { bad.push(p[0] + '设置页缺「按课程表自动记课时」开关'); return; }
  if (!/未来.{0,8}不预填/.test(t)) bad.push(p[0] + '自动落账说明没写「未来不预填」');
  if (!/已核对/.test(t)) bad.push(p[0] + '自动落账说明没写「已核对的月份不动」');
  if (!/10 秒/.test(t)) bad.push(p[0] + '自动落账说明没写「10 秒可撤销」');
  if (!/不再自动填/.test(t)) bad.push(p[0] + '自动落账说明没写「撤销后本月不再自动填」');
});

/* 名称哨兵：账号/备案名是「考勤记账本-个人版」，两版用户可见的名称必须一致。
   磁盘文件名「教学考勤记账本.html」只是本地路径、不进微信包，特意保留，别当残留误报。 */
const APP_NAME = '考勤记账本-个人版';
const OLD_NAME = '教学考勤记账本';
const MP_ROOT = path.resolve(__dirname, '..', 'teaching-attendance-mp');
[['app.json', /"navigationBarTitleText":\s*"([^"]+)"/],
 ['app.js', /appName:\s*'([^']+)'/],
 ['project.config.json', /"description":\s*"([^"]+)"/]].forEach(function (f) {
  const m = fs.readFileSync(path.join(MP_ROOT, f[0]), 'utf8').match(f[1]);
  if (!m || m[1].indexOf(APP_NAME) !== 0) bad.push('小程序 ' + f[0] + ' 的名称不是「' + APP_NAME + '」');
});
const SHARE_PAGES = ['calendar', 'summary', 'settings', 'courses', 'holiday'];
SHARE_PAGES.forEach(function (pg) {
  const src = fs.readFileSync(path.join(PAGES, pg, pg + '.js'), 'utf8');
  if (src.indexOf("title: '" + APP_NAME) < 0) bad.push('页面 ' + pg + ' 的转发标题没用新名称');
});
if (fs.readFileSync(path.join(PAGES, 'lock', 'lock.wxml'), 'utf8').indexOf(APP_NAME) < 0) bad.push('口令锁页标题没用新名称');
if (htmlSrc.indexOf('<title>' + APP_NAME + '</title>') < 0) bad.push('电脑版 <title> 没用新名称');
[path.join(MP_ROOT, 'app.json'), path.join(MP_ROOT, 'app.js'),
 path.join(MP_ROOT, 'project.config.json'), path.join(PAGES, 'lock', 'lock.wxml'),
 path.resolve(__dirname, '..', 'README.md'), path.resolve(__dirname, '..', '功能逻辑.md'), HTML_SRC]
  .concat(SHARE_PAGES.map(function (pg) { return path.join(PAGES, pg, pg + '.js'); }))
  .forEach(function (p) {
    const src = fs.readFileSync(p, 'utf8');
    if (src.split(OLD_NAME + '.html').join('').indexOf(OLD_NAME) >= 0) {
      bad.push(path.basename(p) + ' 里还有旧名称「' + OLD_NAME + '」（文件名引用除外）');
    }
  });

/* 口令不能退回 window.prompt：明文可见、输入法还会记词 */
if (/\bprompt\s*\(/.test(htmlSrc)) bad.push('电脑版还在用 window.prompt 收口令，必须走 password 输入框');
if (htmlSrc.indexOf('function askPass(') < 0) bad.push('电脑版缺少自绘的口令输入框 askPass()');

/* 绑定契约：wxml 的 {{}} 里每个顶层字段，页面 js 必须真的写过。
   桩测试只跑 js 的 setData、不渲染 wxml；旧的静态检查又只查「方法/class 存在」。
   于是「data 算对了、界面绑了个没人写的字段」「条件渲染字段没在 render 里写回」
   这两类问题从来没人拦，只能靠肉眼撞见。函数声明会提升，放末尾也能被上面的循环调用。 */
function orphanBindings(wxml, js) {
  const loopVars = new Set(['item', 'index']);
  wxml.replace(/wx:for-item="([^"]+)"/g, (_, v) => { loopVars.add(v); });
  wxml.replace(/wx:for-index="([^"]+)"/g, (_, v) => { loopVars.add(v); });
  const BUILTINS = new Set(['true', 'false', 'null', 'undefined', 'Math', 'String', 'Number', 'parseInt', 'parseFloat']);
  const bound = new Set();
  let em;
  const exprRe = /\{\{([\s\S]*?)\}\}/g;
  while ((em = exprRe.exec(wxml))) {
    const expr = em[1].replace(/'[^']*'|"[^"]*"/g, ' ');
    let im;
    const idRe = /(\.)?\b([A-Za-z_$][\w$]*)\b/g;
    while ((im = idRe.exec(expr))) {
      if (im[1] || loopVars.has(im[2]) || BUILTINS.has(im[2])) continue;
      bound.add(im[2]);
    }
  }
  const names = [...bound];
  const orphans = names.filter(function (name) {
    return !new RegExp('(^|[^\\w.$])' + name + '\\s*:', 'm').test(js);
  });
  return { names: names, orphans: orphans };
}

/* 变异自检：这层检查本身必须有效，别写成永远通过的摆设。
   故意给一段「wxml 用了 enableBase、js 却没写回」的代码，看它抓不抓得到。 */
const mutWxml = '<view wx:if="{{!enableBase}}">{{total}}</view>';
const mutJsOk = 'Page({ data: { total: 0 }, render: function(){ this.setData({ total: 1, enableBase: true }); } });';
const mutJsBad = 'Page({ data: { total: 0 }, render: function(){ this.setData({ total: 1 }); } });';
if (orphanBindings(mutWxml, mutJsOk).orphans.length) bad.push('绑定契约自检·正常页面被误报');
if (orphanBindings(mutWxml, mutJsBad).orphans.indexOf('enableBase') < 0) {
  bad.push('绑定契约自检·漏写的字段没被抓到，这层检查形同虚设');
}

if (bad.length) { console.log('FAIL\n' + bad.join('\n')); process.exit(1); }
console.log('结构自检通过：' + hCount + ' 个事件方法、' + cCount + ' 个 class、wxss ' + rCount + ' 条规则、'
  + bCount + ' 个绑定字段、' + dCount + ' 个动态 class');
