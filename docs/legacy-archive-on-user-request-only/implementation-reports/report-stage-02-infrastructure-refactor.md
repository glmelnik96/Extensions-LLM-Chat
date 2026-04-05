# Stage 2 Refactor Report

This document describes what was changed in Stage 2 (infrastructure refactor), what was deliberately not implemented yet, and what the next stage will plug into.

---

## What changed in this stage

### 1. Session-level pipeline runtime state

- **Added** a minimal `session.pipeline` object, initialized only when missing (backward compatible with existing persisted sessions):
  - `stage`, `status`, `currentAttempt`, `finalDisposition`, `userStatusText`, `draftAvailable`, `manualApplyOnly`
- **Helpers**: `ensureSessionPipelineState(session)`, `setPipelineStage(session, stage, status, userStatusText)`, `resetPipelineState(session)`, `finalizePipelineState(session, disposition, statusText)`.
- New sessions get pipeline state in `createSession()` via `ensureSessionPipelineState(session)`. Cleared sessions get pipeline reset in `handleClearSession()` via `resetPipelineState(session)`.
- Old sessions loaded from localStorage do not have `pipeline` until first use; `ensureSessionPipelineState(session)` is called at the start of `runCurrentSinglePassFlow(session)`, so pipeline is added in memory when needed. Persistence then saves the extended session. No migration or schema change required for existing data.

### 2. Centralized status handling

- Status line and model status are still updated via `updateStatus(text)` and `updateModelStatus(status, label)`.
- Pipeline helpers drive status where appropriate: `setPipelineStage(..., userStatusText)` and `finalizePipelineState(..., statusText)` call `updateStatus(...)`, so future pipeline stages (e.g. “Generating expression”, “Validating”, “Repairing”) can use the same path without changing the UI contract.
- Current visible behavior is unchanged: the same status strings appear during send (e.g. “Отправка запроса к облачной модели...”, “Готово.”, “Ошибка при обращении к облачному API.”).

### 3. Reusable cloud request building blocks

- **buildSinglePassPayload(session)** — assembles `payloadMessages`, docs context, and target instruction; returns `{ payloadMessages, docsRetrieval, targetSnapshot }`.
- **invokeCloudChat(model, payloadMessages)** — single fetch to cloud chat/completions; returns a promise that resolves with raw API response data (or rejects on HTTP/network error).
- **normalizeChatResponse(data)** — extracts `{ content: string }` from response; throws on malformed response.
- **processAssistantResponse(content, session, docsRetrieval)** — optional validation annotation, push assistant message, extract expression into `session.latestExtractedExpression`, push system message if no expression, render transcript, persist.
- **callOllamaForSession(session)** — refactored to use the four helpers above; behavior unchanged from the user’s perspective.

### 4. Current working path vs future pipeline path

- **runCurrentSinglePassFlow(session)** — top-level wrapper for the current single-pass flow:
  - Ensures pipeline state, resets it, sets stage/status and status text (“Отправка запроса к облачной модели...”).
  - Calls `callOllamaForSession(session)`.
  - On success: `finalizePipelineState(session, 'success', 'Готово.')`.
  - On error: `finalizePipelineState(session, 'error', 'Ошибка при обращении к облачному API.')` and rethrows so `handleSend`’s `.catch` can push the error message and update model status.
- **runPipelineFlow(session, userText)** — reserved placeholder for Stage 3. Currently delegates to `runCurrentSinglePassFlow(session)` so the extension still works if `handleSend` is later switched to call `runPipelineFlow`. Stage 3 will replace the body with multi-pass orchestration.
- **handleSend()** now calls `runCurrentSinglePassFlow(session)` instead of `callOllamaForSession(session)` directly. User message push, input clear, render, persist, `isRequestInFlight`, and `.catch`/`.finally` (error message, button updates, status) are unchanged.

### 5. Targeting and Apply behavior

- **Unchanged**: `refreshActiveCompFromHost()`, target dropdown behavior, `getResolvedTarget()`, `handleApplyExpression()`, host-side apply transport (`extensionsLlmChat_applyExpressionToTarget`). No semantic changes; manual Apply remains the only apply path.

### 6. Prompt library and knowledge base scaffolds

- **prompt-library/** — created with `README.md` and subdirectories `generator/`, `validator/`, `repair/` (with `.gitkeep`). Intent and expected contents are described in the README; no prompt content added in Stage 2.
- **knowledge-base/** — created with `README.md` describing primary (Adobe Help Center) and secondary (docsforadobe) sources and the three projections. No corpus or index implementation in Stage 2.

### 7. Documentation

- **docs/stage-2-refactor-report.md** (this file) — what changed, what was not implemented, how behavior was preserved.
- **docs/pipeline-preparation-notes.md** — technical notes for implementers: wrappers, state, and where Stage 3 will plug in.
- **cursor-prompts/README.md** — updated to mention the new prompt-library and knowledge-base scaffolds.

---

## What was deliberately not implemented yet

- **Multi-pass pipeline** — no generator/validator/repair roles or sequential model calls. Single-pass only.
- **Fallback-on-transport-error** — the existing `callOllamaWithFallback` is still present but not wired; Stage 3 can use it or the new `invokeCloudChat` wrapper to implement fallback.
- **Role-specific prompt injection** — prompts still come from `systemPrompt.js` and the existing docs context in `buildSinglePassPayload`; no use of prompt-library or knowledge-base yet.
- **Auto-apply** — not introduced; Apply remains manual only.
- **Heavy frameworks or build/server** — no new build system or server dependency.

---

## How the new wrappers preserve current behavior

- **runCurrentSinglePassFlow** performs the same sequence as the old `handleSend` → `callOllamaForSession`: one request, one assistant message, one extraction into `latestExtractedExpression`, same status strings and button state. The only addition is reading/writing `session.pipeline`, which is additive and not yet used to change control flow.
- **buildSinglePassPayload** is the same logic that previously lived inside `callOllamaForSession`; **invokeCloudChat** is the same fetch; **normalizeChatResponse** and **processAssistantResponse** are the same parsing and side effects. So the observable outcome of Send (message in transcript, expression available for Apply, status line) is identical.
- **handleSend** still pushes the user message, clears input, sets `isRequestInFlight`, and in `.catch` adds the system error message and in `.finally` resets `isRequestInFlight` and updates buttons. The only change is that the “send” step is `runCurrentSinglePassFlow(session)` instead of `callOllamaForSession(session)`.

---

## What the next stage (Stage 3) will plug into

1. **runPipelineFlow(session, userText)** — Replace the body with multi-pass orchestration (generate → validate-1 → validate-2 → repair when needed). Optionally switch `handleSend` to call `runPipelineFlow` instead of `runCurrentSinglePassFlow` so one code path drives the UI.
2. **setPipelineStage(session, stage, status, userStatusText)** — Use this to drive status text for each stage (e.g. “Generating expression”, “Validating”, “Repairing”).
3. **buildSinglePassPayload** / **invokeCloudChat** / **normalizeChatResponse** / **processAssistantResponse** — Reuse for each model call in the pipeline; possibly introduce role-specific payload builders (e.g. buildValidatorPayload) that use the same `invokeCloudChat` and normalization.
4. **session.pipeline** — Use for optional UI or logic (e.g. showing current stage, or limiting retries) without changing the existing session fields or persistence contract.
5. **prompt-library/** and **knowledge-base/** — Stage 4 will populate and connect these; Stage 3 can still use the existing system prompt and docs context.

See **[../planning/plan-pipeline-preparation-stage-2-technical-notes.md](../planning/plan-pipeline-preparation-stage-2-technical-notes.md)** for concise implementation notes.
