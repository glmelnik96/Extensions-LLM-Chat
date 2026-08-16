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

test('registry: exposes 67 tools', () => {
  assert.ok(Array.isArray(tools), 'tools array exported')
  assert.strictEqual(tools.length, 67)
})

test('registry: batch_call takes {tool, args} items', () => {
  const bc = tools.find(t => t.function.name === 'batch_call')
  assert.ok(bc, 'batch_call registered')
  const items = bc.function.parameters.properties.calls.items
  assert.strictEqual(JSON.stringify(items.required), JSON.stringify(['tool', 'args']))
  assert.strictEqual(JSON.stringify(bc.function.parameters.required), JSON.stringify(['calls']))
})

test('registry: expression tools document removal via empty string', () => {
  // The host silently rejected "" until 2026-08-10, so "убери экспрешен" had no
  // implementation — the model has to be told this is the way.
  const one = tools.find(t => t.function.name === 'apply_expression')
  const batch = tools.find(t => t.function.name === 'apply_expression_batch')
  assert.match(one.function.description, /expression:""/, 'apply_expression documents removal')
  assert.match(one.function.description, /set_property_value/, 'warns off the wrong tool')
  assert.match(batch.function.description, /expression:""/, 'batch documents removal')
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

test('registry: advanced keyframe/layer tools registered with correct required[]', () => {
  const ce = findTool('copy_ease')
  assert.ok(ce, 'copy_ease registered')
  assert.strictEqual(JSON.stringify(ce.function.parameters.required), JSON.stringify(['source_property_path']))
  assert.ok(ce.function.parameters.properties.mode.enum.indexOf('both') !== -1)

  const rk = findTool('reverse_keyframes')
  assert.ok(rk, 'reverse_keyframes registered')
  assert.strictEqual(JSON.stringify(rk.function.parameters.required), JSON.stringify(['property_path']))

  const sl = findTool('stagger_layers')
  assert.ok(sl, 'stagger_layers registered')
  assert.strictEqual(JSON.stringify(sl.function.parameters.required), JSON.stringify(['layer_indices', 'offset']))
  assert.ok(sl.function.parameters.properties.mode.enum.indexOf('inPoint') !== -1)

  const rp = findTool('randomize_property')
  assert.ok(rp, 'randomize_property registered')
  assert.strictEqual(JSON.stringify(rp.function.parameters.required), JSON.stringify(['layer_indices', 'property_path']))

  const ma = findTool('move_anchor_point')
  assert.ok(ma, 'move_anchor_point registered')
  assert.strictEqual(JSON.stringify(ma.function.parameters.required), JSON.stringify(['position']))
  assert.ok(ma.function.parameters.properties.position.enum.indexOf('center') !== -1)
  assert.strictEqual(ma.function.parameters.properties.position.enum.length, 9)
})

// Every registered tool must have an executeToolCall case in hostBridge.js OR
// be handled panel-locally (search_expression_library). Guards against the
// "added to registry, forgot the bridge" failure mode.
test('registry: every tool is wired in hostBridge.js', () => {
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'hostBridge.js'), 'utf8')
  const PANEL_LOCAL = new Set(['search_expression_library'])
  for (const t of tools) {
    const name = t.function.name
    if (PANEL_LOCAL.has(name)) continue
    assert.ok(bridgeSrc.includes("case '" + name + "':"), 'hostBridge has case for ' + name)
  }
})

// Every host function referenced by the bridge must exist in host/index.jsx.
test('bridge: every extensionsLlmChat_* call target exists in host/index.jsx', () => {
  const bridgeSrc = fs.readFileSync(path.join(__dirname, '..', 'hostBridge.js'), 'utf8')
  const hostSrc = fs.readFileSync(path.join(__dirname, '..', 'host', 'index.jsx'), 'utf8')
  const called = new Set()
  const re = /extensionsLlmChat_[A-Za-z0-9_]+/g
  let m
  while ((m = re.exec(bridgeSrc)) !== null) called.add(m[0])
  assert.ok(called.size > 40, 'sanity: bridge references many host functions (' + called.size + ')')
  for (const fn of called) {
    assert.ok(hostSrc.includes('function ' + fn + ' (') || hostSrc.includes('function ' + fn + '('), 'host defines ' + fn)
  }
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
  assert.match(full, /67 tools/, 'tool count updated')
})

