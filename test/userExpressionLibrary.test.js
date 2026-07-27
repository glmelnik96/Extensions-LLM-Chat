/**
 * Tests for lib/pure/userExpressionLibrary.js — personal expression snippets:
 * load/serialize round-trip, add/remove, keyword normalization — and the
 * merged search in lib/pure/expressionLibrary.js (extraSnippets param).
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ux = require('../lib/pure/userExpressionLibrary.js')

function loadBrowserGlobal (file) {
  const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const sandbox = { window: {}, console }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox, { filename: file })
  return sandbox.window
}
const exprLib = loadBrowserGlobal('lib/pure/expressionLibrary.js').PURE_EXPR_LIB

test('userExprLib: loadSnippets returns [] on bad input', () => {
  for (const raw of [null, '', 'not json', '{"snippets": 5}', '{}', '[]']) {
    assert.deepStrictEqual(ux.loadSnippets(raw), [], 'for: ' + JSON.stringify(raw))
  }
})

test('userExprLib: addSnippet validates, trims, normalizes keywords', () => {
  const next = ux.addSnippet([], {
    name: '  My Shake  ',
    expression: '  wiggle(5, 50)  ',
    keywords: 'Shake, ТРЯСКА,, shake ;custom',
    target: 'Position',
    notes: 'strong shake'
  })
  assert.strictEqual(next.length, 1)
  const s = next[0]
  assert.match(s.id, /^ux_/)
  assert.strictEqual(s.name, 'My Shake')
  assert.strictEqual(s.expression, 'wiggle(5, 50)')
  assert.deepStrictEqual(s.keywords, ['shake', 'тряска', 'custom'])
  assert.strictEqual(s.target, 'Position')
  assert.strictEqual(s.notes, 'strong shake')
  // rejections
  assert.strictEqual(ux.addSnippet([], { name: '', expression: 'x' }), null)
  assert.strictEqual(ux.addSnippet([], { name: 'n', expression: '   ' }), null)
})

test('userExprLib: keywords accept array input, capped at 12', () => {
  const many = Array.from({ length: 20 }, (_, i) => 'kw' + i)
  const next = ux.addSnippet([], { name: 'n', expression: 'e', keywords: many })
  assert.strictEqual(next[0].keywords.length, 12)
  const arr = ux.addSnippet([], { name: 'n', expression: 'e', keywords: ['A', 'b', 'a'] })
  assert.deepStrictEqual(arr[0].keywords, ['a', 'b'])
})

test('userExprLib: serialize/load round-trip; invalid entries dropped', () => {
  const list = ux.addSnippet([], { name: 'n1', expression: 'e1', keywords: 'k1' })
  const loaded = ux.loadSnippets(ux.serialize(list))
  assert.deepStrictEqual(loaded, list)
  const raw = JSON.stringify({ snippets: [list[0], { id: 'x' }, 'junk', { id: 'y', name: 'n', expression: '' }] })
  assert.strictEqual(ux.loadSnippets(raw).length, 1)
})

test('userExprLib: removeSnippet returns new list or null on unknown id', () => {
  const list = ux.addSnippet([], { name: 'n', expression: 'e' })
  const id = list[0].id
  assert.deepStrictEqual(ux.removeSnippet(list, id), [])
  assert.strictEqual(ux.removeSnippet(list, 'nope'), null)
  assert.strictEqual(list.length, 1, 'input not mutated')
})

test('exprlib merge: user snippets searchable, marked source:"user"', () => {
  const userSnips = ux.addSnippet([], {
    name: 'Client-approved logo shake',
    expression: 'wiggle(9, 12)',
    keywords: 'logoshake, фирменная тряска',
    target: 'Position',
    notes: 'approved by client'
  })
  const r = exprLib.search('logoshake', 5, userSnips)
  assert.strictEqual(r.ok, true)
  const hit = r.snippets.find(s => s.id === userSnips[0].id)
  assert.ok(hit, 'user snippet found')
  assert.strictEqual(hit.source, 'user')
  assert.ok(Array.isArray(hit.requires) && hit.requires.length === 0, 'requires defaults to empty array')
  assert.match(r.message, /personal library/)
})

test('exprlib merge: curated results carry no source flag; no extras → unchanged', () => {
  const r = exprLib.search('bounce', 5, [])
  assert.strictEqual(r.snippets[0].id, 'inertial-bounce')
  assert.ok(!('source' in r.snippets[0]))
  const r2 = exprLib.search('bounce')
  assert.strictEqual(r2.snippets[0].id, 'inertial-bounce')
})

test('exprlib merge: extras never leak into the curated SNIPPETS array', () => {
  const before = exprLib.SNIPPETS.length
  exprLib.search('wiggle', 5, ux.addSnippet([], { name: 'w', expression: 'wiggle(1,1)', keywords: 'wiggle' }))
  assert.strictEqual(exprLib.SNIPPETS.length, before)
})
