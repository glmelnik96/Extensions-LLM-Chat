# AGENTS.md — Entry point for AI agents working on AE Motion Agent

> If you are a new agent (Claude Code, Codex, or other LLM) starting work on this codebase — **read this file first**, then proceed to the relevant doc. This is the project HANDOFF.

---

## What this project is

**AE Motion Agent** (CEP extension folder: `Extensions LLM Chat`) is a chat-only AI agent embedded in Adobe After Effects 26+ via CEP (Common Extensibility Platform).

The user types a natural-language motion-design request → the agent plans a sequence of tool calls → each tool maps to an ExtendScript function that runs inside After Effects → results stream back into the chat. Cloud.ru Foundation Models provide the LLM via an OpenAI-compatible API with tool calling + SSE. The panel header has a 3-model selector (`AVAILABLE_MODELS` in `main.js`): `openai/gpt-oss-120b` (default), `MiniMaxAI/MiniMax-M2.5`, `zai-org/GLM-4.7`; the choice is stored per-session as `session.model`. Reasoning models stream chain-of-thought in a separate `reasoning` field (not `content`) — see `docs/superpowers/specs/2026-06-04-model-upgrade-design.md`.

**Tagline for the user:** «buddy for motion design, not autopilot». The agent should help with hard expression logic, parameter dependencies, and AE quirks — not auto-generate entire animations from a single sentence.

**Status (2026-06-10):** MVP shipped (2026-04-30), 4 iterations of post-release fixes (2026-05), migration to Cloud.ru reasoning models GLM-5.1 (2026-06-04), Stage 3 editing-assistant upgrade (expression library, link_properties, list_available_effects), and live validation in real AE via CDP — 7 host bugs found and fixed (2026-06-10). All committed and pushed. See the **Iteration history** section below.

---

## 30-second project map

