/* 结构自检：wxml 标签闭合、绑定的事件方法是否存在、wxss 花括号配平、用到的 class 是否有样式
   覆盖 teaching-attendance-mp/pages 下的全部页面 */
const fs = require('fs');
const path = require('path');
const PAGES = path.resolve(__dirname, '..', 'teaching-attendance-mp', 'pages');
const APP_WXSS = path.resolve(__dirname, '..', 'teaching-attendance-mp', 'app.wxss');

let bad = [];
const appWxss = fs.readFileSync(APP_WXSS, 'utf8');

function checkWxml(name, src) {
  const stack = [];
  const re = /<(\/?)([a-zA-Z-]+)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(src))) {
    const [, close, tag, attrs, self] = m;
    /* 微信编译陷阱：wx:if 和 wx:for 写在同一标签时 for 优先级更高，if 会失效，
       紧跟的 wx:else 报「wx:if not found」。预览编译器不校验这条，只有微信开发者工具报。
       只拦这一种确定的坏写法：同标签 wx:if+wx:for，且下一个开标签是 wx:else。
       合法写法是把 wx:if 提到 <block> 上、wx:for 留在内层 text。 */
    if (/\bwx:if\b/.test(attrs) && /\bwx:for\b/.test(attrs)) {
      const after = src.slice(m.index + m[0].length);
      /* 跳过可能的文本内容和闭合标签，找下一个开标签（wx:else 常规写法就紧跟其后） */
      const next = after.match(/^(?:[^<]*<\/[a-zA-Z-]+>)*[^<]*<([a-zA-Z-]+)([^>]*)>/);
      if (next && /\bwx:else\b|\bwx:elif\b/.test(next[2])) {
        bad.push(name + ' 的 wx:if 与 wx:for 同标签且紧跟 wx:else，微信会编译失败：<' + tag + '>');
      }
    }
    if (self || ['input', 'image', 'icon'].includes(tag)) continue;
    if (close) {
      const top = stack.pop();
      if (top !== tag) bad.push(name + ' 标签不匹配：</' + tag + '> 对上 <' + top + '>');
    } else {
      stack.push(tag);
    }
  }
  if (stack.length) bad.push(name + ' 未闭合标签：' + stack.join(','));
}

let hCount = 0, cCount = 0, rCount = 0, bCount = 0, dCount = 0;
fs.readdirSync(PAGES).forEach(function (dir) {
  const base = path.join(PAGES, dir, dir);
  if (!fs.existsSync(base + '.wxml')) { return; }
  const wxml = fs.readFileSync(base + '.wxml', 'utf8');
  const js = fs.readFileSync(base + '.js', 'utf8');
  const wxss = fs.readFileSync(base + '.wxss', 'utf8');

  checkWxml(dir, wxml);

  const handlers = new Set();
  wxml.replace(/bind(?:tap|change|input|touchstart|touchmove|touchend|touchcancel)="([^"]+)"/g, (_, h) => { handlers.add(h); });
  wxml.replace(/catch(?:tap|touchmove)="([^"]+)"/g, (_, h) => { handlers.add(h); });
  handlers.forEach(h => {
    if (!new RegExp('\\b' + h + '\\s*:\\s*function').test(js)) bad.push(dir + ' 缺方法：' + h);
  });
  hCount += handlers.size;

  const open = (wxss.match(/{/g) || []).length, close = (wxss.match(/}/g) || []).length;
  if (open !== close) bad.push(dir + ' wxss 花括号不配平：' + open + ' vs ' + close);
  rCount += open;

  const classes = new Set();
  wxml.replace(/class="([^"]+)"/g, (_, v) => {
    v.replace(/\{\{[^}]*\}\}/g, ' ')
      .split(/\s+/)
      .forEach(c => { if (/^[a-zA-Z][\w-]*$/.test(c)) classes.add(c); });
  });
  const missing = [...classes].filter(c => !wxss.includes('.' + c) && !appWxss.includes('.' + c));
  if (missing.length) bad.push(dir + ' 样式缺失：' + missing.join(', '));
  cCount += classes.size;

  /* 插值里的字面量 class（如 {{on ? 'dim' : ''}}）以前整段被抹成空格，等于没查。
     参数框灰掉、标签选中这类「状态样式」全靠它，漏了就是界面看上去没反应。 */
  const dynClasses = new Set();
  wxml.replace(/class="([^"]+)"/g, function (_, v) {
    /* 只取三元的结果分支：条件里 {{scope === 'both' ? 'on' : ''}} 的 'both'
       是比较值、不是 class，把它算进来会误报。'on' / '' 才是真正的类名。 */
    let tm;
    const ternRe = /\?\s*['"]([a-zA-Z][\w-]*)?['"]\s*:\s*['"]([a-zA-Z][\w-]*)?['"]/g;
    while ((tm = ternRe.exec(v))) {
      if (tm[1]) dynClasses.add(tm[1]);
      if (tm[2]) dynClasses.add(tm[2]);
    }
  });
  const dynMissing = [...dynClasses].filter(c => !wxss.includes('.' + c) && !appWxss.includes('.' + c));
  if (dynMissing.length) bad.push(dir + ' 动态 class 缺样式：' + dynMissing.join(', '));
  dCount += dynClasses.size;

  /* 绑定契约：见文件末尾 orphanBindings()。 */
  const binding = orphanBindings(wxml, js);
  binding.orphans.forEach(function (name) {
    bad.push(dir + ' wxml 绑定了「' + name + '」，但页面 js 找不到这个 data 字段 / setData 键');
  });
  bCount += binding.names.length;
});

