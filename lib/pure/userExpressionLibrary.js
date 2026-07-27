/**
 * User expression library (pure, no DOM) — personal snippets the user saves
 * from chat ("сохрани это выражение"). Stored in localStorage; merged into
 * search_expression_library results alongside the curated PURE_EXPR_LIB set.
 * Browser global window.PURE_USER_EXPR_LIB + Node module for tests.
 *
 * Snippet shape mirrors the curated library:
 *   { id, name, keywords[], target, expression, notes }
 * (no `requires` — user snippets are saved as-is; effect prerequisites, if
 * any, belong in `notes`).
 */
;(function (root, factory) {
  var api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.PURE_USER_EXPR_LIB = api
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  var STORAGE_KEY = 'ae-motion-agent-user-expressions'

  function trim (s) {
    return String(s == null ? '' : s).replace(/^\s+|\s+$/g, '')
  }

  // Accepts an array of strings or a comma/semicolon-separated string.
  // Returns lowercase, deduped, non-empty keywords (max 12, 40 chars each).
  function normalizeKeywords (input) {
    var parts
    if (Object.prototype.toString.call(input) === '[object Array]') {
      parts = input
    } else {
      parts = String(input == null ? '' : input).split(/[,;]+/)
    }
    var out = []
    var seen = {}
    for (var i = 0; i < parts.length && out.length < 12; i++) {
      var kw = trim(parts[i]).toLowerCase().slice(0, 40)
      if (kw && !seen[kw]) {
        seen[kw] = true
        out.push(kw)
      }
    }
    return out
  }

  function isValidSnippet (s) {
    return !!(s && typeof s === 'object' &&
      typeof s.id === 'string' && s.id &&
      typeof s.name === 'string' && s.name &&
      typeof s.expression === 'string' && s.expression)
  }

  // Parse a persisted JSON string (or null). Any invalid input → empty list.
  function loadSnippets (raw) {
    if (!raw) return []
    var data
    try { data = JSON.parse(raw) } catch (_) { return [] }
    var list = data && data.snippets
    if (Object.prototype.toString.call(list) !== '[object Array]') return []
    var out = []
    for (var i = 0; i < list.length; i++) {
      if (isValidSnippet(list[i])) {
        out.push({
          id: list[i].id,
          name: String(list[i].name).slice(0, 80),
          keywords: normalizeKeywords(list[i].keywords),
          target: typeof list[i].target === 'string' ? list[i].target : '',
          expression: String(list[i].expression),
          notes: typeof list[i].notes === 'string' ? list[i].notes : ''
        })
      }
    }
    return out
  }

  function serialize (snippets) {
    return JSON.stringify({ snippets: snippets })
  }

  /**
   * Add a snippet. fields = { name, expression, keywords?, target?, notes? }.
   * Returns the new array, or null if name/expression is empty.
   */
  function addSnippet (snippets, fields) {
    fields = fields || {}
    var name = trim(fields.name).slice(0, 80)
    var expression = trim(fields.expression)
    if (!name || !expression) return null
    var next = snippets.slice()
    next.push({
      id: 'ux_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      name: name,
      keywords: normalizeKeywords(fields.keywords),
      target: trim(fields.target).slice(0, 120),
      expression: expression,
      notes: trim(fields.notes).slice(0, 500)
    })
    return next
  }

  // Returns the new array, or null if the id is unknown.
  function removeSnippet (snippets, id) {
    var next = []
    var found = false
    for (var i = 0; i < snippets.length; i++) {
      if (snippets[i].id === id) { found = true } else { next.push(snippets[i]) }
    }
    return found ? next : null
  }

  return {
    STORAGE_KEY: STORAGE_KEY,
    loadSnippets: loadSnippets,
    serialize: serialize,
    addSnippet: addSnippet,
    removeSnippet: removeSnippet,
    normalizeKeywords: normalizeKeywords
  }
})
