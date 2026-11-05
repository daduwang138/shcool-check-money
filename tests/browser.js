/* 浏览器冒烟的公共设施：找浏览器、跑一次 headless、从 <title> 取回断言结果。
   file:// 的 localStorage 会留在 profile 里，所以每次都开全新的临时目录，
   两次冒烟之间不会互相污染（复用 profile 曾导致第二次跑直接读到上次的账）。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

function findBrowser() {
  if (process.env.BROWSER && fs.existsSync(process.env.BROWSER)) return process.env.BROWSER;
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ];
  return candidates.filter(p => fs.existsSync(p))[0] || '';
}

/* 找不到浏览器不算测试失败，只是这一层没跑到（跑 run-all 时会明确标 SKIP）。 */
function supported() { return !!findBrowser(); }

function runHeadless(file, budget) {
  const exe = findBrowser();
  if (!exe) return null;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kqzb-smoke-'));
  const args = ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-extensions', '--allow-file-access-from-files',
    '--user-data-dir=' + profile,
    '--virtual-time-budget=' + (budget || 20000),
    '--dump-dom', 'file:///' + file.replace(/\\/g, '/')];
  let dom = '';
  try {
    dom = cp.execFileSync(exe, args, { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
  } catch (e) {
    /* headless 有时因为临时 profile 的退出码非 0 抛错，但 DOM 已经吐出来了 */
    dom = (e.stdout || '').toString();
  }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 不管清理失败 */ }
  return dom;
}

/* 探针把每条结果写进 document.title，用 ~~ 分隔 */
function titleLines(dom) {
  const m = (dom || '').match(/<title>([\s\S]*?)<\/title>/);
  return m ? m[1].split(' ~~ ') : [];
}

function report(label, lines) {
  lines.forEach(l => console.log('  ' + l));
  const bad = lines.filter(l => !l.startsWith('PASS'));
  console.log(label + '：共 ' + lines.length + ' 条，失败 ' + bad.length + ' 条');
  return bad.length;
}

module.exports = { findBrowser, supported, runHeadless, titleLines, report };
