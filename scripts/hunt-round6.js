#!/usr/bin/env node
/**
 * Bug-hunt round 6 — areas NOT covered by rounds 1-5.
 *
 * New territory: parenting hierarchies (orbits), mid-session layer management
 * (delete/rename/reorder/retime with shifting indexes), precompose + time
 * remap, text stopwatch formatting (ES3, no padStart) + comp markers,
 * Checkbox Control driving conditional expressions.
 *
 * Usage: node scripts/hunt-round6.js [--model <id>] [--session E|F|G|H|I]
 * Prereq: AE running, panel open, CDP 8092.
 */
'use strict'

const fs = require('fs')
const path = require('path')

const args = process.argv.slice(2)
let modelOverride = null
let sessionFilter = null
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--model' && args[i + 1]) modelOverride = args[++i]
  if (args[i] === '--session' && args[i + 1]) sessionFilter = args[++i].toUpperCase()
}

// ── CDP layer (same scaffolding as round 5) ──────────────────────────────
const CDP_PORT = 8092
let ws = null
let msgId = 0

async function connectCDP () {
  const targets = await (await fetch(`http://localhost:${CDP_PORT}/json`)).json()
  const page = targets.find(t => t.type === 'page')
  if (!page) throw new Error('Panel target not found on CDP port ' + CDP_PORT)
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl)
    socket.onopen = () => { ws = socket; resolve() }
    socket.onerror = e => reject(new Error('CDP WebSocket error: ' + e.message))
  })
}
function closeCDP () { if (ws) { try { ws.close() } catch (_) {} ws = null } }

function evalInPanel (code, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const id = ++msgId
    const timer = setTimeout(() => { ws.removeEventListener('message', handler); reject(new Error('evalInPanel timeout (' + timeoutMs + 'ms)')) }, timeoutMs)
    const handler = e => {
      const msg = JSON.parse(e.data)
      if (msg.id !== id) return
      ws.removeEventListener('message', handler)
      clearTimeout(timer)
      const r = msg.result
      if (r.exceptionDetails) { reject(new Error('Panel exception: ' + JSON.stringify(r.exceptionDetails.text || r.exceptionDetails))); return }
      resolve(r.result.value !== undefined ? r.result.value : r.result)
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: code, awaitPromise: true, returnByValue: true, timeout: timeoutMs - 1000 } }))
  })
}

function sleep (ms) { return new Promise(r => setTimeout(r, ms)) }

async function fireAndPoll (asyncExpr, pollIntervalMs = 2000, timeoutMs = 60000) {
  await evalInPanel('window.__hunt = null; "cleared"')
  await evalInPanel(`
    (function () {
      try {
        var p = ${asyncExpr};
        if (p && typeof p.then === 'function') {
          p.then(function (r) { window.__hunt = (r === undefined || r === null) ? { __done: true } : r },
                 function (e) { window.__hunt = { __error: String(e && (e.message || e)) } })
        } else { window.__hunt = p }
      } catch (e) { window.__hunt = { __error: String(e && (e.message || e)) } }
      return 'fired'
    })()
  `, 10000)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs)
    const val = await evalInPanel('window.__hunt', 10000)
    if (val !== null && val !== undefined) {
      if (val && val.__error) throw new Error('Panel async error: ' + val.__error)
      return val
    }
  }
  throw new Error('fireAndPoll timeout after ' + timeoutMs + 'ms')
}

/** Evaluate raw ExtendScript (source passed safely via JSON.stringify). */
async function probe (extendScriptSrc, timeoutMs = 30000) {
  return fireAndPoll(`window.HOST_BRIDGE.evalHostFunction(${JSON.stringify(extendScriptSrc)})`, 1000, timeoutMs)
}

