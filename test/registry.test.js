/**
 * Tests for toolRegistry.js + agentSystemPrompt.js invariants after the
 * speed/quality upgrade (set_keyframes_batch, search_layers, always-full prompt).
 *
 * Both files are browser globals (window.*), so load them in a sandbox.
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

// ── toolRegistry.js ─────────────────────────────────────────────────────────

const registryWindow = loadBrowserGlobal('toolRegistry.js')
const tools = registryWindow.AGENT_TOOL_REGISTRY && registryWindow.AGENT_TOOL_REGISTRY.tools

test('registry: exposes 47 tools', () => {
  assert.ok(Array.isArray(tools), 'tools array exported')
  assert.strictEqual(tools.length, 47)
})

test('registry: every tool has a valid OpenAI function schema', () => {
  const names = new Set()
  for (const t of tools) {
    assert.strictEqual(t.type, 'function')
    assert.ok(t.function && typeof t.function.name === 'string' && t.function.name.length > 0)
    assert.ok(typeof t.function.description === 'string' && t.function.description.length > 0, t.function.name + ' has description')
    assert.ok(t.function.parameters && t.function.parameters.type === 'object', t.function.name + ' has object parameters')
    assert.ok(Array.isArray(t.function.parameters.required), t.function.name + ' has required[]')
    assert.ok(!names.has(t.function.name), 'duplicate tool name: ' + t.function.name)
    names.add(t.function.name)
  }
})

function findTool (name) {
  return tools.find(t => t.function.name === name)
}

test('registry: set_keyframes_batch schema', () => {
  const t = findTool('set_keyframes_batch')
  assert.ok(t, 'set_keyframes_batch registered')
  const p = t.function.parameters
  assert.strictEqual(JSON.stringify(p.required), JSON.stringify(['targets']))
  const item = p.properties.targets.items
  assert.strictEqual(JSON.stringify(item.required), JSON.stringify(['property_path', 'keyframes']))
  assert.ok(item.properties.layer_id, 'targets accept layer_id')
  assert.ok(item.properties.keyframes.items.properties.ease_in, 'keyframes support easing')
  assert.match(t.function.description, /one host call/i)
})

test('registry: search_layers schema', () => {
  const t = findTool('search_layers')
  assert.ok(t, 'search_layers registered')
  assert.strictEqual(JSON.stringify(t.function.parameters.required), JSON.stringify(['pattern']))
  assert.ok(t.function.parameters.properties.layer_type.enum.indexOf('shape') !== -1)
})

test('registry: add_keyframes points to the batch tool for multi-property work', () => {
  const t = findTool('add_keyframes')
  assert.match(t.function.description, /set_keyframes_batch/)
})

// ── agentSystemPrompt.js ────────────────────────────────────────────────────

const promptWindow = loadBrowserGlobal('agentSystemPrompt.js')
const builder = promptWindow.AGENT_SYSTEM_PROMPT_BUILDER

test('prompt: builder exists and returns the FULL prompt regardless of text', () => {
  assert.ok(builder && typeof builder.build === 'function')
  const a = builder.build('передвинь слой')           // no module keywords
  const b = builder.build('wiggle expression mask 3d') // many keywords
  const full = builder.buildFull()
  assert.strictEqual(a.prompt, full, 'keyword-less text gets full prompt')
  assert.strictEqual(b.prompt, full, 'keyword-rich text gets full prompt')
  // JSON compare — vm-context arrays have a different Array prototype.
  assert.strictEqual(JSON.stringify(a.modules), JSON.stringify(['shapes', '3d', 'masks', 'effects', 'expressions']))
})

test('prompt: contains all five expertise modules', () => {
  const full = builder.buildFull()
  for (const marker of ['## Shape Layer Content', '## 3D, Camera & Light', '## Masks', '## Common Effect matchNames', '## Expression Expertise']) {
    assert.ok(full.includes(marker), 'module present: ' + marker)
  }
})

test('prompt: new behavior rules present', () => {
  const full = builder.buildFull()
  assert.ok(full.includes('set_keyframes_batch'), 'mentions batch keyframe tool')
  assert.ok(full.includes('search_layers'), 'mentions search_layers')
  assert.match(full, /Batch aggressively/, 'batching rule')
  assert.match(full, /Verify before claiming done/, 'self-verification rule')
  assert.match(full, /brief numbered plan/, 'plan rule')
  assert.ok(!full.includes('No chain-of-thought in the visible response'), 'old no-CoT rule replaced')
  assert.match(full, /47 tools/, 'tool count updated')
})

test('prompt: legacy AGENT_SYSTEM_PROMPT global still exported', () => {
  assert.strictEqual(promptWindow.AGENT_SYSTEM_PROMPT, builder.buildFull())
})
