#!/usr/bin/env node
/**
 * Real cost benchmark for the AE Motion Agent panel.
 *
 * Drives the LIVE After Effects panel (via CDP on port 8092) through 30+
 * realistic motion-design agent tasks using the REAL agent loop
 * (window.AGENT_TOOL_LOOP.runAgentLoop), measures per-task token usage,
 * computes ruble cost via the panel's own PURE_PRICING (single source of
 * truth), and extrapolates a daily-spend estimate at several usage
 * intensities.
 *
 * It reuses the CDP harness patterns from e2e-golden.js (connectCDP,
 * evalInPanel, fireAndPoll, runToolCall, runAgent). e2e-golden.js only
 * exports pure verify helpers, so the connection helpers are replicated
 * here (same shape) rather than required.
 *
 * Every task NAMES its target layer explicitly (CDP selection is
 * unreliable). Each task sets up its BENCH-prefixed layer(s) via tool calls
 * before the agent runs and tears them down after. All BENCH- artifacts are
 * swept at the end, even on failure — AE is left clean.
 *
 * Usage:
 *   node scripts/cost-benchmark.js               # run all tasks
 *   node scripts/cost-benchmark.js --limit 2     # first 2 (cheap debug)
 *   node scripts/cost-benchmark.js --model moonshotai/Kimi-K2.6
 *   node scripts/cost-benchmark.js --session 10  # + one 10-turn session
 *   node scripts/cost-benchmark.js --list        # list tasks, no run
 *
 * Prerequisites: AE running, panel loaded, CDP port 8092 open.
 * NEVER prints the API key.
 */
'use strict'

const fs = require('fs')
const path = require('path')

// ── CLI argument parsing ─────────────────────────────────────────────────
const args = process.argv.slice(2)
let listOnly = false
let modelOverride = null
let limit = null
let sessionTurns = 0
let agentTimeoutMs = 4 * 60 * 1000 // 4 min per agent request

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--list') { listOnly = true; continue }
  if (args[i] === '--model' && args[i + 1]) { modelOverride = args[++i]; continue }
  if (args[i] === '--limit' && args[i + 1]) { limit = parseInt(args[++i], 10); continue }
  if (args[i] === '--session' && args[i + 1]) { sessionTurns = parseInt(args[++i], 10); continue }
  if (args[i] === '--timeout' && args[i + 1]) { agentTimeoutMs = parseInt(args[++i], 10) * 1000; continue }
}

// ── CDP connection layer (replicated from e2e-golden.js) ─────────────────
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

function closeCDP () {
  if (ws) { try { ws.close() } catch (_) {} ws = null }
}

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
      if (r.exceptionDetails) {
        reject(new Error('Panel exception: ' + JSON.stringify(r.exceptionDetails.text || r.exceptionDetails)))
        return
      }
      resolve(r.result.value !== undefined ? r.result.value : r.result)
    }
    ws.addEventListener('message', handler)
    ws.send(JSON.stringify({
      id,
      method: 'Runtime.evaluate',
      params: { expression: code, awaitPromise: true, returnByValue: true, timeout: timeoutMs - 1000 }
    }))
  })
}

async function fireAndPoll (asyncExpr, pollIntervalMs = 2000, timeoutMs = 60000) {
  await evalInPanel('window.__bench = null; "cleared"')
  await evalInPanel(`
    (function () {
      try {
        var p = ${asyncExpr};
        if (p && typeof p.then === 'function') {
          p.then(function (r) { window.__bench = r },
                 function (e) { window.__bench = { __error: String(e.message || e) } })
        } else {
          window.__bench = p
        }
      } catch (e) {
        window.__bench = { __error: String(e.message || e) }
      }
      return 'fired'
    })()
  `, 10000)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs)
    const val = await evalInPanel('window.__bench', 10000)
    if (val !== null && val !== undefined) {
      if (val && val.__error) throw new Error('Panel async error: ' + val.__error)
      return val
    }
  }
  throw new Error('fireAndPoll timeout after ' + timeoutMs + 'ms')
}

