# AE Motion Agent — Capabilities & Improvement Roadmap

## Current Capabilities

### Agent Tool System
The extension works as an AI agent that can inspect, create, and modify After Effects compositions through tool calls. The LLM plans a sequence of actions, executes them one by one via ExtendScript, and reports results.

**Supported tools (70):**

#### Meta
| Tool | Description |
|------|-------------|
| `batch_call` | Run up to 60 other tool calls (`{tool, args}` items) in one turn, in order. Returns per-item ok/message plus `succeeded`/`failed`/`undoUnits`. The way to apply anything across many layers without paying one LLM round-trip per layer. Cannot nest. |

#### Read (inspection)
| Tool | Description |
|------|-------------|
| `get_detailed_comp_summary` | Scene snapshot: per layer type, id, in/out, parent, `enabled`/`locked`/`solo`/`shy`, current `transform` values at comp time, `compPosition` for parented layers, `animated` keyframe ranges per property, expressions (path/snippet/error), effects, `text`, `numMasks`; root `compId`, `time`, `bgColor`. Supports `compact` mode and filters (`layer_type`, `name_contains`, `max_layers`) for large compositions. |
| `get_host_context` | Timeline state: current time, work area, selections |
| `get_property_value` | Read any property value (optionally at a specific time), plus expression info |
| `get_expression` | Read the current expression on a property: text, enabled state, error message, canSetExpression |
| `get_keyframes` | Read all keyframes with times, values, easing |
| `apply_motion_recipe` | Seven deterministic motion patterns in one call, keys from each layer's in-point, easy-ease, undo as one group: `pop_in` (centres the anchor without moving the layer, Scale 0→current with overshoot), `slide_in` (enters from fully outside the frame on a chosen side — parent space handled — and lands on the current position), `fade` (in / out at the out-point / both), `pulse` (scale-breathing expression), `orbit` (parents the layer to a new rotating null at the reference layer: exact radius, one turn per `period`), `follow` (Position expression follows a leader with `delay` lag, keeping the offset), `shake` (wiggle on Position + Rotation; with no targets builds a whole-comp "Camera Shake" null rig every 2D layer is parented to). |
| `probe_motion` | Sample a property over time with keyframes AND expressions applied (explicit `times` or N samples over the visible window); `space:"comp"` = Position in comp space with the parent chain applied; per-sample `visible`; summary `{changes, maxDelta, first, last, numKeys, hasExpression, expressionError}`. The scripted equivalent of scrubbing the timeline — used to verify motion before reporting. |
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
| `set_track_matte` | Set/remove alpha or luma track mattes. Any layer as matte on AE 23+ (`setTrackMatte` API), layer-above fallback on older AE |
| `set_layer_switches` | Toggle visibility, motion blur, adjustment, shy, solo, locked, guide, collapse transformation, effects active, audio — in one call |
| `set_time_remap` | Enable/disable time remapping; then animate the "Time Remap" property for freeze frames and speed ramps |
| `split_layer` | Split a layer at a time into two parts (deterministic duplicate + trim, like Edit > Split Layer) |

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
| `shift_keyframes` | Shift all keyframes of a property in time (preserving ease/interpolation); `align_to:"layer_in_point"` snaps the first key to the layer's in-point |
| `randomize_property` | Randomize a property across layers within a range (absolute or offset), optional per-axis |
| `set_property_value` | Set a static value on any property |
| `apply_expression` | Apply an AE expression to any expressable property. Returns expression errors for agent self-correction + evaluated value readback. Passing `expression: ""` **removes** the expression (the only way — `set_property_value` leaves it in place). |
| `apply_expression_batch` | Apply expressions to multiple layer properties in one tool call with per-target success/error details. Empty strings remove, same as the single-target tool. |
| `search_expression_library` | Search 54 curated expression snippets (`lib/pure/expressionLibrary.js`) + the user's saved snippets (marked `source:"user"`) — panel-local, no LLM round-trip |
| `save_user_expression` | Save an expression to the user's personal library (localStorage) — agent-driven, "сохрани это выражение" |
| `list_user_expressions` | List the user's saved snippets (ids for deletion) |
| `delete_user_expression` | Delete a saved snippet by id (explicit user request only) |
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
| `set_comp_settings` | Change comp name, dimensions, duration, frame rate, background color, comp-level motion blur switch |
| `open_comp` | Open a comp in the viewer by id/name and make it the active comp for all tools — enables editing inside precomps |

