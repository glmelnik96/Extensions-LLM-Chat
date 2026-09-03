/**
 * Tests for lib/pure/sceneDiff.js — before/after comp snapshot diffing that
 * feeds the transcript "actual changes" note and the loop's VERIFY turn.
 */
const test = require('node:test')
const assert = require('node:assert')

const SD = require('../lib/pure/sceneDiff.js')

function layer (over) {
  const base = {
    index: 1, id: 10, name: 'Circle', type: 'shape', inPoint: 0, outPoint: 5, startTime: 0,
    threeDLayer: false, parentIndex: null, parentName: '', effects: [], hasExpressions: false,
    enabled: true, locked: false,
    transform: { anchorPoint: [0, 0], position: [960, 540], scale: [100, 100], rotation: 0, opacity: 100 }
  }
  return Object.assign(base, over || {})
}

function snap (layers, over) {
  return Object.assign({ ok: true, compName: 'Main', compId: 1, width: 1920, height: 1080, time: 0, layers }, over || {})
}

test('sceneDiff: identical snapshots produce no changes', () => {
  const d = SD.diffScenes(snap([layer()]), snap([layer()]))
  assert.strictEqual(d.ok, true)
  assert.strictEqual(d.count, 0)
  assert.match(SD.formatDiff(d), /No changes detected/)
})

test('sceneDiff: added and removed layers are listed by name and type', () => {
  const before = snap([layer({ id: 10 }), layer({ id: 11, name: 'Old', type: 'text', index: 2 })])
  const after = snap([layer({ id: 12, name: 'New', type: 'null', index: 1 }), layer({ id: 10, index: 2 })])
  const d = SD.diffScenes(before, after)
  assert.deepStrictEqual(d.added.map(l => l.name), ['New'])
  assert.strictEqual(d.added[0].hidden, false)
  assert.deepStrictEqual(d.removed.map(l => l.name), ['Old'])
  assert.strictEqual(d.changed.length, 0)
  // an insertion shifts indexes — that is NOT a reorder
  assert.strictEqual(d.moved.length, 0)
  const text = SD.formatDiff(d)
  assert.match(text, /\+ "New" \(null\)/)
  assert.match(text, /- "Old" \(text\)/)
})

test('sceneDiff: rename, video switch, lock and parent changes are described', () => {
  const before = snap([layer({ id: 10 }), layer({ id: 20, index: 2, name: 'Null 1', type: 'null' })])
  const after = snap([
    layer({ id: 10, name: 'Ball', enabled: false, locked: true, parentIndex: 2, parentName: 'Null 1' }),
    layer({ id: 20, index: 2, name: 'Null 1', type: 'null' })
  ])
  const d = SD.diffScenes(before, after)
  assert.strictEqual(d.changed.length, 1)
  const c = d.changed[0].changes.join(' | ')
  assert.match(c, /renamed "Circle" → "Ball"/)
  assert.match(c, /video switch: on → off/)
  assert.match(c, /locked: false → true/)
  assert.match(c, /parent: \(none\) → "Null 1"/)
  assert.strictEqual(d.changed[0].hidden, true, 'changed layer with video off is flagged hidden')
  assert.ok(SD.formatDiff(d).indexOf('~ "Ball" [video switch OFF — not visible]: renamed') !== -1, 'hidden marker rendered before the change list')
})

test('sceneDiff: transform values, keyframe ranges and expressions', () => {
  const before = snap([layer({ id: 10 })])
  const after = snap([layer({
    id: 10,
    transform: { anchorPoint: [0, 0], position: [1200, 540], scale: [50, 50], rotation: 0, opacity: 100 },
    animated: { position: { numKeys: 3, from: 0, to: 1, sig: 'abc' } },
    hasExpressions: true,
    expressions: [{ path: 'Transform>Scale', snippet: 'wiggle(3, 25)', sig: 'x1' }]
  })])
  const d = SD.diffScenes(before, after)
  const c = d.changed[0].changes.join(' | ')
  assert.match(c, /position: \[960,540\] → \[1200,540\]/)
  assert.match(c, /scale: \[100,100\] → \[50,50\]/)
  assert.match(c, /position: keyframes added \(3 keys, 0\.00–1\.00s\)/)
  assert.match(c, /Transform>Scale: expression set \("wiggle\(3, 25\)"\)/)
})

