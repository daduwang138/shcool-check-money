/* 一键跑全套验证：node tests/run-all.js
   六层：内核双版比对 → 页面逻辑 → 结构自检 → 连构哈希 → 小程序预览冒烟 → 电脑版冒烟。
   全部跑完再汇总，不会在第一个失败处停下让人只看到一条。 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const browser = require('./browser.js');

const ROOT = path.resolve(__dirname, '..');
const results = [];

function step(label, args, quiet, record) {
  const r = cp.spawnSync(process.execPath, args, {
    cwd: ROOT, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit'
  });
  const ok = r.status === 0;
  if (record !== false) results.push({ label, ok });
  if (!ok && quiet) { console.log((r.stdout || '') + (r.stderr || '')); }
  return ok;
}

console.log('=== 1/6 内核：HTML 与 core.js 并排比对 ===');
step('内核双版比对', ['tests/verify_core.js']);
console.log('=== 2/6 小程序页面逻辑（桩） ===');
step('页面逻辑', ['tests/test_pages.js']);
console.log('=== 3/6 小程序 wxml/wxss 结构自检 ===');
step('结构自检', ['tests/check_structure.js']);

console.log('=== 4/6 连构两次，产物必须逐字节一致 ===');
const preview = path.join(ROOT, 'preview', 'mp-preview.html');
const build = () => {
  if (!step('生成预览', ['tools/build_preview.js'], true, false)) return '';
  return crypto.createHash('sha256').update(fs.readFileSync(preview)).digest('hex');
};
const h1 = build(), h2 = build();
const same = !!h1 && h1 === h2;
console.log(same ? ('一致  ' + h1.slice(0, 8)) : ('不一致  ' + h1.slice(0, 8) + ' / ' + h2.slice(0, 8)));
results.push({ label: '连构哈希一致', ok: same });

console.log('=== 5/6 小程序预览浏览器冒烟 ===');
if (browser.supported()) {
  step('小程序预览冒烟', ['tests/smoke_preview.js']);
  console.log('=== 6/6 电脑版浏览器冒烟 ===');
  step('电脑版浏览器冒烟', ['tests/smoke_html.js']);
} else {
  console.log('SKIP 候选浏览器都没通过 headless 自检，两层浏览器冒烟都没跑；跑 node tools/probe_browser.js 定位，或设 BROWSER=路径 指定后再跑一次');
  results.push({ label: '小程序预览冒烟', ok: true, skipped: true });
  results.push({ label: '电脑版浏览器冒烟', ok: true, skipped: true });
}

const bad = results.filter(r => !r.ok);
const skipped = results.filter(r => r.skipped).length;
console.log('\n———— 汇总 ————');
results.forEach(r => console.log((r.skipped ? 'SKIP ' : (r.ok ? 'OK   ' : 'FAIL ')) + r.label));
if (bad.length) console.log('\n失败 ' + bad.length + ' 项');
else if (skipped) console.log('\n通过 ' + (results.length - skipped) + ' 项，跳过 ' + skipped + ' 项（浏览器层没跑到，需补跑）');
else console.log('\n全套通过');
process.exit(bad.length ? 1 : 0);