function sleep (ms) { return new Promise(r => setTimeout(r, ms)) }

async function runToolCall (toolName, toolArgs = {}) {
  return fireAndPoll(
    `window.HOST_BRIDGE.executeToolCall(${JSON.stringify(toolName)}, ${JSON.stringify(toolArgs)})`,
    1000,
    60000
  )
}

// ── Agent loop helper (same invocation shape as main.js handleSend) ──────
// Accepts an explicit message array so we can drive both isolated tasks and
// a continuous multi-turn session (for the context-growth caveat).
async function runAgentMessages (messages, opts = {}) {
  const model = opts.model || modelOverride || null
  const timeout = opts.timeout || agentTimeoutMs
  // The system prompt is built from the LAST user message (matches handleSend).
  const lastUser = [...messages].reverse().find(m => m.role === 'user')
  const promptForBuilder = lastUser ? lastUser.content : ''
  const invokeCode = `
    (function () {
      var modelId = ${model ? JSON.stringify(model) : '(window.EXTENSIONS_LLM_CHAT_CONFIG && window.EXTENSIONS_LLM_CHAT_CONFIG.defaultModel) || "openai/gpt-oss-120b"'};
      var systemPrompt = '';
      if (window.AGENT_SYSTEM_PROMPT_BUILDER && typeof window.AGENT_SYSTEM_PROMPT_BUILDER.build === 'function') {
        var built = window.AGENT_SYSTEM_PROMPT_BUILDER.build(${JSON.stringify(promptForBuilder)});
        systemPrompt = (built && built.prompt) ? built.prompt : (window.AGENT_SYSTEM_PROMPT || '');
      } else {
        systemPrompt = window.AGENT_SYSTEM_PROMPT || '';
      }
      var agentCfg = window.EXTENSIONS_LLM_CHAT_CONFIG || {};
      return window.AGENT_TOOL_LOOP.runAgentLoop({
        modelId: modelId,
        systemPrompt: systemPrompt,
        messages: ${JSON.stringify(messages)},
        tools: (window.AGENT_TOOL_REGISTRY && window.AGENT_TOOL_REGISTRY.tools) || [],
        maxSteps: 60,
        temperature: agentCfg.agentTemperature || 0.3,
        streaming: false,
        thinkingFirstTurn: false
      });
    })()
  `
  return fireAndPoll(invokeCode, 3000, timeout)
}

async function runAgent (prompt, opts = {}) {
  return runAgentMessages([{ role: 'user', content: prompt }], opts)
}

// ── Cost via the panel's own PURE_PRICING (single source of truth) ───────
async function costForInPanel (modelId, promptTokens, completionTokens) {
  const code = `JSON.stringify(window.PURE_PRICING.costFor(${JSON.stringify(modelId)}, ${promptTokens}, ${completionTokens}, window.PURE_PRICING.DEFAULT_PRICING))`
  const raw = await evalInPanel(code, 10000)
  try { return JSON.parse(raw) } catch (_) { return { rub: 0, known: false } }
}

// ── Layer setup helpers (BENCH- prefix) ──────────────────────────────────
async function createSolid (name, color) {
  const r = await runToolCall('create_layer', { layer_type: 'solid', name, color: color || [0.5, 0.5, 0.5] })
  if (!r || r.ok === false) throw new Error('create solid ' + name + ' failed: ' + JSON.stringify(r))
  return r
}
async function createText (name, text) {
  const r = await runToolCall('create_layer', { layer_type: 'text', name, text: text || 'BENCH text' })
  if (!r || r.ok === false) throw new Error('create text ' + name + ' failed: ' + JSON.stringify(r))
  return r
}
async function createShape (name) {
  const r = await runToolCall('create_layer', { layer_type: 'shape', name })
  if (!r || r.ok === false) throw new Error('create shape ' + name + ' failed: ' + JSON.stringify(r))
  return r
}