// ── Agent turn with conversation history ─────────────────────────────────
async function runAgentTurn (history, prompt, timeoutMs) {
  history.push({ role: 'user', content: prompt })
  const invokeCode = `
    (function () {
      var modelId = ${modelOverride ? JSON.stringify(modelOverride) : '(window.EXTENSIONS_LLM_CHAT_CONFIG && window.EXTENSIONS_LLM_CHAT_CONFIG.defaultModel) || "openai/gpt-oss-120b"'};
      var systemPrompt = '';
      if (window.AGENT_SYSTEM_PROMPT_BUILDER && typeof window.AGENT_SYSTEM_PROMPT_BUILDER.build === 'function') {
        var built = window.AGENT_SYSTEM_PROMPT_BUILDER.build(${JSON.stringify(prompt)});
        systemPrompt = (built && built.prompt) ? built.prompt : (window.AGENT_SYSTEM_PROMPT || '');
      } else { systemPrompt = window.AGENT_SYSTEM_PROMPT || ''; }
      var agentCfg = window.EXTENSIONS_LLM_CHAT_CONFIG || {};
      return window.AGENT_TOOL_LOOP.runAgentLoop({
        modelId: modelId,
        systemPrompt: systemPrompt,
        messages: ${JSON.stringify(history)},
        tools: (window.AGENT_TOOL_REGISTRY && window.AGENT_TOOL_REGISTRY.tools) || [],
        maxSteps: 60,
        temperature: agentCfg.agentTemperature || 0.3,
        streaming: false,
        thinkingFirstTurn: false
      });
    })()
  `
  const result = await fireAndPoll(invokeCode, 3000, timeoutMs)
  history.push({ role: 'assistant', content: String(result.content || '') })
  return result
}

// ── Logging / report ─────────────────────────────────────────────────────
const report = { startedAt: new Date().toISOString(), model: null, turns: [], findings: [] }
function log (msg) { console.log(msg) }
function finding (severity, title, detail) {
  report.findings.push({ severity, title, detail })
  log(`  [FINDING/${severity}] ${title}\n    ${detail}`)
}

function summarizeToolLog (toolCallLog) {
  const fails = []
  for (const e of toolCallLog || []) {
    let r = e.result
    if (typeof r === 'string') { try { r = JSON.parse(r) } catch (_) {} }
    const ok = r && (r.ok === true || r.ok === undefined)
    if (e.status === 'error' || !ok) {
      fails.push({ name: e.name, args: e.args, message: (r && (r.message || r.error)) || e.status })
    }
  }
  return fails
}

function recordTurn (label, prompt, result) {
  const fails = summarizeToolLog(result.toolCallLog)
  const entry = {
    label,
    prompt,
    steps: (result.toolCallLog || []).length,
    calls: (result.toolCallLog || []).map(e => ({
      name: e.name,
      status: e.status,
      args: JSON.stringify(e.args || {}).slice(0, 800)
    })),
    failedCalls: fails,
    usage: result.usage,
    finalText: String(result.content || '').slice(0, 600)
  }
  report.turns.push(entry)
  log(`  turn done: ${entry.steps} tool calls, ${fails.length} failed`)
  for (const f of fails) {
    log(`    FAIL ${f.name}(${JSON.stringify(f.args).slice(0, 160)}) -> ${String(f.message).slice(0, 200)}`)
  }
  return entry
}

function check (name, pass, detail) {
  log(`  ${pass ? 'PASS' : 'FAIL'}: ${name}${detail ? ' — ' + detail : ''}`)
  if (!pass) finding('check-fail', name, detail || '')
  return pass
}

// ── Comp helpers ─────────────────────────────────────────────────────────
const COMP = 'Hunt6-Comp'

async function ensureComp () {
  const r = await probe(`(function(){
    var found = null;
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (it instanceof CompItem && it.name === ${JSON.stringify(COMP)}) { found = it; break; }
    }
    if (!found) found = app.project.items.addComp(${JSON.stringify(COMP)}, 1920, 1080, 1, 12, 30);
    found.openInViewer();
    return resultToJson({ ok: true, name: found.name, numLayers: found.numLayers });
  })()`)
  if (!r || r.ok !== true) throw new Error('ensureComp failed: ' + JSON.stringify(r))
}

async function wipeComp () {
  const r = await probe(`(function(){
    var c = app.project.activeItem;
    if (!c || !(c instanceof CompItem)) return resultToJson({ ok: false, message: 'no comp' });
    app.beginUndoGroup('hunt-wipe');
    var n = c.numLayers;
    while (c.numLayers > 0) { var L = c.layer(1); L.locked = false; L.remove(); }
    // Comp markers survive layer wipe — clear them too (session H adds some).
    var mp = c.markerProperty;
    if (mp) { while (mp.numKeys > 0) mp.removeKey(1); }
    app.endUndoGroup();
    return resultToJson({ ok: true, removed: n });
  })()`)
  if (!r || r.ok !== true) throw new Error('wipeComp failed: ' + JSON.stringify(r))
}

