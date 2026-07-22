# AE Motion Agent — Capabilities & Improvement Roadmap

## Current Capabilities

### Agent Tool System
The extension works as an AI agent that can inspect, create, and modify After Effects compositions through tool calls. The LLM plans a sequence of actions, executes them one by one via ExtendScript, and reports results.

**Supported tools (50):**

#### Read (inspection)
| Tool | Description |
|------|-------------|
| `get_detailed_comp_summary` | Full comp overview: layers, types, parents, effects, timing, expressions, 3D status, dimensions. Supports `compact` mode and filters (`layer_type`, `name_contains`, `max_layers`) for large compositions. |
| `get_host_context` | Timeline state: current time, work area, selections |
| `get_property_value` | Read any property value (optionally at a specific time), plus expression info |
| `get_expression` | Read the current expression on a property: text, enabled state, error message, canSetExpression |
| `get_keyframes` | Read all keyframes with times, values, easing |
| `get_layer_properties` | Deep scan of all properties on a layer |
| `get_effect_properties` | List properties of a specific effect |
| `get_mask_info` | Read all masks on a layer: mode, feather, opacity, expansion, vertex count |
| `get_markers` | Read all markers from a layer or composition |
| `list_project_items` | List all comps, footage, and folders in the project |
| `search_layers` | Find layers by name pattern / type without a full comp dump |

#### Layer operations
| Tool | Description |
|------|-------------|
| `create_layer` | Create solid, shape, text, null, adjustment, camera, or light |
| `delete_layer` | Remove a layer |
| `duplicate_layer` | Duplicate a layer |
| `reorder_layer` | Move layer in the stack |
| `set_layer_parent` | Parent/unparent layers |
| `set_layer_timing` | Set in/out points and start time |
| `rename_layer` | Rename a layer |
| `set_layer_3d` | Enable/disable 3D on a layer |
| `set_blend_mode` | Set layer blending mode |
| `move_anchor_point` | Reposition a layer's anchor point to a named spot (center, top-left, …) with position compensation so the layer does not visually jump |
| `stagger_layers` | Offset multiple layers in time (in-point, start time, or their keyframes) by a fixed step — forward or reverse |

#### Shape content
| Tool | Description |
|------|-------------|
| `add_shape_rectangle` | Rectangle with size, position, roundness, fill, stroke. Returns ready property paths (`sizePath`, `positionPath`, `roundnessPath`). |
| `add_shape_ellipse` | Ellipse with size, position, fill, stroke. Returns ready property paths. |
| `add_shape_path` | Custom bezier path with vertices, tangents, fill, stroke. Returns `pathPropertyPath`. |

#### Animation
| Tool | Description |
|------|-------------|
| `add_keyframes` | Add keyframes with values, interpolation type, and easing |
| `set_keyframes_batch` | Add keyframes to multiple properties/layers in one call |
| `delete_keyframes` | Delete keyframes at specific times or all |
| `set_keyframe_easing` | Change interpolation and easing on existing keyframes |
| `copy_ease` | Copy temporal ease (in/out/both) from one property's keyframes onto another's |
| `reverse_keyframes` | Reverse keyframe order in place — values and easing mirror around the time span |
| `randomize_property` | Randomize a property across layers within a range (absolute or offset), optional per-axis |
| `set_property_value` | Set a static value on any property |
| `apply_expression` | Apply an AE expression to any expressable property. Returns expression errors for agent self-correction + evaluated value readback. |
| `apply_expression_batch` | Apply expressions to multiple layer properties in one tool call with per-target success/error details. |
| `search_expression_library` | Search 54 curated expression snippets (`lib/pure/expressionLibrary.js`) — panel-local, no LLM round-trip |
| `link_properties` | Pick-whip: link a property to another via auto-generated expression (with optional remap range) |

#### Effects
| Tool | Description |
|------|-------------|
| `list_available_effects` | Search effects installed in this AE by name/matchName |
| `add_effect` | Add effect by matchName or display name, with optional rename (`effect_name`) for expression rigs |
| `remove_effect` | Remove an effect |
| `set_effect_property` | Set a value on an effect property |

#### 3D, Camera & Light
| Tool | Description |
|------|-------------|
| `set_camera_properties` | Zoom, focus distance, aperture, blur level, depth of field |
| `set_light_properties` | Intensity, color, cone angle, cone feather |

