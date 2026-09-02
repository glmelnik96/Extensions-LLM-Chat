/**
 * Scene diff — compare two comp snapshots (host `getDetailedCompSummary`
 * with `fingerprint:true`) taken before and after an agent run, and describe
 * what ACTUALLY changed in the composition.
 *
 * Why: the agent's final answer used to be accepted on its word. Six bug-hunt
 * rounds showed the worst failures are confident reports of work that never
 * happened (or happened on the wrong layer). The diff is ground truth: the
 * panel shows it under every mutating run, and the loop hands it to the
 * model in the VERIFY turn before the final answer is accepted.
 *
 * Pure, side-effect-free. Loaded as a browser global (window.PURE_SCENE_DIFF)
 * and as a Node module (require) so it can be unit-tested.
 */
;(function (root, factory) {
  var api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.PURE_SCENE_DIFF = api
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  var TRANSFORM_KEYS = ['anchorPoint', 'position', 'scale', 'rotation', 'opacity', 'xRotation', 'yRotation']
  var ANIM_LABELS = {
    anchorPoint: 'anchor point', position: 'position', scale: 'scale', rotation: 'rotation',
    opacity: 'opacity', sourceText: 'source text', timeRemap: 'time remap'
  }

  function fmtNum (v) {
    if (typeof v === 'number') return String(Math.round(v * 100) / 100)
    if (Array.isArray(v)) {
      var parts = []
      for (var i = 0; i < v.length; i++) parts.push(fmtNum(v[i]))
      return '[' + parts.join(',') + ']'
    }
    return String(v)
  }

  function sameValue (a, b) {
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.005
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false
      for (var i = 0; i < a.length; i++) if (!sameValue(a[i], b[i])) return false
      return true
    }
    return String(a) === String(b)
  }

  function fmtTime (t) { return (Math.round(Number(t) * 100) / 100).toFixed(2) }

  function keyRangeText (k) {
    return k.numKeys + ' key' + (k.numKeys === 1 ? '' : 's') + ', ' + fmtTime(k.from) + '–' + fmtTime(k.to) + 's'
  }

  function snippetText (s) {
    var t = String(s || '').replace(/\s+/g, ' ')
    return t.length > 60 ? t.slice(0, 60) + '…' : t
  }

  function usable (snap) {
    return !!(snap && snap.ok === true && Array.isArray(snap.layers))
  }

  function indexLayers (snap) {
    var map = {}
    for (var i = 0; i < snap.layers.length; i++) {
      var l = snap.layers[i]
      if (l && typeof l.id === 'number') map[l.id] = l
    }
    return map
  }

  function exprMap (layer) {
    var m = {}
    var list = (layer && Array.isArray(layer.expressions)) ? layer.expressions : []
    for (var i = 0; i < list.length; i++) if (list[i] && list[i].path) m[list[i].path] = list[i]
    return m
  }

  function effectCounts (layer) {
    var m = {}
    var list = (layer && Array.isArray(layer.effects)) ? layer.effects : []
    for (var i = 0; i < list.length; i++) {
      var name = list[i] && list[i].name ? String(list[i].name) : '?'
      if (!m[name]) m[name] = []
      m[name].push(list[i].sig || '')
    }
    return m
  }

  /** Describe the differences between one layer's before/after records. */
  function diffLayer (b, a) {
    var out = []
    var k, i
    if (b.name !== a.name) out.push('renamed "' + b.name + '" → "' + a.name + '"')
    if (b.enabled !== undefined && a.enabled !== undefined && b.enabled !== a.enabled) {
      out.push('video switch: ' + (b.enabled ? 'on' : 'off') + ' → ' + (a.enabled ? 'on' : 'off'))
    }
    if (!!b.locked !== !!a.locked) out.push('locked: ' + !!b.locked + ' → ' + !!a.locked)
    if (!!b.solo !== !!a.solo) out.push('solo: ' + (a.solo ? 'on' : 'off'))
    if (!!b.shy !== !!a.shy) out.push('shy: ' + (a.shy ? 'on' : 'off'))
    if (!!b.threeDLayer !== !!a.threeDLayer) out.push('3D: ' + (a.threeDLayer ? 'on' : 'off'))
    var bp = b.parentIndex === null || b.parentIndex === undefined ? '' : String(b.parentName || ('#' + b.parentIndex))
    var ap = a.parentIndex === null || a.parentIndex === undefined ? '' : String(a.parentName || ('#' + a.parentIndex))
    if (bp !== ap) out.push('parent: ' + (bp ? '"' + bp + '"' : '(none)') + ' → ' + (ap ? '"' + ap + '"' : '(none)'))
    if (typeof b.inPoint === 'number' && typeof a.inPoint === 'number' &&
        (!sameValue(b.inPoint, a.inPoint) || !sameValue(b.outPoint, a.outPoint))) {
      out.push('in/out: ' + fmtTime(b.inPoint) + '–' + fmtTime(b.outPoint) + 's → ' + fmtTime(a.inPoint) + '–' + fmtTime(a.outPoint) + 's')
    } else if (typeof b.startTime === 'number' && typeof a.startTime === 'number' && !sameValue(b.startTime, a.startTime)) {
      out.push('start time: ' + fmtTime(b.startTime) + 's → ' + fmtTime(a.startTime) + 's')
    }
    // Transform values.
    var bt = b.transform || {}
    var at = a.transform || {}
    for (i = 0; i < TRANSFORM_KEYS.length; i++) {
      k = TRANSFORM_KEYS[i]
      if (bt[k] === undefined && at[k] === undefined) continue
      if (bt[k] === undefined || at[k] === undefined || !sameValue(bt[k], at[k])) {
        out.push((ANIM_LABELS[k] || k) + ': ' + fmtNum(bt[k]) + ' → ' + fmtNum(at[k]))
      }
    }
    // Keyframe ranges.
    var ba = b.animated || {}
    var aa = a.animated || {}
    var animKeys = {}
    for (k in ba) if (ba.hasOwnProperty(k)) animKeys[k] = 1
    for (k in aa) if (aa.hasOwnProperty(k)) animKeys[k] = 1
    for (k in animKeys) {
      if (!animKeys.hasOwnProperty(k)) continue
      var label = ANIM_LABELS[k] || k
      if (!ba[k] && aa[k]) out.push(label + ': keyframes added (' + keyRangeText(aa[k]) + ')')
      else if (ba[k] && !aa[k]) out.push(label + ': keyframes removed (had ' + ba[k].numKeys + ')')
      else if (ba[k] && aa[k]) {
        var rangeChanged = ba[k].numKeys !== aa[k].numKeys || !sameValue(ba[k].from, aa[k].from) || !sameValue(ba[k].to, aa[k].to)
        if (rangeChanged) out.push(label + ': keyframes changed (' + ba[k].numKeys + ' → ' + keyRangeText(aa[k]) + ')')
        else if (ba[k].sig !== undefined && aa[k].sig !== undefined && ba[k].sig !== aa[k].sig) out.push(label + ': keyframe values edited (' + keyRangeText(aa[k]) + ')')
      }
    }
    // Expressions.
    var be = exprMap(b)
    var ae = exprMap(a)
    var paths = {}
    for (k in be) if (be.hasOwnProperty(k)) paths[k] = 1
    for (k in ae) if (ae.hasOwnProperty(k)) paths[k] = 1
    for (k in paths) {
      if (!paths.hasOwnProperty(k)) continue
      if (!be[k] && ae[k]) out.push(k + ': expression set ("' + snippetText(ae[k].snippet) + '")' + (ae[k].error ? ' — ERROR: ' + snippetText(ae[k].error) : ''))
      else if (be[k] && !ae[k]) out.push(k + ': expression removed')
      else if (be[k] && ae[k]) {
        var changed = (be[k].sig !== undefined && ae[k].sig !== undefined) ? be[k].sig !== ae[k].sig : be[k].snippet !== ae[k].snippet
        if (changed) out.push(k + ': expression changed ("' + snippetText(ae[k].snippet) + '")' + (ae[k].error ? ' — ERROR: ' + snippetText(ae[k].error) : ''))
        else if (!be[k].error && ae[k].error) out.push(k + ': expression now has an ERROR: ' + snippetText(ae[k].error))
        else if (be[k].error && !ae[k].error) out.push(k + ': expression error fixed')
      }
    }
    // Effects (by display name; sig catches value edits).
    var bf = effectCounts(b)
    var af = effectCounts(a)
    var names = {}
    for (k in bf) if (bf.hasOwnProperty(k)) names[k] = 1
    for (k in af) if (af.hasOwnProperty(k)) names[k] = 1
    for (k in names) {
      if (!names.hasOwnProperty(k)) continue
      var bn = bf[k] ? bf[k].length : 0
      var an = af[k] ? af[k].length : 0
      if (an > bn) out.push('effect added: "' + k + '"' + (an - bn > 1 ? ' ×' + (an - bn) : ''))
      else if (an < bn) out.push('effect removed: "' + k + '"' + (bn - an > 1 ? ' ×' + (bn - an) : ''))
      else if (bf[k].join('|') !== af[k].join('|')) out.push('effect "' + k + '" settings changed')
    }
    // Text, time remap, masks.
    var bText = b.textSig !== undefined ? b.textSig : b.text
    var aText = a.textSig !== undefined ? a.textSig : a.text
    if ((bText !== undefined || aText !== undefined) && bText !== aText) {
      out.push('text: "' + snippetText(b.text) + '" → "' + snippetText(a.text) + '"')
    }
    if (!!b.timeRemapEnabled !== !!a.timeRemapEnabled) out.push('time remap: ' + (a.timeRemapEnabled ? 'enabled' : 'disabled'))
    if ((b.numMasks || 0) !== (a.numMasks || 0)) out.push('masks: ' + (b.numMasks || 0) + ' → ' + (a.numMasks || 0))
    return out
  }

  /**
   * Diff two snapshots.
   * @returns {{ok:boolean, reason?:string, compSwitched:boolean, compName:string,
   *   added:Array, removed:Array, changed:Array, moved:Array, count:number}}
   */
  function diffScenes (before, after) {
    var res = { ok: false, compSwitched: false, compName: '', added: [], removed: [], changed: [], moved: [], count: 0 }
    if (!usable(before) || !usable(after)) {
      res.reason = !usable(before) ? 'no usable snapshot before the run' : 'no usable snapshot after the run'
      return res
    }
    res.ok = true
    res.compName = String(after.compName || '')
    if (before.compId !== undefined && after.compId !== undefined && before.compId !== after.compId) {
      res.compSwitched = true
      res.beforeCompName = String(before.compName || '')
      res.count = 1
      return res
    }
    var bmap = indexLayers(before)
    var amap = indexLayers(after)
    var id
    for (id in amap) {
      if (!amap.hasOwnProperty(id)) continue
      if (!bmap[id]) res.added.push({ id: amap[id].id, name: amap[id].name, type: amap[id].type, hidden: amap[id].enabled === false })
    }
    for (id in bmap) {
      if (!bmap.hasOwnProperty(id)) continue
      if (!amap[id]) { res.removed.push({ id: bmap[id].id, name: bmap[id].name, type: bmap[id].type }); continue }
      var changes = diffLayer(bmap[id], amap[id])
      // `hidden`: the layer renders nothing after the run — a change there is
      // invisible work, which the verify turn must call out.
      if (changes.length) res.changed.push({ id: bmap[id].id, name: amap[id].name, changes: changes, hidden: amap[id].enabled === false })
      else if (!res.added.length && typeof bmap[id].index === 'number' && typeof amap[id].index === 'number' && bmap[id].index !== amap[id].index) {
        res.moved.push({ id: bmap[id].id, name: amap[id].name, from: bmap[id].index, to: amap[id].index })
      }
    }
    // Pure reorders only count when nothing was added/removed (insertions
    // shift every index below them, which is not a user-visible reorder).
    if (res.removed.length) res.moved = []
    res.count = res.added.length + res.removed.length + res.changed.length + (res.moved.length ? 1 : 0)
    return res
  }

  /**
   * Human/model-readable text for a diff. opts.maxLayers caps listed layers
   * (default 12), opts.maxChars caps the whole text (default 2500).
   */
  function formatDiff (diff, opts) {
    var o = opts || {}
    var maxLayers = o.maxLayers > 0 ? o.maxLayers : 12
    var maxChars = o.maxChars > 0 ? o.maxChars : 2500
    if (!diff || !diff.ok) return 'Scene diff unavailable' + (diff && diff.reason ? ' (' + diff.reason + ')' : '') + '.'
    if (diff.compSwitched) {
      return 'Active composition changed during the run: "' + diff.beforeCompName + '" → "' + diff.compName + '" — per-layer diff skipped.'
    }
    if (diff.count === 0) return 'No changes detected in composition "' + diff.compName + '" — its state before and after the run is identical.'
    var lines = []
    lines.push('Actual changes in "' + diff.compName + '": ' + diff.added.length + ' added, ' + diff.removed.length + ' removed, ' + diff.changed.length + ' changed' + (diff.moved.length ? ', ' + diff.moved.length + ' reordered' : '') + '.')
    var listed = 0
    var i
    for (i = 0; i < diff.added.length && listed < maxLayers; i++, listed++) lines.push('+ "' + diff.added[i].name + '" (' + diff.added[i].type + ')' + (diff.added[i].hidden ? ' [video switch OFF — not visible]' : ''))
    for (i = 0; i < diff.removed.length && listed < maxLayers; i++, listed++) lines.push('- "' + diff.removed[i].name + '" (' + diff.removed[i].type + ')')
    for (i = 0; i < diff.changed.length && listed < maxLayers; i++, listed++) lines.push('~ "' + diff.changed[i].name + '"' + (diff.changed[i].hidden ? ' [video switch OFF — not visible]' : '') + ': ' + diff.changed[i].changes.join('; '))
    var moves = []
    for (i = 0; i < diff.moved.length && i < 3; i++) moves.push('"' + diff.moved[i].name + '" ' + diff.moved[i].from + ' → ' + diff.moved[i].to)
    if (moves.length) lines.push('⇅ order: ' + moves.join(', ') + (diff.moved.length > 3 ? ' (+' + (diff.moved.length - 3) + ' more)' : ''))
    var total = diff.added.length + diff.removed.length + diff.changed.length
    if (total > listed) lines.push('… +' + (total - listed) + ' more layer(s) not listed')
    var text = lines.join('\n')
    if (text.length > maxChars) text = text.slice(0, maxChars - 1) + '…'
    return text
  }

  return { diffScenes: diffScenes, formatDiff: formatDiff, diffLayer: diffLayer }
})
