/**
 * Tests for lib/pure/sessionStore.js — multi-chat session store:
 * legacy-format migration, session creation, persist serialization,
 * auto-titling.
 */
const test = require('node:test')
const assert = require('node:assert')
const store = require('../lib/pure/sessionStore.js')

function legacySession (over) {
  return Object.assign({
    id: 'session_123_abc',
    title: 'Session',
    createdAt: 1,
    updatedAt: 2,
    model: 'openai/gpt-oss-120b',
    totalTokens: 10,
    promptTokens: 6,
    completionTokens: 4,
    costRub: 0.5,
    messages: [{ role: 'user', text: 'hi' }]
  }, over || {})
}

// ── migratePersisted ────────────────────────────────────────────────────

test('migrate: null/garbage input → empty store', () => {
  for (const input of [null, undefined, 'x', 42, {}]) {
    const out = store.migratePersisted(input)
    assert.deepStrictEqual(out, { sessions: [], activeSessionId: null })
  }
})

test('migrate: legacy { session } becomes the first active chat', () => {
  const s = legacySession()
  const out = store.migratePersisted({ session: s })
  assert.strictEqual(out.sessions.length, 1)
  assert.strictEqual(out.sessions[0].id, s.id)
  assert.strictEqual(out.activeSessionId, s.id)
  assert.deepStrictEqual(out.sessions[0].messages, s.messages)
})

test('migrate: v2 shape passes through with active id preserved', () => {
  const a = legacySession({ id: 'session_a' })
  const b = legacySession({ id: 'session_b' })
  const out = store.migratePersisted({ sessions: [a, b], activeSessionId: 'session_b' })
  assert.strictEqual(out.sessions.length, 2)
  assert.strictEqual(out.activeSessionId, 'session_b')
})

test('migrate: dangling activeSessionId falls back to first session', () => {
  const a = legacySession({ id: 'session_a' })
  const out = store.migratePersisted({ sessions: [a], activeSessionId: 'session_gone' })
  assert.strictEqual(out.activeSessionId, 'session_a')
})

test('migrate: repairs missing title/messages and drops invalid entries', () => {
  const broken = { id: 'session_x', title: '', messages: null }
  const out = store.migratePersisted({ sessions: [broken, { nope: true }, 'junk'], activeSessionId: 'session_x' })
  assert.strictEqual(out.sessions.length, 1)
  assert.strictEqual(out.sessions[0].title, 'Chat 1')
  assert.deepStrictEqual(out.sessions[0].messages, [])
  assert.strictEqual(out.activeSessionId, 'session_x')
})

// ── createSession ───────────────────────────────────────────────────────

test('createSession: fresh session shape + numbered title', () => {
  const s1 = store.createSession('m1', [])
  assert.match(s1.id, /^session_\d+_[a-z0-9]+$/)
  assert.strictEqual(s1.title, 'Chat 1')
  assert.strictEqual(s1.model, 'm1')
  assert.deepStrictEqual(s1.messages, [])
  assert.strictEqual(s1.totalTokens, 0)
  assert.strictEqual(s1.costRub, 0)

  const s2 = store.createSession('m1', [s1])
  assert.strictEqual(s2.title, 'Chat 2')
  assert.notStrictEqual(s2.id, s1.id)
})

test('createSession: skips colliding default titles', () => {
  const existing = [store.createSession('m', [])]
  existing.push({ id: 'x', title: 'Chat 2', messages: [] })
  const s = store.createSession('m', existing)
  assert.strictEqual(s.title, 'Chat 3')
})

// ── serializeForPersist ─────────────────────────────────────────────────

test('serializeForPersist: explicit fields only, transient props stripped', () => {
  const s = legacySession({ _runtimeJunk: { big: true } })
  const out = store.serializeForPersist([s], s.id)
  assert.strictEqual(out.activeSessionId, s.id)
  assert.strictEqual(out.sessions.length, 1)
  assert.strictEqual(out.sessions[0]._runtimeJunk, undefined)
  assert.strictEqual(out.sessions[0].title, 'Session')
  assert.strictEqual(out.sessions[0].totalTokens, 10)
  // Round-trips through migrate cleanly.
  const back = store.migratePersisted(JSON.parse(JSON.stringify(out)))
  assert.strictEqual(back.activeSessionId, s.id)
})

// ── titles ──────────────────────────────────────────────────────────────

test('titleFromFirstMessage: trims, collapses whitespace, truncates at word', () => {
  assert.strictEqual(store.titleFromFirstMessage('  сделай   bounce  '), 'сделай bounce')
  assert.strictEqual(store.titleFromFirstMessage(''), null)
  assert.strictEqual(store.titleFromFirstMessage('   \n '), null)
  const long = store.titleFromFirstMessage('Make the selected layers slide in from the left with smooth easing')
  assert.ok(long.length <= 40, 'truncated: ' + long)
  assert.ok(long.endsWith('\u2026'), 'ellipsis added')
})

test('isDefaultTitle: only Session / Chat N are overwritable', () => {
  assert.strictEqual(store.isDefaultTitle('Session'), true)
  assert.strictEqual(store.isDefaultTitle('Chat 1'), true)
  assert.strictEqual(store.isDefaultTitle('Chat 42'), true)
  assert.strictEqual(store.isDefaultTitle('My bounce chat'), false)
  assert.strictEqual(store.isDefaultTitle(''), false)
})
