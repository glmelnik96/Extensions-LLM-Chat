/**
 * Tests for lib/pure/visionCheck.js — vision-feedback pure functions.
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

const win = loadBrowserGlobal('lib/pure/visionCheck.js')
const vc = win.PURE_VISION_CHECK

// ── Module loading ────────────────────────────────────────────────────────

test('visionCheck: module loads with expected exports', () => {
  assert.ok(vc, 'PURE_VISION_CHECK exists')
  assert.strictEqual(typeof vc.buildMessages, 'function')
  assert.strictEqual(typeof vc.parseVerdict, 'function')
  assert.strictEqual(typeof vc.buildCorrectionPrompt, 'function')
  assert.strictEqual(typeof vc.classifyIssues, 'function')
  assert.strictEqual(vc.VISION_MODEL_ID, 'MiniMaxAI/MiniMax-M3')
})

// ── buildMessages ─────────────────────────────────────────────────────────

test('visionCheck: buildMessages returns system + user with image part', () => {
  const msgs = vc.buildMessages('create red solid', 'created a red solid', 'data:image/jpeg;base64,abc')
  assert.strictEqual(msgs.length, 2)
  assert.strictEqual(msgs[0].role, 'system')
  assert.ok(typeof msgs[0].content === 'string')
  assert.ok(msgs[0].content.includes('QA reviewer'))
  assert.strictEqual(msgs[1].role, 'user')
  assert.ok(Array.isArray(msgs[1].content), 'user content is content-parts array')
  assert.strictEqual(msgs[1].content.length, 2)
  assert.strictEqual(msgs[1].content[0].type, 'text')
  assert.ok(msgs[1].content[0].text.includes('create red solid'))
  assert.ok(msgs[1].content[0].text.includes('created a red solid'))
  assert.strictEqual(msgs[1].content[1].type, 'image_url')
  assert.strictEqual(msgs[1].content[1].image_url.url, 'data:image/jpeg;base64,abc')
})

test('visionCheck: buildMessages handles empty inputs gracefully', () => {
  const msgs = vc.buildMessages('', '', 'data:image/jpeg;base64,x')
  assert.strictEqual(msgs.length, 2)
  assert.ok(msgs[1].content[0].text.includes('(none)'))
})

// ── parseVerdict ──────────────────────────────────────────────────────────

test('visionCheck: parseVerdict — clean JSON ok:true', () => {
  const v = vc.parseVerdict('{"ok": true, "issues": []}')
  assert.strictEqual(v.ok, true)
  assert.strictEqual(v.issues.length, 0)
})

test('visionCheck: parseVerdict — clean JSON ok:false with issues', () => {
  const v = vc.parseVerdict('{"ok": false, "issues": ["text cut off", "wrong color"]}')
  assert.strictEqual(v.ok, false)
  assert.strictEqual(v.issues.length, 2)
  assert.strictEqual(v.issues[0], 'text cut off')
  assert.strictEqual(v.issues[1], 'wrong color')
})

test('visionCheck: parseVerdict — fenced JSON', () => {
  const v = vc.parseVerdict('```json\n{"ok": false, "issues": ["off-screen"]}\n```')
  assert.strictEqual(v.ok, false)
  assert.strictEqual(v.issues.length, 1)
  assert.strictEqual(v.issues[0], 'off-screen')
})

test('visionCheck: parseVerdict — garbage input fails open', () => {
  const v1 = vc.parseVerdict('I cannot analyze this image because...')
  assert.strictEqual(v1.ok, true)
  assert.strictEqual(v1.issues.length, 0)

  const v2 = vc.parseVerdict('')
  assert.strictEqual(v2.ok, true)

  const v3 = vc.parseVerdict(null)
  assert.strictEqual(v3.ok, true)

  const v4 = vc.parseVerdict(undefined)
  assert.strictEqual(v4.ok, true)
})

test('visionCheck: parseVerdict — issues capped at 5', () => {
  const issues = []
  for (let i = 0; i < 10; i++) issues.push('issue ' + i)
  const v = vc.parseVerdict(JSON.stringify({ ok: false, issues }))
  assert.strictEqual(v.ok, false)
  assert.strictEqual(v.issues.length, 5)
})

test('visionCheck: parseVerdict — non-string issues coerced', () => {
  const v = vc.parseVerdict('{"ok": false, "issues": [123, true, null, {"x":1}]}')
  assert.strictEqual(v.ok, false)
  // null is filtered out, others coerced to string
  assert.strictEqual(v.issues.length, 3)
  assert.strictEqual(v.issues[0], '123')
  assert.strictEqual(v.issues[1], 'true')
  assert.strictEqual(v.issues[2], '[object Object]')
})

test('visionCheck: parseVerdict — JSON embedded in reasoning text', () => {
  const text = 'Let me analyze this frame carefully...\n\nThe frame shows a red solid.\n{"ok": true, "issues": []}\n'
  const v = vc.parseVerdict(text)
  assert.strictEqual(v.ok, true)
})

test('visionCheck: parseVerdict — malformed JSON fails open', () => {
  const v = vc.parseVerdict('{"ok": false, "issues": [')
  assert.strictEqual(v.ok, true)
  assert.strictEqual(v.issues.length, 0)
})

// ── buildCorrectionPrompt ─────────────────────────────────────────────────

test('visionCheck: parseVerdict — ok:false with empty issues array fails open', () => {
  const v = vc.parseVerdict('{"ok":false,"issues":[]}')
  assert.strictEqual(v.ok, true, 'should flip to ok:true when no actionable issues')
  assert.strictEqual(v.issues.length, 0)
})

test('visionCheck: parseVerdict — ok:false with only-null/coerced issues keeps ok:false when issues remain', () => {
  const v = vc.parseVerdict('{"ok":false,"issues":[null, 42]}')
  // null is filtered; 42 coerced to '42' — one actionable issue remains
  assert.strictEqual(v.ok, false)
  assert.strictEqual(v.issues.length, 1)
  assert.strictEqual(v.issues[0], '42')
})

test('visionCheck: parseVerdict — ok:false with all-null issues fails open', () => {
  const v = vc.parseVerdict('{"ok":false,"issues":[null, null]}')
  // all items filtered → zero issues → fail open
  assert.strictEqual(v.ok, true, 'should flip to ok:true when all issues filtered out')
  assert.strictEqual(v.issues.length, 0)
})

test('visionCheck: buildCorrectionPrompt contains issues', () => {
  const prompt = vc.buildCorrectionPrompt(['text is cut off', 'wrong background color'])
  assert.ok(prompt.includes('text is cut off'))
  assert.ok(prompt.includes('wrong background color'))
  assert.ok(prompt.includes('Fix ONLY'))
  assert.ok(prompt.includes('minimal changes'))
})

test('visionCheck: buildCorrectionPrompt with single issue', () => {
  const prompt = vc.buildCorrectionPrompt(['element off-screen'])
  assert.ok(prompt.includes('- element off-screen'))
})

test('visionCheck: buildCorrectionPrompt demands verify-first, forbids restructuring', () => {
  const prompt = vc.buildCorrectionPrompt(['text is cut off'])
  assert.ok(prompt.includes('ONE still frame'), 'warns the check can be wrong')
  assert.ok(prompt.includes('FIRST verify'), 'requires verification before fixing')
  assert.ok(prompt.includes('false positive'), 'allows changing nothing')
  assert.ok(prompt.includes('reorder layers'), 'forbids restructuring')
})

// ── classifyIssues ────────────────────────────────────────────────────────

test('visionCheck: classifyIssues — empty/black frame reports are weak', () => {
  const weakOnes = [
    'The frame is completely black',
    'Empty frame — no content was rendered',
    'The composition appears blank with nothing visible',
    'No visible content in the image',
    'The screen is entirely dark'
  ]
  for (const issue of weakOnes) {
    const c = vc.classifyIssues([issue])
    assert.strictEqual(c.actionable.length, 0, 'weak: ' + issue)
    assert.strictEqual(c.weak.length, 1)
  }
})

test('visionCheck: classifyIssues — real defects stay actionable', () => {
  const real = [
    'Text overflows the background box',
    'White text on white background is unreadable',
    'The title layer is positioned off-screen to the right',
    'Wrong color: the circle is blue but red was requested'
  ]
  const c = vc.classifyIssues(real)
  assert.strictEqual(c.actionable.length, 4)
  assert.strictEqual(c.weak.length, 0)
})

test('visionCheck: classifyIssues — mixed list splits correctly', () => {
  const c = vc.classifyIssues([
    'The frame is completely black',
    'Text is cut off at the bottom'
  ])
  assert.strictEqual(c.actionable.length, 1)
  assert.strictEqual(c.actionable[0], 'Text is cut off at the bottom')
  assert.strictEqual(c.weak.length, 1)
})

test('visionCheck: classifyIssues — tolerates non-array input', () => {
  const c = vc.classifyIssues(null)
  assert.strictEqual(c.actionable.length, 0)
  assert.strictEqual(c.weak.length, 0)
})
