/* 把 utils/spec.js 的口径常量生成为电脑版单文件里的同名全局常量。
   用法：node tools/sync_spec.js   （生成并写回 教学考勤记账本.html）
   测试直接 require 这个文件的 check()，不启动进程也能比对。

   为什么只生成数据、不生成函数：HTML 用隐式全局 DB、core.js 用显式传参，
   两边算法函数签名有 26 处不同，硬生成等于重写一层 adapter。先把「最容易漂移、
   且改起来最频繁」的常量收敛成单一真源，算法函数仍由 verify_core.js 逐字段比对。 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SPEC = path.join(ROOT, 'teaching-attendance-mp', 'utils', 'spec.js');
const HTML = path.join(ROOT, '教学考勤记账本.html');

const MARK_START = '/* >>> SPEC:START 由 tools/sync_spec.js 从 utils/spec.js 生成，别手改 <<< */';
const MARK_END = '/* >>> SPEC:END <<< */';

function loadSpec() {
  delete require.cache[require.resolve(SPEC)];
  return require(SPEC);
}

function render(spec) {
  const j = o => JSON.stringify(o, null, 2);
  return [
    MARK_START,
    /* 保持 `var STATES={` 这个开头：verify_core.js 靠它定位算法切片 */
    'var STATES=' + j(spec.STATES) + ';',
    'var CYCLE=' + j(spec.CYCLE) + ';',
    '',
    '/* 国务院办公厅公布的放假安排；缺年份时按「周末休、工作日上」的朴素规则 */',
    'var HOLIDAYS=' + j(spec.HOLIDAYS) + ';',
    'var PAY_ITEMS=' + j(spec.PAY_ITEMS) + ';',
    'var SCHEMA_VERSION=' + j(spec.SCHEMA_VERSION) + ';',
    'var DAY_FIELDS=' + j(spec.DAY_FIELDS) + ';',
    'var MIGRATIONS=' + j(spec.MIGRATIONS) + ';',
    MARK_END
  ].join('\n');
}

function expected() { return render(loadSpec()); }

function lf(s) { return s.replace(/\r\n/g, '\n'); }

/* 给结构自检用：spec.js 改了却没跑生成，这里会拦住 */
function check(htmlText) {
  const src = lf(htmlText);
  const a = src.indexOf(MARK_START), b = src.indexOf(MARK_END);
  if (a < 0 || b < 0 || b < a) return { ok: false, reason: 'HTML 里找不到 SPEC 生成标记段' };
  const current = src.slice(a, b + MARK_END.length);
  if (current !== lf(expected())) {
    return { ok: false, reason: 'HTML 里的常量段与 utils/spec.js 不一致' };
  }
  return { ok: true };
}

function sync() {
  const src = fs.readFileSync(HTML, 'utf8');
  const a = src.indexOf(MARK_START), b = src.indexOf(MARK_END);
  if (a < 0 || b < 0 || b < a) {
    console.error('HTML 里找不到 SPEC 生成标记段，没法生成');
    process.exit(1);
  }
  const eol = src.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  const block = expected().replace(/\n/g, eol);
  const out = src.slice(0, a) + block + src.slice(b + MARK_END.length);
  const changed = out !== src;
  if (changed) fs.writeFileSync(HTML, out, 'utf8');
  return changed;
}

module.exports = { render, check, sync, expected, MARK_START, MARK_END, HTML };

if (require.main === module) {
  const changed = sync();
  console.log(changed
    ? '已按 utils/spec.js 更新 教学考勤记账本.html 的口径常量'
    : '口径常量已是最新，无需改动');
}
