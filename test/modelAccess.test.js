/**
 * Tests for lib/pure/modelAccess.js (2026-10-18) — the Cloud.ru project behind
 * the key cannot call several catalog models (HTTP 403 "Requested model is not
 * available for this project"); config.unavailableModels hides them from the
 * selector and switches off the features that need them.
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const A = require('../lib/pure/modelAccess.js')
const ROOT = path.join(__dirname, '..')

const MODELS = [
  { id: 'openai/gpt-oss-120b', label: 'gpt-oss-120b' },
  { id: 'MiniMaxAI/MiniMax-M2.5', label: 'MiniMax-M2.5' },
  { id: 'zai-org/GLM-4.7', label: 'GLM-4.7' },
  { id: 'moonshotai/Kimi-K2.6', label: 'Kimi-K2.6' }
]

function loadExampleConfig () {
  const sandbox = { window: {} }
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'config/example.config.js'), 'utf8'), sandbox)
  return sandbox.window.EXTENSIONS_LLM_CHAT_CONFIG
}

test('filterModels drops unavailable ids and keeps the selector order', () => {
  const cfg = { unavailableModels: ['openai/gpt-oss-120b', 'moonshotai/Kimi-K2.6'] }
  assert.deepStrictEqual(A.filterModels(MODELS, cfg).map(m => m.id), ['MiniMaxAI/MiniMax-M2.5', 'zai-org/GLM-4.7'])
})

test('filterModels never empties the selector — a config listing every model returns the full list', () => {
  const cfg = { unavailableModels: MODELS.map(m => m.id) }
  assert.strictEqual(A.filterModels(MODELS, cfg).length, MODELS.length)
})

test('missing or malformed unavailableModels means everything is callable', () => {
  assert.strictEqual(A.isUnavailable('openai/gpt-oss-120b', {}), false)
  assert.strictEqual(A.isUnavailable('openai/gpt-oss-120b', null), false)
  assert.strictEqual(A.isUnavailable('openai/gpt-oss-120b', { unavailableModels: 'openai/gpt-oss-120b' }), false)
  assert.strictEqual(A.isUnavailable('', { unavailableModels: [''] }), false)
  assert.strictEqual(A.filterModels(MODELS, {}).length, MODELS.length)
})

test('transcription follows the Whisper model id, including a transcribeModel override', () => {
  assert.strictEqual(A.transcribeModelId({}), 'openai/whisper-large-v3')
  assert.strictEqual(A.isTranscriptionAvailable({ unavailableModels: ['openai/whisper-large-v3'] }), false)
  assert.strictEqual(A.isTranscriptionAvailable({ transcribeModel: 'other/asr', unavailableModels: ['openai/whisper-large-v3'] }), true)
  assert.strictEqual(A.isTranscriptionAvailable({ transcribeModel: 'other/asr', unavailableModels: ['other/asr'] }), false)
})

test('example config: the default model is callable and matches the panel default', () => {
  const cfg = loadExampleConfig()
  assert.ok(Array.isArray(cfg.unavailableModels), 'unavailableModels is an array')
  assert.ok(cfg.unavailableModels.every(id => typeof id === 'string' && id.length > 0))
  assert.strictEqual(A.isUnavailable(cfg.defaultModel, cfg), false, 'config.defaultModel must not be listed as unavailable')
  // The panel defaults to the first ALL_MODELS entry that survives the
  // filter; config.defaultModel feeds the other code paths. Keep them equal.
  const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8')
  const block = src.slice(src.indexOf('var ALL_MODELS = ['), src.indexOf(']', src.indexOf('var ALL_MODELS = [')))
  const ids = Array.from(block.matchAll(/id: '([^']+)'/g)).map(m => m[1])
  assert.ok(ids.length >= 2, 'ALL_MODELS parsed from main.js')
  const panelModels = A.filterModels(ids.map(id => ({ id })), cfg)
  assert.ok(panelModels.length < ids.length, 'at least one selector model is hidden by the example config')
  assert.strictEqual(panelModels[0].id, cfg.defaultModel)
})

// hostBridge in a sandbox with config + modelAccess, recording every script
// sent to the host so a test can prove the audio render never started.
function loadBridgeWithAccess (cfg) {
  const scripts = []
  const sandbox = { window: { EXTENSIONS_LLM_CHAT_CONFIG: cfg, EXTENSIONS_LLM_CHAT_SECRETS: {} }, console, require, setTimeout, clearTimeout }
  sandbox.CSInterface = function () {}
  sandbox.CSInterface.prototype.getSystemPath = function () { return '/fake/ext' }
  sandbox.CSInterface.prototype.evalScript = function (script, cb) {
    scripts.push(script)
    if (script.indexOf('evalFile') !== -1) { cb('ok'); return }
    cb('{"ok":false,"message":"no active comp"}')
  }
  sandbox.SystemPath = { EXTENSION: 'extension' }
  vm.createContext(sandbox)
  for (const f of ['lib/pure/esLiteral.js', 'lib/pure/modelAccess.js', 'hostBridge.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f })
  }
  return { win: sandbox.window, scripts }
}

test('transcribe_comp_audio fails fast with MODEL_UNAVAILABLE when Whisper is listed — no audio render', async () => {
  const { win, scripts } = loadBridgeWithAccess({ unavailableModels: ['openai/whisper-large-v3'] })
  const res = await win.HOST_BRIDGE.executeToolCall('transcribe_comp_audio', { language: 'ru' })
  assert.strictEqual(res.ok, false)
  assert.strictEqual(res.error_code, 'MODEL_UNAVAILABLE')
  assert.match(res.message, /whisper-large-v3/)
  assert.match(res.message, /Load transcript/)
  assert.ok(!scripts.some(s => s.indexOf('renderCompAudio') !== -1), 'the comp audio must not be rendered')
})

test('transcribe_comp_audio still goes to the host when Whisper is callable', async () => {
  const { win, scripts } = loadBridgeWithAccess({ unavailableModels: ['openai/gpt-oss-120b'] })
  const res = await win.HOST_BRIDGE.executeToolCall('transcribe_comp_audio', { language: 'ru' })
  assert.strictEqual(res.ok, false)
  assert.notStrictEqual(res.error_code, 'MODEL_UNAVAILABLE')
  assert.ok(scripts.some(s => s.indexOf('renderCompAudio') !== -1), 'the render path is attempted')
})

test('index.html loads modelAccess.js before hostBridge.js and main.js', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  const at = name => html.indexOf('src="./' + name + '"')
  assert.ok(at('lib/pure/modelAccess.js') !== -1, 'modelAccess.js script tag present')
  assert.ok(at('lib/pure/modelAccess.js') < at('hostBridge.js'))
  assert.ok(at('lib/pure/modelAccess.js') < at('main.js'))
})
