/* ==========================================================================
   effects.js — 音效（WebAudio 即時合成，不用任何音檔）、震動、彩帶
   ========================================================================== */
window.App = window.App || {};

App.Effects = (function () {
  'use strict';

  var ctx = null;

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function audio() {
    if (!App.State.get().settings.sound) return null;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** 使用者第一次互動時解鎖 AudioContext（行動瀏覽器限制） */
  function unlock() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
  }

  /** 單一音符 */
  function tone(freq, startAt, dur, type, gainPeak) {
    var ac = audio();
    if (!ac) return;
    var t0 = ac.currentTime + startAt;
    var osc = ac.createOscillator();
    var gain = ac.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(gainPeak || 0.18, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function buzz(pattern) {
    if (!App.State.get().settings.haptic) return;
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
  }

  /* ---------- 各事件的聲音 ---------- */
  var Sound = {
    tick:      function () { tone(880, 0, 0.07, 'triangle', 0.08); },
    layer:     function () { tone(1046, 0, 0.10, 'triangle', 0.14); },
    box:       function () { tone(784, 0, 0.13, 'sine', 0.18); tone(1175, 0.11, 0.22, 'sine', 0.18); },
    unit:      function () { tone(659, 0, 0.16, 'sine', 0.18); tone(880, 0.13, 0.16, 'sine', 0.18); tone(1319, 0.26, 0.4, 'sine', 0.2); },
    veg:       function () { tone(1320, 0, 0.08, 'sine', 0.12); tone(1760, 0.07, 0.12, 'sine', 0.1); },
    undo:      function () { tone(440, 0, 0.09, 'sawtooth', 0.06); },
    finish:    function () {
      [523, 659, 784, 1046, 1319].forEach(function (f, i) { tone(f, i * 0.1, 0.5, 'sine', 0.2); });
    },
  };

  /* ---------- 彩帶 ---------- */

  var confettiRunning = false;

  function confetti(durationMs) {
    if (reducedMotion()) return;
    var canvas = document.getElementById('confetti');
    if (!canvas || confettiRunning) return;
    confettiRunning = true;

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = canvas.width = window.innerWidth * dpr;
    var H = canvas.height = window.innerHeight * dpr;
    canvas.style.display = 'block';
    var g = canvas.getContext('2d');

    var colors = ['#F4820B', '#FFC94A', '#5FB878', '#3E5641', '#E8604C', '#4FA3D1'];
    var parts = [];
    for (var i = 0; i < 140; i++) {
      parts.push({
        x: Math.random() * W,
        y: -Math.random() * H * 0.4,
        w: (6 + Math.random() * 7) * dpr,
        h: (9 + Math.random() * 9) * dpr,
        vx: (Math.random() - 0.5) * 2.2 * dpr,
        vy: (2.2 + Math.random() * 3.2) * dpr,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.22,
        c: colors[(Math.random() * colors.length) | 0],
      });
    }

    var end = performance.now() + (durationMs || 2600);
    function frame(now) {
      g.clearRect(0, 0, W, H);
      parts.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.vy += 0.02 * dpr;
        if (p.y > H + 40) { p.y = -20; p.vy = (2.2 + Math.random() * 3.2) * dpr; }
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.rot);
        g.fillStyle = p.c;
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        g.restore();
      });
      if (now < end) {
        requestAnimationFrame(frame);
      } else {
        g.clearRect(0, 0, W, H);
        canvas.style.display = 'none';
        confettiRunning = false;
      }
    }
    requestAnimationFrame(frame);
  }

  return {
    unlock: unlock,
    reducedMotion: reducedMotion,
    buzz: buzz,
    sound: Sound,
    confetti: confetti,
  };
})();
