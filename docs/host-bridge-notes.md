# Host bridge notes

How the panel talks to After Effects for target resolution and expression apply.

---

## Entry points

- **Target refresh / layer list**: The panel calls into the host to get the active comp and its layers (and properties). This is used to populate the @ dropdown and to resolve the current target (layer + property).
- **Apply Expression**: The only path that **writes** an expression to the host is **Apply Expression**. The panel calls `CSInterface.evalScript(...)` with the host script that invokes `extensionsLlmChat_applyExpressionToTarget(layerIndex, layerId, propertyPath, expressionText)` (or equivalent). See **host/index.jsx** for the ExtendScript implementation.

---

## Where Apply enters the host

- **handleApplyExpression()** in main.js (or equivalent) is the single UI entry for Apply.
- It reads `session.latestExtractedExpression`, resolves the target via **getResolvedTarget()** (layer index/id and property path), builds the script string, and runs it via **CSInterface.evalScript**.
- The host script (e.g. in host/index.jsx) receives the expression and applies it to the given layer/property; it returns a JSON result (success or error message) that the panel shows as a system message.

So **all** expression application goes: User click Apply → handleApplyExpression → getResolvedTarget → evalScript(host script) → host applies to layer/property → result back to panel.

---

## Conditions for Apply to be enabled

- Active session exists.
- **session.latestExtractedExpression** is set (non-null) — i.e. last pipeline result was **acceptable**.
- No request in flight.

The host does not decide whether Apply is enabled; the panel does, based on pipeline disposition. See **docs/manual-apply-policy.md**.

---

## Invalid target / unsupported property

- If the user deletes the layer or changes comp, **getResolvedTarget()** may still return the old indices; the host may then return an error (e.g. "layer not found").
- Some properties may not support expression application in the host implementation; the host returns an error and the panel shows it as a system message.
- The panel does not auto-apply when the target becomes invalid; the user must refresh target (@) and/or run Apply again after fixing the comp.

---

## No auto-apply

- The pipeline never calls the host apply logic automatically. Apply is **manual only**. Any legacy or unused auto-apply codepaths are deprecated and not wired to the pipeline. See **docs/manual-apply-policy.md**.
