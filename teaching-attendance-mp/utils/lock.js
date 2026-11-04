/* 口令锁
   小程序里没有 WebCrypto，所以自己实现 SHA-256 / HMAC / PBKDF2（纯 JS，无依赖）。
   本地只存「盐 + 迭代次数 + 派生值」，不存口令本身；校验时重新派生再比。

   边界要说清楚：这是**锁屏**，不是把数据加密。记录仍然明文放在微信本地存储里，
   挡的是「别人拿到手机随手点开小程序」；真要防数据被整体导走，得靠手机本身的锁屏和系统加密。
   忘记口令只能清空重来（或先用导出的备份恢复），锁屏页写明了这一点。 */

var KEY = 'kqzb_lock_v1';
var ITER = 20000;

/* ---------------- SHA-256 ---------------- */
var K256 = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

function sha256(msg) {
  var len = msg.length;
  var withPad = len + 9;
  var blocks = Math.ceil(withPad / 64);
  var buf = new Uint8Array(blocks * 64);
  buf.set(msg);
  buf[len] = 0x80;
  var bitLen = len * 8;
  var hi = Math.floor(bitLen / 4294967296);
  var lo = bitLen >>> 0;
  for (var t = 0; t < 4; t++) {
    buf[blocks * 64 - 8 + t] = (hi >>> (24 - 8 * t)) & 0xff;
    buf[blocks * 64 - 4 + t] = (lo >>> (24 - 8 * t)) & 0xff;
  }

  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var W = new Int32Array(64);

  for (var b = 0; b < blocks; b++) {
    var off = b * 64, j;
    for (j = 0; j < 16; j++) {
      W[j] = (buf[off + j * 4] << 24) | (buf[off + j * 4 + 1] << 16) | (buf[off + j * 4 + 2] << 8) | buf[off + j * 4 + 3];
    }
    for (j = 16; j < 64; j++) {
      var s0 = rotr(W[j - 15], 7) ^ rotr(W[j - 15], 18) ^ (W[j - 15] >>> 3);
      var s1 = rotr(W[j - 2], 17) ^ rotr(W[j - 2], 19) ^ (W[j - 2] >>> 10);
      W[j] = (W[j - 16] + s0 + W[j - 7] + s1) | 0;
    }
    var a = H[0], bb = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (j = 0; j < 64; j++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      var ch = (e & f) ^ (~e & g);
      var t1 = (h + S1 + ch + K256[j] + W[j]) | 0;
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      var maj = (a & bb) ^ (a & c) ^ (bb & c);
      var t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = bb; bb = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + bb) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }

  var out = new Uint8Array(32);
  for (var k = 0; k < 8; k++) {
    out[k * 4] = (H[k] >>> 24) & 0xff;
    out[k * 4 + 1] = (H[k] >>> 16) & 0xff;
    out[k * 4 + 2] = (H[k] >>> 8) & 0xff;
    out[k * 4 + 3] = H[k] & 0xff;
  }
  return out;
}

function hmacSha256(key, msg) {
  var block = 64;
  if (key.length > block) { key = sha256(key); }
  var ipad = new Uint8Array(block + msg.length);
  var opad = new Uint8Array(block + 32);
  for (var i = 0; i < block; i++) {
    var k = i < key.length ? key[i] : 0;
    ipad[i] = k ^ 0x36;
    opad[i] = k ^ 0x5c;
  }
  ipad.set(msg, block);
  opad.set(sha256(ipad), block);
  return sha256(opad);
}

/* 只取第一个 32 字节块，够用来做校验值 */
function pbkdf2(pass, salt, iter) {
  var msg = new Uint8Array(salt.length + 4);
  msg.set(salt);
  msg[salt.length] = 0;
  msg[salt.length + 1] = 0;
  msg[salt.length + 2] = 0;
  msg[salt.length + 3] = 1;
  var u = hmacSha256(pass, msg);
  var out = new Uint8Array(u);
  for (var i = 1; i < iter; i++) {
    u = hmacSha256(pass, u);
    for (var j = 0; j < 32; j++) { out[j] ^= u[j]; }
  }
  return out;
}

