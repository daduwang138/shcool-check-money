/* 浏览器自检诊断：node tools/probe_browser.js
   逐个列出候选浏览器「文件在不在 / headless 能不能出 DOM」，用来定位两层冒烟为什么 SKIP。
   在你自己的 PowerShell / 终端里跑这个，把输出贴回来即可，不需要理解参数细节。 */
const fs = require('fs');
const browser = require('../tests/browser.js');

console.log('=== 浏览器 headless 自检 ===');
console.log('BROWSER 环境变量：' + (process.env.BROWSER || '(未设置)'));
let found = 0, usable = 0;
browser.CANDIDATES.forEach(function (p) {
  const exists = fs.existsSync(p);
  const ok = exists ? browser.headlessUsable(p) : false;
  if (exists) { found++; }
  if (ok) { usable++; }
  console.log('  ' + (ok ? '[可用]   ' : (exists ? '[不可用] ' : '[不存在] ')) + p
    + (ok ? '' : (exists ? '  ← 文件在，但 --dump-dom 无输出' : '')));
});
console.log('找到 ' + found + ' 个浏览器，其中 ' + usable + ' 个 headless 可用');
console.log('当前选中：' + (browser.findBrowser() || '(无 → 两层冒烟会标 SKIP)'));
if (!usable) {
  console.log('');
  console.log('若在本机也全部不可用，常见原因是新版 headless 需要创建隐藏窗口、被会话策略挡住。');
  console.log('可选：装 chrome-headless-shell 后设 BROWSER=它的路径，或换台机器跑 run-all.js。');
}