/**
 * Structure probe: names, order, parenting, timing, time remap, source type,
 * checkbox/slider effects, transforms with expressions.
 * worldAt: comp-space position of each layer's own position at given times,
 * computed by walking the parent chain (2D, Z-rotation only) — enough to
 * verify orbits without expression access to toComp().
 */
async function structProbe (times) {
  return probe(`(function(){
    var c = app.project.activeItem;
    if (!c || !(c instanceof CompItem)) return resultToJson({ ok: false, message: 'no comp' });
    var TIMES = ${JSON.stringify(times || [1, 3])};
    function deg2rad (d) { return d * Math.PI / 180; }
    function toCompSpace (L, t) {
      // own position in parent's layer space
      var v;
      try { v = L.property('ADBE Transform Group').property('ADBE Position').valueAtTime(t, false); } catch (e) { return null; }
      var x = v[0]; var y = v[1];
      var P = L.parent;
      var hops = 0;
      while (P && hops < 8) {
        var pt = P.property('ADBE Transform Group');
        var pp = pt.property('ADBE Position').valueAtTime(t, false);
        var pa = pt.property('ADBE Anchor Point').valueAtTime(t, false);
        var ps = pt.property('ADBE Scale').valueAtTime(t, false);
        var pr = pt.property('ADBE Rotate Z').valueAtTime(t, false);
        var sx = (x - pa[0]) * ps[0] / 100;
        var sy = (y - pa[1]) * ps[1] / 100;
        var rad = deg2rad(pr);
        var rx = sx * Math.cos(rad) - sy * Math.sin(rad);
        var ry = sx * Math.sin(rad) + sy * Math.cos(rad);
        x = pp[0] + rx; y = pp[1] + ry;
        P = P.parent; hops++;
      }
      return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    }
    function propInfo (p) {
      if (!p) return null;
      var o = {
        numKeys: p.numKeys,
        firstKeyTime: p.numKeys > 0 ? Math.round(p.keyTime(1) * 100) / 100 : null,
        expr: p.expression ? String(p.expression).slice(0, 200) : '',
        exprEnabled: p.expressionEnabled === true,
        exprError: p.expressionError ? String(p.expressionError).slice(0, 160) : ''
      };
      try { o.value = p.value; } catch (e) { o.value = null; }
      return o;
    }
    var layers = [];
    for (var i = 1; i <= c.numLayers; i++) {
      var L = c.layer(i);
      var t = L.property('ADBE Transform Group');
      var effects = [];
      var fx = L.property('ADBE Effect Parade');
      if (fx) {
        for (var j = 1; j <= fx.numProperties; j++) {
          var ef = fx.property(j);
          var einfo = { name: ef.name, matchName: ef.matchName };
          if (ef.matchName === 'ADBE Slider Control' || ef.matchName === 'ADBE Checkbox Control') {
            try { einfo.value = ef.property(1).value; } catch (e3) {}
          }
          effects.push(einfo);
        }
      }
      var remap = null;
      try {
        if (L.canSetTimeRemapEnabled && L.timeRemapEnabled) {
          var rp = L.property('ADBE Time Remapping');
          remap = { numKeys: rp.numKeys, vals: [] };
          for (var k = 0; k < TIMES.length; k++) { try { remap.vals.push([TIMES[k], Math.round(rp.valueAtTime(TIMES[k], false) * 100) / 100]); } catch (e4) {} }
        }
      } catch (e5) {}
      var world = [];
      for (var w = 0; w < TIMES.length; w++) { world.push(toCompSpace(L, TIMES[w])); }
      layers.push({
        index: i,
        name: L.name,
        nullLayer: L.nullLayer === true,
        sourceIsComp: !!(L.source && L.source instanceof CompItem),
        sourceName: L.source ? L.source.name : '',
        parentIndex: L.parent ? L.parent.index : 0,
        parentName: L.parent ? L.parent.name : '',
        inPoint: Math.round(L.inPoint * 100) / 100,
        outPoint: Math.round(L.outPoint * 100) / 100,
        timeRemap: remap,
        worldAt: world,
        anchor: propInfo(t.property('ADBE Anchor Point')),
        position: propInfo(t.property('ADBE Position')),
        scale: propInfo(t.property('ADBE Scale')),
        rotation: propInfo(t.property('ADBE Rotate Z')),
        opacity: propInfo(t.property('ADBE Opacity')),
        effects: effects
      });
    }
    var markers = [];
    var mp = c.markerProperty;
    if (mp) {
      for (var m = 1; m <= mp.numKeys; m++) {
        markers.push({ t: Math.round(mp.keyTime(m) * 100) / 100, comment: String(mp.keyValue(m).comment || '') });
      }
    }
    return resultToJson({ ok: true, numLayers: c.numLayers, layers: layers, compMarkers: markers });
  })()`, 90000)
}