#### Masks
| Tool | Description |
|------|-------------|
| `add_mask` | Create a mask on a layer with custom vertices, mode, feather, opacity, expansion. Reports actual mode and warnings if properties fail. |
| `set_mask_properties` | Modify mask feather, opacity, expansion, mode, inverted. Reports warnings on failures. |
| `create_shapes_from_text` | Convert text layer outlines into a shape layer (letter shapes). Only works on text layers. |

#### Markers
| Tool | Description |
|------|-------------|
| `add_marker` | Add layer or comp marker at a time with comment and optional duration |
| `delete_marker` | Remove marker by index |

#### Import & Project
| Tool | Description |
|------|-------------|
| `import_file` | Import image/video/audio into the project |
| `add_item_to_comp` | Add a project item (footage or comp) to the active composition |

#### Composition
| Tool | Description |
|------|-------------|
| `create_comp` | Create a new composition |
| `precompose_layers` | Precompose selected layers |
| `set_comp_settings` | Change comp name, dimensions, duration, frame rate |

#### Text
| Tool | Description |
|------|-------------|
| `set_text_document` | Set text content, font, size, color, justification, tracking, leading |

#### Preview
| Tool | Description |
|------|-------------|
| `capture_comp_frame` | Save current frame as PNG and return the file path for inline display |

### UI

- **Single chat panel** — single session per project
- Chat interface with tool-call visualization (collapsible cards showing args + results)
- **Markdown rendering** in agent responses (headers, bold, italic, code blocks, lists, inline images)
- **Frame preview** — `capture_comp_frame` results shown as inline images in chat
- **No-composition warning** — system message when no active comp is detected before sending
- **Model selector** in chat header — `Cloud.ru` badge + 3 buttons (gpt-oss-120b / MiniMax-M2.5 / GLM-4.7); selection persists per-session, switching blocked mid-request
- **Live reasoning indicator** — model's `reasoning` stream shown as "Agent reasoning" status (never enters the chat)
- **Quick action buttons**: Wiggle, Counter, Slide In, Bounce, Preview — one-click common operations
- **Streaming text preview** — agent response text appears in real-time during generation
- **Textarea auto-resize** — input grows up to ~8 lines as you type
- **Footer**: Undo, Clear, Export, Errors, Report
- **Undo button** — reverts ALL agent actions from last request (batch-undo via N x Cmd+Z)
- **Stop button** — cancel a running agent mid-execution
- **Step progress indicator** — shows `Step N/maxSteps` and tool call count during execution
- **Token usage display** — shows total tokens after each request
- **Tooltips** on all buttons explaining their function
- Thinking indicator during agent execution with tool call counter

### Reliability (after MVP + iterations 1-4)
- **Static expression validation (8 patterns)** — catches invalid `if/else` (not ternary), frozen `seedRandom(constant, true)`, `.value` on property refs, double-call `effect()()`, unbalanced parens/brackets/braces, `\n` vs `\r` in SourceText, `var ;` at end. Warnings attach to tool result so the model sees them on the next turn.
- **Pre-call required-args validation** — `_validateRequiredArgs` in `hostBridge.js` catches Cloud.ru's tendency to emit `args:{}` for tools with required fields. Returns fast actionable error before the host runs.
- **Anti-spam guard** — same `(toolName, args)` failing 3 times → 4th attempt blocked with `error_code: 'RETRY_BLOCKED'`. Stops spirals like the 137-call T10 we observed.
- **Idempotency via `client_op_id`** — `create_layer`, `create_comp`, `add_effect`, `add_mask`, `add_marker` cache successful results. Retry with same id returns cached `{ deduplicated: true }`.
- **Capability handshake** — at panel startup, `extensionsLlmChat_getCapabilities()` probes for 20 helpers/functions in host. Missing ones surface as a visible "Host script outdated" warning.
- **Type hints for known property paths** — `Transform>Position` expects `[x,y]` or `[x,y,z]`; `Transform>Opacity` expects a number. Clear error before AE rejects.
- **Harmony format normalize** — gpt-oss-120b decoder leaks like `apply_expression<|channel|>commentary` in `function.name` are stripped client-side.
- **Modular system prompt** — CORE always-loaded (~2.8k tokens) + lazy modules (expressions, effects, 3d, masks, shapes) triggered by keyword. ~40% token savings on simple requests.
- **Parallel read-only tools** — contiguous reads in one round execute via `Promise.all` (saves multiple round-trips).
- **API retry with backoff** — 429/5xx → 3 attempts with exponential backoff.
- **Streaming API** — SSE with incremental tool_call argument parsing.
- **Conversation pruning** — old messages trimmed to fit token budget.
- **Tool call history preservation** — full assistant+tool chain preserved across turns.
- **Host script single-load** — ExtendScript loaded once at startup.
- **Tool latency stats in Report** — per-tool count, errors, avg/min/max ms in the LLM-analyzed bug report.
- **Persistent capture frames** — written to `~/AE-agent-captures/<date>/` (not `/tmp`), auto-pruned to newest 50.

