/**
 * Serialize a JS value as an ExtendScript literal (inline in a script string),
 * avoiding the need for JSON.parse on the ExtendScript side.
 *
 * Pure, side-effect-free. Loaded as a browser global (window.PURE_ES) and as a
 * Node module (require) so it can be unit-tested. Single source of truth used by
 * hostBridge.js.
 */
;(function (root, factory) {
  var api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.PURE_ES = api
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  function toESLiteral (val) {
    if (val === null || val === undefined) return 'null'
    if (typeof val === 'string') return JSON.stringify(val)
    if (typeof val === 'number') return String(val)
    if (typeof val === 'boolean') return val ? 'true' : 'false'
    if (Array.isArray(val)) {
      var items = []
      for (var i = 0; i < val.length; i++) items.push(toESLiteral(val[i]))
      return '[' + items.join(',') + ']'
    }
    if (typeof val === 'object') {
      var parts = []
      for (var k in val) {
        if (val.hasOwnProperty(k)) {
          parts.push(JSON.stringify(k) + ':' + toESLiteral(val[k]))
        }
      }
      return '{' + parts.join(',') + '}'
    }
    return String(val)
  }

  return { toESLiteral: toESLiteral }
})
