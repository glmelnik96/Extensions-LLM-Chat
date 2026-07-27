/**
 * Host Bridge — wraps CSInterface.evalScript calls to ExtendScript.
 * Provides promise-based execution of host functions.
 */
(function () {
  'use strict'

  var hostScriptPath = null
  var hostScriptLoaded = false
  var hostScriptLoadPromise = null

  /**
   * Load the host script (index.jsx) once into ExtendScript engine.
   * Subsequent calls are no-ops. Returns a promise that resolves when ready.
   */
  function ensureHostScriptLoaded () {
    if (hostScriptLoaded) return Promise.resolve()
    if (hostScriptLoadPromise) return hostScriptLoadPromise

    hostScriptLoadPromise = new Promise(function (resolve, reject) {
      try {
        var cs = new CSInterface()
        var ext = cs.getSystemPath(SystemPath.EXTENSION)
        hostScriptPath = ext + '/host/index.jsx'
        var escapedPath = hostScriptPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
        // Load once via $.evalFile — defines all functions in the ExtendScript engine.
        cs.evalScript('$.evalFile("' + escapedPath + '"); "ok"', function (resultStr) {
          if (resultStr === 'ok') {
            hostScriptLoaded = true
            resolve()
          } else {
            // Fallback: try reading and inlining the script.
            try {
              var fs = require('fs')
              var content = fs.readFileSync(hostScriptPath, 'utf8')
              cs.evalScript(content + '\n"ok"', function (r2) {
                hostScriptLoaded = true
                resolve()
              })
            } catch (eFallback) {
              reject(new Error('Failed to load host script: ' + (resultStr || eFallback.message)))
            }
          }
        })
      } catch (e) {
        reject(new Error('ensureHostScriptLoaded error: ' + e.message))
      }
    })

    return hostScriptLoadPromise
  }

  /**
   * Execute a host function and return a promise that resolves with the parsed JSON result.
   * The host script is loaded once on first call, then only the function call is sent.
   */
  // Per-call ceiling for a single ExtendScript evaluation. CSInterface.evalScript
  // gives no guarantee its callback ever fires (a host-side hang would otherwise
  // leave the agent loop pending forever). On timeout we reject so the loop
  // surfaces the failure instead of stalling.
  var HOST_EVAL_TIMEOUT_MS = 30000

  function evalHostFunction (functionCall) {
    return ensureHostScriptLoaded().then(function () {
      return new Promise(function (resolve, reject) {
        var settled = false
        var timer = setTimeout(function () {
          if (settled) return
          settled = true
          reject(new Error('Host call timed out after ' + (HOST_EVAL_TIMEOUT_MS / 1000) + 's: ' + functionCall))
        }, HOST_EVAL_TIMEOUT_MS)
        function done (fn, value) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          fn(value)
        }
        try {
          var cs = new CSInterface()
          cs.evalScript(functionCall, function (resultStr) {
            if (!resultStr || resultStr === 'undefined' || resultStr === 'null') {
              done(reject, new Error('Host returned empty result for: ' + functionCall))
              return
            }
            try {
              if (resultStr.indexOf('EvalScript error') === 0) {
                done(reject, new Error(resultStr))
                return
              }
              var parsed = JSON.parse(resultStr)
              done(resolve, parsed)
            } catch (parseErr) {
              // Not JSON. Raw-eval callers (e.g. the Undo script returning a
              // bare number) legitimately want the string, so still resolve —
              // but tag it so executeToolCall can distinguish a real JSON tool
              // result from un-parseable output (which, for a tool, means the
              // ExtendScript side threw and must NOT be reported as success).
              done(resolve, { ok: true, message: resultStr, raw: resultStr, _nonJson: true })
            }
          })
        } catch (e) {
          done(reject, new Error('evalHostFunction error: ' + e.message))
        }
      })
    })
  }

  // ── Tool-name → host function mapping ────────────────────────────────

  /**
   * Serialize a JS value as an ExtendScript literal (inline in script string).
   * This avoids needing JSON.parse on the ExtendScript side.
   */
  // Delegates to the extracted, unit-tested serializer in lib/pure/esLiteral.js
  // (single source of truth, shared with the test harness).
  var toESLiteral = (window.PURE_ES && window.PURE_ES.toESLiteral)

  // User expression library persistence (panel-local; used by the
  // save/list/delete_user_expression tools and merged into library search).
  function loadUserSnippets () {
    if (!window.PURE_USER_EXPR_LIB) return []
    try {
      return window.PURE_USER_EXPR_LIB.loadSnippets(window.localStorage.getItem(window.PURE_USER_EXPR_LIB.STORAGE_KEY))
    } catch (_) { return [] }
  }
  function saveUserSnippets (snippets) {
    try {
      window.localStorage.setItem(window.PURE_USER_EXPR_LIB.STORAGE_KEY, window.PURE_USER_EXPR_LIB.serialize(snippets))
    } catch (_) { /* quota — snippet stays for this session only */ }
  }

  /**
   * Validate that critical tool calls include their required arguments.
   * Returns null when args look ok, or an error string for the agent.
   * Catches the common LLM failure of emitting `{}` for tools that require
   * a property path / keyframes payload (host call would otherwise return
   * a confusing "Property null not found" message).
   */
  function _validateRequiredArgs (toolName, args) {
    function isStr (v) { return typeof v === 'string' && v.length > 0 }
    function isArr (v) { return v && typeof v === 'object' && typeof v.length === 'number' && v.length > 0 }
    switch (toolName) {
      case 'add_keyframes':
        if (!isStr(args.property_path)) return 'add_keyframes: missing required `property_path` (e.g. "Transform>Scale", "Transform>Position", "Transform>Opacity").'
        if (!isArr(args.keyframes)) return 'add_keyframes: missing required `keyframes` array (each item: { time, value, in_type?, out_type? }).'
        return null
      case 'set_keyframes_batch':
        if (!isArr(args.targets)) return 'set_keyframes_batch: missing required `targets` array (each item: { layer_index or layer_id, property_path, keyframes }).'
        for (var ti = 0; ti < args.targets.length; ti++) {
          var tgt = args.targets[ti] || {}
          if (!isStr(tgt.property_path)) return 'set_keyframes_batch: targets[' + ti + '] missing `property_path`.'
          if (!isArr(tgt.keyframes)) return 'set_keyframes_batch: targets[' + ti + '] missing `keyframes` array (each item: { time, value, in_type?, out_type? }).'
        }
        return null
      case 'apply_expression':
        if (!isStr(args.property_path)) return 'apply_expression: missing required `property_path`.'
        if (typeof args.expression !== 'string') return 'apply_expression: missing required `expression` string.'
        return null
      case 'set_property_value':
        if (!isStr(args.property_path)) return 'set_property_value: missing required `property_path`.'
        if (args.value === undefined) return 'set_property_value: missing required `value`.'
        return null
      case 'set_text_document':
        // Text document update needs at least one field to change. The host
        // accepts a layer fallback, so we only reject completely-empty calls.
        var hasAnyField = isStr(args.text) || typeof args.font_size === 'number' || isArr(args.fill_color) || isStr(args.justification) || isStr(args.font)
        if (!hasAnyField) return 'set_text_document: provide at least one field — `text`, `font_size`, `fill_color`, `justification`, or `font`.'
        return null
      case 'set_effect_property':
        if (typeof args.effect_index !== 'number') return 'set_effect_property: missing required `effect_index`.'
        if (!isStr(args.property_name) && typeof args.property_index !== 'number') return 'set_effect_property: provide `property_name` (preferred, e.g. "Color", "Distance") or `property_index`.'
        if (args.value === undefined) return 'set_effect_property: missing required `value`.'
        return null
      // Fix K (iter 4): shape-tools must reference a layer. Host fallback
      // to selected layer was creating silent "hidden" successes when args
      // came in completely empty (iter 3 retest T10 #8 #9 had `args:{}`
      // and silently added an ellipse with default 200x200 size to whatever
      // happened to be selected).
      case 'link_properties':
        if (!isStr(args.target_property_path)) return 'link_properties: missing required `target_property_path` (e.g. "Transform>Position").'
        if (!isStr(args.source_property_path)) return 'link_properties: missing required `source_property_path` (e.g. "Transform>Position", "Effects>Slider Control>Slider").'
        if (typeof args.source_layer_id !== 'number' && typeof args.source_layer_index !== 'number') {
          return 'link_properties: provide `source_layer_id` or `source_layer_index` — the layer to read FROM.'
        }
        return null
      case 'list_available_effects':
        if (!isStr(args.filter)) return 'list_available_effects: missing required `filter` substring (e.g. "glow", "blur").'
        return null
      case 'copy_ease':
        if (!isStr(args.source_property_path)) return 'copy_ease: missing required `source_property_path` (e.g. "Transform>Position").'
        return null
      case 'reverse_keyframes':
        if (!isStr(args.property_path)) return 'reverse_keyframes: missing required `property_path`.'
        return null
      case 'stagger_layers':
        if (!isArr(args.layer_indices)) return 'stagger_layers: missing required `layer_indices` array (at least 2 layer indices).'
        if (typeof args.offset !== 'number') return 'stagger_layers: missing required `offset` number.'
        return null
      case 'randomize_property':
        if (!isArr(args.layer_indices)) return 'randomize_property: missing required `layer_indices` array.'
        if (!isStr(args.property_path)) return 'randomize_property: missing required `property_path` (e.g. "Transform>Rotation").'
        return null
      case 'move_anchor_point':
        if (!isStr(args.position)) return 'move_anchor_point: missing required `position` (center, top-left, top, top-right, left, right, bottom-left, bottom, bottom-right).'
        return null
      case 'add_shape_ellipse':
      case 'add_shape_rectangle':
      case 'add_shape_path':
        if (typeof args.layer_id !== 'number' && typeof args.layer_index !== 'number') {
          return toolName + ': missing required `layer_id` or `layer_index`. After create_layer(layer_type:"shape") returns {layerId}, pass that exact id. Don\'t rely on selection-fallback for shape content — it leads to silent insertion into the wrong layer.'
        }
        if (toolName === 'add_shape_path' && !(args.vertices && args.vertices.length >= 2)) {
          return 'add_shape_path: missing required `vertices` (array of at least 2 [x,y] points).'
        }
        return null
      case 'set_track_matte':
        if (!isStr(args.matte_type)) return 'set_track_matte: missing required `matte_type` (alpha, alpha_inverted, luma, luma_inverted, none).'
        return null
      case 'set_time_remap':
        if (typeof args.enabled !== 'boolean') return 'set_time_remap: missing required `enabled` boolean.'
        return null
      case 'split_layer':
        if (typeof args.time !== 'number') return 'split_layer: missing required `time` (seconds, strictly inside the layer span).'
        return null
      case 'open_comp':
        if (typeof args.comp_id !== 'number' && !isStr(args.comp_name)) {
          return 'open_comp: provide `comp_id` (preferred, from list_project_items) or `comp_name`.'
        }
        return null
    }
    return null
  }

  /**
   * Execute an agent tool call by mapping tool name + args to a host function call.
   * Returns a promise that resolves with the host result object.
   */
  // ── Idempotency cache (#6) ────────────────────────────────────────────
  // Tools that create new objects in AE are eligible for client_op_id
  // dedup so a retry after a network error doesn't double-create.
  var IDEMPOTENT_TOOLS = {
    create_layer: 1,
    create_comp: 1,
    add_effect: 1,
    add_mask: 1,
    add_marker: 1
  }
  var _idempotencyCache = {}
  // Cached create-results expire after this window. Idempotency exists to dedup
  // retries after a transient network error (which happen within seconds); a
  // short TTL preserves that while preventing a stale "success" from being
  // replayed minutes later after the user has manually deleted/renamed the
  // object in AE. Entry shape: { result, ts }.
  var IDEMPOTENCY_TTL_MS = 60000

  function _idempotencyKey (toolName, opId) {
    return toolName + '|' + String(opId)
  }

  function _clearIdempotencyCache () {
    _idempotencyCache = {}
  }

  // ── Anti-spam guard (Fix B) ──────────────────────────────────────────
  // Track sequential failures per (toolName, args-fingerprint). When the
  // same call has failed 3+ times in a row with the same arguments, the
  // 4th attempt is rejected client-side with a clear stop signal. The
  // counter is reset whenever a successful tool call is observed (so
  // legitimate iteration on different keyframes / properties never trips
  // the guard) and at the start of each new agent run.
  var SPAM_THRESHOLD = 3
  var _failStreak = {}            // key → { count, lastError }
  var _lastSuccessfulKey = null   // any success resets streaks for that key

  function _spamKey (toolName, args) {
    try {
      // Stable JSON: rely on JSON.stringify (host objects are POJOs from JSON.parse).
      return toolName + '|' + JSON.stringify(args || {})
    } catch (_) {
      return toolName + '|<unstringifiable-args>'
    }
  }

  function _resetSpamState () {
    _failStreak = {}
    _lastSuccessfulKey = null
  }

  function _checkSpamGuard (toolName, args) {
    var key = _spamKey(toolName, args)
    var entry = _failStreak[key]
    if (entry && entry.count >= SPAM_THRESHOLD) {
      return {
        ok: false,
        message: 'Tool ' + toolName + ' called ' + (entry.count + 1) + ' times with the same arguments and the same error: "' + (entry.lastError || 'unknown') + '". Stop retrying — investigate (e.g. call get_detailed_comp_summary to refresh layer state, change layer_id, or ask the user for guidance). This call was blocked by the anti-spam guard.',
        error_code: 'RETRY_BLOCKED',
        previousFailures: entry.count
      }
    }
    return null
  }

  function _recordToolOutcome (toolName, args, hostResult) {
    var key = _spamKey(toolName, args)
    var ok = hostResult && hostResult.ok === true
    if (ok) {
      // Successful call clears streak for THIS key only (other failing keys
      // remain — the guard is per-call-shape, not global).
      delete _failStreak[key]
      _lastSuccessfulKey = key
      return
    }
    var entry = _failStreak[key] || { count: 0, lastError: '' }
    entry.count++
    entry.lastError = (hostResult && hostResult.message) ? String(hostResult.message).substr(0, 160) : 'unknown error'
    _failStreak[key] = entry
  }

  function executeToolCall (toolName, args) {
    if (!args) args = {}
    var call = null

    // Fix I (iteration 3): strip gpt-oss-120b "harmony" format leak.
    // The model occasionally emits a tool name like
    // "apply_expression<|channel|>commentary" — channel separator
    // tokens leak into function.name on long chains. Trim everything
    // from "<|" onward and from any trailing whitespace.
    if (typeof toolName === 'string' && toolName.indexOf('<|') !== -1) {
      toolName = toolName.split('<|')[0].replace(/\s+$/, '')
    }

    // ── Anti-spam guard (Fix B): block 4th attempt of identical failing call.
    // Runs BEFORE idempotency so it catches the case of model retrying with
    // same op_id but call somehow not cached (e.g. failed every time).
    var spamBlock = _checkSpamGuard(toolName, args)
    if (spamBlock) {
      // Don't increment the counter for the block itself — leave it at threshold.
      return Promise.resolve(spamBlock)
    }

    // ── Idempotency check: if this tool supports client_op_id and we've
    // already seen this op in the current session, return the cached result.
    if (IDEMPOTENT_TOOLS[toolName] && typeof args.client_op_id === 'string' && args.client_op_id.length > 0) {
      var cacheKey = _idempotencyKey(toolName, args.client_op_id)
      if (_idempotencyCache.hasOwnProperty(cacheKey)) {
        var entry = _idempotencyCache[cacheKey]
        if (Date.now() - entry.ts > IDEMPOTENCY_TTL_MS) {
          // Stale — drop it and fall through to a fresh host call.
          delete _idempotencyCache[cacheKey]
        } else {
          var cached = entry.result
          // Return a shallow clone with a flag so the agent can tell.
          var clone = {}
          for (var k in cached) { if (cached.hasOwnProperty(k)) clone[k] = cached[k] }
          clone.deduplicated = true
          clone.message = (clone.message || '') + ' [returned from idempotency cache, op_id=' + args.client_op_id + ']'
          return Promise.resolve(clone)
        }
      }
    }

    // ── Pre-validation: catch obviously-empty calls before they hit the host
    // and return a clear error the agent can self-correct from. The schema
    // already declares these as required, but Cloud.ru tool-call generation
    // sometimes emits {} anyway.
    var validationError = _validateRequiredArgs(toolName, args)
    if (validationError) {
      var preValErr = { ok: false, message: validationError }
      _recordToolOutcome(toolName, args, preValErr)
      return Promise.resolve(preValErr)
    }

    switch (toolName) {
      // Read tools
      case 'get_detailed_comp_summary':
        var filterOpts = {}
        if (args.compact) filterOpts.compact = true
        if (args.layer_type) filterOpts.layerType = args.layer_type
        if (args.name_contains) filterOpts.nameContains = args.name_contains
        if (typeof args.max_layers === 'number') filterOpts.maxLayers = args.max_layers
        call = 'extensionsLlmChat_getDetailedCompSummary(' + toESLiteral(filterOpts) + ')'
        break
      case 'get_host_context':
        call = 'extensionsLlmChat_getHostContext()'
        break
      case 'get_property_value':
        call = 'extensionsLlmChat_getPropertyValue(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.property_path) + ',' +
          toESLiteral(args.time !== undefined ? args.time : null) + ')'
        break
      case 'get_keyframes':
        call = 'extensionsLlmChat_getKeyframes(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.property_path) + ')'
        break
      case 'get_layer_properties':
        call = 'extensionsLlmChat_getLayerProperties(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ')'
        break
      case 'search_layers':
        call = 'extensionsLlmChat_searchLayers(' +
          toESLiteral(args.pattern) + ',' +
          toESLiteral(args.layer_type || null) + ')'
        break
      case 'get_effect_properties':
        call = 'extensionsLlmChat_getEffectProperties(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.effect_index) + ')'
        break

      // Layer mutation tools
      case 'create_layer':
        call = 'extensionsLlmChat_createLayer(' +
          toESLiteral(args.layer_type) + ',' +
          toESLiteral(args.name || null) + ',' +
          toESLiteral({
            color: args.color || null,
            width: args.width || null,
            height: args.height || null,
            duration: args.duration || null,
            text: args.text || null,
            font: args.font || null,
            fontSize: args.font_size || null
          }) + ')'
        break
      case 'delete_layer':
        call = 'extensionsLlmChat_deleteLayer(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ')'
        break
      case 'duplicate_layer':
        call = 'extensionsLlmChat_duplicateLayer(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ')'
        break
      case 'reorder_layer':
        call = 'extensionsLlmChat_reorderLayer(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.new_index) + ')'
        break
      case 'set_layer_parent':
        call = 'extensionsLlmChat_setLayerParent(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.parent_layer_index) + ',' +
          toESLiteral(args.parent_layer_id || null) + ')'
        break
      case 'set_layer_timing':
        call = 'extensionsLlmChat_setLayerTiming(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.in_point !== undefined ? args.in_point : null) + ',' +
          toESLiteral(args.out_point !== undefined ? args.out_point : null) + ',' +
          toESLiteral(args.start_time !== undefined ? args.start_time : null) + ')'
        break
      case 'rename_layer':
        call = 'extensionsLlmChat_renameLayer(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.new_name) + ')'
        break

      // Keyframe tools
      case 'add_keyframes':
        // Map snake_case args to camelCase for ExtendScript.
        var kfs = (args.keyframes || []).map(function (kf) {
          return {
            time: kf.time,
            value: kf.value,
            inType: kf.in_type || null,
            outType: kf.out_type || null,
            easeIn: kf.ease_in || null,
            easeOut: kf.ease_out || null
          }
        })
        call = 'extensionsLlmChat_addKeyframes(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.property_path) + ',' +
          toESLiteral(kfs) + ')'
        break
      case 'set_keyframes_batch':
        var kfTargets = []
        var kfSrc = args.targets || []
        for (var kti = 0; kti < kfSrc.length; kti++) {
          var kt = kfSrc[kti] || {}
          var ktKfs = (kt.keyframes || []).map(function (kf) {
            return {
              time: kf.time,
              value: kf.value,
              inType: kf.in_type || null,
              outType: kf.out_type || null,
              easeIn: kf.ease_in || null,
              easeOut: kf.ease_out || null
            }
          })
          kfTargets.push({
            layerIndex: kt.layer_index,
            layerId: kt.layer_id || null,
            propertyPath: kt.property_path,
            keyframes: ktKfs
          })
        }
        call = 'extensionsLlmChat_setKeyframesBatch(' + toESLiteral(kfTargets) + ')'
        break
      case 'delete_keyframes':
        call = 'extensionsLlmChat_deleteKeyframes(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.property_path) + ',' +
          toESLiteral(args.times || null) + ',' +
          toESLiteral(args.key_indices || null) + ')'
        break
      case 'set_keyframe_easing':
        call = 'extensionsLlmChat_setKeyframeEasing(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.property_path) + ',' +
          toESLiteral(args.key_index) + ',' +
          toESLiteral(args.in_type || null) + ',' +
          toESLiteral(args.out_type || null) + ',' +
          toESLiteral(args.ease_in || null) + ',' +
          toESLiteral(args.ease_out || null) + ')'
        break
      case 'copy_ease':
        call = 'extensionsLlmChat_copyEase(' +
          toESLiteral(args.source_layer_index !== undefined ? args.source_layer_index : null) + ',' +
          toESLiteral(args.source_layer_id || null) + ',' +
          toESLiteral(args.source_property_path) + ',' +
          toESLiteral(args.source_key_index !== undefined ? args.source_key_index : null) + ',' +
          toESLiteral(args.target_layer_index !== undefined ? args.target_layer_index : null) + ',' +
          toESLiteral(args.target_layer_id || null) + ',' +
          toESLiteral(args.target_property_path || null) + ',' +
          toESLiteral(args.key_indices || null) + ',' +
          toESLiteral(args.mode || null) + ')'
        break
      case 'reverse_keyframes':
        call = 'extensionsLlmChat_reverseKeyframes(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.property_path) + ')'
        break
      case 'stagger_layers':
        call = 'extensionsLlmChat_staggerLayers(' +
          toESLiteral(args.layer_indices || null) + ',' +
          toESLiteral(args.layer_ids || null) + ',' +
          toESLiteral(args.offset) + ',' +
          toESLiteral(args.unit || null) + ',' +
          toESLiteral(args.direction || null) + ',' +
          toESLiteral(args.mode || null) + ')'
        break
      case 'randomize_property':
        call = 'extensionsLlmChat_randomizeProperty(' +
          toESLiteral(args.layer_indices || null) + ',' +
          toESLiteral(args.layer_ids || null) + ',' +
          toESLiteral(args.property_path) + ',' +
          toESLiteral({
            min: args.min !== undefined ? args.min : null,
            max: args.max !== undefined ? args.max : null,
            mode: args.mode || null,
            minX: args.min_x !== undefined ? args.min_x : null,
            maxX: args.max_x !== undefined ? args.max_x : null,
            minY: args.min_y !== undefined ? args.min_y : null,
            maxY: args.max_y !== undefined ? args.max_y : null,
            uniform: args.uniform !== undefined ? args.uniform : null
          }) + ')'
        break
      case 'move_anchor_point':
        call = 'extensionsLlmChat_moveAnchorPoint(' +
          toESLiteral(args.layer_index !== undefined ? args.layer_index : null) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.position) + ')'
        break

      // Property tools
      case 'get_expression':
        call = 'extensionsLlmChat_getExpression(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.property_path) + ')'
        break
      case 'set_property_value':
        call = 'extensionsLlmChat_setPropertyValue(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.property_path) + ',' +
          toESLiteral(args.value) + ')'
        break
      case 'apply_expression':
        call = 'extensionsLlmChat_applyExpressionToTarget(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.property_path) + ',' +
          toESLiteral(args.expression) + ')'
        break
      case 'apply_expression_batch':
        var batchTargets = []
        var srcTargets = args.targets || []
        for (var bi = 0; bi < srcTargets.length; bi++) {
          var bt = srcTargets[bi] || {}
          batchTargets.push({
            layerIndex: bt.layer_index,
            layerId: bt.layer_id || null,
            propertyPath: bt.property_path,
            expressionText: bt.expression
          })
        }
        call = 'extensionsLlmChat_applyExpressionBatch(' + toESLiteral(batchTargets) + ')'
        break
      // Shape content tools
      case 'add_shape_rectangle':
        call = 'extensionsLlmChat_addShapeRect(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral({
            name: args.name || null,
            width: args.width || null,
            height: args.height || null,
            position: args.position || null,
            roundness: args.roundness || null,
            fill_color: args.fill_color || null,
            fill_opacity: args.fill_opacity || null,
            stroke_color: args.stroke_color || null,
            stroke_width: args.stroke_width || null
          }) + ')'
        break
      case 'add_shape_ellipse':
        call = 'extensionsLlmChat_addShapeEllipse(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral({
            name: args.name || null,
            width: args.width || null,
            height: args.height || null,
            position: args.position || null,
            fill_color: args.fill_color || null,
            fill_opacity: args.fill_opacity || null,
            stroke_color: args.stroke_color || null,
            stroke_width: args.stroke_width || null
          }) + ')'
        break
      case 'add_shape_path':
        call = 'extensionsLlmChat_addShapePath(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral({
            name: args.name || null,
            vertices: args.vertices || [],
            in_tangents: args.in_tangents || null,
            out_tangents: args.out_tangents || null,
            closed: args.closed !== undefined ? args.closed : true,
            fill_color: args.fill_color || null,
            stroke_color: args.stroke_color || null,
            stroke_width: args.stroke_width || null
          }) + ')'
        break

      // 3D / Camera / Light tools
      case 'set_layer_3d':
        call = 'extensionsLlmChat_setLayer3D(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(!!args.enabled) + ')'
        break
      case 'set_camera_properties':
        call = 'extensionsLlmChat_setCameraProperties(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral({
            zoom: args.zoom || null,
            focus_distance: args.focus_distance || null,
            aperture: args.aperture || null,
            blur_level: args.blur_level || null,
            depth_of_field: args.depth_of_field !== undefined ? args.depth_of_field : null
          }) + ')'
        break
      case 'set_light_properties':
        call = 'extensionsLlmChat_setLightProperties(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral({
            intensity: args.intensity || null,
            color: args.color || null,
            cone_angle: args.cone_angle || null,
            cone_feather: args.cone_feather || null
          }) + ')'
        break

      // Mask tools
      case 'add_mask':
        call = 'extensionsLlmChat_addMask(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral({
            mode: args.mode || null,
            vertices: args.vertices || null,
            in_tangents: args.in_tangents || null,
            out_tangents: args.out_tangents || null,
            closed: args.closed !== undefined ? args.closed : null,
            feather: args.feather || null,
            opacity: args.opacity !== undefined ? args.opacity : null,
            expansion: args.expansion || null,
            inset: args.inset || null
          }) + ')'
        break
      case 'set_mask_properties':
        call = 'extensionsLlmChat_setMaskProperties(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.mask_index) + ',' +
          toESLiteral({
            feather: args.feather || null,
            opacity: args.opacity !== undefined ? args.opacity : null,
            expansion: args.expansion || null,
            mode: args.mode || null,
            inverted: args.inverted !== undefined ? args.inverted : null
          }) + ')'
        break
      case 'get_mask_info':
        call = 'extensionsLlmChat_getMaskInfo(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ')'
        break

      // Marker tools
      case 'add_marker':
        call = 'extensionsLlmChat_addMarker(' +
          toESLiteral(args.layer_index || null) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral({
            target: args.target || 'layer',
            time: args.time !== undefined ? args.time : null,
            comment: args.comment || '',
            duration: args.duration || null
          }) + ')'
        break
      case 'get_markers':
        call = 'extensionsLlmChat_getMarkers(' +
          toESLiteral(args.layer_index || null) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.target || 'layer') + ')'
        break
      case 'delete_marker':
        call = 'extensionsLlmChat_deleteMarker(' +
          toESLiteral(args.layer_index || null) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.marker_index) + ',' +
          toESLiteral(args.target || 'layer') + ')'
        break

      // Import / Project items tools
      case 'list_project_items':
        call = 'extensionsLlmChat_listProjectItems(' +
          toESLiteral({ maxItems: args.max_items || null }) + ')'
        break
      case 'import_file':
        call = 'extensionsLlmChat_importFile(' + toESLiteral(args.file_path) + ')'
        break
      case 'add_item_to_comp':
        call = 'extensionsLlmChat_addItemToComp(' + toESLiteral(args.project_item_index) + ')'
        break

      // Capture tool: persistent path under user's home so frames survive
      // OS temp cleanup and stay viewable in chat history (#12). The host
      // function expands ~ via Folder("~"), creates the dir, and prunes
      // old captures (keeps newest 50).
      case 'capture_comp_frame':
        var captureName = 'frame-' + Date.now() + '.png'
        call = 'extensionsLlmChat_saveCompFramePng(' + toESLiteral(captureName) + ', true)'
        break

      // Expression library — panel-local, no AE round trip.
      // Merges the user's personal snippets (localStorage) into the search.
      case 'search_expression_library':
        if (!(window.PURE_EXPR_LIB && typeof window.PURE_EXPR_LIB.search === 'function')) {
          return Promise.resolve({ ok: false, message: 'Expression library module not loaded.' })
        }
        return Promise.resolve(window.PURE_EXPR_LIB.search(args.query, args.max_results, loadUserSnippets()))

      // User expression library — panel-local CRUD over localStorage.
      case 'save_user_expression': {
        if (!window.PURE_USER_EXPR_LIB) {
          return Promise.resolve({ ok: false, message: 'User expression library module not loaded.' })
        }
        var uxList = loadUserSnippets()
        var uxNext = window.PURE_USER_EXPR_LIB.addSnippet(uxList, {
          name: args.name,
          expression: args.expression,
          keywords: args.keywords,
          target: args.target,
          notes: args.notes
        })
        if (!uxNext) {
          return Promise.resolve({ ok: false, message: 'save_user_expression: `name` and `expression` must be non-empty.' })
        }
        saveUserSnippets(uxNext)
        var uxSaved = uxNext[uxNext.length - 1]
        return Promise.resolve({
          ok: true,
          message: 'Saved "' + uxSaved.name + '" (id: ' + uxSaved.id + ') to the user expression library. It is now findable via search_expression_library. Library size: ' + uxNext.length + ' user snippet(s).',
          id: uxSaved.id
        })
      }
      case 'list_user_expressions': {
        if (!window.PURE_USER_EXPR_LIB) {
          return Promise.resolve({ ok: false, message: 'User expression library module not loaded.' })
        }
        var uxAll = loadUserSnippets()
        return Promise.resolve({
          ok: true,
          message: uxAll.length > 0
            ? (uxAll.length + ' user snippet(s) in the personal library. Delete with delete_user_expression by id.')
            : 'The user expression library is empty. Save snippets with save_user_expression.',
          snippets: uxAll
        })
      }
      case 'delete_user_expression': {
        if (!window.PURE_USER_EXPR_LIB) {
          return Promise.resolve({ ok: false, message: 'User expression library module not loaded.' })
        }
        var uxRest = window.PURE_USER_EXPR_LIB.removeSnippet(loadUserSnippets(), args.id)
        if (uxRest === null) {
          return Promise.resolve({ ok: false, message: 'delete_user_expression: no snippet with id "' + args.id + '". Call list_user_expressions to see valid ids.' })
        }
        saveUserSnippets(uxRest)
        return Promise.resolve({ ok: true, message: 'Deleted snippet "' + args.id + '". ' + uxRest.length + ' user snippet(s) remain.' })
      }

      // Property linking
      case 'link_properties':
        call = 'extensionsLlmChat_linkProperties(' +
          toESLiteral(args.target_layer_index !== undefined ? args.target_layer_index : null) + ',' +
          toESLiteral(args.target_layer_id || null) + ',' +
          toESLiteral(args.target_property_path) + ',' +
          toESLiteral(args.source_layer_index !== undefined ? args.source_layer_index : null) + ',' +
          toESLiteral(args.source_layer_id || null) + ',' +
          toESLiteral(args.source_property_path) + ',' +
          toESLiteral({
            scale: typeof args.scale === 'number' ? args.scale : null,
            offset: args.offset !== undefined ? args.offset : null
          }) + ')'
        break

      // Effect tools
      case 'list_available_effects':
        call = 'extensionsLlmChat_listAvailableEffects(' +
          toESLiteral(args.filter) + ',' +
          toESLiteral(args.category || null) + ',' +
          toESLiteral(typeof args.max_results === 'number' ? args.max_results : null) + ')'
        break
      case 'add_effect':
        call = 'extensionsLlmChat_addEffect(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.effect_match_name) + ',' +
          toESLiteral(args.effect_name || null) + ')'
        break
      case 'remove_effect':
        call = 'extensionsLlmChat_removeEffect(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.effect_index) + ')'
        break
      case 'set_effect_property':
        call = 'extensionsLlmChat_setEffectPropertyValue(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.effect_index) + ',' +
          toESLiteral(typeof args.property_index === 'number' ? args.property_index : null) + ',' +
          toESLiteral(args.value) + ',' +
          toESLiteral(args.property_name || null) + ')'
        break

      // Composition tools
      case 'create_comp':
        call = 'extensionsLlmChat_createComp(' +
          toESLiteral(args.name) + ',' +
          toESLiteral(args.width || null) + ',' +
          toESLiteral(args.height || null) + ',' +
          toESLiteral(null) + ',' +  // pixelAspect
          toESLiteral(args.duration || null) + ',' +
          toESLiteral(args.frame_rate || null) + ')'
        break
      case 'precompose_layers':
        call = 'extensionsLlmChat_precomposeLayers(' +
          toESLiteral(args.layer_indices || null) + ',' +
          toESLiteral(args.comp_name) + ',' +
          toESLiteral(args.move_attributes !== undefined ? args.move_attributes : true) + ',' +
          toESLiteral(args.layer_ids || null) + ')'
        break
      case 'set_comp_settings':
        call = 'extensionsLlmChat_setCompSettings(' +
          toESLiteral({
            name: args.name || undefined,
            width: args.width || undefined,
            height: args.height || undefined,
            duration: args.duration || undefined,
            frameRate: args.frame_rate || undefined,
            bgColor: args.bg_color || undefined,
            motionBlur: typeof args.motion_blur === 'boolean' ? args.motion_blur : undefined
          }) + ')'
        break

      // Text tools
      case 'set_text_document':
        call = 'extensionsLlmChat_setTextDocument(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral({
            text: args.text || undefined,
            font: args.font || undefined,
            fontSize: args.font_size || undefined,
            fillColor: args.fill_color || undefined,
            strokeColor: args.stroke_color || undefined,
            strokeWidth: args.stroke_width || undefined,
            justification: args.justification || undefined,
            tracking: args.tracking || undefined,
            leading: args.leading || undefined,
            baselineShift: args.baseline_shift || undefined
          }) + ')'
        break

      case 'create_shapes_from_text':
        call = 'extensionsLlmChat_createShapesFromText(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ')'
        break

      case 'set_blend_mode':
        call = 'extensionsLlmChat_setBlendMode(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.blend_mode) + ')'
        break

      // Track matte / switches / time remap / split / open comp
      case 'set_track_matte':
        call = 'extensionsLlmChat_setTrackMatte(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.matte_type) + ',' +
          toESLiteral(typeof args.matte_layer_index === 'number' ? args.matte_layer_index : null) + ',' +
          toESLiteral(typeof args.matte_layer_id === 'number' ? args.matte_layer_id : null) + ')'
        break

      case 'set_layer_switches':
        call = 'extensionsLlmChat_setLayerSwitches(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral({
            enabled: typeof args.enabled === 'boolean' ? args.enabled : undefined,
            motion_blur: typeof args.motion_blur === 'boolean' ? args.motion_blur : undefined,
            adjustment: typeof args.adjustment === 'boolean' ? args.adjustment : undefined,
            shy: typeof args.shy === 'boolean' ? args.shy : undefined,
            solo: typeof args.solo === 'boolean' ? args.solo : undefined,
            locked: typeof args.locked === 'boolean' ? args.locked : undefined,
            guide: typeof args.guide === 'boolean' ? args.guide : undefined,
            collapse_transformation: typeof args.collapse_transformation === 'boolean' ? args.collapse_transformation : undefined,
            effects_active: typeof args.effects_active === 'boolean' ? args.effects_active : undefined,
            audio_enabled: typeof args.audio_enabled === 'boolean' ? args.audio_enabled : undefined
          }) + ')'
        break

      case 'set_time_remap':
        call = 'extensionsLlmChat_setTimeRemap(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(!!args.enabled) + ')'
        break

      case 'split_layer':
        call = 'extensionsLlmChat_splitLayer(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.time) + ')'
        break

      case 'open_comp':
        call = 'extensionsLlmChat_openComp(' +
          toESLiteral(typeof args.comp_id === 'number' ? args.comp_id : null) + ',' +
          toESLiteral(args.comp_name || null) + ')'
        break

      default:
        return Promise.reject(new Error('Unknown tool: ' + toolName))
    }

    var hostPromise = evalHostFunction(call).then(function (res) {
      // Every tool host function returns JSON. A non-JSON result means the
      // ExtendScript side threw or returned raw text — convert it to an explicit
      // failure instead of the silent ok:true fallback, so the model, the Undo
      // counter and the spam guard never mistake a host error for success.
      if (res && res._nonJson) {
        return {
          ok: false,
          message: 'Host returned a non-JSON result (likely an ExtendScript error): ' +
            String(res.raw == null ? '' : res.raw).slice(0, 300)
        }
      }
      return res
    })
    // Cache successful idempotent results so a retry with the same
    // client_op_id returns the original instead of double-creating.
    if (IDEMPOTENT_TOOLS[toolName] && typeof args.client_op_id === 'string' && args.client_op_id.length > 0) {
      var cKey = _idempotencyKey(toolName, args.client_op_id)
      hostPromise = hostPromise.then(function (res) {
        if (res && res.ok === true) _idempotencyCache[cKey] = { result: res, ts: Date.now() }
        return res
      })
    }
    // Track success/failure for the anti-spam guard. Wrap as the FINAL link
    // in the chain so cached idempotent ok-results also count as successes
    // (they reset the streak for that key).
    hostPromise = hostPromise.then(function (res) {
      _recordToolOutcome(toolName, args, res)
      return res
    }, function (err) {
      _recordToolOutcome(toolName, args, { ok: false, message: (err && err.message) || String(err) })
      throw err
    })
    return hostPromise
  }

  // Export
  if (typeof window !== 'undefined') {
    window.HOST_BRIDGE = {
      evalHostFunction: evalHostFunction,
      executeToolCall: executeToolCall,
      ensureHostScriptLoaded: ensureHostScriptLoaded,
      toESLiteral: toESLiteral,
      // Allow the panel to clear the idempotency cache when the user
      // intentionally starts fresh (Clear button) — otherwise repeated
      // op_ids from a new session would surface stale results.
      clearIdempotencyCache: _clearIdempotencyCache,
      // Reset the anti-spam streak counters at the start of each new agent
      // run so a previous run's blocked tool can be re-tried. Called from
      // agentToolLoop.runAgentLoop().
      resetSpamGuard: _resetSpamState
    }
  }
})()
