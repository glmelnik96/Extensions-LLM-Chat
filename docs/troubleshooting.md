# Troubleshooting

Common issues when the **AE Motion Agent** panel misbehaves. Sections below still mention the **legacy multi-pass Copilot** pipeline (`latestExtractedExpression`, Apply, validator stages) where useful for old builds or diagnostics strings — full policy text is in **`docs/legacy-archive-on-user-request-only/`** (open only when you need history).

**Current product:** [capabilities-and-roadmap.md](capabilities-and-roadmap.md), [final-architecture.md](final-architecture.md).

---

## Panel won’t open or is blank

- **CEP / host**: Ensure After Effects version matches the CEP host and manifest (CSXS/manifest.xml). Check CEP debug logs if available.
- **Script load order**: Config and diagnostics must load before main.js (see index.html). If a script fails to load, the panel may be blank; check browser devtools (Debug → Show Developer Tools in CEP).
- **CSInterface**: If `CSInterface` is undefined, the extension is not running inside CEP; panel logic may disable host-dependent features.

---

## "Set API key in config/secrets.local.js. See config/README.md"

- **Cause**: `EXTENSIONS_LLM_CHAT_SECRETS.apiKey` and `EXTENSIONS_LLM_CHAT_CONFIG.apiKey` are both empty or missing, or `secrets.local.js` failed to load (404).
- **Fix**: `cp config/secrets.local.example.js config/secrets.local.js`, paste your Cloud.ru Bearer token into `apiKey` (no `Bearer ` prefix). Ensure `index.html` loads `secrets.local.js` after `example.config.js`. See **docs/secret-handling.md**.

---

## Send does nothing

- **Config**: If API key is empty, Send is intentionally no-op and status shows the config message.
- **Session**: There must be an active session (create one with New if needed).
- **In flight**: While a request is in progress, Send is disabled; wait for completion or error.

---

## "Error contacting cloud model: …"

- **Network**: Check internet connection and firewall; ensure the API base URL is reachable from your machine.
- **HTTP**: 4xx/5xx from the API (wrong key, quota, or endpoint) → check baseUrl and apiKey; see docs/configuration.md.
- **Malformed response**: API returned non-JSON or missing `choices`/content; extension may retry with fallback model once. If it keeps failing, check API response format.

Internal details are in the browser console (diagnostics layer); user-facing text is kept short (see docs/runtime-diagnostics.md).

---

## Agent run failed or tool errors

- **Cloud / Ollama**: Same as "Error contacting cloud model" above; check key, base URL, and model id.
- **Tool / host error**: Read the **tool call** card in the chat (args + result). For expression errors, fix the prompt or layer index; see [capabilities-and-roadmap.md](capabilities-and-roadmap.md) (limitations).
- **Debug**: `window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS.setDebug(true)` in the CEP console — see [runtime-diagnostics.md](runtime-diagnostics.md).

---

## Legacy: pipeline "Failed / blocked" (multi-pass Copilot)

If you maintain an old build with generator → validate → repair:

- **Rules / validation / repair** failures and **latestExtractedExpression** rules are documented only in the archive — stubs: [final-result-policy.md](final-result-policy.md), [final-disposition-policy.md](final-disposition-policy.md). Console `[pipeline]` stage hints apply to that flow.

---

## Legacy: Apply button stays disabled

The shipping **AE Motion Agent** UI has no separate **Apply Expression** button; expressions are applied via the **apply_expression** tool when the model chooses it. For historical Apply + `latestExtractedExpression` behavior see [manual-apply-policy.md](manual-apply-policy.md) and [final-result-policy.md](final-result-policy.md) (stubs → archive).

---

## Legacy: Apply clicked but host reports error

Applies to old UI with manual Apply: invalid target, unsupported property, host script — see [host-bridge-notes.md](host-bridge-notes.md) and **host/index.jsx**.

---

## Ollama vision errors

