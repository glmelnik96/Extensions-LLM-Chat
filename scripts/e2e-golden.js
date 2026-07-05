#!/usr/bin/env node
/**
 * E2E Golden Scenario Test Harness
 *
 * Drives the AE Motion Agent panel (running inside After Effects) through CDP
 * to execute golden scenarios — end-to-end agent tasks with programmatic
 * verification of the resulting AE composition state.
 *
 * Purpose: catch agent-quality regressions when models/prompts change.
 *
 * Usage:
 *   node scripts/e2e-golden.js              # run all scenarios
 *   node scripts/e2e-golden.js --scenario wiggle   # run one
 *   node scripts/e2e-golden.js --list        # list available scenarios
 *   node scripts/e2e-golden.js --model zai-org/GLM-4.7  # override model
 *
 * Prerequisites: AE running, panel loaded, CDP port 8092 open.
 */
'use strict'

const fs = require('fs')
const path = require('path')

// ── CLI argument parsing ─────────────────────────────────────────────────
const args = process.argv.slice(2)
let filterScenario = null
let listOnly = false
let modelOverride = null
let agentTimeoutMs = 4 * 60 * 1000 // 4 minutes default

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--scenario' && args[i + 1]) { filterScenario = args[++i]; continue }
  if (args[i] === '--list') { listOnly = true; continue }
  if (args[i] === '--model' && args[i + 1]) { modelOverride = args[++i]; continue }
  if (args[i] === '--timeout' && args[i + 1]) { agentTimeoutMs = parseInt(args[++i], 10) * 1000; continue }
}

// ── CDP connection layer ─────────────────────────────────────────────────
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

/**
 * Evaluate JS in the panel. Returns the deserialized value.
 * Timeout in ms (default 30s for simple evals).
 */
function evalInPanel (code, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const id = ++msgId
    const timer = setTimeout(() => reject(new Error('evalInPanel timeout (' + timeoutMs + 'ms)')), timeoutMs)
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

/**
 * Fire-and-poll pattern for async panel operations.
 * Sets window.__e2e = null, runs the async expression (which should assign to
 * window.__e2e on completion), then polls until __e2e is non-null.
 */
async function fireAndPoll (asyncExpr, pollIntervalMs = 2000, timeoutMs = 60000) {
  // Clear sentinel
  await evalInPanel('window.__e2e = null; "cleared"')
  // Fire the async operation
  await evalInPanel(`
    (function () {
      try {
        var p = ${asyncExpr};
        if (p && typeof p.then === 'function') {
          p.then(function (r) { window.__e2e = r },
                 function (e) { window.__e2e = { __error: String(e.message || e) } })
        } else {
          window.__e2e = p
        }
      } catch (e) {
        window.__e2e = { __error: String(e.message || e) }
      }
      return 'fired'
    })()
  `, 10000)

  // Poll for result
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(pollIntervalMs)
    const val = await evalInPanel('window.__e2e', 10000)
    if (val !== null && val !== undefined) {
      if (val && val.__error) throw new Error('Panel async error: ' + val.__error)
      return val
    }
  }
  throw new Error('fireAndPoll timeout after ' + timeoutMs + 'ms')
}

function sleep (ms) { return new Promise(r => setTimeout(r, ms)) }

// ── Tool call helper ─────────────────────────────────────────────────────
/**
 * Execute a single tool call via HOST_BRIDGE.executeToolCall.
 * Returns the parsed result object.
 */
async function runToolCall (toolName, args = {}) {
  const argsJson = JSON.stringify(args)
  const result = await fireAndPoll(
    `window.HOST_BRIDGE.executeToolCall(${JSON.stringify(toolName)}, ${argsJson})`,
    1000,
    60000
  )
  return result
}

// ── Agent loop helper ────────────────────────────────────────────────────
/**
 * Run the full agent loop with a user prompt.
 * Replicates the same invocation pattern as main.js handleSend.
 */
