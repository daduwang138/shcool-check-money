/* 架构演进第 2 步：把电脑版 HTML 里的手写算法实现换成 core.js 的转发层。
   用法：
     node tools/gen_core_adapter.js            dry-run，只报告映射结果，不写文件
     node tools/gen_core_adapter.js --write    生成并写回 教学考勤记账本.html

   设计要点（都是为了不碰 UI）：
   - **只换函数体，不动函数声明、位置、参数名、注释**。HTML 里 140 个 UI/存储/联网函数原样保留。
   - core.js 包成 IIFE 挂到全局 Core，不依赖 CommonJS；生成时把 require('./spec.js')
     换成读 HTML 里已有的全局常量（由 sync_spec.js 生成）。
   - 映射规则机械：签名一致 → 直接转发；core 比 HTML 多一个 db 参数 → 注入全局 DB
     （按 db 在首参 / 末参两种位置）。任何对不上的函数直接报错退出，不猜。
   - 幂等：CORE 段按标记替换，转发体再次生成结果相同。

   验证靠 tests/verify_core.js：它本来就用 ctx.DB 调用 HTML 签名，转发层映射错了
   46700 项逐字段比对会直接抓到；一致性从此由「同一份源码」保证，不再靠人肉复制。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CORE = path.join(ROOT, 'teaching-attendance-mp', 'utils', 'core.js');
const SPEC = path.join(ROOT, 'teaching-attendance-mp', 'utils', 'spec.js');
const HTML = path.join(ROOT, '教学考勤记账本.html');
const SPEC_END = '/* >>> SPEC:END <<< */';
const MARK_START = '/* >>> CORE:START 由 tools/gen_core_adapter.js 生成，别手改 <<< */';
const MARK_END = '/* >>> CORE:END <<< */';

function lf(s) { return s.replace(/\r\n/g, '\n'); }

/* 抽出行首函数声明，并用括号配平找到函数体结束位置 */
function fnList(src) {
  const re = /^function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/gm;
  const out = [];
  let m;
  while ((m = re.exec(src))) {
    const open = src.indexOf('{', m.index);
    let d = 0, end = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') d++;
      else if (src[i] === '}') { d--; if (d === 0) { end = i; break; } }
    }
    if (end < 0) throw new Error('函数体括号不配平：' + m[1]);
    out.push({
      name: m[1],
      args: m[2].trim().split(',').map(x => x.trim()).filter(Boolean),
      start: m.index, end: end
    });
  }
  return out;
}

function buildCoreBundle() {
  let src = lf(fs.readFileSync(CORE, 'utf8'));
  const reqLine = "var spec = require('./spec.js');";
  if (src.indexOf(reqLine) < 0) throw new Error('core.js 的 require(spec.js) 行变了，生成规则要跟着改');
  /* spec 必须由 IIFE 参数传进来：写成 `var spec = { HOLIDAYS: HOLIDAYS }` 时，
     IIFE 内 `var HOLIDAYS` 会被提升，右边读到的是局部 undefined 而不是外层全局常量。 */
  src = src.replace(reqLine, '');
  const me = src.match(/module\.exports\s*=\s*\{[\s\S]*?\};/);
  if (!me) throw new Error('core.js 里找不到 module.exports');
  const names = fnList(src).map(f => f.name);
  /* 导出全部函数，不只是公开 API：HTML 里转发的 table / customOf / inSpan 等
     是 core.js 的内部函数，没进 module.exports 但转发层要用。 */
  src = src.replace(me[0], 'return {\n' + names.map(n => '  ' + n + ': ' + n).join(',\n') + '\n};');
  /* IIFE 参数从 spec.js 的导出自动派生，别再手工列一遍：
     spec 加一个导出，这里和 sync_spec.js 都会自动跟上。 */
  const specArgs = Object.keys(require(SPEC)).map(function (k) { return k + ': ' + k; }).join(', ');
  return '\n' + MARK_START + '\nvar Core = (function(spec){\n' + src
    + '\n})({' + specArgs + '});\n' + MARK_END;
}

/* 移除旧的 CORE 段时把它前后的空行一起归一化，否则每生成一次就多留一个换行，
   既不幂等、也会让「逐字比较」型护栏误报。 */
function stripCore(html) {
  const a = html.indexOf(MARK_START), b = html.indexOf(MARK_END);
  if (a < 0 && b < 0) return html;
  if (a < 0 || b < 0 || b < a) throw new Error('HTML 里的 CORE 标记不成对');
  let start = a, end = b + MARK_END.length;
  while (start > 0 && html[start - 1] === '\n') start--;
  while (end < html.length && html[end] === '\n') end++;
  return html.slice(0, start) + '\n' + html.slice(end);
}

