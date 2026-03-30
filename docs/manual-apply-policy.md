# Manual Apply Policy

This document states the Apply behavior of the extension after the Stage 3 pipeline is in place.

---

## Manual Apply only

- **Apply is only manual.** The user must click **Apply Expression** to send the current **latestExtractedExpression** to the host and apply it to the selected layer/property.
- There is **no auto-apply** in the production pipeline. The function **autoApplyExpressionForTarget** exists in the codebase for legacy/compatibility but is **not** called from the active send path or from the pipeline.
- The pipeline never calls the host apply logic automatically when a result is produced; it only updates **session.latestExtractedExpression** when the final disposition is **acceptable**, so that the Apply button becomes enabled and the user can apply manually when they choose.

---

## When Apply is enabled

- The Apply button is enabled only when:
  - There is an active session,
  - **session.latestExtractedExpression** is set (non-null),
  - No request is in flight (**isRequestInFlight** is false).

The pipeline sets **latestExtractedExpression** only when the final disposition is **acceptable**. For **warned_draft** and **blocked**, it is set to null, so Apply remains disabled.

---

## Apply flow (unchanged)

- **handleApplyExpression()** is the only entry point for Apply. It:
  - Reads **session.latestExtractedExpression**,
  - Resolves the target via **getResolvedTarget()**,
  - Builds the host script call **extensionsLlmChat_applyExpressionToTarget(layerIndex, layerId, propertyPath, expressionText)**,
  - Uses **CSInterface.evalScript** with the host script content,
  - Parses the JSON result and adds a **system** message to the chat with the host’s message (success or error).

- **refreshActiveCompFromHost()**, target dropdowns, **updateTargetSummary()**, **updatePromptTargetLine()**, and **getResolvedTarget()** are unchanged. The pipeline does not alter the host communication model or the selected-target semantics.

See **docs/host-bridge-notes.md** for where Apply enters the host and conditions for Apply.

---

## Summary

- Manual Apply only; no auto-apply.
- Apply enabled only when pipeline has set **latestExtractedExpression** (i.e. disposition **acceptable**).
- **handleApplyExpression()** and the host bridge remain the single apply path; the new pipeline does not replace or bypass them.
