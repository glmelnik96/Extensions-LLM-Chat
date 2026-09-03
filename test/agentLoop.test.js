/**
 * Tests for agentToolLoop.js stage-1 reliability fixes (2026-06-10):
 *  - empty tool_calls guard + retry (Cloud.ru vLLM streaming bug)
 *  - synthesized final answer when model content is empty
 *  - toolCallLog preserved on rejection
 *  - streaming opt-in (onTextChunk only forwarded when streaming === true)
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadLoop () {
  const code = fs.readFileSync(path.join(__dirname, '..', 'agentToolLoop.js'), 'utf8')
  const sandbox = { window: {}, console }
  vm.createContext(sandbox)
  // Tool gating module (pure) — the loop looks it up on window when options.toolGating is set.
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'lib', 'pure', 'toolGating.js'), 'utf8'), sandbox, { filename: 'toolGating.js' })
  vm.runInContext(code, sandbox, { filename: 'agentToolLoop.js' })
  return sandbox.window
}

/** Build a fake CHAT_PROVIDER that replays scripted responses (or rejections). */
function scriptProvider (win, script) {
  const calls = []
  win.CHAT_PROVIDER = {
    invoke (modelId, messages, options) {
      calls.push({ messages: messages.map(m => ({ ...m })), options })
      const next = script.shift()
      if (!next) return Promise.reject(new Error('script exhausted'))
      if (next instanceof Error) return Promise.reject(next)
      return Promise.resolve(next)
    }
  }
  return calls
}

function resp (message, finishReason) {
  return {
    choices: [{ index: 0, message, finish_reason: finishReason }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  }
}

function fakeHost (win, results) {
  win.HOST_BRIDGE = {
    executeToolCall (name, args) {
      return Promise.resolve(results && results[name] ? results[name] : { ok: true, message: 'ok ' + name })
    },
    resetSpamGuard () {}
  }
}

test('loop: empty tool_calls with finish_reason=tool_calls retries then aborts loudly', async () => {
  const win = loadLoop()
  fakeHost(win)
  const anomaly = resp({ role: 'assistant', content: null, reasoning: 'thinking...' }, 'tool_calls')
  const calls = scriptProvider(win, [anomaly, anomaly, anomaly, anomaly])

  const result = await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', systemPrompt: 'sp', messages: [{ role: 'user', content: 'hi' }]
  })
  // 1 original + 2 retries = 3 invocations, then abort.
  assert.strictEqual(calls.length, 3)
  assert.match(result.content, /no tool calls/i)
  assert.match(result.content, /Cloud\.ru streaming bug/i)
  assert.strictEqual(result.toolCallLog.length, 0)
})

test('loop: empty final content is replaced by a tool-log summary', async () => {
  const win = loadLoop()
  fakeHost(win)
  const calls = scriptProvider(win, [
    resp({
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'create_layer', arguments: '{}' } },
        { id: 'c2', type: 'function', function: { name: 'set_keyframes_batch', arguments: '{"targets":[]}' } }
      ]
    }, 'tool_calls'),
    resp({ role: 'assistant', content: '' }, 'stop')
  ])

  const result = await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', systemPrompt: 'sp', messages: [{ role: 'user', content: 'hi' }]
  })
  assert.strictEqual(calls.length, 2)
  assert.ok(result.content.length > 0, 'content must never be empty')
  assert.match(result.content, /2 tool calls/)
  assert.match(result.content, /create_layer/)
  assert.match(result.content, /set_keyframes_batch/)
})

test('loop: empty response with no tools at all gets a placeholder', async () => {
  const win = loadLoop()
  fakeHost(win)
  scriptProvider(win, [resp({ role: 'assistant', content: null }, 'stop')])
  const result = await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', systemPrompt: 'sp', messages: [{ role: 'user', content: 'hi' }]
  })
  assert.match(result.content, /empty response/i)
})

test('loop: rejection carries the partial toolCallLog', async () => {
  const win = loadLoop()
  fakeHost(win)
  scriptProvider(win, [
    resp({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'create_layer', arguments: '{}' } }]
    }, 'tool_calls'),
    new Error('Cloud.ru streaming timeout after 300000ms')
  ])

  await assert.rejects(
    win.AGENT_TOOL_LOOP.runAgentLoop({
      modelId: 'm', systemPrompt: 'sp', messages: [{ role: 'user', content: 'hi' }]
    }),
    (err) => {
      assert.match(err.message, /timeout/)
      assert.ok(Array.isArray(err.toolCallLog), 'rejection exposes toolCallLog')
      assert.strictEqual(err.toolCallLog.length, 1)
      assert.strictEqual(err.toolCallLog[0].name, 'create_layer')
      assert.strictEqual(err.toolCallLog[0].status, 'ok')
      return true
    }
  )
})