async function textAtTimes (times) {
  return probe(`(function(){
    var c = app.project.activeItem;
    if (!c || !(c instanceof CompItem)) return resultToJson({ ok: false, message: 'no comp' });
    var target = null;
    for (var i = 1; i <= c.numLayers; i++) {
      var L = c.layer(i);
      if (L instanceof TextLayer) { target = L; break; }
    }
    if (!target) return resultToJson({ ok: false, message: 'text layer not found' });
    var st = target.property('ADBE Text Properties').property('ADBE Text Document');
    var times = ${JSON.stringify(times)};
    var vals = [];
    for (var k = 0; k < times.length; k++) {
      try { vals.push(String(st.valueAtTime(times[k], false).text)); } catch (e) { vals.push('ERR:' + e.toString()); }
    }
    return resultToJson({ ok: true, layer: target.name, expr: st.expression ? String(st.expression).slice(0, 260) : '', exprError: st.expressionError ? String(st.expressionError) : '', values: vals });
  })()`)
}

/** Set a checkbox effect value on the layer that has one, return sun-ish state. */
async function toggleCheckboxAndSample (checkboxValue) {
  return probe(`(function(){
    var c = app.project.activeItem;
    if (!c || !(c instanceof CompItem)) return resultToJson({ ok: false, message: 'no comp' });
    var box = null;
    for (var i = 1; i <= c.numLayers; i++) {
      var fx = c.layer(i).property('ADBE Effect Parade');
      if (!fx) continue;
      for (var j = 1; j <= fx.numProperties; j++) {
        if (fx.property(j).matchName === 'ADBE Checkbox Control') { box = fx.property(j); break; }
      }
      if (box) break;
    }
    if (!box) return resultToJson({ ok: false, message: 'no checkbox control found' });
    app.beginUndoGroup('hunt-toggle');
    box.property(1).setValue(${JSON.stringify(checkboxValue)});
    app.endUndoGroup();
    var layers = [];
    for (var k = 1; k <= c.numLayers; k++) {
      var L = c.layer(k);
      var t = L.property('ADBE Transform Group');
      var op = null;
      try { op = t.property('ADBE Opacity').valueAtTime(2, false); } catch (e) {}
      layers.push({ name: L.name, opacityAt2: op });
    }
    return resultToJson({ ok: true, layers: layers });
  })()`)
}

