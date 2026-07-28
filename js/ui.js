/* ==========================================================================
   ui.js — 所有畫面繪製、浮層、提示
   ========================================================================== */
window.App = window.App || {};

App.UI = (function () {
  'use strict';

  var S = App.State;
  var $ = function (sel) { return document.querySelector(sel); };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function unitName(id) {
    var u = S.get().units.find(function (x) { return x.id === id; });
    return u ? u.name : id;
  }

  /** 把「已裝 38 個」講成人話：「1 箱又 14 個」 */
  function boxPhrase(n) {
    var b = Math.floor(n / App.Const.PER_BOX);
    var r = n % App.Const.PER_BOX;
    if (b === 0) return r + ' 個';
    if (r === 0) return b + ' 箱';
    return b + ' 箱又 ' + r + ' 個';
  }

  /* ---------- 畫面切換 ---------- */

  var currentScreen = 'setup';

  function setScreen(name) {
    currentScreen = name;
    $('#screen-setup').classList.toggle('is-active', name === 'setup');
    $('#screen-work').classList.toggle('is-active', name === 'work');
    $('#counter-bar').hidden = name !== 'work';
    document.body.classList.toggle('on-work', name === 'work');
    window.scrollTo({ top: 0, behavior: 'auto' });
    render();
  }

  function getScreen() { return currentScreen; }

  /* ---------- 設定畫面 ---------- */

  function renderPlanTable() {
    var st = S.get();
    var html = st.units
      .slice().sort(function (a, b) { return a.order - b.order; })
      .map(function (u) {
        var rows = App.Meals.map(function (m) {
          var p = S.planOf(m.id, u.id);
          return '' +
            '<div class="meal-row">' +
              '<span class="meal-row-label">' + m.short + '</span>' +
              '<span class="field"><span class="field-tag">🍱</span>' +
                '<input type="number" inputmode="numeric" min="0" value="' + p.meat + '" ' +
                  'data-plan="meat" data-meal="' + m.id + '" data-unit="' + u.id + '" aria-label="' + esc(u.name) + m.label + '便當數"></span>' +
              '<span class="field veg"><span class="field-tag">🥬</span>' +
                '<input type="number" inputmode="numeric" min="0" value="' + p.veg + '" ' +
                  'data-plan="veg" data-meal="' + m.id + '" data-unit="' + u.id + '" aria-label="' + esc(u.name) + m.label + '素食數"></span>' +
              '<span class="meal-row-sum">' + (p.total ? p.total + '個<br>' + S.boxesNeeded(p.total) + '箱' : '—') + '</span>' +
            '</div>';
        }).join('');

        var dayTotal = App.Meals.reduce(function (a, m) { return a + S.planOf(m.id, u.id).total; }, 0);
        return '' +
          '<div class="unit-block">' +
            '<div class="unit-block-head">' +
              '<input type="text" value="' + esc(u.name) + '" data-rename="' + u.id + '" aria-label="單位名稱">' +
              '<span class="unit-total">共 ' + dayTotal + ' 個</span>' +
              '<button class="mini-btn" type="button" data-remove="' + u.id + '" aria-label="刪除 ' + esc(u.name) + '">✕</button>' +
            '</div>' + rows +
          '</div>';
      }).join('');

    $('#plan-table').innerHTML = html || '<p class="hint">還沒有任何單位，按下面的按鈕新增。</p>';
  }

  function renderSummary() {
    var day = S.dayStats();
    var perMeal = App.Meals.map(function (m) {
      var s = S.mealStats(m.id);
      return '<div class="sum-list-row"><b>' + m.label + '</b><span>' +
        (s.total ? s.total + ' 個 · ' + s.boxes + ' 箱' : '不用打') + '</span></div>';
    }).join('');

    var perUnit = S.get().units
      .slice().sort(function (a, b) { return a.order - b.order; })
      .map(function (u) {
        var parts = App.Meals.map(function (m) {
          var p = S.planOf(m.id, u.id);
          return p.total ? m.short + ' ' + p.total + (p.veg ? '(含素' + p.veg + ')' : '') : null;
        }).filter(Boolean);
        if (!parts.length) return '';
        var boxes = App.Meals.reduce(function (a, m) { return a + S.boxesNeeded(S.planOf(m.id, u.id).total); }, 0);
        return '<div class="sum-list-row"><b>' + esc(u.name) + '</b><span>' + parts.join('　') + ' · 共 ' + boxes + ' 箱</span></div>';
      }).join('');

    $('#plan-summary').innerHTML =
      '<div class="sum-grid">' +
        '<div class="sum-cell"><span class="stat-num">' + day.total + '</span><small>便當總數</small></div>' +
        '<div class="sum-cell"><span class="stat-num">' + day.boxes + '</span><small>保麗龍箱</small></div>' +
        '<div class="sum-cell"><span class="stat-num">' + S.get().units.filter(function (u) {
          return App.Meals.some(function (m) { return S.planOf(m.id, u.id).total > 0; });
        }).length + '</span><small>參與單位</small></div>' +
      '</div>' +
      '<div class="sum-list">' + perMeal + perUnit + '</div>';

    $('#btn-start').disabled = day.total === 0;
  }

  function renderSetup() {
    renderPlanTable();
    renderSummary();
  }

  function showWarnings(list) {
    var el = $('#parse-warnings');
    if (!list || !list.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = '<ul>' + list.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>';
  }

  /* ---------- 作業畫面 ---------- */

  function renderMealTabs() {
    var st = S.get();
    $('#meal-tabs').innerHTML = App.Meals.map(function (m) {
      var s = S.mealStats(m.id);
      var pct = Math.round(s.ratio * 100);
      var cls = 'meal-tab' + (s.total === 0 ? ' is-empty' : '');
      var ring = s.done
        ? '<span class="ring is-done" style="--p:100"><span class="ring-check">✓</span></span>'
        : '<span class="ring" style="--p:' + pct + '"></span>';
      return '<button type="button" class="' + cls + '" role="tab" data-meal="' + m.id + '" ' +
        'aria-selected="' + (st.activeMeal === m.id) + '">' + ring +
        '<span><span class="meal-tab-label">' + m.label + '</span>' +
        '<span class="meal-tab-sub">' + (s.total ? s.packed + '/' + s.total : '免打') + '</span></span></button>';
    }).join('');
  }

  function renderHero() {
    var st = S.get();
    var s = S.mealStats(st.activeMeal);
    var meal = App.mealById(st.activeMeal);
    var hero = $('#hero');
    hero.classList.toggle('is-done', s.done);

    if (s.total === 0) {
      hero.innerHTML = '<div class="hero-label">' + meal.label + '</div>' +
        '<div class="hero-num">0<small>個</small></div>' +
        '<div class="hero-sub">這一餐沒有便當要打，切到其他餐吧。</div>';
      return;
    }

    var day = S.dayStats();
    hero.innerHTML =
      '<div class="hero-label">' + meal.icon + ' ' + meal.label + (s.done ? ' · 全部完成！' : ' · 還差') + '</div>' +
      '<div class="hero-num">' + (s.done ? '✓' : s.remaining) + (s.done ? '' : '<small>個</small>') + '</div>' +
      '<div class="hero-bar"><i style="width:' + Math.round(s.ratio * 100) + '%"></i></div>' +
      '<div class="hero-stats">' +
        '<div class="hero-stat"><b>' + s.packed + '<i>/' + s.total + '</i></b><span>便當</span></div>' +
        '<div class="hero-stat"><b>' + s.boxesSealed + '<i>/' + s.boxes + '</i></b><span>箱數</span></div>' +
        '<div class="hero-stat is-veg"><b>' + s.veg + '</b><span>🥬 素食</span></div>' +
      '</div>' +
      '<div class="hero-foot">葷食 ' + s.meat + ' 個 · 素食 ' + s.veg + ' 個　｜　全日還差 ' + day.remaining + ' / ' + day.total + ' 個</div>';
  }

  function renderChips() {
    var st = S.get();
    var units = S.unitsInMeal(st.activeMeal);
    $('#unit-chips').innerHTML = units.map(function (u) {
      var s = S.unitStats(st.activeMeal, u.id);
      // 需求量拆成「葷+素」，例如 64 個 = 63+1
      var breakdown = s.veg ? s.meat + '+' + s.veg + '素' : s.total + ' 個';
      return '<button type="button" class="chip' + (s.done ? ' is-done' : '') + '" role="tab" ' +
        'data-unit="' + u.id + '" aria-selected="' + (st.activeUnitId === u.id) + '">' +
          '<span class="chip-top">' +
            '<span class="chip-name">' + esc(u.name) + (s.done ? ' ✓' : '') + '</span>' +
            '<span class="chip-count">' + s.packed + '<i>/' + s.total + '</i></span>' +
          '</span>' +
          '<span class="chip-sub">' +
            '<span class="chip-tag' + (s.veg ? ' has-veg' : '') + '">' + breakdown + '</span>' +
            '<span class="chip-tag">📦 ' + s.boxesSealed + '/' + s.boxesNeeded + ' 箱</span>' +
          '</span>' +
        '</button>';
    }).join('') || '<p class="hint">這一餐沒有單位要打便當。</p>';
  }

  function renderBox(lastAddedIndex) {
    var st = S.get();
    var card = $('#box-card');
    if (!st.activeUnitId) { card.innerHTML = ''; card.hidden = true; return; }
    card.hidden = false;

    var s = S.unitStats(st.activeMeal, st.activeUnitId);
    var base = s.boxIndex * App.Const.PER_BOX;

    var layers = '';
    for (var L = 0; L < App.Const.LAYERS; L++) {
      var slots = '';
      var layerFull = true, layerHasSlot = false;
      for (var k = 0; k < App.Const.PER_LAYER; k++) {
        var inBox = L * App.Const.PER_LAYER + k;
        var abs = base + inBox;
        var cls = 'slot';
        var icon = '';

        if (abs >= s.total) {
          cls += ' is-unused';                       // 這一箱用不到的格子
        } else {
          layerHasSlot = true;
          var veg = S.isVegIndex(abs, s.total, s.veg);
          if (abs < s.packed) {
            cls += veg ? ' is-filled is-veg' : ' is-filled';
            icon = '<svg aria-hidden="true"><use href="' + (veg ? '#i-leaf' : '#i-bento') + '"/></svg>';
            if (lastAddedIndex === abs) cls += ' pop';
          } else {
            layerFull = false;
            if (veg) cls += ' is-veg-pending';
            if (abs === s.packed) cls += ' is-next';
          }
        }
        slots += '<button type="button" class="' + cls + '" data-slot="' + abs + '" ' +
          (abs >= s.total ? 'disabled aria-hidden="true" tabindex="-1"' : 'aria-label="第 ' + (abs + 1) + ' 個"') +
          '>' + icon + '</button>';
      }
      var lcls = 'layer';
      if (layerHasSlot && layerFull) lcls += ' is-full';
      if (L === s.layer && !s.done) lcls += ' is-current';
      layers += '<div class="' + lcls + '" data-layer="' + L + '">' +
        '<span class="layer-label">' + (L + 1) + 'F</span>' + slots + '</div>';
    }

    var boxFull = s.packedInBox >= s.boxCapacity && s.boxCapacity > 0;
    card.innerHTML =
      '<div class="box-head">' +
        '<div><div class="box-unit">' + esc(unitName(st.activeUnitId)) + (s.done ? ' ✅' : '') + '</div>' +
        '<div class="box-sub">需求 ' + s.total + ' 個' + (s.veg ? '（葷 ' + s.meat + ' + 素 ' + s.veg + '）' : '') + '</div>' +
        '<div class="box-sub">已打 ' + boxPhrase(s.packed) + '</div></div>' +
        '<div class="box-meta">第 <b>' + (s.boxIndex + 1) + '</b> / ' + s.boxesNeeded + ' 箱' +
          '<br>本箱 ' + s.packedInBox + ' / ' + s.boxCapacity + ' 個' +
          '<br>' + (s.done ? '已完成 ✓' : '還差 ' + s.remaining + ' 個') + '</div>' +
      '</div>' +
      '<div class="box-frame' + (boxFull ? ' is-full' : '') + '">' + layers + '</div>' +
      (s.boxCapacity < App.Const.PER_BOX
        ? '<p class="box-sub" style="margin-top:8px">⚠️ 這是最後一箱，只裝 ' + s.boxCapacity + ' 個（不與其他連隊混裝）。</p>'
        : '');

    // 素食提醒橫幅
    var nextIsVeg = !s.done && S.isVegIndex(s.packed, s.total, s.veg);
    $('#veg-banner').hidden = !nextIsVeg;

    // 主按鈕副標
    var plus = $('#btn-plus');
    plus.disabled = s.done;
    $('#plus-sub').textContent = s.done
      ? '這個單位已完成'
      : esc(unitName(st.activeUnitId)) + ' · 第 ' + (s.boxIndex + 1) + ' 箱 · ' + (s.layer + 1) + 'F 第 ' + (s.slot + 1) + ' 格';
    $('#btn-minus').disabled = s.packed === 0;
  }

  function renderOverview() {
    var st = S.get();
    var units = S.unitsInMeal(st.activeMeal);
    var mealStat = S.mealStats(st.activeMeal);
    $('#overview').querySelector('summary').innerHTML =
      '<span>本餐全連隊進度</span><span class="ov-stat">' + mealStat.doneUnits + '/' + mealStat.unitCount + ' 連完成</span>';

    $('#overview-table').innerHTML = units.map(function (u) {
      var s = S.unitStats(st.activeMeal, u.id);
      var pct = s.total ? Math.round(s.packed / s.total * 100) : 0;
      return '<div class="ov-row' + (s.done ? ' is-done' : '') + '">' +
        '<div class="ov-top">' +
          '<span class="ov-name">' + (st.activeUnitId === u.id ? '<span class="dot"></span>' : '') + esc(u.name) + '</span>' +
          '<span class="ov-stat"><b>' + boxPhrase(s.packed) + '</b> / ' + s.total + ' 個 · ' +
            s.boxesSealed + '/' + s.boxesNeeded + ' 箱' + (s.done ? ' ✓' : ' · 還差 ' + s.remaining) + '</span>' +
        '</div>' +
        '<div class="ov-bar"><i style="width:' + pct + '%"></i></div>' +
      '</div>';
    }).join('') || '<p class="hint">這一餐沒有單位要打便當。</p>';
  }

  /* 換連隊或換箱時，把箱子捲進視野，確保格子和 +1 按鈕同時看得到。
     同一箱內按 +1 不捲動，免得畫面一直跳。 */
  var lastFocus = '';
  function keepBoxInView() {
    var st = S.get();
    if (!st.activeUnitId) return;
    var s = S.unitStats(st.activeMeal, st.activeUnitId);
    var key = st.activeMeal + '/' + st.activeUnitId + '/' + s.boxIndex;
    if (key === lastFocus) return;
    lastFocus = key;
    var card = document.getElementById('box-card');
    if (!card) return;
    var rect = card.getBoundingClientRect();
    // 頂列高度會隨 safe-area 變動，直接量比寫死可靠
    var bar = document.querySelector('.topbar');
    var barH = (bar ? bar.offsetHeight : 60) + 6;
    // 已經整張看得到（而且沒被底部計數列擋住）就不要亂動畫面
    if (rect.top >= barH && rect.bottom <= window.innerHeight - 100) return;
    window.scrollTo({ top: Math.max(0, rect.top + window.scrollY - barH), behavior: 'smooth' });
  }

  function renderWork(lastAddedIndex) {
    renderMealTabs();
    renderHero();
    renderChips();
    renderBox(lastAddedIndex);
    renderOverview();
    keepBoxInView();
  }

  /* 讓系統狀態列的顏色跟 App 頂端一致（Android 會用 theme-color 塗狀態列）。
     值取自 CSS 的 --bg-grain，也就是畫面最上緣實際看到的顏色。 */
  function syncThemeColor() {
    var t = S.get().settings.theme;
    var dark = t === 'dark' ||
      (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    var meta = document.getElementById('meta-theme');
    if (meta) meta.setAttribute('content', dark ? '#1E2523' : '#EBE5D6');
  }

  function render(lastAddedIndex) {
    var st = S.get();
    $('#date-label').textContent = st.dateLabel
      ? st.dateLabel + ' 的便當'
      : (st.configured ? '今日便當' : '還沒設定便當數');
    document.documentElement.setAttribute('data-theme', st.settings.theme);
    syncThemeColor();
    if (currentScreen === 'setup') renderSetup(); else renderWork(lastAddedIndex);
  }

  /* ---------- 浮層 / 提示 ---------- */

  function toast(msg, ms) {
    var root = $('#toast-root');
    root.innerHTML = '';          // 一次只留一則，連按時不會疊起來擋住箱子
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(function () {
      if (!el.isConnected) return;
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, 260);
    }, ms || 1800);
  }

  /**
   * 全螢幕事件提示。
   * @param {{emoji, title, titleClass, body, next, okLabel, autoMs}} opts
   * @returns {Promise<void>}
   */
  function overlay(opts) {
    return new Promise(function (resolve) {
      var root = $('#overlay-root');
      var wrap = document.createElement('div');
      wrap.className = 'overlay';
      wrap.innerHTML =
        '<div class="overlay-card">' +
          '<span class="overlay-emoji">' + (opts.emoji || '✅') + '</span>' +
          '<div class="overlay-title ' + (opts.titleClass || '') + '">' + esc(opts.title || '') + '</div>' +
          (opts.body ? '<div class="overlay-body">' + opts.body + '</div>' : '') +
          (opts.next ? '<div class="overlay-next">' + opts.next + '</div>' : '') +
          (opts.okLabel ? '<button type="button" class="btn btn-primary btn-block">' + esc(opts.okLabel) + '</button>' : '') +
        '</div>';
      root.appendChild(wrap);

      var closed = false;
      function close() {
        if (closed) return;
        closed = true;
        wrap.style.animation = 'fade .16s ease reverse both';
        setTimeout(function () { wrap.remove(); resolve(); }, 160);
      }
      wrap.addEventListener('click', close);
      if (opts.autoMs) setTimeout(close, opts.autoMs);
    });
  }

  /** 取代 window.confirm 的自訂確認框 */
  function confirmBox(title, body, okLabel) {
    return new Promise(function (resolve) {
      var root = $('#overlay-root');
      var wrap = document.createElement('div');
      wrap.className = 'overlay';
      wrap.innerHTML =
        '<div class="overlay-card">' +
          '<span class="overlay-emoji">🤔</span>' +
          '<div class="overlay-title">' + esc(title) + '</div>' +
          (body ? '<div class="overlay-body">' + esc(body) + '</div>' : '') +
          '<button type="button" class="btn btn-primary btn-block" data-ok>' + esc(okLabel || '確定') + '</button>' +
          '<button type="button" class="btn btn-ghost btn-block" data-cancel>取消</button>' +
        '</div>';
      root.appendChild(wrap);
      function done(v) { wrap.remove(); resolve(v); }
      wrap.querySelector('[data-ok]').addEventListener('click', function () { done(true); });
      wrap.querySelector('[data-cancel]').addEventListener('click', function () { done(false); });
      wrap.addEventListener('click', function (e) { if (e.target === wrap) done(false); });
    });
  }

  function flashLayer(layerIndex) {
    var el = document.querySelector('.layer[data-layer="' + layerIndex + '"]');
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  return {
    render: render, setScreen: setScreen, getScreen: getScreen,
    renderSetup: renderSetup, renderWork: renderWork,
    showWarnings: showWarnings,
    toast: toast, overlay: overlay, confirmBox: confirmBox, flashLayer: flashLayer,
    syncThemeColor: syncThemeColor,
    unitName: unitName, boxPhrase: boxPhrase, esc: esc,
  };
})();
