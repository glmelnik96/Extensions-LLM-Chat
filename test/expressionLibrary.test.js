/**
 * Tests for lib/pure/expressionLibrary.js (Stage 3) and the per-turn
 * tool-result trimming in agentToolLoop.js (P1-3).
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function loadBrowserGlobal (file) {
  const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const sandbox = { window: {}, console }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox, { filename: file })
  return sandbox.window
}

const win = loadBrowserGlobal('lib/pure/expressionLibrary.js')
const lib = win.PURE_EXPR_LIB

test('exprlib: module loads with snippets', () => {
  assert.ok(lib && Array.isArray(lib.SNIPPETS))
  assert.ok(lib.SNIPPETS.length >= 25, 'has at least 25 snippets, got ' + lib.SNIPPETS.length)
})

test('exprlib: every snippet is well-formed', () => {
  const ids = new Set()
  for (const s of lib.SNIPPETS) {
    assert.ok(typeof s.id === 'string' && s.id.length > 0)
    assert.ok(!ids.has(s.id), 'duplicate snippet id: ' + s.id)
    ids.add(s.id)
    assert.ok(typeof s.name === 'string' && s.name.length > 0, s.id + ' has name')
    assert.ok(Array.isArray(s.keywords) && s.keywords.length >= 3, s.id + ' has 3+ keywords')
    assert.ok(typeof s.target === 'string' && s.target.length > 0, s.id + ' has target')
    assert.ok(typeof s.expression === 'string' && s.expression.length > 0, s.id + ' has expression')
    assert.ok(typeof s.notes === 'string' && s.notes.length > 0, s.id + ' has notes')
    assert.ok(Array.isArray(s.requires), s.id + ' has requires array')
  }
})

test('exprlib: snippets avoid known AE expression pitfalls', () => {
  for (const s of lib.SNIPPETS) {
    assert.ok(!s.expression.includes('text.sourceText.value'), s.id + ': must not use text.sourceText.value')
    assert.ok(!/\bnew Date\b|\bDate\(/.test(s.expression), s.id + ': Date() unavailable in AE expressions')
    // Balanced braces/parens (cheap sanity check).
    for (const [open, close] of [['{', '}'], ['(', ')'], ['[', ']']]) {
      const opens = s.expression.split(open).length - 1
      const closes = s.expression.split(close).length - 1
      assert.strictEqual(opens, closes, s.id + ': unbalanced ' + open + close)
    }
  }
})

test('exprlib: search finds bounce by keyword', () => {
  const r = lib.search('bounce')
  assert.strictEqual(r.ok, true)
  assert.ok(r.snippets.length >= 1)
  assert.strictEqual(r.snippets[0].id, 'inertial-bounce')
  assert.match(r.snippets[0].expression, /velocityAtTime/)
})

test('exprlib: search supports russian keywords', () => {
  const r = lib.search('печатная машинка')
  assert.strictEqual(r.ok, true)
  assert.ok(r.snippets.some(s => s.id === 'typewriter'), 'typewriter found via RU keywords')
})

test('exprlib: search respects max_results and returns requires', () => {
  const r = lib.search('wiggle', 2)
  assert.strictEqual(r.ok, true)
  assert.ok(r.snippets.length <= 2)
  const slider = lib.search('slider control rig')
  assert.ok(slider.snippets.some(s => s.requires.indexOf('ADBE Slider Control') !== -1), 'slider snippets declare required controller effect')
})

test('exprlib: 2026-07 additions are findable via EN and RU keywords', () => {
  const cases = [
    ['spin forever', 'spin-forever'],
    ['вращение', 'spin-forever'],
    ['overshoot pop', 'overshoot-settle'],
    ['музыка бит', 'audio-reactive'],
    ['seedrandom duplicate', 'random-per-layer'],
    ['snap zoom', 'snap-zoom'],
    ['aim target', 'look-at-layer'],
    ['lens flare 3d', 'effect-point-to-3d'],
    ['parent inverse scale', 'keep-scale-when-parented'],
    ['walk cycle offset', 'loop-offset'],
    ['clamp limit', 'clamp-range']
  ]
  for (const [query, id] of cases) {
    const r = lib.search(query)
    assert.strictEqual(r.ok, true, query)
    assert.ok(r.snippets.some(s => s.id === id), `"${query}" should find ${id}, got: ` + r.snippets.map(s => s.id).join(', '))
  }
})

test('exprlib: 2026-07 round-2 additions are findable via EN and RU keywords', () => {
  const cases = [
    ['checkbox toggle', 'checkbox-toggle'],
    ['чекбокс', 'checkbox-toggle'],
    ['dropdown menu', 'dropdown-switch'],
    ['выпадающий вариант', 'dropdown-switch'],
    ['box alignment left', 'auto-box-anchored'],
    ['camera shake', 'camera-shake'],
    ['землетрясение', 'camera-shake'],
    ['follow motion path', 'attach-to-path'],
    ['траектория', 'attach-to-path'],
    ['trim paths draw on', 'trim-paths-reveal'],
    ['прорисовка', 'trim-paths-reveal'],
    ['freeze frame', 'freeze-frame'],
    ['стоп-кадр', 'freeze-frame'],
    ['зациклить видео', 'time-remap-loop'],
    ['timecode', 'timecode'],
    ['таймкод', 'timecode'],
    ['depth of field focus', 'autofocus-dof'],
    ['автофокус', 'autofocus-dof'],
    ['pin corner responsive', 'pin-to-edge'],
    ['ужать текст', 'auto-fit-text'],
    ['constant stroke width', 'keep-stroke-width'],
    ['толщина', 'keep-stroke-width'],
    ['heartbeat bpm', 'heartbeat-pulse'],
    ['пульс сердце', 'heartbeat-pulse'],
    ['word by word', 'word-by-word-reveal'],
    ['субтитры', 'word-by-word-reveal']
  ]
  for (const [query, id] of cases) {
    const r = lib.search(query)
    assert.strictEqual(r.ok, true, query)
    assert.ok(r.snippets.some(s => s.id === id), `"${query}" should find ${id}, got: ` + r.snippets.map(s => s.id).join(', '))
  }
})

test('exprlib: "bounce" still ranks inertial-bounce first after additions', () => {
  const r = lib.search('bounce')
  assert.strictEqual(r.snippets[0].id, 'inertial-bounce')
})

test('exprlib: empty query → ok:false, nonsense query → ok:true with guidance', () => {
  const empty = lib.search('')
  assert.strictEqual(empty.ok, false)
  const nada = lib.search('zzzz-no-such-thing')
  assert.strictEqual(nada.ok, true)
  assert.strictEqual(nada.snippets.length, 0)
  assert.match(nada.message, /manually/i)
})

// ── P1-3: per-turn tool-result trimming in the agent loop ──────────────────

function loadLoop () {
  const code = fs.readFileSync(path.join(__dirname, '..', 'agentToolLoop.js'), 'utf8')
  const sandbox = { window: {}, console }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox, { filename: 'agentToolLoop.js' })
  return sandbox.window
}

test('loop: old verbose tool results are trimmed, recent 8 kept intact', async () => {
  const win = loadLoop()
  win.HOST_BRIDGE = {
    executeToolCall: () => Promise.resolve({ ok: true, message: 'x'.repeat(2000) }),
    resetSpamGuard () {}
  }
  const toolTurn = (n) => ({
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c' + n, type: 'function', function: { name: 'create_layer', arguments: '{}' } }]
      },
      finish_reason: 'tool_calls'
    }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  })
  // 12 tool turns then a final answer → 12 tool messages in history.
  const script = []
  for (let i = 0; i < 12; i++) script.push(toolTurn(i))
  script.push({
    choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
  })
  const calls = []
  win.CHAT_PROVIDER = {
    invoke (modelId, messages, options) {
      calls.push(messages.map(m => ({ role: m.role, content: m.content })))
      return Promise.resolve(script.shift())
    }
  }

  await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', systemPrompt: 'sp', messages: [{ role: 'user', content: 'hi' }]
  })

  // Final invocation sees 12 tool messages: first 4 trimmed, last 8 intact.
  const last = calls[calls.length - 1]
  const toolMsgs = last.filter(m => m.role === 'tool')
  assert.strictEqual(toolMsgs.length, 12)
  for (let i = 0; i < 4; i++) {
    assert.ok(toolMsgs[i].content.length < 500, 'old result ' + i + ' trimmed')
    assert.match(toolMsgs[i].content, /truncated to save context/)
  }
  for (let i = 4; i < 12; i++) {
    assert.ok(toolMsgs[i].content.length > 1500, 'recent result ' + i + ' intact')
  }
})

test('loop: short old tool results are left untouched', async () => {
  const win = loadLoop()
  win.HOST_BRIDGE = {
    executeToolCall: () => Promise.resolve({ ok: true, message: 'short' }),
    resetSpamGuard () {}
  }
  const toolTurn = (n) => ({
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'c' + n, type: 'function', function: { name: 'create_layer', arguments: '{}' } }]
      },
      finish_reason: 'tool_calls'
    }],
    usage: {}
  })
  const script = []
  for (let i = 0; i < 10; i++) script.push(toolTurn(i))
  script.push({
    choices: [{ index: 0, message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
    usage: {}
  })
  const calls = []
  win.CHAT_PROVIDER = {
    invoke (modelId, messages) {
      calls.push(messages.map(m => ({ role: m.role, content: m.content })))
      return Promise.resolve(script.shift())
    }
  }
  await win.AGENT_TOOL_LOOP.runAgentLoop({
    modelId: 'm', systemPrompt: 'sp', messages: [{ role: 'user', content: 'hi' }]
  })
  const last = calls[calls.length - 1]
  for (const m of last.filter(x => x.role === 'tool')) {
    assert.ok(!m.content.includes('truncated to save context'), 'short results untouched')
  }
})
