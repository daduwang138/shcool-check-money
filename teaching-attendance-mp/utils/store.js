/* 本地存储 + 文件导出导入
   小程序没有「文件夹」概念，数据默认存本地 Storage；
   跨设备靠导出 JSON，手机发到「文件传输助手」，电脑端再导入。 */

var core = require('./core.js');

var KEY = 'kqzb_db_v1';

/* 各页面 onShow 都会 load()，拿到的始终是同一个共享对象引用。
   写操作统一走 commit()（不接受外部 db），「A 页面拿旧副本整库盖掉 B 页面」
   从结构上就不可能发生。Storage 被外部改写时 load() 会重新解析。 */
var _cache = null, _cacheRaw = '';

function load() {
  var raw = null, parsed = null;
  try { raw = wx.getStorageSync(KEY); } catch (e) { raw = null; }
  /* 绝大多数 onShow 只是「回到页面」，Storage 一个字都没变（commit 写进去的就是
     _cacheRaw）。这时直接还缓存，省掉整库 JSON.parse + normalize + stringify 三趟遍历：
     三五年账两千多天，每次切 tab 都得白序列化几百 KB。 */
  if (_cache && raw && raw === _cacheRaw) { return _cache; }
  if (raw) {
    try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { parsed = null; }
  }
  var db = core.normalize(parsed || core.blankDB());
  var normRaw = JSON.stringify(db);
  if (_cache && normRaw === _cacheRaw) { return _cache; }
  _cache = db; _cacheRaw = normRaw;
  return _cache;
}

/* 唯一的落盘入口：不接受外部 db，提交的永远是当前共享对象。
   页面改完 this.db 调 commit() 即可。早先那个按 upd 时间戳补合并的
   _mergeNewer 补丁是给「调用方可能传旧副本」擦屁股的，现在那种情况不可能发生，已退役。 */
function commit() {
  var db = _cache || load();
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

/* 「用文件覆盖本机」是整库替换：把共享引用换成新库再提交，不读旧 Storage */
function replace(db) {
  _cache = db; _cacheRaw = '';
  commit();
  return db;
}

function reset() {
  _cache = null; _cacheRaw = '';
  /* 隐私模式 / 存储被禁用时 removeStorageSync 会抛；清不掉就当它已经是空库 */
  try { wx.removeStorageSync(KEY); } catch (e) { /* 忽略：没有可清理的存储 */ }
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
        fail: function () {
          reject(new Error('导出失败：当前客户端既不能存文件、也无法写入剪贴板。请换客户端导出，或先不要清理本机数据'));
        }
      });
    });
  });
}

function backupName() {
  return '考勤数据备份-' + core.todayKey() + '.json';
}

/* 上次成功导出备份的时间：单独存一个键，不写进 db——
   它描述的是「这台设备的动作」，不是账本内容，进备份文件反而会被别的设备带过来。 */
var BACKUP_KEY = 'kqzb_backup_at';
var SNOOZE_KEY = 'kqzb_backup_snooze';

function backupAt() {
  var v = 0;
  try { v = parseInt(wx.getStorageSync(BACKUP_KEY), 10) || 0; } catch (e) { v = 0; }
  return v;
}

function markBackup() {
  try { wx.setStorageSync(BACKUP_KEY, String(Date.now())); } catch (e) { /* 存储不可用就算了 */ }
}

/* 点了「稍后再说」：暂时别提醒，过几天再说 */
function snoozeBackup(days) {
  try { wx.setStorageSync(SNOOZE_KEY, String(Date.now() + (days || 7) * 86400000)); } catch (e) { /* 同上 */ }
}

/* 该不该提醒导出备份。没备份过就该提醒；提醒过被关掉的话，等到期再说。
   days 默认 30 天，now 可传入便于测试。 */
function backupDue(now, days) {
  var t = now || Date.now();
  var snoozeTo = 0;
  try { snoozeTo = parseInt(wx.getStorageSync(SNOOZE_KEY), 10) || 0; } catch (e) { snoozeTo = 0; }
  if (snoozeTo > t) { return false; }
  var at = backupAt();
  if (!at) { return true; }
  return (t - at) > (days || 30) * 86400000;
}

/* 距上次备份多少天；从没备份过返回 -1 */
function backupDays(now) {
  var at = backupAt();
  if (!at) { return -1; }
  return Math.floor(((now || Date.now()) - at) / 86400000);
}

function exportBackup(db) {
  var text = JSON.stringify(db, null, 2);
  return exportText(backupName(), text).then(function (msg) {
    /* 只有真的交付出去（存盘 / 发到聊天 / 复制到剪贴板）才算备份过 */
    markBackup();
    return msg;
  });
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
  /* 字段清单从 spec.js 的 DAY_FIELDS 派生：以后加日记录字段，
     不会忘了把它纳入导入合并时的冲突判断（手写清单曾是这个风险点）。 */
  return JSON.stringify(core.DAY_FIELDS.map(function (f) {
    if (f.kind === 'int') return parseInt(r[f.key], 10) || 0;
    if (f.kind === 'bool') return !!r[f.key];
    return r[f.key] || '';
  }));
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
  commit: commit,
  replace: replace,
  reset: reset,
  isPC: isPC,
  platform: platform,
  exportText: exportText,
  exportBackup: exportBackup,
  backupAt: backupAt,
  backupDays: backupDays,
  backupDue: backupDue,
  snoozeBackup: snoozeBackup,
  exportCsv: exportCsv,
  readFromChat: readFromChat,
  parseBackup: parseBackup,
  mergeInto: mergeInto
};