async function runAgent (prompt, opts = {}) {
  const model = opts.model || modelOverride || null
  const timeout = opts.timeout || agentTimeoutMs

  // Build the invocation code that runs inside the panel
  const invokeCode = `
    (function () {
      var modelId = ${model ? JSON.stringify(model) : '(window.EXTENSIONS_LLM_CHAT_CONFIG && window.EXTENSIONS_LLM_CHAT_CONFIG.defaultModel) || "openai/gpt-oss-120b"'};
      var systemPrompt = '';
      if (window.AGENT_SYSTEM_PROMPT_BUILDER && typeof window.AGENT_SYSTEM_PROMPT_BUILDER.build === 'function') {
        var built = window.AGENT_SYSTEM_PROMPT_BUILDER.build(${JSON.stringify(prompt)});
        systemPrompt = (built && built.prompt) ? built.prompt : (window.AGENT_SYSTEM_PROMPT || '');
      } else {
        systemPrompt = window.AGENT_SYSTEM_PROMPT || '';
      }
      var messages = [{ role: 'user', content: ${JSON.stringify(prompt)} }];
      var agentCfg = window.EXTENSIONS_LLM_CHAT_CONFIG || {};
      return window.AGENT_TOOL_LOOP.runAgentLoop({
        modelId: modelId,
        systemPrompt: systemPrompt,
        messages: messages,
        tools: (window.AGENT_TOOL_REGISTRY && window.AGENT_TOOL_REGISTRY.tools) || [],
        maxSteps: 60,
        temperature: agentCfg.agentTemperature || 0.3,
        streaming: false,
        thinkingFirstTurn: false
      });
    })()
  `

  const result = await fireAndPoll(invokeCode, 3000, timeout)
  return result
}

// ── Verify helpers (pure functions, exported for unit testing) ────────────
/**
 * Check that a string contains a substring (case-insensitive).
 */
function checkContains (value, substring, label) {
  const pass = typeof value === 'string' && value.toLowerCase().includes(substring.toLowerCase())
  return {
    name: label || `contains "${substring}"`,
    pass,
    detail: pass
      ? `Found "${substring}" in value`
      : `Expected "${substring}" in: ${String(value).slice(0, 200)}`
  }
}

/**
 * Check that a numeric value meets a threshold.
 */
function checkAtLeast (value, min, label) {
  const num = typeof value === 'number' ? value : parseInt(value, 10)
  const pass = !isNaN(num) && num >= min
  return {
    name: label || `>= ${min}`,
    pass,
    detail: pass ? `Value ${num} >= ${min}` : `Value ${num} < ${min}`
  }
}

/**
 * Check that a keyframe time is within tolerance of the layer in-point.
 */
function checkTimingNearInPoint (keyTime, inPoint, tolerance) {
  const t = typeof keyTime === 'number' ? keyTime : NaN
  const ip = typeof inPoint === 'number' ? inPoint : 0
  const tol = typeof tolerance === 'number' ? tolerance : 0.5
  const diff = Math.abs(t - ip)
  const pass = !isNaN(t) && diff <= tol
  return {
    name: 'First keyframe time near layer in-point',
    pass,
    detail: pass
      ? 'Keyframe time ' + t + 's within ' + tol + 's of in-point ' + ip + 's'
      : 'Keyframe time ' + t + 's is ' + diff.toFixed(3) + 's from in-point ' + ip + 's (tolerance ' + tol + 's)'
  }
}

/**
 * Check expression exists and is enabled on a property.
 */
function checkExpressionExists (exprResult, label) {
  const hasExpr = exprResult && exprResult.ok !== false &&
    typeof exprResult.expression === 'string' && exprResult.expression.length > 0 &&
    exprResult.expressionEnabled !== false
  return {
    name: label || 'expression exists',
    pass: !!hasExpr,
    detail: hasExpr
      ? `Expression (${exprResult.expression.length} chars): ${exprResult.expression.slice(0, 100)}`
      : `No expression found: ${JSON.stringify(exprResult).slice(0, 200)}`
  }
}

// Export verify helpers for potential unit testing
if (typeof module !== 'undefined') {
  module.exports = { checkContains, checkAtLeast, checkExpressionExists, checkTimingNearInPoint }
}

