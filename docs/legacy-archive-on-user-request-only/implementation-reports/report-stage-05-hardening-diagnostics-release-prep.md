# Stage 5 hardening report

Summary of production hardening, diagnostics, safety cleanup, QA readiness, and release preparation. No change to core product behavior or architecture.

---

## Summary of hardening work

- **Configuration**: Centralized config (getConfig, isConfigValid); example config committed, runtime-config local and gitignored; Send blocked with clear status when API key missing; startup status and logging when config invalid.
- **Diagnostics**: Lightweight diagnostics.js with createLogger, logInfo/logWarn/logError/logDebug, reportUserFacingFailure, normalizeRuntimeError, ERROR_CATEGORY, DISPOSITION; pipeline catch uses normalized user message; no internal pipeline noise in chat.
- **Failure handling**: Clear distinction between blocked (semantic), runtime_failure (infrastructure), warned, success; final disposition and apply-ready state documented and preserved.
- **Repository validation**: scripts/validate-repo.js and scripts/check-required-files.js; [../../repository-validation.md](../../repository-validation.md).
- **QA and release**: qa-test-plan.md, manual-test-matrix.md, troubleshooting.md, release-checklist.md; final-disposition-policy, chat-publication-policy, host-bridge-notes; final-architecture, runtime-diagnostics, deployment-notes.
- **Startup**: Graceful handling of missing config (status + log); no session wipe on config failure.
- **Documentation**: Policy and deployment docs aligned with implemented behavior; no redesign.

---

## Modified and created files

**Modified**

- **index.html** — Added script tags for config/example.config.js and diagnostics.js (before other app scripts).
- **main.js** — getConfig(), isConfigValid(), variables from config at load; config check in init and in handleSend; pipeline catch uses EXTENSIONS_LLM_CHAT_DIAGNOSTICS.normalizeRuntimeError and short user message; CLOUD_API_KEY and URL from config.

**Created**

- **config/README.md**, **config/example.config.js** (already present; confirmed).
- **.gitignore** — config/runtime-config.js, .DS_Store, etc. (already present; confirmed).
- **docs/configuration.md**, **docs/secret-handling.md** (already present; confirmed).
- **diagnostics.js** — Logger and error taxonomy.
- **scripts/validate-repo.js**, **scripts/check-required-files.js** — Repo and required-files checks.
- **docs/repository-validation.md** — How to run validation scripts.
- **docs/qa-test-plan.md** — Step-by-step QA scenarios.
- **docs/manual-test-matrix.md** — Compact pass/fail matrix.
- **docs/troubleshooting.md** — Common issues and fixes.
- **docs/release-checklist.md** — Pre-release and deployment checklist.
- **docs/final-disposition-policy.md** — When latestExtractedExpression and Apply are set; blocked vs runtime failure.
- **docs/chat-publication-policy.md** — Final-only chat output.
- **docs/host-bridge-notes.md** — Where Apply enters the host; conditions for Apply.
- **docs/final-architecture.md** — Config, model roles, knowledge-base, prompt-library, multi-pass, final-only output, manual Apply, diagnostics, repo validation.
- **docs/runtime-diagnostics.md** — Diagnostics API and error categories.
- **docs/deployment-notes.md** — Install, config, host script, packaging.
- **docs/stage-5-hardening-report.md** — This file.

---

## Configuration changes

- **Source**: window.EXTENSIONS_LLM_CHAT_CONFIG set by config/example.config.js (or config/runtime-config.js). Load order: config script first in index.html.
- **main.js**: getConfig() returns apiKey, baseUrl, defaultModel, fallbackModel with safe fallbacks; CLOUD_API_KEY, CLOUD_API_CHAT_COMPLETIONS, DEFAULT_MODEL, FALLBACK_MODEL are set once from getConfig() at load.
- **Validation**: isConfigValid() is true only when apiKey is non-empty string. When false: updateStatus("Set API key in config. See config/README.md") in init and in handleSend; Send does not send.
- **Secrets**: Real keys only in runtime-config.js (local, gitignored). See [../../configuration.md](../../configuration.md) and [../../secret-handling.md](../../secret-handling.md).

