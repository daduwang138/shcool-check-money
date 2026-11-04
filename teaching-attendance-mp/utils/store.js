/* 本地存储 + 文件导出导入
   小程序没有「文件夹」概念，数据默认存本地 Storage；
   跨设备靠导出 JSON，手机发到「文件传输助手」，电脑端再导入。 */

var core = require('./core.js');

var KEY = 'kqzb_db_v1';

function load() {
  var raw = null, db = null;
  try { raw = wx.getStorageSync(KEY); } catch (e) { raw = null; }
  if (raw) {
    try { db = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (e) { db = null; }
  }
  return core.normalize(db || core.blankDB());
}

function save(db) {
  db.savedAt = Date.now();
  try {
    wx.setStorageSync(KEY, JSON.stringify(db));
    return true;
  } catch (e) {
    wx.showToast({ title: '本地保存失败，空间可能不足', icon: 'none' });
    return false;
  }
}

function reset() {
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

/* 合并：逐日按 upd 取新；工资参数、课程表保留本机的，避免把本机设置冲掉。
   只有本机完全是空白（没记录、没参数、没课程）时才把导入的设置也接过来。 */
function mergeInto(local, incoming) {
  var s = local.settings || {};
  var isFresh = core.dayCount(local) === 0 &&
    !(parseFloat(s.baseSalary) > 0) &&
    !(parseFloat(s.rate) > 0) &&
    !(local.courses && local.courses.length) &&
    !(local.term && local.term.start);
  var added = 0, updated = 0;
  Object.keys(incoming.days || {}).forEach(function (k) {
    var a = local.days[k], b = incoming.days[k];
    if (!a || (b.upd || 0) > (a.upd || 0)) {
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
  return { added: added, updated: updated };
}

module.exports = {
  load: load,
  save: save,
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