test('loop: streaming callbacks only forwarded when streaming === true', async () => {
  const win = loadLoop()
  fakeHost(win)
  const onTextChunk = () => {}

  // Default (no flag): non-streaming — no onTextChunk in invoke options.
  let calls = scriptProvider(win, [resp({ role: 'assistant', content: 'done' }, 'stop')])
  await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', systemPrompt: 'sp', messages: [{ role: 'user', content: 'hi' }],
    onTextChunk
  })
  assert.strictEqual(calls[0].options.onTextChunk, undefined, 'no streaming by default')

  // Explicit opt-in.
  calls = scriptProvider(win, [resp({ role: 'assistant', content: 'done' }, 'stop')])
  await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', systemPrompt: 'sp', messages: [{ role: 'user', content: 'hi' }],
    streaming: true, onTextChunk
  })
  assert.strictEqual(typeof calls[0].options.onTextChunk, 'function', 'streaming opt-in forwards callback')
})

test('loop: thinking disabled on all turns by default, first turn exempt with thinkingFirstTurn', async () => {
  const win = loadLoop()
  fakeHost(win)
  const toolTurn = () => resp({
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'c1', type: 'function', function: { name: 'create_layer', arguments: '{}' } }]
  }, 'tool_calls')

  // Default: enable_thinking false on every turn.
  let calls = scriptProvider(win, [toolTurn(), resp({ role: 'assistant', content: 'done' }, 'stop')])
  await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', systemPrompt: 'sp', messages: [{ role: 'user', content: 'hi' }]
  })
  assert.strictEqual(JSON.stringify(calls[0].options.chat_template_kwargs), '{"enable_thinking":false}')
  assert.strictEqual(JSON.stringify(calls[1].options.chat_template_kwargs), '{"enable_thinking":false}')

  // thinkingFirstTurn: turn 0 has no kwargs (server default = thinking ON), later turns disabled.
  calls = scriptProvider(win, [toolTurn(), resp({ role: 'assistant', content: 'done' }, 'stop')])
  await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', systemPrompt: 'sp', messages: [{ role: 'user', content: 'hi' }],
    thinkingFirstTurn: true
  })
  assert.strictEqual(calls[0].options.chat_template_kwargs, undefined, 'planning turn keeps server default')
  assert.strictEqual(JSON.stringify(calls[1].options.chat_template_kwargs), '{"enable_thinking":false}')
})

test('loop: reasoning echoed back as reasoning_content on in-loop assistant turns', async () => {
  const win = loadLoop()
  fakeHost(win)
  const calls = scriptProvider(win, [
    resp({
      role: 'assistant',
      content: null,
      reasoning: 'let me plan this',
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'create_layer', arguments: '{}' } }]
    }, 'tool_calls'),
    resp({ role: 'assistant', content: 'done' }, 'stop')
  ])

  await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', systemPrompt: 'sp', messages: [{ role: 'user', content: 'hi' }]
  })
  const second = calls[1].messages
  const assistantTurn = second.find(m => m.role === 'assistant' && m.tool_calls)
  assert.ok(assistantTurn, 'assistant tool_calls turn echoed')
  assert.strictEqual(assistantTurn.reasoning_content, 'let me plan this', 'renamed to reasoning_content')
  assert.strictEqual(assistantTurn.reasoning, undefined, 'original key removed')
})

test('loop: malformed JSON tool arguments are reported to the model, host not called', async () => {
  const win = loadLoop()
  let hostCalls = 0
  win.HOST_BRIDGE = {
    executeToolCall () { hostCalls++; return Promise.resolve({ ok: true }) },
    resetSpamGuard () {}
  }
  const calls = scriptProvider(win, [
    resp({
      role: 'assistant',
      content: null,
      // Truncated / malformed arguments string (a real Cloud.ru failure mode).
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'create_layer', arguments: '{"name":"x"' } }]
    }, 'tool_calls'),
    resp({ role: 'assistant', content: 'recovered' }, 'stop')
  ])

  const result = await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', systemPrompt: 'sp', messages: [{ role: 'user', content: 'hi' }]
  })
  assert.strictEqual(hostCalls, 0, 'host must not be called with unparsed args')
  assert.strictEqual(result.toolCallLog[0].status, 'error')
  // The model saw an error tool result and must be able to self-correct.
  const toolMsg = calls[1].messages.find(m => m.role === 'tool')
  assert.match(toolMsg.content, /not valid JSON/i)
  assert.strictEqual(result.content, 'recovered')
})

