/* 生成小程序头像（注册后台「设置 → 基本设置 → 小程序头像」要传的那张图）。
   用法：node tools/make-icon.js

   规格依据：
   - 官方建议 144×144 px 以上、PNG、≤2MB；这里额外出 512×512 供高分屏
   - 头像会被裁成圆形，所以所有元素都收在 512×512 的内切圆里（半径 256）
   - 官方「白色背景需有色边框」→ 直接用满版深色底，不踩这条
   - 清晰、与名称/简介一致、不含微信/腾讯标识、不含任何文字（避免小字糊掉）

   图形语义：日历本 + 六个状态格，颜色直接取自小程序月历的那一套
   （上班浅蓝 / 监考绿斜纹 / 加班橙点纹 / 请假砖红），审核员看图标和看截图能对上。 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const OUT_DIR = path.join(__dirname, '..', '发布材料');
const TMP = os.tmpdir();

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="SIZE" height="SIZE">
  <defs>
    <pattern id="stripe" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="10" height="10" fill="#C4E4D6"/>
      <rect width="3" height="10" fill="#0F6E56" opacity=".55"/>
    </pattern>
    <pattern id="dot" width="12" height="12" patternUnits="userSpaceOnUse">
      <rect width="12" height="12" fill="#F7D3A2"/>
      <circle cx="6" cy="6" r="2.2" fill="#A05A00" opacity=".55"/>
    </pattern>
  </defs>

  <!-- 满版品牌蓝：圆形裁切后四角被切掉，颜色依然连贯 -->
  <rect width="512" height="512" fill="#1B5E9B"/>

  <!-- 日历本 -->
  <rect x="88" y="104" width="336" height="328" rx="34" fill="#FFFFFF"/>
  <rect x="88" y="104" width="336" height="80" rx="34" fill="#E4EEF7"/>
  <rect x="88" y="150" width="336" height="34" fill="#E4EEF7"/>

  <!-- 装订环 -->
  <rect x="164" y="78" width="24" height="60" rx="12" fill="#F7FBFF" stroke="#C2D7EA" stroke-width="3"/>
  <rect x="324" y="78" width="24" height="60" rx="12" fill="#F7FBFF" stroke="#C2D7EA" stroke-width="3"/>

  <!-- 表头三小点，读成「一周的列」 -->
  <circle cx="160" cy="150" r="7" fill="#9FB9D1"/>
  <circle cx="256" cy="150" r="7" fill="#9FB9D1"/>
  <circle cx="352" cy="150" r="7" fill="#9FB9D1"/>

  <!-- 六个状态格：和月历里一模一样的四种填法 -->
  <g stroke-width="3">
    <rect x="120" y="208" width="80" height="80" rx="14" fill="#E4EEF7" stroke="#A7C3DC"/>
    <rect x="216" y="208" width="80" height="80" rx="14" fill="url(#stripe)" stroke="#0F6E56"/>
    <rect x="312" y="208" width="80" height="80" rx="14" fill="url(#dot)" stroke="#A05A00"/>
    <rect x="120" y="304" width="80" height="80" rx="14" fill="#E4EEF7" stroke="#A7C3DC"/>
    <rect x="216" y="304" width="80" height="80" rx="14" fill="#EFD5CE" stroke="#9B4A3C"/>
    <rect x="312" y="304" width="80" height="80" rx="14" fill="#E4EEF7" stroke="#A7C3DC"/>
  </g>
</svg>`;

function findEdge() {
  const list = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  ];
  for (const p of list) { if (fs.existsSync(p)) { return p; } }
  throw new Error('没找到 Edge / Chrome');
}

if (!fs.existsSync(OUT_DIR)) { fs.mkdirSync(OUT_DIR, { recursive: true }); }
const edge = findEdge();

/* 源文件：SVG 里不带尺寸，交给引用方决定 */
fs.writeFileSync(path.join(OUT_DIR, '小程序头像.svg'),
  SVG.replace(/width="SIZE" height="SIZE"/, 'width="512" height="512"'), 'utf8');

for (const size of [512, 144]) {
  const html = '<!doctype html><meta charset="utf-8"><style>' +
    'html,body{margin:0;padding:0;overflow:hidden;width:' + size + 'px;height:' + size + 'px}' +
    'svg{display:block}</style>' + SVG.replace(/SIZE/g, String(size));
  const page = path.join(TMP, 'kqzb-icon-' + size + '.html');
  const png = path.join(OUT_DIR, '小程序头像-' + size + '.png');
  fs.writeFileSync(page, html, 'utf8');
  const r = spawnSync(edge, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--window-size=' + size + ',' + size,
    '--virtual-time-budget=1200', '--screenshot=' + png,
    'file:///' + page.replace(/\\/g, '/')
  ], { stdio: 'ignore' });
  if (r.error || !fs.existsSync(png)) { throw new Error(size + 'px 渲染失败'); }
  const kb = fs.statSync(png).size / 1024;
  if (kb > 2048) { throw new Error(size + 'px 超过 2MB'); }
  console.log(png + '  ' + size + '×' + size + '  ' + kb.toFixed(1) + ' KB');
}
