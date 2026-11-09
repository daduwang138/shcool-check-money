/* 本地存储 + 文件导出导入
   小程序没有「文件夹」概念，数据默认存本地 Storage；
   跨设备靠导出 JSON，手机发到「文件传输助手」，电脑端再导入。 */

var core = require('./core.js');

var KEY = 'kqzb_db_v1';

/* 各页面 onShow 都会 load()。以前每次都解析出一份新对象，
   A 页面手里的旧副本一旦 store.save()，就会把 B 页面刚写的数据整库盖掉。
   Storage 内容没变时让所有页面共用同一个对象引用；被外部改写才重新解析。 */
var _cache = null, _cacheRaw = '';

function load() {
  var raw = null, parsed = null;
  try { raw = wx.getStorageSync(KEY); } catch (e) { raw = null; }
  if (raw) {
    try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { parsed = null; }
  }
  var db = core.normalize(parsed || core.blankDB());
  var normRaw = JSON.stringify(db);
  if (_cache && normRaw === _cacheRaw) { return _cache; }
  _cache = db; _cacheRaw = normRaw;
  return _cache;
}

/* 万一调用方拿到的不是共享对象（例如导入后另建了库），保存前把共享副本里
   较新的日记录并回来，避免「旧副本整库覆盖」把别的页面刚写的数据抹掉。 */
function _mergeNewer(target, source) {
  if (!target || !source || target === source) { return; }
  if (!target.days) { target.days = {}; }
  if (!target.months) { target.months = {}; }
  Object.keys(source.days || {}).forEach(function (k) {
    var a = target.days[k], b = source.days[k];
    if (!a || (b && (b.upd || 0) > (a.upd || 0))) { target.days[k] = b; }
  });
  Object.keys(source.months || {}).forEach(function (ym) {
    if (!target.months[ym]) { target.months[ym] = source.months[ym]; }
  });
}

function save(db) {
  if (_cache && _cache !== db) { _mergeNewer(db, _cache); }
  /* 和 load() 一样先规范化（补 lset 等），否则写进去的内容和下次读出来的
     形态不一致，缓存比对每次都失效，又退回「各页面各拿一份副本」 */
  core.normalize(db);
  db.savedAt = Date.now();
  try {
    var raw = JSON.stringify(db);
    wx.setStorageSync(KEY, raw);
    _cache = db; _cacheRaw = raw;
    return true;
  } catch (e) {
    wx.showToast({ title: '本地保存失败，空间可能不足', icon: 'none' });
    return false;
  }
}

/* 「用文件覆盖本机」是整库替换，不该走合并保护 */
function replace(db) {
  _cache = null; _cacheRaw = '';
  save(db);
  return db;
}

function reset() {
  _cache = null; _cacheRaw = '';
  try { wx.removeStorageSync(KEY); } catch (e) {}
}

function platform() {
  var p = '';
  try {
    var info = typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo() : wx.getSystemInfoSync();
    p = String((info && info.platform) || '').toLowerCase();
  } catch (e) { p = ''; }
  return p;
}
function isPC() {
  var p = platform();
  return p === 'windows' || p === 'mac' || p === 'devtools';
}

function writeTemp(name, text) {
  return new Promise(function (resolve, reject) {
    try {
      var fs = wx.getFileSystemManager();
      var path = wx.env.USER_DATA_PATH + '/' + name;
      fs.writeFile({
        filePath: path,
        data: text,
        encoding: 'utf8',
        success: function () { resolve(path); },
        fail: reject
      });
    } catch (e) { reject(e); }
  });
}

/* 电脑端存到选定的文件夹；手机端走「转发到聊天」 */
function deliver(path, name, text) {
  var p = platform();
  if ((p === 'windows' || p === 'mac') && typeof wx.saveFileToDisk === 'function') {
    return new Promise(function (resolve, reject) {
      wx.saveFileToDisk({
        filePath: path,
        success: function () { resolve('已保存到你选择的文件夹'); },
        fail: function (err) { reject(err); }
      });
    });
  }
  if (typeof wx.shareFileMessage === 'function') {
    return new Promise(function (resolve, reject) {
      wx.shareFileMessage({
        filePath: path,
        fileName: name,
        success: function () { resolve('已发送到聊天，可存到「文件传输助手」'); },
        fail: function (err) { reject(err); }
      });
    });
  }
  return Promise.reject(new Error('当前客户端不支持导出文件'));
}

