/* 浏览器冒烟的公共设施：找浏览器、跑一次 headless、从 <title> 取回断言结果。
   file:// 的 localStorage 会留在 profile 里，所以每次都开全新的临时目录，
   两次冒烟之间不会互相污染（复用 profile 曾导致第二次跑直接读到上次的账）。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

/* 候选浏览器：Chrome 优先、Edge 后备，并补上用户级安装与常见 Linux/macOS 路径。
   以前用 filter(exists)[0]，Edge 排在第一 —— 就算装了 Chrome 也永远轮不到它，
   用户终端那次 SKIP 其实是 Edge 的结果，Chrome 从没被真正测过。 */
const CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
];

/* 极简本地页自检：能不能真的吐出 DOM。「文件在」不等于「能跑」：
   某些会话里 headless 能打印 --version，但 --dump-dom / --screenshot 整体静默失效
   （0 字节、stderr 空）。过不了就诚实标 SKIP；过得了对真实页面拿不到 title 仍算真失败。 */
function headlessUsable(exe) {
  if (!exe || !fs.existsSync(exe)) return false;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kqzb-probe-'));
  const probe = path.join(profile, 'probe.html');
  fs.writeFileSync(probe, '<!doctype html><meta charset="utf-8"><title>__headless_ok__</title>', 'utf8');
  const args = ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-extensions', '--allow-file-access-from-files', '--user-data-dir=' + profile,
    '--virtual-time-budget=1500',
    '--dump-dom', 'file:///' + probe.replace(/\\/g, '/')];
  let dom = '';
  try {
    dom = cp.execFileSync(exe, args, { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 12000 });
  } catch (e) {
    dom = (e.stdout || '').toString();
  }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* 不管清理失败 */ }
  return (dom || '').indexOf('__headless_ok__') >= 0;
}

/* 逐个自检，选第一个真能跑 headless 的；都失败返回空串（run-all 标 SKIP）。
   显式 BROWSER=路径 时尊重用户指定，不再自检，方便自行排查。 */
let chosen;
function findBrowser() {
  if (process.env.BROWSER && fs.existsSync(process.env.BROWSER)) return process.env.BROWSER;
  if (chosen !== undefined) return chosen;
  for (let i = 0; i < CANDIDATES.length; i++) {
    const p = CANDIDATES[i];
    if (fs.existsSync(p) && headlessUsable(p)) { chosen = p; return p; }
  }
  chosen = '';
  return '';
}

function supported() { return !!findBrowser(); }

function runHeadless(file, budget) {
  const exe = findBrowser();          /* findBrowser 已内含自检 */
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

module.exports = { findBrowser, supported, runHeadless, titleLines, report, CANDIDATES, headlessUsable };
