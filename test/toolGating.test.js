/**
 * Tests for lib/pure/toolGating.js — CORE-always + keyword-gated tool groups
 * with on-demand loading (the loop side is covered in agentLoop.test.js).
 */
const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const TG = require('../lib/pure/toolGating.js')

function loadRegistry () {
  const sandbox = { window: {}, console }
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'toolRegistry.js'), 'utf8'), sandbox, { filename: 'toolRegistry.js' })
  return sandbox.window.AGENT_TOOL_REGISTRY.tools
}

test('toolGating: every gated tool exists in the registry, no tool is in two groups', () => {
  const names = new Set(loadRegistry().map(t => t.function.name))
  const seen = new Map()
  for (const [g, def] of Object.entries(TG.GROUPS)) {
    for (const t of def.tools) {
      assert.ok(names.has(t), `gated tool ${t} (${g}) is not in the registry`)
      assert.ok(!seen.has(t), `tool ${t} listed in both ${seen.get(t)} and ${g}`)
      seen.set(t, g)
    }
  }
})

test('toolGating: CORE keeps the everyday tools and drops the rare ones', () => {
  const tools = loadRegistry()
  const core = TG.selectTools(tools, []).map(t => t.function.name)
  for (const must of ['batch_call', 'apply_motion_recipe', 'get_detailed_comp_summary', 'probe_motion', 'create_layer', 'add_keyframes', 'set_keyframes_batch', 'set_property_value', 'set_text_document', 'set_layer_switches', 'stagger_layers', 'duplicate_layer', 'rename_layer', 'delete_layer', 'set_layer_parent', 'set_layer_timing']) {
    assert.ok(core.includes(must), 'core must include ' + must)
  }
  for (const gated of ['apply_expression', 'add_effect', 'add_mask', 'set_camera_properties', 'add_marker', 'import_file', 'set_time_remap', 'create_subtitles', 'capture_comp_frame', 'add_shape_ellipse']) {
    assert.ok(!core.includes(gated), 'core must NOT include ' + gated)
  }
  const coreChars = JSON.stringify(TG.selectTools(tools, [])).length
  const allChars = JSON.stringify(tools).length
  assert.ok(coreChars < allChars * 0.6, `core schemas should be < 60% of all (${coreChars}/${allChars})`)
  // Registry order is preserved.
  const all = tools.map(t => t.function.name)
  assert.strictEqual(JSON.stringify(core), JSON.stringify(all.filter(n => core.includes(n))))
})

test('toolGating: keywords (RU/EN) select the right groups; unrelated text selects none', () => {
  assert.deepStrictEqual(TG.groupsForText('подвинь слой правее на 200 пикселей'), [])
  assert.deepStrictEqual(TG.groupsForText('Уменьши Card 3 в полтора раза.'), [])
  assert.ok(TG.groupsForText('добавь wiggle на позицию').includes('expressions'))
  assert.ok(TG.groupsForText('Луна крутится слишком медленно, ускорь её').includes('expressions'))
  assert.ok(TG.groupsForText('добавь Gaussian Blur и слайдер').includes('effects'))
  assert.ok(TG.groupsForText('нарисуй красный прямоугольник').includes('shapes'))
  assert.ok(TG.groupsForText('вырежи маской круг').includes('masks'))
  assert.ok(TG.groupsForText('сделай камеру и параллакс').includes('threed'))
  assert.ok(TG.groupsForText('поставь маркеры каждые 3 секунды').includes('markers'))
  assert.ok(TG.groupsForText('упакуй в прекомпоз и замедли через time remap').includes('project'))
  assert.ok(TG.groupsForText('упакуй в прекомпоз и замедли через time remap').includes('compositing'))
  assert.ok(TG.groupsForText('сделай субтитры по аудио').includes('subtitles'))
  assert.ok(TG.groupsForText('capture a screenshot of the comp').includes('capture'))
  assert.ok(TG.groupsForText('Сделай, чтобы текст печатался по буквам за 2 секунды.').includes('expressions'), 'typewriter → expressions')
})

test('toolGating: initialGroups reads every user message, selectTools adds the active groups', () => {
  const tools = loadRegistry()
  const msgs = [
    { role: 'user', content: 'сделай кружок в центре' },
    { role: 'assistant', content: 'готово' },
    { role: 'user', content: 'а теперь пусть он мигает через выражение' }
  ]
  const groups = TG.initialGroups(msgs)
  assert.ok(groups.includes('shapes') && groups.includes('expressions'), JSON.stringify(groups))
  const names = TG.selectTools(tools, groups).map(t => t.function.name)
  assert.ok(names.includes('add_shape_ellipse') && names.includes('apply_expression'))
  assert.ok(!names.includes('add_mask') && !names.includes('set_camera_properties'))
  assert.strictEqual(TG.groupOfTool('add_mask'), 'masks')
  assert.strictEqual(TG.groupOfTool('create_layer'), null)
  assert.strictEqual(TG.groupOfTool('no_such_tool'), null)
})