// ── Scenario definitions ─────────────────────────────────────────────────

const TEST_COMP_NAME = 'E2E-TestComp'

/**
 * Open a named comp in the AE viewer via ExtendScript eval.
 * Returns true if successful.
 */
async function openCompInViewer (compName) {
  const openResult = await fireAndPoll(`
    window.HOST_BRIDGE.evalHostFunction(
      '(function(){' +
      'var n=${JSON.stringify(compName).replace(/'/g, "\\'")}; ' +
      'for(var i=1;i<=app.project.numItems;i++){' +
      'var it=app.project.item(i);' +
      'try{if(it.name===n&&(it instanceof CompItem)){it.openInViewer();return resultToJson({ok:true})}}catch(e){}' +
      '}' +
      'return resultToJson({ok:false,message:"comp not found"})' +
      '})()'
    )
  `, 2000, 15000)
  return openResult && openResult.ok === true
}

/**
 * Create the test composition (or reuse existing) and open it in the AE
 * viewer so subsequent tool calls target it as the active comp.
 */
async function createTestComp () {
  // Try to open an existing E2E-TestComp first
  log('  Looking for existing test comp...')
  const opened = await openCompInViewer(TEST_COMP_NAME)
  if (opened) {
    log('  Reusing existing ' + TEST_COMP_NAME)
    await sleep(1000)
    // Clean up any leftover layers
    await cleanupE2ELayers()
    return { ok: true, compName: TEST_COMP_NAME, reused: true }
  }

  // Create fresh
  log('  Creating test comp: ' + TEST_COMP_NAME)
  const result = await runToolCall('create_comp', {
    name: TEST_COMP_NAME,
    width: 1920,
    height: 1080,
    duration: 10,
    frame_rate: 30
  })
  if (!result || result.ok === false) {
    throw new Error('Failed to create test comp: ' + JSON.stringify(result))
  }

  // Open the created comp in AE viewer
  log('  Opening comp in viewer...')
  const openOk = await openCompInViewer(TEST_COMP_NAME)
  if (!openOk) {
    throw new Error('Failed to open test comp in viewer')
  }

  // Let AE settle after opening the comp
  await sleep(1500)
  return result
}

/**
 * Create a solid layer named with E2E- prefix in the active comp.
 */
async function createSolidLayer (name, color) {
  log('  Creating solid layer: ' + name)
  const result = await runToolCall('create_layer', {
    layer_type: 'solid',
    name: name,
    color: color || [0.5, 0.5, 0.5]
  })
  if (!result || result.ok === false) {
    throw new Error('Failed to create layer ' + name + ': ' + JSON.stringify(result))
  }
  return result
}

/**
 * Create a text layer named with E2E- prefix in the active comp.
 */
async function createTextLayer (name, text) {
  log('  Creating text layer: ' + name)
  const result = await runToolCall('create_layer', {
    layer_type: 'text',
    name: name,
    text: text || 'E2E Test Text'
  })
  if (!result || result.ok === false) {
    throw new Error('Failed to create text layer ' + name + ': ' + JSON.stringify(result))
  }
  return result
}

/**
 * Delete all E2E- layers from the active comp via search + delete.
 */
async function cleanupE2ELayers () {
  log('  Cleaning up E2E layers...')
  try {
    const search = await runToolCall('search_layers', { pattern: 'E2E-' })
    const layers = search && (search.matches || search.layers)
    if (layers && layers.length > 0) {
      // Delete in reverse index order to avoid index shifting
      const sorted = layers.slice().sort((a, b) => b.index - a.index)
      for (const layer of sorted) {
        try {
          await runToolCall('delete_layer', { layer_id: layer.id || undefined, layer_index: layer.index })
        } catch (e) {
          log('    Warning: could not delete layer ' + layer.name + ': ' + e.message)
        }
      }
    }
  } catch (e) {
    log('    Warning: cleanup search failed: ' + e.message)
  }
}

/**
 * Find a layer by name and return its index and id.
 */
