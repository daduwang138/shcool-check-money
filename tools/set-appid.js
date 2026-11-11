/* 换 AppID 用：正式注册拿到新号以后，一条命令写进去，省得手改 JSON 改错位置。
   用法：node tools/set-appid.js wx0123456789abcdef
         node tools/set-appid.js          只查看当前的，不改

小程序包里的 AppID 只有一个落点（project.config.json），改完不用动代码。
测试号（wx4c5f8d6035cb8021）只能调试、不能提审发布，上线前必须换掉。 */

const fs = require('fs');
const path = require('path');

const FILE = path.resolve(__dirname, '..', 'teaching-attendance-mp', 'project.config.json');
const TEST_APPID = 'wx4c5f8d6035cb8021';

const next = (process.argv[2] || '').trim();
const raw = fs.readFileSync(FILE, 'utf8');
const cfg = JSON.parse(raw);

console.log('当前 AppID：' + cfg.appid + (cfg.appid === TEST_APPID ? '  ← 这是测试号，不能发布' : ''));

if (!next) {
  console.log('只查询，没有改动。要换就带上新 AppID，例如：');
  console.log('  node tools/set-appid.js wx0123456789abcdef');
  process.exit(0);
}

if (!/^wx[0-9a-f]{16}$/.test(next)) {
  console.error('格式不对：正式 AppID 是 wx 开头 + 16 位小写十六进制，共 18 位。你给的是 ' + next);
  process.exit(1);
}
if (next === cfg.appid) {
  console.log('和当前一致，不用改。');
  process.exit(0);
}

cfg.appid = next;
/* 保留原有缩进与字段顺序：JSON.stringify(…, 2) 的键序跟原文件一致，diff 里只会看到 appid 一行 */
fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2) + '\n', 'utf8');

const after = JSON.parse(fs.readFileSync(FILE, 'utf8')).appid;
if (after !== next) {
  console.error('写入后读回来不一致，请手动检查 ' + FILE);
  process.exit(1);
}
console.log('已改为：' + after);
console.log('');
console.log('接着做两件事：');
console.log('  1. 微信开发者工具里重新打开项目（或在「详情 → 基本信息」里改成新 AppID），确认能编译');
console.log('  2. 上传后在 mp.weixin.qq.com「管理 → 版本管理」能看到这个版本，才说明 AppID 对上了');
