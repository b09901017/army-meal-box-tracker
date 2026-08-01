/* ==========================================================================
   units.js — 常數、餐別、單位（連隊）定義與別名表
   全域命名空間：App（不使用 ES modules，確保 file:// 直接開也能跑）
   ========================================================================== */
window.App = window.App || {};

/* 保麗龍箱規格：一箱 4 層，一層 6 個，共 24 個 */
App.Const = {
  PER_LAYER: 6,
  LAYERS: 4,
  PER_BOX: 24,
};

/* 餐別。順序即畫面上的分頁順序，也是「打完換下一餐」的順序 */
App.Meals = [
  { id: 'breakfast', label: '早餐', short: '早', icon: '🌅' },
  { id: 'lunch',     label: '午餐', short: '中', icon: '🍚' },
  { id: 'dinner',    label: '晚餐', short: '晚', icon: '🌙' },
];

App.mealById = function (id) {
  return App.Meals.find(function (m) { return m.id === id; }) || App.Meals[0];
};

/* 預設單位。order 即打飯順序（照班長訊息的排列） */
App.DefaultUnits = [
  { id: 'admin', name: '八仙管理員', short: '管' },
  { id: 'zhan',  name: '戰支連',    short: '戰' },
  { id: 'huo',   name: '火力連',    short: '火' },
  { id: 'co1',   name: '一連',      short: '一' },
  { id: 'co2',   name: '二連',      short: '二' },
  { id: 'co3',   name: '三連',      short: '三' },
];

/* 別名表：解析班長訊息時用。比對前會先做 normalize（去空白、全形轉半形、ㄧ→一） */
App.UnitAliases = {
  admin: ['八仙管理員', '管理員', '八仙', '管'],
  zhan:  ['戰', '戰支', '戰支連', '戰隊', '戰連', '戰情', '戰情連'],
  huo:   ['火', '火力', '火力連', '火連', '火隊'],
  co1:   ['一連', '1連', '壹連', '一', '第一連'],
  co2:   ['二連', '2連', '貳連', '二', '第二連'],
  co3:   ['三連', '3連', '參連', '叁連', '三', '第三連'],
};
