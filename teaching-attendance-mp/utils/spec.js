/* 业务口径常量的唯一真源：状态定义、状态循环、内置放假表。
   小程序端由 utils/core.js 直接 require；电脑版单文件因为要「解压即用」，
   由 tools/sync_spec.js 把这里的数据生成为同名全局常量注入 教学考勤记账本.html。

   改完这里必须跑一次 `node tools/sync_spec.js`。tests/check_structure.js 会
   比对生成结果，没同步就报错，不会出现「小程序改了、电脑版还是旧放假表」。
   以后加计薪项元数据 / 默认参数，也往这里加一段，生成工具不用改架构。 */
var STATES = {
  '': { label: '空', cls: 's-empty', ch: '' },
  work: { label: '上班', cls: 's-work', ch: '班' },
  inv: { label: '监考', cls: 's-inv', ch: '监' },
  ot: { label: '加班', cls: 's-ot', ch: '加' },
  leave: { label: '请假', cls: 's-leave', ch: '假' }
};

var CYCLE = ['', 'work', 'inv', 'ot', 'leave'];

/* 国务院办公厅公布的放假安排；缺年份时按「周末休、工作日上」的朴素规则。
   2028 及以后公布时只改这里，再跑一次 sync_spec.js，两版同时生效。 */
var HOLIDAYS = {
  2026: {
    note: '国办发明电〔2025〕7号',
    spans: [
      ['2026-01-01', '2026-01-03'],
      ['2026-02-15', '2026-02-23'],
      ['2026-04-04', '2026-04-06'],
      ['2026-05-01', '2026-05-05'],
      ['2026-06-19', '2026-06-21'],
      ['2026-09-25', '2026-09-27'],
      ['2026-10-01', '2026-10-07']
    ],
    makeup: ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10']
  },
  2027: {
    note: '国办发明电〔2026〕10号',
    spans: [
      ['2027-01-01', '2027-01-03'],
      ['2027-02-05', '2027-02-13'],
      ['2027-04-03', '2027-04-05'],
      ['2027-05-01', '2027-05-05'],
      ['2027-06-09', '2027-06-09'],
      ['2027-09-15', '2027-09-15'],
      ['2027-10-01', '2027-10-07']
    ],
    makeup: ['2027-01-31', '2027-02-14', '2027-05-08', '2027-09-26', '2027-10-09']
  }
};

/* 计薪项注册表：四段式口径的唯一真源。
   computeMonth 按 key 累加应发；核对单、CSV 列头、汇总页都从这里取名字和公式说明。
   以后加一项（如班主任津贴）只需在这里加一行 + 在 computeMonth 里算出该 key 的金额，
   不用再去核对单 / CSV / 文档里各补一遍。onlyIfNight 表示核对单只在记过晚修时列。 */
var PAY_ITEMS = [
  { key: 'basePart', mark: '①', label: '基本工资部分', csv: '基本工资部分',
    formula: '基本工资 ÷ 法定工作日 × min(实际出勤, 应上班)' },
  { key: 'extraPart', mark: '②', label: '超出天数部分', csv: '超出天数部分',
    formula: '日薪 × 超出应上班天数' },
  { key: 'lessonFee', mark: '③', label: '课时费', csv: '课时费',
    formula: 'Σ(各档课时 × 该档当月冻结价)' },
  { key: 'nightFee', mark: '④', label: '晚修监考费', csv: '晚修补贴',
    formula: '晚修次数 × 每次金额', onlyIfNight: true }
];

/* 数据 schema：版本号 + 日记录业务字段清单。
   DAY_FIELDS 是「比较两天是不是同一条账」的唯一依据（store.js 的 dayBody 由它生成）：
   以后加日记录字段只改这里，不会漏掉导入合并时的冲突判断。

   ⚠ 这个文件只能放**纯数据**：sync_spec.js 用 JSON.stringify 把它序列化成电脑版的
   全局常量，函数 / undefined 会被悄悄变成 null 或丢键，两版行为就此分叉而护栏发现不了。
   迁移函数 MIGRATIONS 是行为，放在 core.js（由生成器整体打包进电脑版 IIFE）。
   check_structure.js 有「spec.js 必须可无损序列化」的护栏。 */
var SCHEMA_VERSION = 1;
var DAY_FIELDS = [
  { key: 'am', kind: 'str' },
  { key: 'pm', kind: 'str' },
  { key: 'lessons', kind: 'int' },
  { key: 'note', kind: 'str' },
  { key: 'rid', kind: 'str' },
  { key: 'night', kind: 'int' },
  { key: 'off', kind: 'bool' }
];
module.exports = {
  STATES: STATES, CYCLE: CYCLE, HOLIDAYS: HOLIDAYS, PAY_ITEMS: PAY_ITEMS,
  SCHEMA_VERSION: SCHEMA_VERSION, DAY_FIELDS: DAY_FIELDS
};
