/**
 * Pure session-store helpers for the multi-chat feature (no DOM, no CEP).
 * Loaded as a browser global (window.PURE_SESSION_STORE) and unit-tested in
 * node via the same vm-sandbox pattern as the other lib/pure modules.
 *
 * Persisted shape (STORAGE_KEY 'ae-motion-agent-state'):
 *   v2 (multi-chat): { sessions: [session, ...], activeSessionId: 'session_...' }
 *   v1 (legacy):     { session: {...} | null }
 * migratePersisted() accepts both and always returns the v2 shape, so the
 * panel never loses a pre-upgrade chat.
 */
;(function () {
  'use strict'

  function makeSessionId () {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)
  }

  // Create a fresh session object. `existingSessions` is used only to pick a
  // readable default title (Chat 1, Chat 2, ...) that doesn't collide.
  function createSession (model, existingSessions) {
    var n = (existingSessions ? existingSessions.length : 0) + 1
    var titles = {}
    if (existingSessions) {
      for (var i = 0; i < existingSessions.length; i++) titles[existingSessions[i].title] = true
    }
    while (titles['Chat ' + n]) n++
    return {
      id: makeSessionId(),
      title: 'Chat ' + n,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: model,
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      costRub: 0,
      messages: []
    }
  }

  function isValidSession (s) {
    return !!(s && typeof s === 'object' && typeof s.id === 'string')
  }

  // Accepts whatever was in localStorage (parsed) and returns the v2 shape.
  // Never throws; worst case returns an empty store.
  function migratePersisted (data) {
    var out = { sessions: [], activeSessionId: null }
    if (!data || typeof data !== 'object') return out

    if (Object.prototype.toString.call(data.sessions) === '[object Array]') {
      for (var i = 0; i < data.sessions.length; i++) {
        if (isValidSession(data.sessions[i])) out.sessions.push(data.sessions[i])
      }
      out.activeSessionId = data.activeSessionId || null
    } else if (isValidSession(data.session)) {
      // v1 single-session format → becomes the first (and active) chat.
      out.sessions.push(data.session)
      out.activeSessionId = data.session.id
    }

    // Ensure every session has a title and message array.
    for (var j = 0; j < out.sessions.length; j++) {
      var s = out.sessions[j]
      if (typeof s.title !== 'string' || !s.title) s.title = 'Chat ' + (j + 1)
      if (Object.prototype.toString.call(s.messages) !== '[object Array]') s.messages = []
    }

    // activeSessionId must point at a real session; fall back to the first.
    var found = false
    for (var k = 0; k < out.sessions.length; k++) {
      if (out.sessions[k].id === out.activeSessionId) { found = true; break }
    }
    if (!found) out.activeSessionId = out.sessions.length > 0 ? out.sessions[0].id : null

    return out
  }

  // Serialize sessions for localStorage — explicit field list so transient
  // properties never leak into storage.
  function serializeForPersist (sessions, activeSessionId) {
    var list = []
    for (var i = 0; i < sessions.length; i++) {
      var s = sessions[i]
      list.push({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        model: s.model,
        totalTokens: s.totalTokens || 0,
        promptTokens: s.promptTokens || 0,
        completionTokens: s.completionTokens || 0,
        costRub: s.costRub || 0,
        messages: s.messages
      })
    }
    return { sessions: list, activeSessionId: activeSessionId || null }
  }

  // Auto-title: derive a short readable title from the first user message.
  // Returns null if the text is unusable (empty/whitespace).
  function titleFromFirstMessage (text) {
    var t = String(text || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '')
    if (!t) return null
    if (t.length > 40) t = t.slice(0, 39).replace(/\s+\S*$/, '') + '\u2026'
    return t
  }

  // Default titles that auto-titling is allowed to overwrite.
  function isDefaultTitle (title) {
    return title === 'Session' || /^Chat \d+$/.test(String(title || ''))
  }

  var api = {
    createSession: createSession,
    migratePersisted: migratePersisted,
    serializeForPersist: serializeForPersist,
    titleFromFirstMessage: titleFromFirstMessage,
    isDefaultTitle: isDefaultTitle
  }

  if (typeof window !== 'undefined') window.PURE_SESSION_STORE = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})()
