/* 訊息解析器測試。執行：node tests/parser.test.js（不需要安裝任何套件） */
global.window = global;
require('../js/units.js');
require('../js/parser.js');

var assert = require('assert');
var pass = 0;

function test(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

function byUnit(result, unitId) {
  var e = result.entries.find(function (x) { return x.unitId === unitId; });
  assert.ok(e, '找不到單位 ' + unitId);
  return e.meals;
}

var SAMPLE = [
  'All ',
  '明天便當數（7/28）禮拜二',
  '',
  '八仙管理員',
  '中：3',
  '戰',
  '早：中：15晚：63+1素',
  '火',
  '早：10中：30晚：20',
  'ㄧ連',
  '早：13中：26晚：38',
  '二連',
  '早： 中：15晚：31',
  '三連',
  '早：8 中：8晚：25',
].join('\n');

console.log('班長訊息解析：');
var r = App.Parser.parse(SAMPLE);

test('抓到日期', function () {
  assert.strictEqual(r.dateLabel, '7/28 (二)');
});

test('剛好六個單位（"All" 與標題行不會被誤判成連隊）', function () {
  assert.strictEqual(r.entries.length, 6, '實際解析到 ' + r.entries.length + ' 個：' +
    r.entries.map(function (e) { return e.name; }).join(','));
});

test('八仙管理員 只有中餐 3', function () {
  var m = byUnit(r, 'admin');
  assert.deepStrictEqual(m.lunch, { meat: 3, veg: 0 });
  assert.strictEqual(m.breakfast, undefined);
  assert.strictEqual(m.dinner, undefined);
});

test('戰 早餐留空視為 0、晚餐 63+1素', function () {
  var m = byUnit(r, 'zhan');
  assert.deepStrictEqual(m.breakfast, { meat: 0, veg: 0 });
  assert.deepStrictEqual(m.lunch, { meat: 15, veg: 0 });
  assert.deepStrictEqual(m.dinner, { meat: 63, veg: 1 });
});

test('火 早10 中30 晚20', function () {
  var m = byUnit(r, 'huo');
  assert.deepStrictEqual(m.breakfast, { meat: 10, veg: 0 });
  assert.deepStrictEqual(m.lunch, { meat: 30, veg: 0 });
  assert.deepStrictEqual(m.dinner, { meat: 20, veg: 0 });
});

test('注音「ㄧ連」也能對應到一連', function () {
  var m = byUnit(r, 'co1');
  assert.deepStrictEqual(m.breakfast, { meat: 13, veg: 0 });
  assert.deepStrictEqual(m.lunch, { meat: 26, veg: 0 });
  assert.deepStrictEqual(m.dinner, { meat: 38, veg: 0 });
});

test('二連 早餐空白 → 0', function () {
  var m = byUnit(r, 'co2');
  assert.deepStrictEqual(m.breakfast, { meat: 0, veg: 0 });
  assert.deepStrictEqual(m.dinner, { meat: 31, veg: 0 });
});

test('三連 數字間有空白也能解析', function () {
  var m = byUnit(r, 'co3');
  assert.deepStrictEqual(m.breakfast, { meat: 8, veg: 0 });
  assert.deepStrictEqual(m.lunch, { meat: 8, veg: 0 });
  assert.deepStrictEqual(m.dinner, { meat: 25, veg: 0 });
});

test('總數與總箱數', function () {
  var total = 0, boxes = 0;
  r.entries.forEach(function (e) {
    ['breakfast', 'lunch', 'dinner'].forEach(function (k) {
      if (!e.meals[k]) return;
      var n = e.meals[k].meat + e.meals[k].veg;
      total += n;
      boxes += Math.ceil(n / 24);
    });
  });
  // 3 +15+64 +10+30+20 +13+26+38 +15+31 +8+8+25 = 306
  assert.strictEqual(total, 306);
  // 1 +1+3 +1+2+1 +1+2+2 +1+2 +1+1+2 = 21
  assert.strictEqual(boxes, 21);
});

console.log('\n格式變體：');

test('全形括號素食 15（2素）', function () {
  var x = App.Parser.parse('火\n中：15（2素）');
  assert.deepStrictEqual(byUnit(x, 'huo').lunch, { meat: 15, veg: 2 });
});

test('只寫「素」當作 1 個', function () {
  var x = App.Parser.parse('火\n晚：20+素');
  assert.deepStrictEqual(byUnit(x, 'huo').dinner, { meat: 20, veg: 1 });
});

test('半形冒號與空白', function () {
  var x = App.Parser.parse('三連\n早: 8  中: 12  晚: 0');
  var m = byUnit(x, 'co3');
  assert.deepStrictEqual(m.breakfast, { meat: 8, veg: 0 });
  assert.deepStrictEqual(m.lunch, { meat: 12, veg: 0 });
});

test('午餐寫「午」也能解析', function () {
  var x = App.Parser.parse('火\n早：10午：30晚：20');
  var m = byUnit(x, 'huo');
  assert.deepStrictEqual(m.breakfast, { meat: 10, veg: 0 });
  assert.deepStrictEqual(m.lunch, { meat: 30, veg: 0 });
  assert.deepStrictEqual(m.dinner, { meat: 20, veg: 0 });
});

test('午餐寫「中午」不會重複計算', function () {
  var x = App.Parser.parse('火\n中午：30');
  assert.deepStrictEqual(byUnit(x, 'huo').lunch, { meat: 30, veg: 0 });
});

test('「下午」也吃得下', function () {
  var x = App.Parser.parse('火\n下午：25');
  assert.deepStrictEqual(byUnit(x, 'huo').lunch, { meat: 25, veg: 0 });
});

test('午餐帶素食', function () {
  var x = App.Parser.parse('戰\n午：15+2素');
  assert.deepStrictEqual(byUnit(x, 'zhan').lunch, { meat: 15, veg: 2 });
});

test('沒看過的單位會被保留成自訂單位', function () {
  var x = App.Parser.parse('兵器連\n早：5晚：7');
  assert.strictEqual(x.entries.length, 1);
  assert.strictEqual(x.entries[0].name, '兵器連');
  assert.ok(x.entries[0].isCustom);
});

test('空訊息會給警告', function () {
  var x = App.Parser.parse('');
  assert.strictEqual(x.entries.length, 0);
  assert.ok(x.warnings.length > 0);
});

console.log('\n' + pass + ' 個測試通過' + (process.exitCode ? '，有失敗項目' : ''));
