/* 结构自检：wxml 标签闭合、绑定的事件方法是否存在、wxss 花括号配平 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', 'teaching-attendance-mp', 'pages', 'calendar');

let bad = [];
function checkWxml() {
  const src = fs.readFileSync(path.join(ROOT, 'calendar.wxml'), 'utf8');
  const stack = [];
  const re = /<(\/?)([a-zA-Z-]+)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(src))) {
    const [, close, tag, , self] = m;
    if (self || ['input', 'image', 'icon'].includes(tag)) continue;
    if (close) {
      const top = stack.pop();
      if (top !== tag) bad.push('标签不匹配：</' + tag + '> 对上 <' + top + '>');
    } else stack.push(tag);
  }
  if (stack.length) bad.push('未闭合标签：' + stack.join(','));
  return src;
}

const wxml = checkWxml();
const js = fs.readFileSync(path.join(ROOT, 'calendar.js'), 'utf8');
const cfg = {};
const handlers = new Set();
wxml.replace(/bind(?:tap|change|input)="([^"]+)"/g, (_, h) => { handlers.add(h); });
wxml.replace(/catch(?:tap|touchmove)="([^"]+)"/g, (_, h) => { handlers.add(h); });
handlers.forEach(h => {
  if (!new RegExp('\\b' + h + '\\s*:\\s*function').test(js)) bad.push('缺方法：' + h);
});

const wxss = fs.readFileSync(path.join(ROOT, 'calendar.wxss'), 'utf8');
const open = (wxss.match(/{/g) || []).length, close = (wxss.match(/}/g) || []).length;
if (open !== close) bad.push('wxss 花括号不配平：' + open + ' vs ' + close);

/* 用到的 class 是否在 wxss 里有定义 */
const classes = new Set();
wxml.replace(/class="([^"]+)"/g, (_, v) => {
  v.replace(/\{\{[^}]*\}\}/g, ' ')
    .split(/\s+/)
    .forEach(c => { if (/^[a-zA-Z][\w-]*$/.test(c)) classes.add(c); });
});
const missing = [...classes].filter(c => !wxss.includes('.' + c) && !fs.readFileSync(path.join(ROOT, '..', '..', 'app.wxss'), 'utf8').includes('.' + c));
if (missing.length) bad.push('样式缺失：' + missing.join(', '));

if (bad.length) { console.log('FAIL\n' + bad.join('\n')); process.exit(1); }
console.log('结构自检通过：' + handlers.size + ' 个事件方法、' + classes.size + ' 个 class、wxss ' + open + ' 条规则');
