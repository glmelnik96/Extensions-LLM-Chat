# Architecture

Runtime architecture of the AE Motion Agent CEP extension. Read **[../AGENTS.md](../AGENTS.md)** first for the project HANDOFF.

---

## Stack

| Layer | File(s) | Role |
|---|---|---|
| Panel UI | `index.html`, `styles.css`, `main.js` | DOM, sessions, markdown, quick actions, batch-undo, KB injection, capability check |
| System prompt | `agentSystemPrompt.js` | Modular prompt (CORE + lazy modules keyword-triggered) |
| Agent loop | `agentToolLoop.js` | LLM ↔ tool execution with abort, streaming, parallel reads, validation |
| Chat provider | `chatProvider.js` | Cloud.ru `chat/completions` + SSE, retry on 429/5xx |
| Host bridge | `hostBridge.js` | Tool name → ExtendScript mapping, anti-spam guard, idempotency cache, pre-validation, harmony normalize |
| Tool registry | `toolRegistry.js` | 45 OpenAI-format function definitions |
| Host script | `host/index.jsx` | ~3200 lines ExtendScript — all AE operations |
| API | Cloud.ru Foundation Models | 3-model selector (`openai/gpt-oss-120b` default, `MiniMaxAI/MiniMax-M2.5`, `zai-org/GLM-4.7`) with tool calling and SSE; reasoning models use a separate `reasoning` stream field |

---

## Config loading

`index.html` script order:

1. `config/example.config.js` — defaults (tracked)
2. `config/runtime-config.js` — overrides (gitignored)
3. `config/secrets.local.js` — API key (gitignored)
4. `lib/CSInterface.js` — Adobe CSInterface (manually downloaded)
5. Agent modules: `toolRegistry.js` → `agentSystemPrompt.js` → `chatProvider.js` → `hostBridge.js` → `agentToolLoop.js`
6. `main.js` (last)

See [configuration.md](configuration.md) and [secret-handling.md](secret-handling.md).

---

## Agent tool loop (the heart of the system)

```
user message
  ↓
main.handleSend:
  • buildKnowledgeBaseContext(text)  — keyword-match KB snippets
  • AGENT_SYSTEM_PROMPT_BUILDER.build(text)  — CORE + matching modules
  • runAgentLoop({ modelId, systemPrompt, messages, tools, abortHandle, onTextChunk })
  ↓
agentToolLoop.step(N):
  • chatProvider.invoke()  — Cloud.ru API, SSE if onTextChunk
  • response.tool_calls?
      yes → executeToolCallsSequentially:
              • split into contiguous READ_ONLY + mutating runs
              • READ_ONLY → Promise.all (concurrent)
              • mutating → sequential (AE is single-threaded)
              • each call: buildToolCallThunk
                  • static validateExpression for apply_expression* — warnings attached to result
                  • hostBridge.executeToolCall:
                      • normalize toolName (strip <|harmony|> leak)
                      • anti-spam guard (3 fails → block)
                      • idempotency cache (client_op_id hit → cached)
                      • _validateRequiredArgs (fast-fail on args:{})
                      • evalHostFunction → CSInterface.evalScript → host/index.jsx
                  • record outcome for spam guard
      no  → final content; return
  ↓
result.content + toolCallLog → main.renderTranscript
```

Key invariants:

- **Single host load**: `hostBridge.ensureHostScriptLoaded()` runs once at startup, defining all ExtendScript functions. Subsequent tool calls just invoke them.
- **Sequential within mutating runs**: AE ExtendScript is not reentrant. Mutating tools (`create_layer`, `add_keyframes`, ...) run one at a time.
- **Parallel within read runs**: contiguous read-only tools (`get_*`, `list_*`, `capture_*`) execute via `Promise.all` — saves round-trips when the model inspects state.
- **Abort propagation**: `abortHandle.aborted = true` short-circuits the next loop iteration and aborts the in-flight fetch.
- **`max_tokens: 65536`** in `invokeOptions` — must fit reasoning chain-of-thought (billed as completion tokens) + long tool_call JSON chains + the answer in one turn. Endpoint ceiling for these models is 131072.

---

## Tool categories (55 tools)