---

## Diagnostics and error-handling layer

- **diagnostics.js**: createLogger (info, warn, error, debugLog); logInfo, logWarn, logError, logDebug; reportUserFacingFailure; normalizeRuntimeError(err) → { category, message, userMessage }; ERROR_CATEGORY (configuration, network_transport, http, malformed_response, etc.); DISPOSITION (success, warned, blocked, runtime_failure); setDebug(true) for verbose logs.
- **main.js**: On pipeline catch, normalizeRuntimeError used to get userMessage; logError with category; only userMessage (or short string) pushed to system message. On init, if !isConfigValid(), logWarn and updateStatus.
- User-facing messages stay concise; internal detail in console only.

---

## QA and release docs added

- **qa-test-plan.md**: Startup (panel, missing config, valid config); sessions (create, switch, rename, clear, clear all, persistence); target (refresh, layer/property selection, no comp); pipeline (happy path, blocked, warned, repair); failures (missing config, network, malformed response); manual Apply (success, invalid target, unsupported property); no auto-apply; final-only output.
- **manual-test-matrix.md**: Compact checklist (25 items) for sign-off.
- **troubleshooting.md**: Panel blank, config message, Send does nothing, cloud error, blocked/warned, Apply disabled, Apply host error, sessions lost, debug logging, repo validation.
- **release-checklist.md**: Pre-release validation (scripts, config, docs), functional QA, deployment (manifest, host, paths), post-release (no secrets in artifact).

---

## Preserved behavior

- Panel startup and session create/switch/rename/clear/clear all and persistence unchanged.
- Target refresh and selection and getResolvedTarget() unchanged.
- Final-only user-facing result publication unchanged.
- latestExtractedExpression set only for acceptable; Apply enabled only when it is set and no request in flight.
- Manual Apply only; handleApplyExpression → getResolvedTarget → CSInterface.evalScript(host) unchanged.
- CEP, CSInterface, host ExtendScript integration unchanged.
- Multi-pass pipeline (prepare → generate → validate1 → rules → validate2 → repair → finalize) and disposition logic unchanged.
- No auto-apply; no backend orchestration; local knowledge-base and prompt-library unchanged.

---

## Intentionally deferred (not bugs)

- **Optional runtime-config in index.html**: By default the panel loads example.config.js; switching to runtime-config.js is a local edit documented in config/README.md. No automatic detection of runtime-config.js to avoid silent fallback and to keep behavior explicit.
- **Session storage format**: No schema change; existing sessions remain compatible. Any future schema change would be versioned and backward-compatible.
- **Auto-apply codepaths**: Legacy/compatibility code (e.g. autoApplyExpressionForTarget) remains but is not called from the pipeline; marked in docs as deprecated/inactive. No removal to avoid unnecessary code churn; docs state manual-only policy.
- **Heavy build system**: No new bundler or test runner added; validation scripts are plain Node. Kept minimal for maintainability.
- **Remote knowledge retrieval**: Not introduced; local knowledge-base remains the only source.

---

## How to validate before release

1. Run `node scripts/validate-repo.js` and `node scripts/check-required-files.js` from repo root.
2. Follow [../../release-checklist.md](../../release-checklist.md) (config, QA, deployment).
3. Execute scenarios from [../../qa-test-plan.md](../../qa-test-plan.md) and mark [../qa-testing/qa-manual-test-matrix-compact-pass-fail.md](../qa-testing/qa-manual-test-matrix-compact-pass-fail.md).

Stage 5 hardening is complete when the panel runs, sessions and target work, the pipeline produces final-only output, manual Apply works, config is safe and documented, diagnostics are available, and the above docs and scripts are in place.
