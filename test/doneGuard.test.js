/**
 * Tests for lib/pure/doneGuard.js — the phantom-"done" guard.
 *
 * The two positive fixtures are verbatim from a live bug-hunt round-5 run
 * (GLM-4.7): a "Готово! Добавил…" reply with zero tool calls, and a success
 * report right after set_keyframes_batch failed all 20 targets.
 */
const test = require('node:test')
const assert = require('node:assert')

const guard = require('../lib/pure/doneGuard.js')

const READ_ONLY = { get_detailed_comp_summary: true, search_layers: true, get_layer_properties: true }

function ok (name) { return { name, status: 'ok', result: { ok: true } } }
function fail (name, message) { return { name, status: 'error', result: { ok: false, message } } }

// ── no-tools fabrication ─────────────────────────────────────────────────

test('no-tools: RU "Готово! Добавил…" with zero tool calls is flagged', () => {
  const content = 'Готово! Добавил второй слайдер для амплитуды плавания:\n- эффект "Amplitude" на слой "Speed Controller"'
  const got = guard.checkPhantomDone(content, [], READ_ONLY)
  assert.ok(got)
  assert.strictEqual(got.reason, 'no-tools')
})

test('no-tools: EN "I have added…" with zero tool calls is flagged', () => {
  const got = guard.checkPhantomDone('Done! I have added the wiggle expression to all 20 layers.', [], READ_ONLY)
  assert.ok(got)
  assert.strictEqual(got.reason, 'no-tools')
})

test('no-tools: pure explanation answer is NOT flagged', () => {
  const content = 'Выражение wiggle(freq, amp) добавляет случайное движение. Частота задаёт колебания в секунду.'
  assert.strictEqual(guard.checkPhantomDone(content, [], READ_ONLY), null)
})

test('no-tools: clarifying question is NOT flagged', () => {
  assert.strictEqual(guard.checkPhantomDone('Какие именно слои нужно сдвинуть?', [], READ_ONLY), null)
})

// ── unresolved failures ──────────────────────────────────────────────────

test('unresolved: run ending on a failed mutating call is flagged', () => {
  const log = [
    ok('search_layers'),
    fail('set_keyframes_batch', 'Keyframe batch finished: 0 target(s) succeeded (0 keyframes), 20 failed.'),
    ok('get_detailed_comp_summary') // read-only after the failure ≠ recovery
  ]
  const got = guard.checkPhantomDone('Готово! Сетка поднята на 80 пикселей выше.', log, READ_ONLY)
  assert.ok(got)
  assert.strictEqual(got.reason, 'unresolved-failures')
  assert.ok(got.failedSummary[0].includes('set_keyframes_batch'))
})

test('unresolved: successful mutating call AFTER the failure counts as recovery', () => {
  const log = [
    fail('batch_call', '4/5 calls succeeded. Fix and re-send ONLY the failed ones.'),
    ok('add_effect')
  ]
  assert.strictEqual(guard.checkPhantomDone('Готово! Контроллер добавлен.', log, READ_ONLY), null)
})

test('unresolved: clean run with zero failures is never flagged', () => {
  const log = [ok('create_layer'), ok('set_keyframes_batch')]
  assert.strictEqual(guard.checkPhantomDone('Готово! Сетка создана.', log, READ_ONLY), null)
})

test('unresolved: reply asking the user a question is NOT overridden', () => {
  const log = [fail('apply_expression', 'Property not found')]
  const content = 'Не нашёл свойство. Вы имели в виду Position или Anchor Point?'
  assert.strictEqual(guard.checkPhantomDone(content, log, READ_ONLY), null)
})

// ── nudge messages ───────────────────────────────────────────────────────

test('buildNudge: no-tools message tells the model nothing changed', () => {
  const msg = guard.buildNudge({ reason: 'no-tools' })
  assert.ok(msg.startsWith('[SYSTEM]'))
  assert.ok(/ZERO tool calls/.test(msg))
})

test('buildNudge: unresolved message lists the failed calls', () => {
  const msg = guard.buildNudge({ reason: 'unresolved-failures', failedSummary: ['set_keyframes_batch — 0 target(s) succeeded'] })
  assert.ok(msg.startsWith('[SYSTEM]'))
  assert.ok(msg.includes('set_keyframes_batch'))
})
