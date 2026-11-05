/* 电脑版真实浏览器冒烟：从设置页填价、记账页点开一天、到汇总页看钱，全走真实 DOM。
   这些路径 test_pages.js 的桩测不到（桩只覆盖小程序），以前放在 .tmp 里被 .gitignore 吃掉，
   每轮换台机器就没了；现在入库，由 tests/run-all.js 统一调用。 */
const fs = require('fs');
const path = require('path');
const browser = require('./browser.js');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, '教学考勤记账本.html'), 'utf8');

const probe = [
  '<script>',
  '(async function(){',
  '  var log=[];',
  '  function ok(n,c,e){log.push((c?"PASS ":"FAIL ")+n+(e?"("+e+")":""));}',
  '  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms);});};',
  '  var q=function(s){return document.querySelector(s);};',
  '  var tab=function(v){q(".tab[data-view=\\""+v+"\\"]").click();};',
  '  function change(el,v){el.value=v;el.dispatchEvent(new Event("change",{bubbles:true}));}',
  '  function db(){try{return JSON.parse(localStorage.getItem("kqzb_data_v1")||"{}");}catch(e){return {};}}',
  '  try{',
  '    await sleep(700);',
  '    /* 1. 设置页：晚修两项默认值、可改价、可加档 */',
  '    tab("set"); await sleep(200);',
  '    var nh=q("#setNightHours"), nf=q("#setNightFee");',
  '    ok("设置页有晚修两项", !!nh && !!nf);',
  '    ok("默认 2 小时 10 元", nh && nh.value==="2" && nf && nf.value==="10", nh&&nf?nh.value+"/"+nf.value:"");',
  '    change(nf,"15"); await sleep(250);',
  '    ok("改金额落盘", (db().settings||{}).nightFee===15, String((db().settings||{}).nightFee));',
  '    q("#rateAdd").click(); await sleep(300);',
  '    var rn=q("#view-set .rate-name"), rp=q("#view-set .rate-price");',
  '    ok("能加一档", !!rn && !!rp);',
  '    if(rn&&rp){change(rn,"晚自习");await sleep(250);change(rp,"80");await sleep(250);}',
  '    ok("档位价落盘", JSON.stringify((db().settings||{}).rates||[]).indexOf("晚自习")>=0);',
  '    /* 2. 记账页：真实点开一天，记 1 次晚修（学校口径：一晚一场） */',
  '    tab("cal"); await sleep(250);',
  '    var cell=q("#cal .cell[data-d]:not(.blank):not(.pre)");',
  '    var key=cell&&cell.dataset.d;',
  '    ok("日历渲染出可点的格子", !!key, key||"");',
  '    cell.dispatchEvent(new MouseEvent("click",{bubbles:true})); await sleep(250);',
  '    ok("弹窗打开", q("#modal").classList.contains("show"));',
  '    ok("晚修区块显示", q("#mNightBox").style.display!=="none", q("#mNightBox").style.display);',
  '    ok("提示带一晚一次和新价", /一晚 1 次 · 2 小时 · 15 元/.test(q("#mNightHint").textContent), q("#mNightHint").textContent);',
  '    q("#mNightPlus").click();',
  '    ok("点一下记 1 次", q("#mNight").textContent==="1", q("#mNight").textContent);',
  '    q("#mNightPlus").click(); q("#mNightPlus").click(); q("#mNightPlus").click();',
  '    ok("连点也不会记成第 2 次", q("#mNight").textContent==="1", q("#mNight").textContent);',
  '    q("#mNightMinus").click();',
  '    ok("可以减回 0 次", q("#mNight").textContent==="0", q("#mNight").textContent);',
  '    q("#mNightPlus").click();',
  '    q("#mDone").click(); await sleep(400);',
  '    ok("晚修次数存进记录", (db().days&&db().days[key]||{}).night===1, JSON.stringify((db().days||{})[key]));',
  '    var tag=q("#cal .cell[data-d=\\""+key+"\\"] .nighttag");',
  '    ok("日历格子有晚修角标", !!tag && /晚修/.test(tag.textContent), tag&&tag.textContent);',
  '    /* 3. 汇总页：④、只读行、明细表晚修列、筛选开关 */',
  '    tab("sum"); await sleep(300);',
  '    var body=q("#view-sum").textContent;',
  '    ok("计算过程有 ④ 晚修监考费", body.indexOf("④ 晚修监考费")>=0);',
  '    ok("④ 按 1 次 15 元算", body.indexOf("1 次 × ¥15/次（每次 2 小时，共 2 小时）")>=0 && body.indexOf("15.00")>=0);',
  '    ok("参数卡有其他档位只读行", body.indexOf("其他档位")>=0 && body.indexOf("晚自习")>=0);',
  '    ok("参数卡有晚修只读行", body.indexOf("一晚 1 次 · 2 小时 · ¥15/次")>=0);',
  '    var heads=Array.prototype.slice.call(document.querySelectorAll("#view-sum .detail thead th")).map(function(x){return x.textContent;});',
  '    ok("明细表有晚修列", heads.indexOf("晚修")>=0, heads.join("/"));',
  '    var all=q("#view-sum .detail tbody").querySelectorAll("tr").length;',
  '    var so=q("#sumOnly");',
  '    ok("有筛选开关", !!so);',
  '    so.checked=true; so.dispatchEvent(new Event("change",{bubbles:true})); await sleep(250);',
  '    var few=q("#view-sum .detail tbody").querySelectorAll("tr").length;',
  '    ok("勾选后明细变少", few<all, all+" → "+few);',
  '    ok("勾了之后仍能改回来", !!q("#sumOnly") && q("#sumOnly").checked===true);',
  '    /* 4. 冻价：改了设置里的价，回看这个月仍按记账时的 15 元 */',
  '    tab("set"); await sleep(200);',
  '    change(q("#setNightFee"),"20"); await sleep(250);',
  '    tab("sum"); await sleep(300);',
  '    var body2=q("#view-sum").textContent;',
  '    ok("参数卡用当月冻结价，不跟新设置变", body2.indexOf("一晚 1 次 · 2 小时 · ¥15/次")>=0 && body2.indexOf("一晚 1 次 · 2 小时 · ¥20/次")<0);',
  '    ok("④ 仍按 15 元算", body2.indexOf("1 次 × ¥15/次（每次 2 小时，共 2 小时）")>=0 && body2.indexOf("15.00")>=0);',
  '  }catch(e){ log.push("ERROR: "+e.message+" @ "+(e.stack||"").split("\\n")[1]); }',
  '  document.title=log.join(" ~~ ");',
  '})();',
  '</' + 'script>'
].join('\n');

if (!browser.supported()) {
  console.log('SKIP 电脑版浏览器冒烟：没找到 Edge/Chrome，可设 BROWSER 环境变量指定');
  process.exit(0);
}

fs.mkdirSync(path.join(ROOT, '.tmp'), { recursive: true });
const out = path.join(ROOT, '.tmp', 'html-night-smoke.html');
fs.writeFileSync(out, src.replace('</body>', probe + '\n</body>'), 'utf8');
const lines = browser.titleLines(browser.runHeadless(out));
if (!lines.length) { console.log('FAIL 电脑版浏览器冒烟：没拿到 title'); process.exit(1); }
process.exit(browser.report('电脑版浏览器冒烟', lines) ? 1 : 0);