- **Non-streaming tool turns** — vLLM 0.22.0 drops ALL tool_calls in streaming mode for GLM-5.1; agent loop uses non-streaming requests for tool turns (guarded in `chatProvider.js`).
- **`max_tokens: 65536`** — covers reasoning + tool_call chains + answer in one turn.

### API Provider
- **Cloud.ru Foundation Models** — OpenAI-compatible chat/completions with tool calling and SSE streaming. Models (panel selector): `openai/gpt-oss-120b` (default), `MiniMaxAI/MiniMax-M2.5`, `zai-org/GLM-4.7`. For reasoning models, chain-of-thought arrives in a separate `reasoning` field.

---

## Known Limitations

1. **No render/export** — `renderQueue.render()` blocks the CEP UI until completion. No async render API exists. Can add to render queue without starting, but live monitoring is not possible.

2. **No motion path control** — cannot set spatial bezier handles on position keyframes (only temporal easing is supported). `setSpatialTangentsAtKey()` exists but is fragile.

3. **Single comp context** — agent always works with the active composition. No explicit comp switching.

4. **No graph editor control** — easing is set via speed/influence values, not visual curve editing.

5. **Freeform mask paths** — simple shapes (rect, ellipse) work via computed vertices. Arbitrary freeform paths are fragile without a proper `Shape()` constructor.

6. **Model limitations** — Cloud.ru models may occasionally confuse anchor point with position, or use wrong property paths. The system prompt and knowledge base mitigate this but don't eliminate it.

7. **Layer Styles** — `addProperty("dropShadow")` on layer styles works inconsistently across layer types and AE versions. Use effects (Drop Shadow effect) instead.

8. **Gradient Stroke/Fill on shapes** — These are shape content modifiers, not effects. Cannot be added via `add_effect`. Not yet supported as dedicated tools.

9. **Solid layer color** — Cannot be changed after creation. Use `add_effect("ADBE Fill")` as a workaround.

10. **3D Z Position** — Separate Z Position property only exists with separated dimensions. Use Position `[x, y, z]` array instead.

11. **Date() in expressions** — Not available in AE expression engine. Use `time`, `timeToCurrentFormat()` or frame-based counters.

12. **Text layer font/size via create_layer** — Unreliable. Use `set_text_document` as a separate call.

---

## Improvement Roadmap

### Completed

**Pre-MVP phases (April 2026)** — initial agent build:
- **Phase 0** — Technical debt cleanup (legacy modules removed)
- **Phase 1-7** — Tool coverage (shapes, 3D, masks, markers, import, frame preview)
- **Phase 8** — SSE streaming + incremental tool_call parsing
- **Phase 9** — UX (quick actions, textarea auto-resize, streaming text preview)
- **Phase 10** — Static expression validation
- **Phase 11** — Bug fixes (temporal ease dimensions, silent catches, create_masks_from_text, no-comp warning)

**MVP cut (2026-04-30, commit `6da17c7`)** — chat-only architecture + 10 architectural improvements: modular system prompt, parallel read-only tools, idempotency via `client_op_id`, type hints in `_KNOWN_PATHS`, expanded `validateExpression`, validation warnings → tool result, capability handshake, persistent capture frames, tool latency stats, KB cleanup. See `.omc/plans/improvements-2026-04-30.md` for the detailed plan with verification criteria.

**Iteration 2 (2026-05-02)** — Fix A/B/C: text+font in `create_layer`, anti-spam guard, dynamic shape/reorder hints + prompt updates.

**Iteration 3 (2026-05-12)** — Fix H/I: bumped `max_tokens` 4096→16384 (output truncation), strip harmony-format leak from `function.name`.

