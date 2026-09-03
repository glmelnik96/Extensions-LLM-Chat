/**
 * Tests for lib/pure/changeJournal.js — the agent's own change journal
 * (2026-09-03): compact entries from the tool log + scene diff, formatted as
 * the [SYSTEM] JOURNAL message that rides before every later request.
 */
const test = require('node:test')
const assert = require('node:assert')

const J = require('../lib/pure/changeJournal.js')

function ok (name, args, result) { return { name, args, status: 'ok', result: result || { ok: true } } }

const ORBIT_LOG = [
  ok('get_detailed_comp_summary', { compact: false }),
  ok('apply_motion_recipe', { recipe: 'orbit', layer_ids: [14], opts: { period: 2, around_layer_id: 12 } }, {
    ok: true, recipe: 'orbit', applied: [{ layer: 'Circle C', layerId: 14, start: 0, end: 10, radius: 400, period: 2, orbitNull: 'Circle C Orbit', around: 'Circle B' }], skipped: []
  }),
  ok('probe_motion', { layer_id: 14, property_path: 'Transform>Position', samples: 5 })
]
const ORBIT_DIFF = {
  ok: true, compSwitched: false, compName: 'Eval-Comp', count: 2,
  added: [{ id: 15, name: 'Circle C Orbit', type: 'null', hidden: false }],
  removed: [], moved: [],
  changed: [{ id: 14, name: 'Circle C', changes: ['parent → "Circle C Orbit"'], hidden: false }]
}
const ORBIT_DIFF_TEXT = 'Actual changes in "Eval-Comp": 1 added, 0 removed, 1 changed.\n+ "Circle C Orbit" (null)\n~ "Circle C": parent → "Circle C Orbit"'

test('journal: a recipe run becomes one entry naming the layer, the new null, the period and the radius', () => {
  const e = J.buildEntry({ request: 'Пусть Circle C крутится вокруг Circle B по кругу, один оборот за 2 секунды, на текущем расстоянии.', toolCallLog: ORBIT_LOG, diff: ORBIT_DIFF, diffText: ORBIT_DIFF_TEXT, at: 1 })
  assert.ok(e, 'entry built')
  assert.strictEqual(e.comp, 'Eval-Comp')
  assert.strictEqual(e.calls.length, 1, 'read-only calls (summary, probe) are not journaled')
  assert.match(e.calls[0], /apply_motion_recipe orbit → "Circle C" \(id 14\) parented to new null "Circle C Orbit" around "Circle B"/)
  assert.match(e.calls[0], /period 2/)
  assert.match(e.calls[0], /radius 400/)
  assert.deepStrictEqual(e.added, [{ id: 15, name: 'Circle C Orbit', type: 'null' }])
  assert.match(e.diff, /^1 added, 0 removed, 1 changed/)
  assert.ok(!/Actual changes in/.test(e.diff), 'diff header stripped')
})

test('journal: failed calls, read-only runs and no-op runs produce no entry', () => {
  assert.strictEqual(J.buildEntry({ request: 'x', toolCallLog: [ok('get_detailed_comp_summary', {})], diffText: 'No changes detected in composition "Eval-Comp" — its state before and after the run is identical.' }), null)
  const failed = [{ name: 'set_property_value', args: { layer_id: 1, property_path: 'Transform>Opacity', value: 50 }, status: 'error', result: { ok: false, message: 'locked' } }]
  assert.strictEqual(J.buildEntry({ request: 'x', toolCallLog: failed, diff: { ok: true, compSwitched: false, count: 0, added: [], removed: [], changed: [], moved: [] } }), null)
})