test('loop: empty-string arguments are treated as no args, not an error', async () => {
  const win = loadLoop()
  let seenArgs = null
  win.HOST_BRIDGE = {
    executeToolCall (name, args) { seenArgs = args; return Promise.resolve({ ok: true, message: 'ok' }) },
    resetSpamGuard () {}
  }
  scriptProvider(win, [
    resp({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_host_context', arguments: '' } }]
    }, 'tool_calls'),
    resp({ role: 'assistant', content: 'done' }, 'stop')
  ])

  const result = await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', systemPrompt: 'sp', messages: [{ role: 'user', content: 'hi' }]
  })
  assert.ok(seenArgs && typeof seenArgs === 'object', 'args object passed')
  assert.strictEqual(Object.keys(seenArgs).length, 0, 'empty-string args become {}')
  assert.strictEqual(result.toolCallLog[0].status, 'ok')
})

test('loop: malformed batch_call JSON advises splitting instead of verbatim retry', async () => {
  const win = loadLoop()
  fakeHost(win)
  const calls = scriptProvider(win, [
    resp({
      role: 'assistant',
      content: null,
      // Broken giant batch payload — the live failure mode: the model retried
      // the exact same call 3x and burned steps.
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'batch_call', arguments: '{"calls":[{' } }]
    }, 'tool_calls'),
    resp({ role: 'assistant', content: 'recovered' }, 'stop')
  ])

  await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', systemPrompt: 'sp', messages: [{ role: 'user', content: 'hi' }]
  })
  const toolMsg = calls[1].messages.find(m => m.role === 'tool')
  assert.match(toolMsg.content, /not valid JSON/i)
  assert.match(toolMsg.content, /split the work/i)
  assert.match(toolMsg.content, /do NOT retry the same big call/i)
})

test('loop: malformed large non-batch payload also gets split advice', async () => {
  const win = loadLoop()
  fakeHost(win)
  const bigBroken = '{"targets":[' + '{"x":1},'.repeat(600) // > 4000 chars, unterminated
  const calls = scriptProvider(win, [
    resp({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'apply_expression_batch', arguments: bigBroken } }]
    }, 'tool_calls'),
    resp({ role: 'assistant', content: 'recovered' }, 'stop')
  ])

  await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', systemPrompt: 'sp', messages: [{ role: 'user', content: 'hi' }]
  })
  const toolMsg = calls[1].messages.find(m => m.role === 'tool')
  assert.match(toolMsg.content, /split the work/i)
})

test('loop: small malformed payload keeps the plain re-issue message', async () => {
  const win = loadLoop()
  fakeHost(win)
  const calls = scriptProvider(win, [
    resp({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'create_layer', arguments: '{"name":"x"' } }]
    }, 'tool_calls'),
    resp({ role: 'assistant', content: 'recovered' }, 'stop')
  ])

  await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', systemPrompt: 'sp', messages: [{ role: 'user', content: 'hi' }]
  })
  const toolMsg = calls[1].messages.find(m => m.role === 'tool')
  assert.match(toolMsg.content, /not valid JSON/i)
  assert.doesNotMatch(toolMsg.content, /split the work/i, 'small payloads keep the simple message')
})

test('loop: step cap triggers one tool-less finalization turn with honest summary', async () => {
  const win = loadLoop()
  fakeHost(win)
  const toolTurn = () => resp({
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'c1', type: 'function', function: { name: 'create_layer', arguments: '{}' } }]
  }, 'tool_calls')
  const calls = scriptProvider(win, [
    toolTurn(),
    resp({ role: 'assistant', content: 'Сделано частично: слой создан, сетка не закончена.' }, 'stop')
  ])

  const result = await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', systemPrompt: 'sp', messages: [{ role: 'user', content: 'hi' }],
    maxSteps: 1
  })
  assert.strictEqual(calls.length, 2, 'one work turn + one finalization turn')
  // Finalization turn must not offer tools.
  assert.strictEqual(calls[1].options.tools, undefined, 'no tools on the finalization turn')
  // It must carry the system nudge asking for an honest report.
  const lastMsg = calls[1].messages[calls[1].messages.length - 1]
  assert.strictEqual(lastMsg.role, 'user')
  assert.match(lastMsg.content, /step limit/i)
  assert.match(lastMsg.content, /NOT completed/i)
  // Final content = cap note + the model's own summary.
  assert.match(result.content, /maximum step limit \(1\)/)
  assert.match(result.content, /Сделано частично/)
  assert.strictEqual(result.toolCallLog.length, 1)
})