async function findLayer (name) {
  const result = await runToolCall('search_layers', { pattern: name })
  const layers = result && (result.matches || result.layers)
  if (!result || result.ok === false || !layers || layers.length === 0) {
    throw new Error('Layer not found: ' + name)
  }
  // Find exact match first, then partial
  const exact = layers.find(l => l.name === name)
  return exact || layers[0]
}

// ── Scenario: WIGGLE ─────────────────────────────────────────────────────
const scenarioWiggle = {
  name: 'wiggle',
  description: 'Add wiggle(3, 25) expression to Position of a named layer',

  async setup () {
    await createSolidLayer('E2E-target', [0.8, 0.2, 0.2])
  },

  async run () {
    return runAgent('Add wiggle(3, 25) to the Position property of the layer named "E2E-target"')
  },

  async verify () {
    const layer = await findLayer('E2E-target')
    const expr = await runToolCall('get_expression', {
      layer_index: layer.index,
      property_path: 'Transform>Position'
    })
    return [
      checkExpressionExists(expr, 'Position has expression'),
      checkContains(expr.expression || '', 'wiggle', 'Expression contains "wiggle"')
    ]
  },

  async teardown () {
    await cleanupE2ELayers()
  }
}

// ── Scenario: SPIN ───────────────────────────────────────────────────────
const scenarioSpin = {
  name: 'spin',
  description: 'Continuous rotation using time expression on a named layer',

  async setup () {
    await createSolidLayer('E2E-target', [0.2, 0.8, 0.2])
  },

  async run () {
    return runAgent('Make the layer named "E2E-target" rotate continuously using a time expression on the Rotation property')
  },

  async verify () {
    const layer = await findLayer('E2E-target')
    const expr = await runToolCall('get_expression', {
      layer_index: layer.index,
      property_path: 'Transform>Rotation'
    })
    return [
      checkExpressionExists(expr, 'Rotation has expression'),
      checkContains(expr.expression || '', 'time', 'Expression contains "time"')
    ]
  },

  async teardown () {
    await cleanupE2ELayers()
  }
}

// ── Scenario: FADE ───────────────────────────────────────────────────────
const scenarioFade = {
  name: 'fade',
  description: 'Auto fade in/out expression on Opacity',

  async setup () {
    await createSolidLayer('E2E-target', [0.2, 0.2, 0.8])
  },

  async run () {
    return runAgent('Add auto fade in/out expression to the Opacity of the layer named "E2E-target". The opacity should fade in at the layer in point and fade out at the layer out point.')
  },

  async verify () {
    const layer = await findLayer('E2E-target')
    const expr = await runToolCall('get_expression', {
      layer_index: layer.index,
      property_path: 'Transform>Opacity'
    })
    const exprText = (expr.expression || '').toLowerCase()
    const hasTimingRef = exprText.includes('inpoint') || exprText.includes('in_point') ||
      exprText.includes('outpoint') || exprText.includes('out_point') ||
      exprText.includes('linear') || exprText.includes('ease')
    return [
      checkExpressionExists(expr, 'Opacity has expression'),
      {
        name: 'Expression references in/out point or easing',
        pass: hasTimingRef,
        detail: hasTimingRef
          ? 'Found timing reference in expression'
          : 'No inPoint/outPoint/linear/ease found in: ' + (expr.expression || '').slice(0, 200)
      }
    ]
  },

  async teardown () {
    await cleanupE2ELayers()
  }
}

