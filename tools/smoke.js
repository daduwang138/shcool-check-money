/* 冒烟测试：在预览页里模拟真实点击与滑动，验证交互链路。
   用法：node tools/smoke.js */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = path.join(ROOT, 'preview', 'mp-preview.html');
let html = fs.readFileSync(src, 'utf8');

const probe = `
<script>
(async function () {
  var log = [];
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var q = function (s) { return document.querySelector(s); };
  var qa = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  function ok(name, cond, extra) { log.push((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '(' + extra + ')' : '')); }
  function mid(el) {
    var r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }
  function mouse(type, el, pt) {
    /* mousedown 要落在格子上才能冒泡到容器；move/up 直接发给 window，
       否则元素被重绘替换后事件就冒不出来了 */
    var target = type === 'mousedown' ? el : window;
    target.dispatchEvent(new MouseEvent(type, { clientX: pt.x, clientY: pt.y, bubbles: true, cancelable: true }));
  }
  async function tapCell(key) {
    var el = q('.cell[data-mp-ds-key="' + key + '"]');
    if (!el) { return false; }
    var p = mid(el);
    mouse('mousedown', el, p);
    await sleep(40);
    mouse('mouseup', el, p);
    await sleep(180);
    return true;
  }
  async function drag(fromKey, toKey) {
    var a = q('.cell[data-mp-ds-key="' + fromKey + '"]');
    var b = q('.cell[data-mp-ds-key="' + toKey + '"]');
    if (!a || !b) { return false; }
    var pa = mid(a), pb = mid(b);
    mouse('mousedown', a, pa);
    await sleep(50);
    /* 分两步移动，模拟真实滑动的中间帧 */
    mouse('mousemove', a, { x: Math.round((pa.x + pb.x) / 2), y: pa.y });
    await sleep(60);
    mouse('mousemove', a, pb);
    await sleep(80);
    mouse('mouseup', a, pb);
    await sleep(220);
    return true;
  }
  function selCount() {
    var t = q('.sb-cnt');
    if (!t) { return -1; }
    var m = /(\\d+)/.exec(t.textContent);
    return m ? parseInt(m[1], 10) : 0;
  }

  try {
    await sleep(700);

    /* 1. 点日期 → 打开编辑面板 */
    ok('日历渲染', !!q('[data-mp-ds-key="2026-11-10"]'));
    await tapCell('2026-11-10');
    ok('点日期开面板', !!q('.sheet'), q('.sheet-title') ? q('.sheet-title').textContent : '');

    /* 1.1 面板里直接翻天：连续补记不用关掉重开 */
    var navNext = q('.sheet-nav .btn[data-mp-ds-d="1"]');
    ok('面板里有「后一天」', !!navNext);
    if (navNext) {
      navNext.click();
      await sleep(280);
      ok('翻天后面板不关', !!q('.sheet'));
      ok('翻到 11 月 11 日', !!q('.sheet-title') && q('.sheet-title').textContent.indexOf('11 日') > -1,
        q('.sheet-title') ? q('.sheet-title').textContent : 'NONE');
      var navPrev = q('.sheet-nav .btn[data-mp-ds-d="-1"]');
      if (navPrev) { navPrev.click(); await sleep(280); }
      ok('再翻回来仍是 11 月 10 日', !!q('.sheet-title') && q('.sheet-title').textContent.indexOf('10 日') > -1,
        q('.sheet-title') ? q('.sheet-title').textContent : 'NONE');
    }

    /* 2. 设为上班 + 加两节课时 */
    q('.sheet .seg[data-mp-ds-v="work"]').click();
    await sleep(120);
    q('.sheet .step[data-mp-ds-d="1"]').click();
    await sleep(100);
    q('.sheet .step[data-mp-ds-d="1"]').click();
    await sleep(120);
    ok('课时步进到 2', q('.sheet .step-val').textContent.trim() === '2', q('.sheet .step-val').textContent);
    q('.sheet .sheet-actions .btn.primary').click();
    await sleep(280);
    ok('完成后关闭面板', !q('.sheet'));
    var les = q('[data-mp-ds-key="2026-11-10"] .les');
    ok('格子上出现课时角标', !!les && les.textContent.indexOf('2') > -1, les ? les.textContent : 'NONE');
    ok('出现撤销条', !!q('.undo'));

    /* 3. 撤销 */
    if (q('.undo-act')) {
      q('.undo-act').click();
      await sleep(260);
      var les2 = q('[data-mp-ds-key="2026-11-10"] .les');
      ok('撤销后课时角标消失', !les2 || les2.textContent.indexOf('2') < 0, les2 ? les2.textContent : '');
    }

    /* 4. 不点任何按钮，直接在日历上横向拖动 → 自动进入选择并连选 */
    ok('拖动前没有选择条', !q('.selbar'));
    await drag('2026-11-09', '2026-11-12');
    ok('横向拖动自动进入选择', !!q('.selbar'));
    var n4 = selCount();
    ok('一行拖过 4 天', n4 === 4, '选中 ' + n4 + ' 天');
    ok('起点格有高亮', !!q('.cell.sel[data-mp-ds-key="2026-11-09"]'));
    ok('终点格有高亮', !!q('.cell.sel[data-mp-ds-key="2026-11-12"]'));

    /* 5. 继续点一格追加 → 再点一次取消 */
    await tapCell('2026-11-13');
    ok('点选追加一天', selCount() === 5, '共 ' + selCount() + ' 天');
    await tapCell('2026-11-13');
    ok('再点一次取消', selCount() === 4, '共 ' + selCount() + ' 天');

    /* 6. 底部操作条套用监考 */
    q('.sb-b[data-mp-ds-st="inv"]').click();
    await sleep(300);
    ok('套用后退出选择', !q('.selbar'));
    ok('11-10 变成监考', !!q('.cell[data-mp-ds-key="2026-11-10"] .half.s-inv'));

    /* 7. 第二次滑动：从已选状态起手 → 整段取消 */
    await drag('2026-11-16', '2026-11-18');
    ok('再次滑动进入选择', !!q('.selbar'), '选中 ' + selCount() + ' 天');
    q('.sb-x').click();
    await sleep(200);
    ok('× 退出选择', !q('.selbar'));

    /* 8. 汇总页 */
    q('#mp-tab div[data-path="pages/summary/summary"]').click();
    await sleep(400);
    var amt = q('.hero .amt');
    ok('汇总页出金额', !!amt && amt.textContent !== '0.00', amt ? amt.textContent : '');
    ok('汇总页有计算过程', qa('.card').length >= 3, qa('.card').length + ' 卡片');

    /* 9. 设置页 */
    q('#mp-tab div[data-path="pages/settings/settings"]').click();
    await sleep(400);
    ok('设置页渲染', qa('.row').length > 6, qa('.row').length + ' 行');
    ok('开关渲染成组件', qa('.mp-switch').length >= 6, qa('.mp-switch').length + ' 个');
    ok('设置页有自动落账开关', qa('.row').some(function (r) { return /按课程表自动记课时/.test(r.textContent); }));

    /* 10. 课程表 */
    q('[data-mp-ev-tap="gotoCourses"]').click();
    await sleep(400);
    ok('进入课程表', qa('.course').length === 3, qa('.course').length + ' 门课');
    ok('显示返回按钮', getComputedStyle(q('.mp-nav-back')).visibility === 'visible');
    if (q('.course')) {
      q('.course').click();
      await sleep(250);
      ok('课程编辑面板', !!q('.sheet'));
    }

    /* 11. 年历总览 */
    q('#mp-tab div[data-path="pages/settings/settings"]').click();
    await sleep(350);
    q('[data-mp-ev-tap="gotoYear"]').click();
    await sleep(450);
    ok('进入年历', qa('.ymonth').length === 12, qa('.ymonth').length + ' 个月');
    ok('年历有周序号', qa('.ywk').length > 20, qa('.ywk').length + ' 行');
    ok('法定休假单独标出', qa('.ycl-hol').length > 0, qa('.ycl-hol').length + ' 天');
    ok('调休补班单独标出', qa('.ycl-mk').length > 0, qa('.ycl-mk').length + ' 天');

  } catch (e) {
    log.push('ERROR: ' + e.message + ' @ ' + (e.stack || '').split('\\n')[1]);
  }
  document.title = log.join(' ~~ ');
})();
<\/script>`;

html = html.replace('</body>', probe + '</body>');
fs.mkdirSync(path.join(ROOT, '.tmp'), { recursive: true });
fs.writeFileSync(path.join(ROOT, '.tmp', 'smoke.html'), html, 'utf8');
console.log('ok');