- **Connection / timeout**: Ensure **Ollama** is running (`ollama serve`) and vision models are pulled (defaults: `ollama pull llava-phi3:latest`, `ollama pull moondream:latest`). Increase `ollamaVisionTimeoutMs` in config for large images or slow hardware.
- **Empty content**: Model may not support images; try `ollamaVisionFallbackModel` or a different tag from the Ollama library.
- **HTTP 500 / “received zero length image”**: The PNG was missing, still 0 bytes, or not a valid PNG when Ollama read it. Wait and retry **Analyze frame**; ensure the host returns a real path (`fsName`) and disk flush completed. The panel waits for a minimum file size and PNG signature before posting to Ollama.
- **HTTP 500 / “model runner has unexpectedly stopped”**: Often **GPU VRAM** or **image too large** for the vision model. The panel **downscales** PNGs on macOS so the longest edge is at most **`ollamaVisionMaxEdgePx`** (default **1024**) via `sips` before calling Ollama. If it still crashes, set **`ollamaVisionMaxEdgePx`** to **768** or **512** in config, restart Ollama, close other GPU apps, or temporarily use **CPU-only** Ollama if your setup supports it. Check `~/.ollama/logs` or the terminal where `ollama serve` runs.
- **Frame export**: If you see `saveFrameToPng` missing, update After Effects or use **Capture full screen** / **Capture comp area** instead of **Analyze frame**.

---

## Clear All and Ollama

- **Clear All** removes extension temp capture PNGs and calls Ollama **`GET /api/ps`** then **`POST /api/generate`** with **`keep_alive: 0`** for each loaded model so they unload from memory. If Ollama is not running, that step fails silently (sessions still clear).
- Ollama’s HTTP API does **not** store a global chat transcript for the extension; unloading is the supported way to reset in-memory model state. Persistent logs (if any) live outside this panel.

---

## Sessions lost after reload

- Sessions are persisted in localStorage (or equivalent) keyed by the extension. If the storage key or origin changes, previous sessions may not appear. Do not clear site data for the CEP origin if you need to keep sessions.

---

## Screen capture disabled or "Node not available"

- **Cause**: CEP panel does not have Node enabled, or `lib/captureMacOS.js` did not load.
- **Fix**: Confirm `CSXS/manifest.xml` includes `<Parameter>--enable-nodejs</Parameter>` and `<Parameter>--mixed-context</Parameter>`. Reload the panel (or restart After Effects). Confirm `index.html` loads `lib/captureMacOS.js` before `main.js`.

## "No After Effects window found for comp-area capture"

- **AE 2024 / year-suffixed process**: The panel discovers AE via **System Events** (frontmost app or any process whose name contains `After Effects`, excluding Render Engine). If it still fails, grant **Automation**: **System Settings → Privacy & Security → Automation** — allow **After Effects** to control **System Events**.
- **Focus**: Click the main AE window (or the CEP panel inside AE) so After Effects stays the frontmost app, then try **Capture comp area** again.
- **Fallback**: Use **Capture full screen** (no AppleScript).

## Capture fails / permission

- **Cause**: macOS blocked screen capture for After Effects.
- **Fix**: **System Settings → Privacy & Security → Screen Recording** — enable **After Effects**. Restart AE if the OS prompts you to quit first.

## Capture times out

- Increase `captureTimeoutMs` in config. If using a huge display or slow disk, full-screen PNG can take longer.

---

## Debug logging

- Set `window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS.setDebug(true)` in the console to enable verbose diagnostics (info/debug). Logs go to the browser console only, not into the chat transcript.
- Use debug logs to see pipeline stage entry/exit, parse failures (generator, validator, repair), fallback model activation, and prompt-assembly degradation. See docs/runtime-diagnostics.md for the full list of pipeline log points and error categories.

---

## Repo validation

- Run `node scripts/validate-repo.js` and `node scripts/check-required-files.js` from the repo root to ensure required files and directories exist (see docs/repository-validation.md).
