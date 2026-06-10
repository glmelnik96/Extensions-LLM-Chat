/**
 * Tests for lib/pure/prune.js — token estimation + smart conversation pruning.
 */
const test = require('node:test')
const assert = require('node:assert')
const PRUNE = require('../lib/pure/prune.js')

const { estimateStringTokens, estimateTokens, pruneConversation, PROTECT_RECENT, TOOL_RESULT_CAP } = PRUNE

test('estimateStringTokens: ASCII ≈ chars/4', () => {
  assert.strictEqual(estimateStringTokens('abcd'), 1)
  assert.strictEqual(estimateStringTokens('abcdefgh'), 2)
  assert.strictEqual(estimateStringTokens(''), 0)
  assert.strictEqual(estimateStringTokens(null), 0)
})

test('estimateStringTokens: Cyrillic counts ~1 token per char', () => {
  // 8 Cyrillic chars → 8 tokens (vs old chars/4 = 2)
  assert.strictEqual(estimateStringTokens('привет!!'), 6 + Math.ceil(2 / 4))
  const ru = 'анимация'
  assert.strictEqual(estimateStringTokens(ru), ru.length)
})

test('estimateTokens: counts content, tool_calls and per-message overhead', () => {
  const messages = [
    { role: 'user', content: 'abcd' }, // 1 + 4 overhead
    {
      role: 'assistant',
      tool_calls: [{ function: { name: 'abcd', arguments: 'efgh' } }] // 1 + 1 + 4
    }
  ]
  assert.strictEqual(estimateTokens(messages), 5 + 6)
})

test('pruneConversation: returns input untouched when under budget', () => {
  const messages = [{ role: 'user', content: 'hi' }]
  assert.strictEqual(pruneConversation(messages, 1000), messages)
})

test('pruneConversation: truncates OLD tool results before dropping messages', () => {
  const big = 'x'.repeat(5000)
  const messages = []
  // 5 old tool messages with big payloads...
  for (let i = 0; i < 5; i++) {
    messages.push({ role: 'assistant', tool_calls: [{ id: 'c' + i, function: { name: 't', arguments: '{}' } }] })
    messages.push({ role: 'tool', tool_call_id: 'c' + i, content: big })
  }
  // ...plus a protected tail of small messages
  for (let i = 0; i < PROTECT_RECENT; i++) {
    messages.push({ role: 'user', content: 'tail ' + i })
  }
  // Budget that truncation alone satisfies (5×5000 chars → 5×~400 chars).
  const pruned = pruneConversation(messages, 3000)
  assert.strictEqual(pruned.length, messages.length, 'no messages dropped when truncation suffices')
  const oldTool = pruned.find(m => m.role === 'tool')
  assert.ok(oldTool.content.length < 500, 'old tool result truncated')
  assert.ok(oldTool.content.includes('[truncated'), 'truncation marker present')
  // Tail untouched
  assert.strictEqual(pruned[pruned.length - 1].content, 'tail ' + (PROTECT_RECENT - 1))
})

test('pruneConversation: protects the recent tail content from truncation', () => {
  const big = 'y'.repeat(3000)
  const messages = []
  for (let i = 0; i < PROTECT_RECENT; i++) {
    messages.push({ role: 'tool', tool_call_id: 'k' + i, content: big })
  }
  // All messages are inside the protected tail → phase 1 must not touch them.
  const pruned = pruneConversation(messages, 10)
  for (const m of pruned) {
    assert.ok(!String(m.content).includes('[truncated'), 'protected tail not truncated')
  }
})

test('pruneConversation: FIFO drop keeps assistant/tool pairing intact', () => {
  const big = 'z'.repeat(4000)
  const messages = [
    { role: 'user', content: big },
    { role: 'assistant', tool_calls: [{ id: 'a', function: { name: 't', arguments: big } }] },
    { role: 'tool', tool_call_id: 'a', content: big },
    { role: 'user', content: big }
  ]
  // Tiny budget forces drops down to minKeep (= messages.length here ≤ 20 → minKeep
  // = min(len,20) = 4 → nothing dropped... so use >20 messages instead).
  const many = []
  for (let i = 0; i < 15; i++) {
    many.push({ role: 'assistant', tool_calls: [{ id: 'id' + i, function: { name: 't', arguments: big } }] })
    many.push({ role: 'tool', tool_call_id: 'id' + i, content: big })
  }
  const pruned = pruneConversation(many, 2000)
  assert.ok(pruned.length < many.length, 'some messages dropped')
  assert.notStrictEqual(pruned[0].role, 'tool', 'never starts with an orphaned tool result')
  // Every tool message must be preceded (somewhere before) by its assistant call.
  const seenCallIds = new Set()
  for (const m of pruned) {
    if (m.tool_calls) m.tool_calls.forEach(tc => seenCallIds.add(tc.id))
    if (m.role === 'tool') assert.ok(seenCallIds.has(m.tool_call_id), 'tool result has its assistant tool_call')
  }
  void messages
})

test('pruneConversation: keeps at least the protected-tail count when possible', () => {
  const big = 'w'.repeat(10000)
  const many = []
  for (let i = 0; i < 40; i++) many.push({ role: 'user', content: big })
  const pruned = pruneConversation(many, 100) // impossible budget
  assert.ok(pruned.length >= Math.min(40, PROTECT_RECENT), 'protected tail retained even over budget')
})

test('constants exported', () => {
  assert.strictEqual(typeof PROTECT_RECENT, 'number')
  assert.strictEqual(typeof TOOL_RESULT_CAP, 'number')
})