#### Text
| Tool | Description |
|------|-------------|
| `set_text_document` | Set text content, font, size, color, justification, tracking, leading |

#### Subtitles
| Tool | Description |
|------|-------------|
| `transcribe_comp_audio` | Render comp audio to AIFF via the render queue and transcribe it with Cloud.ru Whisper (`openai/whisper-large-v3`). `language` (ISO 639-1) is required. Segments are cached panel-side. Optional `start_time`/`end_time` for chunking (24MB upload limit). |
| `create_subtitles` | Build an animated subtitle layer from cached (or supplied) segments: Source Text hold keyframes per cue, `animation` = `word_reveal` (default) / `karaoke` (CapCut-style plate under the spoken word) / `none`, optional auto-sizing background box, auto-fit font size, styling options (font, color, position, box, `highlight_color`, `highlight_text_color`). |

#### Preview
| Tool | Description |
|------|-------------|
| `capture_comp_frame` | Save a frame as PNG (playhead time or `at_time:"auto"` — a content-visible time) and return the file path for inline display |

### UI

- **Multi-chat** (2026-07-27) — multiple named sessions with a header switcher (`#session-select` + new/rename/delete); default `Chat N` titles auto-replaced by the first user message; per-chat model/token/cost counters; legacy single-session storage migrates transparently (`lib/pure/sessionStore.js`)
- Chat interface with tool-call visualization (collapsible cards showing args + results)
- **Markdown rendering** in agent responses (headers, bold, italic, code blocks, lists, inline images)
- **Frame preview** — `capture_comp_frame` results shown as inline images in chat
- **No-composition warning** — system message when no active comp is detected before sending
- **Model selector** in chat header — `Cloud.ru` badge + 3 buttons (gpt-oss-120b / MiniMax-M2.5 / GLM-4.7); selection persists per-session, switching blocked mid-request
- **Model availability indicator** (2026-08-04) — one token-free `GET /v1/models` probe at startup (and on badge click) marks unreachable models struck-through/dimmed; badge shows `Cloud.ru N/M` and buttons get context-length tooltips
- **Subtitles studio** (2026-08-04) — an overlay opened from the task bar holding every subtitle control (language, style, font family + style picked from the fonts AE actually has installed, size, text/plate/spoken-word colors as hex + swatch) and the actions **Transcribe + build**, **Rebuild** (re-build from the cached transcript, no Whisper cost), **Save transcript** / **Load transcript** JSON on Desktop; settings persist across reloads
- **Live reasoning indicator** — model's `reasoning` stream shown as "Agent reasoning" status (never enters the chat)
- **Quick action buttons** (editable, 2026-07-27) — 16 demand-ranked defaults (`lib/pure/quickActions.js`); left-click sends, right-click edits/deletes, `+` adds custom, `⟲` resets; user list persists in localStorage
- **Input draft autosave** (2026-07-27) — half-typed prompts survive panel reloads
- **Mid-run crash recovery** (2026-07-27) — completed tool calls of an interrupted run are restored into the transcript with a warning note
- **Copy/retry message buttons** (2026-07-27) — hover actions: copy on any text message, retry on user messages
- **Streaming text preview** — agent response text appears in real-time during generation
- **Textarea auto-resize** — input grows up to ~8 lines as you type
- **Footer**: Undo, Clear, Export, Errors, Report
- **Clear button** (2026-07-28) — left-click clears the CURRENT chat only; right-click deletes ALL chats and starts one fresh; both blocked mid-request
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
- **Tool-call salvage** — when a model writes tool-call JSON into `content` instead of `tool_calls` (a turn that otherwise does nothing), `lib/pure/toolCallSalvage.js` recovers it by name or by argument shape and the loop retries it as a real call (max 10 per run). Ambiguous payloads are left alone: calling the wrong mutating tool is worse than showing raw JSON.
- **Batching over N layers** — `batch_call` collapses "do this to every layer" into one turn. Without it the model had to spend one round-trip per layer and would quietly stop early while reporting full coverage (measured: 3 of 22 layers done, 22 reported).
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