test('registry: compositing tools (2026-07-27) registered with correct schemas', () => {
  const tm = findTool('set_track_matte')
  assert.ok(tm, 'set_track_matte registered')
  assert.strictEqual(JSON.stringify(tm.function.parameters.required), JSON.stringify(['layer_index', 'matte_type']))
  const mtEnum = tm.function.parameters.properties.matte_type.enum
  for (const v of ['alpha', 'alpha_inverted', 'luma', 'luma_inverted', 'none']) {
    assert.ok(mtEnum.indexOf(v) !== -1, 'matte_type enum has ' + v)
  }
  assert.ok(tm.function.parameters.properties.matte_layer_index, 'matte layer selectable')

  const sw = findTool('set_layer_switches')
  assert.ok(sw, 'set_layer_switches registered')
  assert.strictEqual(JSON.stringify(sw.function.parameters.required), JSON.stringify(['layer_index']))
  for (const key of ['enabled', 'motion_blur', 'adjustment', 'shy', 'solo', 'locked', 'guide', 'collapse_transformation', 'effects_active', 'audio_enabled']) {
    assert.ok(sw.function.parameters.properties[key], 'switch present: ' + key)
    assert.strictEqual(sw.function.parameters.properties[key].type, 'boolean', key + ' is boolean')
  }

  const tr = findTool('set_time_remap')
  assert.ok(tr, 'set_time_remap registered')
  assert.strictEqual(JSON.stringify(tr.function.parameters.required), JSON.stringify(['layer_index', 'enabled']))

  const sp = findTool('split_layer')
  assert.ok(sp, 'split_layer registered')
  assert.strictEqual(JSON.stringify(sp.function.parameters.required), JSON.stringify(['layer_index', 'time']))

  const oc = findTool('open_comp')
  assert.ok(oc, 'open_comp registered')
  assert.strictEqual(JSON.stringify(oc.function.parameters.required), JSON.stringify([]))
  assert.ok(oc.function.parameters.properties.comp_id, 'open_comp accepts comp_id')
  assert.ok(oc.function.parameters.properties.comp_name, 'open_comp accepts comp_name')

  const cs = findTool('set_comp_settings')
  assert.ok(cs.function.parameters.properties.motion_blur, 'set_comp_settings has motion_blur')
  assert.ok(cs.function.parameters.properties.bg_color, 'set_comp_settings has bg_color')
})

test('prompt: compositing guidance present', () => {
  const full = builder.buildFull()
  assert.ok(full.includes('## Track Mattes, Switches, Time Remap, Split, Comp Switching'), 'compositing section present')
  for (const name of ['set_track_matte', 'set_layer_switches', 'set_time_remap', 'split_layer', 'open_comp']) {
    assert.ok(full.includes(name), 'mentions ' + name)
  }
  assert.match(full, /comp switch is on|set_comp_settings\(motion_blur: true\)/, 'warns about comp-level motion blur switch')
})

test('registry: stage-3 tools registered with correct schemas', () => {
  const lib = findTool('search_expression_library')
  assert.ok(lib, 'search_expression_library registered')
  assert.strictEqual(JSON.stringify(lib.function.parameters.required), JSON.stringify(['query']))

  const link = findTool('link_properties')
  assert.ok(link, 'link_properties registered')
  assert.strictEqual(JSON.stringify(link.function.parameters.required), JSON.stringify(['target_property_path', 'source_property_path']))
  assert.ok(link.function.parameters.properties.scale, 'link has scale')
  assert.ok(link.function.parameters.properties.offset, 'link has offset')

  const fx = findTool('list_available_effects')
  assert.ok(fx, 'list_available_effects registered')
  assert.strictEqual(JSON.stringify(fx.function.parameters.required), JSON.stringify(['filter']))
})

