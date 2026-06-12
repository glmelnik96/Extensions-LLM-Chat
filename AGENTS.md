# AGENTS.md — Entry point for AI agents working on AE Motion Agent

> If you are a new agent (Claude Code, Codex, or other LLM) starting work on this codebase — **read this file first**, then proceed to the relevant doc. This is the project HANDOFF.

---

## What this project is

**AE Motion Agent** (CEP extension folder: `Extensions LLM Chat`) is a chat-only AI agent embedded in Adobe After Effects 26+ via CEP (Common Extensibility Platform).

The user types a natural-language motion-design request → the agent plans a sequence of tool calls → each tool maps to an ExtendScript function that runs inside After Effects → results stream back into the chat. Cloud.ru Foundation Models (`zai-org/GLM-5.1`, a reasoning model; predetermined, no panel selector) provide the LLM via an OpenAI-compatible API with tool calling + SSE. These models stream chain-of-thought in a separate `reasoning` field (not `content`) — see `docs/superpowers/specs/2026-06-04-model-upgrade-design.md`.

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
├── toolRegistry.js            ← 50 OpenAI-format tool definitions
├── host/
│   └── index.jsx              ← ExtendScript: ALL AE operations (~3850 lines, 54 functions)
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
├── test/                      ← node:test unit tests (51 tests) — `node --test test/*.test.js`
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

---

## Live testing against real AE (CDP pipeline)

When the user has AE open with the panel loaded, you can drive the panel directly:

1. `.debug` file (gitignored) sets remote-debug port **8092** for AEFT; PlayerDebugMode must be 1.
2. `node scripts/cdp-eval.js "<js>"` — evaluates JS inside the panel page (Runtime.evaluate, awaitPromise, 120s timeout). For anything non-trivial use `node scripts/cdp-eval.js @payload.js` (shell escaping breaks inline quotes). Wrap payloads in an IIFE — top-level `const` persists between evaluates.
3. Hot-reload JSX without panel restart: eval `cs.evalScript('$.evalFile("<ext>/host/index.jsx"); "reloaded"')`. Full panel reload: `location.reload()` + ~4s wait.
4. Call tools via `hostBridge.executeToolCall(name, argsObject)` from the evaluated payload.

ExtendScript (ES3) quirks verified live: `string + Array` throws; `addProperty()` invalidates sibling property references; Layer has no `moveTo(index)`; AE error strings contain raw `\r\n`.

---

## Where to find what

| Question | File |
|---|---|
| User-facing setup, features, install | `README.md` |
| 50 tools, capabilities, limitations | `docs/capabilities-and-roadmap.md` |
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
- Adding new tools that mutate AE state outside the current 50
- Changing the API provider or model (`zai-org/GLM-5.1` ↔ another model)
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

*Last updated 2026-06-12 — after live AE validation (60f2b79). If you read this and it feels out of date, refresh it before touching code.*
