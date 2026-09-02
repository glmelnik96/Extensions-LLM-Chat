#!/usr/bin/env node
/**
 * Eval corpus runner — a repeatable NUMBER for the agent's behaviour on
 * human-style Russian requests, measured on the real comp state.
 *
 * Why: six bug-hunt rounds each produced a handful of one-off findings, so a
 * prompt or harness change never had a pass-rate to move. This runner turns
 * the hunt scaffolding into a fixed corpus (scripts/eval-cases.js): fresh
 * fixture per case → agent turn(s) through the real loop (plan + verify +
 * scene diff wired exactly like main.js) → structural probe of the comp →
 * pure semantic checks → JSON report with per-case/per-tag pass-rate and the
 * fingerprint it was measured against (model, prompt+registry hash, flags,
 * git revision). `--compare` prints regressions/fixes against an older report.
 *
 * Usage:
 *   node scripts/eval-corpus.js [--model <id>] [--only id,id] [--tag <tag>]
 *        [--limit N] [--plan on|off] [--verify on|off] [--gating on|off]
 *        [--compare <report.json>]
 * Prereq: AE running with the panel open (CDP 8092) and an API key configured.
 * Reports: scripts/eval-report-<timestamp>.json (gitignored).
 */
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execSync } = require('child_process')
const { cases, fixtures } = require('./eval-cases.js')

// ── CLI ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const opt = { model: null, only: null, tag: null, limit: 0, plan: true, verify: true, gating: false, compare: null }
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  const v = argv[i + 1]
  if (a === '--model') { opt.model = v; i++ } else if (a === '--only') { opt.only = v.split(',').map(s => s.trim()).filter(Boolean); i++ } else if (a === '--tag') { opt.tag = v; i++ } else if (a === '--limit') { opt.limit = Number(v) || 0; i++ } else if (a === '--plan') { opt.plan = v !== 'off'; i++ } else if (a === '--verify') { opt.verify = v !== 'off'; i++ } else if (a === '--gating') { opt.gating = v === 'on'; i++ } else if (a === '--compare') { opt.compare = v; i++ } else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 22).join('\n')); process.exit(0) }
}

// ── CDP layer (same scaffolding as the hunt scripts) ─────────────────────
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
  await evalInPanel('window.__eval = null; "cleared"')
  await evalInPanel(`
    (function () {
      try {
        var p = ${asyncExpr};
        if (p && typeof p.then === 'function') {
          p.then(function (r) { window.__eval = (r === undefined || r === null) ? { __done: true } : r },
                 function (e) { window.__eval = { __error: String(e && (e.message || e)) } })
        } else { window.__eval = p }
      } catch (e) { window.__eval = { __error: String(e && (e.message || e)) } }
      return 'fired'
    })()
  `, 10000)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs)
    const val = await evalInPanel('window.__eval', 10000)
    if (val !== null && val !== undefined) {
      if (val && val.__error) throw new Error('Panel async error: ' + val.__error)
      return val
    }
  }
  throw new Error('fireAndPoll timeout after ' + timeoutMs + 'ms')
}

/** Evaluate raw ExtendScript in the host (source passed safely via JSON.stringify). */
async function probe (extendScriptSrc, timeoutMs = 30000) {
  return fireAndPoll(`window.HOST_BRIDGE.evalHostFunction(${JSON.stringify(extendScriptSrc)})`, 1000, timeoutMs)
}

// ── Comp helpers ─────────────────────────────────────────────────────────
const COMP = 'Eval-Comp'

async function ensureComp () {
  const r = await probe(`(function(){
    var found = null;
    for (var i = 1; i <= app.project.numItems; i++) {
      var it = app.project.item(i);
      if (it instanceof CompItem && it.name === ${JSON.stringify(COMP)}) { found = it; break; }
    }
    if (!found) found = app.project.items.addComp(${JSON.stringify(COMP)}, 1920, 1080, 1, 10, 30);
    found.openInViewer();
    found.time = 0;
    return resultToJson({ ok: true, name: found.name, numLayers: found.numLayers });
  })()`)
  if (!r || r.ok !== true) throw new Error('ensureComp failed: ' + JSON.stringify(r))
}

async function wipeComp () {
  const r = await probe(`(function(){
    var c = app.project.activeItem;
    if (!c || !(c instanceof CompItem)) return resultToJson({ ok: false, message: 'no comp' });
    app.beginUndoGroup('eval-wipe');
    var n = c.numLayers;
    while (c.numLayers > 0) { var L = c.layer(1); L.locked = false; L.remove(); }
    var mp = c.markerProperty;
    if (mp) { while (mp.numKeys > 0) mp.removeKey(1); }
    c.time = 0;
    app.endUndoGroup();
    return resultToJson({ ok: true, removed: n });
  })()`)
  if (!r || r.ok !== true) throw new Error('wipeComp failed: ' + JSON.stringify(r))
}