test('loop: step cap falls back to the stub when the finalization turn fails', async () => {
  const win = loadLoop()
  fakeHost(win)
  const calls = scriptProvider(win, [
    resp({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'create_layer', arguments: '{}' } }]
    }, 'tool_calls'),
    new Error('provider down')
  ])

  const result = await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', systemPrompt: 'sp', messages: [{ role: 'user', content: 'hi' }],
    maxSteps: 1
  })
  assert.strictEqual(calls.length, 2)
  assert.match(result.content, /maximum step limit \(1\)/)
  assert.match(result.content, /Partial results above/)
  assert.strictEqual(result.toolCallLog.length, 1, 'partial log preserved')
})

/* ── Plan-first + verify turns (2026-09-02) ─────────────────────────── */

const ONE_TOOL = [{ type: 'function', function: { name: 'add_keyframes', parameters: { type: 'object', properties: {} } } }]
function toolCallMsg (name, args) {
  return { role: 'assistant', content: null, tool_calls: [{ id: 'c_' + name, type: 'function', function: { name, arguments: JSON.stringify(args || {}) } }] }
}

test('loop: plan turn runs tool-less first, keeps the plan in history, prepends it to the outcome', async () => {
  const win = loadLoop()
  const calls = scriptProvider(win, [
    resp({ role: 'assistant', content: 'PLAN: 1) target Circle 2) no constraints 3) opacity 0→100 4) add_keyframes' }, 'stop'),
    resp(toolCallMsg('add_keyframes', { layer_id: 1, property_path: 'Transform>Opacity', keyframes: [{ time: 0, value: 0 }] }), 'tool_calls'),
    resp({ role: 'assistant', content: 'Готово: opacity анимирована.' }, 'stop')
  ])
  fakeHost(win)
  const result = await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', systemPrompt: 'sys', messages: [{ role: 'user', content: 'сделай fade' }], tools: ONE_TOOL, planTurn: true
  })
  assert.strictEqual(calls.length, 3)
  assert.strictEqual(calls[0].options.tools, undefined, 'plan turn carries no tools')
  const planReq = calls[0].messages[calls[0].messages.length - 1]
  assert.strictEqual(planReq.role, 'user')
  assert.match(planReq.content, /PLAN FIRST/)
  assert.match(planReq.content, /HARD CONSTRAINTS/)
  assert.ok(calls[1].options.tools && calls[1].options.tools.length === 1, 'tool turn has tools')
  assert.ok(calls[1].messages.some(m => m.role === 'assistant' && /PLAN: 1\)/.test(m.content)), 'plan stays in the loop history')
  assert.strictEqual(result.content, 'PLAN: 1) target Circle 2) no constraints 3) opacity 0→100 4) add_keyframes\n\nГотово: opacity анимирована.')
  assert.strictEqual(result.outcome, 'Готово: opacity анимирована.', 'outcome = final message without the plan')
  assert.strictEqual(result.plan, 'PLAN: 1) target Circle 2) no constraints 3) opacity 0→100 4) add_keyframes')
  assert.strictEqual(result.toolCallLog.length, 1)
})

test('loop: verify turn reports layers unlocked during the run (also inside batch_call)', async () => {
  const win = loadLoop()
  const calls = scriptProvider(win, [
    resp(toolCallMsg('batch_call', { calls: [{ tool: 'set_layer_switches', args: { layer_id: 160, locked: false } }, { tool: 'set_property_value', args: { layer_id: 160, property_path: 'Transform>Position', value: [740, 640] } }, { tool: 'set_layer_switches', args: { layer_id: 160, locked: true } }] }), 'tool_calls'),
    resp({ role: 'assistant', content: 'Сдвинул.' }, 'stop'),
    resp({ role: 'assistant', content: 'Сдвинул (слой был заблокирован — снял и вернул блокировку).' }, 'stop')
  ])
  fakeHost(win)
  const result = await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', messages: [{ role: 'user', content: 'сдвинь Card 2 вниз' }], tools: ONE_TOOL,
    verifyTurn: true, getSceneDiff: () => Promise.resolve({ text: '~ "Card 2": position: [740,540,0] → [740,640,0]', changed: true })
  })
  const verifyReq = calls[2].messages[calls[2].messages.length - 1].content
  assert.match(verifyReq, /UNLOCKED layer\(s\) during this run \(layer_id 160\)/)
  assert.match(result.outcome, /снял и вернул/)
  assert.strictEqual(JSON.stringify(win.AGENT_TOOL_LOOP.collectUnlocks([{ name: 'set_layer_switches', status: 'ok', args: { layer_index: 3, locked: false } }, { name: 'set_layer_switches', status: 'ok', args: { layer_id: 5, locked: true } }])), JSON.stringify(['layer_index 3']))
  assert.ok(!/UNLOCKED/.test(win.AGENT_TOOL_LOOP.buildVerifyMessage({ text: 'x', changed: true }, [])))
})

