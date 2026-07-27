/**
 * Tests for lib/pure/quickActions.js — editable quick-action buttons:
 * defaults, load/serialize round-trip, add/update/remove, validation.
 */
const test = require('node:test')
const assert = require('node:assert')
const qa = require('../lib/pure/quickActions.js')

test('quickActions: 16 defaults, all valid, unique ids', () => {
  const d = qa.DEFAULT_ACTIONS
  assert.strictEqual(d.length, 16)
  const ids = new Set()
  for (const a of d) {
    assert.ok(a.id && a.label && a.prompt, a.id + ' complete')
    assert.ok(!ids.has(a.id), 'duplicate id: ' + a.id)
    ids.add(a.id)
  }
  assert.strictEqual(d[0].label, 'Wiggle')
  assert.strictEqual(d[15].label, 'Center Anchor')
})

test('quickActions: loadActions falls back to defaults on bad input', () => {
  for (const raw of [null, '', 'not json', '{"actions": 5}', '{}']) {
    const out = qa.loadActions(raw)
    assert.strictEqual(out.length, 16, 'fallback for: ' + JSON.stringify(raw))
  }
})

test('quickActions: loadActions keeps a stored empty list (user deleted all)', () => {
  assert.deepStrictEqual(qa.loadActions('{"actions": []}'), [])
})

test('quickActions: load drops invalid entries, truncates label, defaults title', () => {
  const raw = JSON.stringify({
    actions: [
      { id: 'a', label: 'x'.repeat(50), prompt: 'do things' },
      { id: '', label: 'bad', prompt: 'no id' },
      { label: 'noid', prompt: 'p' },
      'junk'
    ]
  })
  const out = qa.loadActions(raw)
  assert.strictEqual(out.length, 1)
  assert.strictEqual(out[0].label.length, 24)
  assert.strictEqual(out[0].title, 'do things')
})

test('quickActions: serialize/load round-trip', () => {
  const out = qa.loadActions(qa.serialize(qa.DEFAULT_ACTIONS))
  assert.strictEqual(out.length, 16)
  assert.deepStrictEqual(out.map(a => a.label), qa.DEFAULT_ACTIONS.map(a => a.label))
})

test('quickActions: addAction appends with generated id; rejects empty', () => {
  const next = qa.addAction([], '  My Btn  ', '  send this  ')
  assert.strictEqual(next.length, 1)
  assert.strictEqual(next[0].label, 'My Btn')
  assert.strictEqual(next[0].prompt, 'send this')
  assert.match(next[0].id, /^qa_user_/)
  assert.strictEqual(qa.addAction([], '', 'p'), null)
  assert.strictEqual(qa.addAction([], 'l', '   '), null)
})

test('quickActions: updateAction replaces in place; null on unknown id / empty', () => {
  const base = qa.DEFAULT_ACTIONS.slice(0, 3)
  const next = qa.updateAction(base, 'qa_loop', 'Loop2', 'new prompt')
  assert.strictEqual(next.length, 3)
  assert.strictEqual(next[1].label, 'Loop2')
  assert.strictEqual(next[1].prompt, 'new prompt')
  assert.strictEqual(next[0].label, 'Wiggle', 'others untouched')
  assert.strictEqual(qa.updateAction(base, 'nope', 'l', 'p'), null)
  assert.strictEqual(qa.updateAction(base, 'qa_loop', '', 'p'), null)
})

test('quickActions: removeAction filters by id', () => {
  const next = qa.removeAction(qa.DEFAULT_ACTIONS, 'qa_wiggle')
  assert.strictEqual(next.length, 15)
  assert.ok(!next.some(a => a.id === 'qa_wiggle'))
})