3. ~~**Single comp context**~~ — resolved 2026-07-27: `open_comp` switches the active comp by id/name.

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

**Compositing tools (2026-07-27)** — `set_track_matte`, `set_layer_switches`, `set_time_remap`, `split_layer`, `open_comp` (55 → 60 tools); `set_comp_settings` gained `bg_color` (fixed dead `typeof … instanceof Array` branch) + `motion_blur`; markdown renderer code-span mangling fixed (stash/restore placeholders). All five live-verified in real AE via CDP (24-step chain incl. negative cases).

**Panel UX pack (2026-07-27)** — input draft autosave, mid-run crash recovery (partial tool log snapshotted per step, folded back on boot), copy/retry message buttons, editable quick actions (`lib/pure/quickActions.js`, 8 tests). All live-verified via CDP.

**User expression library (2026-07-27)** — personal snippets saved via chat: `save_user_expression` / `list_user_expressions` / `delete_user_expression` (60 → 63 tools, all panel-local over localStorage, `lib/pure/userExpressionLibrary.js`, 8 tests); library search merges them in, marked `source:"user"`. Live-verified via CDP incl. a real agent run picking the save tool unprompted.

**Animated subtitles (2026-07-28)** — `transcribe_comp_audio` + `create_subtitles` (63 → 65 tools): render-queue AIFF extraction → Cloud.ru Whisper (`verbose_json`, `language` required — endpoint 400s without it) → `lib/pure/subtitles.js` (char-weighted word alignment, glue-word-aware wrapping, cue splitting) → one text layer with Source Text hold keyframes, word-reveal text animator (matchNames `ADBE Text Range Type2`/`ADBE Text Expressible Amount` live-verified) and optional auto-sizing background box. Segments cached panel-side (`_lastTranscription`) so the model never re-emits them. Live-verified end-to-end on a real BRAW comp (RU speech, 18 cues). Panel task bar has a one-click **Subtitles button** (language select, no LLM round-trip, live stage/elapsed status).

**Silence-aware subtitle timing (2026-07-29)** — raw Whisper segment starts fired text before the voice (speech onset 1.2s vs segment start 0). Ported the Premiere-plugin fix: ffmpeg `silencedetect` on the rendered AIFF (concurrent with the Whisper upload, optional — degrades gracefully without ffmpeg), silences cached and subtracted during word alignment. Plus two refinements: merge silences split by a sub-word voiced blip (< 0.35s, breaths/clicks) and drop a leading voiced sliver (< 0.4s) before a pause — Whisper opens segments on the previous phrase's tail. Live-verified: all cue starts snap exactly to speech onset (0→1.204, 5.0→5.807, 8.0→9.267), text clears during pauses. 13 subtitle tests.

**Run visibility + in-panel confirmations (2026-08-05)** — two panel fixes, both live-verified over CDP in a running AE.