test('journal: keyframes, expressions, parenting and batch_call are summarized compactly', () => {
  const log = [
    ok('set_keyframes_batch', { targets: [{ layer_id: 3, property_path: 'Transform>Opacity', keyframes: [{ time: 0, value: 0 }, { time: 1, value: 100 }] }, { layer_id: 4, property_path: 'Transform>Opacity', keyframes: [{ time: 1, value: 0 }, { time: 2, value: 100 }] }] }),
    ok('apply_expression', { layer_id: 7, property_path: 'Transform>Rotation', expression: 'var ang0 = 0; ang0 + (time - inPoint) * 360 / 2;' }),
    ok('set_layer_parent', { layer_id: 14, parent_layer_id: 15 }),
    ok('batch_call', { calls: [{ tool: 'create_layer', args: { type: 'null', name: 'Pivot' } }, { tool: 'set_property_value', args: { layer_id: 2, property_path: 'Transform>Position', value: [960, 540] } }, { tool: 'get_keyframes', args: { layer_id: 2 } }] })
  ]
  const e = J.buildEntry({ request: 'q', toolCallLog: log, diffText: 'Actual changes in "C": 1 added, 0 removed, 3 changed.' })
  assert.strictEqual(e.calls.length, 4)
  assert.strictEqual(e.calls[0], 'set_keyframes_batch id 3 Transform>Opacity: 2 keys at 0–1s; id 4 Transform>Opacity: 2 keys at 1–2s')
  assert.match(e.calls[1], /^apply_expression id 7 Transform>Rotation: "var ang0 = 0; ang0 \+ \(time - inPoint\) \* 360 \/ 2;"$/)
  assert.strictEqual(e.calls[2], 'set_layer_parent id 14 → parent id 15')
  assert.strictEqual(e.calls[3], 'batch_call: create_layer null "Pivot"; set_property_value id 2 Transform>Position = [960, 540]')
})

test('journal: formatJournal writes the [SYSTEM] message, filters by comp, and is empty with nothing to say', () => {
  const e1 = J.buildEntry({ request: 'Пусть Circle C крутится вокруг Circle B', toolCallLog: ORBIT_LOG, diff: ORBIT_DIFF, diffText: ORBIT_DIFF_TEXT, at: 1 })
  const other = J.buildEntry({ request: 'other comp', toolCallLog: [ok('set_property_value', { layer_id: 1, property_path: 'Transform>Opacity', value: 0 })], diff: { ok: true, compSwitched: false, compName: 'Other', count: 1, added: [], removed: [], changed: [{ id: 1, name: 'L', changes: ['opacity 100 → 0'] }], moved: [] }, diffText: 'Actual changes in "Other": 0 added, 0 removed, 1 changed.', at: 2 })
  const text = J.formatJournal([e1, other], { compName: 'Eval-Comp' })
  assert.match(text, /^\[SYSTEM\] JOURNAL — what YOU changed earlier in this comp \("Eval-Comp"\)/)
  assert.match(text, /never build a second rig/)
  assert.match(text, /#1 request: «Пусть Circle C крутится вокруг Circle B»/)
  assert.match(text, /- apply_motion_recipe orbit → "Circle C" \(id 14\)/)
  assert.match(text, /- layers you created: "Circle C Orbit" \(null, id 15\)/)
  assert.ok(!/other comp/.test(text), 'entries from another comp are filtered out')
  assert.ok(!/#2/.test(text))
  assert.strictEqual(J.formatJournal([], {}), '')
  assert.strictEqual(J.formatJournal([other], { compName: 'Eval-Comp' }), '')
  assert.strictEqual(J.formatJournal([null, undefined], {}), '')
})

test('journal: long journals drop the oldest entries to fit maxChars', () => {
  const entries = []
  for (let i = 0; i < 20; i++) {
    entries.push(J.buildEntry({ request: 'request number ' + i + ' ' + 'x'.repeat(80), toolCallLog: [ok('set_property_value', { layer_id: i, property_path: 'Transform>Opacity', value: i })], diffText: 'Actual changes in "C": 0 added, 0 removed, 1 changed. ~ "L' + i + '": opacity', at: i }))
  }
  const text = J.formatJournal(entries, { maxChars: 1200 })
  assert.ok(text.length <= 1200, 'capped: ' + text.length)
  assert.match(text, /request number 19/, 'newest entry kept')
  assert.ok(!/request number 0 /.test(text), 'oldest entry dropped')
})