// ── Session E: parenting hierarchy (solar system orbits) ─────────────────
async function sessionE () {
  log('\n=== SESSION E: иерархия parenting — орбиты ===')
  await wipeComp()
  const history = []

  log('\n--- E1: solar system ---')
  const e1 = await runAgentTurn(history,
    'сделай мини солнечную систему: жёлтое солнце в центре, вокруг него крутятся две планеты на разном расстоянии с разной скоростью, а вокруг первой планеты ещё маленькая луна. используй родительские связи чтобы орбиты работали правильно',
    10 * 60 * 1000)
  recordTurn('E1-solar', 'solar system with parenting', e1)
  const d = await structProbe([0.5, 2, 4])
  check('E1: >=4 layers (sun, 2 planets, moon)', d.numLayers >= 4, 'numLayers=' + d.numLayers)
  const parented = d.layers.filter(l => l.parentIndex > 0)
  check('E1: parenting used', parented.length >= 2, parented.length + ' layers have a parent: ' + parented.map(l => l.name + '->' + l.parentName).join(', '))
  const exprErrs = d.layers.filter(l => ['position', 'rotation', 'scale', 'opacity'].some(k => l[k] && l[k].exprError))
  check('E1: no expression errors', exprErrs.length === 0, exprErrs.map(l => l.name).join(','))
  // Orbit: at least 2 non-null layers move in COMP space between t=0.5 and t=4
  const movers = d.layers.filter(l => {
    if (l.nullLayer || !l.worldAt || !l.worldAt[0] || !l.worldAt[2]) return false
    const dx = l.worldAt[2][0] - l.worldAt[0][0]; const dy = l.worldAt[2][1] - l.worldAt[0][1]
    return Math.sqrt(dx * dx + dy * dy) > 40
  })
  check('E1: >=2 bodies actually orbit (comp-space move > 40px)', movers.length >= 2, movers.map(l => l.name).join(', ') || 'nothing moves')
  // Sun stays near center
  const sun = d.layers.find(l => /солн|sun/i.test(l.name)) || null
  if (sun && sun.worldAt && sun.worldAt[0]) {
    const dx = sun.worldAt[0][0] - 960; const dy = sun.worldAt[0][1] - 540
    check('E1: sun near center', Math.sqrt(dx * dx + dy * dy) < 200, 'sun at ' + JSON.stringify(sun.worldAt[0]))
  } else {
    check('E1: sun layer identifiable', false, 'no layer named like sun/солнце: ' + d.layers.map(l => l.name).join(', '))
  }
  // The moon must orbit a PLANET, not the sun: its distance to the nearest
  // planet body should stay roughly constant and small-ish across samples.
  // (Live round-6: cancelling parent-space offsets left the moon-orbit null
  // sitting exactly at the sun — moon "moved" but orbited the wrong center.)
  checkMoonNearPlanet('E1', d)

  log('\n--- E2: speed up moon ---')
  const e2 = await runAgentTurn(history,
    'луна крутится скучно — ускорь её раза в три и сделай орбиту луны чуть шире',
    8 * 60 * 1000)
  recordTurn('E2-moon', 'speed up moon orbit', e2)
  const d2 = await structProbe([0.5, 2, 4])
  const errs2 = d2.layers.filter(l => ['position', 'rotation', 'scale', 'opacity'].some(k => l[k] && l[k].exprError))
  check('E2: still no expression errors', errs2.length === 0, errs2.map(l => l.name).join(','))
  const moon = d2.layers.find(l => /лун|moon/i.test(l.name))
  // Max PAIRWISE distance across samples — a 3x-faster orbit can alias back to
  // the same phase at two of the sample times (seen live: t=0.5 and t=4 equal,
  // t=2 wildly different), so comparing only first/last gives false negatives.
  const maxMove = moon && moon.worldAt ? maxPairwiseDist(moon.worldAt) : 0
  check('E2: moon still exists and moves', !!moon && maxMove > 20,
    moon ? 'maxMove=' + Math.round(maxMove) + ' worldAt=' + JSON.stringify(moon.worldAt) : 'no moon layer')
  checkMoonNearPlanet('E2', d2)
}

function maxPairwiseDist (pts) {
  let m = 0
  const ok = (pts || []).filter(p => p && p.length === 2)
  for (let i = 0; i < ok.length; i++) {
    for (let j = i + 1; j < ok.length; j++) {
      m = Math.max(m, Math.hypot(ok[j][0] - ok[i][0], ok[j][1] - ok[i][1]))
    }
  }
  return m
}

function checkMoonNearPlanet (label, d) {
  const moon = d.layers.find(l => /лун|moon/i.test(l.name) && !l.nullLayer)
  const planets = d.layers.filter(l => /планет|planet/i.test(l.name) && !l.nullLayer && !/orbit|орбит/i.test(l.name))
  if (!moon || !moon.worldAt || planets.length === 0) {
    check(label + ': moon orbits a planet', false, 'moon=' + (moon && moon.name) + ' planets=' + planets.map(p => p.name).join(','))
    return
  }
  // For SOME planet: distance moon<->planet stays < 450px and roughly constant
  // (max/min ratio < 2) across all sample times — i.e. the moon circles it.
  const verdicts = planets.map(p => {
    const dists = moon.worldAt.map((mw, i) => {
      const pw = p.worldAt && p.worldAt[i]
      return (mw && pw) ? Math.hypot(mw[0] - pw[0], mw[1] - pw[1]) : null
    }).filter(x => x !== null)
    if (!dists.length) return { p: p.name, ok: false, dists }
    const mx = Math.max(...dists); const mn = Math.min(...dists)
    return { p: p.name, ok: mx < 450 && (mn === 0 || mx / Math.max(mn, 1) < 2), dists: dists.map(x => Math.round(x)) }
  })
  check(label + ': moon orbits a planet (stays near one, ~constant radius)', verdicts.some(v => v.ok),
    verdicts.map(v => v.p + ':' + JSON.stringify(v.dists)).join(' '))
}

