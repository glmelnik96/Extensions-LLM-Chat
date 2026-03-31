# Manual Apply Policy

> **Legacy.** Относится к **историческому multi-pass expression pipeline** с кнопкой **Apply Expression** и полем **session.latestExtractedExpression**.  
> **Текущая панель:** изменения в композиции выполняются через **инструменты агента** (в т.ч. **apply_expression** при необходимости). См. **[capabilities-and-roadmap.md](capabilities-and-roadmap.md)** и **[host-bridge-notes.md](host-bridge-notes.md)**.

The text below is kept for reference if the manual Apply flow is restored from older code paths.

---

## Manual Apply only (historical)

- **Apply is only manual.** The user must click **Apply Expression** to send the current **latestExtractedExpression** to the host and apply it to the selected layer/property.
- There is **no auto-apply** in the production pipeline. The function **autoApplyExpressionForTarget** may exist for legacy/compatibility but is **not** called from the active send path or from the pipeline.
- The pipeline never calls the host apply logic automatically when a result is produced; it only updates **session.latestExtractedExpression** when the final disposition is **acceptable**, so that the Apply button becomes enabled and the user can apply manually when they choose.

---

## When Apply is enabled (historical)

- The Apply button is enabled only when:
  - There is an active session,
  - **session.latestExtractedExpression** is set (non-null),
  - No request is in flight (**isRequestInFlight** is false).

The pipeline sets **latestExtractedExpression** only when the final disposition is **acceptable**. For **warned_draft** and **blocked**, it is set to null, so Apply remains disabled.

---

## Apply flow (historical)

- **handleApplyExpression()** is the only entry point for Apply. It:
  - Reads **session.latestExtractedExpression**,
  - Resolves the target via **getResolvedTarget()**,
  - Builds the host script call **extensionsLlmChat_applyExpressionToTarget(layerIndex, layerId, propertyPath, expressionText)**,
  - Uses **CSInterface.evalScript** with the host script content,
  - Parses the JSON result and adds a **system** message to the chat with the host’s message (success or error).

See **docs/host-bridge-notes.md** (current agent path) for how tools reach the host today.
