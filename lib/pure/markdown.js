/**
 * Minimal markdown → HTML renderer for agent chat messages.
 *
 * Pure, side-effect-free. Loaded as a browser global (window.PURE_MARKDOWN) and
 * as a Node module (require) so the XSS surface can be unit-tested. Single source
 * of truth used by main.js.
 *
 * Security: the output is assigned via innerHTML in a CEP panel that runs with
 * --enable-nodejs, so an XSS here is an RCE surface. All angle brackets and
 * ampersands are escaped up front; attribute values (img alt/src) are escaped
 * and the img src scheme is allowlisted.
 */
;(function (root, factory) {
  var api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.PURE_MARKDOWN = api
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  // Escape characters that are dangerous inside a double-quoted HTML attribute.
  // Angle brackets/ampersands are already escaped globally before this runs, but
  // quotes are NOT — and an unescaped quote in alt text lets an attacker close
  // the attribute and inject an event handler (e.g. onerror=).
  function escapeAttr (s) {
    return String(s)
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
  }

  // Only allow image sources that cannot execute script. Everything else
  // (javascript:, vbscript:, unknown schemes) is rejected.
  function isSafeImgSrc (src) {
    var s = String(src).trim()
    if (/^https?:\/\//i.test(s)) return true
    if (/^file:\/\//i.test(s)) return true
    if (/^data:image\//i.test(s)) return true
    return false
  }

  function renderMarkdown (text) {
    if (!text) return ''
    var s = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    // Images — escape the alt attribute and allowlist the src scheme. An
    // unsafe/unknown scheme falls back to rendering the (escaped) alt text so
    // no <img> with an attacker-controlled src/handler is emitted.
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_, alt, src) {
      var safeAlt = escapeAttr(alt)
      if (!isSafeImgSrc(src)) return safeAlt
      var safeSrc = escapeAttr(src)
      return '<img class="md-preview-img" src="' + safeSrc + '" alt="' + safeAlt + '" />'
    })

    // Code blocks
    s = s.replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, code) {
      return '<pre class="md-code-block"><code>' + code.replace(/\n$/, '') + '</code></pre>'
    })

    // Inline code
    s = s.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')

    // Headers
    s = s.replace(/^### (.+)$/gm, '<strong class="md-h3">$1</strong>')
    s = s.replace(/^## (.+)$/gm, '<strong class="md-h2">$1</strong>')
    s = s.replace(/^# (.+)$/gm, '<strong class="md-h1">$1</strong>')

    // Bold and italic
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>')

    // Unordered list items
    s = s.replace(/^- (.+)$/gm, '<li>$1</li>')
    s = s.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')

    // Numbered list items
    s = s.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')

    // Paragraphs
    s = s.replace(/\n\n/g, '</p><p>')
    s = s.replace(/\n/g, '<br>')

    return '<p>' + s + '</p>'
  }

  return { renderMarkdown: renderMarkdown }
})