// ── Session F: layer management with shifting indexes ────────────────────
async function sessionF () {
  log('\n=== SESSION F: управление слоями — удаление/переименование/тайминг ===')
  await wipeComp()
  const history = []

  log('\n--- F1: six bars ---')
  const f1 = await runAgentTurn(history,
    'сделай 6 вертикальных цветных полос во весь экран, как радуга, рядом друг с другом без зазоров. назови их Bar 1 ... Bar 6 слева направо',
    8 * 60 * 1000)
  recordTurn('F1-bars', 'six bars', f1)
  let d = await structProbe([1])
  check('F1: 6 bars created', d.numLayers >= 6, 'numLayers=' + d.numLayers)
  const barNames = d.layers.map(l => l.name)
  check('F1: named Bar 1..6', ['Bar 1', 'Bar 6'].every(n => barNames.includes(n)), JSON.stringify(barNames))

  log('\n--- F2: delete 2nd and 5th, rename 3rd, raise it ---')
  const f2 = await runAgentTurn(history,
    'удали вторую и пятую полосу, а третью переименуй в Hero и подними на самый верх',
    8 * 60 * 1000)
  recordTurn('F2-manage', 'delete 2+5, rename 3 to Hero, raise', f2)
  d = await structProbe([1])
  const names2 = d.layers.map(l => l.name)
  check('F2: 4 layers remain', d.numLayers === 4, 'numLayers=' + d.numLayers + ' ' + JSON.stringify(names2))
  check('F2: Bar 2 and Bar 5 gone', !names2.includes('Bar 2') && !names2.includes('Bar 5'), JSON.stringify(names2))
  check('F2: Hero exists (renamed Bar 3)', names2.includes('Hero') && !names2.includes('Bar 3'), JSON.stringify(names2))
  check('F2: Hero on top', d.layers[0] && d.layers[0].name === 'Hero', 'top=' + (d.layers[0] && d.layers[0].name))

  log('\n--- F3: stagger starts ---')
  const f3 = await runAgentTurn(history,
    'пусть полосы появляются по очереди: каждая следующая стартует на 0.4 секунды позже предыдущей, сверху вниз',
    8 * 60 * 1000)
  recordTurn('F3-stagger', 'stagger layer starts 0.4s', f3)
  d = await structProbe([1])
  // "появляются по очереди" is satisfiable several valid ways: staggered
  // in-points OR staggered appearance keyframes (opacity/scale first key).
  // Order is ambiguous too — "сверху вниз" can mean the per-bar reveal
  // direction (anchor-top scale-Y wipe, seen live) with a left-to-right
  // sequence, so accept the {0,0.4,0.8,1.2} time-set in ANY layer order.
  const inPoints = d.layers.map(l => l.inPoint)
  const setBy04 = arr => {
    if (arr.length !== 4 || arr.some(v => v === null || v === undefined)) return false
    const s = [...arr].sort((a, b) => a - b)
    return s.slice(1).every((v, i) => Math.abs((v - s[i]) - 0.4) < 0.12)
  }
  const opKeys = d.layers.map(l => (l.opacity && l.opacity.firstKeyTime))
  const scKeys = d.layers.map(l => (l.scale && l.scale.firstKeyTime))
  check('F3: staggered by ~0.4s (in-points or first keys, any order)',
    setBy04(inPoints) || setBy04(opKeys) || setBy04(scKeys),
    'inPoints=' + JSON.stringify(inPoints) + ' opFirstKeys=' + JSON.stringify(opKeys) + ' scFirstKeys=' + JSON.stringify(scKeys))
}

