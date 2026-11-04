/* 把 wxss 里的 rpx 换成 px（750rpx = 375px），生成两张静态草图看排版 */
const fs = require('fs');
const path = require('path');
const MP = path.resolve(__dirname, '..', 'teaching-attendance-mp');
const conv = s => s.replace(/(-?[\d.]+)rpx/g, (_, n) => (parseFloat(n) / 2) + 'px');

const app = conv(fs.readFileSync(path.join(MP, 'app.wxss'), 'utf8'));
const cal = conv(fs.readFileSync(path.join(MP, 'pages', 'calendar', 'calendar.wxss'), 'utf8'));

const base = `<!doctype html><html><head><meta charset="utf-8">
<style>
${app}
${cal}
body{margin:0;background:#DDDCD6}
.phone .sheet,.phone .mask,.phone .selbar{position:absolute}
.phone picker{display:flex}
.phone{position:relative;width:375px;height:812px;overflow:hidden;background:#F5F4F0;font-family:"PingFang SC",sans-serif}
</style></head><body><div class="phone">`;

const cells = (() => {
  let out = '';
  for (let d = 1; d <= 30; d++) {
    const sel = d === 5 || d === 6 ? ' sel' : '';
    out += `<view class="cell${sel}"><view class="dnum"><text class="dn">${d}</text></view>
      <view class="halves"><view class="half s-work"></view><view class="half s-work"></view></view>
      <text class="les">4节</text></view>`;
  }
  return out;
})();

const withSel = base + `
  <view class="page pad-sel">
    <view class="topbar">
      <view class="nav">‹</view><view class="mon">2026 年 11 月<text class="caret">▾</text></view>
      <view class="nav">›</view><view class="go-today">今天</view><view class="sel-toggle on">退出</view>
    </view>
    <view class="weekhead"><text class="wh">一</text><text class="wh">二</text><text class="wh">三</text><text class="wh">四</text><text class="wh">五</text><text class="wh">六</text><text class="wh">日</text></view>
    <view class="grid">${cells}</view>
  </view>
  <view class="selbar">
    <view class="sb-head"><text class="sb-cnt">已选 2 天</text><text class="sb-link">全月工作日</text><text class="sb-link">清空</text><text class="sb-x">×</text></view>
    <view class="sb-scope"><view class="sb-chip on">全天</view><view class="sb-chip">只上午</view><view class="sb-chip">只下午</view><view class="sb-chip sb-les">课时清零</view></view>
    <view class="sb-row"><view class="sb-b w">上班</view><view class="sb-b i">监考</view><view class="sb-b o">加班</view><view class="sb-b l">请假</view><view class="sb-b">空</view></view>
    <text class="sb-hint">点日期增减选择；起算日前的日期会自动跳过</text>
  </view>
</div></body></html>`;

const withBulk = base + `
  <view class="mask"></view>
  <view class="sheet">
    <view class="sheet-head">
      <view class="sheet-title-wrap"><text class="sheet-title">批量设置</text><text class="sheet-sub">按日期范围 + 星期，一次套用到多天</text></view>
      <view class="sheet-x">✕</view>
    </view>
    <view class="field"><text class="field-label">日期范围</text>
      <view class="date-row"><picker class="date-box">2026-11-01</picker><text class="date-sep">至</text><picker class="date-box">2026-11-30</picker></view>
    </view>
    <view class="field"><text class="field-label">只在以下星期生效（可多选）</text>
      <view class="wd-row">
        <view class="wd on">周一</view><view class="wd on">周二</view><view class="wd on">周三</view><view class="wd on">周四</view>
        <view class="wd on">周五</view><view class="wd">周六</view><view class="wd">周日</view>
      </view>
    </view>
    <view class="field"><text class="field-label">设为</text>
      <view class="st-row">
        <view class="st s-work on">上班</view><view class="st s-inv">监考</view><view class="st s-ot">加班</view><view class="st s-leave">请假</view>
        <view class="st s-empty">空</view><view class="st plain">只上午</view><view class="st plain">只下午</view>
      </view>
    </view>
    <view class="field"><view class="cl-row"><text class="cl-t">同时把课时清零</text><view class="cl-box"></view></view></view>
    <text class="bulk-preview">将影响 22 天，套用后 5 秒内可撤销</text>
    <view class="sheet-actions"><view class="btn ghost">取消</view><view class="btn primary">应用</view></view>
    <view class="safe"></view>
  </view>
</div></body></html>`;

const dir = path.join(__dirname, 'out');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'ui_sel.html'), withSel);
fs.writeFileSync(path.join(dir, 'ui_bulk.html'), withBulk);
console.log('written ui_sel.html / ui_bulk.html');