/* 文案哨兵：这些说明曾经和代码对不上，钉住别再漂回去。
   填 0 是「学校不发这笔钱」的开关：没记过的日子不显示录入区，已记过的仍显示以便清零。 */
const HTML_SRC = path.resolve(__dirname, '..', '教学考勤记账本.html');
const htmlSrc = fs.readFileSync(HTML_SRC, 'utf8');
const mpSet = fs.readFileSync(path.join(PAGES, 'settings', 'settings.wxml'), 'utf8');
[['电脑版', htmlSrc], ['小程序版', mpSet]].forEach(function (p) {
  if (/次数照常可记|算 0 元/.test(p[1])) bad.push(p[0] + '设置页仍承诺「填 0 也能照常记」，但录入区实际会隐藏');
  if (p[1].indexOf('填 0 就') < 0) bad.push(p[0] + '设置页没写清「填 0 即关闭晚修录入」');
});
/* 工资影响范围哨兵：2026-11-20 起改基本工资会同步当月（自然月）及以后已记账月份，
   历史月份不动。两版设置页都要写清这个边界，否则用户以为改了谁都不变、或全都变。
   课时单价等其他价格仍不追溯，由汇总页冻结价说明钉住。 */
[['电脑版', htmlSrc], ['小程序版', mpSet]].forEach(function (p) {
  if (p[1].indexOf('当月（自然月）及以后') < 0) {
    bad.push(p[0] + '设置页没写清「改工资同步当月及以后、历史不动」');
  }
});
/* 教学周显示条件哨兵：年历右边的 W 列要先在设置里填开学那周的时间才显示，
   没填默认「—」。这句必须与代码一致，且两版都要有——否则用户会以为年历坏了。 */
[['电脑版', htmlSrc], ['小程序版', fs.readFileSync(path.join(PAGES, 'calendar', 'calendar.wxml'), 'utf8')]]
  .forEach(function (p) {
    if (p[1].indexOf('W1、W2') < 0 || p[1].indexOf('开学那周的时间') < 0) {
      bad.push(p[0] + '「怎么用」没写清年历教学周需先填开学那周的时间');
    }
  });
const mpSum = fs.readFileSync(path.join(PAGES, 'summary', 'summary.wxml'), 'utf8');
/* 年度四标签哨兵：名称、顺序、默认项两版必须一致，否则用户切来切去会对不上。
   应发·总览是默认标签，其余三个是它的构成下钻。 */
