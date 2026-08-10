/**
 * Recover a tool call that the model wrote into `content` instead of emitting
 * as a proper `tool_calls` entry.
 *
 * gpt-oss-120b does this several times per long session: the visible answer
 * turns out to be nothing but `{"layer_id": 186, "in_point": 0.36, ...}`. The
 * loop used to accept that as the final answer, so the operation was silently
 * dropped and the user just saw raw JSON and asked again. Observed live in a
 * real session (msgs 12, 14, 18 of a 22-message chat).
 *
 * The bare-arguments form carries no tool name, so it is matched against the
 * registry by SHAPE: a candidate qualifies only if every supplied key is one
 * of its declared parameters and all of its required parameters are present.
 * A match is returned only when exactly one tool qualifies — an ambiguous
 * payload is left alone rather than guessed at, because executing the wrong
 * mutating tool is far worse than showing the JSON.
 */
(function () {
  'use strict'

  // Accepted by every tool (idempotency plumbing), so it must never influence
  // which tool a payload is attributed to.
  var UNIVERSAL_KEYS = { client_op_id: 1 }

  // Layer-addressing tools schema-require `layer_index` but accept `layer_id`
  // instead (the prompt in fact prefers the id — it survives reordering). A
  // required-args check that ignored this would reject every id-addressed
  // payload, which is most of them.
  var EQUIVALENT_KEYS = { layer_index: 'layer_id', layer_id: 'layer_index' }

  function hasRequired (obj, key) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) return true
    var alt = EQUIVALENT_KEYS[key]
    return !!alt && Object.prototype.hasOwnProperty.call(obj, alt)
  }

  function stripFence (text) {
    var s = String(text == null ? '' : text).trim()
    // ```json … ``` / ``` … ```
    var m = /^```[a-zA-Z]*\s*([\s\S]*?)\s*```$/.exec(s)
    return m ? m[1].trim() : s
  }

  function parseObject (text) {
    var s = stripFence(text)
    if (s.charAt(0) !== '{' || s.charAt(s.length - 1) !== '}') return null
    var obj
    try { obj = JSON.parse(s) } catch (e) { return null }
    if (!obj || typeof obj !== 'object' || obj instanceof Array) return null
    return obj
  }

  function toolSpec (tool) {
    var fn = tool && tool.function
    if (!fn || !fn.name) return null
    var params = fn.parameters || {}
    return {
      name: fn.name,
      properties: params.properties || {},
      required: params.required || []
    }
  }

  /**
   * The model sometimes DOES name the tool, in one of the shapes below.
   * Handle those first — no shape-matching needed.
   *   {"name":"set_layer_timing","arguments":{…}}
   *   {"tool":"set_layer_timing","args":{…}}
   *   {"function":{"name":…,"arguments":"{…}"}}
   */
  function readNamedForm (obj, known) {
    var fn = obj.function && typeof obj.function === 'object' ? obj.function : obj
    var name = fn.name || fn.tool || fn.tool_name || fn.recipient
    // `name` is also an ordinary argument of rename_layer, so the value has to
    // be an actual tool name before this is read as the named form — otherwise
    // {"layer_index":3,"name":"BG Box"} would be taken as a call to a tool
    // called "BG Box".
    if (typeof name !== 'string' || !known[name]) return null
    var args = fn.arguments !== undefined ? fn.arguments
      : fn.args !== undefined ? fn.args
        : fn.parameters !== undefined ? fn.parameters : {}
    if (typeof args === 'string') {
      try { args = JSON.parse(args) } catch (e) { return null }
    }
    if (!args || typeof args !== 'object' || args instanceof Array) return null
    return { tool: name, args: args, matchedBy: 'name' }
  }

  function ownKeys (obj) {
    var keys = []
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k) && !UNIVERSAL_KEYS[k]) keys.push(k)
    }
    return keys
  }

  /**
   * Top-level keys alone cannot separate the two batch tools — both take a
   * single `targets` array — so array-of-object arguments are compared item by
   * item as well: {property_path, expression} is an expression batch,
   * {property_path, keyframes} a keyframe batch.
   */
  function itemsFit (value, schema) {
    if (!(value instanceof Array) || value.length === 0) return true
    var items = schema && schema.items
    var itemProps = items && items.properties
    if (!itemProps) return true
    var itemRequired = (items && items.required) || []
    for (var i = 0; i < value.length; i++) {
      var item = value[i]
      if (!item || typeof item !== 'object' || item instanceof Array) return false
      var keys = ownKeys(item)
      for (var k = 0; k < keys.length; k++) {
        if (!Object.prototype.hasOwnProperty.call(itemProps, keys[k])) return false
      }
      for (var r = 0; r < itemRequired.length; r++) {
        if (!hasRequired(item, itemRequired[r])) return false
      }
    }
    return true
  }

  function matchByShape (obj, tools) {
    var keys = ownKeys(obj)
    // A bare `{}` matches every no-arg tool — nothing to recover from it.
    if (keys.length === 0) return null

    var matches = []
    for (var t = 0; t < tools.length; t++) {
      var spec = toolSpec(tools[t])
      if (!spec) continue
      var ok = true
      for (var i = 0; i < keys.length && ok; i++) {
        var schema = spec.properties[keys[i]]
        if (!schema) ok = false
        else if (!itemsFit(obj[keys[i]], schema)) ok = false
      }
      for (var r = 0; r < spec.required.length && ok; r++) {
        if (!hasRequired(obj, spec.required[r])) ok = false
      }
      if (ok) matches.push(spec.name)
    }
    if (matches.length !== 1) return null
    return { tool: matches[0], args: obj, matchedBy: 'shape' }
  }

  /**
   * @param {string} content   assistant message content
   * @param {Array}  tools     OpenAI-compatible tool definitions
   * @returns {null|{tool:string, args:object, matchedBy:'name'|'shape'}}
   */
  function parseLeakedCall (content, tools) {
    var obj = parseObject(content)
    if (!obj) return null
    var list = tools || []
    var known = {}
    for (var t = 0; t < list.length; t++) {
      var spec = toolSpec(list[t])
      if (spec) known[spec.name] = 1
    }
    var named = readNamedForm(obj, known)
    if (named) return named
    return matchByShape(obj, list)
  }

  var api = { parseLeakedCall: parseLeakedCall }

  if (typeof window !== 'undefined') window.PURE_TOOL_CALL_SALVAGE = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})()
