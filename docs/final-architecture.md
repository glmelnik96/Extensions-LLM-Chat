# Final architecture

Practical overview of the extension after Stage 5 hardening. No redesign — this describes the implemented behavior.

---

## Stack

- **Panel**: HTML/CSS/JS in a CEP panel; entry point **index.html**, runtime **main.js**.
- **Host**: After Effects via CEP + **CSInterface**; ExtendScript in **host/index.jsx** for comp summary and expression apply.
- **Cloud**: One chat/completions endpoint (configurable baseUrl); requests from the panel; model names configurable (default + fallback).
- **Local assets**: **prompt-library** (generator/validator/repair prompts; future **prompt-library/agent/** for Phase 7), **knowledge-base** (corpus + index), **config** (example + optional runtime overrides + **secrets.local.js** for API key).

---

## Config loading

- **index.html** order: **config/example.config.js** → **config/runtime-config.js** (optional, gitignored) → **config/secrets.local.js** (gitignored, sets **EXTENSIONS_LLM_CHAT_SECRETS.apiKey**).
- **getConfig()** merges secrets into **apiKey** with **EXTENSIONS_LLM_CHAT_CONFIG** for URLs and models. If **apiKey** is empty, **isConfigValid()** is false: status points to **config/secrets.local.js**; Send does not run.
- See **docs/configuration.md** and **docs/secret-handling.md**.

---

## Copilot (today) vs Agent mode (planned)

| | **Copilot (implemented)** | **Agent (Phase 7, not implemented)** |
|--|---------------------------|--------------------------------------|
| **Interaction** | User sends natural language; pipeline returns **one** expression + explanation for **one** target property. | Multi-step **tool loop**: model requests allow-listed host actions, panel executes, feeds results back. |
| **Apply** | **Manual** Apply only when disposition is **acceptable**. | Could batch applies or structured plans under explicit user confirmation (policy TBD). |
| **Expressions** | Single **latestExtractedExpression** per session. | **Multi-target batches** (e.g. several layer/property + expression pairs) and validation — see **docs/north-star-vision-agent.md** Phase 7. |
| **Prompts** | **prompt-library** generator / validator / repair bundles. | Separate **agent** system prompts and tool schemas (stub: **prompt-library/agent/README.md**). |
| **Host** | Read-heavy + **applyExpression** to one target. | Allow-listed mutating tools with undo groups (design only). |

Vision (**Ollama**) and **\[AE_HOST_STATE\]** improve Copilot **grounding**; they do not constitute an agent loop.

---

## Model roles

- **Generator / Validator**: defaultModel (e.g. openai/gpt-oss-120b) for generate, validate1, validate2.
- **Repair**: fallbackModel (e.g. Qwen/Qwen3-Coder-Next) for repair passes.
- **Runtime fallback**: On HTTP/network/malformed response for generator or validator, one retry with fallbackModel; not used for semantic (validation/rules) failure.
- See **docs/pipeline-runtime-flow.md**.

---

## Local knowledge-base and prompt-library

- **Knowledge-base**: Corpus and **knowledge-base/index/corpusIndex.js**; used by docs retrieval (aeDocsIndex, aeDocsRetrieval, aePromptContext) to ground prompts. No remote retrieval; all local.
- **Prompt-library**: **prompt-library/promptsBundle.js** and stage-specific prompts (generator, validator, repair) feed **pipelineAssembly.js** and the pipeline. No replacement with a remote service.

---

## Multi-pass runtime flow

1. **prepare** — getResolvedTarget(), docs retrieval; no model call.
2. **generate** — one cloud call (generator); fallback on failure.
3. **validate1** — one cloud call (validator); fallback on failure.
4. **rules** — deterministic checks; on fail → finalize blocked.
5. **validate2** — second validator pass; fallback on failure.
6. **repair** — up to two passes with repair model if validation failed or warned.
7. **finalize** — set disposition (acceptable | warned_draft | blocked), publish one message, set latestExtractedExpression only when acceptable.

See **docs/pipeline-runtime-flow.md** and **docs/final-result-policy.md**.

---

## Final-only result publication

- Only **one** message is added to the chat per Send: either one **assistant** message (acceptable or warned_draft) or one **system** message (blocked or runtime failure). Generator/validator/repair outputs stay internal. See **docs/chat-publication-policy.md** and **docs/final-disposition-policy.md**.

---

## Manual Apply behavior

- Apply is **manual only**. The pipeline never calls the host apply automatically. **handleApplyExpression()** reads **session.latestExtractedExpression**, resolves target via **getResolvedTarget()**, and calls **CSInterface.evalScript** with the host script; host applies expression and returns a result message. Apply button is enabled only when latestExtractedExpression is set (i.e. disposition was acceptable) and no request in flight. See **docs/manual-apply-policy.md** and **docs/host-bridge-notes.md**.

---

## Diagnostics and troubleshooting

- **diagnostics.js** exposes **window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS**: createLogger, logInfo, logWarn, logError, logDebug, **logPhaseTiming**, reportUserFacingFailure, normalizeRuntimeError, ERROR_CATEGORY, DISPOSITION, setDebug. Pipeline errors are normalized and logged; user-facing messages stay short. Verbose logging: **setDebug(true)** in console. See **docs/runtime-diagnostics.md** and **docs/troubleshooting.md**.

---

## Validating the repo before release

- Run **node scripts/validate-repo.js** and **node scripts/check-required-files.js** from repo root. See **docs/repository-validation.md** and **docs/release-checklist.md**.