[['电脑版', htmlSrc], ['小程序版', mpSum]].forEach(function (p) {
  ['应发', '出勤', '课时', '晚修'].forEach(function (label) {
    if (p[1].indexOf(label) < 0) {
      bad.push(p[0] + '年度四标签缺少「' + label + '」');
    }
  });
});
/* 参数卡口径哨兵：两版输入框都是失焦保存，提示必须成对出现。
   曾只给小程序加了这句、电脑版漏了，用户改完以为没生效。 */
[['电脑版', htmlSrc], ['小程序版', mpSum]].forEach(function (p) {
  if (p[1].indexOf('别处才生效') < 0) {
    bad.push(p[0] + '参数卡没写「改完点一下别处才生效」');
  }
});
/* 到手估算哨兵：五险一金固定 616，个税算不出来必须写清误差。
   少一处说明，用户就会把估算到手当成精确工资。 */
[['电脑版', htmlSrc], ['小程序版', mpSum]].forEach(function (p) {
  if (p[1].indexOf('估算到手') < 0 || p[1].indexOf('五险一金（每月固定）') < 0) {
    bad.push(p[0] + '汇总页缺「五险一金固定扣除 / 估算到手」');
  }
  if (p[1].indexOf('误差') < 0 || p[1].indexOf('个税') < 0) {
    bad.push(p[0] + '汇总页没写清「个税无法计算、估算有误差」');
  }
});
const netCoreSrc = fs.readFileSync(path.join(PAGES, '..', 'utils', 'core.js'), 'utf8');
if (netCoreSrc.indexOf('NET_PAY.socialMonthly') < 0 || netCoreSrc.indexOf('NET_PAY.taxError') < 0) {
  bad.push('内核没从 spec.js 取五险一金 / 误差常量，三处文案会写歪');
}
if (netCoreSrc.indexOf("'五险一金', '估算到手'") < 0) {
  bad.push('CSV 月度汇总缺五险一金 / 估算到手列');
}
/* 五险一金必须能改：两版设置页都要有输入框，内核要读设置而不是写死常量 */
if (netCoreSrc.indexOf('db.settings.socialMonthly') < 0) {
  bad.push('内核没按设置里的 socialMonthly 扣五险一金');
}
const mpSettings = fs.readFileSync(path.join(PAGES, 'settings', 'settings.wxml'), 'utf8');
if (mpSettings.indexOf('setSocialMonthly') < 0 || htmlSrc.indexOf('id="setSocial"') < 0) {
  bad.push('设置页缺五险一金输入框（小程序 bindblur / 电脑版 id="setSocial"）');
}
/* 入口名称统一成「教学日历」；旧名「年历总览」不该再出现在用户可见按钮里 */
const mpCal = fs.readFileSync(path.join(PAGES, 'calendar', 'calendar.wxml'), 'utf8');
if (mpCal.indexOf('>教学日历<') < 0 || mpSettings.indexOf('>教学日历<') < 0
  || htmlSrc.indexOf('id="calYear" class="btn sm">教学日历<') < 0) {
  bad.push('教学日历入口没统一改名');
}
if (mpCal.indexOf('年历总览') >= 0 || mpSettings.indexOf('年历总览') >= 0
  || htmlSrc.indexOf('>年历总览<') >= 0) {
  bad.push('还有用户可见的「年历总览」旧名');
}
/* 口令锁未开启时不占设置页位置；开启过的仍要留关闭入口 */
if (mpSettings.indexOf('wx:if="{{lockOn}}"') < 0 || htmlSrc.indexOf('if(META.pass){') < 0) {
  bad.push('口令锁卡片没有按「已开启才显示」隐藏');
}

/* 两处都叫「基本工资」却显示不同数字，是用户反复困惑的根源。
   标签必须显式区分「默认值」与「本月取值」，差异解释也要两版都在。 */
