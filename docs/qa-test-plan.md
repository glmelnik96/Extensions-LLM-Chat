# QA test plan

Step-by-step manual test plan for the CEP extension. Run in Adobe After Effects with the panel loaded.

---

## 1. Startup smoke tests

1. **Panel launch**
   - Open After Effects, load the extension panel (Extensions → Extensions LLM Chat or your install path).
   - **Expected**: Panel opens; sidebar shows session list; chat area shows system prompt and input; status line shows "Готово." or a message to set **config/secrets.local.js** if the API key is missing.

2. **Missing API key**
   - With `secrets.local.js` absent or `apiKey: ''`, open the panel (example.config may still load).
   - **Expected**: Status mentions **secrets.local.js** / config README; Send does nothing when key empty; no crash.

3. **Valid API key**
   - Ensure `config/secrets.local.js` sets a valid `EXTENSIONS_LLM_CHAT_SECRETS.apiKey` (see **secrets.local.example.js**). Reload panel.
   - **Expected**: Panel loads; no API key error; Send is enabled when a session exists and input is non-empty.

---

## 2. Session tests

4. **Session create**
   - Click **New**.
   - **Expected**: New session appears in sidebar; transcript shows system prompt only.

5. **Session switch**
   - Create two sessions; click the first, then the second.
   - **Expected**: Transcript and target bar reflect the active session; messages and latestExtractedExpression are per-session.

6. **Session rename**
   - Select a session, click **Rename**, enter a new name in the prompt.
   - **Expected**: Session title in sidebar updates; no data loss.

7. **Session clear**
   - Add user/assistant messages, then click **Clear** and confirm.
   - **Expected**: Current session messages reset to system prompt only; latestExtractedExpression cleared; other sessions unchanged.

8. **Clear all**
   - With multiple sessions, click **Clear All** and confirm.
   - **Expected**: All sessions removed; one new session created; state persisted after reload.

9. **Session persistence**
   - Create/rename sessions, type a message (do not send), close panel, reopen.
   - **Expected**: Sessions and draft input (if persisted) restored; active session correct.

---

## 3. Target tests

10. **Target refresh**
    - With a comp open, click **@** or the target refresh button.
    - **Expected**: Status shows "Refreshing layers from After Effects…"; layer list populates from host.

11. **Layer selection**
    - Refresh target; open layer dropdown; select a layer.
    - **Expected**: Layer trigger shows selected layer; property list updates for that layer.

12. **Property selection**
    - Select a layer; open property dropdown; select a property (e.g. Position).
    - **Expected**: Property trigger shows selected property; target summary reflects layer + property; getResolvedTarget() would return that pair.

13. **No comp / no target**
    - Close comp or have no project; refresh or open panel.
    - **Expected**: Graceful behavior: "No layer" or empty list; no hard crash; status clear.

---

## 4. Pipeline happy path

14. **Successful generation**
    - Set API key; select a layer and property; send a simple prompt (e.g. "wiggle 5 10 on position").
    - **Expected**: Status progresses (Preparing → Generating → Validating → … → Finalizing); one **assistant** message with expression + explanation; status "Completed successfully."; Apply button enabled; latestExtractedExpression set.

---

## 5. Blocked / warning / repair paths

15. **Blocked result (rules)**
    - Trigger a rules failure if possible (e.g. prompt that leads to output with leftover ---EXPLANATION--- in expression).
    - **Expected**: One **system** message explaining failure; no expression as main result; Apply disabled; latestExtractedExpression null.

16. **Warned draft**
    - Use a prompt that yields validation **warn** (e.g. edge-case expression).
    - **Expected**: One **assistant** message with "[Warning: not fully validated]" prefix; Apply disabled; latestExtractedExpression null; status "Completed with warnings."

17. **Repair path**
    - Use a prompt that triggers validation fail and repair (e.g. small fixable error).
    - **Expected**: Status shows "Repairing expression…"; after repair and re-validation, either acceptable (Apply enabled) or warned_draft/blocked as above.