test('prompt: stage-3 reframe — editing assistant, new tools mentioned', () => {
  const full = builder.buildFull()
  assert.match(full, /EDITING assistant/, 'editing-assistant framing')
  assert.ok(!full.includes('create animations from scratch'), '"from scratch" mission line removed')
  assert.ok(full.includes('search_expression_library'), 'mentions expression library tool')
  assert.ok(full.includes('link_properties'), 'mentions link_properties')
  assert.ok(full.includes('list_available_effects'), 'mentions list_available_effects')
})

test('prompt: legacy AGENT_SYSTEM_PROMPT global still exported', () => {
  assert.strictEqual(promptWindow.AGENT_SYSTEM_PROMPT, builder.buildFull())
})

test('registry: subtitle tools (2026-07-28) registered with correct schemas', () => {
  const tr = findTool('transcribe_comp_audio')
  assert.ok(tr, 'transcribe_comp_audio registered')
  assert.strictEqual(JSON.stringify(tr.function.parameters.required), JSON.stringify(['language']))
  assert.ok(tr.function.parameters.properties.start_time, 'chunking via start_time')
  assert.ok(tr.function.parameters.properties.end_time, 'chunking via end_time')
  assert.match(tr.function.description, /cached/i, 'mentions panel-side segment cache')

  const cs = findTool('create_subtitles')
  assert.ok(cs, 'create_subtitles registered')
  assert.strictEqual(JSON.stringify(cs.function.parameters.required), JSON.stringify([]), 'segments optional (cache)')
  const seg = cs.function.parameters.properties.segments
  assert.strictEqual(JSON.stringify(seg.items.required), JSON.stringify(['startSec', 'endSec', 'text']))
  for (const key of ['layer_name', 'font', 'font_size', 'fill_color', 'position', 'box', 'box_color', 'box_opacity', 'animation', 'max_chars_per_line', 'max_lines', 'max_cue_duration']) {
    assert.ok(cs.function.parameters.properties[key], 'create_subtitles option: ' + key)
  }
})

test('prompt: subtitles guidance present', () => {
  const full = builder.buildFull()
  assert.ok(full.includes('## Subtitles'), 'subtitles section present')
  assert.ok(full.includes('transcribe_comp_audio'), 'mentions transcribe tool')
  assert.ok(full.includes('create_subtitles'), 'mentions create tool')
  assert.match(full, /ISO 639-1/, 'language requirement explained')
})

test('prompt: round-3 hardening bullets present (2026-08-16)', () => {
  const full = builder.buildFull()
  assert.match(full, /Map sequences by the NAMES the user lists/, 'name-order mapping rule')
  assert.match(full, /REVERSE of naming\/creation order/, 'stacking-order inversion warning')
  assert.match(full, /Locked layers.*refuse layers with `locked: true`/, 'locked-layer refusal rule')
  assert.match(full, /Keep every batch ≤ 8 inner calls/, 'batch size cap')
  assert.match(full, /do NOT retry the same giant batch/, 'no giant-batch retry')
  assert.match(full, /Position is in PARENT space/, 'parent-space position rule')
  assert.match(full, /value \+ wiggle\(freq, amp\)/, 'value-base example')
  assert.match(full, /host REJECTS parent-position-clone expressions/, 'host rejection mentioned')
  assert.match(full, /Scale your design to THIS comp/, 'comp-dimension scaling rule')
  assert.match(full, /Center = \[width\/2, height\/2\]/, 'dynamic center rule')
  assert.match(full, /If the requested state ALREADY exists, change nothing/, 'already-satisfied rule')
  assert.match(full, /DOUBLES the stagger/, 'stagger-doubling example')
})
