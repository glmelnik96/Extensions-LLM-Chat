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