test('loop: a plan restated on the execution turn gets one nudge, then the work happens', async () => {
  const win = loadLoop()
  const G = require('../lib/pure/doneGuard.js')
  win.PURE_DONE_GUARD = G
  const planText = '1. Получить сводку композиции (`get_detailed_comp_summary`).\n2. Найти Circle A.\n3. Применить set_property_value с новым X.'
  const calls = scriptProvider(win, [
    resp({ role: 'assistant', content: planText }, 'stop'),
    resp({ role: 'assistant', content: planText }, 'stop'),
    resp(toolCallMsg('add_keyframes', { layer_id: 1 }), 'tool_calls'),
    resp({ role: 'assistant', content: 'Сдвинул Circle A на 200 px.' }, 'stop')
  ])
  fakeHost(win)
  const result = await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', messages: [{ role: 'user', content: 'подвинь Circle A правее на 200' }], tools: ONE_TOOL, planTurn: true
  })
  assert.strictEqual(calls.length, 4)
  const nudge = calls[2].messages[calls[2].messages.length - 1]
  assert.strictEqual(nudge.role, 'user')
  assert.match(nudge.content, /That is a plan, not the work/)
  assert.strictEqual(result.toolCallLog.length, 1)
  assert.strictEqual(result.outcome, 'Сдвинул Circle A на 200 px.')
})

test('loop: options.journal is inserted as a [SYSTEM] user message right before the latest request', async () => {
  const win = loadLoop()
  fakeHost(win)
  const journal = '[SYSTEM] JOURNAL — what YOU changed earlier in this comp ("C"), oldest first.\n#1 request: «orbit»\n  - apply_motion_recipe orbit → "Circle C" (id 14)'
  const tag = (m) => m.role + ':' + (/^\[SYSTEM\] JOURNAL/.test(m.content) ? 'JOURNAL' : (/^\[SYSTEM\] PLAN/.test(m.content) ? 'PLAN' : m.content))
  let calls = scriptProvider(win, [resp({ role: 'assistant', content: 'ok' }, 'stop')])
  await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', systemPrompt: 'sp', tools: ONE_TOOL, journal,
    messages: [{ role: 'user', content: 'make orbit' }, { role: 'assistant', content: 'done' }, { role: 'user', content: 'twice faster' }]
  })
  assert.strictEqual(calls[0].messages.map(tag).join(' | '), 'system:sp | user:make orbit | assistant:done | user:JOURNAL | user:twice faster')
  // with the plan turn: journal before the request, the plan instruction after it
  calls = scriptProvider(win, [resp({ role: 'assistant', content: 'план [[final]]' }, 'stop')])
  await win.AGENT_TOOL_LOOP.runAgentLoop({ modelId: 'm', tools: ONE_TOOL, messages: [{ role: 'user', content: 'faster' }], journal, planTurn: true })
  assert.strictEqual(calls[0].messages.map(tag).join(' | '), 'user:JOURNAL | user:faster | user:PLAN')
  // an empty / whitespace journal inserts nothing
  calls = scriptProvider(win, [resp({ role: 'assistant', content: 'ok' }, 'stop')])
  await win.AGENT_TOOL_LOOP.runAgentLoop({ modelId: 'm', tools: ONE_TOOL, messages: [{ role: 'user', content: 'x' }], journal: '  ' })
  assert.strictEqual(calls[0].messages.length, 1)
})