// ── Scenario: TYPEWRITER ─────────────────────────────────────────────────
const scenarioTypewriter = {
  name: 'typewriter',
  description: 'Typewriter text reveal on a text layer',

  async setup () {
    await createTextLayer('E2E-target', 'Hello World E2E Test')
  },

  async run () {
    return runAgent('Add a typewriter text reveal expression to the Source Text of the text layer named "E2E-target". The text should reveal character by character.')
  },

  async verify () {
    const layer = await findLayer('E2E-target')
    const expr = await runToolCall('get_expression', {
      layer_index: layer.index,
      property_path: 'Text>Source Text'
    })
    const exprText = (expr.expression || '').toLowerCase()
    const hasReveal = exprText.includes('substr') || exprText.includes('substring') ||
      exprText.includes('slice') || exprText.includes('textindex') ||
      exprText.includes('text.sourcetext')
    return [
      checkExpressionExists(expr, 'Source Text has expression'),
      {
        name: 'Expression contains text reveal logic',
        pass: hasReveal,
        detail: hasReveal
          ? 'Found text reveal pattern in expression'
          : 'No substr/substring/slice/textIndex found in: ' + (expr.expression || '').slice(0, 200)
      }
    ]
  },

  async teardown () {
    await cleanupE2ELayers()
  }
}

// ── Scenario: POP IN ─────────────────────────────────────────────────────
const scenarioPopIn = {
  name: 'popin',
  description: 'Pop-in animation: scale 0 to 100 with spring overshoot at layer in point',

  async setup () {
    await createSolidLayer('E2E-target', [0.8, 0.8, 0.2])
  },

  async run () {
    return runAgent('Make the layer named "E2E-target" pop in: animate scale from 0 to 100 with a spring overshoot at the layer in point. You can use keyframes with easing, or an expression with velocityAtTime/Math.sin for the bounce — whichever approach gives the best result.')
  },

  async verify () {
    const layer = await findLayer('E2E-target')

    // Check for expression-based approach
    const scaleExpr = await runToolCall('get_expression', {
      layer_index: layer.index,
      property_path: 'Transform>Scale'
    })

    // Check for keyframe-based approach
    const scaleKf = await runToolCall('get_keyframes', {
      layer_index: layer.index,
      property_path: 'Transform>Scale'
    })

    const hasExpression = scaleExpr && scaleExpr.expression && scaleExpr.expression.length > 0 &&
      scaleExpr.expressionEnabled !== false
    const hasKeyframes = scaleKf && scaleKf.ok !== false && scaleKf.keyframes &&
      scaleKf.keyframes.length >= 2

    // Either approach is valid
    const hasAnimation = hasExpression || hasKeyframes

    const checks = [
      {
        name: 'Scale has animation (expression or keyframes)',
        pass: hasAnimation,
        detail: hasExpression
          ? 'Expression: ' + (scaleExpr.expression || '').slice(0, 100)
          : hasKeyframes
            ? 'Keyframes: ' + scaleKf.keyframes.length + ' keys'
            : 'No Scale animation found'
      }
    ]

    if (hasKeyframes && scaleKf.keyframes.length >= 2) {
      // Verify first keyframe value is near 0
      const firstVal = scaleKf.keyframes[0].value
      const isFromZero = (Array.isArray(firstVal) && firstVal[0] <= 5) ||
        (typeof firstVal === 'number' && firstVal <= 5)
      checks.push({
        name: 'First keyframe near scale 0',
        pass: isFromZero,
        detail: 'First keyframe value: ' + JSON.stringify(firstVal)
      })

      // Verify first keyframe time is near the layer in-point.
      // The test layer is created by createSolidLayer with default timing,
      // so in-point is 0 (comp start). Still, use 0 explicitly with a comment
      // rather than making an extra tool call; if the harness ever changes
      // layer creation to use a non-zero in-point, update this constant.
      const layerInPoint = 0 // default for newly created solid layer
      checks.push(checkTimingNearInPoint(
        scaleKf.keyframes[0].time, layerInPoint, 0.5
      ))
    }

    if (hasExpression) {
      const exprLower = (scaleExpr.expression || '').toLowerCase()
      const hasBounce = exprLower.includes('velocity') || exprLower.includes('math.sin') ||
        exprLower.includes('bounce') || exprLower.includes('overshoot') ||
        exprLower.includes('amp') || exprLower.includes('freq') ||
        exprLower.includes('decay') || exprLower.includes('spring') ||
        exprLower.includes('elastic')
      checks.push({
        name: 'Expression has bounce/spring logic',
        pass: hasBounce,
        detail: hasBounce
          ? 'Found bounce/spring pattern'
          : 'No bounce pattern in: ' + (scaleExpr.expression || '').slice(0, 200)
      })
    }

    return checks
  },

  async teardown () {
    await cleanupE2ELayers()
  }
}

