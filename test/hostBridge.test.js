'use strict'
// Tests for hostBridge.js result normalization — specifically that a non-JSON
// result from the ExtendScript side is surfaced to the agent as an explicit
// failure for TOOL calls (never a silent ok:true), while raw evalHostFunction
// callers (e.g. the Undo script that returns a bare number) still get the string.
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

// Load esLiteral.js (provides window.PURE_ES.toESLiteral) then hostBridge.js
// into a sandbox with a scriptable CSInterface stub.
function loadHostBridge (nextEvalResult) {
  const sandbox = { window: {}, console, require, setTimeout, clearTimeout }
  // Stub CSInterface: the first evalScript (containing evalFile) resolves the
  // host-script load with "ok"; every subsequent call returns the scripted
  // per-test response string.
  sandbox.CSInterface = function () {}
  sandbox.CSInterface.prototype.getSystemPath = function () { return '/fake/ext' }
  sandbox.CSInterface.prototype.evalScript = function (script, cb) {
    if (script.indexOf('evalFile') !== -1) { cb('ok'); return }
    cb(typeof nextEvalResult === 'function' ? nextEvalResult(script) : nextEvalResult)
  }
  sandbox.SystemPath = { EXTENSION: 'extension' }
  vm.createContext(sandbox)
  const es = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pure', 'esLiteral.js'), 'utf8')
  vm.runInContext(es, sandbox, { filename: 'esLiteral.js' })
  const hb = fs.readFileSync(path.join(__dirname, '..', 'hostBridge.js'), 'utf8')
  vm.runInContext(hb, sandbox, { filename: 'hostBridge.js' })
  return sandbox.window
}

test('hostBridge: non-JSON host result for a tool call becomes ok:false (not silent success)', async () => {
  const win = loadHostBridge('ReferenceError: foo is not defined')
  const res = await win.HOST_BRIDGE.executeToolCall('get_host_context', {})
  assert.strictEqual(res.ok, false, 'a non-JSON host error must not be reported as success')
  assert.match(res.message, /non-JSON result/i)
  assert.match(res.message, /ReferenceError/)
})

test('hostBridge: valid JSON host result passes through unchanged', async () => {
  const win = loadHostBridge('{"ok":true,"context":"comp A"}')
  const res = await win.HOST_BRIDGE.executeToolCall('get_host_context', {})
  assert.strictEqual(res.ok, true)
  assert.strictEqual(res.context, 'comp A')
})

test('hostBridge: raw evalHostFunction still resolves a bare non-JSON string (Undo compatibility)', async () => {
  const win = loadHostBridge('reverted')
  const res = await win.HOST_BRIDGE.evalHostFunction('(function(){ return "reverted"; })()')
  // Raw callers keep the back-compat behavior: resolved, tagged _nonJson.
  assert.strictEqual(res.ok, true)
  assert.strictEqual(res.raw, 'reverted')
  assert.strictEqual(res._nonJson, true)
})

test('hostBridge: a real EvalScript error prefix rejects', async () => {
  const win = loadHostBridge('EvalScript error: line 5')
  await assert.rejects(
    win.HOST_BRIDGE.executeToolCall('get_host_context', {}),
    /EvalScript error/
  )
})

// Capture the ExtendScript call string the bridge builds for a tool call, so we
// can assert the new advanced tools map to the right host function + args.
function captureCall (toolName, args) {
  let captured = null
  const win = loadHostBridge((script) => {
    captured = script
    return '{"ok":true}'
  })
  return win.HOST_BRIDGE.executeToolCall(toolName, args).then(() => captured)
}