test('loop: a plan or a done-claim glued to [[final]] on the plan turn does not end the run', async () => {
  const win = loadLoop()
  win.PURE_DONE_GUARD = require('../lib/pure/doneGuard.js')
  fakeHost(win)
  const plans = []
  const planText = '1. Получить сводку композиции (`get_detailed_comp_summary`).\n2. Найти Circle C.\n3. Применить set_property_value Scale = 60%.'
  const calls = scriptProvider(win, [
    resp({ role: 'assistant', content: planText + '\n[[final]]' }, 'stop'),
    resp(toolCallMsg('add_keyframes', { layer_id: 1 }), 'tool_calls'),
    resp({ role: 'assistant', content: 'Уменьшил Circle C до 60%.' }, 'stop')
  ])
  const result = await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', messages: [{ role: 'user', content: 'Уменьши Circle C до 60 процентов.' }], tools: ONE_TOOL, planTurn: true, onPlan: (p) => plans.push(p)
  })
  assert.strictEqual(calls.length, 3, 'plan turn + tool turn + final answer')
  assert.match(calls[1].messages[calls[1].messages.length - 1].content, /That is a plan, not the work/)
  assert.strictEqual(plans.join('|'), planText, 'the plan is still shown to the user')
  assert.strictEqual(result.toolCallLog.length, 1)
  assert.strictEqual(result.outcome, 'Уменьшил Circle C до 60%.')
  assert.strictEqual(result.plan, planText)
  // a "done" claim with the marker and zero tool calls gets the no-tools nudge
  const calls2 = scriptProvider(win, [
    resp({ role: 'assistant', content: 'Готово — уменьшил Circle C до 60%. [[final]]' }, 'stop'),
    resp({ role: 'assistant', content: 'Ничего не изменено: нужен вызов инструмента.' }, 'stop')
  ])
  const r2 = await win.AGENT_TOOL_LOOP.runAgentLoop({ modelId: 'm', messages: [{ role: 'user', content: 'Уменьши' }], tools: ONE_TOOL, planTurn: true })
  assert.strictEqual(calls2.length, 2)
  assert.match(calls2[1].messages[calls2[1].messages.length - 1].content, /ZERO tool calls/)
  assert.strictEqual(r2.outcome, 'Ничего не изменено: нужен вызов инструмента.')
})

test('loop: after a no-change VERIFY, a reply that still claims the work is done gets one nudge', async () => {
  const win = loadLoop()
  win.PURE_DONE_GUARD = require('../lib/pure/doneGuard.js')
  fakeHost(win)
  const calls = scriptProvider(win, [
    resp(toolCallMsg('add_keyframes', { layer_id: 1 }), 'tool_calls'),
    resp({ role: 'assistant', content: 'Готово: карточки появляются по очереди.' }, 'stop'),
    resp({ role: 'assistant', content: 'Opacity у каждой карточки теперь анимируется — сделано.' }, 'stop'),
    resp({ role: 'assistant', content: 'Ничего не изменилось: мои ключи были удалены последующим вызовом.' }, 'stop')
  ])
  const result = await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', messages: [{ role: 'user', content: 'stagger' }], tools: ONE_TOOL, verifyTurn: true,
    getSceneDiff: () => Promise.resolve({ text: 'No changes detected in composition "C" — its state before and after the run is identical.', changed: false })
  })
  assert.strictEqual(calls.length, 4, 'tool turn + first answer + verify reply + nudged reply')
  assert.match(calls[2].messages[calls[2].messages.length - 1].content, /VERIFY before finishing/)
  assert.match(calls[3].messages[calls[3].messages.length - 1].content, /scene diff showed NO changes/)
  assert.strictEqual(result.outcome, 'Ничего не изменилось: мои ключи были удалены последующим вызовом.')
  // an honest verify reply (no action claim) is accepted as is
  const calls2 = scriptProvider(win, [
    resp(toolCallMsg('add_keyframes', { layer_id: 1 }), 'tool_calls'),
    resp({ role: 'assistant', content: 'Проверяю.' }, 'stop'),
    resp({ role: 'assistant', content: 'Изменений нет: инструмент отказал, ключи не тронуты.' }, 'stop')
  ])
  const r2 = await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', messages: [{ role: 'user', content: 'stagger' }], tools: ONE_TOOL, verifyTurn: true,
    getSceneDiff: () => Promise.resolve({ text: 'No changes detected', changed: false })
  })
  assert.strictEqual(calls2.length, 3)
  assert.strictEqual(r2.outcome, 'Изменений нет: инструмент отказал, ключи не тронуты.')
})

