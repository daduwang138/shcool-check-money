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

if (bad.length) { console.log('FAIL\n' + bad.join('\n')); process.exit(1); }
console.log('结构自检通过：' + hCount + ' 个事件方法、' + cCount + ' 个 class、wxss ' + rCount + ' 条规则');