async function cleanupBenchLayers () {
  try {
    const search = await runToolCall('search_layers', { pattern: 'BENCH-' })
    const layers = search && (search.matches || search.layers)
    if (layers && layers.length > 0) {
      const sorted = layers.slice().sort((a, b) => (b.index || 0) - (a.index || 0))
      for (const layer of sorted) {
        try { await runToolCall('delete_layer', { layer_id: layer.id || undefined, layer_index: layer.index }) } catch (_) {}
      }
    }
  } catch (_) {}
}

// ── Test comp ────────────────────────────────────────────────────────────
const BENCH_COMP = 'BENCH-Comp'

async function openCompInViewer (compName) {
  const r = await fireAndPoll(`
    window.HOST_BRIDGE.evalHostFunction(
      '(function(){' +
      'var n=${JSON.stringify(compName).replace(/'/g, "\\'")}; ' +
      'for(var i=1;i<=app.project.numItems;i++){' +
      'var it=app.project.item(i);' +
      'try{if(it.name===n&&(it instanceof CompItem)){it.openInViewer();return resultToJson({ok:true})}}catch(e){}' +
      '}' +
      'return resultToJson({ok:false})' +
      '})()'
    )
  `, 1500, 15000)
  return r && r.ok === true
}

async function ensureBenchComp () {
  const opened = await openCompInViewer(BENCH_COMP)
  if (opened) { await sleep(800); await cleanupBenchLayers(); return }
  const r = await runToolCall('create_comp', { name: BENCH_COMP, width: 1920, height: 1080, duration: 10, frame_rate: 30 })
  if (!r || r.ok === false) throw new Error('create bench comp failed: ' + JSON.stringify(r))
  const ok = await openCompInViewer(BENCH_COMP)
  if (!ok) throw new Error('failed to open bench comp in viewer')
  await sleep(1200)
}