/* ---------------- 编解码 ---------------- */
function utf8(str) {
  var s = unescape(encodeURIComponent(str));
  var b = new Uint8Array(s.length);
  for (var i = 0; i < s.length; i++) { b[i] = s.charCodeAt(i); }
  return b;
}
function hex(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) { s += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16); }
  return s;
}
function unhex(h) {
  var n = h.length / 2, b = new Uint8Array(n);
  for (var i = 0; i < n; i++) { b[i] = parseInt(h.substr(i * 2, 2), 16); }
  return b;
}

/* ---------------- 存储与校验 ---------------- */
function read() {
  var raw = null;
  try { raw = wx.getStorageSync(KEY); } catch (e) { raw = null; }
  if (!raw) { return null; }
  try {
    var o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return o && o.v === 1 && o.salt && o.hash ? o : null;
  } catch (e) { return null; }
}
function isOn() { return !!read(); }

function randomSalt() {
  var b = new Uint8Array(16);
  var ok = false;
  try {
    if (typeof wx.getRandomValues === 'function') {
      var r = wx.getRandomValues({ length: 16 });
      if (r && r.randomValues) { b.set(new Uint8Array(r.randomValues)); ok = true; }
    }
  } catch (e) { ok = false; }
  if (!ok) {
    for (var i = 0; i < 16; i++) { b[i] = Math.floor(Math.random() * 256); }
  }
  return b;
}

function derive(pass, saltHex, iter) {
  return hex(pbkdf2(utf8(pass), unhex(saltHex), iter || ITER));
}

/* 设置/更换口令；成功后顺手解锁（刚输过，不用再输一遍） */
function setPass(pass) {
  var salt = hex(randomSalt());
  var meta = { v: 1, salt: salt, iter: ITER, hash: derive(pass, salt, ITER), at: Date.now() };
  try { wx.setStorageSync(KEY, JSON.stringify(meta)); } catch (e) { return false; }
  unlocked = true;
  return true;
}

function check(pass) {
  var meta = read();
  if (!meta) { return true; }
  return derive(pass, meta.salt, meta.iter) === meta.hash;
}

function clear() {
  try { wx.removeStorageSync(KEY); } catch (e) { /* 忽略 */ }
  unlocked = true;
}

/* ---------------- 解锁状态 ---------------- */
/* 只在内存里，冷启动后必然为 false */
var unlocked = false;
var lease = 0;          /* 最近一次解锁时间，用于「切后台久了要重输」 */

function markUnlocked() { unlocked = true; lease = Date.now(); }
function isUnlocked() { return !isOn() || unlocked; }
function lockNow() { unlocked = false; lease = 0; }
function idleMs() { return lease ? Date.now() - lease : 0; }

function unlock(pass) {
  if (!isOn()) { markUnlocked(); return true; }
  if (check(pass)) { markUnlocked(); return true; }
  return false;
}

/* 页面 onShow 时调用：锁着就把它送回锁屏页，返回 false 让调用方跳过渲染 */
function guard() {
  if (isUnlocked()) { return true; }
  try {
    wx.reLaunch({ url: '/pages/lock/lock' });
  } catch (e) { /* 忽略 */ }
  return false;
}

module.exports = {
  ITER: ITER,
  isOn: isOn,
  setPass: setPass,
  check: check,
  clear: clear,
  unlock: unlock,
  isUnlocked: isUnlocked,
  lockNow: lockNow,
  markUnlocked: markUnlocked,
  idleMs: idleMs,
  guard: guard,
  /* 供测试用 */
  sha256Hex: function (s) { return hex(sha256(utf8(s))); },
  pbkdf2Hex: function (pass, saltHex, iter) { return derive(pass, saltHex, iter); }
};