[['电脑版', htmlSrc], ['小程序版', mpSet]].forEach(function (p) {
  if (p[1].indexOf('基本工资默认值') < 0) bad.push(p[0] + '设置页没把基本工资标成「默认值」');
});
[['电脑版', htmlSrc], ['小程序版', mpSum]].forEach(function (p) {
  if (p[1].indexOf('本月基本工资') < 0) bad.push(p[0] + '汇总页没把基本工资标成「本月取值」');
  if (p[1].indexOf('记账时冻结') < 0) bad.push(p[0] + '汇总页没解释冻结值与设置值的差异');
});
/* 口径常量唯一真源：spec.js 改了却没生成 HTML，这里要拦住。
   以前放假表 / 状态定义是两版各抄一份，加年份得改两处，还容易漏。 */
const syncSpec = require('../tools/sync_spec.js');
const specState = syncSpec.check(htmlSrc);
if (!specState.ok) {
  bad.push('双版口径常量不同步：' + specState.reason
    + '；改了 utils/spec.js 请跑 node tools/sync_spec.js');
}
/* 变异自检：故意把生成段改坏，check() 必须抓到，别让护栏变成摆设 */
if (syncSpec.check(htmlSrc.replace(/"cls": "s-work"/, '"cls": "s-WORK"')).ok) {
  bad.push('SPEC 同步自检·常量被改动却没抓到，护栏形同虚设');
}

/* 算法转发层护栏：HTML 里不该再有手写的算法实现，60 个函数都应是 core.js 的转发体。
   core.js 改了没跑生成器、或有人把转发体改回手写实现，这里都会拦住。 */
const genAdapter = require('../tools/gen_core_adapter.js');
const adapterState = genAdapter.check(htmlSrc);
if (!adapterState.ok) {
  bad.push('算法转发层不同步：' + adapterState.reason
    + '；改了 utils/core.js 请跑 node tools/gen_core_adapter.js --write');
}
if (genAdapter.check(htmlSrc.replace('return Core.pad(', 'return Core.PAD(')).ok) {
  bad.push('转发层同步自检·转发体被改坏却没抓到，护栏形同虚设');
}

/* dayBody 必须从 DAY_FIELDS 派生：手写字段清单一旦漏加新字段，
   导入合并会把「两边内容不同」误判成相同，静默吞掉一边的数据。 */
const storeSrc = fs.readFileSync(path.join(PAGES, '..', 'utils', 'store.js'), 'utf8');
if (storeSrc.indexOf('core.DAY_FIELDS.map') < 0) {
  bad.push('store.js 的 dayBody 没从 spec.js 的 DAY_FIELDS 派生');
}
/* 状态写入只能走无参 commit()：它提交的永远是共享对象，
   「调用方传旧副本整库盖掉别的页面」从结构上不可能发生。
   别退回 save(db) + 按时间戳补合并的补丁。 */
const pageSrcAll = fs.readdirSync(PAGES)
  .map(function (d) { return path.join(PAGES, d, d + '.js'); })
  .filter(function (p) { return fs.existsSync(p); })
  .map(function (p) { return fs.readFileSync(p, 'utf8'); }).join('\n');
