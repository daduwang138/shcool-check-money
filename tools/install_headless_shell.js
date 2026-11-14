/* 一键安装 Chrome for Testing 的独立 headless shell（Windows 专用）。
   用法：node tools/install_headless_shell.js

   为什么需要它：本机 Chrome / Edge 157 的新版 --headless 会创建隐藏平台窗口，
   在受限会话里启动即退出（--dump-dom / --screenshot 全 0 字节、CDP 无响应）。
   chrome-headless-shell 是旧实现的独立二进制，不创建窗口，能正常吐出 DOM，
   两层浏览器冒烟靠它才跑得起来。

   产物放在 %LOCALAPPDATA%\kqzb-headless\，不进仓库；装一次即可，
   tests/browser.js 会自动发现它。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

if (process.platform !== 'win32') {
  console.error('这个脚本只用于 Windows；其他平台请装 chromium 后设 BROWSER=路径');
  process.exit(1);
}

const BASE = path.join(process.env.LOCALAPPDATA || os.homedir(), 'kqzb-headless');
const EXE = path.join(BASE, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
const META_URL = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';

function ps(cmd, timeout) {
  return cp.execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: timeout || 420000 }).trim();
}

/* 已装好且能出 DOM 就别重复下载 126 MB */
function usable() {
  if (!fs.existsSync(EXE)) return false;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kqzb-hs-check-'));
  const page = path.join(dir, 'p.html');
  fs.writeFileSync(page, '<!doctype html><title>__headless_ok__</title>', 'utf8');
  let out = '';
  try {
    out = cp.execFileSync(EXE, ['--no-sandbox', '--disable-gpu', '--dump-dom',
      'file:///' + page.replace(/\\/g, '/')], { encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 20000 });
  } catch (e) { out = (e.stdout || '').toString(); }
  return out.indexOf('__headless_ok__') >= 0;
}

if (usable()) {
  console.log('已安装且可用：' + EXE);
  process.exit(0);
}

let version;
try {
  version = ps("(Invoke-RestMethod -Uri '" + META_URL + "' -TimeoutSec 30).channels.Stable.version");
} catch (e) {
  console.error('取 Chrome for Testing 版本号失败：' + e.message);
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+\.\d+$/.test(version)) {
  console.error('版本号看起来不对：' + version);
  process.exit(1);
}

const url = 'https://storage.googleapis.com/chrome-for-testing-public/' + version
  + '/win64/chrome-headless-shell-win64.zip';
console.log('下载 Chrome for Testing ' + version + ' headless shell（约 120 MB）…');
console.log('  ' + url);

try {
  /* 用 PowerShell 的 .NET 下载：curl.exe 会被本机失效的本地代理变量拦住。 */
  ps([
    "$ErrorActionPreference='Stop'",
    "$zip=Join-Path $env:TEMP 'kqzb-headless-shell.zip'",
    "New-Item -ItemType Directory -Force -Path '" + BASE + "' | Out-Null",
    "Invoke-WebRequest -Uri '" + url + "' -OutFile $zip -UseBasicParsing -TimeoutSec 300",
    "Expand-Archive -LiteralPath $zip -DestinationPath '" + BASE + "' -Force"
  ].join('; '));
} catch (e) {
  console.error('下载或解压失败：' + e.message);
  process.exit(1);
}

if (!usable()) {
  console.error('装完了但自检没通过：' + EXE);
  console.error('跑 node tools/probe_browser.js 看详细结果');
  process.exit(1);
}
console.log('装好了：' + EXE);
console.log('现在跑 node tests/run-all.js，两层浏览器冒烟应该显示 PASS 而不是 SKIP。');