// ── All scenarios ────────────────────────────────────────────────────────
const ALL_SCENARIOS = [
  scenarioWiggle,
  scenarioSpin,
  scenarioFade,
  scenarioTypewriter,
  scenarioPopIn
]

// ── Logging ──────────────────────────────────────────────────────────────
function log (msg) { console.log(msg) }
function logError (msg) { console.error(msg) }

// ── Main runner ──────────────────────────────────────────────────────────
async function runScenario (scenario) {
  const startTime = Date.now()
  const result = {
    name: scenario.name,
    description: scenario.description,
    status: 'unknown',
    checks: [],
    agentResult: null,
    durationMs: 0,
    usage: null,
    error: null
  }

  log('')
  log('=' .repeat(60))
  log(`SCENARIO: ${scenario.name} — ${scenario.description}`)
  log('=' .repeat(60))

  try {
    // Setup
    log('  [setup]')
    await scenario.setup()
    await sleep(500) // Let AE settle

    // Run agent
    log('  [run] Sending prompt to agent...')
    const agentStart = Date.now()
    const agentResult = await scenario.run()
    const agentDuration = Date.now() - agentStart
    result.agentResult = {
      content: agentResult && agentResult.content ? agentResult.content.slice(0, 500) : null,
      toolCallCount: agentResult && agentResult.toolCallLog ? agentResult.toolCallLog.length : 0,
      durationMs: agentDuration
    }
    result.usage = agentResult && agentResult.usage ? agentResult.usage : null
    log(`  [run] Agent completed in ${(agentDuration / 1000).toFixed(1)}s` +
      (result.usage ? ` | tokens: ${result.usage.total_tokens}` : ''))
    if (agentResult && agentResult.toolCallLog) {
      log(`  [run] Tool calls: ${agentResult.toolCallLog.length}`)
      for (const tc of agentResult.toolCallLog) {
        const status = tc.status || 'unknown'
        log(`    ${status}: ${tc.name}(${JSON.stringify(tc.args || {}).slice(0, 80)})`)
      }
    }
    if (agentResult && agentResult.content) {
      log(`  [run] Agent response: ${agentResult.content.slice(0, 200)}`)
    }

    // Small pause before verify
    await sleep(1000)

    // Verify
    log('  [verify]')
    result.checks = await scenario.verify()

    const allPassed = result.checks.every(c => c.pass)
    result.status = allPassed ? 'PASS' : 'FAIL'
  } catch (err) {
    result.status = 'ERROR'
    result.error = err.message || String(err)
    logError('  ERROR: ' + result.error)
  }

  // Teardown — always runs
  try {
    log('  [teardown]')
    await scenario.teardown()
  } catch (teardownErr) {
    log('  Warning: teardown error: ' + teardownErr.message)
  }

  result.durationMs = Date.now() - startTime

  // Print check results
  for (const check of result.checks) {
    const icon = check.pass ? 'PASS' : 'FAIL'
    log(`  ${icon}: ${check.name} — ${check.detail}`)
  }
  log(`  STATUS: ${result.status} (${(result.durationMs / 1000).toFixed(1)}s)`)

  return result
}