test('sceneDiff: a visible first key after the in-point is reported as held before it', () => {
  const before = snap([layer({ id: 10, name: 'Card 2', inPoint: 0 })])
  const after = snap([layer({ id: 10, name: 'Card 2', inPoint: 0, animated: { opacity: { numKeys: 2, from: 1, to: 2, firstValue: 100, lastValue: 0 } } })])
  const c = SD.diffScenes(before, after).changed[0].changes.join(' | ')
  assert.match(c, /opacity: keyframes added \(2 keys, 1\.00–2\.00s; holds 100 BEFORE 1\.00s \(visible from the in-point 0\.00s\)\)/)
  // first key at the in-point, or an invisible first value: no note
  const ok1 = snap([layer({ id: 10, animated: { opacity: { numKeys: 2, from: 0, to: 1, firstValue: 0, lastValue: 100 } } })])
  assert.ok(!/holds/.test(SD.diffScenes(before, ok1).changed[0].changes.join(' | ')))
  const ok2 = snap([layer({ id: 10, animated: { opacity: { numKeys: 2, from: 1, to: 2, firstValue: 0, lastValue: 100 } } })])
  assert.ok(!/holds/.test(SD.diffScenes(before, ok2).changed[0].changes.join(' | ')))
})

test('sceneDiff: keyframe value edits (same count) and expression changes via sig', () => {
  const before = snap([layer({
    id: 10,
    animated: { opacity: { numKeys: 2, from: 0, to: 1, sig: 'a' } },
    expressions: [{ path: 'Transform>Position', snippet: 'wiggle(1, 5)', sig: 'p1' }]
  })])
  const after = snap([layer({
    id: 10,
    animated: { opacity: { numKeys: 2, from: 0, to: 1, sig: 'b' } },
    expressions: [{ path: 'Transform>Position', snippet: 'wiggle(4, 40)', sig: 'p2', error: 'Object of type X not found' }]
  })])
  const c = SD.diffScenes(before, after).changed[0].changes.join(' | ')
  assert.match(c, /opacity: keyframe values edited/)
  assert.match(c, /Transform>Position: expression changed \("wiggle\(4, 40\)"\) — ERROR: Object of type X not found/)
})

test('sceneDiff: expression removed, effects added/changed, text, time remap, masks', () => {
  const before = snap([layer({
    id: 10, type: 'text', text: 'Hello', textSig: 'h1',
    expressions: [{ path: 'Transform>Opacity', snippet: 'linear(time,0,1,0,100)', sig: 'o1' }],
    effects: [{ index: 1, name: 'Gaussian Blur', matchName: 'ADBE Gaussian Blur 2', sig: 'g1' }]
  })])
  const after = snap([layer({
    id: 10, type: 'text', text: 'Hello world', textSig: 'h2',
    effects: [
      { index: 1, name: 'Gaussian Blur', matchName: 'ADBE Gaussian Blur 2', sig: 'g2' },
      { index: 2, name: 'Fill', matchName: 'ADBE Fill', sig: 'f1' }
    ],
    timeRemapEnabled: true, numMasks: 1
  })])
  const c = SD.diffScenes(before, after).changed[0].changes.join(' | ')
  assert.match(c, /Transform>Opacity: expression removed/)
  assert.match(c, /effect added: "Fill"/)
  assert.match(c, /effect "Gaussian Blur" settings changed/)
  assert.match(c, /text: "Hello" → "Hello world"/)
  assert.match(c, /time remap: enabled/)
  assert.match(c, /masks: 0 → 1/)
})

test('sceneDiff: pure reorder is reported, comp switch short-circuits, bad input fails soft', () => {
  const before = snap([layer({ id: 10, index: 1 }), layer({ id: 11, index: 2, name: 'B' })])
  const after = snap([layer({ id: 11, index: 1, name: 'B' }), layer({ id: 10, index: 2 })])
  const d = SD.diffScenes(before, after)
  assert.strictEqual(d.changed.length, 0)
  assert.strictEqual(d.moved.length, 2)
  assert.strictEqual(d.count, 1)
  assert.match(SD.formatDiff(d), /reordered/)

  const sw = SD.diffScenes(snap([layer()]), snap([layer()], { compId: 2, compName: 'Other' }))
  assert.strictEqual(sw.compSwitched, true)
  assert.match(SD.formatDiff(sw), /"Main" → "Other"/)

  const bad = SD.diffScenes(null, snap([]))
  assert.strictEqual(bad.ok, false)
  assert.match(SD.formatDiff(bad), /unavailable/)
  assert.match(SD.formatDiff(SD.diffScenes({ ok: false, message: 'No active composition.' }, snap([]))), /before the run/)
})

test('sceneDiff: formatDiff caps listed layers and total length', () => {
  const beforeLayers = []
  const afterLayers = []
  for (let i = 0; i < 20; i++) {
    beforeLayers.push(layer({ id: 100 + i, index: i + 1, name: 'L' + i }))
    afterLayers.push(layer({ id: 100 + i, index: i + 1, name: 'L' + i, transform: { position: [i, i], scale: [100, 100], rotation: 0, opacity: 100, anchorPoint: [0, 0] } }))
  }
  const d = SD.diffScenes(snap(beforeLayers), snap(afterLayers))
  assert.strictEqual(d.changed.length, 20)
  const text = SD.formatDiff(d, { maxLayers: 5 })
  assert.match(text, /\+15 more layer\(s\) not listed/)
  assert.ok(SD.formatDiff(d, { maxChars: 200 }).length <= 200)
})