function exportText(name, text) {
  return writeTemp(name, text).then(function (path) {
    return deliver(path, name, text);
  }).catch(function (err) {
    /* 兜底：至少让人能把内容复制走 */
    return new Promise(function (resolve, reject) {
      wx.setClipboardData({
        data: text,
        success: function () { resolve('已复制到剪贴板（当前客户端不支持存文件），粘贴到记事本另存即可'); },
        fail: function () { reject(err); }
      });
    });
  });
}

function backupName() {
  return '考勤数据备份-' + core.todayKey() + '.json';
}

function exportBackup(db) {
  var text = JSON.stringify(db, null, 2);
  return exportText(backupName(), text);
}

function exportCsv(db, months, withSummary, withDetail) {
  var text = core.buildExportCsv(db, months, withSummary, withDetail);
  var tag = months.length === 1 ? months[0] : (months[0] + '_至_' + months[months.length - 1]);
  return exportText('考勤统计-' + tag + '.csv', text);
}

function readFromChat() {
  return new Promise(function (resolve, reject) {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: function (res) {
        var f = res.tempFiles && res.tempFiles[0];
        if (!f) { reject(new Error('没有选到文件')); return; }
        try {
          var txt = wx.getFileSystemManager().readFileSync(f.path, 'utf8');
          resolve({ name: f.name || '备份文件', text: txt });
        } catch (e) { reject(e); }
      },
      fail: function (err) { reject(err); }
    });
  });
}

function parseBackup(text) {
  var obj = null;
  try { obj = JSON.parse(text); } catch (e) { obj = null; }
  if (!obj || typeof obj !== 'object' || (!obj.days && !obj.settings)) {
    throw new Error('这不像是本工具导出的备份文件');
  }
  return core.normalize(obj);
}

/* 只看业务内容，不比 upd / lset：光时间戳不同不算「两边不一致」 */
function dayBody(r) {
  return JSON.stringify([r.am || '', r.pm || '', parseInt(r.lessons, 10) || 0,
    r.note || '', r.rid || '', parseInt(r.night, 10) || 0, !!r.off]);
}

/* 合并：逐日按 upd 取新；工资参数、课程表保留本机的，避免把本机设置冲掉。
   只有本机完全是空白（没记录、没参数、没课程）时才把导入的设置也接过来。
   跨设备时钟可能差几小时，明显来自未来的 upd 不能当「更新」，否则会吞掉本机新账；
   两边同一天内容不一致时记进 conflicts，界面上要看得见。 */
function mergeInto(local, incoming) {
  var s = local.settings || {};
  var isFresh = core.dayCount(local) === 0 &&
    !(parseFloat(s.baseSalary) > 0) &&
    !(parseFloat(s.rate) > 0) &&
    !(local.courses && local.courses.length) &&
    !(local.term && local.term.start);
  var added = 0, updated = 0, conflicts = 0, future = 0;
  var ceiling = Date.now() + 5 * 60 * 1000;
  Object.keys(incoming.days || {}).forEach(function (k) {
    var a = local.days[k], b = incoming.days[k];
    if (!b) { return; }
    var bu = b.upd || 0, au = (a && a.upd) || 0;
    if (bu > ceiling) { bu = 0; future++; }
    if (a && dayBody(a) !== dayBody(b)) { conflicts++; }
    if (!a || bu > au) {
      if (a) { updated++; } else { added++; }
      local.days[k] = b;
    }
  });
  Object.keys(incoming.months || {}).forEach(function (k) {
    if (!local.months[k]) local.months[k] = incoming.months[k];
  });
  if (isFresh) {
    local.settings = incoming.settings;
    local.term = incoming.term;
    local.courses = incoming.courses;
  }
  return { added: added, updated: updated, conflicts: conflicts, future: future };
}

module.exports = {
  load: load,
  save: save,
  replace: replace,
  reset: reset,
  isPC: isPC,
  platform: platform,
  exportText: exportText,
  exportBackup: exportBackup,
  exportCsv: exportCsv,
  readFromChat: readFromChat,
  parseBackup: parseBackup,
  mergeInto: mergeInto
};
