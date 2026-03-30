/**
 * Host Bridge — wraps CSInterface.evalScript calls to ExtendScript.
 * Provides promise-based execution of host functions.
 */
(function () {
  'use strict'

  var cachedHostScript = null
  var hostScriptPath = null

  /**
   * Get the host script content (index.jsx), caching after first load.
   */
  function getHostScriptContent (done) {
    if (cachedHostScript) { done(cachedHostScript); return }
    try {
      var cs = new CSInterface()
      var ext = cs.getSystemPath(SystemPath.EXTENSION)
      hostScriptPath = ext + '/host/index.jsx'
      // Read the file content via Node.js (available in CEP).
      var fs = require('fs')
      fs.readFile(hostScriptPath, 'utf8', function (err, data) {
        if (err) {
          // Fallback: use $.evalFile at runtime.
          cachedHostScript = ''
          done('')
        } else {
          cachedHostScript = data
          done(data)
        }
      })
    } catch (e) {
      cachedHostScript = ''
      done('')
    }
  }

  /**
   * Build a script string for CSInterface.evalScript.
   * If we have cached host content, inline it. Otherwise $.evalFile.
   */
  function buildHostEvalScript (bodyExpression, hostContent) {
    if (hostContent && hostContent.length > 0) {
      return hostContent + '\n' + bodyExpression
    }
    if (hostScriptPath) {
      return '$.evalFile("' + hostScriptPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '");\n' + bodyExpression
    }
    return bodyExpression
  }

  /**
   * Execute a host function and return a promise that resolves with the parsed JSON result.
   */
  function evalHostFunction (functionCall) {
    return new Promise(function (resolve, reject) {
      getHostScriptContent(function (hostContent) {
        try {
          var cs = new CSInterface()
          var script = buildHostEvalScript(functionCall, hostContent)
          cs.evalScript(script, function (resultStr) {
            if (!resultStr || resultStr === 'undefined' || resultStr === 'null') {
              reject(new Error('Host returned empty result for: ' + functionCall))
              return
            }
            try {
              // EvalScript returns a string — could be JSON or EvalScript error.
              if (resultStr.indexOf('EvalScript error') === 0) {
                reject(new Error(resultStr))
                return
              }
              var parsed = JSON.parse(resultStr)
              resolve(parsed)
            } catch (parseErr) {
              // If not JSON, return raw string.
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
   * Execute an agent tool call by mapping tool name + args to a host function call.
   * Returns a promise that resolves with the host result object.
   */
  function executeToolCall (toolName, args) {
    if (!args) args = {}
    var call = null

    switch (toolName) {
      // Read tools
      case 'get_detailed_comp_summary':
        call = 'extensionsLlmChat_getDetailedCompSummary()'
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
          toESLiteral(args.property_index) + ',' +
          toESLiteral(args.value) + ')'
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
      buildHostEvalScript: buildHostEvalScript,
      getHostScriptContent: getHostScriptContent,
      toESLiteral: toESLiteral
    }
  }
})()