if (/store\.save\(/.test(pageSrcAll)) {
  bad.push('页面里还在用 store.save(db)；写操作统一走不接受外部 db 的 store.commit()');
}
if (!/function commit\(\)\s*\{/.test(storeSrc) || storeSrc.indexOf('module.exports') < 0) {
  bad.push('store.js 缺无参 commit() 写入口');
}
if (storeSrc.indexOf('function _mergeNewer(') >= 0) {
  bad.push('store.js 又退回按时间戳补合并的 _mergeNewer 补丁');
}

/* 完全空的 catch 会静默吞掉异常，连「为什么可以忽略」都不写，以后排查就是黑洞。
   至少补一句原因注释。 */
const mpJs = [];
['utils'].forEach(function (d) {
  const dir = path.join(PAGES, '..', d);
  fs.readdirSync(dir).filter(function (f) { return /\.js$/.test(f); })
    .forEach(function (f) { mpJs.push(path.join(dir, f)); });
});
fs.readdirSync(PAGES).forEach(function (d) {
  const p = path.join(PAGES, d, d + '.js');
  if (fs.existsSync(p)) mpJs.push(p);
});
const emptyCatch = mpJs.filter(function (p) {
  return /catch\s*\([^)]*\)\s*\{\s*\}/.test(fs.readFileSync(p, 'utf8'));
});
if (emptyCatch.length) {
  bad.push('存在完全空的 catch（没写忽略原因）：'
    + emptyCatch.map(function (p) { return path.basename(p); }).join(', '));
}

/* Clean Code 棘轮（2026-11-14 基线）：单文件 UI 层的超长拼接行、内核的单字母变量
   是「解压即用、零依赖」约束下的历史取舍，不强行重构；但只准变好、不准变坏。
   改善了就同步下调基线，别让它们继续扩散。 */
const uiLines = fs.readFileSync(HTML_SRC, 'utf8').replace(/\r\n/g, '\n').split('\n');
const longCnt = uiLines.filter(function (l) { return l.length > 200; }).length;
if (longCnt > 21) {
  bad.push('电脑版超过 200 字符的行涨到 ' + longCnt + '（基线 21）；长 HTML 片段请用数组 join');
}
const coreAll = fs.readFileSync(path.join(PAGES, '..', 'utils', 'core.js'), 'utf8');
const shortVarCnt = (coreAll.match(/\bvar [a-z]\b/g) || []).length;
if (shortVarCnt > 96) {
  bad.push('core.js 单字母变量涨到 ' + shortVarCnt + '（基线 96）；新变量请自解释命名');
}

/* spec.js 会被 JSON.stringify 序列化进电脑版，只能放纯数据。
   函数 / undefined 会变成 null 或丢键，两版行为静默分叉；
   SPEC 护栏比的是「同一份序列化结果」，自己发现不了 —— 必须单独拦。 */
const specObj = require(path.join(PAGES, '..', 'utils', 'spec.js'));
function hasFn(v) {
  if (typeof v === 'function') return true;
  if (Array.isArray(v)) return v.some(hasFn);
  if (v && typeof v === 'object') return Object.keys(v).some(function (k) { return hasFn(v[k]); });
  return false;
}
/* 变异自检：嵌套在函数数组/对象里的函数也要抓到，别让护栏变成摆设 */
if (!hasFn([{ nested: [function () {}] }]) || !hasFn({ a: { b: function () {} } })) {
  bad.push('spec 纯数据自检·嵌套函数没被抓到，护栏形同虚设');
}
const lossy = Object.keys(specObj).filter(function (k) {
  return hasFn(specObj[k]) || specObj[k] === undefined;
});
if (lossy.length) {
  bad.push('spec.js 含不能无损序列化的导出：' + lossy.join(', ')
    + '（函数请放 core.js，由 gen_core_adapter.js 打包）');
}

/* 两个生成工具都从 Object.keys(spec) 自动派生，不再有需要手工同步的清单。
   产物侧的覆盖交给 verify_core.js 的「生成链」断言（检查的是生成结果，更可靠）。
   这里只钉住「别退回硬编码列表」。 */
const syncSrc = fs.readFileSync(path.join(__dirname, '..', 'tools', 'sync_spec.js'), 'utf8');
const genSrc = fs.readFileSync(path.join(__dirname, '..', 'tools', 'gen_core_adapter.js'), 'utf8');
if (syncSrc.indexOf('Object.keys(spec)') < 0) {
  bad.push('sync_spec.js 退回硬编码导出列表了，加 spec 导出又要改两处');
}
if (genSrc.indexOf('Object.keys(require(SPEC))') < 0) {
  bad.push('gen_core_adapter.js 退回硬编码 IIFE 参数了');
}
if (htmlSrc.indexOf('法定工作日内置 2026 年（') >= 0) bad.push('电脑版说明卡写死只内置 2026 年，新增年份会漏');
const ruleLine = (htmlSrc.match(/<p class="muted">计算规则：[^\n]*<\/p>/) || [''])[0];
if (!/④/.test(ruleLine)) bad.push('电脑版说明卡的应发公式漏了 ④ 晚修监考费');

/* 自动落账口径哨兵：开关说明必须与 autoFillLessons() 一致——
   默认开、未来不预填、已核对不动、10 秒可撤销、撤销后本月不再自动填。 */
function near(src, marker, back, fwd) {
  const i = src.indexOf(marker);
  return i < 0 ? '' : src.slice(Math.max(0, i - back), i + fwd);
}
[['电脑版', near(htmlSrc, 'data-k="autoLessons"', 500, 100)],
 ['小程序版', near(mpSet, 'data-key="autoLessons"', 500, 100)]].forEach(function (p) {
  const t = p[1];
  if (!t) { bad.push(p[0] + '设置页缺「按课程表自动记课时」开关'); return; }
  if (!/未来.{0,8}不预填/.test(t)) bad.push(p[0] + '自动落账说明没写「未来不预填」');
  if (!/已核对/.test(t)) bad.push(p[0] + '自动落账说明没写「已核对的月份不动」');
  if (!/10 秒/.test(t)) bad.push(p[0] + '自动落账说明没写「10 秒可撤销」');
  if (!/不再自动填/.test(t)) bad.push(p[0] + '自动落账说明没写「撤销后本月不再自动填」');
});

/* 名称哨兵：账号/备案名是「考勤记账本-个人版」，两版用户可见的名称必须一致。
   磁盘文件名「教学考勤记账本.html」只是本地路径、不进微信包，特意保留，别当残留误报。 */
const APP_NAME = '考勤记账本-个人版';
const OLD_NAME = '教学考勤记账本';
const MP_ROOT = path.resolve(__dirname, '..', 'teaching-attendance-mp');
[['app.json', /"navigationBarTitleText":\s*"([^"]+)"/],
 ['app.js', /appName:\s*'([^']+)'/],
 ['project.config.json', /"description":\s*"([^"]+)"/]].forEach(function (f) {
  const m = fs.readFileSync(path.join(MP_ROOT, f[0]), 'utf8').match(f[1]);
  if (!m || m[1].indexOf(APP_NAME) !== 0) bad.push('小程序 ' + f[0] + ' 的名称不是「' + APP_NAME + '」');
});
const SHARE_PAGES = ['calendar', 'summary', 'settings', 'courses', 'year', 'holiday'];
SHARE_PAGES.forEach(function (pg) {
  const src = fs.readFileSync(path.join(PAGES, pg, pg + '.js'), 'utf8');
  if (src.indexOf("title: '" + APP_NAME) < 0) bad.push('页面 ' + pg + ' 的转发标题没用新名称');
});
if (fs.readFileSync(path.join(PAGES, 'lock', 'lock.wxml'), 'utf8').indexOf(APP_NAME) < 0) bad.push('口令锁页标题没用新名称');
if (htmlSrc.indexOf('<title>' + APP_NAME + '</title>') < 0) bad.push('电脑版 <title> 没用新名称');
[path.join(MP_ROOT, 'app.json'), path.join(MP_ROOT, 'app.js'),
 path.join(MP_ROOT, 'project.config.json'), path.join(PAGES, 'lock', 'lock.wxml'),
 path.resolve(__dirname, '..', 'README.md'), path.resolve(__dirname, '..', '功能逻辑.md'), HTML_SRC]
  .concat(SHARE_PAGES.map(function (pg) { return path.join(PAGES, pg, pg + '.js'); }))
  .forEach(function (p) {
    const src = fs.readFileSync(p, 'utf8');
    if (src.split(OLD_NAME + '.html').join('').indexOf(OLD_NAME) >= 0) {
      bad.push(path.basename(p) + ' 里还有旧名称「' + OLD_NAME + '」（文件名引用除外）');
    }
  });

