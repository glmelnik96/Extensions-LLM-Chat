# Host Bridge Notes

How the panel communicates with After Effects.

---

## Execution path

`hostBridge.js` is the bridge between the panel (JavaScript) and After Effects (ExtendScript):

1. **Load once**: `ensureHostScriptLoaded()` reads `host/index.jsx` and evaluates it via `CSInterface.evalScript()` once at startup. This defines all ExtendScript functions in the AE scripting context.

2. **Tool execution**: `executeToolCall(toolName, args)` maps each tool name to an ExtendScript function call via a `switch` statement. Args are JSON-serialized and passed as a string parameter.

3. **Return**: ExtendScript functions return JSON strings via `resultToJson()`. The bridge parses the JSON and resolves the promise. Errors surface as `{ ok: false, message: "..." }`.

---

## ExtendScript function pattern

All host functions follow the same pattern:

```javascript
function extensionsLlmChat_toolName(argsJson) {
  var p = (typeof argsJson === 'string') ? JSON.parse(argsJson) : argsJson;
  app.beginUndoGroup('Tool Name');
  try {
    // ... AE operations ...
    return resultToJson({ ok: true, /* data */ });
  } catch (e) {
    return resultToJson({ ok: false, message: e.toString() });
  } finally {
    app.endUndoGroup();
  }
}
```

Read-only functions (e.g. `get_detailed_comp_summary`) skip the undo group.

---

## Property resolution

`_resolveProperty(layer, pathStr)` is a shared helper that resolves property paths like `Transform>Position` or `Effects>Gaussian Blur>Blurriness`. Used by all property/keyframe/expression tools.

---

## Undo

Each `evalScript()` call auto-closes the undo group when it returns. The panel cannot span a single undo group across multiple tool calls. Instead, the UI counts mutating tool calls (N) and undoes them all with N × `app.executeCommand(16)` (Cmd+Z).

Read-only tools are excluded from the count — see `READ_ONLY_TOOLS` in `main.js`.

---

## Error handling

- `EvalScript error` strings indicate host script failures
- Expression errors: `apply_expression` checks `expressionError` after applying and returns the error to the agent for self-correction
- Static validation: `validateExpression()` in `main.js` catches common mistakes before they reach AE
