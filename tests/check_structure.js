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

let hCount = 0, cCount = 0, rCount = 0;
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

if (bad.length) { console.log('FAIL\n' + bad.join('\n')); process.exit(1); }
console.log('结构自检通过：' + hCount + ' 个事件方法、' + cCount + ' 个 class、wxss ' + rCount + ' 条规则');
