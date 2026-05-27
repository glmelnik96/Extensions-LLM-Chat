# Host Bridge Notes

How `hostBridge.js` mediates between the panel (CEF JavaScript) and After Effects (ExtendScript).

---

## Execution path

1. **Load once at startup** — `ensureHostScriptLoaded()` reads `host/index.jsx` and evaluates it via `CSInterface.evalScript()` once. All `extensionsLlmChat_*` functions and `_helper*` utilities are now defined in the AE scripting context. Subsequent tool calls invoke them without re-parsing.

2. **Tool dispatch** — `executeToolCall(toolName, args)` runs the following pipeline (in order):

   ```
   normalize toolName  (strip <|...|> harmony leak)
       ↓
   anti-spam check     (4th identical failing call → RETRY_BLOCKED)
       ↓
   idempotency check   (client_op_id hit → cached result)
       ↓
   required-args check (_validateRequiredArgs)
       ↓
   switch (toolName)   (build ExtendScript call string)
       ↓
   evalHostFunction    (CSInterface.evalScript → AE → JSON string)
       ↓
   cache idempotent OK results
       ↓
   record outcome for spam guard
   ```

3. **Return** — ExtendScript functions return JSON strings via `resultToJson()`. The bridge parses the JSON and resolves the promise. Errors surface as `{ ok: false, message: "..." }`.

---

## ExtendScript function pattern

All host mutating functions follow this shape:

```javascript
function extensionsLlmChat_toolName (layerIndex, layerId, /* ...args */) {
  var result = { ok: false, message: '' };
  try {
    var ctx = extensionsLlmChat_resolveActiveComp();
    if (!ctx.ok || !ctx.comp) { result.message = ctx.message; return resultToJson(result); }
    var layer = _resolveLayer(ctx.comp, layerIndex, layerId);
    if (!layer) { result.message = 'Layer not found.'; return resultToJson(result); }

    _beginToolUndo('Agent: <description>');
    // ... AE operations ...
    _endToolUndo();

    result.ok = true;
    result.message = 'OK message describing what changed';
    return resultToJson(result);
  } catch (e) {
    try { _endToolUndo(); } catch (x) {}
    result.message = 'toolName error: ' + e.toString();
    return resultToJson(result);
  }
}
```

Read-only functions skip the undo group. Both kinds always return a JSON string via `resultToJson`.

---

## Shared helpers in `host/index.jsx`

