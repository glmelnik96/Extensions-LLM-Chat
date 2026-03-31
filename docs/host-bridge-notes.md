# Host bridge notes

How the panel talks to After Effects in the **AE Motion Agent** build.

**Tool list and behavior:** **[capabilities-and-roadmap.md](capabilities-and-roadmap.md)**.

---

## Primary path: `hostBridge.js`

- **hostBridge.js** loads **host/index.jsx** (cached), builds a single **evalScript** string, and runs **CSInterface.evalScript**.
- **executeToolCall(toolName, args)** maps each OpenAI-style tool name to an ExtendScript function call (see the `switch` / registry in **hostBridge.js**).
- Return values are JSON strings from the host, parsed in JS; errors surface as rejected promises or structured `{ ok: false, message }` payloads depending on the tool.

So **mutating** the comp (layers, keyframes, effects, expressions, etc.) happens **inside the agent loop**, when the model emits a **tool_calls** entry — not via a separate **Apply Expression** button in the current UI.

---

## Legacy: manual Apply + target dropdown

Earlier versions documented:

- **Apply Expression** → **handleApplyExpression** → **latestExtractedExpression** → **extensionsLlmChat_applyExpressionToTarget** (or similar).
- **@** target refresh for layer/property dropdowns.

That flow is **not** present in the current **main.js**. ExtendScript in **host/index.jsx** may still contain helpers used only by specific tools (e.g. **apply_expression** as a named agent tool). If you reintroduce manual Apply, reuse **docs/manual-apply-policy.md** (legacy) and wire UI accordingly.

---

## Undo

- The panel **Undo** button triggers After Effects undo; host operations should remain inside **app.beginUndoGroup** / **endUndoGroup** in ExtendScript where applicable.

---

## Diagnostics

- EvalScript failures often appear as strings starting with `EvalScript error`; **hostBridge** surfaces these to the agent loop as tool errors.