test('loop: plan turn [[final]] marker short-circuits pure questions', async () => {
  const win = loadLoop()
  const calls = scriptProvider(win, [resp({ role: 'assistant', content: 'wiggle(f, a) — процедурный шум. [[final]]' }, 'stop')])
  fakeHost(win)
  const result = await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', messages: [{ role: 'user', content: 'что такое wiggle?' }], tools: ONE_TOOL, planTurn: true
  })
  assert.strictEqual(calls.length, 1)
  assert.strictEqual(result.content, 'wiggle(f, a) — процедурный шум.')
  assert.strictEqual(result.toolCallLog.length, 0)
})

test('loop: a bare [[final]] marker on the execution turn means the plan text was the answer', async () => {
  const win = loadLoop()
  const answer = 'wiggle(2, 30): частота 2 раза в секунду, амплитуда 30 px.'
  scriptProvider(win, [
    resp({ role: 'assistant', content: answer }, 'stop'),
    resp({ role: 'assistant', content: '[[final]]' }, 'stop')
  ])
  fakeHost(win)
  const result = await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', messages: [{ role: 'user', content: 'что такое wiggle?' }], tools: ONE_TOOL, planTurn: true
  })
  assert.strictEqual(result.outcome, answer, 'outcome is the answer, never the marker')
  assert.strictEqual(result.content, answer)
  // marker appended to a real answer is stripped too
  scriptProvider(win, [resp({ role: 'assistant', content: 'Готово: сдвинул. [[final]]' }, 'stop')])
  const r2 = await win.AGENT_TOOL_LOOP.runAgentLoop({ modelId: 'm', messages: [{ role: 'user', content: 'x' }], tools: ONE_TOOL })
  assert.strictEqual(r2.outcome, 'Готово: сдвинул.')
})

test('loop: empty plan content falls back to the normal first turn without the instruction', async () => {
  const win = loadLoop()
  const calls = scriptProvider(win, [
    resp({ role: 'assistant', content: null }, 'stop'),
    resp({ role: 'assistant', content: 'Ответ без плана.' }, 'stop')
  ])
  fakeHost(win)
  const result = await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', messages: [{ role: 'user', content: 'привет' }], tools: ONE_TOOL, planTurn: true
  })
  assert.strictEqual(calls.length, 2)
  const last = calls[1].messages[calls[1].messages.length - 1]
  assert.strictEqual(last.content, 'привет', 'plan instruction dropped from history')
  assert.ok(calls[1].options.tools, 'tools restored on the normal turn')
  assert.strictEqual(result.content, 'Ответ без плана.')
})

test('loop: verify turn injects the scene diff once after a mutating run', async () => {
  const win = loadLoop()
  const calls = scriptProvider(win, [
    resp(toolCallMsg('add_keyframes', { layer_id: 1 }), 'tool_calls'),
    resp({ role: 'assistant', content: 'Готово.' }, 'stop'),
    resp({ role: 'assistant', content: 'Готово (проверено).' }, 'stop')
  ])
  fakeHost(win)
  let diffCalls = 0
  const result = await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', messages: [{ role: 'user', content: 'анимируй' }], tools: ONE_TOOL,
    verifyTurn: true,
    getSceneDiff: () => { diffCalls++; return Promise.resolve({ text: 'Actual changes in "Main": 0 added, 0 removed, 1 changed.\n~ "Circle": opacity: keyframes added (2 keys, 0.00–1.00s)', changed: true }) }
  })
  assert.strictEqual(diffCalls, 1)
  assert.strictEqual(calls.length, 3)
  const verifyReq = calls[2].messages[calls[2].messages.length - 1]
  assert.strictEqual(verifyReq.role, 'user')
  assert.match(verifyReq.content, /VERIFY before finishing/)
  assert.match(verifyReq.content, /keyframes added \(2 keys/)
  assert.match(verifyReq.content, /probe_motion/)
  assert.ok(!/NO changes were detected/.test(verifyReq.content))
  assert.strictEqual(result.content, 'Готово (проверено).')
})

