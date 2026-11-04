/* 极简小程序运行时（仅覆盖本项目用到的子集）
   目的：在浏览器里跑真实的 wxml / wxss / page.js，用来预览使用效果。
   不追求和微信客户端 100% 等价，交互与排版力求一致。 */
(function (global) {
  'use strict';

  var VOID = { input: 1, switch: 1, image: 1, img: 1 };

  /* ---------------- 通用 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function clone(o) { return JSON.parse(JSON.stringify(o == null ? null : o)); }
  function truthy(v) { return !(v === false || v == null || v === '' || v === 0 || (typeof v === 'number' && isNaN(v))); }

  /* ---------------- WXML 解析 ---------------- */
  function findTagEnd(src, from) {
    var q = 0;
    for (var i = from; i < src.length; i++) {
      var c = src.charAt(i);
      if (q) { if (c === q) { q = 0; } }
      else if (c === '"' || c === "'") { q = c; }
      else if (c === '>') { return i; }
    }
    return src.length;
  }

  function parseAttrs(str) {
    var attrs = {};
    var re = /([a-zA-Z_:@][\w:.\-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'))?/g, m;
    while ((m = re.exec(str))) {
      if (!m[1] || m[1] === '/') { continue; }
      attrs[m[1]] = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : '');
    }
    return attrs;
  }

  var uidSeq = 0;
  function parseWXML(src) {
    var root = { type: 'el', tag: '#root', attrs: {}, children: [] };
    var stack = [root];
    var i = 0, n = src.length;

    function addText(t) {
      if (!t) { return; }
      stack[stack.length - 1].children.push({ type: 'text', text: t });
    }

    while (i < n) {
      var lt = src.indexOf('<', i);
      if (lt < 0) { addText(src.slice(i)); break; }
      if (lt > i) { addText(src.slice(i, lt)); }
      if (src.substr(lt, 4) === '<!--') {
        var ce = src.indexOf('-->', lt);
        i = ce < 0 ? n : ce + 3;
        continue;
      }
      var gt = findTagEnd(src, lt + 1);
      var raw = src.slice(lt + 1, gt);
      var selfClose = raw.charAt(raw.length - 1) === '/';
      if (selfClose) { raw = raw.slice(0, -1); }

      if (raw.charAt(0) === '/') {
        var close = raw.slice(1).trim();
        for (var s = stack.length - 1; s > 0; s--) {
          if (stack[s].tag === close) { stack.length = s; break; }
        }
      } else {
        var mm = /^([a-zA-Z0-9_\-]+)/.exec(raw);
        var tag = mm ? mm[1] : 'view';
        var node = { type: 'el', tag: tag, uid: ++uidSeq, attrs: parseAttrs(raw.slice(tag.length)), children: [] };
        stack[stack.length - 1].children.push(node);
        if (!selfClose && !VOID[tag]) { stack.push(node); }
      }
      i = gt + 1;
    }
    return root;
  }

  /* ---------------- 表达式 ---------------- */
  var exprCache = {};
  function compile(code) {
    var f = exprCache[code];
    if (!f) {
      try {
        f = new Function('$d', 'with($d){return (' + code + ');}');
      } catch (e) {
        f = function () { return ''; };
      }
      exprCache[code] = f;
    }
    return f;
  }
  function evalRaw(code, data) {
    try { return compile(code)(data); } catch (e) { return ''; }
  }
  function evalWrap(expr, data) {
    var m = /^\s*\{\{([\s\S]*)\}\}\s*$/.exec(String(expr));
    return evalRaw(m ? m[1] : String(expr), data);
  }
  function interp(str, data) {
    return String(str).replace(/\{\{([\s\S]*?)\}\}/g, function (_, e) {
      var v = evalRaw(e, data);
      return (v == null || v === false) ? '' : String(v);
    });
  }

  /* ---------------- 渲染 ---------------- */
  function dsAttrsAndBinds(node, data) {
    var a = node.attrs, out = '';
    for (var k in a) {
      if (k.indexOf('data-') === 0) {
        out += ' data-mp-ds-' + k.slice(5) + '="' + esc(interp(a[k], data)) + '"';
      }
    }
    for (var k2 in a) {
      var m = /^(bind|catch):?([a-zA-Z]+)$/.exec(k2);
      if (!m) { continue; }
      var ev = m[2] === 'tap' ? 'tap' : m[2];
      out += ' ' + (m[1] === 'catch' ? 'data-mp-cv-' : 'data-mp-ev-') + ev + '="' + esc(a[k2]) + '"';
    }
    return out;
  }

  function boxAttrs(node, data, extraCls) {
    var a = node.attrs;
    var cls = a.class ? interp(a.class, data).replace(/\s+/g, ' ').trim() : '';
    if (extraCls) { cls = (cls + ' ' + extraCls).trim(); }
    var s = '';
    if (cls) { s += ' class="' + esc(cls) + '"'; }
    if (a.style) { s += ' style="' + esc(interp(a.style, data)) + '"'; }
    return s + dsAttrsAndBinds(node, data);
  }

  function renderNodes(nodes, data) {
    var out = '';
    var kids = [];
    for (var i = 0; i < nodes.length; i++) {
      var nd = nodes[i];
      if (nd.type === 'text' && !nd.text.trim()) { continue; }
      kids.push(nd);
    }
    var lastIf = null;
    for (var j = 0; j < kids.length; j++) {
      var n2 = kids[j];
      if (n2.type === 'text') { out += esc(interp(n2.text, data)); lastIf = null; continue; }
      var a = n2.attrs, ok = true;
      if ('wx:if' in a) { ok = truthy(evalWrap(a['wx:if'], data)); lastIf = ok; }
      else if ('wx:elif' in a) { ok = !lastIf && truthy(evalWrap(a['wx:elif'], data)); if (ok) { lastIf = true; } }
      else if ('wx:else' in a) { ok = !lastIf; lastIf = true; }
      else { lastIf = null; }
      if (!ok) { continue; }

      if ('wx:for' in a) {
        var list = evalWrap(a['wx:for'], data);
        if (list == null) { list = []; }
        if (typeof list === 'number') {
          var arr = [];
          for (var z = 0; z < list; z++) { arr.push(z); }
          list = arr;
        }
        var ik = a['wx:for-item'] || 'item';
        var xk = a['wx:for-index'] || 'index';
        for (var q = 0; q < list.length; q++) {
          var sub = Object.create(data);
          sub[ik] = list[q];
          sub[xk] = q;
          out += renderOne(n2, sub);
        }
      } else {
        out += renderOne(n2, data);
      }
    }
    return out;
  }

  function renderOne(node, data) {
    var tag = node.tag;
    if (tag === 'block') { return renderNodes(node.children, data); }
    if (tag === 'text') {
      return '<span' + boxAttrs(node, data, 'mp-text') + '>' + renderNodes(node.children, data) + '</span>';
    }
    if (tag === 'input') { return renderInput(node, data); }
    if (tag === 'switch') { return renderSwitch(node, data); }
    if (tag === 'picker') { return renderPicker(node, data); }
    if (tag === 'button') {
      return '<button' + boxAttrs(node, data, 'mp-btn') + '>' + renderNodes(node.children, data) + '</button>';
    }
    return '<div' + boxAttrs(node, data, 'mp-view') + '>' + renderNodes(node.children, data) + '</div>';
  }

  function renderInput(node, data) {
    var a = node.attrs;
    var cls = a.class ? interp(a.class, data) : '';
    var s = '<input class="' + esc((cls + ' mp-input').trim()) + '"';
    s += ' data-mp-id="' + node.uid + '"';
    s += ' value="' + esc(a.value ? interp(a.value, data) : '') + '"';
    if (a.placeholder) { s += ' placeholder="' + esc(a.placeholder) + '"'; }
    if (a.maxlength) { s += ' maxlength="' + esc(a.maxlength) + '"'; }
    var t = a.type || 'text';
    if (t === 'number') { s += ' type="number" inputmode="numeric"'; }
    else if (t === 'digit') { s += ' type="text" inputmode="decimal"'; }
    else { s += ' type="text"'; }
    if (a.password) { s += ' type="password"'; }
    s += dsAttrsAndBinds(node, data);
    return s + ' />';
  }

  function renderSwitch(node, data) {
    var a = node.attrs;
    var on = truthy(evalWrap(a.checked || '', data));
    var color = a.color || '#1B5E9B';
    var cls = a.class ? interp(a.class, data) : '';
    return '<span class="mp-switch' + (on ? ' on' : '') + (cls ? ' ' + esc(cls) : '') + '"'
      + ' style="--sw-c:' + esc(color) + '" data-mp-comp="switch"' + dsAttrsAndBinds(node, data)
      + '><i></i></span>';
  }

  function renderPicker(node, data) {
    var a = node.attrs;
    var cls = a.class ? interp(a.class, data) : '';
    var inner = renderNodes(node.children, data);
    if (!inner) { inner = esc(a.value ? interp(a.value, data) : ''); }
    return '<span class="mp-picker' + (cls ? ' ' + esc(cls) : '') + '" data-mp-comp="picker"'
      + ' data-mp-mode="' + esc(a.mode || 'selector') + '"'
      + ' data-mp-fields="' + esc(a.fields || 'day') + '"'
      + ' data-mp-value="' + esc(a.value ? interp(a.value, data) : '') + '"'
      + dsAttrsAndBinds(node, data) + '>' + inner + '</span>';
  }

  /* ---------------- 事件 ---------------- */
  function datasetOf(el) {
    var ds = {}, d = el.dataset;
    for (var k in d) {
      if (k.indexOf('mpDs') === 0) {
        var n = k.slice(4);
        ds[n.charAt(0).toLowerCase() + n.slice(1)] = d[k];
      }
    }
    return ds;
  }

  function invoke(el, fnName, evt) {
    var page = current;
    var fn = page && page[fnName];
    if (typeof fn !== 'function') {
      console.warn('[preview] 页面没有方法：' + fnName);
      return;
    }
    try { fn.call(page, evt); } catch (e) { console.error('[preview] ' + fnName + ' 抛错', e); toast('运行出错：' + e.message); }
  }

  function fire(el, type, detail) {
    var fnName = el.getAttribute('data-mp-ev-' + type) || el.getAttribute('data-mp-cv-' + type);
    if (!fnName) { return false; }
    invoke(el, fnName, {
      type: type,
      detail: detail || {},
      currentTarget: { dataset: datasetOf(el), id: el.id || '' },
      target: { dataset: datasetOf(el), id: el.id || '' }
    });
    return true;
  }

  function fireTouch(el, type, x, y, targetEl) {
    var fnName = el.getAttribute('data-mp-cv-' + type) || el.getAttribute('data-mp-ev-' + type);
    if (!fnName) { return false; }
    var pt = { clientX: x, clientY: y, pageX: x, pageY: y, identifier: 0 };
    invoke(el, fnName, {
      type: type,
      currentTarget: { dataset: datasetOf(el) },
      target: { dataset: datasetOf(targetEl || el) },
      touches: type === 'touchend' ? [] : [pt],
      changedTouches: [pt]
    });
    return true;
  }

  /* 从起始元素向上找绑定了该事件的节点；DOM 被重绘过就按坐标兜底 */
  function walkTouch(startEl, type, x, y, targetEl) {
    var cur = document.contains(startEl) ? startEl : document.elementFromPoint(x, y);
    while (cur && cur.nodeType === 1 && cur !== bodyEl) {
      if (cur.hasAttribute('data-mp-ev-' + type) || cur.hasAttribute('data-mp-cv-' + type)) {
        fireTouch(cur, type, x, y, targetEl);
        return;
      }
      cur = cur.parentElement;
    }
  }

  function bubbleFind(el, attr) {
    var cur = el;
    while (cur && cur.nodeType === 1 && cur !== bodyEl) {
      if (cur.hasAttribute(attr)) { return cur; }
      cur = cur.parentElement;
    }
    return null;
  }

  /* ---------------- wx 桩 ---------------- */
  var STORE_KEY = 'kqzb_preview_storage';

  function readStore() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function writeStore(o) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(o)); } catch (e) { /* 忽略 */ }
  }

  var files = {};

  var wx = {
    env: { USER_DATA_PATH: '/tmp' },
    getStorageSync: function (k) {
      var all = readStore();
      return all[k] === undefined ? '' : all[k];
    },
    setStorageSync: function (k, v) {
      var all = readStore();
      all[k] = v;
      writeStore(all);
    },
    removeStorageSync: function (k) {
      var all = readStore();
      delete all[k];
      writeStore(all);
    },
    getDeviceInfo: function () { return { platform: 'windows', model: 'preview', system: 'Windows 11' }; },
    getSystemInfoSync: function () { return { platform: 'windows', windowWidth: 375, windowHeight: 674 }; },

    showToast: function (o) { toast(o && o.title || ''); },
    showModal: function (o) {
      modal({
        title: o.title || '', content: o.content || '',
        confirmText: o.confirmText || '确定', cancelText: o.cancelText || '取消',
        confirmColor: o.confirmColor, showCancel: o.showCancel !== false
      }, function (ok) {
        if (o.success) { o.success({ confirm: ok, cancel: !ok }); }
      });
    },
    showActionSheet: function (o) {
      sheetPick(o.itemList || [], o.alertText || '', function (i) {
        if (i < 0) { if (o.fail) { o.fail({ errMsg: 'cancel' }); } return; }
        if (o.success) { o.success({ tapIndex: i }); }
      });
    },
    setClipboardData: function (o) {
      var t = o.data || '';
      var done = function () { toast('已复制到剪贴板'); if (o.success) { o.success({}); } };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(done).catch(function () { fallbackCopy(t); done(); });
      } else { fallbackCopy(t); done(); }
    },
    navigateTo: function (o) {
      var p = String(o.url || '').replace(/^\//, '');
      var cfg = registry[p];
      if (!cfg) { toast('找不到页面 ' + p); return; }
      pushPage(p);
      if (o.success) { o.success({}); }
    },
    navigateBack: function () { popPage(); },
    getFileSystemManager: function () {
      return {
        writeFile: function (o) {
          try {
            files[o.filePath] = o.data;
            if (o.success) { o.success({}); }
          } catch (e) { if (o.fail) { o.fail(e); } }
        },
        readFileSync: function (p) {
          if (files[p] == null) { throw new Error('文件不存在'); }
          return files[p];
        }
      };
    },
    saveFileToDisk: function (o) {
      var text = files[o.filePath];
      if (text == null) { if (o.fail) { o.fail({ errMsg: '文件不存在' }); } return; }
      download(o.filePath.split('/').pop(), text);
      if (o.success) { o.success({}); }
    },
    shareFileMessage: function (o) {
      var text = files[o.filePath];
      download(o.fileName || 'export.json', text == null ? '' : text);
      if (o.success) { o.success({}); }
    },
    chooseMessageFile: function (o) {
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.onchange = function () {
        var f = inp.files && inp.files[0];
        if (!f) { if (o.fail) { o.fail({ errMsg: 'cancel' }); } return; }
        var rd = new FileReader();
        rd.onload = function () {
          files['/tmp/' + f.name] = String(rd.result);
          if (o.success) { o.success({ tempFiles: [{ path: '/tmp/' + f.name, name: f.name, size: f.size }] }); }
        };
        rd.readAsText(f, 'utf-8');
      };
      inp.click();
    }
  };

  function fallbackCopy(t) {
    var ta = document.createElement('textarea');
    ta.value = t;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* 忽略 */ }
    document.body.removeChild(ta);
  }

  function download(name, text) {
    var blob = new Blob([text], { type: 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  /* ---------------- 弹层：toast / modal / actionsheet ---------------- */
  var layer = null;
  function layerEl() {
    if (!layer) { layer = document.getElementById('mp-overlay'); }
    return layer;
  }

  var toastTimer = null;
  function toast(msg) {
    var box = layerEl();
    if (!box) { return; }
    var t = box.querySelector('.mp-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'mp-toast';
      box.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  function modal(opt, cb) {
    var box = layerEl();
    var wrap = document.createElement('div');
    wrap.className = 'mp-modal-mask';
    wrap.innerHTML =
      '<div class="mp-modal">' +
      '<div class="mp-modal-title">' + esc(opt.title) + '</div>' +
      '<div class="mp-modal-body">' + esc(opt.content) + '</div>' +
      '<div class="mp-modal-foot">' +
      (opt.showCancel ? '<div class="mp-modal-btn cancel">' + esc(opt.cancelText) + '</div>' : '') +
      '<div class="mp-modal-btn ok" style="color:' + esc(opt.confirmColor || '#1B5E9B') + '">' + esc(opt.confirmText) + '</div>' +
      '</div></div>';
    box.appendChild(wrap);
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('.mp-modal-btn');
      if (b) {
        wrap.remove();
        cb(b.classList.contains('ok'));
      } else if (e.target === wrap) {
        wrap.remove();
        cb(false);
      }
    });
  }

  function sheetPick(items, alertText, cb) {
    var box = layerEl();
    var wrap = document.createElement('div');
    wrap.className = 'mp-as-mask';
    var html = '<div class="mp-as">';
    if (alertText) { html += '<div class="mp-as-alert">' + esc(alertText) + '</div>'; }
    items.forEach(function (t, i) { html += '<div class="mp-as-item" data-i="' + i + '">' + esc(t) + '</div>'; });
    html += '<div class="mp-as-item mp-as-cancel">取消</div></div>';
    wrap.innerHTML = html;
    box.appendChild(wrap);
    wrap.addEventListener('click', function (e) {
      var it = e.target.closest('.mp-as-item');
      if (!it) { return; }
      wrap.remove();
      if (it.classList.contains('mp-as-cancel')) { cb(-1); return; }
      cb(parseInt(it.dataset.i, 10));
    });
  }

  /* ---------------- 日期选择器（自制，避免依赖浏览器原生控件） ---------------- */
  function openPicker(el) {
    var mode = el.getAttribute('data-mp-mode') || 'date';
    var fields = el.getAttribute('data-mp-fields') || 'day';
    var val = el.getAttribute('data-mp-value') || '';
    var now = new Date();
    var y = now.getFullYear(), m = now.getMonth();
    if (/^\d{4}-\d{2}/.test(val)) {
      y = parseInt(val.slice(0, 4), 10);
      m = parseInt(val.slice(5, 7), 10) - 1;
    }
    var box = layerEl();
    var wrap = document.createElement('div');
    wrap.className = 'mp-pk-mask';
    box.appendChild(wrap);

    function draw() {
      var first = new Date(y, m, 1).getDay();
      var days = new Date(y, m + 1, 0).getDate();
      var html = '<div class="mp-pk">'
        + '<div class="mp-pk-head">'
        + '<span class="mp-pk-nav" data-nav="-1">‹</span>'
        + '<span class="mp-pk-title">' + y + ' 年 ' + (m + 1) + ' 月</span>'
        + '<span class="mp-pk-nav" data-nav="1">›</span>'
        + '</div>'
        + (fields === 'month' ? '<div class="mp-pk-tip">点任意一天选中这个月</div>' : '')
        + '<div class="mp-pk-wd">' + ['日', '一', '二', '三', '四', '五', '六'].map(function (w) { return '<span>' + w + '</span>'; }).join('') + '</div>'
        + '<div class="mp-pk-grid">';
      for (var i = 0; i < first; i++) { html += '<span class="blank"></span>'; }
      for (var d = 1; d <= days; d++) {
        var key = y + '-' + pad2(m + 1) + '-' + pad2(d);
        html += '<span class="day' + (key === val ? ' on' : '') + '" data-k="' + key + '">' + d + '</span>';
      }
      html += '</div><div class="mp-pk-foot"><span class="mp-pk-cancel">取消</span></div></div>';
      wrap.innerHTML = html;
    }

    wrap.addEventListener('click', function (e) {
      var nav = e.target.closest('[data-nav]');
      if (nav) {
        m += parseInt(nav.dataset.nav, 10);
        if (m < 0) { m = 11; y--; }
        if (m > 11) { m = 0; y++; }
        draw();
        return;
      }
      var day = e.target.closest('.day');
      if (day) {
        var k = day.dataset.k;
        var out = fields === 'month' ? k.slice(0, 7) : k;
        wrap.remove();
        fire(el, 'change', { value: out });
        return;
      }
      if (e.target.classList.contains('mp-pk-cancel') || e.target === wrap) { wrap.remove(); }
    });
    draw();
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  /* ---------------- 页面管理 ---------------- */
  var registry = {};
  var current = null;
  var stack = [];
  var bodyEl = null;
  var navEl = null;
  var tabEl = null;
  var rendering = false;
  var renderQueued = false;

  function setPath(obj, path, val) {
    var parts = path.split('.');
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') { cur[parts[i]] = {}; }
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = val;
  }

  function makePage(path, cfg) {
    var page = { route: path, __path: path };
    Object.keys(cfg).forEach(function (k) {
      if (k === 'data') { return; }
      page[k] = cfg[k];
    });
    page.data = clone(cfg.data || {});
    page.setData = function (obj, cb) {
      Object.keys(obj || {}).forEach(function (k) {
        if (k.indexOf('.') > -1) { setPath(page.data, k, obj[k]); }
        else { page.data[k] = obj[k]; }
      });
      scheduleRender();
      if (cb) { setTimeout(cb, 0); }
    };
    return page;
  }

  var renderTimer = null;
  function scheduleRender() {
    if (renderTimer) { return; }
    /* 不用 requestAnimationFrame：在后台标签页 / 无头环境里它可能一直不执行 */
    renderTimer = setTimeout(function () {
      renderTimer = null;
      doRender();
    }, 0);
  }

  function captureFocus() {
    var a = document.activeElement;
    if (a && a.tagName === 'INPUT' && a.dataset.mpId) {
      return { id: a.dataset.mpId, s: a.selectionStart, e: a.selectionEnd };
    }
    return null;
  }
  function restoreFocus(f) {
    if (!f) { return; }
    var el = bodyEl.querySelector('input[data-mp-id="' + f.id + '"]');
    if (!el) { return; }
    el.focus();
    try { el.setSelectionRange(f.s, f.e); } catch (e) { /* 忽略 */ }
  }

  var renderTick = 0;
  function doRender() {
    if (!current || rendering) { return; }
    rendering = true;
    var focus = captureFocus();
    var scroll = bodyEl.scrollTop;
    var ast = registry[current.__path].__ast;
    var html = renderNodes(ast.children, current.data);
    bodyEl.setAttribute('data-page', current.__path);
    bodyEl.innerHTML = '<div class="mp-page-root">' + html + '</div>';
    bodyEl.scrollTop = scroll;
    restoreFocus(focus);
    updateChrome();
    rendering = false;
    renderTick++;
  }

  function titleOf(path) {
    var cfg = registry[path];
    var t = cfg.__title;
    return t || '教学考勤记账本';
  }

  function updateChrome() {
    var cfg = registry[current.__path];
    navEl.querySelector('.mp-nav-title').textContent = titleOf(current.__path);
    var back = navEl.querySelector('.mp-nav-back');
    back.style.visibility = cfg.__isTab ? 'hidden' : 'visible';
    var isTab = cfg.__isTab;
    tabEl.style.display = isTab ? 'flex' : 'none';
    Array.prototype.forEach.call(tabEl.children, function (c) {
      c.classList.toggle('on', c.dataset.path === current.__path);
    });
  }

  function pushPage(path) {
    var old = current;
    if (old && typeof old.onHide === 'function') { old.onHide(); }
    var page = makePage(path, registry[path]);
    current = page;
    stack.push(page);
    bodyEl.scrollTop = 0;
    if (typeof page.onLoad === 'function') { page.onLoad({}); }
    if (typeof page.onShow === 'function') { page.onShow(); }
    doRender();
  }

  function switchTab(path) {
    if (current && current.__path === path) { return; }
    if (current && typeof current.onHide === 'function') { current.onHide(); }
    if (current && !registry[current.__path].__isTab) {
      /* 从课程表返回 tab 页：清掉栈里的非 tab 页 */
      stack = stack.filter(function (p) { return registry[p.__path].__isTab; });
    }
    var page = makePage(path, registry[path]);
    current = page;
    stack.push(page);
    bodyEl.scrollTop = 0;
    if (typeof page.onLoad === 'function') { page.onLoad({}); }
    if (typeof page.onShow === 'function') { page.onShow(); }
    doRender();
  }

  function popPage() {
    if (stack.length <= 1) { return; }
    var p = stack.pop();
    if (typeof p.onUnload === 'function') { p.onUnload(); }
    current = stack[stack.length - 1];
    if (typeof current.onShow === 'function') { current.onShow(); }
    doRender();
  }

  /* ---------------- 模块加载 ---------------- */
  var moduleCache = {};
  var PENDING = '';

  function normalize(p) {
    var parts = p.split('/');
    var out = [];
    parts.forEach(function (s) {
      if (s === '.' || s === '') { return; }
      if (s === '..') { out.pop(); return; }
      out.push(s);
    });
    return out.join('/');
  }

  function requireFrom(fromPath, rel) {
    var base = fromPath.split('/').slice(0, -1).join('/');
    var abs = normalize(base + '/' + rel);
    if (moduleCache[abs]) { return moduleCache[abs].exports; }
    var src = SOURCES[abs];
    if (src == null) { throw new Error('模块不存在：' + abs); }
    var mod = { exports: {} };
    moduleCache[abs] = mod;
    runScript(abs, src, mod);
    return mod.exports;
  }

  var SOURCES = {};

  function runScript(path, src, mod) {
    var require = function (rel) { return requireFrom(path, rel); };
    var pageCapture = function (cfg) {
      var slot = registry[PENDING];
      slot.__cfg = cfg;
      slot.data = cfg.data || {};
      Object.keys(cfg).forEach(function (k) { slot[k] = cfg[k]; });
    };
    var appCapture = function (cfg) { global.__app = cfg; };
    var fn = new Function('require', 'module', 'exports', 'Page', 'App', 'wx', 'getApp',
      src + '\n//# sourceURL=' + path);
    fn(require, mod, mod.exports, pageCapture, appCapture, wx, function () { return global.__app || {}; });
  }

  /* ---------------- CSS 作用域 ---------------- */
  function scopeCss(css, attrVal) {
    var out = '';
    var re = /([^{}]+)\{([^{}]*)\}/g, m;
    while ((m = re.exec(css))) {
      var sel = m[1].trim();
      var body = m[2];
      if (!sel) { continue; }
      if (sel.charAt(0) === '@') { out += sel + '{' + body + '}'; continue; }
      var parts = sel.split(',').map(function (s) {
        s = s.trim();
        if (!s) { return ''; }
        return '[' + attrVal + '] ' + s;
      }).filter(Boolean);
      out += parts.join(',') + '{' + body + '}\n';
    }
    return out;
  }

  function rpx(css) {
    return css.replace(/(-?\d*\.?\d+)rpx/g, function (_, n) {
      return (parseFloat(n) * 0.5) + 'px';
    }).replace(/(\d*\.?\d+)vh/g, function (_, n) {
      return 'calc(' + n + ' * var(--vh))';
    });
  }

  function fixTags(css) {
    /* page 选择器 → 页面根容器；组件标签选择器 → 实际 HTML 标签 */
    return css
      .replace(/(^|[}\s,;])page(\s*[,{])/g, '$1.mp-page-root$2')
      .replace(/(^|[}\s,;])view(\s*[,{:])/g, '$1div$2')
      .replace(/(^|[}\s,;])text(\s*[,{:])/g, '$1span$2')
      .replace(/(^|[}\s,;])picker(\s*[,{:])/g, '$1.mp-picker$2')
      .replace(/(^|[}\s,;])switch(\s*[,{:])/g, '$1.mp-switch$2')
      .replace(/(^|[}\s,;])button(\s*[,{:])/g, '$1button$2');
  }

  /* ---------------- 启动 ---------------- */
  function pageList(cfg) {
    return Object.keys(cfg.pages).filter(function (p) { return cfg.pages[p] && cfg.pages[p].wxml; });
  }

  function boot(cfg) {
    SOURCES = cfg.sources;
    bodyEl = document.getElementById('mp-body');
    navEl = document.getElementById('mp-nav');
    tabEl = document.getElementById('mp-tab');

    /* CSS：全局部分 */
    var css = '';
    css += rpx(fixTags(cfg.appWxss));

    /* CSS：每页作用域化 */
    pageList(cfg).forEach(function (p) {
      css += '\n/* ===== ' + p + ' ===== */\n';
      css += scopeCss(rpx(cfg.pages[p].wxss || ''), 'data-page="' + p + '"');
    });

    var st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    /* 页面注册 */
    pageList(cfg).forEach(function (p) {
      var info = cfg.pages[p];
      registry[p] = {
        __ast: parseWXML(info.wxml),
        __title: info.title || '教学考勤记账本',
        __isTab: !!info.isTab,
        __cfg: null,
        __data: null
      };
    });

    /* 执行 app.js 和 utils */
    if (SOURCES['app.js']) {
      runScript('app.js', SOURCES['app.js'], { exports: {} });
      if (global.__app && typeof global.__app.onLaunch === 'function') {
        global.__app.onLaunch({});
      }
    }
    ['utils/core.js', 'utils/store.js'].forEach(function (p) {
      if (SOURCES[p] && !moduleCache[p]) {
        moduleCache[p] = { exports: {} };
        runScript(p, SOURCES[p], moduleCache[p]);
      }
    });

    /* 执行页面脚本 */
    pageList(cfg).forEach(function (p) {
      var info = cfg.pages[p];
      var mod = { exports: {} };
      PENDING = p;
      runScript(p, info.js, mod);
    });

    /* 事件委托 */
    bodyEl.addEventListener('click', function (e) {
      var sw = e.target.closest('[data-mp-comp="switch"]');
      if (sw) {
        var on = sw.classList.contains('on');
        sw.classList.toggle('on', !on);
        fire(sw, 'change', { value: !on });
        return;
      }
      var pk = e.target.closest('[data-mp-comp="picker"]');
      if (pk) { openPicker(pk); return; }

      var cur = e.target;
      while (cur && cur.nodeType === 1 && cur !== bodyEl) {
        if (cur.hasAttribute('data-mp-cv-tap')) { fire(cur, 'tap'); return; }
        if (cur.hasAttribute('data-mp-ev-tap')) { fire(cur, 'tap'); return; }
        cur = cur.parentElement;
      }
    });

    /* 鼠标模拟触摸：桌面预览里按住拖动 = 手机上的滑动选择 */
    var dragEl = null;
    bodyEl.addEventListener('mousedown', function (e) {
      var el = e.target.closest('[data-mp-ev-touchstart],[data-mp-cv-touchstart]');
      if (!el) { return; }
      dragEl = el;
      e.preventDefault();
      walkTouch(el, 'touchstart', e.clientX, e.clientY, el);
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragEl) { return; }
      walkTouch(dragEl, 'touchmove', e.clientX, e.clientY, dragEl);
    });
    window.addEventListener('mouseup', function (e) {
      if (!dragEl) { return; }
      var el = dragEl;
      dragEl = null;
      walkTouch(el, 'touchend', e.clientX, e.clientY, el);
    });

    bodyEl.addEventListener('input', function (e) {
      var t = e.target;
      if (t.tagName !== 'INPUT') { return; }
      if (t.hasAttribute('data-mp-ev-input')) { fire(t, 'input', { value: t.value }); }
    });

    bodyEl.addEventListener('focusout', function (e) {
      var t = e.target;
      if (t.tagName !== 'INPUT') { return; }
      if (t.hasAttribute('data-mp-ev-blur')) { fire(t, 'blur', { value: t.value }); }
    });

    /* tabBar */
    Array.prototype.forEach.call(tabEl.children, function (c) {
      c.addEventListener('click', function () { switchTab(c.dataset.path); });
    });

    /* 返回 */
    navEl.querySelector('.mp-nav-back').addEventListener('click', function () { popPage(); });

    /* 首屏 */
    switchTab(cfg.first || pageList(cfg)[0]);
  }

  global.MPPreview = {
    boot: boot,
    toast: toast,
    getPage: function () { return current; },
    reset: function () { writeStore({}); }
  };
})(window);
