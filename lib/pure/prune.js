/**
 * Conversation token estimation + smart pruning.
 *
 * Pure, side-effect-free. Loaded as a browser global (window.PURE_PRUNE) and
 * as a Node module (require) so it can be unit-tested. Single source of truth
 * used by main.js.
 *
 * Token estimation: chars/4 approximates ASCII well but badly underestimates
 * Cyrillic (GLM/BPE tokenizers spend ~1 token per Cyrillic char), so non-ASCII
 * chars count at full weight.
 *
 * Pruning strategy (when over budget):
 *   Phase 1 — truncate OLD tool results (outside the protected tail) to
 *             TOOL_RESULT_CAP chars. A comp summary from 40 turns ago rarely
 *             matters verbatim, but the fact it happened often does.
 *   Phase 2 — FIFO-drop oldest messages, never splitting an assistant
 *             tool_calls message from its tool results, keeping at least the
 *             last PROTECT_RECENT messages.
 *   Cleanup — never let the conversation start with orphaned tool results.
 */
;(function (root, factory) {
  var api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.PURE_PRUNE = api
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  var PROTECT_RECENT = 20
  var TOOL_RESULT_CAP = 400

  function estimateStringTokens (s) {
    if (!s) return 0
    var ascii = 0
    var nonAscii = 0
    for (var i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) < 128) ascii++
      else nonAscii++
    }
    return Math.ceil(ascii / 4) + nonAscii
  }

  function estimateTokens (messages) {
    var total = 0
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i]
      if (m.content) total += estimateStringTokens(m.content)
      if (m.tool_calls) {
        for (var t = 0; t < m.tool_calls.length; t++) {
          var tc = m.tool_calls[t]
          total += estimateStringTokens(tc.function.name || '')
          total += estimateStringTokens(tc.function.arguments || '')
        }
      }
      total += 4 // per-message structural overhead (role, separators)
    }
    return total
  }

  function pruneConversation (messages, maxTokens) {
    if (estimateTokens(messages) <= maxTokens) return messages
    var pruned = messages.slice()
    var protectFrom = Math.max(0, pruned.length - PROTECT_RECENT)

    // Phase 1: truncate OLD tool results in place (cheapest tokens first).
    for (var i = 0; i < protectFrom; i++) {
      var m = pruned[i]
      if (m && m.role === 'tool' && typeof m.content === 'string' && m.content.length > TOOL_RESULT_CAP) {
        pruned[i] = {
          role: 'tool',
          tool_call_id: m.tool_call_id,
          content: m.content.slice(0, TOOL_RESULT_CAP) + ' ...[truncated ' + (m.content.length - TOOL_RESULT_CAP) + ' chars]'
        }
      }
    }

    // Phase 2: FIFO-drop oldest, keeping the protected tail and the
    // assistant-tool_calls ↔ tool-results pairing.
    var minKeep = Math.max(2, Math.min(pruned.length, PROTECT_RECENT))
    while (estimateTokens(pruned) > maxTokens && pruned.length > minKeep) {
      var removed = pruned.shift()
      if (removed && removed.tool_calls && removed.tool_calls.length > 0) {
        while (pruned.length > minKeep && pruned[0] && pruned[0].role === 'tool') {
          pruned.shift()
        }
      }
    }
    // Never start the conversation with orphaned tool results.
    while (pruned.length > 0 && pruned[0] && pruned[0].role === 'tool') {
      pruned.shift()
    }
    return pruned
  }

  return {
    estimateStringTokens: estimateStringTokens,
    estimateTokens: estimateTokens,
    pruneConversation: pruneConversation,
    PROTECT_RECENT: PROTECT_RECENT,
    TOOL_RESULT_CAP: TOOL_RESULT_CAP
  }
})
