# Engineering notes (development artifacts)

This file consolidates planning and exploratory materials that are useful for implementation discussions but are not the source of truth for shipped behavior.

For current runtime behavior always start with:
- `docs/capabilities-and-roadmap.md`
- `docs/final-architecture.md`

---

## A) Vision integration context

- Current agent path does not inject `lastFrameAnalysis` / `lastUiAnalysis` into `Send`.
- Capture and vision modules (`lib/captureMacOS.js`, `lib/ollamaVision.js`) are present and can be reconnected later.
- Vision direction remains optional and should not be treated as guaranteed shipped behavior.

Operational caveats noted during research:
- Screen capture depends on CEP Node + macOS Screen Recording permissions.
- Large PNGs can crash local vision runners; downscale before inference.
- Vision output is probabilistic and should be used as grounding hints, not hard truth.

---

## B) High-confidence feature integration plan (short, fixed)

1. Hard cancel for cloud requests  
   - Touchpoints: `main.js`, `agentToolLoop.js`, `chatProvider.js`  
   - Technical implementation:
     - Thread `abortHandle` into provider invocation (`CHAT_PROVIDER.invoke(..., { abortHandle })`).
     - In Cloud.ru path use `AbortController`; bind `abortHandle` to `controller.abort()`.
     - Keep current loop-level checks as fallback; add explicit `aborted` error normalization.
   - User behavior:
     - `Stop` interrupts a running cloud request immediately.
     - UI exits thinking state quickly and returns to ready/cancelled state without waiting for network timeout.
   - Tests:
     - Automated: provider unit test with mocked delayed `fetch` verifies abort rejects with normalized cancel error.
     - Automated: agent loop test verifies cancellation short-circuits next step execution.
     - Manual: start long cloud request -> press `Stop` -> ensure no new tool calls appear and status returns promptly.

2. Cloud timeout parity with Ollama  
   - Touchpoints: `config/example.config.js`, `chatProvider.js`  
   - Technical implementation:
     - Add `cloudChatTimeoutMs` config with sane default.
     - Wrap Cloud.ru `fetch` in timeout+abort logic matching Ollama behavior style.
     - Map timeout to deterministic error text for stable UI handling.
   - User behavior:
     - If Cloud.ru is slow/unreachable, user sees clear timeout message instead of long hang.
     - Panel always exits in-flight state and remains usable after timeout.
   - Tests:
     - Automated: timeout unit test with stalled `fetch` verifies abort and exact timeout error message.
     - Automated: regression test for successful Cloud.ru call under timeout threshold.
     - Manual: set tiny timeout (e.g. 1-2s), run request, confirm deterministic timeout error and full UI recovery.

3. Expose `apply_expression_batch` as tool  
   - Touchpoints: `toolRegistry.js`, `hostBridge.js`, `host/index.jsx`  
   - Technical implementation:
     - Add new tool schema with array payload (`[{ layer_index|layer_id, property_path, expression }]`).
     - Implement host-side batch executor: apply sequentially, capture per-item result, optional fail-fast flag.
     - Return structured summary (`total/succeeded/failed/items`) to keep agent correction loop deterministic.
   - User behavior:
     - Agent can apply many expressions in one action; faster completion and fewer chat/tool round trips.
     - User sees one tool card with per-layer successes/failures.
   - Tests:
     - Automated: host bridge mapping test validates request/response shape and serialization.
     - Automated: batch execution test covers mixed success/failure and summary counters.
     - Manual: request expression setup for multiple layers; verify all applied and error entries are readable.

4. Explicit active comp selection  
   - Touchpoints: `host/index.jsx`, `toolRegistry.js`, `hostBridge.js`, `agentSystemPrompt.js`  
   - Technical implementation:
     - Add explicit comp selector support (e.g. `comp_ref`: active/name/id/index) for mutating tools.
     - Resolve comp once in host helper; block mutating actions if target comp cannot be resolved.
     - Update system prompt to force comp disambiguation when project has multiple comps.
   - User behavior:
     - In multi-comp projects, agent edits the intended composition predictably.
     - If comp is ambiguous, agent asks/clarifies instead of silently editing fallback comp.
   - Tests:
     - Automated: comp resolution tests (active/name/id/index) and failure-path tests for ambiguity.
     - Automated: mutation guard test ensures tool fails with clear message when comp is unresolved.
     - Manual: create 2+ comps with similar layers, run edit request, verify only chosen comp changes.

5. Deterministic motion preset tools  
   - Touchpoints: `host/index.jsx`, `toolRegistry.js`, `hostBridge.js`  
   - Technical implementation:
     - Add dedicated tools (`apply_fade_preset`, `apply_pop_preset`, `apply_slide_preset`) with fixed keyframe recipes.
     - Support constrained parameters only (duration, delay, direction, amplitude/intensity in bounded ranges).
     - Centralize recipe constants in host layer to guarantee repeatable timing/easing output.
   - User behavior:
     - User can request common motions and get consistent, production-style results every time.
     - Reduced variance vs free-form tool chains; quicker iterations for routine animation tasks.
   - Tests:
     - Automated: snapshot-like tests on generated keyframe plan (times/values/easing) per preset.
     - Automated: argument validation tests for out-of-range preset params.
     - Manual: apply each preset on sample layer set, visually confirm repeatability across multiple runs.

---

## C) Suggested rollout order

1) Stability baseline: items 1-2  
2) Throughput: item 3  
3) Context safety: item 4  
4) User-visible productivity: item 5

---

## D) Notes on confidence

- Host-side operations are mostly deterministic when inputs are explicit.
- LLM planning and vision interpretation are non-deterministic layers.
- Prefer explicit tools/presets for production reliability.