| Category | Count | Tools |
|----------|---:|-------|
| Read | 10 | `get_detailed_comp_summary`, `get_host_context`, `get_property_value`, `get_expression`, `get_keyframes`, `get_layer_properties`, `get_effect_properties`, `get_mask_info`, `get_markers`, `list_project_items` |
| Layer ops | 10 | `create_layer`, `delete_layer`, `duplicate_layer`, `reorder_layer`, `set_layer_parent`, `set_layer_timing`, `rename_layer`, `set_layer_3d`, `move_anchor_point`, `stagger_layers` |
| Shape content | 3 | `add_shape_rectangle`, `add_shape_ellipse`, `add_shape_path` |
| Animation | 9 | `add_keyframes`, `delete_keyframes`, `set_keyframe_easing`, `set_property_value`, `apply_expression`, `apply_expression_batch`, `copy_ease`, `reverse_keyframes`, `randomize_property` |
| Effects | 3 | `add_effect`, `remove_effect`, `set_effect_property` |
| 3D / Camera / Light | 2 | `set_camera_properties`, `set_light_properties` |
| Masks | 3 | `add_mask`, `set_mask_properties`, `create_masks_from_text` |
| Markers | 2 | `add_marker`, `delete_marker` |
| Import | 2 | `import_file`, `add_item_to_comp` |
| Composition | 3 | `create_comp`, `precompose_layers`, `set_comp_settings` |
| Text | 1 | `set_text_document` |
| Preview | 1 | `capture_comp_frame` |
| Misc | 1 | `set_blend_mode` |

Full descriptions: [capabilities-and-roadmap.md](capabilities-and-roadmap.md).

The full list (with parameters) is the source of truth in `toolRegistry.js`. Capability probe runs at startup to verify the host script has all expected functions (see [host-bridge-notes.md](host-bridge-notes.md)).

---

## UI features

- Single chat panel — one session per CEP instance
- Tool call cards (collapsible, with args + result JSON)
- Markdown rendering (headers, code blocks, lists, inline images)
- Quick action buttons (Wiggle, Counter, Slide In, Bounce, Preview) above the input
- Streaming text preview during generation
- Footer: Undo, Clear, Export, Errors, Report
- Batch-undo (N × Cmd+Z for mutating tool calls)
- Stop (cancel running agent)
- Export → session JSON to Desktop
- Errors → error-only export to Desktop
- Report → LLM-analyzed summary + tool latency stats to Desktop
- Auto-resize textarea, `Cloud.ru` badge + 3-model selector in chat header (gpt-oss-120b / MiniMax-M2.5 / GLM-4.7; switching blocked mid-request), token usage display, anti-spam visibility (errors with `RETRY_BLOCKED`)

---

## Reliability subsystems (added during MVP + iter 1-4)

| Subsystem | Where | Purpose |
|---|---|---|
| Static expression validation | `main.js validateExpression` (8 patterns) | Catch invalid `if/else`, frozen `seedRandom`, unbalanced brackets, `.value` misuse before AE rejects |
| Validation warnings → tool result | `agentToolLoop buildToolCallThunk` | Warnings are attached to the host result so the model sees them and self-corrects |
| Pre-call required-args check | `hostBridge _validateRequiredArgs` | Catches `args:{}` for tools needing fields, returns fast actionable error |
| Anti-spam guard | `hostBridge _checkSpamGuard` | 4th identical failing call blocked with `RETRY_BLOCKED` code |
| Idempotency cache | `hostBridge _idempotencyCache` | `client_op_id` dedup for `create_*`, `add_effect`, `add_mask`, `add_marker` |
| Harmony name normalize (legacy) | `hostBridge executeToolCall` top | Strips `<|channel|>commentary` etc. from `function.name` (legacy gpt-oss decoder leak insurance; near-dead no-op on GLM-5.1) |
| Capability handshake | `host/index.jsx extensionsLlmChat_getCapabilities` + `main.checkHostCapabilities` | Surfaces stale/incomplete host script as visible warning |
| Type hints | `host/index.jsx _validateValueForPath` | Clear "expects [x,y]" instead of cryptic AE error |
| Persistent capture path | `host/index.jsx extensionsLlmChat_saveCompFramePng` + `_pruneOldCaptures` | `~/AE-agent-captures/<date>/` instead of `/tmp` |
| Tool latency stats | `main.computeToolStats` | Report includes per-tool count/errors/avg/min/max ms |
| Modular system prompt | `agentSystemPrompt.js KEYWORDS` | CORE always + matching lazy modules — saves ~40% tokens on simple requests |

---

## Persistence

- **localStorage key**: `ae-motion-agent-state`
- Stores: single session object — see [runtime-state-schema.md](runtime-state-schema.md)
- Auto-migrates from legacy multi-session format
- Session export/import via Footer buttons

---

## Adding a new tool

See [../AGENTS.md](../AGENTS.md) "How to add a new tool" — 5-step recipe with all touch points.