/**
 * Structural probe (ES3): per layer — identity, switches, parent, timing,
 * effects (+ slider/checkbox values), per-transform keyframe/expression info
 * and value, samples at `times` (opacity, scale, rotation, comp-space world
 * position), text at `times`, colors for shapes/solids/text.
 */
async function probeState (times) {
  return probe(`(function(){
    var c = app.project.activeItem;
    if (!c || !(c instanceof CompItem)) return resultToJson({ ok: false, message: 'no comp' });
    var TIMES = ${JSON.stringify(times)};
    function r2 (v) { if (typeof v === 'number') return Math.round(v * 100) / 100; if (v instanceof Array) { var o = []; for (var i = 0; i < v.length; i++) o.push(r2(v[i])); return o; } return v; }
    function propInfo (p) {
      if (!p) return null;
      var o = { numKeys: 0, firstKeyTime: null, lastKeyTime: null, expr: '', exprEnabled: false, exprError: '', value: null };
      try { o.numKeys = p.numKeys; if (p.numKeys > 0) { o.firstKeyTime = r2(p.keyTime(1)); o.lastKeyTime = r2(p.keyTime(p.numKeys)); } } catch (e1) {}
      try { o.expr = p.expression ? String(p.expression).slice(0, 240) : ''; o.exprEnabled = p.expressionEnabled === true; } catch (e2) {}
      try { o.exprError = p.expressionError ? String(p.expressionError).slice(0, 160) : ''; } catch (e3) {}
      try { o.value = r2(p.value); } catch (e4) {}
      return o;
    }
    var layers = [];
    for (var i = 1; i <= c.numLayers; i++) {
      var L = c.layer(i);
      var t = L.property('ADBE Transform Group');
      var info = {
        index: i, id: L.id, name: L.name, type: _layerTypeString(L),
        enabled: L.enabled === true, locked: L.locked === true, nullLayer: L.nullLayer === true,
        parentIndex: L.parent ? L.parent.index : 0, parentName: L.parent ? L.parent.name : '',
        inPoint: r2(L.inPoint), outPoint: r2(L.outPoint), startTime: r2(L.startTime),
        width: L.width, height: L.height,
        sourceIsComp: !!(L.source && L.source instanceof CompItem),
        effects: [],
        anchorPoint: propInfo(t.property('ADBE Anchor Point')),
        position: propInfo(t.property('ADBE Position')),
        scale: propInfo(t.property('ADBE Scale')),
        rotation: propInfo(t.property('ADBE Rotate Z')),
        opacity: propInfo(t.property('ADBE Opacity')),
        at: { opacity: [], scale: [], rotation: [], world: [] }
      };
      var fx = L.property('ADBE Effect Parade');
      if (fx) {
        for (var j = 1; j <= fx.numProperties; j++) {
          var ef = fx.property(j);
          var einfo = { name: ef.name, matchName: ef.matchName };
          if (ef.matchName === 'ADBE Slider Control' || ef.matchName === 'ADBE Checkbox Control') { try { einfo.value = ef.property(1).value; } catch (e5) {} }
          info.effects.push(einfo);
        }
      }
      for (var k = 0; k < TIMES.length; k++) {
        var tt = TIMES[k];
        try { info.at.opacity.push(r2(t.property('ADBE Opacity').valueAtTime(tt, false))); } catch (e6) { info.at.opacity.push(null); }
        try { info.at.scale.push(r2(t.property('ADBE Scale').valueAtTime(tt, false))); } catch (e7) { info.at.scale.push(null); }
        try { info.at.rotation.push(r2(t.property('ADBE Rotate Z').valueAtTime(tt, false))); } catch (e8) { info.at.rotation.push(null); }
        try { info.at.world.push(r2(_compSpacePosition(L, tt))); } catch (e9) { info.at.world.push(null); }
      }
      if (L instanceof TextLayer) {
        var st = L.property('ADBE Text Properties').property('ADBE Text Document');
        info.textAt = [];
        for (var m = 0; m < TIMES.length; m++) { try { info.textAt.push(String(st.valueAtTime(TIMES[m], false).text)); } catch (e10) { info.textAt.push(''); } }
        try { info.textFill = r2(st.value.fillColor); } catch (e11) {}
        try { info.textExpr = st.expression ? String(st.expression).slice(0, 240) : ''; info.textExprError = st.expressionError ? String(st.expressionError).slice(0, 160) : ''; } catch (e12) {}
        try { info.textAnimators = L.property('ADBE Text Properties').property('ADBE Text Animators').numProperties; } catch (e13) { info.textAnimators = 0; }
      }
      if (L instanceof ShapeLayer) {
        try {
          var root = L.property('ADBE Root Vectors Group');
          for (var g = 1; g <= root.numProperties && !info.fillColor; g++) {
            var grp = root.property(g);
            var cont = grp.property('ADBE Vectors Group');
            if (!cont) continue;
            for (var h = 1; h <= cont.numProperties; h++) {
              var it = cont.property(h);
              if (it.matchName === 'ADBE Vector Graphic - Fill') { info.fillColor = r2(it.property('ADBE Vector Fill Color').value); break; }
            }
          }
        } catch (e14) {}
      }
      try { if (L.source && L.source.mainSource && L.source.mainSource.color) info.solidColor = r2(L.source.mainSource.color); } catch (e15) {}
      layers.push(info);
    }
    return resultToJson({ ok: true, numLayers: c.numLayers, layers: layers });
  })()`, 90000)
}

