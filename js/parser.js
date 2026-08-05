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

  /* 去掉括號註記。「五營（另外用沒貼連隊的保麗龍盒裝）」→「五營」
     只用在判斷／命名標題，實際抓數字時仍用原字串。 */
  function stripParens(s) {
    return s.replace(/\([^)]*\)/g, '').replace(/[【〔][^】〕]*[】〕]/g, '');
  }

  /* 這一行看起來像不像「單位標題」？
     條件：去掉括號註記後非空、不含餐別字、不含數字、長度不超過 10 */
  function looksLikeHeader(norm) {
    if (!norm) return false;
    if (MEAL_RE.test(norm)) return false;
    if (/\d/.test(norm)) return false;
    return norm.length <= 10;
  }

  /* 「總數：130+1素」這種整天一個數字的寫法。教召公版用的就是這種。 */
  var TOTAL_RE = /(?:總數|總計|合計|總共|總人數)\s*:?\s*(.*)$/;

  /* 整行只有餐別名稱（沒有數字、沒有冒號）→ 這是「餐別區段標題」，
     底下所有單位都算這一餐。駐地公版用的就是這種寫法。 */
  var MEAL_SECTION = {
    '早餐': 'breakfast', '早上': 'breakfast', '早': 'breakfast',
    '午餐': 'lunch', '中餐': 'lunch', '中午': 'lunch', '下午': 'lunch', '中': 'lunch', '午': 'lunch',
    '晚餐': 'dinner', '晚上': 'dinner', '晚': 'dinner',
  };

  /* 把「八仙130+1素」拆成 { lead: '八仙', rest: '130+1素' }。
     lead 可能是單位名（二營47+1素），也可能是駐地（八仙130+1素）。 */
  function splitLeadNumber(norm) {
    var i = norm.search(/\d/);
    if (i < 0) return null;
    return {
      lead: stripParens(norm.slice(0, i)).replace(/[:、,。.]/g, ''),
      rest: norm.slice(i),
    };
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
      // 「總數」補進沒有明確寫早／中／晚的餐別（教召公版三餐同一個數字）
      if (current.total) {
        App.Meals.forEach(function (m) {
          if (!current.meals[m.id]) {
            current.meals[m.id] = { meat: current.total.meat, veg: current.total.veg };
          }
        });
      }
      if (Object.keys(current.meals).length > 0) {
        entries.push(current);
      } else if (current.sawNumber) {
        warnings.push('「' + current.name + '」底下有數字，但找不到「總數」或早／中／晚，已略過。');
      }
      // 沒有任何數字的未知標題（例如 "All"）→ 忽略，不吵使用者
      current = null;
    }

    function startUnit(name) {
      var id = matchUnitId(name);
      return {
        // 自訂單位用名稱當 id，這樣同一個單位在不同天解析會對到同一筆
        unitId: id || ('u_' + name),
        name: id ? unitDefaultName(id) : name,
        isCustom: !id,
        meals: {},
        total: null,
        sawNumber: false,
      };
    }

    function ensureUnit() {
      if (current) return;
      current = startUnit('未命名單位' + (++customSeq));
      warnings.push('有一段餐點數字找不到對應的單位名稱，已放進「' + current.name + '」，請確認。');
    }

    var sectionMeal = null;   // 目前所在的餐別區段（駐地公版用）

    for (var i = 0; i < lines.length; i++) {
      var norm = normalize(lines[i]);
      if (!norm) continue;
      var head = stripParens(norm);

      // 1) 餐別區段標題：整行就是「早餐」「午餐」「晚餐」
      if (MEAL_SECTION[head]) {
        flush();
        sectionMeal = MEAL_SECTION[head];
        continue;
      }

      // 2) 單位標題：沒有數字、沒有餐別字
      if (looksLikeHeader(head)) {
        flush();
        current = startUnit(head);
        continue;
      }

      var isMeal = MEAL_RE.test(norm);
      var totalMatch = isMeal ? null : norm.match(TOTAL_RE);

      // 3) 行內有早/中/晚標記（原本的班長公版），或 4) 總數（教召公版）
      if (isMeal || totalMatch) {
        ensureUnit();
        current.sawNumber = true;
        if (isMeal) parseMealLine(norm, current.meals);
        else current.total = parseSegment(totalMatch[1]);
        continue;
      }

      // 5) 餐別區段內的數量行：「駐地 + 數量」或「單位名 + 數量」
      var split = sectionMeal ? splitLeadNumber(norm) : null;
      if (split) {
        var leadId = split.lead && matchUnitId(split.lead);
        if (leadId) {
          // 「二營47+1素」單位名與數量同一行
          flush();
          current = startUnit(split.lead);
        }
        // 否則 lead 是駐地（八仙／污水廠⋯⋯），數量算給上一行那個單位
        ensureUnit();
        current.sawNumber = true;
        current.meals[sectionMeal] = parseSegment(split.rest);
        continue;
      }

      // 建置／召員／安管之類的細項：記得看過數字，但不採用（只認總數）
      if (current && /\d/.test(norm)) current.sawNumber = true;
    }
    flush();

    // 同一個單位在三個餐別區段各出現一次 → 合併成一筆
    var merged = [];
    var byId = {};
    entries.forEach(function (e) {
      if (byId[e.unitId]) {
        Object.keys(e.meals).forEach(function (k) { byId[e.unitId].meals[k] = e.meals[k]; });
      } else {
        byId[e.unitId] = e;
        merged.push(e);
      }
    });
    entries = merged;

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
