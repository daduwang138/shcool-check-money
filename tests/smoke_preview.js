/* 小程序单文件预览的浏览器冒烟：先让 tools/smoke.js 注入探针，再用 headless 跑一遍。
   以前这一步是手工拼命令，容易漏跑；现在和别的冒烟一样入库、进 run-all。 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const browser = require('./browser.js');

const ROOT = path.resolve(__dirname, '..');
if (!browser.supported()) {
  console.log('SKIP 小程序预览冒烟：没找到 Edge/Chrome，可设 BROWSER 环境变量指定');
  process.exit(0);
}
cp.execFileSync(process.execPath, [path.join(ROOT, 'tools', 'smoke.js')],
  { cwd: ROOT, encoding: 'utf8' });
const file = path.join(ROOT, '.tmp', 'smoke.html');
if (!fs.existsSync(file)) { console.log('FAIL 小程序预览冒烟：没生成探针页面'); process.exit(1); }
const lines = browser.titleLines(browser.runHeadless(file, 12000));
if (!lines.length) { console.log('FAIL 小程序预览冒烟：没拿到 title'); process.exit(1); }
process.exit(browser.report('小程序预览冒烟', lines) ? 1 : 0);