// ── Session G: precompose + time remap ───────────────────────────────────
async function sessionG () {
  log('\n=== SESSION G: precompose + time remap ===')
  await wipeComp()
  // Stale "Pulse" precomps from previous G runs accumulate in the project and
  // break open_comp by name ("3 compositions are named Pulse"). Remove them
  // (exact name match only — wipeComp above already detached any layer usage).
  await probe(`(function(){
    var removed = 0;
    for (var i = app.project.numItems; i >= 1; i--) {
      var it = app.project.item(i);
      if (it instanceof CompItem && it.name === 'Pulse') { it.remove(); removed++; }
    }
    return resultToJson({ ok: true, removed: removed });
  })()`)
  const history = []

  log('\n--- G1: pulsing circle ---')
  const g1 = await runAgentTurn(history,
    'сделай кружок в центре, который пульсирует — увеличивается и уменьшается примерно раз в секунду, плавно',
    8 * 60 * 1000)
  recordTurn('G1-pulse', 'pulsing circle', g1)
  let d = await structProbe([1])
  check('G1: circle exists with scale animation', d.numLayers >= 1 && d.layers.some(l => l.scale && (l.scale.numKeys >= 3 || /Math\.sin|wiggle|loopOut/i.test(l.scale.expr))), d.layers.map(l => l.name + ' scaleKeys=' + (l.scale ? l.scale.numKeys : '?') + ' expr=' + (l.scale && l.scale.expr ? 'yes' : 'no')).join('; '))

  log('\n--- G2: precompose + slow down 2x ---')
  const g2 = await runAgentTurn(history,
    'упакуй этот кружок в прекомпоз с названием Pulse, а потом замедли пульсацию в два раза через time remap',
    8 * 60 * 1000)
  recordTurn('G2-precomp', 'precompose Pulse + 2x slow time remap', g2)
  d = await structProbe([2, 4])
  const pre = d.layers.find(l => l.sourceIsComp)
  check('G2: layer is a precomp', !!pre, pre ? pre.name + ' -> ' + pre.sourceName : 'no comp-source layer: ' + d.layers.map(l => l.name).join(', '))
  check('G2: precomp named Pulse', !!(pre && /pulse/i.test(pre.sourceName + ' ' + pre.name)), pre ? pre.sourceName : '')
  const remapOk = pre && pre.timeRemap && pre.timeRemap.numKeys >= 2
  check('G2: time remap enabled with keys', !!remapOk, pre && pre.timeRemap ? JSON.stringify(pre.timeRemap) : 'no remap')
  if (remapOk) {
    // half speed: remap(t) ≈ t/2 -> at t=4 remapped ~2 (allow generous tolerance / offset)
    const v4 = pre.timeRemap.vals.find(v => v[0] === 4)
    const slope = v4 ? v4[1] / 4 : null
    check('G2: remap slope ~0.5 (2x slower)', slope !== null && slope > 0.3 && slope < 0.7, 'remap(4)=' + (v4 && v4[1]) + ' slope=' + (slope && slope.toFixed(2)))
  }
}

// ── Session H: stopwatch text + comp markers ─────────────────────────────
async function sessionH () {
  log('\n=== SESSION H: секундомер (формат мм:сс) + маркеры ===')
  await wipeComp()
  const history = []

  log('\n--- H1: stopwatch ---')
  const h1 = await runAgentTurn(history,
    'добавь секундомер: текст сверху по центру, показывает время с начала композиции в формате мм:сс, с ведущими нулями, обновляется каждую секунду',
    8 * 60 * 1000)
  recordTurn('H1-stopwatch', 'stopwatch mm:ss', h1)
  const t = await textAtTimes([0, 5, 11])
  check('H1: text layer with expression', !!(t && t.ok && t.expr), t && t.ok ? t.expr.slice(0, 100) : JSON.stringify(t).slice(0, 200))
  check('H1: no expression error', !(t && t.exprError), t && t.exprError)
  if (t && t.ok && t.values) {
    check('H1: values 00:00 / 00:05 / 00:11 (padded)',
      t.values[0] === '00:00' && t.values[1] === '00:05' && t.values[2] === '00:11',
      'values=' + JSON.stringify(t.values))
  }

  log('\n--- H2: markers every 3s ---')
  const h2 = await runAgentTurn(history,
    'поставь на композицию маркеры каждые 3 секунды с подписями типа "3 сек", "6 сек" и так далее',
    8 * 60 * 1000)
  recordTurn('H2-markers', 'comp markers every 3s', h2)
  const d = await structProbe([1])
  const times = d.compMarkers.map(m => m.t)
  const expected = [3, 6, 9]
  const haveAll = expected.every(x => times.some(tm => Math.abs(tm - x) < 0.2))
  check('H2: comp markers at 3/6/9s', haveAll, 'markers=' + JSON.stringify(d.compMarkers))
  const labeled = d.compMarkers.filter(m => m.comment && m.comment.length > 0)
  check('H2: markers have labels', labeled.length >= 3, JSON.stringify(d.compMarkers.map(m => m.comment)))
}

