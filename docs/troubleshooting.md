# Troubleshooting

Common issues and where to look when the panel or pipeline misbehaves.

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

## Pipeline "Failed / blocked" or system message only

- **Rules block**: Expression failed deterministic checks (empty, leftover markers, sanitization, or target context). Rephrase or simplify the request.
- **Validation fail**: Validator reported fail and repair did not produce an acceptable result. Try a clearer prompt or a different target.
- **Runtime failure**: Network/HTTP/malformed response; see "Error contacting cloud model" above.

Blocked outcomes never set `latestExtractedExpression`, so Apply stays disabled by design.

**Finding where it failed:** Enable debug logging in the CEP console: `window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS.setDebug(true)`, then send again. Check the console for `[pipeline]` messages: **stage=generate exit blocked** = generator produced no valid expression; **stage=rules exit blocked** = deterministic rules failed; **validator parse failed** = validator response was not parseable (e.g. JSON in code fences); **repair extraction failed** = repair response had no extractable expression; **flow failed** = pipeline threw (message sample follows). See docs/runtime-diagnostics.md for the full log reference.

---

## Apply button stays disabled

- Apply is enabled only when:
  - There is an active session,
  - `latestExtractedExpression` is set (disposition **acceptable** only),
  - No request in flight.
- **Warned draft** and **blocked** do not set `latestExtractedExpression`, so Apply correctly stays disabled. See docs/manual-apply-policy.md and docs/final-result-policy.md.

---

## Apply clicked but host reports error

- **Invalid target**: Layer or property was removed or changed in AE after generation. Refresh target (@) and re-select, or generate again.
- **Unsupported property**: Some properties cannot receive expressions from the host script; see host/index.jsx and docs/host-bridge-notes.md.
- **Host script missing**: Ensure host/index.jsx is loaded by the CEP host; check ExtendScript console for errors.

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