test('hostBridge: copy_ease maps to extensionsLlmChat_copyEase', async () => {
  const call = await captureCall('copy_ease', {
    source_layer_index: 2, source_property_path: 'Transform>Position', key_indices: [1, 3], mode: 'out'
  })
  assert.match(call, /extensionsLlmChat_copyEase\(/)
  assert.match(call, /"Transform>Position"/)
  assert.match(call, /\[1,3\]/)
  assert.match(call, /"out"/)
})

test('hostBridge: reverse_keyframes maps to extensionsLlmChat_reverseKeyframes', async () => {
  const call = await captureCall('reverse_keyframes', { layer_index: 1, property_path: 'Transform>Scale' })
  assert.match(call, /extensionsLlmChat_reverseKeyframes\(1,null,"Transform>Scale"\)/)
})

test('hostBridge: shift_keyframes maps offset and align_to', async () => {
  const call = await captureCall('shift_keyframes', { layer_index: 2, property_path: 'Effects>Fill>Color', time_offset: -0.5 })
  assert.match(call, /extensionsLlmChat_shiftKeyframes\(2,null,"Effects>Fill>Color",-0\.5,null\)/)
  const call2 = await captureCall('shift_keyframes', { layer_id: 42, property_path: 'Transform>Position', align_to: 'layer_in_point' })
  assert.match(call2, /extensionsLlmChat_shiftKeyframes\(null,42,"Transform>Position",null,"layer_in_point"\)/)
})

test('hostBridge: shift_keyframes rejects missing offset and align_to', async () => {
  const win = loadHostBridge(() => '{"ok":true}')
  const res = await win.HOST_BRIDGE.executeToolCall('shift_keyframes', { property_path: 'Transform>Scale' })
  assert.strictEqual(res.ok, false)
  assert.match(res.message, /time_offset.*layer_in_point/)
})

test('hostBridge: capture_comp_frame maps at_time auto/current to third arg', async () => {
  const call = await captureCall('capture_comp_frame', {})
  assert.match(call, /extensionsLlmChat_saveCompFramePng\("frame-\d+\.png", true, false\)/)
  const call2 = await captureCall('capture_comp_frame', { at_time: 'auto' })
  assert.match(call2, /extensionsLlmChat_saveCompFramePng\("frame-\d+\.png", true, true\)/)
})

test('hostBridge: stagger_layers passes indices, offset and mode', async () => {
  const call = await captureCall('stagger_layers', { layer_indices: [3, 1, 2], offset: 5, unit: 'frames', mode: 'keyframes' })
  assert.match(call, /extensionsLlmChat_staggerLayers\(\[3,1,2\],null,5,"frames",null,"keyframes"\)/)
})

test('hostBridge: randomize_property bundles opts object', async () => {
  const call = await captureCall('randomize_property', {
    layer_indices: [1, 2], property_path: 'Transform>Rotation', min: -15, max: 15, mode: 'offset'
  })
  assert.match(call, /extensionsLlmChat_randomizeProperty\(\[1,2\],null,"Transform>Rotation",/)
  assert.match(call, /"min":-15/)
  assert.match(call, /"max":15/)
  assert.match(call, /"mode":"offset"/)
})

test('hostBridge: move_anchor_point maps position', async () => {
  const call = await captureCall('move_anchor_point', { layer_index: 4, position: 'center' })
  assert.match(call, /extensionsLlmChat_moveAnchorPoint\(4,null,"center"\)/)
})

test('hostBridge: new tools reject when required args missing (pre-validation)', async () => {
  const win = loadHostBridge('{"ok":true}')
  const a = await win.HOST_BRIDGE.executeToolCall('stagger_layers', { offset: 1 })
  assert.strictEqual(a.ok, false)
  assert.match(a.message, /layer_indices/)
  const b = await win.HOST_BRIDGE.executeToolCall('move_anchor_point', {})
  assert.strictEqual(b.ok, false)
  assert.match(b.message, /position/)
})

// ── Stringified-array arg salvage (round-5 live evidence: GLM-4.7 sent
// `targets` as a JSON string and set_keyframes_batch hard-failed) ────────────

test('hostBridge: set_keyframes_batch salvages stringified `targets`', async () => {
  const targets = [{ layer_index: 1, property_path: 'Transform>Scale', keyframes: [{ time: 0, value: [70, 70] }] }]
  const call = await captureCall('set_keyframes_batch', { targets: JSON.stringify(targets) })
  assert.match(call, /extensionsLlmChat_setKeyframesBatch\(\[/)
  assert.match(call, /"Transform>Scale"/)
})

test('hostBridge: stringified `keyframes` nested inside a real targets array is salvaged', async () => {
  const targets = [{ layer_index: 2, property_path: 'Transform>Opacity', keyframes: JSON.stringify([{ time: 0, value: 0 }, { time: 1, value: 100 }]) }]
  const call = await captureCall('set_keyframes_batch', { targets })
  assert.match(call, /extensionsLlmChat_setKeyframesBatch\(\[/)
  assert.match(call, /"Transform>Opacity"/)
})

test('hostBridge: malformed targets string still rejects with the validation message', async () => {
  const win = loadHostBridge('{"ok":true}')
  const res = await win.HOST_BRIDGE.executeToolCall('set_keyframes_batch', { targets: '[{broken json' })
  assert.strictEqual(res.ok, false)
  assert.match(res.message, /targets/)
})

test('hostBridge: ordinary string args are never JSON-parsed', async () => {
  // `expression` may legally look like JSON (e.g. "[0, 100]") — must stay a string.
  const call = await captureCall('apply_expression', {
    layer_index: 1, property_path: 'Transform>Scale', expression: '[0, 100]'
  })
  assert.match(call, /"\[0, 100\]"|'\[0, 100\]'|\[0, 100\]/)
})

// ── Stringified `value` salvage (round-6 live evidence: GLM-4.7 sent
// `value: "[960, 540]"` to set_property_value and retried until the
// anti-spam guard fired) ─────────────────────────────────────────────────────

test('hostBridge: set_property_value salvages stringified numeric-array value', async () => {
  const call = await captureCall('set_property_value', {
    layer_index: 1, property_path: 'Transform>Position', value: '[960, 540]'
  })
  assert.match(call, /extensionsLlmChat_setPropertyValue\(/)
  assert.match(call, /\[960,540\]/)
})

test('hostBridge: Source Text keeps an array-looking string value verbatim', async () => {
  const call = await captureCall('set_property_value', {
    layer_index: 1, property_path: 'Text>Source Text', value: '[960, 540]'
  })
  assert.doesNotMatch(call, /\[960,540\]/)
  assert.match(call, /\[960, 540\]/)
})

test('hostBridge: non-numeric array-looking value string is left alone', async () => {
  const call = await captureCall('set_property_value', {
    layer_index: 1, property_path: 'Transform>Position', value: '["a", "b"]'
  })
  assert.doesNotMatch(call, /\["a","b"\]/)
})

test('hostBridge: batch_call inner args get stringified-value salvage too', async () => {
  const call = await captureCall('batch_call', {
    calls: [{ tool: 'set_property_value', args: { layer_index: 1, property_path: 'Transform>Position', value: '[90, 0]' } }]
  })
  assert.match(call, /\[90,0\]/)
})