// ── Agent turn (plan + verify + scene diff wired like main.js) ───────────
async function runAgentTurn (history, prompt, timeoutMs) {
  history.push({ role: 'user', content: prompt })
  const code = `
    (function () {
      var HB = window.HOST_BRIDGE, SD = window.PURE_SCENE_DIFF;
      function snap () { return HB.evalHostFunction('extensionsLlmChat_getDetailedCompSummary({fingerprint:true})'); }
      var modelId = ${opt.model ? JSON.stringify(opt.model) : '(window.EXTENSIONS_LLM_CHAT_CONFIG && window.EXTENSIONS_LLM_CHAT_CONFIG.defaultModel) || "openai/gpt-oss-120b"'};
      var built = window.AGENT_SYSTEM_PROMPT_BUILDER.build(${JSON.stringify(prompt)});
      var systemPrompt = (built && built.prompt) ? built.prompt : (window.AGENT_SYSTEM_PROMPT || '');
      var agentCfg = window.EXTENSIONS_LLM_CHAT_CONFIG || {};
      var before = null, plan = '', t0 = Date.now();
      return snap().then(function (b) {
        before = b;
        return window.AGENT_TOOL_LOOP.runAgentLoop({
          modelId: modelId,
          systemPrompt: systemPrompt,
          messages: ${JSON.stringify(history)},
          tools: (window.AGENT_TOOL_REGISTRY && window.AGENT_TOOL_REGISTRY.tools) || [],
          maxSteps: 60,
          temperature: (typeof agentCfg.agentTemperature === 'number') ? agentCfg.agentTemperature : 0.3,
          streaming: false,
          thinkingFirstTurn: false,
          planTurn: ${opt.plan ? 'true' : 'false'},
          verifyTurn: ${opt.verify ? 'true' : 'false'},
          toolGating: ${opt.gating ? 'true' : 'false'},
          onPlan: function (p) { plan = p; },
          getSceneDiff: function () {
            return snap().then(function (a) {
              var d = SD.diffScenes(before, a);
              return { text: SD.formatDiff(d, { maxChars: 2000 }), changed: (d.ok && !d.compSwitched) ? d.count > 0 : null };
            });
          }
        });
      }).then(function (r) {
        return snap().then(function (a) {
          var d = SD.diffScenes(before, a);
          return { content: r.content, outcome: (typeof r.outcome === 'string') ? r.outcome : r.content, toolCallLog: r.toolCallLog, usage: r.usage, plan: plan, diffText: SD.formatDiff(d, { maxChars: 1500 }), elapsedMs: Date.now() - t0, toolGating: r.toolGating || null };
        });
      });
    })()
  `
  const result = await fireAndPoll(code, 3000, timeoutMs)
  history.push({ role: 'assistant', content: String(result.content || '') })
  return result
}

function failedCalls (toolCallLog) {
  const fails = []
  for (const e of toolCallLog || []) {
    let r = e.result
    if (typeof r === 'string') { try { r = JSON.parse(r) } catch (_) {} }
    const ok = r && (r.ok === true || r.ok === undefined)
    if (e.status === 'error' || !ok) fails.push({ name: e.name, message: String((r && (r.message || r.error)) || e.status).slice(0, 200) })
  }
  return fails
}