---

## 6. Failure behavior

18. **Missing API key at Send**
    - Ensure secrets/local key empty; type a message and click Send.
    - **Expected**: Status points to **config/secrets.local.js**; no request sent; no crash.

19. **Network failure**
    - Disconnect network or use invalid baseUrl; send a message.
    - **Expected**: After timeout/error, one **system** message with user-friendly error (e.g. "Network error…"); no internal stack in chat.

20. **Malformed response**
    - If testable (e.g. mock or broken endpoint), trigger empty or invalid JSON from API.
    - **Expected**: Fallback to Qwen if configured; or system message "Invalid response from cloud model…"; no crash.

---

## 7. Manual Apply

21. **Apply success**
    - Produce an **acceptable** result (Apply enabled); click **Apply Expression**.
    - **Expected**: Host receives expression; success message in chat (e.g. system message from host); property has expression in AE.

22. **Apply invalid target**
    - With Apply enabled, delete the layer or change comp in AE so the resolved target is invalid; click Apply.
    - **Expected**: System message with host error (e.g. invalid layer/property); no crash.

23. **Apply unsupported property**
    - Select a property that host does not support for expression apply; get acceptable result; click Apply.
    - **Expected**: Host returns error; system message in chat; no crash.

---

## 8. Final checks

24. **No auto-apply**
    - After any successful pipeline run, do **not** click Apply.
    - **Expected**: Expression is not applied to the property until the user clicks Apply.

25. **Final-only output**
    - Run pipeline and watch transcript.
    - **Expected**: Only one new assistant (or system) message per send; no generator/validator/repair intermediate messages in chat.

---

## 9. Vision, capture, and frame export (macOS + Ollama)

**Prerequisites:** Node enabled in manifest, Screen Recording for After Effects, Ollama running, vision models pulled per **config/example.config.js**, **secrets.local.js** for cloud Send if testing full pipeline.

26. **Capture full screen**
    - Click **Capture full screen**.
    - **Expected**: Status shows saved path; no crash; **session.lastUiCapturePath** updated (Analyze UI can run).

27. **Capture comp area**
    - Focus AE; click **Capture comp area**.
    - **Expected**: PNG saved or clear error (Automation / no window); previous successful capture path preserved on failure.

28. **Analyze UI (Ollama)**
    - After a successful capture, click **Analyze UI (Ollama)**.
    - **Expected**: Vision sub-status updates; on success, session stores text; on failure, short error (no image bytes in console).

29. **Analyze frame (Ollama)**
    - Open a comp; click **Analyze frame (Ollama)**.
    - **Expected**: Host exports PNG (`saveFrameToPng`); panel waits for non-empty PNG; Ollama returns text or a clear HTTP/local error; temp frame file removed after run.

30. **Frame resolution / GPU**
    - Use a **4K** comp if available; run **Analyze frame** twice (optionally toggle **ollamaVisionMaxEdgePx** in config: 1024 vs 512).
    - **Expected**: Downscaled send avoids repeated **model runner** crashes; see **docs/troubleshooting.md**.

31. **Grounding in cloud Send**
    - Set **lastFrameAnalysis** and/or UI analysis + **Include UI capture**; Send a prompt.
    - **Expected**: Cloud request includes grounding blocks per **docs/vision-grounding.md** (verify via debug logs only — do not log API key).

32. **Diagnostics timing (optional)**
    - In CEP devtools: `EXTENSIONS_LLM_CHAT_DIAGNOSTICS.setDebug(true)`; run capture and Analyze UI/frame.
    - **Expected**: Console lines `[timing] capture_macos …ms`, `[timing] ollama_vision_ui …ms` / `ollama_vision_frame …ms` (no secrets or full paths in detail strings).

Run these in order when doing a release pass; record any failures in troubleshooting.md or release checklist.
See **docs/archive/qa/manual-test-matrix.md** for a compact matrix and **docs/troubleshooting.md** for common issues.
