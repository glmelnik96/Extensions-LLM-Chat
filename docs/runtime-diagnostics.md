# Runtime diagnostics

The extension uses a small diagnostics layer for logging and error handling without cluttering the chat.

---

## Module

- **diagnostics.js** loads before main.js (see index.html). It attaches **window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS**.

---

## Helpers

- **createLogger(options)** — options: `{ debug: boolean, prefix: string }`. Returns an object with info, warn, error, debugLog. Use for component-specific loggers.
- **logInfo(...args)** — console.info with prefix.
- **logWarn(...args)** — console.warn with prefix.
- **logError(...args)** — console.error with prefix.
- **logDebug(...args)** — only logs if debug is enabled (see setDebug).
- **sanitizeForLog(str, maxLen)** — returns a safe string for logging: truncates to maxLen (default 80), collapses whitespace. Never pass apiKey, full config, or full message bodies; use for short samples only.
- **logPhaseTiming(phase, elapsedMs, safeDetail)** — logs `[timing] <phase> <N>ms <detail>` only when **setDebug(true)**. Used for **capture_macos**, **ollama_vision_ui**, **ollama_vision_frame**. Keep **safeDetail** non-sensitive (e.g. `ok` / `error`).
- **reportUserFacingFailure(shortMessage, category, internalDetail)** — returns the short message; can log internalDetail when debug is on. Use to keep user messages concise.
- **normalizeRuntimeError(err)** — turns an error into `{ category, message, userMessage }`. userMessage is safe to show in chat; category is for logging.

---

## Error categories (ERROR_CATEGORY)

- configuration  
- network_transport  
- http  
- malformed_response  
- prompt_assembly  
- knowledge_loading  
- rules_block  
- validation_rejection  
- repair_exhaustion  
- host_apply  
- target_resolution  
- local_vision (Ollama analyze UI/frame failures)  
- capture_macos (screen capture subprocess failures)  
- unknown  

Used internally for logging and for mapping to user-facing text (e.g. "Configuration missing or invalid", "Network error", "Invalid response from cloud model").

---

## Disposition (DISPOSITION)

- success  
- warned  
- blocked  
- runtime_failure  

Used to align pipeline outcome with the final disposition policy (see docs/final-disposition-policy.md).

---

## Enabling verbose logging

In the CEP developer console (Debug → Show Developer Tools):

```js
window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS.setDebug(true)
```

Logs go to the console only; the chat transcript is not filled with internal pipeline output.

---

## Pipeline debug log points (when debug is on)

Main.js emits **logDebug** only when **setDebug(true)**. Use these to see where the pipeline failed:

| Log prefix / content | Meaning |
|----------------------|--------|
| `[pipeline] flow started` | Send triggered; pipeline began. |
| `[pipeline] stage=<name> entry` | Stage entered: **generate**, **validate1**, **rules**, **validate2**, **repair**, **finalize**. |
| `[pipeline] stage=generate exit ok \| blocked` | Generator finished; **blocked** = no valid expression extracted. |
| `[pipeline] stage=validate1 exit <status>` | First validator pass finished; status = pass \| warn \| fail \| unknown. |
| `[pipeline] stage=rules exit ok \| blocked` | Deterministic rules passed or blocked. |
| `[pipeline] stage=validate2 exit <status>` | Second validator pass finished. |
| `[pipeline] stage=repair entry attempt=N` | Repair pass started (N = 1 or 2). |
| `[pipeline] stage=repair exit ok \| rules blocked after repair \| extraction failed, exhausted retries` | Repair finished. |
| `[pipeline] flow failed <sample>` | Pipeline threw (e.g. rules block, generator no expression, network). Sample is sanitized (≤80 chars). |
| `[pipeline] generator parse failed; using fallback extraction <sample>` | Structured JSON parse failed; expression was taken from text before ---EXPLANATION---. |
| `[pipeline] validator parse failed; status=unknown <sample>` | Report JSON between ---REPORT--- and ---END--- could not be parsed (e.g. wrapped in code fences). |
| `[pipeline] repair extraction failed attempt=N <sample>` | Repair response had no extractable expression before ---EXPLANATION---. |
| `[pipeline] fallback model activation <model> primary failed <sample>` | Primary model call failed (HTTP/network/malformed); retrying with fallback model. |
| `[pipeline] prompt assembly degraded to inline <role>` | PIPELINE_ASSEMBLY or KB missing; using built-in inline prompt for **generator**, **validator**, or **repair**. |
| `[pipeline] JSON block had outer fences stripped before parse` | Validator or generator JSON was wrapped in markdown code fences; parser stripped outer fences and parsed successfully. |
| `[timing] capture_macos …` | **screencapture** finished (success or fail). |
| `[timing] ollama_vision_ui …` / `ollama_vision_frame …` | Local Ollama **/api/chat** with image finished. |

No secrets are logged: no apiKey, no full config, no full request/response bodies. Samples are truncated via **sanitizeForLog**.

---

## Usage in main.js

- On pipeline catch: **normalizeRuntimeError(err)** to get userMessage; **logError** for category and raw err; push only userMessage (or a short string) into the system message.
- On startup: if **!isConfigValid()**, **logWarn** and **updateStatus** with the config message.
- User-facing messages stay short; internal detail stays in logs.
