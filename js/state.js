/* ==========================================================================
   state.js — 應用狀態、localStorage 存讀、以及所有裝箱計算
   規則：不可混裝，每個連隊獨立起箱，最後一箱可以不滿。
   ========================================================================== */
window.App = window.App || {};

App.State = (function () {
  'use strict';

  var KEY = 'amb-tracker-v1';
  var PER_BOX = App.Const.PER_BOX;
  var PER_LAYER = App.Const.PER_LAYER;

  var state = null;
  var listeners = [];

  /* ---------- 建立 / 讀取 / 儲存 ---------- */

  function blankPlan() {
    var p = {};
    App.Meals.forEach(function (m) { p[m.id] = {}; });
    return p;
  }

  function defaultState() {
    return {
      version: 1,
      dateLabel: '',
      configured: false,
      activeMeal: 'breakfast',
      activeUnitId: null,
      // drinkPerCase：一箱飲料幾罐，通常 24，偶爾 18
      settings: { sound: true, haptic: true, theme: 'auto', vegPosition: 'last', drinkPerCase: 24 },
      units: App.DefaultUnits.map(function (u, i) {
        return { id: u.id, name: u.name, short: u.short, order: i };
      }),
      plan: blankPlan(),
      progress: blankPlan(),
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved && saved.version === 1) {
          state = Object.assign(defaultState(), saved);
          state.settings = Object.assign(defaultState().settings, saved.settings || {});
          return state;
        }
      }
    } catch (e) {
      console.warn('讀取存檔失敗，改用全新狀態', e);
    }
    state = defaultState();
    return state;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('存檔失敗（可能是無痕模式或容量已滿）', e);
    }
  }

  function get() { return state; }

  function subscribe(fn) { listeners.push(fn); }
  function emit(events) {
    save();
    listeners.forEach(function (fn) { fn(events || []); });
  }

  /* ---------- 設定 ---------- */

  function setSetting(key, value) {
    state.settings[key] = value;
    emit();
  }

  /* ---------- 便當數（plan） ---------- */

  /** 從解析結果套用到 state。會建立訊息中出現的自訂單位。
      解析代表「這是今天的完整訊息」，所以先清空舊的需求量，
      沒出現在訊息裡的單位就是今天不用打。已打的進度會保留但夾到新的上限。 */
  function applyEntries(entries, dateLabel) {
    // 貼上的是別天的訊息 → 昨天的進度要整個歸零，不然會接著昨天的數字繼續打
    var dateChanged = !!dateLabel && !!state.dateLabel && dateLabel !== state.dateLabel;
    var clearedCount = 0;
    if (dateChanged) {
      clearedCount = dayStats().packed;
      state.progress = blankPlan();
    }

    if (dateLabel) state.dateLabel = dateLabel;
    state.plan = blankPlan();
    entries.forEach(function (e) {
      // 先比 id，再比名稱：避免同一個單位因為 id 規則調整而被建成兩筆
      var unit = state.units.find(function (u) { return u.id === e.unitId; }) ||
                 state.units.find(function (u) { return u.name === e.name; });
      if (!unit) {
        unit = { id: e.unitId, name: e.name, short: e.name.slice(0, 1), order: state.units.length };
        state.units.push(unit);
      }
      App.Meals.forEach(function (m) {
        var v = e.meals[m.id];
        if (v) state.plan[m.id][unit.id] = { meat: v.meat, veg: v.veg };
      });
    });
    clampProgress();
    ensureActiveUnit();
    emit();
    return { dateChanged: dateChanged, clearedCount: clearedCount };
  }

  /** 需求量變動後，已打數不可以超過需求量 */
  function clampProgress() {
    App.Meals.forEach(function (m) {
      Object.keys(state.progress[m.id]).forEach(function (unitId) {
        var total = planOf(m.id, unitId).total;
        if (total === 0) delete state.progress[m.id][unitId];
        else if (state.progress[m.id][unitId] > total) state.progress[m.id][unitId] = total;
      });
    });
  }

  function setPlan(mealId, unitId, meat, veg, quiet) {
    meat = Math.max(0, Math.floor(meat || 0));
    veg = Math.max(0, Math.floor(veg || 0));
    if (meat === 0 && veg === 0) {
      delete state.plan[mealId][unitId];
    } else {
      state.plan[mealId][unitId] = { meat: meat, veg: veg };
    }
    var total = meat + veg;
    if ((state.progress[mealId][unitId] || 0) > total) state.progress[mealId][unitId] = total;
    if (quiet) save(); else emit();
  }

  function addUnit(name) {
    var id = 'custom' + Date.now().toString(36);
    state.units.push({ id: id, name: name || '新單位', short: (name || '新')[0], order: state.units.length });
    emit();
    return id;
  }

  function renameUnit(unitId, name, quiet) {
    var u = state.units.find(function (x) { return x.id === unitId; });
    if (!u) return;
    u.name = name;
    u.short = name.slice(0, 1);
    if (quiet) save(); else emit();
  }

  function removeUnit(unitId) {
    state.units = state.units.filter(function (u) { return u.id !== unitId; });
    App.Meals.forEach(function (m) {
      delete state.plan[m.id][unitId];
      delete state.progress[m.id][unitId];
    });
    if (state.activeUnitId === unitId) state.activeUnitId = null;
    emit();
  }

  function markConfigured() {
    state.configured = true;
    // 自動跳到第一個還有便當要打的餐別
    var meal = App.Meals.find(function (m) { return mealStats(m.id).total > 0; });
    if (meal) state.activeMeal = meal.id;
    ensureActiveUnit();
    emit();
  }

  /* ---------- 裝箱計算（純衍生，不存進 state） ---------- */

  function planOf(mealId, unitId) {
    var p = state.plan[mealId] && state.plan[mealId][unitId];
    var meat = p ? p.meat : 0;
    var veg = p ? p.veg : 0;
    return { meat: meat, veg: veg, total: meat + veg };
  }

  function packedOf(mealId, unitId) {
    return (state.progress[mealId] && state.progress[mealId][unitId]) || 0;
  }

  function boxesNeeded(total) {
    return Math.ceil(total / PER_BOX);
  }

  /** 某個連隊在某一餐的完整狀態 */
  function unitStats(mealId, unitId) {
    var p = planOf(mealId, unitId);
    var packed = Math.min(packedOf(mealId, unitId), p.total);
    var done = p.total > 0 && packed >= p.total;
    // 已裝滿的箱子不算「目前這箱」，所以完成時停在最後一箱
    var boxIndex = done ? Math.max(0, boxesNeeded(p.total) - 1) : Math.floor(packed / PER_BOX);
    var packedInBox = packed - boxIndex * PER_BOX;
    var capacity = Math.min(PER_BOX, p.total - boxIndex * PER_BOX);
    return {
      unitId: unitId,
      mealId: mealId,
      meat: p.meat,
      veg: p.veg,
      total: p.total,
      packed: packed,
      remaining: Math.max(0, p.total - packed),
      boxesNeeded: boxesNeeded(p.total),
      // 打完時最後一箱就算沒滿也已經封箱，不能用 floor(packed/24)
      boxesSealed: done ? boxesNeeded(p.total) : Math.floor(packed / PER_BOX),
      boxIndex: boxIndex,          // 0-based，目前正在裝的箱子
      packedInBox: packedInBox,    // 這一箱已經放幾個
      boxCapacity: Math.max(0, capacity),
      layer: Math.floor(packedInBox / PER_LAYER),   // 0-based，目前正在裝的層
      slot: packedInBox % PER_LAYER,
      done: done,
    };
  }

  /** 這一餐有便當要打的單位（依 order 排序），沒有的直接不出現在流程裡 */
  function unitsInMeal(mealId) {
    return state.units
      .slice()
      .sort(function (a, b) { return a.order - b.order; })
      .filter(function (u) { return planOf(mealId, u.id).total > 0; });
  }

  function mealStats(mealId) {
    var total = 0, packed = 0, boxes = 0, sealed = 0, meat = 0, veg = 0, doneUnits = 0;
    var units = unitsInMeal(mealId);
    units.forEach(function (u) {
      var s = unitStats(mealId, u.id);
      total += s.total;
      packed += s.packed;
      boxes += s.boxesNeeded;
      sealed += s.boxesSealed;
      meat += s.meat;
      veg += s.veg;
      if (s.done) doneUnits++;
    });
    return {
      mealId: mealId,
      total: total,
      meat: meat,
      veg: veg,
      packed: packed,
      remaining: total - packed,
      boxes: boxes,
      boxesSealed: sealed,
      unitCount: units.length,
      doneUnits: doneUnits,
      done: total > 0 && packed >= total,
      ratio: total > 0 ? packed / total : 0,
    };
  }

  function dayStats() {
    var total = 0, packed = 0, boxes = 0, sealed = 0, veg = 0;
    App.Meals.forEach(function (m) {
      var s = mealStats(m.id);
      total += s.total; packed += s.packed; boxes += s.boxes; sealed += s.boxesSealed; veg += s.veg;
    });
    return { total: total, packed: packed, remaining: total - packed, boxes: boxes,
             boxesSealed: sealed, veg: veg,
             ratio: total > 0 ? packed / total : 0, done: total > 0 && packed >= total };
  }

  /** 第 index 個（0-based）便當是不是素食？ */
  function isVegIndex(index, total, veg) {
    if (veg <= 0) return false;
    return state.settings.vegPosition === 'first'
      ? index < veg
      : index >= total - veg;
  }

  /* ---------- 目前作業對象 ---------- */

  function ensureActiveUnit() {
    var units = unitsInMeal(state.activeMeal);
    if (units.length === 0) { state.activeUnitId = null; return; }
    var cur = state.activeUnitId && units.find(function (u) { return u.id === state.activeUnitId; });
    if (cur && !unitStats(state.activeMeal, cur.id).done) return;
    var next = units.find(function (u) { return !unitStats(state.activeMeal, u.id).done; });
    state.activeUnitId = (next || cur || units[0]).id;
  }

  function nextUnpackedUnit(mealId, afterUnitId) {
    var units = unitsInMeal(mealId);
    var idx = units.findIndex(function (u) { return u.id === afterUnitId; });
    for (var i = idx + 1; i < units.length; i++) {
      if (!unitStats(mealId, units[i].id).done) return units[i];
    }
    // 後面沒有了就從頭找漏掉的
    for (var j = 0; j < units.length; j++) {
      if (units[j].id !== afterUnitId && !unitStats(mealId, units[j].id).done) return units[j];
    }
    return null;
  }

  function setActiveMeal(mealId) {
    state.activeMeal = mealId;
    state.activeUnitId = null;
    ensureActiveUnit();
    emit();
  }

  function setActiveUnit(unitId) {
    state.activeUnitId = unitId;
    emit();
  }

  /* ---------- 核心動作：放入 / 收回一個便當 ---------- */

  /**
   * @param {number} delta +1 或 -1
   * @returns {Array} 事件清單，交給 app.js 決定要播什麼提醒
   */
  function pack(delta) {
    var mealId = state.activeMeal;
    var unitId = state.activeUnitId;
    if (!unitId) return [];

    var before = unitStats(mealId, unitId);
    var next = before.packed + delta;
    if (next < 0 || next > before.total) return [];

    state.progress[mealId][unitId] = next;
    var after = unitStats(mealId, unitId);
    var events = [];

    if (delta > 0) {
      var isBoxFull = next % PER_BOX === 0;
      var isUnitDone = next >= before.total;

      if (isUnitDone) {
        var nu = nextUnpackedUnit(mealId, unitId);
        events.push({
          type: 'unitDone',
          unitId: unitId,
          boxNo: after.boxesNeeded,
          leftover: before.total % PER_BOX,
          nextUnitId: nu ? nu.id : null,
        });
        if (nu) state.activeUnitId = nu.id;
        if (mealStats(mealId).done) events.push({ type: 'mealDone', mealId: mealId });
      } else if (isBoxFull) {
        events.push({ type: 'boxSealed', unitId: unitId, boxNo: next / PER_BOX, boxesNeeded: after.boxesNeeded });
      } else if (next % PER_LAYER === 0) {
        events.push({ type: 'layerDone', layerNo: (next % PER_BOX) / PER_LAYER });
      }

      // 下一個要放素食嗎？
      if (!isUnitDone && isVegIndex(next, before.total, before.veg)) {
        events.push({ type: 'vegNext' });
      }
    }

    emit(events);
    return events;
  }

  /** 直接把進度設到某一格（點格子修正用） */
  function setPacked(mealId, unitId, value) {
    var total = planOf(mealId, unitId).total;
    state.progress[mealId][unitId] = Math.max(0, Math.min(total, Math.floor(value)));
    ensureActiveUnit();
    emit();
  }

  /* ---------- 重設 ---------- */

  function resetMealProgress(mealId) {
    state.progress[mealId] = {};
    ensureActiveUnit();
    emit();
  }

  function resetAllProgress() {
    state.progress = blankPlan();
    ensureActiveUnit();
    emit();
  }

  function resetEverything() {
    var settings = state.settings;
    state = defaultState();
    state.settings = settings;
    emit();
  }

  return {
    load: load, save: save, get: get, subscribe: subscribe, emit: emit,
    setSetting: setSetting,
    applyEntries: applyEntries, setPlan: setPlan, planOf: planOf,
    addUnit: addUnit, renameUnit: renameUnit, removeUnit: removeUnit,
    markConfigured: markConfigured,
    unitStats: unitStats, mealStats: mealStats, dayStats: dayStats,
    unitsInMeal: unitsInMeal, boxesNeeded: boxesNeeded, isVegIndex: isVegIndex,
    ensureActiveUnit: ensureActiveUnit, setActiveMeal: setActiveMeal, setActiveUnit: setActiveUnit,
    pack: pack, setPacked: setPacked,
    resetMealProgress: resetMealProgress, resetAllProgress: resetAllProgress, resetEverything: resetEverything,
  };
})();