**Iteration 4 (2026-05-12)** — Fix J/K/L/M: anti-preview-fabrication rule, shape-tools require `layer_id`/`layer_index`, no-CoT rule, `max_tokens` 16384→32768. Iter 2-4 committed as `39f8804`.

**Model migration (2026-06-04, commits `7026a5c`/`659061e`/`33244de`)** — Cloud.ru reasoning models (`zai-org/GLM-5.1`), separate `reasoning` field + live reasoning UI, `max_tokens` 65536, non-streaming tool turns (vLLM streaming bug guard), batch keyframes.

**Stage 3 (2026-06-10, commit `3c22313`)** — editing-assistant prompt reframe, `search_expression_library` (28 snippets), `link_properties`, `list_available_effects`, context trimming.

**Live AE validation (2026-06-10, commit `60f2b79`)** — 7 host bugs found & fixed by driving the real panel via CDP (`scripts/cdp-eval.js`): string+Array concat in readback, control-char escaping in `resultToJson`, `add_effect` rename, `_resolveProperty` alias shadowing, `addProperty()` ref invalidation in shape tools, `reorder_layer` rewrite (no `moveTo` on Layer), `precompose_layers` layer_ids support. Details: `docs/superpowers/specs/2026-06-10-deep-audit-report.md`.

### Future Improvements (only on user request)

**Spatial keyframe control** — Spatial bezier handles (roving keyframes, motion path curves). API is fragile.

**Persistent animation library** — Save and recall animation patterns: "Save this as 'bounce reveal'" / "Apply 'bounce reveal'".

**Before/after comparison** — Capture before + after, show side-by-side. Currently disallowed by Fix J (anti-fabrication).

**Batch mode** — "Apply this animation to all text layers" — detect matching layers and batch-apply.

**Conversation summarization** — Summarize old messages instead of dropping them in `pruneConversation`.

**Structured error codes** — Replace freeform `message` with `{ code, message, recovery }` across all 42 try/catch sites.

**Single source of truth for tools** — Generate registry + bridge cases + host stubs from one `tools.json`.

**TypeScript / strict JSDoc** — Catch typos in `els.xxx` and tool field references.

**Plan-then-execute UI mode** — Outline plan as plain text before executing — opt-in for complex requests.

**Editable quick actions / saved prompts library** — Pure UX.

**Trim Paths / Merge Paths / Repeater** — Shape modifiers via `addProperty()`.

See **[../AGENTS.md](../AGENTS.md)** for iteration history and where to leave notes for the next agent working on these.

---

## Architecture Notes

### File Structure (agent modules)
```
agentSystemPrompt.js  — Agent persona, workflow rules, expression guidance, tool documentation, known limitations
agentToolLoop.js      — LLM <> tool execution cycle with abort, streaming, expression validation
chatProvider.js       — Cloud.ru API with retry, SSE streaming
hostBridge.js         — Tool name -> ExtendScript mapping (single-load host script) + pre-call required-args validation
toolRegistry.js       — 50 OpenAI-compatible tool definitions
host/index.jsx        — ExtendScript functions (AE operations, shapes, 3D, masks, markers, import)
main.js               — UI, sessions, markdown, pruning, cancel, batch-undo, KB injection, quick actions
```

### Key Architecture
- **Host script loaded once** — `hostBridge.js` uses `ensureHostScriptLoaded()` instead of inlining 2000+ lines per call
- **Shared `_resolveProperty`** — single property resolution function used by all expression/property tools
- **Expression error feedback loop** — `apply_expression` checks `expressionError` after apply, rolls back on failure
- **Static expression validation** — `validateExpression()` catches common mistakes before they reach AE
- **Knowledge base injection** — keyword matching on user message triggers relevant doc snippets in system prompt
- **SSE streaming** — `invokeCloudRuStreaming()` parses SSE chunks, accumulates tool_call arguments incrementally
- **Conversation pruning** — `pruneConversation()` trims old messages to fit token budget
- **Tool call history** — full assistant+tool message chain preserved across turns in a session

### Adding a New Tool
1. Add ExtendScript function in `host/index.jsx` (follow existing pattern: try/catch, undo group, `resultToJson`)
2. Add tool definition in `toolRegistry.js` (OpenAI function schema)
3. Add mapping in `hostBridge.js` (`executeToolCall` switch case)
4. Update system prompt if the tool needs special guidance
5. If read-only, add to `READ_ONLY_TOOLS` in `agentToolLoop.js`