async function main () {
  // List mode
  if (listOnly) {
    log('Available E2E golden scenarios:')
    for (const s of ALL_SCENARIOS) {
      log(`  ${s.name.padEnd(12)} — ${s.description}`)
    }
    process.exit(0)
  }

  // Determine which scenarios to run
  let scenarios = ALL_SCENARIOS
  if (filterScenario) {
    const found = ALL_SCENARIOS.find(s => s.name === filterScenario)
    if (!found) {
      logError('Unknown scenario: ' + filterScenario)
      logError('Available: ' + ALL_SCENARIOS.map(s => s.name).join(', '))
      process.exit(1)
    }
    scenarios = [found]
  }

  log('E2E Golden Scenario Test Harness')
  log('================================')
  log(`Scenarios: ${scenarios.map(s => s.name).join(', ')}`)
  if (modelOverride) log(`Model override: ${modelOverride}`)
  log(`Agent timeout: ${agentTimeoutMs / 1000}s`)
  log('')

  // Connect to panel
  log('Connecting to CDP on port ' + CDP_PORT + '...')
  try {
    await connectCDP()
    log('Connected.')
  } catch (e) {
    logError('Failed to connect to AE panel. Is After Effects running with the panel loaded?')
    logError('Error: ' + e.message)
    process.exit(1)
  }

  // Verify panel is loaded
  try {
    const panelCheck = await evalInPanel(
      '!!(window.HOST_BRIDGE && window.AGENT_TOOL_LOOP && window.AGENT_TOOL_REGISTRY)',
      10000
    )
    if (!panelCheck) {
      logError('Panel globals not found. Is the AE Motion Agent panel fully loaded?')
      process.exit(1)
    }
    log('Panel globals verified.')
  } catch (e) {
    logError('Panel check failed: ' + e.message)
    process.exit(1)
  }

  // Create the E2E test comp
  log('')
  log('Setting up test composition...')
  try {
    await createTestComp()
    log('Test comp created: ' + TEST_COMP_NAME)
  } catch (e) {
    logError('Failed to create test comp: ' + e.message)
    closeCDP()
    process.exit(1)
  }

  // Run scenarios sequentially
  const results = []
  for (const scenario of scenarios) {
    const result = await runScenario(scenario)
    results.push(result)
    // Pause between scenarios to let AE settle
    if (scenarios.indexOf(scenario) < scenarios.length - 1) {
      await sleep(2000)
    }
  }

  // Summary
  log('')
  log('=' .repeat(60))
  log('SUMMARY')
  log('=' .repeat(60))
  log('')

  const colName = 12
  const colStatus = 8
  const colDur = 10
  const colTokens = 12
  const colChecks = 20

  log(
    'Scenario'.padEnd(colName) +
    'Status'.padEnd(colStatus) +
    'Duration'.padEnd(colDur) +
    'Tokens'.padEnd(colTokens) +
    'Checks'
  )
  log('-'.repeat(colName + colStatus + colDur + colTokens + colChecks))

  let totalPass = 0
  let totalFail = 0
  let totalTokens = 0

  for (const r of results) {
    if (r.status === 'PASS') totalPass++; else totalFail++
    const tokens = r.usage ? r.usage.total_tokens : 0
    totalTokens += tokens
    const checkSummary = r.checks.length > 0
      ? `${r.checks.filter(c => c.pass).length}/${r.checks.length} passed`
      : (r.error ? 'error' : 'n/a')
    log(
      r.name.padEnd(colName) +
      r.status.padEnd(colStatus) +
      `${(r.durationMs / 1000).toFixed(1)}s`.padEnd(colDur) +
      String(tokens || '-').padEnd(colTokens) +
      checkSummary
    )
  }

  log('-'.repeat(colName + colStatus + colDur + colTokens + colChecks))
  log(
    'Total'.padEnd(colName) +
    `${totalPass}P/${totalFail}F`.padEnd(colStatus) +
    ''.padEnd(colDur) +
    String(totalTokens).padEnd(colTokens)
  )

  // Cleanup: delete the test comp layers (comp itself stays — no delete_comp tool)
  log('')
  log('Final cleanup...')
  try {
    await cleanupE2ELayers()
  } catch (_) {}

  // Write JSON report
  const reportPath = path.join(__dirname, `e2e-report-${Date.now()}.json`)
  const report = {
    timestamp: new Date().toISOString(),
    model: modelOverride || 'default',
    scenarios: results,
    summary: { pass: totalPass, fail: totalFail, totalTokens }
  }
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  log('Report written: ' + reportPath)

  closeCDP()

  // Exit code
  process.exit(totalFail > 0 ? 1 : 0)
}

main().catch(e => {
  logError('Fatal error: ' + e.message)
  closeCDP()
  process.exit(1)
})