function forward(h, c) {
  const extra = c.args.length - h.args.length;
  let call;
  if (extra === 0) {
    /* 参数个数相同不代表语义相同：名字/顺序不一致时静默转发会算错，
       直接抛错让人处理，别把隐患藏进生成结果里。 */
    if (c.args.join(',') !== h.args.join(',')) {
      throw new Error(h.name + ' 参数名或顺序不一致，不能直接转发：HTML('
        + h.args.join(',') + ') vs core(' + c.args.join(',') + ')');
    }
    call = 'Core.' + h.name + '(' + h.args.join(', ') + ')';
  } else if (extra === 1 && c.args.includes('db') && !h.args.includes('db')) {
    const idx = c.args.indexOf('db');
    if (idx === 0) call = 'Core.' + h.name + '(DB' + (h.args.length ? ', ' + h.args.join(', ') : '') + ')';
    else if (idx === c.args.length - 1) call = 'Core.' + h.name + '(' + (h.args.length ? h.args.join(', ') + ', ' : '') + 'DB)';
    else throw new Error(h.name + ' 的 db 参数在中间位置，需手工处理');
  } else {
    throw new Error(h.name + ' 无法自动映射：HTML(' + h.args.join(',') + ') vs core(' + c.args.join(',') + ')');
  }
  return 'function ' + h.name + '(' + h.args.join(',') + '){return ' + call + ';}';
}

function generate(htmlText) {
  const coreSrc = lf(fs.readFileSync(CORE, 'utf8'));
  const cMap = new Map(fnList(coreSrc).map(f => [f.name, f]));
  let html = lf(htmlText === undefined ? fs.readFileSync(HTML, 'utf8') : htmlText);
  html = stripCore(html);

  const targets = fnList(html).filter(h => cMap.has(h.name));
  const kept = fnList(html).filter(h => !cMap.has(h.name));
  /* 先全部算一遍映射，任何一个失败都不写文件 */
  const bodies = targets.map(h => ({ h: h, text: forward(h, cMap.get(h.name)) }));

  for (let i = bodies.length - 1; i >= 0; i--) {
    const x = bodies[i];
    html = html.slice(0, x.h.start) + x.text + html.slice(x.h.end + 1);
  }
  const at = html.indexOf(SPEC_END);
  if (at < 0) throw new Error('HTML 里找不到 SPEC 结束标记，CORE 段没地方插');
  const pos = at + SPEC_END.length;
  html = html.slice(0, pos) + buildCoreBundle() + html.slice(pos);
  return { html, mapped: targets.length, kept: kept.length, details: bodies };
}

function report(g) {
  const byKind = { direct: [], dbFirst: [], dbLast: [] };
  g.details.forEach(x => {
    const s = x.text;
    if (s.indexOf('Core.' + x.h.name + '(DB') >= 0) byKind.dbFirst.push(x.h.name);
    else if (/\bDB\)/.test(s)) byKind.dbLast.push(x.h.name);
    else byKind.direct.push(x.h.name);
  });
  console.log('可自动映射 ' + g.mapped + ' 个函数，保留 UI/存储函数 ' + g.kept + ' 个');
  console.log('  直接转发 ' + byKind.direct.length + ' / 注入首参 DB ' + byKind.dbFirst.length
    + ' / 注入末参 DB ' + byKind.dbLast.length);
  console.log('  末参 DB：' + byKind.dbLast.join(', '));
  return byKind;
}

/* 给结构自检用。不比「整份文件逐字相等」（空行、行尾一变就误报），只查两件本质的事：
   ① CORE 段是不是当前 core.js 生成的最新版；② 每个可映射函数是不是真的转发体。
   转发体里 DB 注入位置对不对，交给 verify_core.js 的逐字段比对去验。 */
function check(htmlText) {
  const cur = lf(htmlText);
  const a = cur.indexOf(MARK_START), b = cur.indexOf(MARK_END);
  if (a < 0 || b < 0 || b < a) return { ok: false, reason: 'HTML 里找不到成对的 CORE 生成标记' };
  let bundle;
  try { bundle = lf(buildCoreBundle()); }
  catch (e) { return { ok: false, reason: e.message }; }
  if (cur.slice(a, b + MARK_END.length) !== bundle.slice(bundle.indexOf(MARK_START), bundle.indexOf(MARK_END) + MARK_END.length)) {
    return { ok: false, reason: 'CORE 段不是 utils/core.js 的最新生成结果' };
  }
  let stripped, cMap, targets;
  try {
    stripped = stripCore(cur);
    cMap = new Map(fnList(lf(fs.readFileSync(CORE, 'utf8'))).map(f => [f.name, f]));
    targets = fnList(stripped).filter(h => cMap.has(h.name));
  } catch (e) { return { ok: false, reason: e.message }; }
  const handWritten = targets.filter(h =>
    stripped.slice(h.start, h.end + 1).indexOf('return Core.' + h.name + '(') < 0
  ).map(h => h.name);
  if (handWritten.length) {
    return { ok: false, reason: '还有手写算法实现没转发：' + handWritten.join(', ') };
  }
  return { ok: true };
}

module.exports = { generate, check, MARK_START, MARK_END };

if (require.main === module) {
  const g = generate();
  report(g);
  if (process.argv.indexOf('--write') >= 0) {
    fs.writeFileSync(HTML, g.html, 'utf8');
    console.log('已写回 ' + path.basename(HTML));
  } else {
    console.log('dry-run：未改动文件。确认无误后加 --write。');
  }
}