// ── Session I: Checkbox Control day/night toggle ─────────────────────────
async function sessionI () {
  log('\n=== SESSION I: Checkbox Control — день/ночь ===')
  await wipeComp()
  const history = []

  log('\n--- I1: day/night toggle rig ---')
  const i1 = await runAgentTurn(history,
    'сделай сцену день-ночь: голубой фон и жёлтое солнце сверху. добавь на отдельный контроллер галочку (checkbox) Day: когда она включена — день, солнце видно; когда выключена — солнце прячется и фон темнеет. всё через выражения, чтобы переключалось одной галочкой',
    10 * 60 * 1000)
  recordTurn('I1-daynight', 'checkbox day/night rig', i1)
  const d = await structProbe([2])
  const boxLayer = d.layers.find(l => l.effects.some(e => e.matchName === 'ADBE Checkbox Control'))
  check('I1: Checkbox Control exists', !!boxLayer, boxLayer ? boxLayer.name : d.layers.map(l => l.name + ':' + JSON.stringify(l.effects.map(e => e.matchName))).join('; '))
  const exprLayers = d.layers.filter(l => ['opacity', 'position', 'scale'].some(k => l[k] && /Checkbox|checkbox|Day/i.test(l[k].expr)))
  check('I1: expressions reference the checkbox', exprLayers.length >= 1, exprLayers.map(l => l.name).join(', ') || 'no layer expression mentions the checkbox')
  const errsI = d.layers.filter(l => ['position', 'rotation', 'scale', 'opacity'].some(k => l[k] && l[k].exprError))
  check('I1: no expression errors', errsI.length === 0, errsI.map(l => l.name).join(','))

  // Functional toggle test: sun visibility must actually flip with the box.
  const on = await toggleCheckboxAndSample(1)
  const off = await toggleCheckboxAndSample(0)
  if (on && on.ok && off && off.ok) {
    const sunOn = on.layers.find(l => /солн|sun/i.test(l.name))
    const sunOff = off.layers.find(l => /солн|sun/i.test(l.name))
    const flips = sunOn && sunOff && sunOn.opacityAt2 !== null && sunOff.opacityAt2 !== null &&
      (sunOn.opacityAt2 - sunOff.opacityAt2) > 50
    check('I1: sun visibility flips with the checkbox', !!flips,
      'on=' + (sunOn && sunOn.opacityAt2) + ' off=' + (sunOff && sunOff.opacityAt2) +
      (sunOn ? '' : ' (no sun-named layer: ' + on.layers.map(l => l.name).join(', ') + ')'))
    // restore ON state
    await toggleCheckboxAndSample(1)
  } else {
    check('I1: checkbox toggle probe', false, JSON.stringify(on).slice(0, 150) + ' / ' + JSON.stringify(off).slice(0, 150))
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main () {
  await connectCDP()
  log('CDP connected')
  report.model = modelOverride || await evalInPanel('(window.EXTENSIONS_LLM_CHAT_CONFIG && window.EXTENSIONS_LLM_CHAT_CONFIG.defaultModel) || "?"')
  log('Model: ' + report.model)
  await ensureComp()

  const sessions = { E: sessionE, F: sessionF, G: sessionG, H: sessionH, I: sessionI }
  for (const [name, fn] of Object.entries(sessions)) {
    if (sessionFilter && name !== sessionFilter) continue
    try {
      await fn()
    } catch (e) {
      finding('session-crash', 'Session ' + name + ' crashed', String(e && e.message))
    }
  }

  report.finishedAt = new Date().toISOString()
  const outPath = path.join(__dirname, `hunt6-report-${Date.now()}.json`)
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
  log('\n=== DONE ===')
  log('Findings: ' + report.findings.length)
  for (const f of report.findings) log('  - [' + f.severity + '] ' + f.title)
  log('Report: ' + outPath)
  closeCDP()
}

main().catch(e => { console.error('FATAL: ' + e.message); closeCDP(); process.exit(1) })
