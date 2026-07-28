/* ==========================================================================
   app.js — 啟動、事件綁定、把 state 事件轉成提醒（動畫 / 音效 / 震動）
   ========================================================================== */
(function () {
  'use strict';

  var S = App.State;
  var UI = App.UI;
  var FX = App.Effects;
  var $ = function (sel) { return document.querySelector(sel); };

  var pendingLastAdded = null;   // 給格子放入動畫用
  var busy = false;              // 浮層播放中，避免連按疊在一起

  var SAMPLE = [
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

  /* ---------- 事件 → 提醒 ---------- */

  function handleEvents(events) {
    if (!events.length) { FX.sound.tick(); FX.buzz(8); return Promise.resolve(); }

    var chain = Promise.resolve();

    events.forEach(function (ev) {
      chain = chain.then(function () {
        switch (ev.type) {
          case 'layerDone':
            FX.sound.layer();
            FX.buzz(14);
            UI.flashLayer(ev.layerNo - 1);
            UI.toast('第 ' + ev.layerNo + ' 層滿了，繼續往上疊 👍', 1300);
            return;

          case 'boxSealed':
            FX.sound.box();
            FX.buzz([30, 50, 30]);
            busy = true;
            return UI.overlay({
              emoji: '📦',
              title: '第 ' + ev.boxNo + ' 箱 · 封箱！',
              body: UI.esc(UI.unitName(ev.unitId)) + ' 的第 <b>' + ev.boxNo + '</b> 箱裝滿 24 個了',
              next: '接下來 → 第 <span class="big">' + (ev.boxNo + 1) + '</span> 箱（共 ' + ev.boxesNeeded + ' 箱）',
              autoMs: 1500,
            }).then(function () { busy = false; });

          case 'unitDone': {
            FX.sound.unit();
            FX.buzz([40, 60, 40, 60, 90]);
            busy = true;
            var st = S.get();
            var nextHtml = '';
            if (ev.nextUnitId) {
              var ns = S.unitStats(st.activeMeal, ev.nextUnitId);
              nextHtml = '下一個 → <span class="big">' + UI.esc(UI.unitName(ev.nextUnitId)) + '</span>' +
                ns.total + ' 個 · ' + ns.boxesNeeded + ' 箱' +
                (ns.veg ? '（含素食 ' + ns.veg + '）' : '');
            }
            return UI.overlay({
              emoji: '🎉',
              title: UI.unitName(ev.unitId) + ' 打完了！',
              body: '共 <b>' + ev.boxNo + '</b> 箱' +
                (ev.leftover ? '（最後一箱 ' + ev.leftover + ' 個）' : '（全部裝滿）') +
                '，記得換新的保麗龍箱 📦',
              next: nextHtml,
              okLabel: ev.nextUnitId ? '開始打 ' + UI.unitName(ev.nextUnitId) : '好',
              autoMs: ev.nextUnitId ? 4200 : 2600,
            }).then(function () { busy = false; });
          }

          case 'mealDone': {
            var meal = App.mealById(ev.mealId);
            FX.sound.finish();
            FX.buzz([60, 40, 60, 40, 140]);
            FX.confetti(3000);
            busy = true;
            var day = S.dayStats();
            return UI.overlay({
              emoji: '🏆',
              title: meal.label + '全部打完！',
              body: day.done
                ? '今天的便當<b>全部完成</b>了，辛苦了！'
                : '全日還差 <b>' + day.remaining + '</b> 個，可以切到下一餐了',
              okLabel: '收工',
              autoMs: 5000,
            }).then(function () { busy = false; });
          }

          case 'vegNext':
            FX.sound.veg();
            FX.buzz(20);
            UI.toast('🥬 下一個放素食便當！', 2200);
            return;
        }
      });
    });

    return chain;
  }

  /* ---------- 計數 ---------- */

  function plusOne() {
    if (busy) return;
    var st = S.get();
    if (!st.activeUnitId) return;
    FX.unlock();
    pendingLastAdded = S.unitStats(st.activeMeal, st.activeUnitId).packed;
    var events = S.pack(1);
    if (events.length === 0 && pendingLastAdded === S.unitStats(st.activeMeal, st.activeUnitId).packed) {
      pendingLastAdded = null;    // 沒有變化（已完成）
      return;
    }
    handleEvents(events);
  }

  function minusOne() {
    if (busy) return;
    FX.unlock();
    pendingLastAdded = null;
    var before = S.get().activeUnitId;
    var st = S.get();
    if (!before) return;
    if (S.unitStats(st.activeMeal, before).packed === 0) { UI.toast('已經退到 0 了'); return; }
    S.pack(-1);
    FX.sound.undo();
    FX.buzz(10);
  }

  /* ---------- 綁定 ---------- */

  function bindSetup() {
    $('#btn-sample').addEventListener('click', function () {
      $('#paste-input').value = SAMPLE;
      UI.toast('已填入範例，按「自動解析」試試');
    });

    $('#btn-clear-paste').addEventListener('click', function () {
      $('#paste-input').value = '';
      UI.showWarnings([]);
    });

    $('#btn-parse').addEventListener('click', function () {
      var text = $('#paste-input').value;
      if (!text.trim()) { UI.toast('請先貼上班長的訊息'); return; }
      var result = App.Parser.parse(text);
      if (result.entries.length === 0) {
        UI.showWarnings(result.warnings);
        UI.toast('解析不到便當數，請手動輸入');
        return;
      }
      S.applyEntries(result.entries, result.dateLabel);
      UI.showWarnings(result.warnings);
      var day = S.dayStats();
      UI.toast('解析完成：' + day.total + ' 個便當 · ' + day.boxes + ' 箱', 2400);
    });

    $('#btn-add-unit').addEventListener('click', function () {
      S.addUnit('新單位');
      UI.toast('已新增，請改名字並填數量');
    });

    // 數量輸入：邊打邊算，但不重繪整張表（避免游標跳掉）
    $('#plan-table').addEventListener('input', function (e) {
      var t = e.target;
      if (t.dataset.plan) {
        var meal = t.dataset.meal, unit = t.dataset.unit;
        var row = t.closest('.meal-row');
        var meat = parseInt(row.querySelector('[data-plan="meat"]').value, 10) || 0;
        var veg = parseInt(row.querySelector('[data-plan="veg"]').value, 10) || 0;
        S.setPlan(meal, unit, meat, veg, true);
        var total = meat + veg;
        row.querySelector('.meal-row-sum').innerHTML = total ? total + '個<br>' + S.boxesNeeded(total) + '箱' : '—';
        var block = t.closest('.unit-block');
        var dayTotal = App.Meals.reduce(function (a, m) { return a + S.planOf(m.id, unit).total; }, 0);
        block.querySelector('.unit-total').textContent = '共 ' + dayTotal + ' 個';
        UI.renderSummary();
      } else if (t.dataset.rename) {
        S.renameUnit(t.dataset.rename, t.value || '未命名', true);
        UI.renderSummary();
      }
    });

    $('#plan-table').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-remove]');
      if (!btn) return;
      var id = btn.dataset.remove;
      UI.confirmBox('刪除「' + UI.unitName(id) + '」？', '這個單位的便當數與進度都會一起清掉。', '刪除')
        .then(function (ok) { if (ok) { S.removeUnit(id); UI.toast('已刪除'); } });
    });

    $('#btn-start').addEventListener('click', function () {
      FX.unlock();
      S.markConfigured();
      UI.setScreen('work');
      UI.toast('開工！按下面的大按鈕開始計數 🍱', 2600);
    });
  }

  function bindWork() {
    $('#btn-plus').addEventListener('click', plusOne);
    $('#btn-minus').addEventListener('click', minusOne);

    $('#meal-tabs').addEventListener('click', function (e) {
      var b = e.target.closest('[data-meal]');
      if (!b) return;
      S.setActiveMeal(b.dataset.meal);
      UI.toast('切到' + App.mealById(b.dataset.meal).label, 1200);
    });

    $('#unit-chips').addEventListener('click', function (e) {
      var b = e.target.closest('[data-unit]');
      if (!b) return;
      S.setActiveUnit(b.dataset.unit);
    });

    // 點格子直接跳到某個數量（拿錯、漏裝時修正）
    $('#box-card').addEventListener('click', function (e) {
      var b = e.target.closest('[data-slot]');
      if (!b || b.disabled) return;
      var st = S.get();
      var idx = parseInt(b.dataset.slot, 10);
      var s = S.unitStats(st.activeMeal, st.activeUnitId);
      var target = (s.packed === idx + 1) ? idx : idx + 1;
      if (target === s.packed) return;

      var apply = function () {
        pendingLastAdded = target > s.packed ? target - 1 : null;
        S.setPacked(st.activeMeal, st.activeUnitId, target);
        FX.sound.tick();
      };

      if (Math.abs(target - s.packed) <= 1) { apply(); return; }
      UI.confirmBox(
        '把進度改成 ' + target + ' 個？',
        UI.unitName(st.activeUnitId) + ' 目前是 ' + s.packed + ' 個，會改成 ' + target + ' 個。',
        '改成 ' + target + ' 個'
      ).then(function (ok) { if (ok) apply(); });
    });
  }

  function bindSettings() {
    var sheet = $('#settings-sheet');
    function open() {
      var st = S.get();
      $('#set-sound').checked = st.settings.sound;
      $('#set-haptic').checked = st.settings.haptic;
      $('#set-theme').value = st.settings.theme;
      $('#set-veg').value = st.settings.vegPosition;
      sheet.hidden = false;
    }
    function close() { sheet.hidden = true; }

    $('#btn-settings').addEventListener('click', open);
    sheet.addEventListener('click', function (e) {
      if (e.target.closest('[data-close-sheet]')) close();
    });

    $('#set-sound').addEventListener('change', function (e) {
      S.setSetting('sound', e.target.checked);
      if (e.target.checked) { FX.unlock(); FX.sound.layer(); }
    });
    $('#set-haptic').addEventListener('change', function (e) {
      S.setSetting('haptic', e.target.checked);
      if (e.target.checked) FX.buzz(30);
    });
    $('#set-theme').addEventListener('change', function (e) { S.setSetting('theme', e.target.value); });
    $('#set-veg').addEventListener('change', function (e) {
      S.setSetting('vegPosition', e.target.value);
      UI.toast('素食改成放' + (e.target.value === 'last' ? '最後' : '最前'));
    });

    $('#btn-edit-plan').addEventListener('click', function () { close(); UI.setScreen('setup'); });

    $('#btn-reset-meal').addEventListener('click', function () {
      var meal = App.mealById(S.get().activeMeal);
      UI.confirmBox('重設「' + meal.label + '」進度？', '便當數不會變，只是把已打的數量歸零。', '重設')
        .then(function (ok) { if (ok) { S.resetMealProgress(meal.id); close(); UI.toast(meal.label + '進度已歸零'); } });
    });

    $('#btn-reset-all').addEventListener('click', function () {
      UI.confirmBox('全部清空重來？', '便當數與所有進度都會刪掉，回到最初的設定畫面。', '全部清空')
        .then(function (ok) {
          if (!ok) return;
          S.resetEverything();
          close();
          $('#paste-input').value = '';
          UI.showWarnings([]);
          UI.setScreen('setup');
          UI.toast('已全部清空');
        });
    });
  }

  /* ---------- 啟動 ---------- */

  function init() {
    S.load();
    S.ensureActiveUnit();

    S.subscribe(function () {
      UI.render(pendingLastAdded);
      pendingLastAdded = null;
    });

    bindSetup();
    bindWork();
    bindSettings();

    document.addEventListener('pointerdown', function once() {
      FX.unlock();
      document.removeEventListener('pointerdown', once);
    }, { once: true });

    // 往下捲時頂列變毛玻璃，在最上面時保持透明
    var topbar = document.querySelector('.topbar');
    var stuck = false;
    function syncTopbar() {
      var next = window.scrollY > 4;
      if (next === stuck) return;
      stuck = next;
      topbar.classList.toggle('is-stuck', next);
    }
    window.addEventListener('scroll', syncTopbar, { passive: true });
    syncTopbar();

    // 主題設為「跟隨系統」時，系統切換深淺色也要同步狀態列顏色
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onScheme = function () { UI.syncThemeColor(); };
    if (mq.addEventListener) mq.addEventListener('change', onScheme);
    else if (mq.addListener) mq.addListener(onScheme);

    UI.setScreen(S.get().configured && S.dayStats().total > 0 ? 'work' : 'setup');

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 離線功能非必要，失敗就算了 */ });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