// ── Task set (30+ realistic, diverse) ────────────────────────────────────
// Each task: { name, group, prompt, setup() }. The named layer(s) are created
// in setup(); teardown is a global BENCH- sweep between tasks.
const TASKS = [
  // ── Simple single-expression (~10) ──
  { name: 'wiggle', group: 'simple-expr', setup: () => createSolid('BENCH-wiggle', [0.8, 0.2, 0.2]),
    prompt: 'Add wiggle(3, 25) to the Position of the layer named "BENCH-wiggle"' },
  { name: 'loop-out', group: 'simple-expr', setup: () => createSolid('BENCH-loop', [0.2, 0.6, 0.8]),
    prompt: 'Add a loopOut("cycle") expression to the Position of the layer named "BENCH-loop"' },
  { name: 'spin', group: 'simple-expr', setup: () => createSolid('BENCH-spin', [0.2, 0.8, 0.2]),
    prompt: 'Make the layer named "BENCH-spin" rotate continuously with a time-based expression on Rotation' },
  { name: 'fade-inout', group: 'simple-expr', setup: () => createSolid('BENCH-fade', [0.2, 0.2, 0.8]),
    prompt: 'Add an auto fade in and out expression to the Opacity of the layer named "BENCH-fade"' },
  { name: 'time-counter', group: 'simple-expr', setup: () => createText('BENCH-counter', '0'),
    prompt: 'Make the text layer named "BENCH-counter" show a running seconds counter using a Source Text expression' },
  { name: 'bounce-drop', group: 'simple-expr', setup: () => createSolid('BENCH-bounce', [0.9, 0.5, 0.1]),
    prompt: 'Add a bouncing drop expression to the Position of the layer named "BENCH-bounce" so it settles with decaying bounces' },
  { name: 'wiggle-rotation', group: 'simple-expr', setup: () => createSolid('BENCH-wrot', [0.6, 0.3, 0.7]),
    prompt: 'Add a subtle wiggle(2, 8) to the Rotation of the layer named "BENCH-wrot"' },
  { name: 'pulse-scale', group: 'simple-expr', setup: () => createSolid('BENCH-pulse', [0.3, 0.7, 0.5]),
    prompt: 'Make the layer named "BENCH-pulse" gently pulse its Scale with a sine wave expression' },
  { name: 'random-flicker', group: 'simple-expr', setup: () => createSolid('BENCH-flicker', [0.9, 0.9, 0.2]),
    prompt: 'Add a random flicker to the Opacity of the layer named "BENCH-flicker" using a seedRandom expression' },
  { name: 'sway', group: 'simple-expr', setup: () => createSolid('BENCH-sway', [0.4, 0.4, 0.9]),
    prompt: 'Make the layer named "BENCH-sway" sway back and forth on its X position with a sine expression' },

  // ── Text tasks (~6) ──
  { name: 'typewriter', group: 'text', setup: () => createText('BENCH-type', 'Hello World'),
    prompt: 'Add a typewriter reveal to the Source Text of the text layer named "BENCH-type", revealing character by character' },
  { name: 'word-reveal', group: 'text', setup: () => createText('BENCH-words', 'one two three four'),
    prompt: 'Reveal the text of the layer named "BENCH-words" word by word over time using a Source Text expression' },
  { name: 'timecode', group: 'text', setup: () => createText('BENCH-tc', '00:00:00'),
    prompt: 'Make the text layer named "BENCH-tc" display the current comp timecode via a Source Text expression' },
  { name: 'scramble', group: 'text', setup: () => createText('BENCH-scramble', 'DECODE'),
    prompt: 'Add a character scramble/decode effect to the Source Text of the layer named "BENCH-scramble"' },
  { name: 'count-money', group: 'text', setup: () => createText('BENCH-money', '$0'),
    prompt: 'Make the text layer named "BENCH-money" count up from 0 to 1000 as a dollar amount using a Source Text expression' },
  { name: 'text-fade-slide', group: 'text', setup: () => createText('BENCH-slidein', 'Slide In'),
    prompt: 'Make the text layer named "BENCH-slidein" fade in while sliding up from below at the layer in point' },

  // ── Multi-step / rig tasks (~8) ──
  { name: 'stagger-3', group: 'rig', setup: async () => { await createSolid('BENCH-stag1', [0.8, 0.2, 0.2]); await createSolid('BENCH-stag2', [0.2, 0.8, 0.2]); await createSolid('BENCH-stag3', [0.2, 0.2, 0.8]) },
    prompt: 'Stagger the fade-in of the three layers named "BENCH-stag1", "BENCH-stag2", and "BENCH-stag3" by 5 frames each' },
  { name: 'popin-overshoot', group: 'rig', setup: () => createSolid('BENCH-pop', [0.8, 0.8, 0.2]),
    prompt: 'Make the layer named "BENCH-pop" pop in: scale from 0 to 100 with a spring overshoot at the layer in point' },
  { name: 'camera-shake-rig', group: 'rig', setup: () => createSolid('BENCH-shake', [0.5, 0.5, 0.5]),
    prompt: 'Build a camera-shake rig on the layer named "BENCH-shake": add slider controls for amount and frequency and wire a wiggle to Position driven by those sliders' },
  { name: 'checkbox-toggle', group: 'rig', setup: () => createSolid('BENCH-toggle', [0.3, 0.6, 0.9]),
    prompt: 'On the layer named "BENCH-toggle", add a checkbox control that toggles its Opacity between 0 and 100' },
  { name: 'trim-draw-on', group: 'rig', setup: () => createShape('BENCH-draw'),
    prompt: 'Make the shape layer named "BENCH-draw" draw on using Trim Paths animated from 0 to 100 percent' },
  { name: 'slider-blur', group: 'rig', setup: () => createSolid('BENCH-blur', [0.7, 0.7, 0.7]),
    prompt: 'Add a slider control named "Blur Amount" to the layer named "BENCH-blur" and link a Gaussian Blur amount to it' },
  { name: 'orbit-null', group: 'rig', setup: () => createSolid('BENCH-orbit', [0.9, 0.4, 0.6]),
    prompt: 'Make the layer named "BENCH-orbit" orbit around the center of the comp using a position expression' },
  { name: 'inertia-follow', group: 'rig', setup: () => createSolid('BENCH-inertia', [0.2, 0.9, 0.7]),
    prompt: 'Add inertial overshoot (inertia bounce) to the Position keyframes of the layer named "BENCH-inertia" via an expression' },

  // ── Property / keyframe tasks (~6) ──
  { name: 'center-anchor', group: 'keyframe', setup: () => createSolid('BENCH-anchor', [0.6, 0.6, 0.2]),
    prompt: 'Center the anchor point of the layer named "BENCH-anchor" to the middle of its content' },
  { name: 'pos-keyframes', group: 'keyframe', setup: () => createSolid('BENCH-poskf', [0.2, 0.5, 0.5]),
    prompt: 'Set two Position keyframes on the layer named "BENCH-poskf": at 0 seconds move it to the left edge and at 2 seconds to the right edge' },
  { name: 'scale-bounce-kf', group: 'keyframe', setup: () => createSolid('BENCH-sbounce', [0.8, 0.3, 0.3]),
    prompt: 'Animate the Scale of the layer named "BENCH-sbounce" from 0 to 100 with keyframes and apply easy ease' },
  { name: 'ease-existing', group: 'keyframe', setup: async () => {
      await createSolid('BENCH-ease', [0.4, 0.7, 0.9])
      const l = await findLayer('BENCH-ease')
      await runToolCall('add_keyframes', { layer_index: l.index, property_path: 'Transform>Opacity', keyframes: [{ time: 0, value: 0 }, { time: 1.5, value: 100 }] })
    },
    prompt: 'Apply easy ease to the existing Opacity keyframes on the layer named "BENCH-ease"' },
  { name: 'move-across', group: 'keyframe', setup: () => createSolid('BENCH-across', [0.9, 0.6, 0.2]),
    prompt: 'Animate the layer named "BENCH-across" moving from the left side of the comp to the right over 1 second with position keyframes' },
  { name: 'rotate-90', group: 'keyframe', setup: () => createSolid('BENCH-rot90', [0.5, 0.2, 0.8]),
    prompt: 'Add Rotation keyframes to the layer named "BENCH-rot90" so it rotates 90 degrees over the first second' },

  // ── Expression-library search style (~3) ──
  { name: 'heartbeat', group: 'library', setup: () => createSolid('BENCH-heart', [0.9, 0.1, 0.2]),
    prompt: 'Find and apply a heartbeat pulse to the Scale of the layer named "BENCH-heart"' },
  { name: 'breathe', group: 'library', setup: () => createSolid('BENCH-breathe', [0.3, 0.8, 0.9]),
    prompt: 'Find a breathing / gentle grow-and-shrink expression and apply it to the Scale of the layer named "BENCH-breathe"' },
  { name: 'wiggle-loopable', group: 'library', setup: () => createSolid('BENCH-loopwig', [0.7, 0.5, 0.3]),
    prompt: 'Find and apply a smooth loopable wiggle to the Position of the layer named "BENCH-loopwig"' }
]

