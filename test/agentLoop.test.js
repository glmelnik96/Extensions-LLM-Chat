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