// ── Fingerprint ──────────────────────────────────────────────────────────
function fingerprint () {
  const root = path.join(__dirname, '..')
  const h = crypto.createHash('sha1')
  for (const f of ['agentSystemPrompt.js', 'toolRegistry.js']) h.update(fs.readFileSync(path.join(root, f)))
  let gitRev = '?'
  try { gitRev = execSync('git rev-parse --short HEAD', { cwd: root, encoding: 'utf8' }).trim() } catch (_) {}
  return { promptHash: h.digest('hex').slice(0, 12), gitRev }
}

// ── Compare two reports ──────────────────────────────────────────────────
function compareReports (prev, cur) {
  const pm = new Map((prev.cases || []).map(c => [c.id, c]))
  const lines = []
  for (const c of cur.cases) {
    const p = pm.get(c.id)
    if (!p) { lines.push('  NEW  ' + c.id + ' → ' + (c.pass ? 'PASS' : 'FAIL')); continue }
    if (p.pass !== c.pass) lines.push('  ' + (c.pass ? 'FIXED     ' : 'REGRESSED ') + c.id)
  }
  const pRate = prev.summary ? prev.summary.casesPassed + '/' + prev.summary.cases : '?'
  const pTok = prev.summary ? prev.summary.totalTokens : '?'
  lines.push('  tokens: ' + pTok + ' → ' + cur.summary.totalTokens + ' | time: ' + (prev.summary ? Math.round(prev.summary.elapsedMs / 1000) : '?') + ' s → ' + Math.round(cur.summary.elapsedMs / 1000) + ' s')
  const cRate = cur.summary.casesPassed + '/' + cur.summary.cases
  lines.unshift('  cases: ' + pRate + ' → ' + cRate + ' (prev ' + (prev.meta && prev.meta.gitRev) + '/' + (prev.meta && prev.meta.promptHash) + ' → ' + cur.meta.gitRev + '/' + cur.meta.promptHash + ')')
  return lines.join('\n')
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main () {
  let selected = cases.slice()
  if (opt.only) selected = selected.filter(c => opt.only.includes(c.id))
  if (opt.tag) selected = selected.filter(c => (c.tags || []).includes(opt.tag))
  if (opt.limit > 0) selected = selected.slice(0, opt.limit)
  if (!selected.length) { console.error('No cases selected.'); process.exit(1) }

  await connectCDP()
  const model = opt.model || await evalInPanel('(window.EXTENSIONS_LLM_CHAT_CONFIG && window.EXTENSIONS_LLM_CHAT_CONFIG.defaultModel) || "?"')
  const meta = Object.assign({ model, planTurn: opt.plan, verifyTurn: opt.verify, toolGating: opt.gating, startedAt: new Date().toISOString() }, fingerprint())
  console.log('Eval corpus: ' + selected.length + ' case(s) | model ' + model + ' | plan ' + (opt.plan ? 'on' : 'off') + ' verify ' + (opt.verify ? 'on' : 'off') + ' gating ' + (opt.gating ? 'on' : 'off') + ' | ' + meta.gitRev + '/' + meta.promptHash)
  await ensureComp()

  const report = { meta, cases: [], summary: null }
  for (const c of selected) {
    const t0 = Date.now()
    const entry = { id: c.id, tags: c.tags || [], fixture: c.fixture, pass: false, checks: [], turns: [], elapsedMs: 0, error: null }
    console.log('\n── ' + c.id + ' [' + (c.tags || []).join(',') + ']')
    try {
      await wipeComp()
      const fixture = fixtures[c.fixture]
      if (!fixture) throw new Error('unknown fixture ' + c.fixture)
      const fr = await probe(fixture)
      if (!fr || fr.ok !== true) throw new Error('fixture failed: ' + JSON.stringify(fr))
      const times = c.sampleTimes || [0, 1, 2, 4]
      const before = await probeState(times)
      const turns = c.turns || [{ prompt: c.prompt, checks: c.checks }]
      const history = []
      for (let ti = 0; ti < turns.length; ti++) {
        const turn = turns[ti]
        console.log('  > ' + turn.prompt)
        const run = await runAgentTurn(history, turn.prompt, c.timeoutMs || 6 * 60 * 1000)
        if (c.preProbe) { const pr = await probe(c.preProbe); if (!pr || pr.ok !== true) console.log('  (preProbe: ' + JSON.stringify(pr).slice(0, 120) + ')') }
        const after = await probeState(times)
        const fails = failedCalls(run.toolCallLog)
        const checks = (turn.checks ? turn.checks(after, before, run) : [])
        if (!c.allowExprErrors) {
          const errs = (after.layers || []).filter(l => ['position', 'scale', 'rotation', 'opacity', 'anchorPoint'].some(k => l[k] && l[k].exprError) || l.textExprError)
          checks.push({ name: 'invariant: no expression errors', pass: errs.length === 0, detail: errs.map(l => l.name).join(', ') })
        }
        for (const ch of checks) console.log('  ' + (ch.pass ? 'PASS' : 'FAIL') + ': ' + ch.name + (ch.detail ? ' — ' + ch.detail : ''))
        console.log('  tools: ' + (run.toolCallLog || []).map(e => e.name + (e.status === 'ok' ? '' : '!')).join(' → ') + ' | ' + fails.length + ' failed | ' + Math.round(run.elapsedMs / 1000) + ' s | ' + (run.usage ? run.usage.total_tokens : '?') + ' tok')
        console.log('  diff: ' + String(run.diffText || '').replace(/\n/g, ' | ').slice(0, 300))
        if (run.toolGating) console.log('  gating: offered ' + run.toolGating.offeredTools + '/' + run.toolGating.allTools + ' | initial ' + JSON.stringify(run.toolGating.initialGroups) + ' | on demand ' + JSON.stringify(run.toolGating.loadedOnDemand))
        entry.turns.push({
          prompt: turn.prompt,
          checks,
          calls: (run.toolCallLog || []).map(e => ({ name: e.name, status: e.status, args: JSON.stringify(e.args || {}).slice(0, 400) })),
          failedCalls: fails,
          usage: run.usage,
          elapsedMs: run.elapsedMs,
          plan: String(run.plan || '').slice(0, 1200),
          diffText: run.diffText,
          toolGating: run.toolGating || null,
          finalText: String(run.content || '').slice(0, 1200),
          outcome: String(run.outcome || '').slice(0, 1200)
        })
        entry.checks.push(...checks)
      }
      entry.pass = entry.checks.length > 0 && entry.checks.every(ch => ch.pass)
    } catch (e) {
      entry.error = String(e && e.message || e)
      console.log('  ERROR: ' + entry.error)
    }
    entry.elapsedMs = Date.now() - t0
    console.log('  => ' + (entry.pass ? 'PASS' : 'FAIL') + ' (' + Math.round(entry.elapsedMs / 1000) + ' s)')
    report.cases.push(entry)
  }

  const allChecks = report.cases.flatMap(c => c.checks)
  const byTag = {}
  for (const c of report.cases) for (const t of c.tags) { byTag[t] = byTag[t] || { cases: 0, passed: 0 }; byTag[t].cases++; if (c.pass) byTag[t].passed++ }
  report.summary = {
    cases: report.cases.length,
    casesPassed: report.cases.filter(c => c.pass).length,
    checks: allChecks.length,
    checksPassed: allChecks.filter(ch => ch.pass).length,
    totalTokens: report.cases.reduce((s, c) => s + c.turns.reduce((u, t) => u + ((t.usage && t.usage.total_tokens) || 0), 0), 0),
    elapsedMs: report.cases.reduce((s, c) => s + c.elapsedMs, 0),
    byTag
  }
  meta.finishedAt = new Date().toISOString()
  const outPath = path.join(__dirname, 'eval-report-' + meta.startedAt.replace(/[:.]/g, '-') + '.json')
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2))

  const s = report.summary
  console.log('\n=== SUMMARY ===')
  console.log('cases ' + s.casesPassed + '/' + s.cases + ' (' + Math.round(100 * s.casesPassed / s.cases) + '%) | checks ' + s.checksPassed + '/' + s.checks + ' | ' + s.totalTokens + ' tok | ' + Math.round(s.elapsedMs / 1000) + ' s')
  for (const [tag, v] of Object.entries(byTag)) console.log('  ' + tag.padEnd(12) + v.passed + '/' + v.cases)
  const failed = report.cases.filter(c => !c.pass)
  if (failed.length) {
    console.log('failed cases:')
    for (const c of failed) console.log('  - ' + c.id + ': ' + (c.error || c.checks.filter(ch => !ch.pass).map(ch => ch.name).join('; ')))
  }
  if (opt.compare) {
    try { console.log('\n=== COMPARE vs ' + path.basename(opt.compare) + ' ===\n' + compareReports(JSON.parse(fs.readFileSync(opt.compare, 'utf8')), report)) } catch (e) { console.log('compare failed: ' + e.message) }
  }
  console.log('Report: ' + outPath)
  closeCDP()
}

main().catch(e => { console.error('FATAL: ' + (e && e.stack || e)); closeCDP(); process.exit(1) })