async function findLayer (name) {
  const r = await runToolCall('search_layers', { pattern: name })
  const layers = r && (r.matches || r.layers)
  if (!layers || layers.length === 0) throw new Error('layer not found: ' + name)
  return layers.find(l => l.name === name) || layers[0]
}

// ── Stats helpers ────────────────────────────────────────────────────────
function percentile (sortedArr, p) {
  if (sortedArr.length === 0) return 0
  const idx = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length))
  return sortedArr[idx]
}
function median (arr) {
  if (arr.length === 0) return 0
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
function mean (arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0 }

// ── Run one benchmark task ───────────────────────────────────────────────
async function runTask (task, model) {
  const rec = {
    name: task.name, group: task.group, model,
    prompt_tokens: 0, completion_tokens: 0, total_tokens: 0,
    rub: 0, known: false, ok: false, durationMs: 0, toolcalls: 0, error: null
  }
  const t0 = Date.now()
  try {
    await task.setup()
    await sleep(400)
    const result = await runAgent(task.prompt, { model })
    rec.durationMs = Date.now() - t0
    const usage = result && result.usage ? result.usage : null
    if (usage) {
      rec.prompt_tokens = usage.prompt_tokens || 0
      rec.completion_tokens = usage.completion_tokens || 0
      rec.total_tokens = usage.total_tokens || (rec.prompt_tokens + rec.completion_tokens)
    }
    rec.toolcalls = result && result.toolCallLog ? result.toolCallLog.length : 0
    // Success heuristic: agent produced usage and did not abort/error out.
    rec.ok = !!(result && !result.error && !result.aborted && rec.total_tokens > 0)
    if (result && result.error) rec.error = String(result.error).slice(0, 200)
    const cost = await costForInPanel(model, rec.prompt_tokens, rec.completion_tokens)
    rec.rub = cost.rub
    rec.known = cost.known
  } catch (e) {
    rec.durationMs = Date.now() - t0
    rec.error = (e.message || String(e)).slice(0, 200)
    rec.ok = false
  } finally {
    try { await cleanupBenchLayers() } catch (_) {}
  }
  return rec
}

// ── Continuous multi-turn session (context-growth demonstration) ─────────
// Sends N turns on ONE growing message array (assistant replies appended),
// so we can show how re-sent context inflates prompt tokens over a session.
async function runSession (turns, model) {
  const prompts = [
    'Add wiggle(3, 25) to the Position of the layer named "BENCH-sess"',
    'Also make it spin continuously with a Rotation time expression',
    'Now add an auto fade in and out on its Opacity',
    'Make its Scale gently pulse with a sine wave',
    'Add a subtle random flicker to the Opacity too',
    'Give it a slight sway on the X position',
    'Add a slider control called "Amount" and drive the wiggle amount from it',
    'Make it loop its position smoothly',
    'Add a drop shadow-like offset via a second position expression term',
    'Finally, ease everything so the motion feels smooth'
  ]
  await createSolid('BENCH-sess', [0.5, 0.5, 0.5])
  await sleep(400)
  const messages = []
  const perTurn = []
  for (let i = 0; i < Math.min(turns, prompts.length); i++) {
    messages.push({ role: 'user', content: prompts[i] })
    const t0 = Date.now()
    let result
    try {
      result = await runAgentMessages(messages, { model })
    } catch (e) {
      perTurn.push({ turn: i + 1, error: (e.message || String(e)).slice(0, 160) })
      break
    }
    const usage = result && result.usage ? result.usage : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    const cost = await costForInPanel(model, usage.prompt_tokens || 0, usage.completion_tokens || 0)
    perTurn.push({
      turn: i + 1,
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      total_tokens: usage.total_tokens || 0,
      rub: cost.rub,
      durationMs: Date.now() - t0
    })
    // Append the assistant's final content so the next turn re-sends it.
    const content = (result && result.content) ? result.content : '(done)'
    messages.push({ role: 'assistant', content })
  }
  await cleanupBenchLayers()
  return perTurn
}

// ── Reporting ────────────────────────────────────────────────────────────
function pad (s, n) { return String(s).padEnd(n) }
function padL (s, n) { return String(s).padStart(n) }

function printAggregate (records, model) {
  const okRecs = records.filter(r => r.ok)
  const rubs = records.map(r => r.rub)
  const rubsSorted = [...rubs].sort((a, b) => a - b)
  const totalPrompt = records.reduce((a, r) => a + r.prompt_tokens, 0)
  const totalCompletion = records.reduce((a, r) => a + r.completion_tokens, 0)
  const totalTokens = totalPrompt + totalCompletion
  const totalRub = rubs.reduce((a, b) => a + b, 0)
  const meanRub = mean(rubs)
  const medRub = median(rubs)
  const p90Rub = percentile(rubsSorted, 90)
  const minRub = rubsSorted[0] || 0
  const maxRub = rubsSorted[rubsSorted.length - 1] || 0

  console.log('')
  console.log('='.repeat(72))
  console.log('AGGREGATE  (model: ' + model + ')')
  console.log('='.repeat(72))
  console.log(`Tasks run:            ${records.length}  (ok: ${okRecs.length}, failed: ${records.length - okRecs.length})`)
  console.log(`Total tokens:         ${totalTokens.toLocaleString('en-US')}`)
  console.log(`  prompt tokens:      ${totalPrompt.toLocaleString('en-US')}  (${((totalPrompt / totalTokens) * 100).toFixed(1)}%)`)
  console.log(`  completion tokens:  ${totalCompletion.toLocaleString('en-US')}  (${((totalCompletion / totalTokens) * 100).toFixed(1)}%)`)
  console.log(`Total cost:           ₽${totalRub.toFixed(4)}`)
  console.log(`Per-task ₽:  mean ₽${meanRub.toFixed(4)}  median ₽${medRub.toFixed(4)}  p90 ₽${p90Rub.toFixed(4)}  min ₽${minRub.toFixed(4)}  max ₽${maxRub.toFixed(4)}`)

  // Daily-spend table
  console.log('')
  console.log('DAILY-SPEND ESTIMATE  (assumption: 1 task = 1 isolated agent request')
  console.log('with several tool calls; based on mean ₽/task = ₽' + meanRub.toFixed(4) + ')')
  console.log('-'.repeat(52))
  console.log(pad('Intensity', 12) + padL('tasks/day', 12) + padL('₽/day', 14) + padL('₽/month', 14))
  console.log('-'.repeat(52))
  const intensities = [['Light', 20], ['Medium', 60], ['Heavy', 150], ['Power', 400]]
  for (const [label, n] of intensities) {
    const perDay = meanRub * n
    console.log(pad(label, 12) + padL(n, 12) + padL('₽' + perDay.toFixed(2), 14) + padL('₽' + (perDay * 30).toFixed(2), 14))
  }
  console.log('-'.repeat(52))
  console.log('CAVEAT: this per-task benchmark runs each request in isolation. Real')
  console.log('sessions re-send a growing conversation history, so a long continuous')
  console.log('session costs MORE per task than these isolated numbers (see --session).')

  return { totalPrompt, totalCompletion, totalTokens, totalRub, meanRub, medRub, p90Rub, minRub, maxRub, okCount: okRecs.length }
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main () {
  const model = modelOverride || 'openai/gpt-oss-120b'

  if (listOnly) {
    console.log(`Cost benchmark tasks (${TASKS.length}):`)
    let g = null
    for (const t of TASKS) {
      if (t.group !== g) { g = t.group; console.log('  [' + g + ']') }
      console.log('    ' + pad(t.name, 20) + t.prompt.slice(0, 70))
    }
    process.exit(0)
  }

  console.log('AE Motion Agent — Real Cost Benchmark')
  console.log('=====================================')
  console.log('Model: ' + model + (modelOverride ? ' (override)' : ' (default)'))

  console.log('Connecting to CDP on port ' + CDP_PORT + '...')
  try { await connectCDP() } catch (e) {
    console.error('Failed to connect to AE panel. Is After Effects running with the panel loaded?')
    console.error('Error: ' + e.message)
    process.exit(1)
  }
  const ready = await evalInPanel('!!(window.HOST_BRIDGE && window.AGENT_TOOL_LOOP && window.AGENT_TOOL_REGISTRY && window.PURE_PRICING)', 10000)
  if (!ready) { console.error('Panel globals not found (need HOST_BRIDGE, AGENT_TOOL_LOOP, AGENT_TOOL_REGISTRY, PURE_PRICING).'); closeCDP(); process.exit(1) }
  console.log('Panel globals verified.')

  console.log('Setting up BENCH comp...')
  await ensureBenchComp()

  let tasks = TASKS
  if (limit && limit > 0) tasks = TASKS.slice(0, limit)

  const records = []
  console.log('')
  console.log('Running ' + tasks.length + ' tasks (serialized — one agent run at a time)...')
  console.log('-'.repeat(72))
  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i]
    process.stdout.write(`[${i + 1}/${tasks.length}] ${pad(task.name, 20)} `)
    const rec = await runTask(task, model)
    records.push(rec)
    const okStr = rec.ok ? 'ok  ' : 'FAIL'
    console.log(
      `${okStr} | ${padL(rec.prompt_tokens, 7)}p +${padL(rec.completion_tokens, 6)}c =${padL(rec.total_tokens, 7)}t | ` +
      `₽${padL(rec.rub.toFixed(4), 9)} | ${padL((rec.durationMs / 1000).toFixed(1) + 's', 7)} | ${rec.toolcalls}tc` +
      (rec.error ? ` | ERR: ${rec.error}` : '')
    )
    if (i < tasks.length - 1) await sleep(1500)
  }

  const agg = printAggregate(records, model)

  // Optional continuous session
  let sessionResult = null
  if (sessionTurns > 0) {
    console.log('')
    console.log('='.repeat(72))
    console.log('CONTINUOUS SESSION  (' + sessionTurns + ' turns, growing context)')
    console.log('='.repeat(72))
    sessionResult = await runSession(sessionTurns, model)
    console.log(pad('turn', 6) + padL('prompt', 9) + padL('compl', 8) + padL('total', 8) + padL('₽', 11) + padL('sec', 8))
    let sessTotalRub = 0
    for (const t of sessionResult) {
      if (t.error) { console.log(pad(t.turn, 6) + ' ERROR: ' + t.error); continue }
      sessTotalRub += t.rub
      console.log(pad(t.turn, 6) + padL(t.prompt_tokens, 9) + padL(t.completion_tokens, 8) + padL(t.total_tokens, 8) + padL('₽' + t.rub.toFixed(4), 11) + padL((t.durationMs / 1000).toFixed(1), 8))
    }
    console.log('-'.repeat(50))
    console.log('Session total: ₽' + sessTotalRub.toFixed(4) + '  vs ' + sessionResult.length + '× isolated mean ₽' + (agg.meanRub * sessionResult.length).toFixed(4))
  }

  // Final BENCH sweep — leave AE clean
  console.log('')
  console.log('Final cleanup — sweeping all BENCH- layers...')
  await cleanupBenchLayers()
  const leftover = await runToolCall('search_layers', { pattern: 'BENCH-' })
  const leftLayers = leftover && (leftover.matches || leftover.layers) || []
  console.log('Remaining BENCH- layers: ' + leftLayers.length + (leftLayers.length === 0 ? ' (clean)' : ' — WARNING'))

  // Write JSON report (NOT committed; covered by .gitignore)
  const reportPath = path.join(__dirname, `cost-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    model,
    taskCount: records.length,
    tasks: records,
    aggregate: agg,
    session: sessionResult,
    leftoverBenchLayers: leftLayers.length
  }, null, 2))
  console.log('Report written: ' + reportPath)

  closeCDP()
  process.exit(0)
}

main().catch(e => { console.error('Fatal: ' + (e.message || e)); closeCDP(); process.exit(1) })