/* 口令不能退回 window.prompt：明文可见、输入法还会记词 */
if (/\bprompt\s*\(/.test(htmlSrc)) bad.push('电脑版还在用 window.prompt 收口令，必须走 password 输入框');
if (htmlSrc.indexOf('function askPass(') < 0) bad.push('电脑版缺少自绘的口令输入框 askPass()');

/* 绑定契约：wxml 的 {{}} 里每个顶层字段，页面 js 必须真的写过。
   桩测试只跑 js 的 setData、不渲染 wxml；旧的静态检查又只查「方法/class 存在」。
   于是「data 算对了、界面绑了个没人写的字段」「条件渲染字段没在 render 里写回」
   这两类问题从来没人拦，只能靠肉眼撞见。函数声明会提升，放末尾也能被上面的循环调用。 */
function orphanBindings(wxml, js) {
  const loopVars = new Set(['item', 'index']);
  wxml.replace(/wx:for-item="([^"]+)"/g, (_, v) => { loopVars.add(v); });
  wxml.replace(/wx:for-index="([^"]+)"/g, (_, v) => { loopVars.add(v); });
  const BUILTINS = new Set(['true', 'false', 'null', 'undefined', 'Math', 'String', 'Number', 'parseInt', 'parseFloat']);
  const bound = new Set();
  let em;
  const exprRe = /\{\{([\s\S]*?)\}\}/g;
  while ((em = exprRe.exec(wxml))) {
    const expr = em[1].replace(/'[^']*'|"[^"]*"/g, ' ');
    let im;
    const idRe = /(\.)?\b([A-Za-z_$][\w$]*)\b/g;
    while ((im = idRe.exec(expr))) {
      if (im[1] || loopVars.has(im[2]) || BUILTINS.has(im[2])) continue;
      bound.add(im[2]);
    }
  }
  const names = [...bound];
  const orphans = names.filter(function (name) {
    return !new RegExp('(^|[^\\w.$])' + name + '\\s*:', 'm').test(js);
  });
  return { names: names, orphans: orphans };
}

