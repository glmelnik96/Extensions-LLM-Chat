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
  function evalHostFunction (functionCall) {
    return ensureHostScriptLoaded().then(function () {
      return new Promise(function (resolve, reject) {
        try {
          var cs = new CSInterface()
          cs.evalScript(functionCall, function (resultStr) {
            if (!resultStr || resultStr === 'undefined' || resultStr === 'null') {
              reject(new Error('Host returned empty result for: ' + functionCall))
              return
            }
            try {
              if (resultStr.indexOf('EvalScript error') === 0) {
                reject(new Error(resultStr))
                return
              }
              var parsed = JSON.parse(resultStr)
              resolve(parsed)
            } catch (parseErr) {
              resolve({ ok: true, message: resultStr, raw: resultStr })
            }
          })
        } catch (e) {
          reject(new Error('evalHostFunction error: ' + e.message))
        }
      })
    })
  }

  // ── Tool-name → host function mapping ────────────────────────────────

  /**
   * Serialize a JS value as an ExtendScript literal (inline in script string).
   * This avoids needing JSON.parse on the ExtendScript side.
   */
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
    }
    return null
  }

  /**
   * Execute an agent tool call by mapping tool name + args to a host function call.
   * Returns a promise that resolves with the host result object.
   */
  function executeToolCall (toolName, args) {
    if (!args) args = {}
    var call = null

    // ── Pre-validation: catch obviously-empty calls before they hit the host
    // and return a clear error the agent can self-correct from. The schema
    // already declares these as required, but Cloud.ru tool-call generation
    // sometimes emits {} anyway.
    var validationError = _validateRequiredArgs(toolName, args)
    if (validationError) {
      return Promise.resolve({ ok: false, message: validationError })
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
      case 'delete_keyframes':
        call = 'extensionsLlmChat_deleteKeyframes(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.property_path) + ',' +
          toESLiteral(args.times || null) + ')'
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

      // Capture tool
      case 'capture_comp_frame':
        var tmpPath = '/tmp/ae-motion-agent-frame-' + Date.now() + '.png'
        call = 'extensionsLlmChat_saveCompFramePng(' + toESLiteral(tmpPath) + ')'
        break

      // Effect tools
      case 'add_effect':
        call = 'extensionsLlmChat_addEffect(' +
          toESLiteral(args.layer_index) + ',' +
          toESLiteral(args.layer_id || null) + ',' +
          toESLiteral(args.effect_match_name) + ')'
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
          toESLiteral(args.layer_indices) + ',' +
          toESLiteral(args.comp_name) + ',' +
          toESLiteral(args.move_attributes !== undefined ? args.move_attributes : true) + ')'
        break
      case 'set_comp_settings':
        call = 'extensionsLlmChat_setCompSettings(' +
          toESLiteral({
            name: args.name || undefined,
            width: args.width || undefined,
            height: args.height || undefined,
            duration: args.duration || undefined,
            frameRate: args.frame_rate || undefined
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

      default:
        return Promise.reject(new Error('Unknown tool: ' + toolName))
    }

    return evalHostFunction(call)
  }

  // Export
  if (typeof window !== 'undefined') {
    window.HOST_BRIDGE = {
      evalHostFunction: evalHostFunction,
      executeToolCall: executeToolCall,
      ensureHostScriptLoaded: ensureHostScriptLoaded,
      toESLiteral: toESLiteral
    }
  }
})()