*"Is it frozen?"* The thinking indicator only ever showed the CURRENT state, because `_setThinkingLabel` overwrote a single line — so during a long run all history was gone and a slow step was indistinguishable from a hang. Every label change is a genuine state transition, so they now also append to a timestamped **activity log** shown in a click-to-expand `▸ activity (N)` box (reuses the `.reasoning-box` styling; the CoT box moved to a `.cot-box` selector so the two lookups can't collide). Consecutive duplicates are collapsed — the reasoning label is re-set on every streamed chunk and would otherwise add one identical line per token. Alongside it a `.thinking-stall` hint appears once nothing has happened for 12s (`· no reply from model for 19s`, `--warn` colored), because a non-streaming turn emits nothing at all while in flight and the total-elapsed timer keeps ticking even if the run died. Deliberately does NOT enable thinking: `enable_thinking:false` and non-streaming are untouched, so the 12x speed win (94s vs 18.8min) stands. Live-verified: log filled correctly through a real tool-calling run (`run started → waiting for model (step 1/60) → calling get_detailed_comp_summary... → ok → step 2/60`), and the stall hint first rendered at exactly 12009ms on a long single-turn completion.

*Clear "hung".* `window.confirm()` in CEP opens a real modal — but as a **detached OS window** ("JavaScript Confirm - file:///...") floating over the AE comp viewer, which blocks the panel's JS thread until answered. Measured over CDP: holding that dialog 1500ms froze the panel's JS for 1508ms; if the window lands behind the AE frame the panel is frozen with no visible cause. Replaced with `panelConfirm()`, an in-panel overlay (Esc/backdrop = cancel, Enter = confirm) at the clear-chat, clear-all-chats, delete-chat and reset-quick-actions call sites. Still native and still blocking: the `prompt()`-driven flows (chat rename, quick-action add/edit, transcript path) and every `alert()`.

**Karaoke subtitles + transcript reuse + model availability (2026-08-04)** — no new tools (still 65). `create_subtitles` gained `animation:"karaoke"`: AE's `sourceRectAtTime` only measures the WHOLE text block, so the per-word rect is reconstructed from two **hidden measure text layers** (`Measure Prefix` = words up to and including the current one, `Measure Word` = the current word); the plate shape layer sizes/positions itself from their rects, and a `Word Index` slider with HOLD keys (`PURE_SUBTITLES.buildKaraokeTracks`, 3 tests) drives both the plate and a fill-color animator with an expressible selector (`textIndex == thisLayer.effect("Word Index")(1) ? 100 : 0`). Karaoke forces `max_lines: 1` and defaults `box` off. Panel: style select (Reveal/Karaoke/Plain), **Rebuild** (re-runs only `create_subtitles` from the cached transcript), **Save/Load transcript** JSON, and a model availability indicator fed by `CHAT_PROVIDER.listModels()`. Live-verified in real AE: 50 cues, 115 slider keys, zero expression errors, correct word highlighted in a rendered frame, single-undo removes all 5 layers; `Cloud.ru 4/4` from a 97-model catalog. Follow-up the same day: subtitle controls moved into a **studio overlay** (font / size / text color / plate color / spoken-word color, persisted), plate corners squared, and two host fixes — background box padding now reads the post-auto-fit font size, and a rig built over an existing one is renamed `Subtitles 2` so its plate expressions can't bind to the older rig's measure layers.

**Subtitle font pickers, typography rules and a steady plate (2026-08-04)** — still 65 tools. The font field became two dropdowns (family → style) fed by a new host reader over `app.fonts.allFonts` (an array of *families*, each an array of FontObjects — AE 24.0+; 148 families here), cached panel-side; the style option's value is the **PostScript name**, the only font identifier AE accepts without substituting, and the default is **SB Sans Text / Regular** with a `Helvetica Neue → Helvetica → Arial → Segoe UI` fallback chain for machines without the corporate font. macOS parity pass over the panel's selects: without `-webkit-appearance: none` a `<select>` is drawn by the OS as a native popup button that ignores `background-color` and enforces its own height, so on a Mac the dark panel would show native light chrome and taller rows; `option` colors are set explicitly for the OS-drawn dropdown. `lib/pure/subtitles.js` gained subtitle typography rules R1–R8: a cue never ends on `. , ; : —`, never starts with punctuation, and never ends on a hanging preposition/conjunction/particle, a number split from its unit, or an opening quote — with a bounded (max 2-word) back-off so long cues aren't starved; lines stay balanced and, on a tie, the top line is the shorter one ("pyramid"); cue text and karaoke word timings are filtered together so they stay index-locked. Finally the karaoke plate no longer drifts: instead of centring on each cue's ink rect (a cue without ascenders sat higher, so the plate jumped), one constant reference string is measured once for the font's ascender→descender band, the text is pinned by **baseline**, and the plate's height and y are constants — only its width follows the spoken word. Live-verified at 4096×2160: identical plate box (`y=1798..1957`) in every cue, SB Sans Text 120px and Arial Black 64px both render correctly, word-reveal + auto-fit unaffected. 196 tests pass.

**Multi-chat (2026-07-27)** — multiple named sessions: `state.sessions[]` + `activeSessionId`, header switcher with new/rename/delete, first-message auto-titles, transparent migration of the legacy single-session storage (`lib/pure/sessionStore.js`, 10 tests). Live-verified via CDP: migration, lifecycle, message+model isolation across reload, real agent run in the correct chat.

**Partial-run fixes (2026-08-10, commit `5407e51`)** — 65 → 66 tools. Three measured causes of the agent doing part of a job and reporting all of it. (1) `batch_call`: batch forms existed only for keyframes and expressions, so "apply to all N layers" cost N round-trips and the model compromised — live measurement showed 3 of 22 `BG Box` layers actually retimed against an answer listing all 22. The new tool runs up to 60 `{tool, args}` items per turn, reports per-item results, rejects nesting, tells the model to re-send **only** the failed items, and returns its own `undoUnits` (each host call is its own AE undo group) which `countUndoUnits()` in main.js now honours, including on a partly-failed batch. Prompt rule 5 routes 3+ layers into one batch; new rule 10 forbids overstating coverage. (2) Expression removal was **unimplemented** — `apply_expression(expression:"")` was rejected by the host as a missing field, so "убери экспрешен" failed three times live and the model fell back to `set_property_value`, which leaves the expression in place; empty string now clears and disables in both the single and batch host paths, and both tool descriptions say so explicitly. (3) Tool-call salvage (see Reliability). Also fixed: a `countUndoUnits` refactor had dropped `var allCalls` while two call sites still used it, killing **every** run at the final step with `Error: allCalls is not defined` — found only by putting a real agent turn through CDP. Live-verified: 6-layer retime in 5 calls with an honest report, 6/6 expressions removed on the first try, `batch_call` correctly reporting `Layer not found.` and refusing nesting. 211 tests pass.

**Motion recipes (2026-09-02)** — 69 → 70 tools. `apply_motion_recipe` bakes the request classes the hunts and the corpus kept seeing assembled by hand from 5–15 primitive calls — and failing on the same details: anchor not centred before a scale-in, keys before the in-point, comp-space values on a parented layer, a "slide from the left" that never left the frame, orbits whose radius drifts, a camera added to a 2D comp. Seven recipes (pop_in, slide_in, fade, pulse, orbit, follow, shake) do the anchor / in-point / parent-space / off-screen / radius math in ExtendScript and report what they did in comp terms. Live-verified in AE 2026 with `probe_motion`: pop-in 0→110→100 from the in-point, slide-in of a parented child starting at comp x=−100 and landing exactly on its original comp position, fade in+out at 2–2.5 s and 5.5–6 s, pulse 100→110→100→90, orbit radius exactly 300 px at every sample, follower trailing the leader by 0.5 s with the offset kept, shake rig parenting every 2D layer. Four recipe eval cases added (25 total). Corpus findings fixed on the way: models write `child_layer_id` for `set_layer_parent` (now accepted; a self-parent is explained in words instead of AE's "cannot be itself"), and "тряска камеры" in a 2D comp produced an inert camera three runs in a row, prompt rules notwithstanding — `create_layer(camera)` is now refused in a comp with no 3D layers (`CAMERA_IN_2D_COMP`) and points ONLY at recipe `shake` — the first refusal text mentioned "switch layers to 3D" as an alternative and the model did exactly that; guard messages must name one path. The full corpus run also caught the plan-turn side effect — the execution turn sometimes restated the plan with zero tool calls and the loop accepted it; `doneGuard` now detects a plan-shaped reply after zero calls and nudges once ("EXECUTE it"). A third corpus lesson: models put hold on the INCOMING side of a key and get a ramp — `_opacityRampNote` now reports the half-transparent midpoints after keyframe writes, and the keyframe schemas say which segment each interpolation side shapes. The scene diff now also states when a property "holds X BEFORE its first key" (visible before its window), and the loop strips a stray `[[final]]` marker from final answers. Full corpus after wave 3: 23/25 before these two fixes. 283 tests pass.

**Eval corpus, tool gating, prompt diet (2026-09-02)** — still 69 tools. The closed-loop harness got a NUMBER: `scripts/eval-corpus.js` runs 21 human-style Russian requests (`scripts/eval-cases.js`) against the real loop in a running AE, with a fresh fixture per case, comp-space probes and semantic checks on the resulting state, and writes a fingerprinted report (model, prompt+registry hash, git rev, flags) with `--compare` for regressions. It immediately paid for itself: a 3×-faster-orbit request ended at 6× because the child’s Position expression re-applied the parent’s rotation (guard extended to rotation/scale/anchor); `probe_motion` samples aliased a fast orbit and sent the model into a 31-call repair of a healthy rig (now reports a one-frame `speed` and warns about sparse samples); "visible from 1 to 2 s" was built as "static 0 + keys at 1 s" — AE holds the FIRST key’s value before it, so the card showed from t=0 (new `_firstKeyNote` on keyframe tools + trim/hold guidance in tool descriptions); a locked layer was unlocked, moved and re-locked inside a `batch_call` with no mention (the verify turn now lists unlocked layers). Tool gating (`lib/pure/toolGating.js`, default on): 28 CORE schemas plus keyword-matched groups, gated groups loaded on demand when called — same pass-rate as ungated, −21% prompt tokens per call, −24% wall-clock. Prompt diet: 14 code-covered bullets compressed (37.3k → 35.0k chars), name-order rule rewritten as "follow the ORDER the request gives". Corpus: 19/21 → 21/21 after two corpus defects were fixed. 276 tests pass.

**Closed-loop agent (2026-09-02)** — 67 → 69 tools. Analysis after six hunt rounds: the failures on simple human requests share three structural causes — the agent never observed what it did (one still frame was the only feedback), its world model had no values / keyframe ranges / switches (the prompt said "check `enabled` in the summary" while no read tool exposed it), and it planned nothing before mutating. Four model-independent harness changes (plan: `superpowers/specs/2026-09-02-agent-reliability-plan.md`). (1) **Scene snapshot** — `get_detailed_comp_summary` now returns per layer `enabled`/`locked`/`solo`/`shy`, `transform` values at comp time, `compPosition` for parented layers (parent chain applied), `animated` keyframe ranges `{numKeys, from, to}` per property, `text`, `numMasks`; a panel-only `fingerprint:true` adds value hashes for diffing. (2) **`probe_motion`** — samples a property over time with expressions applied (`space:"comp"` for parented layers and orbits), per-sample visibility and a `{changes, maxDelta, first, last}` summary: the scripted equivalent of scrubbing the timeline, so motion claims are measured instead of assumed. (3) **Scene diff** (`lib/pure/sceneDiff.js`, 8 tests) — snapshots before/after every run produce an "Actual changes" transcript note (layers added/removed, switches, parent, in/out, values, keyframe ranges, expressions + errors, effects, text, masks): ground truth independent of the model's report. (4) **Plan + verify turns** in the loop (`agentPlanTurn` / `agentVerifyTurn`, default on, off in the correction loop) — a tool-less first turn writes targets / hard constraints / expected observable result / steps (shown to the user, kept in history; `[[final]]` short-circuits pure questions); before a final answer after a mutating run, one `[SYSTEM] VERIFY` message carries the actual scene diff and demands measurement + fixes, flagging "NO changes were detected" when tools ran but nothing changed. Prompt rules 1 and 9 rewritten around snapshot values and measurement. The diff marks layers whose video switch is off (`[video switch OFF — not visible]`) and the verify turn demands that such a change is either made visible or reported as hidden — a live run had silently scaled a hidden layer before this. Live-verified via CDP in AE 2026 (scratch comp: orbit rig, hidden + locked solid, keyed text; two real gpt-oss-120b runs through the panel). 269 tests pass.

**Broad bug-hunt fixes (2026-08-16, round 4)** — still 67 tools. A fourth hunt with human-style Russian prompts (mass duplication under explicit constraints, slider rigs, delay chains, "scatter across the frame") produced 7 findings, 6 fixed the same day. (1) Worst: parent space applies to VALUES, not just expressions — "разбросай 30 копий по всему кадру" on children of a center null got comp-space random Positions (0..4096) interpreted in parent space, throwing half the copies off-screen (x up to 5980 in a 4096-wide comp); the host now appends a parent-space NOTE (parent name, its comp position, exact `[x-px, y-py]` conversion) to every value-class Position mutation on a parented layer (`set_property_value`, `add_keyframes`, `set_keyframes_batch`, `randomize_property` absolute mode), and the prompt teaches ±width/2-around-0 ranges. (2) Explicit constraints ignored ("оригиналы не трогай" → original modified; "маленьких копий" → full-size): prompt rule — explicit constraints are HARD limits, verify each named constraint before replying. (3) Rig built on layers with the video switch off (`enabled:false`) and reported as visible: host `_hiddenLayerWarning` on every mutation of a disabled layer + prompt bullet. (4) Invisible-by-design output (20px white circles on white 4K background; a 0–100 slider whose useful travel was 0–7) AND a correct "not visible" vision verdict dismissed after checking only data-state: prompt bullets (contrast/size, `linear(slider, 0, 100, min, max)` normalization) + `buildCorrectionPrompt` now states data presence does NOT refute a visibility report — check contrast, size, on-screen position and the video switch before declaring a false positive. (5) Rig keyed to `thisLayer.index` (breaks on reorder) and (6) 30 duplicates all named "Card 4": prompt bullets — derive variation from NAME/slider/baked constants; rename right after `duplicate_layer`. (7, accepted) vision misses compositional gaps (empty half-frame) — beyond the verdict schema, noted only. No round-3 regressions found in the same hunt. 227 tests pass.

**Broad bug-hunt fixes (2026-08-16, round 3)** — still 67 tools. A third hunt on heavier scenarios (6×6 grid via big batches, slider rig + cross-layer wiggle, staged reveal from one Progress slider, undo check) produced 5 findings, all fixed the same day. (1) Parent-space expression corruption (reproduced twice): on a parented layer the model wrote `thisComp.layer("Parent").transform.position + wiggle(...)` — comp-space coords in parent space fly the layer away and double parent motion; the host now REJECTS parent-position-clone expressions on Position of parented layers (`_parentCloneExprError`, single + batch paths) and the prompt teaches `value + wiggle(...)` as the base. (2) Scale failure modes from the grid run: giant batch JSON corrupted in transit and retried identically — the arg-parse error now measures the payload and demands splitting into batches of ≤ 8 (prompt cap added); hallucinated tool names get "this tool does not exist — use ONLY tools from your tool definitions"; hitting the 60-step cap now triggers one extra no-tools model call demanding an honest completed/NOT-completed/leftovers report instead of silently returning partial text; design-scale rule (comps are often 4K — center = [width/2, height/2], never hardcoded 1920×1080 values). (3) Explicit "Card 1 → 0–25, Card 2 → 25–50…" mappings were applied in timeline stacking order (reverse of naming order), inverting the user's list — prompt: map by NAMES, never by index order. (4) Locked layers were silently modified (AE scripting bypasses `layer.locked`) and even silently unlocked — host `_lockedRefusal` guard added to all direct mutating ops + never-silently-unlock prompt rule. (5) Already-satisfied requests were re-applied ("stagger by 3 frames" on already-staggered layers doubled it) — prompt: compare state first, report "already done". Undo and readbacks confirmed honest in the same hunt. 225 tests pass.

**Broad bug-hunt fixes (2026-08-16, round 2)** — still 67 tools. A second hunt (5 quick-action runs + 3 free scenarios with real LLM calls) produced 8 findings, all fixed the same day. (1) Worst: false "black frame" vision verdicts triggered correction rounds that really mutated the comp (reordered layers, moved the camera). Fix: `capture_comp_frame` gained `at_time:"auto"` — the host picks a content-visible capture time (scores comp.time + each layer's visibility midpoint by layers within in/out with opacity and scale alive) without moving the playhead, and the vision flow always uses it (live: playhead 0 → picked 5.35s); `classifyIssues` in `lib/pure/visionCheck.js` splits weak "empty/black frame" reports from actionable ones — all-weak verdicts now skip the correction entirely; the correction prompt demands verifying each issue against comp state first and forbids reordering/moving the camera for unconfirmed issues. (2) Target discipline: the agent applied a quick action to a layer remembered from history while another was selected, and picked its own targets on empty selection — CORE_SELECTED now requires `get_host_context` first in the current run and asking when selection is empty (live: Typewriter hit the selected «Текст ДВА»; empty-selection Loop asked instead of acting). (3) AE-semantics rules: cameras are inert in all-2D comps; animation must fall inside the layer's visibility window (in/out AND opacity/scale nonzero); Mask Expansion cannot do directional reveals — use `ADBE Linear Wipe` (the prompt's own example taught the wrong technique and was rewritten); "link layers" = `set_layer_parent`, not clone position expressions (live: all 4 cards parented to Master Control, expressions removed). (4) RU-first: all 16 quick-action prompts translated to Russian + conversation-language rule. 219 tests pass.

**Bug-hunt fixes (2026-08-16)** — 66 → 67 tools. A dedicated bug-hunt session (6 real agent runs + direct stresses on a scratch comp) confirmed five bugs. (1) "Начало слоя" was treated as comp t=0: keys landed at 0–1s while in-points were 0.7–1.3s, so the animation played entirely before the layers appeared — and the run reported success. Fixed with a prompt rule (layer start = in-point) and a new `shift_keyframes` tool that shifts all keys of a property preserving per-key ease/interpolation, with `align_to:"layer_in_point"`. (2) `set_property_value` on an expression-driven property was a silent visual no-op: the host now warns and sets `expressionOverride: true`, plus a prompt rule to check/remove the expression first. (3) False "⚠ No active composition" on send: the check read stale note text that loses the race with the Send click; now a live host probe warns only on an explicit "no comp". (4) `batch_call` × anti-spam guard: per-item `error_code` (e.g. `RETRY_BLOCKED`) is passed through and the summary no longer tells the model to re-send items the guard will block. (5) Visual check labeled as a **weak signal** (single still frame — cannot verify motion/timing; 6/6 false "OK"s measured) in the transcript message and the toggle tooltip, per user decision not to strengthen it. Live-verified end-to-end: agent aligned Fill keys of 4 layers to their in-points in one batch_call, and honestly reported the expression override before removing it in the correction round. 213 tests pass.

**Live AE validation (2026-06-10, commit `60f2b79`)** — 7 host bugs found & fixed by driving the real panel via CDP (`scripts/cdp-eval.js`): string+Array concat in readback, control-char escaping in `resultToJson`, `add_effect` rename, `_resolveProperty` alias shadowing, `addProperty()` ref invalidation in shape tools, `reorder_layer` rewrite (no `moveTo` on Layer), `precompose_layers` layer_ids support. Details: `docs/superpowers/specs/2026-06-10-deep-audit-report.md`.

### Future Improvements (only on user request)

**Spatial keyframe control** — Spatial bezier handles (roving keyframes, motion path curves). API is fragile.

**Persistent animation library** — Save and recall animation patterns: "Save this as 'bounce reveal'" / "Apply 'bounce reveal'". Seven built-in patterns exist since 2026-09-02 (`apply_motion_recipe`); user-defined ones are still open.

**Before/after comparison** — Visual side-by-side capture is still disallowed by Fix J (anti-fabrication). The STATE-level before/after exists since 2026-09-02: the scene diff note under every mutating run.

**Conversation summarization** — Summarize old messages instead of dropping them in `pruneConversation`.

**Structured error codes** — Replace freeform `message` with `{ code, message, recovery }` across all 42 try/catch sites.

**Single source of truth for tools** — Generate registry + bridge cases + host stubs from one `tools.json`.

**TypeScript / strict JSDoc** — Catch typos in `els.xxx` and tool field references.

**Plan-then-execute UI mode** — the plan itself exists since 2026-09-02 (tool-less plan turn, `agentPlanTurn`, shown in the run indicator and prepended to the answer); an approve/edit-before-execute UI is still open.

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
toolRegistry.js       — 70 OpenAI-compatible tool definitions
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