/* 变异自检：这层检查本身必须有效，别写成永远通过的摆设。
   故意给一段「wxml 用了 enableBase、js 却没写回」的代码，看它抓不抓得到。 */
const mutWxml = '<view wx:if="{{!enableBase}}">{{total}}</view>';
const mutJsOk = 'Page({ data: { total: 0 }, render: function(){ this.setData({ total: 1, enableBase: true }); } });';
const mutJsBad = 'Page({ data: { total: 0 }, render: function(){ this.setData({ total: 1 }); } });';
if (orphanBindings(mutWxml, mutJsOk).orphans.length) bad.push('绑定契约自检·正常页面被误报');
if (orphanBindings(mutWxml, mutJsBad).orphans.indexOf('enableBase') < 0) {
  bad.push('绑定契约自检·漏写的字段没被抓到，这层检查形同虚设');
}

/* 版本号只有 app.js 一处是真源：发布流程.md 里必须写同一个号，
   否则上传时照着文档填了旧号，后台会当成「版本没变」而拒收。 */
{
  const appJs = fs.readFileSync(path.resolve(__dirname, '..', 'teaching-attendance-mp', 'app.js'), 'utf8');
  const vm = /version:\s*'([^']+)'/.exec(appJs);
  const ver = vm ? vm[1] : '';
  const releaseMd = fs.readFileSync(path.resolve(__dirname, '..', '发布流程.md'), 'utf8');
  if (!ver) {
    bad.push('app.js 里读不到 globalData.version');
  } else if (releaseMd.indexOf(ver) < 0) {
    bad.push('发布流程.md 没写当前版本号 ' + ver + '；上传前请把版本号同步过去');
  }
}

/* 预览产物是入库的交付物：改了小程序源码忘了重建，产物就会落后，
   而「连构哈希一致」只证明两次构建一样，证明不了它跟当前源码一致。 */
try {
  const bp = require('../tools/build_preview.js');
  const onDisk = fs.readFileSync(bp.OUT, 'utf8').replace(/\r\n/g, '\n');
  if (onDisk !== bp.build()) {
    bad.push('preview/mp-preview.html 落后于小程序源码；请跑 node tools/build_preview.js 重建后再提交');
  }
} catch (e) {
  bad.push('预览产物自检失败：' + e.message);
}

if (bad.length) { console.log('FAIL\n' + bad.join('\n')); process.exit(1); }
console.log('结构自检通过：' + hCount + ' 个事件方法、' + cCount + ' 个 class、wxss ' + rCount + ' 条规则、'
  + bCount + ' 个绑定字段、' + dCount + ' 个动态 class');
