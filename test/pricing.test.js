/**
 * Tests for lib/pure/pricing.js — token→ruble cost pure functions.
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

const win = loadBrowserGlobal('lib/pure/pricing.js')
const P = win.PURE_PRICING

// Objects returned from the module live in the vm realm, so their prototype is
// not the test realm's Object.prototype; deepStrictEqual rejects that. Normalize
// to a plain test-realm object before structural comparison.
function plain (v) { return JSON.parse(JSON.stringify(v)) }

// ── Module loading ─────────────────────────────────────────────────────────

test('pricing: module loads with expected exports', () => {
  assert.ok(P, 'PURE_PRICING exists')
  assert.strictEqual(typeof P.costFor, 'function')
  assert.strictEqual(typeof P.formatRub, 'function')
  assert.strictEqual(typeof P.mergePricing, 'function')
  assert.ok(P.DEFAULT_PRICING && typeof P.DEFAULT_PRICING === 'object')
})

// ── DEFAULT_PRICING integrity (guards against accidental edits) ─────────────

test('pricing: DEFAULT_PRICING has exactly the 5 expected ids with exact rates', () => {
  const d = P.DEFAULT_PRICING
  assert.deepStrictEqual(Object.keys(d).sort(), [
    'MiniMaxAI/MiniMax-M2.5',
    'MiniMaxAI/MiniMax-M3',
    'moonshotai/Kimi-K2.6',
    'openai/gpt-oss-120b',
    'zai-org/GLM-4.7'
  ].sort())
  assert.deepStrictEqual(plain(d['openai/gpt-oss-120b']), { input: 15.86, output: 61 })
  assert.deepStrictEqual(plain(d['MiniMaxAI/MiniMax-M2.5']), { input: 353.8, output: 475.8 })
  assert.deepStrictEqual(plain(d['zai-org/GLM-4.7']), { input: 549, output: 793 })
  assert.deepStrictEqual(plain(d['moonshotai/Kimi-K2.6']), { input: 175.68, output: 725.9 })
  assert.deepStrictEqual(plain(d['MiniMaxAI/MiniMax-M3']), { input: 240.22, output: 1008.85 })
})

// ── costFor ─────────────────────────────────────────────────────────────────

test('pricing: costFor — known model split in/out exact math', () => {
  // gpt-oss-120b: 1e6 prompt + 1e6 completion = 15.86 + 61 = 76.86 ₽
  const r = P.costFor('openai/gpt-oss-120b', 1e6, 1e6, P.DEFAULT_PRICING)
  assert.strictEqual(r.known, true)
  assert.ok(Math.abs(r.rub - 76.86) < 1e-9, 'rub=' + r.rub)
})

test('pricing: costFor — input and output priced separately (M3 vision rates)', () => {
  // M3: 2e6 prompt * 240.22 + 0.5e6 completion * 1008.85
  const r = P.costFor('MiniMaxAI/MiniMax-M3', 2e6, 500000, P.DEFAULT_PRICING)
  const expected = 2 * 240.22 + 0.5 * 1008.85
  assert.ok(Math.abs(r.rub - expected) < 1e-9, 'rub=' + r.rub + ' expected=' + expected)
})

test('pricing: costFor — uses DEFAULT_PRICING when table omitted', () => {
  const r = P.costFor('openai/gpt-oss-120b', 1e6, 0)
  assert.ok(Math.abs(r.rub - 15.86) < 1e-9)
  assert.strictEqual(r.known, true)
})

test('pricing: costFor — unknown model → {rub:0, known:false}', () => {
  const r = P.costFor('bogus/nonexistent-model', 1e6, 1e6, P.DEFAULT_PRICING)
  assert.deepStrictEqual(plain(r), { rub: 0, known: false })
})

test('pricing: costFor — NaN/undefined tokens coerced to 0', () => {
  const a = P.costFor('openai/gpt-oss-120b', undefined, NaN, P.DEFAULT_PRICING)
  assert.strictEqual(a.rub, 0)
  assert.strictEqual(a.known, true)
  const b = P.costFor('openai/gpt-oss-120b', 'nope', null, P.DEFAULT_PRICING)
  assert.strictEqual(b.rub, 0)
  // Only completion is bad → still price the prompt.
  const c = P.costFor('openai/gpt-oss-120b', 1e6, undefined, P.DEFAULT_PRICING)
  assert.ok(Math.abs(c.rub - 15.86) < 1e-9)
})

test('pricing: costFor — zero tokens → 0', () => {
  const r = P.costFor('openai/gpt-oss-120b', 0, 0, P.DEFAULT_PRICING)
  assert.strictEqual(r.rub, 0)
  assert.strictEqual(r.known, true)
})

test('pricing: costFor — null/empty modelId → not known', () => {
  assert.deepStrictEqual(plain(P.costFor(null, 1e6, 1e6, P.DEFAULT_PRICING)), { rub: 0, known: false })
  assert.deepStrictEqual(plain(P.costFor('', 1e6, 1e6, P.DEFAULT_PRICING)), { rub: 0, known: false })
})

// ── mergePricing ─────────────────────────────────────────────────────────────

test('pricing: mergePricing — override one model output only', () => {
  const merged = P.mergePricing(P.DEFAULT_PRICING, {
    'openai/gpt-oss-120b': { output: 99 }
  })
  assert.deepStrictEqual(plain(merged['openai/gpt-oss-120b']), { input: 15.86, output: 99 })
  // Others untouched.
  assert.deepStrictEqual(plain(merged['zai-org/GLM-4.7']), { input: 549, output: 793 })
})

test('pricing: mergePricing — does not mutate defaults', () => {
  const before = JSON.parse(JSON.stringify(P.DEFAULT_PRICING))
  P.mergePricing(P.DEFAULT_PRICING, { 'openai/gpt-oss-120b': { input: 1, output: 2 } })
  assert.deepStrictEqual(plain(P.DEFAULT_PRICING), before)
})

test('pricing: mergePricing — null/partial/undefined override tolerated', () => {
  assert.deepStrictEqual(
    plain(P.mergePricing(P.DEFAULT_PRICING, null)['openai/gpt-oss-120b']),
    { input: 15.86, output: 61 })
  assert.deepStrictEqual(
    plain(P.mergePricing(P.DEFAULT_PRICING, undefined)['openai/gpt-oss-120b']),
    { input: 15.86, output: 61 })
  // A model entry that is null is ignored.
  const m = P.mergePricing(P.DEFAULT_PRICING, { 'zai-org/GLM-4.7': null })
  assert.deepStrictEqual(plain(m['zai-org/GLM-4.7']), { input: 549, output: 793 })
  // null field falls back to default field.
  const m2 = P.mergePricing(P.DEFAULT_PRICING, { 'zai-org/GLM-4.7': { input: null, output: 1 } })
  assert.deepStrictEqual(plain(m2['zai-org/GLM-4.7']), { input: 549, output: 1 })
})

test('pricing: mergePricing — adding a new model id', () => {
  const merged = P.mergePricing(P.DEFAULT_PRICING, {
    'vendor/new-model': { input: 10, output: 20 }
  })
  assert.deepStrictEqual(plain(merged['vendor/new-model']), { input: 10, output: 20 })
  const r = P.costFor('vendor/new-model', 1e6, 1e6, merged)
  assert.ok(Math.abs(r.rub - 30) < 1e-9)
  assert.strictEqual(r.known, true)
})

// ── formatRub ─────────────────────────────────────────────────────────────────

test('pricing: formatRub — 0 → sensible', () => {
  assert.strictEqual(P.formatRub(0), '0 ₽')
})

test('pricing: formatRub — <1 ₽ shows fine precision', () => {
  assert.strictEqual(P.formatRub(0.0042), '0.0042 ₽')
  assert.strictEqual(P.formatRub(0.042), '0.042 ₽')
  // Trailing zeros trimmed.
  assert.strictEqual(P.formatRub(0.5), '0.5 ₽')
})

test('pricing: formatRub — >=1 ₽ two decimals', () => {
  assert.strictEqual(P.formatRub(4.21), '4.21 ₽')
  assert.strictEqual(P.formatRub(76.86), '76.86 ₽')
  assert.strictEqual(P.formatRub(1), '1.00 ₽')
})

test('pricing: formatRub — large number gets thousands separator', () => {
  assert.strictEqual(P.formatRub(1234.5), '1 234.50 ₽')
  assert.strictEqual(P.formatRub(1234567.89), '1 234 567.89 ₽')
})

test('pricing: formatRub — negative/NaN coerced to 0', () => {
  assert.strictEqual(P.formatRub(-5), '0 ₽')
  assert.strictEqual(P.formatRub(NaN), '0 ₽')
  assert.strictEqual(P.formatRub(undefined), '0 ₽')
})

// ── Issue 1: negative token clamp ────────────────────────────────────────────

test('pricing: costFor — negative promptTokens clamped to 0 (no negative cost)', () => {
  // Negative tokens from a malformed API response must not reduce accumulated cost.
  const r = P.costFor('openai/gpt-oss-120b', -5000, 0, P.DEFAULT_PRICING)
  assert.strictEqual(r.rub, 0)
  assert.strictEqual(r.known, true)
})

test('pricing: costFor — Infinity tokens clamped to 0', () => {
  const r = P.costFor('openai/gpt-oss-120b', Infinity, 0, P.DEFAULT_PRICING)
  assert.strictEqual(r.rub, 0)
  assert.strictEqual(r.known, true)
})

test('pricing: mergePricing + costFor — negative rate override floors to 0', () => {
  // A negative config rate must not produce negative rub.
  const badTable = P.mergePricing(P.DEFAULT_PRICING, {
    'openai/gpt-oss-120b': { input: -100, output: -200 }
  })
  const r = P.costFor('openai/gpt-oss-120b', 1e6, 1e6, badTable)
  assert.strictEqual(r.rub, 0)
  assert.strictEqual(r.known, true)
})

// ── Issue 2: tiny-but-nonzero formatRub ──────────────────────────────────────

test('pricing: formatRub — tiny non-zero shows < 0.0001 ₽', () => {
  assert.strictEqual(P.formatRub(0.00001), '< 0.0001 ₽')
  assert.strictEqual(P.formatRub(0.00009999), '< 0.0001 ₽')
})

test('pricing: formatRub — 0 and negatives are still "0 ₽" not the tiny sentinel', () => {
  assert.strictEqual(P.formatRub(0), '0 ₽')
  assert.strictEqual(P.formatRub(-5), '0 ₽')
})

test('pricing: formatRub — 0.0003 shows real value (>= 0.0001 threshold)', () => {
  assert.strictEqual(P.formatRub(0.0003), '0.0003 ₽')
})
