'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const { toESLiteral } = require('../lib/pure/esLiteral.js')

test('primitives', () => {
  assert.strictEqual(toESLiteral(null), 'null')
  assert.strictEqual(toESLiteral(undefined), 'null')
  assert.strictEqual(toESLiteral(42), '42')
  assert.strictEqual(toESLiteral(-3.5), '-3.5')
  assert.strictEqual(toESLiteral(true), 'true')
  assert.strictEqual(toESLiteral(false), 'false')
})

test('strings are JSON-quoted (safe against injection)', () => {
  assert.strictEqual(toESLiteral('hi'), '"hi"')
  assert.strictEqual(toESLiteral('a"b'), '"a\\"b"')
  assert.strictEqual(toESLiteral('line\nbreak'), '"line\\nbreak"')
  // A string trying to break out of the ES literal stays a single string token.
  assert.strictEqual(toESLiteral('"); app.quit(); ("'), '"\\"); app.quit(); (\\""')
})

test('arrays', () => {
  assert.strictEqual(toESLiteral([1, 2, 3]), '[1,2,3]')
  assert.strictEqual(toESLiteral([]), '[]')
  assert.strictEqual(toESLiteral([[1], ['a']]), '[[1],["a"]]')
})

test('objects with quoted keys', () => {
  assert.strictEqual(toESLiteral({ a: 1 }), '{"a":1}')
  // Key with a quote is JSON.stringify'd → stays safe.
  assert.strictEqual(toESLiteral({ "a'b": 2 }), '{"a\'b":2}')
})

test('nested structures', () => {
  assert.strictEqual(
    toESLiteral({ name: 'x', dims: [1920, 1080], flags: { hd: true } }),
    '{"name":"x","dims":[1920,1080],"flags":{"hd":true}}'
  )
})

test('output is parseable JSON for plain data (round-trip sanity)', () => {
  const value = { name: 'Shape "1"', pos: [0, 0], nested: { a: [1, 2], s: 'x\ny' } }
  assert.deepStrictEqual(JSON.parse(toESLiteral(value)), value)
})
