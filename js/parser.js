/* ==========================================================================
   parser.js — 把班長傳的純文字訊息解析成結構化資料
   純函式，不碰 state、不碰 DOM，方便單獨測試。
   ========================================================================== */
window.App = window.App || {};

App.Parser = (function () {
  'use strict';

  // 午餐「中」「午」都認。寫成「中午：15」時兩個標記都會命中，
  // 但同一餐的數字是相加的（「中」那段沒有數字＝0），所以結果仍是 15。
  var MEAL_MARK = { '早': 'breakfast', '中': 'lunch', '午': 'lunch', '晚': 'dinner' };
  var MEAL_RE = /[早中午晚]/;

  /* 全形轉半形、注音「ㄧ」轉「一」、去空白與雜點符號。
     全形轉半形順便把「：」→「:」、「＋」→「+」、「（）」→「()」 */
  function normalize(s) {
    return String(s || '')
      .replace(/[！-～]/g, function (c) {
        return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
      })
      .replace(/　/g, ' ')
      .replace(/ㄧ/g, '一')   // ㄧ(注音) → 一
      .replace(/[·．、]/g, '')
      .replace(/\s+/g, '');
  }

  /* 這一行看起來像不像「單位標題」？
     條件：正規化後非空、不含餐別字、不含數字、長度不超過 10 */
  function looksLikeHeader(norm) {
    if (!norm) return false;
    if (MEAL_RE.test(norm)) return false;
    if (/\d/.test(norm)) return false;
    return norm.length <= 10;
  }

  /* 用別名表找出對應的預設單位 id，找不到回傳 null */
  function matchUnitId(norm) {
    var aliases = App.UnitAliases;
    for (var id in aliases) {
      if (!Object.prototype.hasOwnProperty.call(aliases, id)) continue;
      if (aliases[id].indexOf(norm) !== -1) return id;
    }
    return null;
  }

  /* 從一段「某一餐的數字區段」抽出 葷食數 / 素食數
     例：":63+1素" → {meat:63, veg:1}
         ":20"     → {meat:20, veg:0}
         ""        → {meat:0,  veg:0}
         ":15(2素)"→ {meat:15, veg:2} */
  function parseSegment(seg) {
    var veg = 0;
    var rest = seg;

    var m = seg.match(/(\d+)\s*素/);           // 「1素」
    if (m) {
      veg = parseInt(m[1], 10);
      rest = seg.replace(m[0], '');
    } else {
      m = seg.match(/素\s*(\d+)/);             // 「素1」
      if (m) {
        veg = parseInt(m[1], 10);
        rest = seg.replace(m[0], '');
      } else if (/素/.test(seg)) {             // 只寫「素」→ 當作 1 個
        veg = 1;
        rest = seg.replace(/素/, '');
      }
    }

    var meatMatch = rest.match(/\d+/);
    var meat = meatMatch ? parseInt(meatMatch[0], 10) : 0;
    return { meat: meat, veg: veg };
  }

  /* 把一行（或多行合併）的資料文字切成各餐區段後解析。
     "早:中:15晚:63+1素" → breakfast 0 / lunch 15 / dinner 63+1素 */
  function parseMealLine(norm, target) {
    var marks = [];
    for (var i = 0; i < norm.length; i++) {
      if (MEAL_MARK[norm[i]]) marks.push({ meal: MEAL_MARK[norm[i]], at: i });
    }
    for (var j = 0; j < marks.length; j++) {
      var start = marks[j].at + 1;
      var end = (j + 1 < marks.length) ? marks[j + 1].at : norm.length;
      var parsed = parseSegment(norm.slice(start, end));
      var meal = marks[j].meal;
      // 同一餐重複出現就相加（少見，但不要默默覆蓋）
      target[meal] = {
        meat: (target[meal] ? target[meal].meat : 0) + parsed.meat,
        veg:  (target[meal] ? target[meal].veg  : 0) + parsed.veg,
      };
    }
    return marks.length > 0;
  }

  /* 抓日期標籤：「（7/28）禮拜二」→ "7/28 (二)" */
  function parseDateLabel(text) {
    var norm = String(text || '').replace(/[！-～]/g, function (c) {
      return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
    });
    var d = norm.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
    var w = norm.match(/(?:禮拜|星期|週)\s*([一二三四五六日天])/);
    if (!d && !w) return '';
    var out = d ? (parseInt(d[1], 10) + '/' + parseInt(d[2], 10)) : '';
    if (w) out += (out ? ' ' : '') + '(' + (w[1] === '天' ? '日' : w[1]) + ')';
    return out;
  }

  /* 主要進入點。
     回傳 { dateLabel, entries: [{unitId, name, isCustom, meals:{...}}], warnings: [] }
     entries 只包含「真的有餐點資料」的單位，避免把 "All"、標題行誤判成連隊。 */
  function parse(text) {
    var lines = String(text || '').split(/\r?\n/);
    var entries = [];
    var warnings = [];
    var current = null;
    var customSeq = 0;

    function flush() {
      if (!current) return;
      var hasData = Object.keys(current.meals).length > 0;
      if (hasData) {
        entries.push(current);
      } else if (current.isCustom) {
        // 沒有任何餐點資料的未知標題（例如 "All"）→ 忽略，不吵使用者
      }
      current = null;
    }

    for (var i = 0; i < lines.length; i++) {
      var norm = normalize(lines[i]);
      if (!norm) continue;

      if (looksLikeHeader(norm)) {
        flush();
        var id = matchUnitId(norm);
        current = {
          unitId: id || ('custom' + (++customSeq)),
          name: id ? unitDefaultName(id) : norm,
          isCustom: !id,
          meals: {},
        };
        continue;
      }

      if (MEAL_RE.test(norm)) {
        if (!current) {
          // 出現數字但還沒看到單位名稱 → 建一個暫時單位，讓使用者自己改名
          current = { unitId: 'custom' + (++customSeq), name: '未命名單位', isCustom: true, meals: {} };
          warnings.push('有一段餐點數字找不到對應的單位名稱，已放進「未命名單位」，請確認。');
        }
        parseMealLine(norm, current.meals);
      }
    }
    flush();

    entries.forEach(function (e) {
      if (e.isCustom) warnings.push('訊息裡出現沒看過的單位「' + e.name + '」，已幫你新增，請確認名稱。');
    });

    if (entries.length === 0) {
      warnings.push('沒有解析到任何便當數量，請確認訊息格式，或直接用下面的表格手動輸入。');
    }

    return { dateLabel: parseDateLabel(text), entries: entries, warnings: warnings };
  }

  function unitDefaultName(id) {
    var u = App.DefaultUnits.find(function (x) { return x.id === id; });
    return u ? u.name : id;
  }

  return {
    parse: parse,
    // 匯出內部函式供測試使用
    _normalize: normalize,
    _parseSegment: parseSegment,
    _parseDateLabel: parseDateLabel,
  };
})();
