/**
 * Pricing — pure functions to convert Cloud.ru token usage into ruble cost.
 *
 * CRITICAL: cost is computed per usage event with the model id and the split
 * prompt/completion token counts known at that moment. The session mixes the
 * user-selected chat model AND the vision model (MiniMax-M3) whose rates differ
 * by ~15x, so pricing a blended total-token counter with one rate is WRONG.
 *
 * IIFE pattern: exports to window.PURE_PRICING (browser) and works under
 * node:test via the same vm.runInContext loader other pure modules use.
 */
;(function () {
  'use strict'

  // ₽ per 1,000,000 tokens (Cloud.ru tariffs, update as prices change).
  var DEFAULT_PRICING = {
    'openai/gpt-oss-120b': { input: 15.86, output: 61 },
    'MiniMaxAI/MiniMax-M2.5': { input: 353.8, output: 475.8 },
    'zai-org/GLM-4.7': { input: 549, output: 793 },
    'moonshotai/Kimi-K2.6': { input: 175.68, output: 725.9 },
    'MiniMaxAI/MiniMax-M3': { input: 240.22, output: 1008.85 }
  }

  function toNum (v) {
    var n = Number(v)
    return (isFinite(n) && !isNaN(n)) ? Math.max(0, n) : 0
  }

  /**
   * Compute ruble cost for a single usage event.
   * @param {string} modelId
   * @param {number} promptTokens
   * @param {number} completionTokens
   * @param {Object} pricingTable  - map modelId -> {input, output} (₽/1M)
   * @returns {{rub: number, known: boolean}}
   */
  function costFor (modelId, promptTokens, completionTokens, pricingTable) {
    var table = pricingTable || DEFAULT_PRICING
    var rate = table && modelId ? table[modelId] : null
    if (!rate) return { rub: 0, known: false }
    var pt = toNum(promptTokens)
    var ct = toNum(completionTokens)
    var input = toNum(rate.input)
    var output = toNum(rate.output)
    var rub = (pt / 1e6) * input + (ct / 1e6) * output
    return { rub: rub, known: true }
  }

  /**
   * Format a ruble amount into a human string (ru-RU style, plain space + ₽).
   * @param {number} rub
   * @returns {string}
   */
  function formatRub (rub) {
    var n = toNum(rub)
    // toNum already clamps finite negatives to 0; non-finite/NaN → 0.
    // Explicit guard kept for clarity: negative raw input also → 0.
    if (n < 0) n = 0
    var str
    if (n === 0) {
      str = '0'
    } else if (n < 0.0001) {
      // Tiny but genuinely non-zero: avoid misleading "0 ₽".
      return '< 0.0001 ₽'
    } else if (n < 1) {
      // Small amounts: show 4 decimals so sub-ruble costs are visible.
      str = trimTrailingZeros(n.toFixed(4))
    } else if (n < 1000) {
      str = n.toFixed(2)
    } else {
      // Thousands separator (non-breaking-ish plain space groups).
      str = groupThousands(n.toFixed(2))
    }
    return str + ' ₽'
  }

  function trimTrailingZeros (s) {
    // "0.0420" -> "0.042", "0.0000" -> "0"; keep at least one non-empty result.
    if (s.indexOf('.') < 0) return s
    s = s.replace(/0+$/, '').replace(/\.$/, '')
    return s === '' || s === '-' ? '0' : s
  }

  function groupThousands (s) {
    var neg = s.charAt(0) === '-'
    if (neg) s = s.substring(1)
    var dot = s.indexOf('.')
    var intPart = dot < 0 ? s : s.substring(0, dot)
    var frac = dot < 0 ? '' : s.substring(dot)
    var out = ''
    var count = 0
    for (var i = intPart.length - 1; i >= 0; i--) {
      out = intPart.charAt(i) + out
      count++
      if (count % 3 === 0 && i > 0) out = ' ' + out
    }
    return (neg ? '-' : '') + out + frac
  }

  /**
   * Shallow-merge a user override table over defaults, per-model per-field.
   * Tolerates null/partial overrides.
   * @param {Object} defaults
   * @param {Object} override
   * @returns {Object} merged table
   */
  function mergePricing (defaults, override) {
    var base = defaults || {}
    var merged = {}
    var id
    for (id in base) {
      if (base.hasOwnProperty(id)) {
        merged[id] = { input: base[id].input, output: base[id].output }
      }
    }
    if (!override || typeof override !== 'object') return merged
    for (id in override) {
      if (!override.hasOwnProperty(id)) continue
      var ov = override[id]
      if (!ov || typeof ov !== 'object') continue
      var cur = merged[id] || {}
      merged[id] = {
        input: ov.input !== undefined && ov.input !== null ? ov.input : cur.input,
        output: ov.output !== undefined && ov.output !== null ? ov.output : cur.output
      }
    }
    return merged
  }

  // Export
  if (typeof window !== 'undefined') {
    window.PURE_PRICING = {
      DEFAULT_PRICING: DEFAULT_PRICING,
      costFor: costFor,
      formatRub: formatRub,
      mergePricing: mergePricing
    }
  }
})()
