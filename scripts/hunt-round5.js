#!/usr/bin/env node
/**
 * Bug-hunt round 5 — "whole agent" stress test on the live AE panel.
 *
 * Focus (vs golden scenarios): human-style prompts, LARGE layer counts,
 * slider controllers, complex expressions and cross-layer dependencies,
 * multi-turn conversation continuity, bulk edits, error diagnosis.
 *
 * Usage: node scripts/hunt-round5.js [--model <id>] [--session A|B|C]
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

// ── CDP layer ────────────────────────────────────────────────────────────
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

async function runToolCall (toolName, toolArgs = {}) {
  return fireAndPoll(`window.HOST_BRIDGE.executeToolCall(${JSON.stringify(toolName)}, ${JSON.stringify(toolArgs)})`, 1000, 60000)
}

/** Evaluate raw ExtendScript (source passed safely via JSON.stringify). */
async function probe (extendScriptSrc, timeoutMs = 30000) {
  return fireAndPoll(`window.HOST_BRIDGE.evalHostFunction(${JSON.stringify(extendScriptSrc)})`, 1000, timeoutMs)
}

// ── Agent turn with conversation history ─────────────────────────────────
/**
 * history: array of {role, content} text messages (like main.js session
 * history). Mutated: user prompt + assistant reply appended.
 */
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
const COMP = 'Hunt5-Comp'

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
    app.endUndoGroup();
    return resultToJson({ ok: true, removed: n });
  })()`)
  if (!r || r.ok !== true) throw new Error('wipeComp failed: ' + JSON.stringify(r))
}

/** Deep probe of every layer: transforms, keys, expressions, effects. */
async function deepProbe () {
  return probe(`(function(){
    var c = app.project.activeItem;
    if (!c || !(c instanceof CompItem)) return resultToJson({ ok: false, message: 'no comp' });
    function propInfo (p, tEval) {
      if (!p) return null;
      var o = {
        numKeys: p.numKeys,
        expr: p.expression ? String(p.expression).slice(0, 160) : '',
        exprEnabled: p.expressionEnabled === true,
        exprError: p.expressionError ? String(p.expressionError).slice(0, 160) : ''
      };
      try { o.value = p.value; } catch (e) { o.value = null; }
      if (p.numKeys > 0) { o.firstKeyTime = p.keyTime(1); o.lastKeyTime = p.keyTime(p.numKeys); }
      if (tEval !== undefined) { try { o.evalAtT = p.valueAtTime(tEval, false); } catch (e2) {} }
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
          if (ef.matchName === 'ADBE Slider Control') {
            try { einfo.sliderValue = ef.property(1).value; } catch (e3) {}
          }
          effects.push(einfo);
        }
      }
      layers.push({
        index: i,
        name: L.name,
        nullLayer: L.nullLayer === true,
        parentIndex: L.parent ? L.parent.index : 0,
        inPoint: L.inPoint,
        position: propInfo(t.property('ADBE Position'), 2),
        scale: propInfo(t.property('ADBE Scale')),
        rotation: propInfo(t.property('ADBE Rotate Z'), 2),
        opacity: propInfo(t.property('ADBE Opacity')),
        effects: effects
      });
    }
    return resultToJson({ ok: true, numLayers: c.numLayers, layers: layers });
  })()`, 60000)
}

async function textAtTimes (layerNamePattern, times) {
  return probe(`(function(){
    var c = app.project.activeItem;
    if (!c || !(c instanceof CompItem)) return resultToJson({ ok: false, message: 'no comp' });
    var target = null;
    for (var i = 1; i <= c.numLayers; i++) {
      var L = c.layer(i);
      if (L.name.toLowerCase().indexOf(${JSON.stringify(layerNamePattern.toLowerCase())}) !== -1 || (L instanceof TextLayer)) { target = L; if (L instanceof TextLayer) break; }
    }
    if (!target) return resultToJson({ ok: false, message: 'text layer not found' });
    var st = target.property('ADBE Text Properties').property('ADBE Text Document');
    var times = ${JSON.stringify(times)};
    var vals = [];
    for (var k = 0; k < times.length; k++) {
      try { vals.push(String(st.valueAtTime(times[k], false).text)); } catch (e) { vals.push('ERR:' + e.toString()); }
    }
    return resultToJson({ ok: true, layer: target.name, expr: st.expression ? String(st.expression).slice(0, 200) : '', exprError: st.expressionError ? String(st.expressionError) : '', values: vals });
  })()`)
}

// ── Session A: grid + slider rig + bulk edit ─────────────────────────────
async function sessionA () {
  log('\n=== SESSION A: сетка 5x4, слайдеры, wiggle, bulk edit ===')
  await wipeComp()
  const history = []

  // A1 — large layer count + stagger
  log('\n--- A1: grid 5x4 wave ---')
  const a1 = await runAgentTurn(history,
    'сделай сетку 5 на 4 из разноцветных квадратиков на весь кадр и анимируй их появление волной слева направо — каждый столбик появляется чуть позже предыдущего',
    8 * 60 * 1000)
  recordTurn('A1-grid', 'grid 5x4 wave', a1)
  let d = await deepProbe()
  const squares = d.layers.filter(l => !l.nullLayer && l.effects.every(e => e.matchName !== 'ADBE Slider Control'))
  check('A1: >=20 layers created', d.numLayers >= 20, 'numLayers=' + d.numLayers)
  const animated = squares.filter(l => (l.opacity && l.opacity.numKeys >= 2) || (l.scale && l.scale.numKeys >= 2) || (l.position && l.position.numKeys >= 2))
  check('A1: squares animated (opacity/scale/position keys)', animated.length >= 18, animated.length + '/' + squares.length + ' animated')
  // stagger: group first key times by x position, expect increasing with x
  const withKeys = animated.map(l => ({
    x: (l.position && l.position.value && l.position.value[0]) || 0,
    t: (l.opacity && l.opacity.numKeys >= 2 ? l.opacity.firstKeyTime : (l.scale && l.scale.numKeys >= 2 ? l.scale.firstKeyTime : (l.position ? l.position.firstKeyTime : 0)))
  }))
  withKeys.sort((p, q) => p.x - q.x)
  let monotonicOk = withKeys.length > 0
  for (let i = 1; i < withKeys.length; i++) {
    if (withKeys[i].x > withKeys[i - 1].x + 1 && withKeys[i].t < withKeys[i - 1].t - 0.001) { monotonicOk = false; break }
  }
  const tSpread = withKeys.length ? (withKeys[withKeys.length - 1].t - withKeys[0].t) : 0
  check('A1: wave is staggered left->right', monotonicOk && tSpread > 0.1, 'timeSpread=' + tSpread.toFixed(2) + 's monotonic=' + monotonicOk)

  // A2 — slider controller driving rotation of all squares
  log('\n--- A2: Speed slider -> rotation of all ---')
  const a2 = await runAgentTurn(history,
    'добавь контроллер со слайдером Speed и сделай, чтобы все квадратики крутились со скоростью из этого слайдера — одним слайдером менять скорость вращения у всех сразу. поставь скорость 90 градусов в секунду',
    8 * 60 * 1000)
  recordTurn('A2-slider', 'Speed slider drives rotation', a2)
  d = await deepProbe()
  const ctrl = d.layers.find(l => l.effects.some(e => e.matchName === 'ADBE Slider Control'))
  check('A2: controller with slider exists', !!ctrl, ctrl ? ctrl.name + ' sliders=' + JSON.stringify(ctrl.effects.filter(e => e.matchName === 'ADBE Slider Control')) : 'none found')
  const sq2 = d.layers.filter(l => l !== ctrl && !l.nullLayer)
  const withRotExpr = sq2.filter(l => l.rotation && l.rotation.expr && l.rotation.exprEnabled)
  check('A2: rotation expressions on all squares', withRotExpr.length >= sq2.length - 1, withRotExpr.length + '/' + sq2.length)
  const exprErrs = sq2.filter(l => l.rotation && l.rotation.exprError)
  check('A2: no expression errors', exprErrs.length === 0, exprErrs.length ? exprErrs[0].name + ': ' + exprErrs[0].rotation.exprError : '')
  const rotating = withRotExpr.filter(l => l.rotation.evalAtT !== undefined && Math.abs(l.rotation.evalAtT - (l.rotation.value || 0)) > 10)
  check('A2: rotation actually evaluates (moves by t=2)', rotating.length >= Math.floor(withRotExpr.length * 0.9), rotating.length + '/' + withRotExpr.length + ' rotating at t=2')

  // A3 — second slider, wiggle on position
  log('\n--- A3: wiggle amplitude slider ---')
  const a3 = await runAgentTurn(history,
    'класс. теперь пусть квадратики ещё слегка плавают по позиции, типа wiggle, а амплитуду вынеси вторым слайдером Amplitude на тот же контроллер, поставь амплитуду 30',
    8 * 60 * 1000)
  recordTurn('A3-wiggle', 'wiggle amplitude slider', a3)
  d = await deepProbe()
  const ctrl3 = d.layers.find(l => l.effects.filter(e => e.matchName === 'ADBE Slider Control').length >= 2)
  check('A3: controller has 2 sliders', !!ctrl3, ctrl3 ? JSON.stringify(ctrl3.effects) : 'no layer with 2 sliders')
  const sq3 = d.layers.filter(l => !l.nullLayer && !l.effects.some(e => e.matchName === 'ADBE Slider Control'))
  const withPosExpr = sq3.filter(l => l.position && /wiggle/i.test(l.position.expr) && l.position.exprEnabled)
  check('A3: wiggle on positions', withPosExpr.length >= sq3.length - 1, withPosExpr.length + '/' + sq3.length)
  const posErrs = sq3.filter(l => l.position && l.position.exprError)
  check('A3: no position expression errors', posErrs.length === 0, posErrs.length ? posErrs[0].name + ': ' + posErrs[0].position.exprError : '')

  // A4 — bulk edit of existing rig
  log('\n--- A4: bulk move + shrink ---')
  const before = d.layers.filter(l => !l.nullLayer && !l.effects.some(e => e.matchName === 'ADBE Slider Control'))
    .map(l => ({ name: l.name, y: l.position && l.position.value ? l.position.value[1] : null, s: l.scale && l.scale.value ? l.scale.value[0] : null, sKeys: l.scale ? l.scale.numKeys : 0 }))
  const a4 = await runAgentTurn(history,
    'подними всю сетку на 80 пикселей выше и сделай квадратики на 30 процентов меньше, анимацию появления не сломай',
    8 * 60 * 1000)
  recordTurn('A4-bulk', 'bulk move up 80px + shrink 30%', a4)
  d = await deepProbe()
  const after = d.layers.filter(l => !l.nullLayer && !l.effects.some(e => e.matchName === 'ADBE Slider Control'))
  let movedOk = 0; let shrunkOk = 0; let compared = 0
  for (const b of before) {
    const a = after.find(l => l.name === b.name)
    if (!a || b.y === null) continue
    compared++
    const ay = a.position && a.position.value ? a.position.value[1] : null
    if (ay !== null && Math.abs((b.y - ay) - 80) < 5) movedOk++
    // scale: static value or final keyed value scaled ~0.7x
    const as = a.scale && a.scale.value ? a.scale.value[0] : null
    if (as !== null && b.s !== null && b.s !== 0 && Math.abs(as / b.s - 0.7) < 0.06) shrunkOk++
  }
  check('A4: all squares moved up 80px', movedOk >= compared - 1, movedOk + '/' + compared)
  check('A4: all squares shrunk ~30%', shrunkOk >= compared - 1, shrunkOk + '/' + compared + ' (scale keys may need per-key scaling)')
  const stillAnimated = after.filter(l => (l.opacity && l.opacity.numKeys >= 2) || (l.scale && l.scale.numKeys >= 2) || (l.position && l.position.numKeys >= 2))
  check('A4: intro animation preserved', stillAnimated.length >= animated.length - 1, stillAnimated.length + ' vs ' + animated.length + ' before')
}

// ── Session B: dependency chain + counter ────────────────────────────────
async function sessionB () {
  log('\n=== SESSION B: цепочка зависимостей (хвост), счётчик ===')
  await wipeComp()
  const history = []

  log('\n--- B1: comet tail (8 circles, delay chain) ---')
  const b1 = await runAgentTurn(history,
    'сделай 8 маленьких кружков: первый летает по кругу в центре экрана, а каждый следующий повторяет движение предыдущего с задержкой 0.15 секунды — как хвост кометы. и пусть хвост постепенно уменьшается и бледнеет',
    8 * 60 * 1000)
  recordTurn('B1-tail', 'comet tail chain', b1)
  const d = await deepProbe()
  const circles = d.layers.filter(l => !l.nullLayer)
  check('B1: 8 circles', circles.length >= 8, 'layers=' + d.numLayers)
  const leader = circles[circles.length - 1] // bottom-most is often the leader; check any layer with circular motion instead
  const withMotion = circles.filter(l => l.position && (l.position.expr || l.position.numKeys >= 2))
  check('B1: all circles have motion (expr or keys)', withMotion.length >= 8, withMotion.length + '/' + circles.length)
  const followers = circles.filter(l => l.position && /valueAtTime/i.test(l.position.expr))
  check('B1: followers use valueAtTime chain', followers.length >= 6, followers.length + ' layers with valueAtTime')
  const errs = circles.filter(l => (l.position && l.position.exprError) || (l.scale && l.scale.exprError) || (l.opacity && l.opacity.exprError))
  check('B1: no expression errors', errs.length === 0, errs.length ? errs.map(e => e.name).join(',') : '')
  // lag: evaluated positions at t=2 must differ between consecutive followers
  const evals = circles.filter(l => l.position && l.position.evalAtT).map(l => l.position.evalAtT)
  let distinct = 0
  for (let i = 1; i < evals.length; i++) {
    const dx = evals[i][0] - evals[i - 1][0]; const dy = evals[i][1] - evals[i - 1][1]
    if (Math.sqrt(dx * dx + dy * dy) > 2) distinct++
  }
  check('B1: followers actually lag (distinct positions at t=2)', distinct >= 5, distinct + ' distinct gaps')

  log('\n--- B2: counter 0->100 ---')
  const b2 = await runAgentTurn(history,
    'добавь счётчик: текст по центру сверху, отсчитывает от 0 до 100 за первые 3 секунды, потом просто остаётся 100. без дробей, целые числа',
    8 * 60 * 1000)
  recordTurn('B2-counter', 'counter text 0->100', b2)
  const t = await textAtTimes('счет', [0, 1.5, 3, 5])
  check('B2: text layer with expression', !!(t && t.ok && t.expr), t && t.expr ? t.expr.slice(0, 80) : JSON.stringify(t).slice(0, 200))
  check('B2: no expression error', !(t && t.exprError), t && t.exprError)
  if (t && t.ok && t.values) {
    const v = t.values.map(s => parseInt(String(s).replace(/\D+/g, ''), 10))
    check('B2: counts 0 -> ~50 -> 100 -> stays 100',
      v[0] <= 5 && Math.abs(v[1] - 50) <= 10 && v[2] >= 95 && v[3] >= 95 && v[3] <= 105,
      'values=' + JSON.stringify(t.values))
  }
}

// ── Session C: diagnose & repair broken expressions ──────────────────────
async function sessionC () {
  log('\n=== SESSION C: диагностика сломанных выражений ===')
  await wipeComp()
  // Setup: build a small rig with TWO broken expressions (bad layer ref + syntax error)
  await probe(`(function(){
    var c = app.project.activeItem;
    app.beginUndoGroup('hunt-c-setup');
    var s1 = c.layers.addSolid([0.8, 0.2, 0.2], 'Красный блок', 300, 300, 1);
    var s2 = c.layers.addSolid([0.2, 0.4, 0.9], 'Синий блок', 300, 300, 1);
    s1.property('ADBE Transform Group').property('ADBE Position').setValue([600, 540]);
    s2.property('ADBE Transform Group').property('ADBE Position').setValue([1320, 540]);
    try { s2.property('ADBE Transform Group').property('ADBE Position').expression = 'thisComp.layer("Контроллер которого нет").transform.position + [0, 100]'; } catch (e) {}
    try { s1.property('ADBE Transform Group').property('ADBE Rotate Z').expression = 'time * ; 45'; } catch (e2) {}
    app.endUndoGroup();
    return resultToJson({ ok: true });
  })()`)
  const pre = await deepProbe()
  const preBroken = pre.layers.filter(l => (l.position && l.position.exprError) || (l.rotation && l.rotation.exprError))
  log('  setup: ' + preBroken.length + ' layers with broken expressions')

  const history = []
  const c1 = await runAgentTurn(history,
    'у меня в композиции что-то сломалось, слои с ошибками выражений, всё жёлтым мигает. найди что сломано и почини, движение должно остаться осмысленным',
    8 * 60 * 1000)
  recordTurn('C1-repair', 'diagnose and fix broken expressions', c1)
  const post = await deepProbe()
  const postBroken = post.layers.filter(l =>
    (l.position && l.position.exprError && l.position.exprEnabled) ||
    (l.rotation && l.rotation.exprError && l.rotation.exprEnabled))
  check('C1: broken expressions fixed', postBroken.length === 0,
    postBroken.map(l => l.name + ': pos=' + (l.position && l.position.exprError) + ' rot=' + (l.rotation && l.rotation.exprError)).join('; '))
  check('C1: agent reported the problem honestly', /вырaжени|expression|почин|исправ|fix/i.test(String(c1.content)), String(c1.content).slice(0, 200))
}

// ── Session D: heavy load (48 layers) + conditional bulk edit ────────────
async function shapeFillColors () {
  return probe(`(function(){
    var c = app.project.activeItem;
    if (!c || !(c instanceof CompItem)) return resultToJson({ ok: false, message: 'no comp' });
    function findFill (group) {
      for (var i = 1; i <= group.numProperties; i++) {
        var p = group.property(i);
        if (p.matchName === 'ADBE Vector Graphic - Fill') {
          try { return p.property('ADBE Vector Fill Color').value; } catch (e) { return null; }
        }
        if (p.numProperties !== undefined && p.numProperties > 0) {
          var r = findFill(p);
          if (r) return r;
        }
      }
      return null;
    }
    var out = [];
    for (var i2 = 1; i2 <= c.numLayers; i2++) {
      var L = c.layer(i2);
      var root = L.property('ADBE Root Vectors Group');
      var col = root ? findFill(root) : null;
      out.push({ index: i2, name: L.name, fill: col });
    }
    return resultToJson({ ok: true, layers: out });
  })()`, 60000)
}

async function sessionD () {
  log('\n=== SESSION D: 48 слоёв, диагональная волна, условный bulk ===')
  await wipeComp()
  const history = []

  log('\n--- D1: grid 8x6 diagonal wave ---')
  const d1 = await runAgentTurn(history,
    'сделай сетку 8 на 6 из маленьких квадратиков на весь кадр и анимируй появление волной по диагонали — от левого верхнего угла к правому нижнему',
    12 * 60 * 1000)
  recordTurn('D1-grid48', 'grid 8x6 diagonal wave', d1)
  let d = await deepProbe()
  const sq = d.layers.filter(l => !l.nullLayer && !l.effects.some(e => e.matchName === 'ADBE Slider Control'))
  check('D1: >=48 layers created', sq.length >= 48, 'squares=' + sq.length + ' total=' + d.numLayers)
  const animated = sq.filter(l => (l.opacity && l.opacity.numKeys >= 2) || (l.scale && l.scale.numKeys >= 2) || (l.position && l.position.numKeys >= 2))
  check('D1: squares animated', animated.length >= sq.length - 2, animated.length + '/' + sq.length)
  // diagonal stagger: first key time should correlate with x+y
  const pts = animated.map(l => ({
    d: ((l.position && l.position.value) ? l.position.value[0] + l.position.value[1] : 0),
    t: (l.opacity && l.opacity.numKeys >= 2 ? l.opacity.firstKeyTime : (l.scale && l.scale.numKeys >= 2 ? l.scale.firstKeyTime : l.position.firstKeyTime))
  }))
  const n = pts.length
  let corr = 0
  if (n > 2) {
    const mx = pts.reduce((s, p) => s + p.d, 0) / n
    const my = pts.reduce((s, p) => s + p.t, 0) / n
    let sxy = 0; let sxx = 0; let syy = 0
    for (const p of pts) { sxy += (p.d - mx) * (p.t - my); sxx += (p.d - mx) ** 2; syy += (p.t - my) ** 2 }
    corr = (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : 0
  }
  check('D1: diagonal stagger (corr(x+y, keyTime) > 0.6)', corr > 0.6, 'corr=' + corr.toFixed(2))

  log('\n--- D2: conditional bulk edit (every 2nd color + opposite spin) ---')
  const d2 = await runAgentTurn(history,
    'теперь перекрась каждый второй квадратик в оранжевый, и пусть чётные квадратики медленно крутятся по часовой, а нечётные — против часовой',
    12 * 60 * 1000)
  recordTurn('D2-conditional', 'every 2nd orange + opposite spins', d2)
  d = await deepProbe()
  const sq2 = d.layers.filter(l => !l.nullLayer && !l.effects.some(e => e.matchName === 'ADBE Slider Control'))
  const spinning = sq2.filter(l => l.rotation && l.rotation.evalAtT !== undefined && Math.abs(l.rotation.evalAtT - (l.rotation.value || 0)) > 1)
  const cw = spinning.filter(l => l.rotation.evalAtT > (l.rotation.value || 0)).length
  const ccw = spinning.filter(l => l.rotation.evalAtT < (l.rotation.value || 0)).length
  check('D2: all squares spin', spinning.length >= sq2.length - 2, spinning.length + '/' + sq2.length)
  check('D2: half clockwise, half counter-clockwise', Math.abs(cw - ccw) <= 4 && cw > 0 && ccw > 0, 'cw=' + cw + ' ccw=' + ccw)
  const rotErrs = sq2.filter(l => l.rotation && l.rotation.exprError)
  check('D2: no rotation expression errors', rotErrs.length === 0, rotErrs.map(l => l.name).join(','))
  const fills = await shapeFillColors()
  if (fills && fills.ok) {
    const cols = fills.layers.filter(l => l.fill).map(l => l.fill.slice(0, 3).map(v => Math.round(v * 10) / 10).join(','))
    const distinct = [...new Set(cols)]
    const orange = cols.filter(s => { const [r, g, b] = s.split(',').map(Number); return r > 0.7 && g > 0.2 && g < 0.8 && b < 0.4 }).length
    check('D2: ~half squares recolored orange', orange >= Math.floor(cols.length * 0.4) && orange <= Math.ceil(cols.length * 0.6), 'orange=' + orange + '/' + cols.length + ' distinctColors=' + distinct.length)
  } else {
    check('D2: fill color probe', false, JSON.stringify(fills).slice(0, 200))
  }
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main () {
  await connectCDP()
  log('CDP connected')
  report.model = modelOverride || await evalInPanel('(window.EXTENSIONS_LLM_CHAT_CONFIG && window.EXTENSIONS_LLM_CHAT_CONFIG.defaultModel) || "?"')
  log('Model: ' + report.model)
  await ensureComp()

  const sessions = { A: sessionA, B: sessionB, C: sessionC, D: sessionD }
  for (const [name, fn] of Object.entries(sessions)) {
    if (sessionFilter && name !== sessionFilter) continue
    try {
      await fn()
    } catch (e) {
      finding('session-crash', 'Session ' + name + ' crashed', String(e && e.message))
    }
  }

  report.finishedAt = new Date().toISOString()
  const outPath = path.join(__dirname, `hunt5-report-${Date.now()}.json`)
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
  log('\n=== DONE ===')
  log('Findings: ' + report.findings.length)
  for (const f of report.findings) log('  - [' + f.severity + '] ' + f.title)
  log('Report: ' + outPath)
  closeCDP()
}

main().catch(e => { console.error('FATAL: ' + e.message); closeCDP(); process.exit(1) })
