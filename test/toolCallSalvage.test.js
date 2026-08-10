/**
 * Tests for lib/pure/toolCallSalvage.js — recovering a tool call the model
 * wrote into `content` instead of `tool_calls`.
 *
 * The payloads below are verbatim from a real session where the operation was
 * silently lost and the user had to ask three times.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const salvage = require('../lib/pure/toolCallSalvage.js')

function loadRegistry () {
  const code = fs.readFileSync(path.join(__dirname, '..', 'toolRegistry.js'), 'utf8')
  const sandbox = { window: {}, console }
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox, { filename: 'toolRegistry.js' })
  return sandbox.window.AGENT_TOOL_REGISTRY.tools
}

const tools = loadRegistry()

test('salvage: real leaked set_layer_timing payload is matched by shape', () => {
  const leaked = '{"layer_id": 186, "in_point": 0.36, "out_point": 0.48, "start_time": 0}'
  const got = salvage.parseLeakedCall(leaked, tools)
  assert.ok(got, 'expected a match')
  assert.strictEqual(got.tool, 'set_layer_timing')
  assert.strictEqual(got.matchedBy, 'shape')
  assert.strictEqual(got.args.layer_id, 186)
})

test('salvage: real leaked apply_expression_batch payload is matched by shape', () => {
  const leaked = JSON.stringify({
    targets: [
      { layer_index: 1, property_path: 'Transform>Opacity', expression: '' },
      { layer_index: 2, property_path: 'Transform>Opacity', expression: '' }
    ]
  })
  const got = salvage.parseLeakedCall(leaked, tools)
  assert.ok(got)
  assert.strictEqual(got.tool, 'apply_expression_batch')
  assert.strictEqual(got.args.targets.length, 2)
})

test('salvage: named form {name, arguments} is used directly', () => {
  const leaked = '{"name":"apply_expression","arguments":{"layer_index":3,"property_path":"Transform>Position","expression":"wiggle(2,10)"}}'
  const got = salvage.parseLeakedCall(leaked, tools)
  assert.ok(got)
  assert.strictEqual(got.tool, 'apply_expression')
  assert.strictEqual(got.matchedBy, 'name')
  assert.strictEqual(got.args.expression, 'wiggle(2,10)')
})

test('salvage: named form with stringified arguments', () => {
  const leaked = '{"tool":"rename_layer","args":"{\\"layer_index\\":2,\\"name\\":\\"BG\\"}"}'
  const got = salvage.parseLeakedCall(leaked, tools)
  assert.ok(got)
  assert.strictEqual(got.tool, 'rename_layer')
  assert.strictEqual(got.args.name, 'BG')
})

test('salvage: a `name` argument is not mistaken for a tool name', () => {
  // The shape tools take a `name` argument of their own, so reading the named
  // form blindly would produce a call to a tool called "BG Box 0.9". Here the
  // payload is genuinely ambiguous (three shape tools fit), so the right answer
  // is to decline — but it must decline for that reason, not by inventing a
  // tool name.
  const leaked = '{"layer_index":3,"name":"BG Box 0.9"}'
  assert.strictEqual(salvage.parseLeakedCall(leaked, tools), null)

  // Same trap, unambiguous payload: `roundness` is rectangle-only.
  const rect = '{"layer_index":3,"name":"BG Box 0.9","width":200,"height":80,"roundness":0}'
  const got = salvage.parseLeakedCall(rect, tools)
  assert.ok(got)
  assert.strictEqual(got.tool, 'add_shape_rectangle')
  assert.strictEqual(got.matchedBy, 'shape')
})

test('salvage: fenced JSON is unwrapped', () => {
  const leaked = '```json\n{"layer_id": 186, "in_point": 0.36, "out_point": 0.48}\n```'
  const got = salvage.parseLeakedCall(leaked, tools)
  assert.ok(got)
  assert.strictEqual(got.tool, 'set_layer_timing')
})

test('salvage: prose is left alone', () => {
  assert.strictEqual(salvage.parseLeakedCall('Готово — я применил выражение.', tools), null)
  assert.strictEqual(salvage.parseLeakedCall('', tools), null)
  assert.strictEqual(salvage.parseLeakedCall(null, tools), null)
})

test('salvage: prose that merely contains JSON is left alone', () => {
  const text = 'Применил такие аргументы: {"layer_id": 186, "in_point": 0.36} — готово.'
  assert.strictEqual(salvage.parseLeakedCall(text, tools), null)
})

test('salvage: ambiguous payload is not guessed at', () => {
  // {} fits every no-arg tool; a lone layer_index fits dozens.
  assert.strictEqual(salvage.parseLeakedCall('{}', tools), null)
  assert.strictEqual(salvage.parseLeakedCall('{"layer_index": 3}', tools), null)
})

test('salvage: unknown keys disqualify a tool', () => {
  const leaked = '{"layer_id": 186, "in_point": 0.36, "out_point": 0.48, "not_a_real_arg": 1}'
  assert.strictEqual(salvage.parseLeakedCall(leaked, tools), null)
})

test('salvage: client_op_id does not affect matching', () => {
  const leaked = '{"layer_id": 186, "in_point": 0.36, "out_point": 0.48, "client_op_id": "abc"}'
  const got = salvage.parseLeakedCall(leaked, tools)
  assert.ok(got)
  assert.strictEqual(got.tool, 'set_layer_timing')
})

test('salvage: a leaked batch_call is recovered too', () => {
  const leaked = JSON.stringify({
    calls: [
      { tool: 'set_layer_timing', args: { layer_id: 186, in_point: 0, out_point: 1 } }
    ]
  })
  const got = salvage.parseLeakedCall(leaked, tools)
  assert.ok(got)
  assert.strictEqual(got.tool, 'batch_call')
})