| Helper | Purpose |
|---|---|
| `_beginToolUndo(label)` / `_endToolUndo()` | Open/close AE undo group around a mutating action. |
| `extensionsLlmChat_resolveActiveComp()` | Returns `{ ok, comp, message }` with the active comp or a friendly error if there is none. |
| `_resolveLayer(comp, layerIndex, layerId)` | Resolve a layer by id → by index → fallback to first selected layer. The selection fallback is great for `set_text_document` on whatever the user has selected, but it's intentionally **not** allowed for shape-content tools (see Fix K in [../AGENTS.md](../AGENTS.md)). |
| `_resolveProperty(layer, pathStr)` | Resolve property paths like `Transform>Position`, `Effects>Gaussian Blur>Blurriness`, `Masks>Mask 1>Mask Expansion`. Uses `_KNOWN_PATHS` fast-path map. |
| `_layerTypeString(layer)` | Stable layer-type string used in error hints. |
| `_getTemporalEaseDims(prop, keyIndex)` | Detect 1/2/3-D temporal ease — needed because AE's API for `setTemporalEaseAtKey` requires correct dimension count. |
| `resultToJson(obj)` | Custom JSON serializer (AE's `JSON.stringify` is unreliable on some objects). |
| `_validateValueForPath(path, value)` | Type hints for `_KNOWN_PATHS` — returns clear error like `Transform>Position expects [x,y]` before AE rejects with a cryptic message. |
| `_describeValue(v)` | Short stringifier used in type-hint errors. |
| `_pruneOldCaptures(folder, keepCount)` | Auto-prune `~/AE-agent-captures/` to newest 50 PNGs. |
| `extensionsLlmChat_getCapabilities()` | Capability probe — returns `{ version, helpers: { name: bool, ... } }`. Called by panel at startup. |

> **Lesson learned**: deleting "unused" code from `host/index.jsx` is dangerous because shared helpers cluster with the tools that use them. In iter 1 the cleanup accidentally deleted `resultToJson` and `_getTemporalEaseDims` along with HTML-export / motion-presets blocks. Always `grep` for `^function <name>` and find all callers before removing.

---

## Idempotency cache

```javascript
IDEMPOTENT_TOOLS = { create_layer, create_comp, add_effect, add_mask, add_marker }
```

For these tools, if the caller passes `client_op_id` and that key is already in the in-memory `_idempotencyCache`, the cached result is returned immediately with `deduplicated: true` and the host is **not** called. Successful OK results are written to the cache; failed results are not.

Cache lives in the panel process (cleared on reload or via `clearIdempotencyCache()`). Useful when the model retries after a transient error and would otherwise duplicate work.

---

## Anti-spam guard

```javascript
SPAM_THRESHOLD = 3
_failStreak[key] = { count, lastError }
```

Key = `toolName + JSON.stringify(args)`. After 3 sequential failures for the same key, the 4th attempt is rejected client-side with:

```json
{
  "ok": false,
  "error_code": "RETRY_BLOCKED",
  "message": "Tool X called 4 times with the same arguments and the same error: ..."
}
```

Streak resets to 0 on any successful call for that key. `resetSpamGuard()` is invoked at the start of every `runAgentLoop` so previous-run blocks don't carry over.

Tuned to allow legitimate iterative tuning (3 attempts) but stop pathological spirals (>3 identical failures = always a misunderstanding).

---

## Required-args validation

`_validateRequiredArgs(toolName, args)` returns either `null` or an actionable error string. Triggered cases:

- `add_keyframes` — needs `property_path` + `keyframes[]`
- `apply_expression` — needs `property_path` + `expression`
- `set_property_value` — needs `property_path` + `value`
- `set_text_document` — needs at least one field (text/font/fill_color/...)
- `set_effect_property` — needs `effect_index` + (`property_name` OR `property_index`) + `value`
- `add_shape_ellipse` / `add_shape_rectangle` / `add_shape_path` — needs `layer_id` OR `layer_index` (iter 4 Fix K); `add_shape_path` also needs `vertices.length >= 2`

The error string ALWAYS includes either example values or a recovery hint, so the model can self-correct in one round-trip without going to AE.

---

## Harmony name normalize

```javascript
if (toolName.indexOf('<|') !== -1) toolName = toolName.split('<|')[0].replace(/\s+$/, '')
```

`gpt-oss-120b` occasionally leaks decoder channel separators (`<|channel|>commentary`, `<|end|>`, etc.) into `tool_calls[i].function.name`. Stripping everything from `<|` onward gives the bare tool name. No legitimate tool name contains `<|`.

---

## Undo semantics

`CSInterface.evalScript()` auto-closes the undo group at the end of each call. The bridge cannot span a single undo group across multiple tool calls. Instead:

- Each mutating tool wraps its action in `_beginToolUndo()` / `_endToolUndo()`.
- The panel tracks `lastMutatingToolCount` (mutating tools in last request).
- **Undo button** sends `N × Cmd+Z` via `app.executeCommand(16)`.
- Read-only tools (`get_*`, `list_*`, `capture_*`) are excluded from the count.

---

## Error handling layers (from outermost to AE)

1. **Network** — chatProvider retries on 429/5xx.
2. **Static validation** — `validateExpression` warnings attached to result.
3. **Pre-call validation** — `_validateRequiredArgs` returns fast errors.
4. **Anti-spam** — `RETRY_BLOCKED` after 3 identical failures.
5. **Host bridge** — `evalHostFunction` rejects on `EvalScript error`.
6. **Host try/catch** — returns `{ ok: false, message: 'toolName error: ' + e.toString() }`.
7. **Type hints** — `_validateValueForPath` translates AE's cryptic errors.
8. **Domain hints** — e.g. `add_shape_*` checks `instanceof ShapeLayer` and returns a recovery message.

Each layer adds context, so when the agent sees an error it usually knows exactly how to fix it.