test('loop: verify turn is skipped for read-only runs, and flags a run that changed nothing', async () => {
  const win = loadLoop()
  const calls = scriptProvider(win, [
    resp(toolCallMsg('get_keyframes', { layer_index: 1, property_path: 'Transform>Opacity' }), 'tool_calls'),
    resp({ role: 'assistant', content: 'Вот ключи.' }, 'stop')
  ])
  fakeHost(win)
  let diffCalls = 0
  const result = await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', messages: [{ role: 'user', content: 'покажи ключи' }], tools: ONE_TOOL,
    verifyTurn: true, getSceneDiff: () => { diffCalls++; return Promise.resolve({ text: 'x', changed: false }) }
  })
  assert.strictEqual(diffCalls, 0, 'read-only run never triggers verify')
  assert.strictEqual(calls.length, 2)
  assert.strictEqual(result.content, 'Вот ключи.')
  const msg = win.AGENT_TOOL_LOOP.buildVerifyMessage({ text: 'No changes detected in composition "Main".', changed: false })
  assert.match(msg, /NO changes were detected/)
  assert.match(msg, /No changes detected in composition "Main"/)
  assert.ok(!/renders NOTHING/.test(msg), 'hidden-layer sentence only when the diff marks one')
  const hiddenMsg = win.AGENT_TOOL_LOOP.buildVerifyMessage({ text: '~ "Label" [video switch OFF — not visible]: scale: [100,100,100] → [80,80,100]', changed: true })
  assert.match(hiddenMsg, /renders NOTHING/)
  assert.match(hiddenMsg, /set_layer_switches enabled:true/)
})

test('loop: tool gating offers CORE + keyword groups and loads a gated group on demand', async () => {
  const win = loadLoop()
  const tools = ['create_layer', 'add_mask', 'apply_expression', 'set_camera_properties'].map(n => ({ type: 'function', function: { name: n, parameters: { type: 'object', properties: {} } } }))
  const calls = scriptProvider(win, [
    resp(toolCallMsg('add_mask', { layer_id: 1 }), 'tool_calls'),
    resp({ role: 'assistant', content: 'Маска добавлена.' }, 'stop')
  ])
  fakeHost(win)
  const result = await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', messages: [{ role: 'user', content: 'сделай так, чтобы слой мигал через выражение' }], tools, toolGating: true
  })
  const names = c => (c.options.tools || []).map(t => t.function.name)
  assert.strictEqual(JSON.stringify(names(calls[0])), JSON.stringify(['create_layer', 'apply_expression']), 'turn 1: CORE + expressions (keyword), masks/3D gated')
  assert.strictEqual(JSON.stringify(names(calls[1])), JSON.stringify(['create_layer', 'add_mask', 'apply_expression']), 'turn 2: masks loaded on demand after the model called add_mask')
  assert.strictEqual(result.toolCallLog[0].name, 'add_mask')
  assert.strictEqual(result.toolCallLog[0].status, 'ok', 'the gated call still executed')
  assert.strictEqual(JSON.stringify(result.toolGating.initialGroups), JSON.stringify(['expressions']))
  assert.strictEqual(JSON.stringify(result.toolGating.loadedOnDemand), JSON.stringify(['masks']))
  assert.strictEqual(result.toolGating.allTools, 4)
  // Off by default: every tool is offered and no toolGating summary is attached.
  const calls2 = scriptProvider(win, [resp({ role: 'assistant', content: 'ок' }, 'stop')])
  const r2 = await win.AGENT_TOOL_LOOP.runAgentLoop({ modelId: 'm', messages: [{ role: 'user', content: 'привет' }], tools })
  assert.strictEqual(names(calls2[0]).length, 4)
  assert.strictEqual(r2.toolGating, undefined)
})

test('loop: probe_motion is read-only (parallelizable, not counted for Undo)', () => {
  const win = loadLoop()
  assert.strictEqual(win.AGENT_TOOL_LOOP.READ_ONLY_TOOLS.probe_motion, 1)
  assert.strictEqual(win.AGENT_TOOL_LOOP.READ_ONLY_TOOLS.get_detailed_comp_summary, 1)
})

test('loop: tool results are paired to tool_call ids in the conversation', async () => {
  const win = loadLoop()
  fakeHost(win, { create_layer: { ok: true, message: 'Created.' } })
  const calls = scriptProvider(win, [
    resp({
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call_abc', type: 'function', function: { name: 'create_layer', arguments: '{"name":"x"}' } }]
    }, 'tool_calls'),
    resp({ role: 'assistant', content: 'done' }, 'stop')
  ])

  await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', systemPrompt: 'sp', messages: [{ role: 'user', content: 'hi' }]
  })
  // Second invocation must contain the assistant tool_calls turn + tool result.
  const second = calls[1].messages
  const toolMsg = second.find(m => m.role === 'tool')
  assert.ok(toolMsg, 'tool result message present')
  assert.strictEqual(toolMsg.tool_call_id, 'call_abc')
  assert.match(toolMsg.content, /Created\./)
})
