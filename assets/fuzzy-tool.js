/* Snakbacks free fuzzy match tool. Runs entirely in the browser: nothing is uploaded or stored.
   The matching engine below is copied from the Fuzzy Match add-on (addon-fuzzy/v4-menu/Code.gs),
   so results are the same as =FUZZYMATCH(values, lookup, threshold) in Google Sheets. */
(function () {
  'use strict';

  // ---------- engine (same as the add-on) ----------
  function prep(v) {
    var s = String(v == null ? '' : v).toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
    var tokens = s ? s.split(' ') : [];
    return { norm: s, tokens: tokens, sorted: tokens.slice().sort().join(' ') };
  }
  function tokenSet(a, b) {
    if (!a.length || !b.length) return 0;
    var setA = {}, nA = 0; a.forEach(function (t) { if (!setA['k' + t]) { setA['k' + t] = true; nA++; } });
    var setB = {}, nB = 0; b.forEach(function (t) { if (!setB['k' + t]) { setB['k' + t] = true; nB++; } });
    var inter = 0; for (var k in setA) if (Object.prototype.hasOwnProperty.call(setA, k) && setB[k]) inter++;
    return (2 * inter) / (nA + nB);
  }
  function jaroWinkler(s1, s2) {
    var l1 = s1.length, l2 = s2.length;
    if (!l1 || !l2) return 0;
    var range = Math.max(0, Math.floor(Math.max(l1, l2) / 2) - 1);
    var m1 = new Array(l1), m2 = new Array(l2), matches = 0;
    for (var i = 0; i < l1; i++) {
      var lo = Math.max(0, i - range), hi = Math.min(i + range + 1, l2);
      for (var j = lo; j < hi; j++) {
        if (!m2[j] && s1[i] === s2[j]) { m1[i] = m2[j] = true; matches++; break; }
      }
    }
    if (!matches) return 0;
    var t = 0, k = 0;
    for (var x = 0; x < l1; x++) {
      if (!m1[x]) continue;
      while (!m2[k]) k++;
      if (s1[x] !== s2[k]) t++;
      k++;
    }
    var jaro = (matches / l1 + matches / l2 + (matches - t / 2) / matches) / 3;
    var prefix = 0;
    while (prefix < 4 && prefix < l1 && prefix < l2 && s1[prefix] === s2[prefix]) prefix++;
    return jaro + prefix * 0.1 * (1 - jaro);
  }
  function scorePrepared(p, q) {
    if (!p.norm || !q.norm) return 0;
    if (p.norm === q.norm) return 1;
    return Math.max(jaroWinkler(p.norm, q.norm), jaroWinkler(p.sorted, q.sorted), tokenSet(p.tokens, q.tokens));
  }
  /* Best candidate: {i, score, exact}. i = -1 when nothing reaches th; near/nearScore hold the closest one. */
  function bestMatch(p, prepared, exact, th) {
    if (!p.norm) return { i: -1, score: 0, near: -1 };
    if (p.norm in exact) return { i: exact[p.norm], score: 1, exact: true, near: exact[p.norm] };
    var best = -1, bestScore = 0;
    for (var i = 0; i < prepared.length; i++) {
      var q = prepared[i];
      if (!q.norm) continue;
      var lr = Math.min(p.norm.length, q.norm.length) / Math.max(p.norm.length, q.norm.length);
      if (lr < th - 0.35) continue;
      var s = scorePrepared(p, q);
      if (s > bestScore) { bestScore = s; best = i; }
    }
    return bestScore >= th ? { i: best, score: bestScore, near: best } : { i: -1, score: bestScore, near: best };
  }
  window.SnakbacksFuzzy = { prep: prep, scorePrepared: scorePrepared, bestMatch: bestMatch };

  // ---------- page ----------
  var $ = function (id) { return document.getElementById(id); };
  var elA = $('ft-values'), elB = $('ft-lookup'), elTh = $('ft-th'), elThOut = $('ft-th-out');
  if (!elA) return; // engine-only use (tests)
  var elRun = $('ft-run'), elStatus = $('ft-status'), elOut = $('ft-out'), elBody = $('ft-body');
  var elSummary = $('ft-summary'), elMore = $('ft-more'), elFormula = $('ft-formula');
  var MAX_LINES = 10000, SHOW = 500;
  var last = null, runId = 0;

  var EXAMPLE_A = ['ACME Pty. Ltd', 'Inytech', 'Corp Umbrella', 'Globex', 'stark industries inc', 'Wayne Enterprises', 'Soylent  Corp', 'Hooli'].join('\n');
  var EXAMPLE_B = ['Acme Pty Ltd', 'Initech', 'Umbrella Corp', 'Globex Corporation', 'Stark Industries', 'Wayne Enterprises', 'Soylent Corporation', 'Massive Dynamic'].join('\n');

  function lines(text) {
    var ls = String(text).replace(/\r/g, '').split('\n').map(function (l) { return l.split('\t')[0].trim(); });
    while (ls.length && !ls[ls.length - 1]) ls.pop();
    return ls;
  }
  function fmt(x) { return (Math.round(x * 1000) / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, ''); }
  function th() { return Number(elTh.value); }
  function updateTh() {
    elThOut.textContent = th().toFixed(2);
    elFormula.textContent = '=FUZZYMATCH(A2:A, Clean!A2:A, ' + th().toFixed(2).replace(/0$/, '') + ')';
  }
  function setStatus(msg) { elStatus.textContent = msg; }

  function run() {
    var A = lines(elA.value), B = lines(elB.value), t = th(), id = ++runId;
    if (!A.length || !B.length) { setStatus('Paste something into both boxes first.'); elOut.hidden = true; return; }
    if (A.length > MAX_LINES || B.length > MAX_LINES) {
      setStatus('That is more than ' + MAX_LINES.toLocaleString() + ' lines in one box. For big lists, use the free add-on in Google Sheets instead.');
      return;
    }
    var prepared = B.map(prep), exact = {};
    prepared.forEach(function (p, i) { if (p.norm && !(p.norm in exact)) exact[p.norm] = i; });
    var results = new Array(A.length), i = 0;
    elRun.disabled = true;
    (function chunk() {
      if (id !== runId) return;
      var stop = Math.min(A.length, i + 150);
      for (; i < stop; i++) {
        var p = prep(A[i]), r = bestMatch(p, prepared, exact, t);
        // No match: find the true closest name with no length shortcut, as a hint for lowering the threshold.
        // A closest score at or above the threshold means the add-on's length rule skipped it (e.g. "Globex" vs "Globex Corporation").
        var lenSkip = false;
        if (r.i < 0 && p.norm) { var n = bestMatch(p, prepared, exact, 0); lenSkip = n.score >= t; r = { i: -1, score: n.score, near: n.i }; }
        results[i] = { value: A[i], match: r.i >= 0 ? B[r.i] : '', score: r.score, exact: !!r.exact, near: r.near >= 0 ? B[r.near] : '', lenSkip: lenSkip };
      }
      if (i < A.length) { setStatus('Matching... ' + i.toLocaleString() + ' of ' + A.length.toLocaleString()); setTimeout(chunk, 0); return; }
      elRun.disabled = false;
      last = results; render(results, t);
    })();
  }

  function render(results, t) {
    var exactN = 0, fuzzyN = 0, noneN = 0, blankN = 0;
    var html = [];
    results.forEach(function (r, k) {
      var cls, label;
      if (!r.value) { blankN++; cls = 'blank'; label = ''; }
      else if (r.exact) { exactN++; cls = 'exact'; label = 'Exact'; }
      else if (r.match) { fuzzyN++; cls = 'fuzzy'; label = 'Fuzzy'; }
      else { noneN++; cls = 'none'; label = 'No match'; }
      if (k < SHOW) {
        var matchCell = r.match ? esc(r.match)
          : (r.value && r.near ? '<span class="muted">closest: ' + esc(r.near) +
            (r.lenSkip ? ' (lengths too different at this threshold; lower it to match)' : '') + '</span>' : '');
        html.push('<tr class="' + cls + '"><th>' + (k + 1) + '</th><td>' + esc(r.value) + '</td><td>' + matchCell +
          '</td><td class="num">' + (r.value ? fmt(r.score) : '') + '</td><td>' + label + '</td></tr>');
      }
    });
    elBody.innerHTML = html.join('');
    elMore.hidden = results.length <= SHOW;
    elMore.textContent = 'Showing the first ' + SHOW + ' rows. Copy or download to get all ' + results.length.toLocaleString() + '.';
    elSummary.textContent = (exactN + fuzzyN) + ' matched (' + exactN + ' exact, ' + fuzzyN + ' fuzzy), ' + noneN +
      ' with nothing close enough at ' + t.toFixed(2) + (blankN ? ', ' + blankN + ' blank' : '') + '.';
    elOut.hidden = false;
    setStatus('Done.');
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  function copyText(text, okMsg) {
    var done = function () { setStatus(okMsg); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }
  function csvCell(s) { s = String(s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }

  elTh.addEventListener('input', updateTh);
  elTh.addEventListener('change', function () { if (last) run(); });
  elRun.addEventListener('click', run);
  $('ft-example').addEventListener('click', function () { elA.value = EXAMPLE_A; elB.value = EXAMPLE_B; elTh.value = '0.8'; updateTh(); run(); });
  $('ft-clear').addEventListener('click', function () { elA.value = ''; elB.value = ''; elOut.hidden = true; last = null; setStatus(''); });
  $('ft-copy').addEventListener('click', function () {
    if (!last) return;
    copyText(last.map(function (r) { return r.match; }).join('\n'), 'Copied ' + last.length.toLocaleString() + ' matches. Paste them next to your original column.');
  });
  $('ft-csv').addEventListener('click', function () {
    if (!last) return;
    var rows = [['Value', 'Match', 'Score', 'Result']].concat(last.map(function (r) {
      return [r.value, r.match, r.value ? fmt(r.score) : '', !r.value ? '' : r.exact ? 'Exact' : r.match ? 'Fuzzy' : 'No match'];
    }));
    var blob = new Blob(['﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'fuzzy-matches.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    setStatus('Downloaded fuzzy-matches.csv.');
  });
  updateTh();
})();
