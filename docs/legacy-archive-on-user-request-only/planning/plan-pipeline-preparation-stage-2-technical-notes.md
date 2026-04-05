# Pipeline Preparation Notes (Stage 2)

Short technical notes for implementers: where pipeline state and wrappers live, and where Stage 3 should plug in.

---

## Session pipeline state

- **Location**: `session.pipeline` (optional; created on first use via `ensureSessionPipelineState(session)`).
- **Schema**: `stage`, `status`, `currentAttempt`, `finalDisposition`, `userStatusText`, `draftAvailable`, `manualApplyOnly`.
- **When set**: New sessions get it in `createSession()`. Cleared sessions get it reset in `handleClearSession()`. Loaded sessions get it when `runCurrentSinglePassFlow` (or later `runPipelineFlow`) runs.
- **Persistence**: `persistState()` saves `state.sessions` as-is; if a session has `pipeline`, it is stored. Old sessions without `pipeline` remain valid and gain `pipeline` in memory on first send.

---

## Pipeline helpers (main.js)

| Helper | Purpose |
|--------|--------|
| `ensureSessionPipelineState(session)` | Ensure `session.pipeline` exists; no-op if already present. |
| `setPipelineStage(session, stage, status, userStatusText)` | Update pipeline fields and, if `userStatusText` is provided, call `updateStatus(userStatusText)`. |
| `resetPipelineState(session)` | Set pipeline back to default idle state. |
| `finalizePipelineState(session, disposition, statusText)` | Set pipeline to idle, set `finalDisposition` and `userStatusText`, call `updateStatus(statusText)`. |

---

## Cloud request layer (main.js)

| Function | Purpose |
|----------|--------|
| `buildSinglePassPayload(session)` | Build messages + docs + target context; returns `{ payloadMessages, docsRetrieval, targetSnapshot }`. |
| `invokeCloudChat(model, payloadMessages)` | POST to cloud chat/completions; returns promise of raw response data. |
| `normalizeChatResponse(data)` | Return `{ content }` from response; throw if malformed. |
| `processAssistantResponse(content, session, docsRetrieval)` | Annotate (if validation available), push assistant message, extract expression, set `latestExtractedExpression`, render, persist. |
| `callOllamaForSession(session)` | Uses the four above for one request; same behavior as before refactor. |

---

## Send flow entry points

| Function | Current role |
|----------|---------------|
| `runCurrentSinglePassFlow(session)` | Single-pass flow with pipeline state and status updates. Called from `handleSend`. |
| `runPipelineFlow(session, userText)` | Placeholder for Stage 3 multi-pass. Currently delegates to `runCurrentSinglePassFlow(session)`. |

**Stage 3**: Implement multi-pass inside `runPipelineFlow(session, userText)`; optionally make `handleSend` call `runPipelineFlow` instead of `runCurrentSinglePassFlow`. Do not remove `runCurrentSinglePassFlow` until the new pipeline is verified (it can remain as fallback or for tests).

---

## What not to change

- **Targeting**: `getResolvedTarget()`, `refreshActiveCompFromHost()`, target dropdowns — semantics unchanged.
- **Apply**: `handleApplyExpression()` and host `extensionsLlmChat_applyExpressionToTarget` — manual only; no auto-apply.
- **Session persistence**: Existing fields (`id`, `title`, `createdAt`, `updatedAt`, `model`, `messages`, `latestExtractedExpression`) unchanged. Only additive `pipeline` field.
- **Expression extraction**: `extractExpressionFromResponse` and `sanitizeExpression` — single final expression for Apply; pipeline must still write result to `session.latestExtractedExpression`.

---

## Scaffolds added in Stage 2

- **prompt-library/** — README + `generator/`, `validator/`, `repair/` (empty). For Stage 4 role-specific prompts.
- **knowledge-base/** — README only. For Stage 4 corpus and three projections.

See **staged-implementation-plan.md** (this folder) for Stage 3 and 4 scope and definition of done.