```
Extensions LLM Chat/
├── AGENTS.md                  ← you are here
├── README.md                  ← user-facing setup & feature overview
├── index.html                 ← panel root (loads scripts in order)
├── styles.css                 ← panel CSS
├── main.js                    ← UI, sessions, markdown, KB injection, quick actions, undo
├── agentSystemPrompt.js       ← modular system prompt (CORE + lazy modules by keyword)
├── agentToolLoop.js           ← LLM ↔ tool execution cycle (parallel reads, validation, abort)
├── chatProvider.js            ← Cloud.ru API, retry on 429/5xx, SSE streaming
├── hostBridge.js              ← Tool name → ExtendScript mapping, anti-spam guard, idempotency, validation
├── toolRegistry.js            ← 70 OpenAI-format tool definitions
├── host/
│   └── index.jsx              ← ExtendScript: ALL AE operations (~4600 lines)
├── CSXS/manifest.xml          ← CEP manifest
├── lib/
│   ├── CSInterface.js         ← Adobe CSInterface (tracked in repo)
│   └── pure/                  ← pure modules shared with node tests (esLiteral, markdown, prune, expressionLibrary)
├── config/
│   ├── example.config.js      ← tracked defaults
│   ├── runtime-config.js      ← gitignored overrides
│   └── secrets.local.js       ← gitignored API key
├── knowledge-base/            ← AE expression reference corpus (human-readable; KB_SNIPPETS in main.js does keyword injection)
├── scripts/
│   └── cdp-eval.js            ← CDP helper: eval JS inside the live panel (port 8092) for real-AE testing
├── test/                      ← node:test unit tests (227 tests) — `node --test test/*.test.js`
└── docs/                      ← detailed per-topic docs
```

---

## Critical mental model

### 1. The agent loop (where the work happens)

```
user message
    ↓
main.js handleSend
    ↓
agentSystemPrompt.js builds prompt (CORE + lazy modules per keyword)
    ↓
agentToolLoop.runAgentLoop
    ↓ [N rounds]
chatProvider.invoke  →  Cloud.ru API
    ↓
response.tool_calls?
    ├─ yes → executeToolCallsSequentially
    │           ├─ READ_ONLY_TOOLS → Promise.all (parallel)
    │           └─ mutating → sequential
    │       each call:
    │           ├─ buildToolCallThunk
    │           ├─ static validateExpression (apply_expression*) → warnings → tool result
    │           └─ hostBridge.executeToolCall
    │                ├─ normalize toolName (strip <|...|>)
    │                ├─ anti-spam guard (3 fails → block)
    │                ├─ idempotency cache (client_op_id)
    │                ├─ _validateRequiredArgs (catches args:{})
    │                └─ evalHostFunction → CSInterface.evalScript → AE
    │       ↑ loop back
    └─ no  → final content displayed
```

### 2. Cloud.ru tool-call quirks you WILL hit

These are documented thoroughly in `~/.claude/projects/.../memory/feedback_llm_failure_modes.md` (Claude Code memory). Quick map:

| Symptom | Fix layer | Reference |
|---|---|---|
| `args: {}` for tools with required fields | `_validateRequiredArgs` in `hostBridge.js` | iter 1 |
| `apply_expression<|channel|>commentary` Unknown tool | toolName normalize in `executeToolCall` | iter 3 (Fix I) |
| Spiral of 14×/43× same failing call | anti-spam guard in `hostBridge.js` | iter 2 (Fix B) |
| Truncated tool_calls JSON mid-stream | `max_tokens: 65536` in `agentToolLoop.js` | iter 3+4 (Fix H, M), raised for GLM-5.1 |
| Streaming drops ALL tool_calls (vLLM 0.22.0 + GLM-5.1) | non-streaming for tool turns in agent loop | 2026-06 reliability fixes |
| Fabricated `![preview](file:///...)` without `capture_comp_frame` | prompt rule + opt-in capture | iter 4 (Fix J) |
| `add_shape_*({})` silently inserts into wrong layer | `_validateRequiredArgs` requires layer_id | iter 4 (Fix K) |
| Tool-call JSON emitted into `content` (turn does nothing) | `lib/pure/toolCallSalvage.js` + retry in `agentToolLoop.js` | 2026-08-10 |
| Does 3 of N layers, reports all N as done | `batch_call` + prompt rules 5/10 | 2026-08-10 |
| "Начало слоя" treated as comp t=0 — keys land before in-point, animation invisible | `shift_keyframes` (+`align_to:"layer_in_point"`) + prompt rule | 2026-08-16 |
| `set_property_value` on expression-driven property = silent visual no-op reported as success | host WARNING + `expressionOverride: true` + prompt rule | 2026-08-16 |
| False "⚠ No active composition" on send | live probe via `refreshActiveCompNote()` instead of stale DOM text | 2026-08-16 |
| batch_call tells "re-send failed items" while guard blocks them | `error_code` passthrough + blocked-aware summary in `_runBatchCall` | 2026-08-16 |
| False "black frame" vision verdict → destructive phantom corrections | `at_time:"auto"` capture + `classifyIssues` weak-signal skip + verify-first correction prompt | 2026-08-16 broad hunt |
| Agent guesses targets from chat history / picks its own on empty selection | CORE_SELECTED rules: `get_host_context` first in CURRENT run; empty selection → ask | 2026-08-16 broad hunt |
| Camera rig in all-2D comp reported as working | prompt rule (KNOWN_LIMITATIONS + 3D module) | 2026-08-16 broad hunt |
| Animation placed where layer invisible (scale 0 / outside in-out) | visibility-window prompt rule | 2026-08-16 broad hunt |
| "Directional reveal" faked via uniform Mask Expansion | Linear Wipe rule + fixed example + MASKS module | 2026-08-16 broad hunt |
| "Link to null" via clone position expression (layout destroyed) | parenting rule: `set_layer_parent`, offset expressions only on explicit ask | 2026-08-16 broad hunt |
| English QA preset → English answer to Russian user | RU quick-action prompts + conversation-language rule | 2026-08-16 broad hunt |
| CoT leakage into final response | prompt rule in CORE_RULES | iter 4 (Fix L) |
| `create_layer(text)` with font fails | post-attach `sourceText.setValue(doc)` | iter 2 (Fix A) |
| Wrong `property_index` on effects | `property_name` preferred | MVP |

### 3. Three things the agent must NOT do

- **Make architectural changes without explicit user request** — MVP is stable. Iter 2-4 fixes are deferred-list-only on demand. See `.omc/plans/improvements-2026-04-30.md` for the deferred list.
- **Commit without explicit user request** — `Не коммитить без явной просьбы` is a hard rule. Even if changes look clean.
- **Use the Bash `git add .`** — list specific files. Avoid accidentally staging `.claude/`, `.omc/`, secrets.

---

## First moves for a new agent

1. **Read this file** (you are doing it). Skim `README.md` for user-facing setup.
2. **Read your memory** — Claude Code memory files live under `~/.claude/projects/<project>/memory/` (`MEMORY.md` is the index). Highlights:
   - `feedback_git_safety.md`, `feedback_work_style.md`, `feedback_session_start.md` — collaboration rules
   - `project_windows_msix_env.md` — MSIX sandbox + SSH quirks on this Windows machine
   - `project_model_stack.md`, `project_cloudru_streaming_bug.md` — GLM-5.1 / Cloud.ru specifics
   - `reference_live_ae_testing.md` — CDP live-testing pipeline + ExtendScript quirks ← **most useful for tool work**
3. **Glance at recent git log** to see latest commits:
   ```
   git log --oneline -10
   ```
4. **If the user describes a problem with tests / behavior**, check `~/Desktop/Логи/T*.json` for exported error logs. The user runs T1-T10 integration tests after every iteration.
5. **Open the Obsidian vault** for higher-level project context:
   - Windows: `C:\Users\Глеб\Downloads\2nd brain` / macOS: `~/Downloads/2nd brain` (Syncthing-synced)
   - Folder note: `01 Projects/AE Motion Agent/AE Motion Agent.md` — current status + 🎯 next action + artifact table
   - Iteration artifacts: `01 Projects/AE Motion Agent/AE Motion Agent — итерация N *.md`
6. **DO NOT read `host/index.jsx` (~3850 lines) end-to-end on first session.** Use `grep` for `function extensionsLlmChat_<name>` or `_<helper>` to jump to the relevant section.

---

## Iteration history (in chronological order)

### MVP (2026-04-30)
Chat-only cleanup: removed brand presets, motion presets, HTML export, Ollama provider, tab system, Tool Call Log. Plus 10 architectural improvements: modular system prompt with lazy loading (−42% tokens on simple requests), parallel read-only tools (`Promise.all`), idempotency via `client_op_id`, type hints in `_KNOWN_PATHS`, expanded `validateExpression` (8 patterns), validation warnings → tool result, capability handshake, persistent capture frames in `~/AE-agent-captures/`, tool latency stats in Report, KB cleanup. Restored `resultToJson` + `_getTemporalEaseDims` (accidentally deleted during cleanup).

**Commit**: `6da17c7 Chat-only MVP: cleanup + 10 architectural improvements`

### Iteration 2 (2026-05-02) — Fix A/B/C — logic-layer bugs
First T1-T10 integration test run exposed systematic problems. Three fixes:

- **Fix A** — host `extensionsLlmChat_createLayer` now properly attaches `TextDocument` via `addText()` first, then mutates font/fontSize on the live doc, then `sourceText.setValue(doc)`. Detects silent font fallback by comparing requested vs `value.font` post-save → `result.fontWarning`. Pre-existing rule about font being "unreliable" replaced with PostScript name guidance.
- **Fix B** — anti-spam guard in `hostBridge.js`. Tracks `(toolName, JSON.stringify(args))` failure streak. After 3 sequential failures with the same args, 4th attempt is rejected with `error_code: 'RETRY_BLOCKED'`. Counter resets on any success for that key. `resetSpamGuard()` runs at start of every `runAgentLoop`.
- **Fix C** — dynamic host hints (in `add_shape_*` and `reorder_layer`) plus prompt updates (SHAPES module — explicit layer-type tracking, KNOWN_LIMITATIONS — layer stacking + precomp limitations + anti-spam guard explanation).

### Iteration 3 (2026-05-12) — Fix H/I — protocol-layer artifacts
Second T1-T11 test run confirmed iter 2 fixes (T1 17→3 errors, T10 137→9 calls, 0 RETRY_BLOCKED). Exposed two new patterns:

- **Fix H** — `max_tokens: 4096 → 16384` in `agentToolLoop.js` (later 32768 in iter 4). T6/T9 were truncating tool_calls JSON mid-stream — output token budget too tight.
- **Fix I** — strip `<|channel|>commentary` (and other harmony separators) from `toolName` in `hostBridge.executeToolCall`. gpt-oss-120b decoder occasionally leaks channel tokens into `function.name` field. Client-side normalize is the only reliable fix.

### Iteration 4 (2026-05-12) — Fix J/K/L/M — behavioral / silent failure
Second retest confirmed iter 3 (T6 4/4, T9 8/8, T10 27 calls), exposed four new behavioral patterns:

- **Fix J** — `CORE_PREVIEW` rewritten. Removed proactive "capture after changes" suggestion. Made `capture_comp_frame` opt-in only ("call ONLY when user says capture/screenshot/preview"). Honest constraint "no time parameter". Hard rule **"NEVER emit `![preview](file:///...)` unless `capture_comp_frame` actually returned a path in the SAME turn"**. Closes the broken-image-icon fabrication problem.
- **Fix K** — `_validateRequiredArgs` cases for `add_shape_ellipse`/`rectangle`/`path`: require `layer_id` OR `layer_index`. Selection fallback in `_resolveLayer` was creating silent insertions on wrong layers with default 200×200 size when args came in empty. Also requires `vertices.length >= 2` for `add_shape_path`.
- **Fix L** — `CORE_RULES` adds explicit "no chain-of-thought in visible response" rule. Distinguishes structured plan (OK) from stream-of-consciousness (NOT). Addresses harmony commentary channel leak.
- **Fix M** — `max_tokens: 16384 → 32768`. T9 retest still truncated on 1/8 set_property_value at 16k.

Iter 2 + 3 + 4 committed as one bundle: `39f8804`.

### Model migration (2026-06-04) — Cloud.ru reasoning models
Switched from gpt-oss-120b to `zai-org/GLM-5.1` (reasoning, 202k context). Reasoning streams in a separate `reasoning` field (not `reasoning_content`); parser feeds it to a live "Agent reasoning" indicator. `max_tokens` raised to 65536. Discovered vLLM 0.22.0 bug: streaming drops ALL tool_calls for GLM-5.1 → agent loop uses non-streaming for tool turns (guarded in `chatProvider.js`). Commits `7026a5c`, `659061e`, `33244de`.

### Stage 3 (2026-06-10) — editing-assistant upgrade
Prompt reframed from "animation generator" to editing assistant. New tools: `search_expression_library` (28 curated snippets in `lib/pure/expressionLibrary.js`, panel-local search — no LLM round-trip), `link_properties` (pick-whip), `list_available_effects` (search installed effects). `add_effect` gained optional `effect_name` rename (needed for expression rigs referencing `effect("...")`). Context trimming improvements. Commit `3c22313`.

### Live AE validation (2026-06-10) — 7 host bugs fixed
First validation against a **real** running After Effects via CDP (see "Live testing" below). Two rounds + 5 stress batches found 7 bugs invisible to node tests, all fixed in commit `60f2b79`:

1. ExtendScript `string + Array` concat throws "invalid numeric result" → `join()` in expression readback
2. `resultToJson` didn't escape `\r\n` control chars (AE puts raw CRLF in `expressionError`) → invalid JSON → panel showed ok:true on real errors
3. `add_effect` couldn't rename effects (blocked expression rigs)
4. `_resolveProperty` alias shadowing — nested shape `Contents` never resolved
5. `addProperty()` invalidates sibling refs → "Object is invalid" + false ok:true; shape tools now capture names immediately and return ready-made property paths (`sizePath` etc.)
6. `reorder_layer` never worked — Layer has no `moveTo()`; rewritten with moveBefore/moveAfter/moveToBeginning/moveToEnd
7. `precompose_layers` rejected `layer_ids` — added id→index resolution

Full methodology + bug tables: `docs/superpowers/specs/2026-06-10-deep-audit-report.md` (sections 8, 8.1).

### Model selector (2026-06-18) — 3 user-selectable models
Re-added a panel model selector (reversing the brief "predetermined model" decision). `AVAILABLE_MODELS` in `main.js` defines `openai/gpt-oss-120b` (default), `MiniMaxAI/MiniMax-M2.5`, `zai-org/GLM-4.7`; `selectModel()` stores the choice on `session.model` (persisted) and is blocked mid-request; `normalizeModelId` migrates unknown/old ids (e.g. `zai-org/GLM-5.1`) to the default. UI: `#model-selector` buttons (`index.html`), `.model-btn`/`.model-btn-active` (`styles.css`). All three live-verified in real AE via CDP — clean tool dispatch (0 hallucinated tool names) on a simple read and a complex multi-tool rig (null + Slider Control + shape + Opacity↔slider link): gpt-oss-120b 7 calls/~93k tok, GLM-4.7 5 calls/~91k tok, MiniMax-M2.5 11 calls/~225k tok (self-corrected 3 transient expression errors to success).

**Availability indicator (2026-08-04):** `CHAT_PROVIDER.listModels()` (GET `/v1/models`, one request, no tokens, never rejects) feeds `probeModelAvailability()` in main.js — run at startup when an API key is present and on click of the `#provider-badge`. The badge shows `Cloud.ru <ok>/<total>`; a model missing from the catalog, or served without `function_calling`, gets `.model-btn-unavailable` (dimmed + struck through) with a tooltip explaining why, so a decommissioned model is visible BEFORE a request fails. A failed probe leaves availability unknown (`Cloud.ru ?`) and blocks nothing. Live: `Cloud.ru 4/4`, 97 models in the catalog, tooltips carry the context length.

### Motion-editing tools (2026-07-21) — 5 tools ported from adobe-agent-skills
Added five motion-design conveniences (50 → 55 tools), each ported from the MIT `adobe-agent-skills` AE scripts and adapted to the 3-layer tool architecture: `copy_ease` (transfer temporal ease in/out/both between properties), `reverse_keyframes` (mirror keyframes in place), `stagger_layers` (time-offset layers by in-point/start-time/keyframes, forward or reverse), `randomize_property` (range randomize across layers, absolute/offset, optional per-axis), `move_anchor_point` (reposition anchor to a named spot with position compensation so the layer doesn't jump). Host handlers under "Advanced keyframe / layer operations" in `host/index.jsx`; all five in the `getCapabilities` probe list. Live-verified in real AE via CDP: ease copy transfers influence, reverse swaps values, stagger offsets start times by the step, randomize lands in range, anchor→center compensates position (no visual jump). Tests: `test/registry.test.js`, `test/hostBridge.test.js` (138 total pass).

### Multi-chat (2026-07-27) — multiple named sessions in the panel
`state.session` (single object) became `state.sessions[]` + `state.activeSessionId` (`getActiveSession()` accessor in `main.js`); pure logic in `lib/pure/sessionStore.js` (`PURE_SESSION_STORE`: `createSession`, `migratePersisted`, `serializeForPersist`, `titleFromFirstMessage`, `isDefaultTitle`) with 10 tests in `test/sessionStore.test.js`. localStorage shape v2 `{ sessions, activeSessionId }`; legacy `{ session }` migrates transparently on load (old chat becomes the first entry — never lost). Header session bar: `#session-select` + new/rename/delete buttons (`.session-bar` in `styles.css`); switch/new/delete are blocked mid-request (same reason as model switching) and clear the hostBridge idempotency cache (`client_op_id` values may repeat across chats). Default `Chat N` titles are auto-replaced by the first user message (40-char word-boundary cut + ellipsis). Per-chat model/token/cost counters came free (already stored per-session). Quota pruning on persist drops the oldest half of the ACTIVE chat only. Export = all sessions; Report/Errors/Clear/Compact = active chat. Live-verified via CDP: legacy migration, new/rename/switch/delete, message+model isolation across reload, real agent run landing in the correct chat with auto-title (158 tests pass). CDP gotcha: the `beforeunload` persist overwrites seeded localStorage — patch `Storage.prototype.setItem` to a no-op right before `location.reload()` when seeding state.

### Panel UX pack (2026-07-27) — draft autosave, crash recovery, copy/retry, editable quick actions
Four panel-level features, all live-verified via CDP (166 tests pass):
- **Draft autosave** — input persists to `ae-motion-agent-draft` (300ms debounce + synchronous flush on unload), restored on boot, cleared on send.
- **Mid-run crash recovery** — each `onStepComplete` snapshots the partial tool log to `ae-motion-agent-pending-run`; on boot `recoverPendingRun()` folds it back into the owning session as an assistant message + warning system note. Guard: skipped when `session.updatedAt >= savedAt` (run finished normally). Cleared on success/error paths.
- **Copy/retry buttons** — hover-revealed `.msg-actions` under user (copy+retry) and assistant (copy) messages with non-empty text; clipboard via `navigator.clipboard` with `execCommand` fallback; retry blocked mid-request.
- **Clear split (2026-07-28)** — footer Clear left-click clears only the ACTIVE chat (`handleClearSession`); right-click (`contextmenu`) is full clear — `handleClearAllSessions` drops all sessions and recreates one fresh chat. Shared tail `finishClear()` (idempotency-cache drop + persist + render) and guard `clearBlockedByRequest()`; confirm texts name the scope explicitly. Live-verified via CDP incl. cancel path.
- **Editable quick actions** — the 16 hardcoded index.html buttons moved to `lib/pure/quickActions.js` (`PURE_QUICK_ACTIONS`, 8 tests); rendered dynamically into a single `#quick-actions` container, user list persists in `ae-motion-agent-quick-actions`. Left-click sends, right-click edits/deletes (prompt-based dialog), `+` adds, `⟲` resets (removes the key → defaults). Stored empty list is legitimate; invalid stored state falls back to defaults. Event delegation on the container (buttons re-render on edit).

### User expression library (2026-07-27) — personal saved snippets
Users can save their own expressions via chat ("сохрани это выражение") — agent-driven, no dedicated UI. Three panel-local tools (60 → 63): `save_user_expression` (name+expression required; keywords accept comma string or array, normalized lowercase/deduped/max 12), `list_user_expressions`, `delete_user_expression` (by `ux_*` id, explicit request only). Storage: `ae-motion-agent-user-expressions` (`{snippets:[…]}`), pure logic in `lib/pure/userExpressionLibrary.js` (`PURE_USER_EXPR_LIB`, same UMD pattern as quickActions). `PURE_EXPR_LIB.search(query, max, extraSnippets)` gained a third param — hostBridge passes the user's snippets, results are marked `source:"user"` and the message tells the model to prefer them. All three tools are in READ_ONLY_TOOLS (localStorage-only mutations — must NOT count toward the Undo button). 8 new tests (174 total); live-verified via CDP: direct save/search(RU+EN)/list/delete + persistence across reload + unknown-id error, and a real agent send where GLM picked `save_user_expression` unprompted with sensible args.

### Animated subtitles (2026-07-28) — Whisper transcription + subtitle rig (63 → 65)
Two tools: `transcribe_comp_audio` (READ_ONLY) and `create_subtitles` (mutating). Flow: host `extensionsLlmChat_renderCompAudio` renders comp audio to a temp AIFF via the render queue ("AIFF 48kHz" output-module template, span clamp, un-queue/restore other items) → panel uploads to Cloud.ru Whisper (`openai/whisper-large-v3`, multipart, `verbose_json`, **`language` is schema-required — endpoint 400s without it**, 24MB limit → chunk via `start_time`/`end_time`) → segments normalized by `lib/pure/subtitles.js` (`PURE_SUBTITLES`: char-weighted word alignment with silence subtraction, glue-word-aware line wrap, cue splitting by chars/duration; 9 tests) and **cached panel-side in `_lastTranscription`** so the model never re-emits them → `create_subtitles` (no args needed) builds cues and host `extensionsLlmChat_createSubtitles` creates one text layer: Source Text HOLD keyframes per cue + empty-text keys in gaps, position expression pinning the block edge via `sourceRectAtTime` (bottom/center/top), "Word Reveal" text animator (Opacity 0 + expressible selector: Based On=Words via `ADBE Text Range Type2`=3, Amount expression on `ADBE Text Expressible Amount` — both matchNames live-verified), optional auto-sizing background box (separate shape layer, rect-size + position expressions referencing the text layer). Style hardening from live testing: `fontCapsOption` reset to normal (character-panel All Caps leaked in), default font size auto-shrinks so the widest cue line fits 92% comp width (measured via `sourceRectAtTime`; explicit `font_size` is respected as-is). Live-verified end-to-end on a BRAW portrait comp: real RU speech → 6 segments → 18 cues, word reveal + box render correctly. **Silence-aware timing (2026-07-29):** raw Whisper segment starts include leading/inter-phrase silence, so text fired BEFORE the voice (live-measured: speech onset 1.204s vs segment start 0). Fix ported from the Premiere plugin: ffmpeg `silencedetect` (`-30dB`, `d=0.5`) runs on the rendered AIFF concurrently with the Whisper upload (`_detectSilences` in hostBridge; ffmpeg from known paths or PATH, optional — without it timing falls back to raw spread), silences are cached in `_lastTranscription.silences` and passed to `buildCues` → word alignment subtracts them. Two refinements beyond the Pr implementation (both live-verified): `parseSilencedetect` merges silences separated by a voiced blip < 0.35s (breath/click — first word otherwise anchors on it), and `_speechIntervals` drops a leading voiced sliver < 0.4s before a pause (Whisper opens segments ~0.2s early, on the previous phrase's tail). Result on the BRAW comp: cue starts moved 0→1.204, 5.0→5.807, 8.0→9.267 — all exactly at speech onset, with text cleared during the pauses.

Note: reading the selector Amount `.value` from ExtendScript throws "divide by zero" (no per-character context) — that's expected; rendering is fine. **Non-zero `comp.displayStartTime`** (source-timecode comps): a 0-based `timeSpanStart` makes AE pop a modal "frames outside of range" warning that `beginSuppressDialogs` does NOT catch — it freezes scripting until dismissed and the panel times out; offsetting by `displayStartTime` renders silence instead. Fix: temporarily zero `displayStartTime` for the render, restore after (display-only, doesn't shift keyframe times). There is also a **Subtitles button** in the panel task bar (`#subtitles-btn` + language and style selects, `runSubtitlesTask` in main.js): runs transcribe→create directly without an LLM round-trip, shows stage + elapsed seconds, logs both calls into the transcript as normal tool calls (so the next agent request sees them), sets Undo to 1 (single undo group). Second task row: **Rebuild** (`runSubtitlesTask(true)` — create_subtitles only, from the cached/loaded transcript; how another style is tried without paying Whisper again) and **Save/Load transcript** (JSON on the Desktop: `{savedAt, language, durationSec, segments, silences}`; load uses `cep.fs.showOpenDialogEx` with a `prompt()` path fallback and restores `_lastTranscription` via `HOST_BRIDGE.setLastTranscription`).

**Karaoke style (2026-08-04)** — `animation:"karaoke"` (CapCut-like: a colored plate travels under the word being spoken, that word switches to the highlight color). AE's `sourceRectAtTime` only measures the WHOLE text block, so the per-word rect is reconstructed from two **hidden measure text layers** (`enabled=false`, same TextDocument → identical glyph metrics) keyframed from `PURE_SUBTITLES.buildKaraokeTracks(cues)`: `Measure Prefix` holds "words up to and including the current" and `Measure Word` the current word alone. Plate size = `[word.width + 2·padX, text.height + 2·padY]`, plate position = `text.toComp([rt.left + prefix.width - word.width/2, rt.top + rt.height/2])` — live-verified against the real rects (2249.1,1899.2 for a comp-centered bottom cue). Word selection is one `Word Index` slider with HOLD keys (1-based ordinal in the cue, 0 in gaps → measure text empty → plate size 0×0 → invisible); the highlight animator is `ADBE Text Fill Color` + expressible selector `textIndex == thisLayer.effect("Word Index")(1) ? 100 : 0` (index form survives a localized AE). Karaoke forces **single-line cues** (`maxLines:1` in hostBridge) because the plate's y comes from the block's own rect, and defaults `box` to false (the plate is the background). Live-verified: 50 cues, no expression errors, correct word highlighted in a rendered frame; ~19s to build the rig (2 × ~115 Source Text keys). Plate corners are **square** (`ADBE Vector Rect Roundness` = 0, user preference).

**Subtitles studio + look controls (2026-08-04)** — all subtitle controls moved out of the chat flow into an overlay (`#subtitles-panel`, `.studio-panel`, absolutely positioned inside `.panel-root`); the task bar keeps only the `Subtitles…` opener and a status line (status is mirrored into both). Controls: language, style, **font** (PostScript name), **font size**, **text color**, and for karaoke **plate color** + **spoken-word color**. Colors are hex text fields with a live swatch — CEF has no native color chooser, so `<input type="color">` would render but never open a picker. `buildSubtitleStyleArgs()` omits empty fields so host defaults survive (no size = auto-fit). Settings persist in `ae-motion-agent-subtitle-settings`. Two host fixes came out of this: the background box padded from the **pre-auto-fit** `doc.fontSize` (now reads the final size), and `_subtitlesFreeBaseName` renames a second rig to `Subtitles 2` — AE allows duplicate layer names and `thisComp.layer("name")` returns the TOPMOST match, so rebuilding over an existing rig silently bound the new plate to the OLD measure layers (found live). Live-verified: settings survive reload, ArialMT/120px rig with `#ff2d55` plate + white spoken word rendered correctly, roundness 0, second rebuild named `Subtitles 2` with expressions bound to its own measure layers, single undo removes it.

**Font pickers + typography rules + steady plate (2026-08-04)** — three follow-ups, all live-verified.

*Font pickers.* The font field is now two `<select>`s (family, then style) filled from AE itself: host `extensionsLlmChat_listFonts()` walks `app.fonts.allFonts`, which on AE 24.0+ is an array of **families**, each an array of FontObjects — `allFonts[i][j].familyName/styleName/postScriptName` (the flat `allFonts[i].familyName` reading returns undefined; found by introspection on AE 26.3, 148 families). The result is returned compactly (`{f, s:[[style, postScriptName], …]}`) because the whole list crosses `evalScript` as one JSON string, and cached in `hostBridge._fontCache`. The style `<option>` **value is the PostScript name** (the only identifier `TextDocument.font` accepts without silent substitution) while its label is the style name — so persistence stores family + style *label*, not the PostScript name, which is not stable across families. Default is **SB Sans Text / Regular**, then a fallback chain (`Helvetica Neue → Helvetica → Arial → Segoe UI`) before giving up on the first installed family — SB Sans Text is a Windows-side corporate font, so on a Mac the picker would otherwise land on whatever sorts first alphabetically. **macOS parity for every `<select>` in the panel:** left at the default appearance a select is drawn by the OS as a native popup button that *ignores* `background-color` and enforces its own minimum height — dark text on light native chrome on our dark panel, plus taller rows. Windows CEP honours the CSS, which is why this never showed up locally. `select.task-select, select.session-select` therefore set `-webkit-appearance: none` (with the arrow redrawn as a background chevron) and colour `option` explicitly, since the open dropdown is an OS-drawn popup that otherwise takes the system palette. Audited but already portable: the ffmpeg probe lists Homebrew/`/usr/local`/`/usr/bin` paths and falls back to `which`, `resolveOutputDir` is `os.homedir()`-based, the karaoke reference string is `\u`-escaped, and the font payload (~150 B/family, so tens of KB even on a font-heavy Mac) is well under what other tools already push through `evalScript`.

*Typography rules (R1–R8 in `lib/pure/subtitles.js`).* R1 a cue never ends on `. , ; : —` (terminal punctuation is cosmetic in subtitles and reads as a full stop mid-sentence); R2 no leading punctuation; R3 a cue never ends on a "glue" word — preposition, conjunction, particle, number without its unit, or an opening quote/bracket (`isBadBreakWord`); the splitter backs off at most **two** words so a long cue is never starved. Punctuation that marks a real pause is *not* a bad break point, so `isBadBreakWord` returns false for anything already ending in punctuation. R8 is the "pyramid": on a two-line cue with equal balance the **top** line is the shorter one — it is scored as a **fractional** `+0.5` penalty precisely so it can only ever break ties, since every other term in `_scoreSplit` is an integer (glue `+100`, balance `maxLen-minLen`) and a whole-number pyramid penalty would start outranking real balance. `buildCues` filters cue text and karaoke word timings **together** so the two stay index-locked (the karaoke `Word Index` slider addresses words by ordinal).

*Steady plate.* The plate used to be centred on each cue's own **ink** rect, so a word without ascenders sat higher and the plate visibly jumped (user: "плашка под текстом стоит неровно"). Now one hidden measure layer is set once to a constant reference string (Cyrillic + Latin ascenders and descenders) and its `sourceRectAtTime` gives `refTop`/`refHeight`; the karaoke text is pinned by **baseline** (a plain position value — point-text position *is* the baseline when the anchor is [0,0]) and the plate's height and y are constants, `kPadY = round(fontSize · 0.12)`. Only the plate's width still follows the spoken word. Live-measured across four cues at 4096×2160: plate `y=1798..1957, h=160` in **every** frame (previously it moved per cue). A word without ascenders therefore sits low inside the band on purpose — that is the same behaviour as CapCut, and the alternative is a breathing plate.

### Run visibility + in-panel confirmations (2026-08-05)
Two `main.js`-only fixes for "the panel looks frozen", both live-verified via CDP.

*Activity log.* A long agent run showed only one label at a time, so a slow model turn was indistinguishable from a hang. Every `_setThinkingLabel` call now also pushes into an `activityLog` (cap 200) rendered as a collapsible `activity (N)` block inside the thinking indicator — reusing the existing `.reasoning-box` styling, deliberately **without** enabling chain-of-thought: `enable_thinking:false` is what makes a run 94s instead of 18.8min, and the user chose anti-hang only. Consecutive duplicates are dropped because `updateThinkingReasoning` re-sets the label on every streamed chunk (one identical line per token otherwise). Because the activity box shares `.reasoning-box`, the CoT box lookup was narrowed to a dedicated **`.cot-box`** class — an unqualified `querySelector('.reasoning-box')` would grab whichever element came first. Separately, `lastActivityTime` drives a `.thinking-stall` hint that appears after `STALL_HINT_MS` (12s) of no new activity: "· no reply from model for 19s" in `--warn`. Measured live: first hint at 12009ms, log during a real tool run captured `run started → waiting for model (step 1/60) → calling get_detailed_comp_summary → ok → step 2/60`.

*`panelConfirm()` replaces native `confirm()`.* User report: "почему-то зависает кнопка Clear". Root cause measured via CDP: in CEP, `window.confirm()` opens a **detached OS window** — it does not render inside the panel, so it can end up behind AE, and it blocks the panel's JS thread for exactly as long as it goes unanswered (`jsBlockedMs: 1508` for a 1500ms hold). `panelConfirm(message, confirmLabel)` returns a Promise and draws an in-panel `.confirm-backdrop` + `.studio-panel` overlay (Esc / backdrop click = cancel, Enter = confirm, focus starts on Cancel, message goes in via `textContent` since chat titles are user-supplied). Converted: `handleClearSession`, `handleClearAllSessions`, `handleDeleteSession`, `handleQuickActionReset`. **Still native and still blocking** (same bug class, not yet converted): every `prompt()` flow (chat rename, quick-action add/edit, transcript path) and every `alert()`.

### Motion recipes (2026-09-02, same day) — `apply_motion_recipe` (69 → 70)
The corpus and six hunt rounds showed the same request classes assembled by hand from 5–15 primitives and failing on the same details each time. `extensionsLlmChat_applyMotionRecipe(recipe, layerIndices, layerIds, opts)` in `host/index.jsx` bakes them: **pop_in** (centres the anchor via `sourceRectAtTime` with position compensation, Scale 0→current, 10% overshoot key at 75% of the duration), **slide_in** (start point = fully outside the frame on `from` side computed from the layer's bounds in COMP space, converted into the layer's Position space through `_compToLayerSpace` — the inverse parent-chain walk — then two eased keys to the current position), **fade** (in / `out` ending at the out-point / `both`), **pulse** (`value + a*sin(...)` Scale expression — `value` keeps 2D/3D dimensionality; an earlier `[s[0]+f, s[1]+f, s[2]]` form threw "undefined value" on 2D scale), **orbit** (new null "<layer> Orbit" at the reference layer's comp position, rotation expression `ang0 + (time-inPoint)*360/period` starting from the child's current angle, child parented with Position `[radius, 0]` — radius exact by construction), **follow** (`L.toComp(L.anchorPoint, time - lag) + offset`), **shake** (wiggle on Position + Rotation; with NO targets builds a "Camera Shake" null at the comp centre, parents every unparented 2D content layer to it and scales it 103% so edges stay hidden — cameras are inert in 2D). Every recipe: `_lockedRefusal` skip, `_hiddenLayerWarning`, keys from `layer.inPoint + delay + stagger*i`, one undo group, per-layer `applied[]` with times/values/offscreen point. Shared helpers `_recipeKeys` (eased 2–3 key move) and `_easeArr`. Registry: `recipe` enum + 15 optional params; bridge validates recipe/targets/`around_layer_id`; CORE in tool gating; workflow rule 4 now routes standard patterns to the recipe first.

Live-verified via CDP (AE 2026, scratch comp) with `probe_motion`: pop-in 0→77→110→100 from t=1.0 (the layer's in-point); slide-in of a parented child from comp x=−100 to exactly its original comp position; fade both 0→100 at 2–2.5 s and 100→0 at 5.5–6 s; pulse 100/110/100/90/100; orbit radius 300 at every sample and back home after one period; follower = leader(t−0.5) + offset; shake rig with 3 children. Corpus (`--tag recipe`, 4 new cases): pop-in and slide-in passed via the recipe on the first run; two findings fixed the same hour — models write `child_layer_id`/`child_layer_index` for `set_layer_parent` (8 failed calls read as "parent = itself"; bridge accepts the aliases, host explains a self-parent), and "добавь тряску камеры" created a camera in a 2D comp — THREE runs in a row, the third after two explicit prompt rules, and the model also flipped every layer to 3D "so the camera matters". Prompt rules do not beat this prior; a host guard does: `create_layer(camera)` is refused in a comp with no 3D layer (`error_code: CAMERA_IN_2D_COMP`, `opts.force` bypass for scripted use). The first refusal text offered "switch the layers to 3D first" as the honest alternative — the model took it literally (batch `set_layer_3d` ×3, then the camera again): a guard message must name ONE path, never the workaround; v2 names only the recipe and `set_layer_3d`'s description says never to flip 2D layers for a camera move. Corpus case passes via the null rig on the next run; it also fails on "camera created or 2D layers switched to 3D". The full 25-case run then exposed a plan-turn side effect: in 4 cases the execution turn returned the PLAN again (zero tool calls) and the loop accepted it — `lib/pure/doneGuard.js` gained `looksLikePlan` (numbered steps + tool names / future-tense verbs, RU+EN; questions and reports excluded) and a `plan-only` nudge ("That is a plan, not the work — EXECUTE it"), one per run, wired through the existing phantom-done path. `explicit-mapping` kept failing for a different reason: the model wrote `in_type:"hold", out_type:"linear"` on the key AFTER which the value should stay — it believes hold acts on the incoming side, so every "visible 1–2 s" window became a ramp (50% at the midpoints). Fix layer: host `_opacityRampNote` on `add_keyframes` / `set_keyframes_batch` measures Opacity halfway between consecutive keys and warns with the actual percentages; `in_type`/`out_type` descriptions and a KNOWN_LIMITATIONS bullet now say which SEGMENT each side shapes. Two more from the 25-case regression (23/25): the model may echo the plan-turn marker `[[final]]` on a later turn (alone or appended) — the loop now strips it from every final text and treats an empty remainder as "the plan text was the answer" (`outcome` was the bare marker before); and the comp snapshot's `animated.*` now carries `firstValue`/`lastValue`, so the scene diff (and the VERIFY message) says "holds 100 BEFORE 1.00s (visible from the in-point)" when a visible first key sits after the in-point — the "visible 1–2 s but shows from 0" defect becomes visible in the diff the model must answer to. Tests 276 → 283.

### Eval corpus, tool gating, prompt diet (2026-09-02, same day — still 69 tools)
The closed-loop work made the agent observable; this pass made it MEASURABLE and cheaper, then used the number.

- **Eval corpus** — `scripts/eval-cases.js` (21 human-style RU requests: fade/move/shrink/spin/pulse, hidden and locked targets, parent space, already-staggered, constraint preservation, broken-expression repair, orbit speed, text change, typewriter, slider rig, delete/rename, stagger, background solid, follow-with-delay, explicit visibility windows, pure question) + `scripts/eval-corpus.js` (fresh ExtendScript fixture per case in `Eval-Comp`, real agent loop with plan/verify/scene diff wired like main.js, structural probe with comp-space samples, pure semantic checks, JSON report with per-tag pass-rate and a fingerprint: model, sha1 of prompt+registry, git rev, flags; `--only/--tag/--limit`, `--plan/--verify/--gating on|off`, `--compare <report>`). Checks judge observable outcomes (values at times, comp-space positions, names, switches), never the method. Reports are gitignored.
- **Tool gating** — `lib/pure/toolGating.js` (`PURE_TOOL_GATING`, 4 tests): 28 CORE tools are always offered; 10 groups (shapes, masks, effects, expressions, 3D, markers, project, compositing, subtitles, capture) join when any user message matches their RU/EN keywords, and a gated group is loaded the moment the model calls one of its tools (also inside `batch_call`) — the call still executes, so a missed keyword costs one schema-less turn. `agentToolGating` default ON; the loop result carries `toolGating: {initialGroups, loadedOnDemand, offeredTools, allTools}`.
- **Prompt diet** — 14 bullets whose content now reaches the model through tool results, guards or the scene diff were compressed (37,293 → 34,983 chars); the parent-space rule merged into one bullet; the "map by NAMES" rule rewritten as "follow the ORDER the request gives" (an explicit direction cue like «сверху вниз» beats name order); the empty-selection rule now proceeds when the comp makes the target unambiguous («карточки» = the only Card 1–4).
- **Guards found by the corpus** — (1) `_parentCloneExprError` also rejects a child Position expression that reads the PARENT’s rotation/scale/anchor (a 3× orbit request ended at 6×: rotation applied by parenting and again by the expression); (2) `probe_motion` reports `speed` (one-frame delta at the first sample — cannot alias) and warns that evenly spaced samples alias fast periodic motion (the model had "fixed" a healthy orbit after 5 sparse samples looked random; 31 calls, 715k tokens); (3) `_firstKeyNote` on `add_keyframes`/`set_keyframes_batch`: before the FIRST key a property holds that key’s value — "static 0, then keys 1s→100 / 2s→0" showed the card from t=0; the note fires for Opacity/Scale when a visible first key sits after the in-point; (4) the verify turn lists layers UNLOCKED during the run (`collectUnlocks`, also inside `batch_call`) — the model had unlocked, moved and re-locked a layer and reported a plain move; (5) loop result exposes `plan` and `outcome` (final message without the prepended plan) so guards and evals judge the outcome, not the plan text; (6) `set_layer_timing` / hold-key descriptions now say that "visible from A to B" is a trim or hold keys, never a linear opacity ramp.

Numbers (gpt-oss-120b, plan+verify on): baseline 19/21 → gating+diet+guards 19/21 (the two failures were corpus defects, fixed: a stagger fixture where every card sat at the same y so «сверху вниз» degenerated to name order, and an already-staggered check that demanded the words "already done" while the model had correctly added fades aligned to the existing in-points — 2/2 on re-run); prompt tokens −21% on the eight cases with identical call counts, wall-clock 507 → 384 s. Gating alone on a 5-case A/B changed no verdicts.

Deferred: deterministic motion recipes (pop-in, slide-in, orbit rig, follow-delay, cam-shake, pulse), a change journal so «ускорь» retimes the agent’s own last rig, planner/executor model split, `reasoning_effort` on the plan turn. Tests 269 → 276.
### Closed-loop agent (2026-09-02) — scene snapshot, `probe_motion`, scene diff, plan + verify turns (67 → 69)
Analysis after six hunt rounds (plan: `docs/superpowers/specs/2026-09-02-agent-reliability-plan.md`): failures on simple human requests share three structural causes — the agent never observed what it did (one still frame was the only feedback), its world model carried no values / keyframe ranges / switches (the prompt said "check `enabled` in the comp summary" while no read tool exposed it), and nothing was planned before mutating (thinking off, `tool_choice: auto`). GLM-5.1 is unavailable, so every fix is harness-level and model-independent (default `openai/gpt-oss-120b`):

- **Scene snapshot** — `extensionsLlmChat_getDetailedCompSummary` (full mode) adds per layer `enabled`/`locked`/`solo`/`shy`, `transform` values at comp time (`_SNAPSHOT_PROPS`), `compPosition` for parented layers (`_compSpacePosition`: parent chain, 2D + Z rotation — ported from the round-6 hunt probe), `animated` = `{numKeys, from, to}` per animated property (+ `sourceText`, `timeRemap`), `text`, `timeRemapEnabled`, `numMasks`; root `compId`, `time`, `bgColor`. Compact mode adds `enabled:false` / `locked:true` only when set. Panel-only `fingerprint:true` (NOT in the tool schema) adds `sig` hashes (`_hashStr`, djb2/base36) to keyframe ranges, expressions, effects (`_effectSig`) and text so snapshots can be diffed without dumping values.
- **`probe_motion`** (READ_ONLY) — `extensionsLlmChat_probeMotion`: samples a property at explicit `times` (≤ 25) or N evenly spaced samples over the layer's visible window, keyframes + expressions applied; `space:"comp"` returns Position through the parent chain (Position only, else an explicit error); per-sample `visible` (video switch, in/out, opacity 0, scale 0) and a never-visible WARNING; summary `{changes, maxDelta, first, last, numKeys, hasExpression, expressionError}`. This is the agent's only way to verify motion — the vision check is one still frame.
- **Scene diff** — `lib/pure/sceneDiff.js` (`PURE_SCENE_DIFF`, 8 tests): `diffScenes(before, after)` → added/removed/changed/moved layers with readable change lists (rename, switches, parent, in/out, transform values, keyframe ranges + value edits via `sig`, expressions set/changed/removed + errors, effects added/removed/settings changed, text, time remap, masks); a comp switch mid-run short-circuits; `formatDiff` caps layers/chars. `main.js`: `snapshotScene()` before every `handleSend` run, `sceneDiffSince()` after a mutating run appends the transcript note `Actual changes (scene diff): …` (transcript-only, like the vision notes).
- **Plan + verify turns** — `agentToolLoop.js`, options `planTurn` / `verifyTurn` / `getSceneDiff` / `onPlan`; `main.js` wires them from `agentPlanTurn` / `agentVerifyTurn` (both default on; the correction loop does not use them). Plan: one tool-less call with `[SYSTEM] PLAN FIRST` (`buildPlanInstruction`: targets / hard constraints / expected observable result / steps); the plan stays in the loop history, is streamed into the thinking indicator and prepended to the final answer; `[[final]]` (`PLAN_FINAL_MARKER`) short-circuits pure questions; empty plan content drops the instruction and runs as before. Verify: when the model wants to finish after ≥ 1 successful mutating call, ONE `[SYSTEM] VERIFY` message (`buildVerifyMessage`) carries the actual scene diff, says "NO changes were detected" when tools ran but nothing changed, and demands `probe_motion` / `get_keyframes` measurement + fixes before the final answer. Worst case +2 model turns per run — the user's stated priority is quality over cost.

Prompt: CORE_RULES 1 (reason from snapshot values) and 9 (measure, then expect `[SYSTEM] VERIFY`) rewritten; hidden/locked bullets now point at fields the summary really exposes; tool count 69. Tests 253 → 269 (`test/sceneDiff.test.js`, loop plan/verify cases, registry/prompt assertions; ES3 lint passes on the new host code).

Live-verified via CDP in AE 2026 on a scratch comp (null `Orbit` with `time*90` rotation, parented shape `Moon` at `[300,0]`, hidden + locked solid, text with opacity keys): summary shows `enabled:false, locked:true`, `compPosition [1260,540]`, `animated.opacity {2 keys, 0–1s}`; `probe_motion(space:"comp")` on Moon traced the 300 px orbit (max delta 599.79) while layer space stayed static; hidden layer → `visible:false` + WARNING; bad path / bad space → actionable errors; the scene diff after 7 mutations listed exactly `+ "NewNull"`, Orbit expression changed, Moon scale `[100,100,100] → [50,50,100]` + rotation keys added, Label switch off + Gaussian Blur + text change. Real agent run («Moon плавно появлялся 0→100 за 0.5 с, остальное не трогай», gpt-oss-120b): plan turn → summary → `set_keyframes_batch` → VERIFY with the diff (`Moon: opacity keys 0.00–0.50s`, nothing else) → honest final answer; 27 s, 4 model calls, 88k prompt tokens. A second UI-level run exposed the next gap: the model scaled a layer whose video switch was OFF, received the host WARNING, and still told the user nothing — so the diff now marks such layers `[video switch OFF — not visible]` (added/changed entries carry `hidden`), and `buildVerifyMessage` adds a "renders NOTHING — enable it or say so" sentence when the mark is present; on the rerun the final answer said «Слой по-прежнему отключён (eyeball off)… включите через set_layer_switches» unprompted.

### Broad bug-hunt fixes (2026-08-16, round 4) — parent-space VALUES, hidden layers, visibility vs data
A fourth hunt (5 human-style Russian prompts: mass duplication with constraints, slider rigs, delay chains, scatter across frame) produced 7 findings (N1–N7); all fixed the same day.

*N1: parent-space applies to VALUES, not just expressions (worst finding).* "Разбросай 30 копий по всему кадру" on layers parented to a center null → the model randomized Position with comp-space ranges (0..4096) in PARENT space → x landed at 2209..5980, half the copies off-screen. Round-3 only guarded parent-space *expressions*. Fix: host `_parentSpaceNote` — whenever `setPropertyValue` / `addKeyframes` / `setKeyframesBatch` / `randomizeProperty` (absolute mode) touches Position of a parented layer, the result message appends a NOTE naming the parent, its comp position, and the exact `[x-px, y-py]` conversion; plus a KNOWN_LIMITATIONS bullet (children of a center null scatter as ±width/2 around 0).

*N2: explicit constraints ignored.* "Оригиналы не трогай" → original got the flicker expression anyway (31/31 layers); "маленьких копий" → copies stayed full-size 600×400. Prompt rule in CORE_RULES: explicit constraints are HARD limits — re-read the request and verify every named constraint against what was actually done before replying.

*N3: rig built on hidden layers.* Three text layers had the video switch off (`enabled: false`); the agent animated them and reported visible results — nothing renders. Fix: host `_hiddenLayerWarning` appends a WARNING to every mutation result (`setPropertyValue`, `addKeyframes`, `setKeyframesBatch`, `applyExpressionToTarget`, `applyExpressionBatch`) on a disabled layer; prompt bullet: check `enabled` before building, never report animation on a hidden layer as visible.

*N4: invisible-by-design + vision verdict dismissed.* 20px white circles on a white 4K background, and a "Spread" slider whose useful travel was 0–7 of 0–100 (at 100 → x=±26 000). The vision check CORRECTLY said "circles not visible", but the agent checked only data-state (expressions present) and dismissed the verdict. Fixes: prompt bullets (contrast + size proportional to comp; normalize sliders via `linear(slider, 0, 100, min, max)`) and `buildCorrectionPrompt` now states that intact data does NOT refute a visibility report — verify contrast/size/on-screen position/video switch before calling a "not visible" issue a false positive.

*N5/N6: fragile rigs and ambiguous names.* Rig keyed to `thisLayer.index` (breaks on any reorder, and index order is REVERSE of creation) → prompt bullet: derive variation from the layer NAME, a slider, or baked constants. 30 duplicates all named "Card 4" → prompt bullet: rename right after `duplicate_layer`.

*N7 (accepted, not fixed):* vision missed an empty left half on "разбросай по всему кадру" — a composition-quality judgment beyond the current verdict schema; noted only.

Positives: no round-3 regressions (name→range mapping correct, parent-clone trap avoided, delay chain exact). Tests 225 → 227 (round-4 prompt bullets, vision data≠visibility line).

### Broad bug-hunt fixes (2026-08-16, round 3) — parent-space expressions, scale failure modes, locked layers
A third hunt on heavier scenarios (6×6 grid via big batches, slider rig with cross-layer wiggle, staged reveal driven by one Progress slider, undo) produced 5 findings (F1–F5); all fixed the same day.

*F1: parent-position-clone on parented layers (reproduced twice — layout destroyed).* On a PARENTED layer, Position is in parent space; the model kept writing `thisComp.layer("Parent").transform.position + wiggle(...)` on children of that very parent — mixing comp-space coords into parent space flies the layer ~[parent position] px away AND doubles parent motion. Fix: host-side rejection (`_parentCloneExprError` in `applyExpressionToTarget` + `applyExpressionBatch` — refuses expressions on Position of a parented layer that reference the parent's `.position`/`.transform.position`, points to `value + wiggle(...)`) + a KNOWN_LIMITATIONS bullet (correct base is `value`; "move 200px right" = change the VALUE, not an expression).

*F2: how the agent dies at scale (6×6 grid run).* Four sub-failures: (a) a giant `batch_call` emitted invalid JSON and was retried **identically** — the arg-parse error now measures the payload and explicitly says "split into batches of ≤ 8" (prompt got the same cap); (b) hallucinated tool name `get_layer_switches` → `hostBridge` unknown-tool error now says "this tool does not exist — use ONLY tools from your tool definitions" with the real alternatives; (c) hitting the 60-step cap silently returned partial text claiming success → the loop now appends a `[SYSTEM]` turn and makes ONE extra no-tools model call demanding an honest report (completed / NOT completed / leftovers), with a `Partial results above.` fallback if that call fails; (d) an 80px grid in a 4K comp → prompt bullet: read comp width/height, center = [width/2, height/2], never hardcoded 1920×1080 values.

*F3: explicit name→value mappings inverted.* "Card 1 → 0–25, Card 2 → 25–50…" was applied by iterating timeline stacking order (top→bottom = REVERSE of naming order), so Card 4 got Card 1's range. Prompt bullet in CORE_SELECTED: map sequences by the NAMES the user lists, never by layer index order.

*F4: locked layers silently modified.* AE scripting bypasses `layer.locked`, and the model even flipped a lock off without saying so. Host-side `_lockedRefusal` guard now refuses mutation on locked layers in `applyExpression`(+batch), `deleteLayer`, `addKeyframes`, `setKeyframesBatch`, `setPropertyValue`, `add/removeEffect`, `setEffectPropertyValue`, `setTextDocument` (stagger/randomize keep their existing unlock-and-restore); prompt: never silently unlock — tell the user, or unlock via `set_layer_switches` and SAY SO.

*F5: already-satisfied state re-applied.* "Stagger by 3 frames" on layers already exactly 3 frames apart doubled the stagger. Prompt rule: compare current state to the requested outcome first; if it already matches, report "already done" instead of stacking the change.

Positives confirmed in the same hunt: `undo_last(3)` reverted exactly, readbacks were honest, and all round-2 fixes held. Tests 219 → 225 (batch-split advice ×3, step-cap finalization + fallback, round-3 prompt bullets).

### Broad bug-hunt fixes (2026-08-16, round 2) — vision false positives, target discipline, AE-semantics rules
A second hunt (5 quick-action runs + 3 free scenarios, real LLM calls on the scratch comp) produced 8 findings; all 8 fixed the same day, live-verified via CDP where the fix is behavioral.

*Vision check false positives made destructive "corrections" (worst finding).* The frame was captured at the playhead (t=0) where every layer predates its in-point → M3 saw "completely black frame" → the correction loop **really mutated the comp** (reordered layers in one run, moved the camera in another). Three-part fix: (1) `capture_comp_frame` gained `at_time:"auto"` — host `_pickContentVisibleTime` scores candidate times (comp.time + each layer's visibility midpoint) by how many enabled content layers are actually visible (in/out window, opacity > 1%, |x/y scale| > 1%), never moves the playhead; the vision flow always captures with `auto` (live: playhead 0 → picked 5.35s). (2) `PURE_VISION_CHECK.classifyIssues` splits verdict issues into actionable vs weak (empty/black/blank-frame wording); when ALL issues are weak, `runVisionCheck` skips the correction round entirely and posts a weak-signal note. (3) `buildCorrectionPrompt` now demands verify-first (`get_detailed_comp_summary` etc.), allows "change NOTHING" for false positives, and forbids reordering layers / moving the camera unless a confirmed issue requires it.

*Target discipline.* Typewriter QA ran on a layer remembered from chat history while another was selected (skipped `get_host_context`); Loop QA with empty selection silently picked its own targets. CORE_SELECTED now requires `get_host_context` FIRST in the CURRENT run, forbids reusing remembered targets, and mandates ASKING when selection is empty and no layer is named. Live rerun: Typewriter hit the actually-selected «Текст ДВА»; empty-selection Loop asked instead of mutating.

*AE-semantics prompt rules (KNOWN_LIMITATIONS + modules + fixed example).* Camera rigs are inert in all-2D comps (Cam Shake built a correct rig that changed nothing — now: check `threeDLayer`, offer `set_layer_3d` or a null rig, never report an inert camera as working). Animation must fall inside the layer's visibility window (Slide In keyed position 0–0.3s while scale stayed 0 until 0.4s). Mask Expansion grows uniformly — directional reveals go through `ADBE Linear Wipe` (the old CORE example and MASKS module actively taught the wrong technique; both rewritten). "Attach/link layers" means `set_layer_parent`, not cloning position via expression (which stacked all 4 cards on one point). Live rerun of the link scenario: agent removed the clone expressions and parented all 4 cards to Master Control.

*RU-first quick actions.* All 16 `DEFAULT_ACTIONS` prompts/titles translated to Russian (labels stay English — industry terms); CORE_LANGUAGE now says to judge language by the conversation, not by one (possibly English) preset message. Live: Russian preset → Russian answer.

Tests 213 → 219 (classifyIssues, verify-first correction prompt, capture `at_time` mapping).

### Bug-hunt fixes (2026-08-16) — shift_keyframes, expression-override warning, no-comp probe (66 → 67)
A dedicated bug-hunt session with real LLM runs (6 agent scenarios + direct stresses on a scratch comp) confirmed five bugs; all fixed and live-verified end-to-end via CDP.

*"Начало слоя" ≠ t=0.* Asked to move Fill-effect keys "to the start of the layers", the model moved them to comp 0–1s while the layers' in-points were 0.7–1.3s — the whole animation played before the layers became visible, and the run was reported as success. Two causes, two fixes: a prompt rule (in-point IS the layer start; keys before it are silently lost) and a new `shift_keyframes` tool (host `extensionsLlmChat_shiftKeyframes`, modeled on `reverseKeyframes`' capture/restore so per-key ease and interpolation survive — unlike `_shiftPropertyKeyframes`, which drops them). `align_to:"layer_in_point"` computes the offset from the first key to the layer's in-point. Live rerun: one `batch_call` aligned all 4 layers' keys exactly to 0.7/0.82/0.94/1.06.

*Expression override.* `set_property_value` on a property with an enabled expression "succeeds" while the expression keeps winning — 4/4 "ok" with zero visual change and no warning anywhere. The host now appends a WARNING and sets `expressionOverride: true`; a prompt rule tells the model to check/remove the expression first. Live rerun: the agent set the value, saw the warning, honestly reported the override, and the correction round removed the expressions.

*False "⚠ No active composition".* `handleSend` read the **stale note text** (`indexOf('unavailable')`) which refreshes async and loses the race with the Send click. `refreshActiveCompNote()` now returns a promise (`true` = comp, `false` = no comp, `null` = probe failed = stay quiet) and handleSend warns only on an explicit `false`.

*batch_call × anti-spam guard.* Identical failing items within one batch trip the guard (items 4+ get RETRY_BLOCKED), but per-item results dropped `error_code` and the summary said "re-send ONLY the failed ones" — telling the model to do exactly what the guard blocks. `_runBatchCall` now passes `error_code` through and the summary distinguishes blocked items ("do NOT re-send as-is; investigate").

*Visual check is a weak signal — by design.* One captured frame cannot verify motion/timing: 6/6 runs got "OK" including both broken ones. Per user decision it is labeled, not strengthened: the transcript message and the toggle tooltip now state it checks a single still frame and does NOT verify motion or timing. Expect true-but-useless verdicts like "frame is black" when the playhead sits before all in-points.

### Partial-run fixes (2026-08-10) — batch_call, expression removal, tool-call salvage (65 → 66)
The user's live complaint was "the agent keeps erring and does not perform the requested operations", and every round it turned out to be a code cause, not model weakness. Three measured ones, all fixed and live-verified via CDP.

*`batch_call`.* Batch forms existed only for keyframes and expressions, so "apply this to all N layers" cost N LLM round-trips while the prompt demanded aggressive batching. The model compromised: measured **3 of 22** `BG Box` layers actually retimed (later 13/22), with a final answer enumerating all 22 as done. `batch_call` (first entry in `toolRegistry.js`, `_runBatchCall` in `hostBridge.js`) runs up to `BATCH_MAX_CALLS = 60` `{tool, args}` items in one turn, sequentially, preserving order, and returns per-item `{index, tool, ok, message}` plus `succeeded/failed`. Nesting is rejected. Its message tells the model to **re-send only the failed items** — a naive retry of the whole batch double-mutates. It reports its own **`undoUnits`**, because each host call opens its own AE undo group; `main.js` `countUndoUnits()` prefers `result.undoUnits` when present, and counts it even on a failed batch (a partial batch still mutated the project). Prompt rule 5 now routes any operation over 3+ layers into one `batch_call`, and new rule 10 forbids overstating coverage. Live: retiming 6 layers went from 22 calls to **5** (`search_layers` ×2, summary, `batch_call` 6/6, summary) with an honest report.

*Expression removal had no implementation.* "убери экспрешен" failed three times in a row live. Cause: `apply_expression(expression:"")` was rejected by the host as a missing field, so the model fell back to `set_property_value(Opacity, 100)` — which leaves the expression in place and silently overrides the user. `extensionsLlmChat_applyExpressionToTarget` now type-checks instead of truth-checks (`typeof expressionText !== 'string'`), and an empty string sets `expression = ''` + `expressionEnabled = false` under a "Remove Expression from Target" undo group; `applyExpressionBatch` does the same per target. Both tool descriptions state that empty string is **the only** way to remove and that `set_property_value` is not a substitute. Live: 6/6 removed on the first try.

*Tool-call salvage.* Models sometimes emit tool-call JSON into `content` instead of `tool_calls` (a turn that then does nothing). `lib/pure/toolCallSalvage.js` (`PURE_TOOL_CALL_SALVAGE.parseLeakedCall(content, tools)`) recovers it, and `agentToolLoop.js` retries it as a real call (max 10 per run). Two forms: **named** (`{name|tool|tool_name|recipient, arguments|args|parameters}`, string arguments re-parsed) — accepted only when the name is a **known tool**, otherwise `{"layer_index":3,"name":"BG Box 0.9"}` would become a call to a tool named "BG Box 0.9"; and **by argument shape**, which requires all schema-required keys (with `layer_index`/`layer_id` treated as equivalent) and no unknown keys. Array-of-object args are compared against `items.properties`/`items.required` — without that, `set_keyframes_batch` and `apply_expression_batch` are indistinguishable (both take only `targets`). **A match is returned only when exactly one tool qualifies**: executing the wrong mutating tool is worse than showing the user raw JSON. 12 tests built from the real leaked payloads.

Also fixed here: the `countUndoUnits` refactor dropped `var allCalls` while two `main.js` call sites still used it, so **every** agent run died at the final step with `Error: allCalls is not defined` — tools had already run, only the answer was lost. Found by running a real agent turn through CDP rather than by reading the diff.

### Compositing tools (2026-07-27) — 5 tools + markdown fix
Bug fixes: markdown renderer mangled code spans (`*` inside `` ` `` became `<em>`, `#`/`-` lines inside code blocks became headers/lists) — fixed via stash/restore placeholders in `lib/pure/markdown.js` with 6 regression tests; `setCompSettings` `bgColor` dead branch (`typeof x instanceof Array` — always false).

Added five compositing tools (55 → 60), user-approved: `set_track_matte` (alpha/luma mattes; modern `setTrackMatte()` API with any-layer matte, legacy layer-above fallback), `set_layer_switches` (enabled/motion_blur/adjustment/shy/solo/locked/guide/collapse_transformation/effects_active/audio_enabled; unlock-first/lock-last ordering; warns when comp motion-blur switch is off), `set_time_remap` (enable/disable; animate via `"Time Remap"` property path), `split_layer` (deterministic duplicate+trim, no menu command), `open_comp` (switch active comp by id/name — unlocks editing inside precomps). `set_comp_settings` gained `bg_color` + `motion_blur`. All in the `getCapabilities` probe; prompt section "Track Mattes, Switches, Time Remap, Split, Comp Switching". New consistency tests: every registry tool has a bridge case; every bridge host call exists in index.jsx (148 total pass). Live-verified in real AE via CDP (24-step chain, all pass): matte set/remove/luma-default, switches incl. unlock-first ordering + comp-MB warning, comp bg_color+motion_blur, split at 2.5s (correct in/out on both parts) + out-of-span error, time-remap denial on text + enable on precomp + Time Remap keyframing/readback, open_comp by name/id + bad-id error.

---

## Live testing against real AE (CDP pipeline)

When the user has AE open with the panel loaded, you can drive the panel directly:

1. `.debug` file (gitignored) sets remote-debug port **8092** for AEFT; PlayerDebugMode must be 1.
2. `node scripts/cdp-eval.js "<js>"` — evaluates JS inside the panel page (Runtime.evaluate, awaitPromise, 120s timeout). For anything non-trivial use `node scripts/cdp-eval.js @payload.js` (shell escaping breaks inline quotes). Wrap payloads in an IIFE — top-level `const` persists between evaluates.
3. Hot-reload JSX without panel restart: eval `cs.evalScript('$.evalFile("<ext>/host/index.jsx"); "reloaded"')`. **`$.evalFile` must be a TOP-LEVEL statement — wrapping it in an IIFE scopes all function declarations locally and the reload is silently lost** (functions look updated inside that same eval, but the engine keeps the old versions). Full panel reload: `location.reload()` + ~4s wait.
4. Call tools via `hostBridge.executeToolCall(name, argsObject)` from the evaluated payload.
5. **Eval corpus (2026-09-02)** — `node scripts/eval-corpus.js` runs the fixed corpus in `scripts/eval-cases.js` (21 human-style RU requests, fresh fixture per case, real agent loop with plan + verify + scene diff wired like main.js, structural probe, semantic checks) and writes `scripts/eval-report-<ts>.json` with pass-rate per case/tag and a fingerprint (model, prompt+registry hash, git rev, flags). Filters: `--only id,id`, `--tag guard`, `--limit N`; A/B the harness with `--plan off` / `--verify off`; `--compare <old-report.json>` prints regressions/fixes. **Run it before and after any prompt or loop change** — it is the number the bug-hunt rounds never had. Cases test observable outcomes (values at times, comp-space positions, names, switches), never the method.

ExtendScript (ES3) quirks verified live: `string + Array` throws; `addProperty()` invalidates sibling property references; Layer has no `moveTo(index)`; AE error strings contain raw `\r\n`; no `JSON` object — build result strings by manual concatenation.

---

## Where to find what

| Question | File |
|---|---|
| User-facing setup, features, install | `README.md` |
| 70 tools, capabilities, limitations | `docs/capabilities-and-roadmap.md` |
| Live AE validation methodology + bug tables | `docs/superpowers/specs/2026-06-10-deep-audit-report.md` |
| Agent loop architecture, tool categories | `docs/final-architecture.md` |
| Config fields, loading order, secrets | `docs/configuration.md`, `docs/secret-handling.md` |
| Panel ↔ AE communication patterns | `docs/host-bridge-notes.md` |
| State + session + message JSON shapes | `docs/runtime-state-schema.md` |
| Common errors and fixes | `docs/troubleshooting.md` |
| Pre-release validation | `docs/release-checklist.md` |
| Quick QA scenarios | `docs/qa-test-plan.md` |
| Detailed iter-1 improvements plan | `.omc/plans/improvements-2026-04-30.md` |
| KB corpus (reference only, not loaded at runtime) | `knowledge-base/corpus/` |

For external (Obsidian) context, see also:
- Vault folder note: `<vault>/01 Projects/AE Motion Agent/AE Motion Agent.md`
- Iteration artifacts in the same folder

---

### Change journal (2026-09-03) — still 70 tools

The agent's OWN earlier changes, per comp, as one `[SYSTEM] JOURNAL` message before every later request. Why: the model's tool calls sit in the history as raw JSON (pruned first when the conversation grows) and the "Actual changes" scene-diff note is UI-only, so a follow-up ("ускорь", "ещё раз", "то же для X", "отмени") had to reconstruct what "the rotation" is from prose. `lib/pure/changeJournal.js` (browser global `PURE_CHANGE_JOURNAL`, also `require`-able): `buildEntry({request, toolCallLog, diff, diffText, …})` turns a finished run into a compact entry — mutating calls only, one line each (`apply_motion_recipe orbit → "Circle C" (id 14) parented to new null "Circle C Orbit" around "Circle B" [period 2, radius 400]`, `set_keyframes_batch id 3 Transform>Opacity: 2 keys at 0–1s`, `apply_expression id 7 …: "…"`, `batch_call:` expanded), the layers it created (with ids, from the diff) and the diff summary; read-only, failed and no-op runs produce no entry. `formatJournal(entries, {compName})` writes the message (filtered to the current comp, newest 8 entries, 1800 chars, oldest dropped first) with the rule "edit these layers/expressions/keys in place — never a second rig". Wiring: `agentToolLoop.runAgentLoop({journal})` splices it in as a `user` message right before the latest request (plan instruction still comes after); the panel keeps `session.journal` (persisted via `sessionStore`, 30 entries max), appends an entry where the diff note is pushed, and passes `journalTextFor(session, compName)` in both the main and the correction loop; `scripts/eval-corpus.js` builds the same entries between the turns of a multi-turn case (`--journal on|off`, recorded in the report meta). New two-turn corpus case `orbit-then-faster` (orbit, then "Ускорь вращение в два раза."): radius/period checks on both turns, no layer added or removed and no second null on the follow-up. Measured: the deferred hypothesis ("ускорь" rebuilds the rig) did NOT reproduce — the baseline without the journal also retimed the existing null, because the model's own turn-1 text named it; with the journal turn 2 went straight to `get_expression` on the named null (3 calls / 103k tokens vs 4 calls / 124k). Kept as a cheap context aid plus a multi-turn regression guard, not as a fix. Side observation: on turn 1 the model built the orbit by hand (null + parent + expression) in both runs, while the single-turn `orbit-new` case takes the recipe. Full regression with the journal + one new prompt bullet: 22/26 on the first full run (3.2M tokens, 790 s) — three zero-tool marker-path cases (shrink, stagger-new, popin-late) plus slide-from-right; explicit-mapping and question-only fixed, orbit-then-faster PASS; every failed case green on focused re-runs after the guards described next (shrink 4/4, popin-late 4/4, slide-from-right 3/3). Tests 283 → 289. The same regression caught a loop gap the plan-only guard had NOT closed: `shrink` ended after ONE model call with zero tools — the plan turn returned a plan with `[[final]]` glued to it, and the marker short-circuit skipped the phantom-done guard entirely. Re-reading the 2026-09-02 report: two of the four "plan restated" failures (move-right, parent-space-center: one call, ~9.6k tokens, empty `plan`) were this path too, and their re-run passes were model variance, not the guard. Fix: the marker path now runs `checkPhantomDone(answer, [])` — a plan-shaped or done-claiming answer is pushed back with the matching nudge (plan-only → the plan is still shown to the user via onPlan) and the run continues into tool turns; a genuine answer still short-circuits. Confirmation: the one-call / zero-tool signature did not recur in 8 later stagger-new runs, 4 shrink runs and 4 popin-late runs; shrink now takes 2 calls (plan + nudge + set_property_value, ~73k tokens). Tests 289 → 290. The fourth failure of that regression was a model one: `slide-from-right` had the recipe apply a correct slide-in (probe confirmed it), then the model read the keys back with `get_keyframes`, saw values that are not comp coordinates (the layer is parented, keys live in parent space), deleted them and rewrote them by hand — landing at comp [0,0] instead of [1400,300]. Fix layer: the `slide_in` result now states the comp-space landing point and, for a parented layer, that the keys are stored in PARENT space by design and must be checked only with `probe_motion(space:"comp")`, never rewritten from comp numbers. A second `stagger-new` re-run then failed for a third reason, the most destructive one: the model wrote a correct staggered Opacity animation, then "pinned" Opacity = 100 on every card with `set_property_value` inside a `batch_call` — and the host silently DELETED every keyframe to set the static value (its message mentioned it in parentheses; the model ignored it, the VERIFY diff said "NO changes" and the model still reported success). Two guards: (1) host `extensionsLlmChat_setPropertyValue` refuses a static value on a property that has keyframes (`error_code: PROPERTY_HAS_KEYFRAMES`, names the key range, one path: keyframe tools); the schema documents `replace_keyframes:true` for the explicit "remove the animation" case and the bridge passes it as the 5th argument; (2) the loop keeps what the VERIFY turn saw — after a no-change diff, a reply that still claims completed work with no further tool calls gets one `[SYSTEM]` nudge. Confirmation: live in AE: the refusal keeps both keys and names the range 0.4–0.6s, replace_keyframes:true removes them and sets 100; the silent-deletion path did not recur in 4 later stagger-new runs. Tests 290 → 292. The next `stagger-new` run with that guard in place failed AGAIN, and this time the corpus was wrong twice: (a) the model's first write was right (0→100 over 0.2 s, staggered), but `_opacityRampNote` flagged the 0.2-s fade as "HALF-TRANSPARENT between keys" and the model obeyed — five delete/rewrite rounds of correct keys; the note now skips segments shorter than 0.4 s and says a deliberate fade is fine (hold only "if a hard on/off window was intended"); (b) the check's `appearanceTime` took the time of the FIRST key regardless of value, so the correct "0 at t=0 (hold), 100 at 0.4 s" counted as appearing at 0 — the probe now exposes per-key values and the helper uses the first VISIBLE opacity/scale key (a visible first key = visible from the in-point). Re-run after both: fade-in, already-staggered 2/2, stagger-new 2/2 and popin-late all PASS (6/6 case runs) after the check fix and the softened note. Confirmation of the slide_in note: live message verified in AE (local keys [440,-240] vs comp landing [1400,300]); slide-from-right 3/3 PASS after the note.

## How to add a new tool (5 places to touch)

1. **ExtendScript function** in `host/index.jsx`:
   - Follow existing pattern: `var ctx = extensionsLlmChat_resolveActiveComp();` → resolve layer/prop → `_beginToolUndo` → operate → `_endToolUndo` → `return resultToJson({ ok: true, ... })`.
   - Use `_resolveLayer(comp, layerIndex, layerId)` — it falls back to first selected layer when both are missing. For tools where this is unsafe (shape-content tools), require explicit IDs via `_validateRequiredArgs`.
   - Wrap in try/catch — return `{ ok: false, message: 'toolName error: ' + e.toString() }` on failure.

2. **Tool definition** in `toolRegistry.js`:
   - OpenAI function-calling format. Mark required fields.
   - For creation tools, add optional `client_op_id` param for idempotency.
   - For effect properties, prefer `property_name` over `property_index`.

3. **Bridge mapping** in `hostBridge.js`:
   - New `case` in the `executeToolCall` switch. Use `toESLiteral(args.xxx)` for ExtendScript-safe serialization.
   - If the tool has required args the LLM might forget, add a case in `_validateRequiredArgs` with an actionable error message.

4. **Update system prompt** in `agentSystemPrompt.js` (only if needed):
   - Pure utility tools usually don't need prompt updates.
   - If the tool has subtle semantics or common pitfalls, add to KNOWN_LIMITATIONS or the relevant lazy module (EXPRESSIONS_MODULE, SHAPES_MODULE, etc.).
   - If you add a keyword that should trigger a module, update `KEYWORDS` regex.

5. **If read-only**, add to `READ_ONLY_TOOLS` in `agentToolLoop.js` so it runs in parallel with other reads.

6. **Capability handshake** — add the new function name to `extensionsLlmChat_getCapabilities`'s probe list in `host/index.jsx` (last function in file). Optional but useful for catching stale host scripts.

---

## How to debug a failing test

1. Get the exported error log from user (`~/Desktop/Логи/T*.json` or `~/Desktop/ae-agent-errors-*.json` or `~/Desktop/ae-agent-session-*.json`).
2. Parse with Python — typical pattern:
   ```python
   import json
   with open(path, encoding="utf-8") as f: d = json.load(f)
   msgs = d["session"]["messages"]
   calls = [tc for m in msgs if m.get("role")=="assistant" for tc in (m.get("toolCalls") or [])]
   errs = [c for c in calls if c.get("status")=="error" or (isinstance(c.get("result"),dict) and c["result"].get("ok") is False)]
   ```
3. Classify each error:
   - `args: {}` → missing pre-validation
   - `Layer not found` / `not a shape layer` → layer-tracking issue (see Fix C)
   - `RETRY_BLOCKED` → anti-spam triggered (4th repeated failure)
   - `Unknown tool: <|...>` → harmony leak (Fix I)
   - `Unable to set value as it is not associated with a layer` → text+font create_layer (Fix A)
   - Truncated assistant text mid-JSON → max_tokens (Fix M)
   - `![preview](file:///tmp/...)` with 0 `capture_comp_frame` calls → fabrication (Fix J)
4. If new pattern: add to `feedback_llm_failure_modes.md` memory + decide on fix layer (validation vs host vs prompt vs config).

---

## Boundaries and red flags

**You should escalate (ask user) before:**
- Adding new tools that mutate AE state outside the current 70
- Changing the API provider or the `AVAILABLE_MODELS` selector list (adding/removing/replacing a model)
- Modifying `_resolveLayer` selection-fallback behavior
- Changing the localStorage `ae-motion-agent-state` schema (breaks existing sessions)
- Touching CSXS manifest extension ID (breaks existing localStorage)

**You should NOT:**
- Re-introduce brand presets, motion presets, HTML export, or Ollama support — they live in **separate** CEP extensions (`Cloud.ru Motion Presets`, `Cloud.ru Motion Export`). This extension is **chat-only and stays that way**.
- Add proactive captures, frame previews, or visual feedback in chat. AE viewer is the source of truth.
- Make the agent more "polished" or "autopilot-like". User wants a **buddy** for hard expression work, not a one-prompt animation generator.

---

## Where to leave notes for the next agent

- **Code learnings** → `~/.claude/projects/.../memory/` (Claude Code memory)
- **Iteration artifacts** → `<vault>/01 Projects/AE Motion Agent/AE Motion Agent — итерация N *.md` (vault: `C:\Users\Глеб\Downloads\2nd brain` on Windows, `~/Downloads/2nd brain` on macOS)
- **Detailed plans** → `.omc/plans/<plan>.md` (gitignored, session-local)
- **Public-facing changes** → update `docs/<topic>.md` and add entry to `docs/release-checklist.md`
- **Update this AGENTS.md** when adding a new iteration or shifting boundaries

The vault folder note is the single source of truth for project status. The master index `<vault>/01 Projects/Экосистема Claude.md` aggregates chronology from all projects.

---

*Last updated 2026-09-02 — after the eval corpus, tool gating (default on) and prompt diet; run `node scripts/eval-corpus.js` before and after any prompt or loop change. If you read this and it feels out of date, refresh it before touching code.*
