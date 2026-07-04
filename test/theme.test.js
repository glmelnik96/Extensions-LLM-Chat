const { test } = require('node:test')
const assert = require('node:assert')
const THEME = require('../lib/pure/theme.js')

test('theme: AE default dark background produces dark scheme anchored on host color', () => {
  const p = THEME.derivePalette({ red: 46, green: 46, blue: 46 }) // #2e2e2e
  assert.strictEqual(p.isLight, false)
  assert.strictEqual(p.vars['--bg-panel'], '#2e2e2e')
  assert.strictEqual(p.vars['--bg-deep'], '#1f1f1f')     // -15
  assert.strictEqual(p.vars['--surface'], '#363636')     // +8
  assert.strictEqual(p.vars['--text'], '#e8e8e8')
})

test('theme: light background flips to light scheme with dark text', () => {
  const p = THEME.derivePalette({ red: 200, green: 200, blue: 200 })
  assert.strictEqual(p.isLight, true)
  assert.strictEqual(p.vars['--bg-panel'], '#c8c8c8')
  assert.strictEqual(p.vars['--text'], '#1e1e1e')
  // Light surfaces step DOWN from the background
  assert.strictEqual(p.vars['--surface'], '#c0c0c0')     // -8
})

test('theme: float channels (CEP reports floats) are rounded, channels clamped at 0/255', () => {
  const p = THEME.derivePalette({ red: 30.4, green: 30.4, blue: 30.4 })
  assert.strictEqual(p.vars['--bg-panel'], '#1e1e1e')
  // -15 from near-black must clamp at 0, not go negative
  const black = THEME.derivePalette({ red: 5, green: 5, blue: 5 })
  assert.strictEqual(black.vars['--bg-deep'], '#000000')
  const white = THEME.derivePalette({ red: 250, green: 250, blue: 250 })
  assert.strictEqual(white.vars['--bg-deep'], '#ffffff') // +14 clamps at 255
})

test('theme: every dark var has a light counterpart (no missing overrides on toggle)', () => {
  const dark = THEME.derivePalette({ red: 40, green: 40, blue: 40 })
  const light = THEME.derivePalette({ red: 220, green: 220, blue: 220 })
  assert.deepStrictEqual(Object.keys(dark.vars).sort(), Object.keys(light.vars).sort())
})

test('theme: backgroundFromSkinInfo extracts CEP UIColor shape, null on garbage', () => {
  const skin = { panelBackgroundColor: { type: 1, color: { red: 46, green: 47, blue: 48, alpha: 255 } } }
  assert.deepStrictEqual(THEME.backgroundFromSkinInfo(skin), { red: 46, green: 47, blue: 48 })
  assert.strictEqual(THEME.backgroundFromSkinInfo(null), null)
  assert.strictEqual(THEME.backgroundFromSkinInfo({}), null)
  assert.strictEqual(THEME.backgroundFromSkinInfo({ panelBackgroundColor: { color: { red: 'x' } } }), null)
})
