/**
 * Change journal (2026-09-03) — what the agent ITSELF changed earlier in
 * this comp, compact enough to ride along on every later request.
 *
 * Why: the model's own tool calls and results are in the chat history, but
 * they are raw (full JSON, pruned first when the conversation grows) and the
 * scene-diff note is UI-only. Asked "ускорь" after building an orbit rig,
 * the model tended to build a SECOND rig instead of editing the period on
 * the null it had created. The journal names the layers it made, the
 * expressions/keys it wrote and the recipe parameters it chose, so a
 * follow-up ("faster", "slower", "bigger", "again", "undo") has one place to
 * look — and the loop inserts it as a [SYSTEM] message right before the new
 * request.
 *
 * Pure, side-effect-free. Loaded as a browser global
 * (window.PURE_CHANGE_JOURNAL) and as a Node module (require) so the eval
 * corpus runner can build the same entries the panel does.
 */
;(function (root, factory) {
  var api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.PURE_CHANGE_JOURNAL = api
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict'

  // Tools that never change the comp. Mirrors READ_ONLY_TOOLS in
  // agentToolLoop.js; callers may pass their own map instead.
  var DEFAULT_READ_ONLY = {
    get_detailed_comp_summary: 1, get_host_context: 1, get_property_value: 1, get_expression: 1,
    get_keyframes: 1, probe_motion: 1, get_layer_properties: 1, get_effect_properties: 1,
    search_layers: 1, search_expression_library: 1, list_fonts: 1, list_effects: 1,
    validate_expression: 1, get_selected_layers: 1, get_project_items: 1, get_render_queue: 1
  }

  var MAX_REQUEST = 120
  var MAX_DIFF = 320
  var MAX_EXPR = 70
  var MAX_CALLS_PER_ENTRY = 10

  function str (v) { return (v === undefined || v === null) ? '' : String(v) }
  function trim (s, n) { s = str(s).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''); return s.length > n ? s.slice(0, n - 1) + '…' : s }
  function num (v) { return (typeof v === 'number' && isFinite(v)) ? (Math.round(v * 100) / 100) : v }
  function fmtVal (v) {
    if (v === undefined || v === null) return ''
    if (typeof v === 'number') return String(num(v))
    if (typeof v === 'string') return '"' + trim(v, 40) + '"'
    if (typeof v === 'boolean') return v ? 'on' : 'off'
    if (Object.prototype.toString.call(v) === '[object Array]') {
      var out = []
      for (var i = 0; i < v.length && i < 4; i++) out.push(fmtVal(v[i]))
      return '[' + out.join(', ') + (v.length > 4 ? ', …' : '') + ']'
    }
    try { return trim(JSON.stringify(v), 60) } catch (e) { return '' }
  }

  /** "id 14" / "ids 14, 15" / "index 3" / "name" — whichever the call carried. */
  function layerRef (args) {
    if (!args) return ''
    if (args.layer_id !== undefined) return 'id ' + args.layer_id
    if (args.child_layer_id !== undefined) return 'id ' + args.child_layer_id
    if (args.layer_ids && args.layer_ids.length) return 'ids ' + args.layer_ids.slice(0, 6).join(', ') + (args.layer_ids.length > 6 ? '…' : '')
    if (args.layer_index !== undefined) return 'index ' + args.layer_index
    if (args.layer_indices && args.layer_indices.length) return 'indices ' + args.layer_indices.slice(0, 6).join(', ')
    if (args.layer_name) return '"' + trim(args.layer_name, 40) + '"'
    if (args.name) return '"' + trim(args.name, 40) + '"'
    return ''
  }

  function keyRange (keys) {
    if (!keys || !keys.length) return ''
    var lo = Infinity; var hi = -Infinity
    for (var i = 0; i < keys.length; i++) {
      var t = keys[i] && keys[i].time
      if (typeof t === 'number') { if (t < lo) lo = t; if (t > hi) hi = t }
    }
    if (lo === Infinity) return keys.length + ' keys'
    return keys.length + ' key' + (keys.length === 1 ? '' : 's') + ' at ' + num(lo) + (hi !== lo ? '–' + num(hi) : '') + 's'
  }

  var RECIPE_PARAMS = ['period', 'radius', 'amount', 'frequency', 'rotation', 'lag', 'delay', 'duration', 'stagger', 'from', 'direction', 'distance', 'overshoot']

  function recipeSummary (args, result) {
    var recipe = str(args && args.recipe) || 'recipe'
    var applied = (result && result.applied) || []
    var parts = []
    for (var i = 0; i < applied.length && i < 6; i++) {
      var a = applied[i] || {}
      var s = '"' + trim(a.layer || '?', 40) + '"' + (a.layerId !== undefined ? ' (id ' + a.layerId + ')' : '')
      if (a.orbitNull) s += ' parented to new null "' + trim(a.orbitNull, 40) + '"' + (a.around ? ' around "' + trim(a.around, 40) + '"' : '') + ' — Rotation expression on the null'
      if (a.leader) s += ' follows "' + trim(a.leader, 40) + '" (Position expression)'
      var ps = []
      for (var p = 0; p < RECIPE_PARAMS.length; p++) {
        var k = RECIPE_PARAMS[p]
        if (a[k] !== undefined && a[k] !== null && typeof a[k] !== 'object') ps.push(k + ' ' + fmtVal(a[k]).replace(/^"|"$/g, ''))
      }
      if (ps.length) s += ' [' + ps.join(', ') + ']'
      parts.push(s)
    }
    if (!parts.length) {
      var ref = layerRef(args)
      var ops = []
      var o = (args && args.opts) || args || {}
      for (var q = 0; q < RECIPE_PARAMS.length; q++) if (o[RECIPE_PARAMS[q]] !== undefined) ops.push(RECIPE_PARAMS[q] + ' ' + fmtVal(o[RECIPE_PARAMS[q]]).replace(/^"|"$/g, ''))
      parts.push((ref || 'layers') + (ops.length ? ' [' + ops.join(', ') + ']' : ''))
    }
    return 'apply_motion_recipe ' + recipe + ' → ' + parts.join('; ')
  }

  /**
   * One-line summary of a mutating call, '' for read-only / failed calls.
   * `entry` = loop log entry { name, args, status, result }.
   */
  function summarizeCall (entry, readOnlyTools) {
    if (!entry || !entry.name) return ''
    var ro = readOnlyTools || DEFAULT_READ_ONLY
    if (ro[entry.name]) return ''
    if (entry.status && entry.status !== 'ok') return ''
    var name = entry.name
    var args = entry.args || {}
    var result = entry.result || {}
    var ref = layerRef(args)
    var path = args.property_path ? ' ' + trim(args.property_path, 50) : ''
    var i, out

    if (name === 'batch_call') {
      var items = args.calls || []
      var lines = []
      for (i = 0; i < items.length && lines.length < 6; i++) {
        var it = items[i] || {}
        var sub = summarizeCall({ name: it.tool, args: it.args || {}, status: 'ok', result: {} }, ro)
        if (sub) lines.push(sub)
      }
      if (!lines.length) return ''
      return 'batch_call: ' + lines.join('; ') + (items.length > 6 ? '; …' : '')
    }
    if (name === 'apply_motion_recipe') return recipeSummary(args, result)
    if (name === 'set_keyframes_batch') {
      var targets = args.targets || []
      out = []
      for (i = 0; i < targets.length && i < 6; i++) {
        var tg = targets[i] || {}
        out.push(layerRef(tg) + (tg.property_path ? ' ' + trim(tg.property_path, 50) : '') + ': ' + keyRange(tg.keyframes))
      }
      return 'set_keyframes_batch ' + out.join('; ') + (targets.length > 6 ? '; …' : '')
    }
    if (name === 'add_keyframes' || name === 'set_keyframes') return name + ' ' + ref + path + ': ' + keyRange(args.keyframes)
    if (name === 'apply_expression') return 'apply_expression ' + ref + path + ': "' + trim(args.expression, MAX_EXPR) + '"'
    if (name === 'apply_expression_batch') {
      var tt = args.targets || []
      out = []
      for (i = 0; i < tt.length && i < 6; i++) out.push(layerRef(tt[i]) + (tt[i].property_path ? ' ' + trim(tt[i].property_path, 50) : '') + ': "' + trim(tt[i].expression, MAX_EXPR) + '"')
      return 'apply_expression_batch ' + out.join('; ')
    }
    if (name === 'set_property_value') return 'set_property_value ' + ref + path + ' = ' + fmtVal(args.value)
    if (name === 'set_layer_parent') {
      var parent = (args.parent_layer_id !== undefined) ? 'id ' + args.parent_layer_id : (args.parent_layer_index !== undefined ? 'index ' + args.parent_layer_index : (args.parent_name ? '"' + args.parent_name + '"' : 'none'))
      return 'set_layer_parent ' + ref + ' → parent ' + parent
    }
    if (name === 'create_layer') {
      var made = (result.layerId !== undefined ? result.layerId : (result.layer_id !== undefined ? result.layer_id : (result.id !== undefined ? result.id : undefined)))
      return 'create_layer ' + str(args.type || args.layer_type || '') + (args.name ? ' "' + trim(args.name, 40) + '"' : '') + (made !== undefined ? ' (id ' + made + ')' : '')
    }
    if (name === 'set_layer_timing') {
      var tm = []
      if (args.in_point !== undefined) tm.push('in ' + num(args.in_point) + 's')
      if (args.out_point !== undefined) tm.push('out ' + num(args.out_point) + 's')
      if (args.start_time !== undefined) tm.push('start ' + num(args.start_time) + 's')
      return 'set_layer_timing ' + ref + ' ' + tm.join(', ')
    }
    if (name === 'delete_layer' || name === 'delete_layers') return name + ' ' + ref
    if (name === 'rename_layer') return 'rename_layer ' + ref + ' → "' + trim(args.new_name || args.name, 40) + '"'
    // Generic: tool name + the few scalar args that identify the target.
    var extra = []
    var keys = ['effect_name', 'preset', 'text', 'value', 'new_name', 'mode']
    for (i = 0; i < keys.length; i++) if (args[keys[i]] !== undefined) extra.push(keys[i] + ' ' + fmtVal(args[keys[i]]))
    return name + (ref ? ' ' + ref : '') + path + (extra.length ? ' (' + extra.slice(0, 3).join(', ') + ')' : '')
  }

  /**
   * Build one journal entry for a finished run.
   * @param {Object} run - { request, plan, outcome, toolCallLog, diff, diffText, readOnlyTools, compName, at }
   * @returns {Object|null} entry, or null when the run changed nothing.
   */
  function buildEntry (run) {
    run = run || {}
    var log = run.toolCallLog || []
    var calls = []
    for (var i = 0; i < log.length; i++) {
      var s = summarizeCall(log[i], run.readOnlyTools)
      if (s) calls.push(s)
    }
    var diff = run.diff || null
    var added = []
    if (diff && diff.added) {
      for (var a = 0; a < diff.added.length && a < 8; a++) added.push({ id: diff.added[a].id, name: diff.added[a].name, type: diff.added[a].type })
    }
    var diffText = str(run.diffText)
    var changedNothing = diff ? (diff.ok && !diff.compSwitched && diff.count === 0) : /No changes detected/.test(diffText)
    if (!calls.length && (changedNothing || !diffText)) return null
    var comp = str(run.compName || (diff && diff.compName) || '')
    if (calls.length > MAX_CALLS_PER_ENTRY) calls = calls.slice(0, MAX_CALLS_PER_ENTRY - 1).concat(['… +' + (calls.length - MAX_CALLS_PER_ENTRY + 1) + ' more calls'])
    return {
      at: (typeof run.at === 'number') ? run.at : Date.now(),
      comp: comp,
      request: trim(run.request, MAX_REQUEST),
      calls: calls,
      added: added,
      diff: trim(diffText.replace(/^Actual changes in "[^"]*":\s*/, ''), MAX_DIFF)
    }
  }

  /**
   * The [SYSTEM] journal message for the next request, '' when there is
   * nothing relevant. opts.compName filters to entries from that comp
   * (entries with no comp name are always kept).
   */
  function formatJournal (entries, opts) {
    opts = opts || {}
    var maxEntries = opts.maxEntries || 8
    var maxChars = opts.maxChars || 1800
    var compName = str(opts.compName)
    var list = []
    for (var i = 0; i < (entries || []).length; i++) {
      var e = entries[i]
      if (!e || !e.calls) continue
      if (compName && e.comp && e.comp !== compName) continue
      list.push(e)
    }
    if (!list.length) return ''
    if (list.length > maxEntries) list = list.slice(list.length - maxEntries)
    var head = '[SYSTEM] JOURNAL — what YOU changed earlier in this comp' + (compName ? ' ("' + compName + '")' : '') + ', oldest first. ' +
      'A follow-up ("faster", "slower", "bigger", "smaller", "again", "the same for X", "undo that", "a bit more") refers to THESE changes: ' +
      'edit the named layers, expressions and keys in place (read them first with get_expression / get_keyframes / probe_motion) — ' +
      'never build a second rig, duplicate layers or re-apply a recipe on top of the old one. ' +
      'Orbit / pulse speed lives in the period inside the expression on the named null/layer; keyframed timing = retime those keys.\n'
    var lines = []
    for (var k = 0; k < list.length; k++) {
      var en = list[k]
      lines.push('#' + (k + 1) + ' request: «' + en.request + '»')
      for (var c = 0; c < en.calls.length; c++) lines.push('  - ' + en.calls[c])
      if (en.added && en.added.length) {
        var names = []
        for (var a = 0; a < en.added.length; a++) names.push('"' + en.added[a].name + '" (' + (en.added[a].type || 'layer') + ', id ' + en.added[a].id + ')')
        lines.push('  - layers you created: ' + names.join(', '))
      }
      if (en.diff) lines.push('  - actual changes: ' + en.diff)
    }
    var text = head + lines.join('\n')
    if (text.length > maxChars) {
      // Drop oldest entries first, then hard-cap.
      while (list.length > 1 && text.length > maxChars) {
        list.shift()
        text = formatJournal(list, { compName: compName, maxEntries: maxEntries, maxChars: Infinity })
      }
      if (text.length > maxChars) text = text.slice(0, maxChars - 1) + '…'
    }
    return text
  }

  return { buildEntry: buildEntry, formatJournal: formatJournal, summarizeCall: summarizeCall, DEFAULT_READ_ONLY: DEFAULT_READ_ONLY }
})
