# AE Motion Agent — Capabilities & Improvement Roadmap

## Current Capabilities

### Agent Tool System
The extension works as an AI agent that can inspect, create, and modify After Effects compositions through tool calls. The LLM plans a sequence of actions, executes them one by one via ExtendScript, and reports results.

**Supported tools (47):**

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

#### Shape content
| Tool | Description |
|------|-------------|
| `add_shape_rectangle` | Rectangle with size, position, roundness, fill, stroke |
| `add_shape_ellipse` | Ellipse with size, position, fill, stroke |
| `add_shape_path` | Custom bezier path with vertices, tangents, fill, stroke |

#### Animation
| Tool | Description |
|------|-------------|
| `add_keyframes` | Add keyframes with values, interpolation type, and easing |
| `delete_keyframes` | Delete keyframes at specific times or all |
| `set_keyframe_easing` | Change interpolation and easing on existing keyframes |
| `set_property_value` | Set a static value on any property |
| `apply_expression` | Apply an AE expression to any expressable property. Returns expression errors for agent self-correction. |
| `apply_expression_batch` | Apply expressions to multiple layer properties in one tool call with per-target success/error details. |

#### Effects
| Tool | Description |
|------|-------------|
| `add_effect` | Add effect by matchName or display name |
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
| `create_masks_from_text` | Convert text layer outlines into masks (letter shapes). Only works on text layers. |

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
- Model selector in chat header
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

### Reliability
- **Expression error detection** — `apply_expression` checks `expressionError` after applying and returns the error to the agent for self-correction
- **Static expression validation** — panel-side checks before sending to AE: `text.sourceText.value` warning, `\n` vs `\r`, unbalanced brackets/parens
- **Knowledge base injection** — keyword-matched AE expression documentation injected into system prompt for accuracy
- **API retry with backoff** — automatic retry on 429/5xx errors (3 attempts, exponential backoff)
- **Streaming API** — SSE streaming with incremental tool_call argument accumulation
- **Conversation pruning** — old messages automatically trimmed to fit within token budget
- **Tool call history preservation** — agent remembers its prior tool calls and results across turns in a session
- **Host script single-load** — ExtendScript loaded once at startup, not re-parsed on every tool call

### API Provider
- **Cloud.ru Foundation Models** — OpenAI-compatible chat/completions with tool calling and SSE streaming

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

All phases from the initial roadmap have been implemented:

- **Phase 0** — Technical debt: dead code removed (former `legacy-archive/` and `prompt-library/` cleared from the chat-only build)
- **Phase 1** — Shape content creation: `add_shape_rectangle`, `add_shape_ellipse`, `add_shape_path`
- **Phase 2** — 3D/Camera/Light: `set_layer_3d`, `set_camera_properties`, `set_light_properties`
- **Phase 3** — Frame preview: `capture_comp_frame` + inline image rendering in chat
- **Phase 4** — Knowledge base injection: keyword-matched KB snippets injected into system prompt
- **Phase 5** — Masks: `add_mask`, `set_mask_properties`, `get_mask_info`
- **Phase 6** — Markers: `add_marker`, `get_markers`, `delete_marker`
- **Phase 7** — Import/Project items: `list_project_items`, `import_file`, `add_item_to_comp`
- **Phase 8** — Streaming API: SSE streaming in chatProvider.js with incremental tool_call parsing
- **Phase 9** — UX: quick action buttons, textarea auto-resize, session metadata, streaming text preview
- **Phase 10** — Agent intelligence: static expression validation before AE execution
- **Phase 11** — Bug fixes: temporal ease dimension detection, silent catch reporting in masks/keyframes, create_masks_from_text tool, no-comp warning, system prompt limitations guidance

### Future Improvements

**Spatial keyframe control**
Set spatial bezier handles (roving keyframes, motion path curves). API exists but is fragile — deferred until stable approach found.

**Persistent animation library**
Save and recall animation patterns across sessions: "Save this as 'bounce reveal'" / "Apply 'bounce reveal' to layer 3".

**Before/after comparison**
Capture a frame before and after agent changes, show side-by-side in chat.

**Batch mode**
"Apply this animation to all text layers" — detect matching layers and batch-apply.

**Context persistence across sessions**
Remember comp structure between sessions so the agent doesn't need to re-inspect every time.

**Compound tools (macros)**
Frequent patterns in one tool call: `create_animated_layer(type, name, animation, params)` — create + position + animate in one step.

**Session export/import**
Export sessions as JSON files, import them back.

**Trim Paths / Merge Paths / Repeater**
Shape modifiers via the same `addProperty()` API — natural extension of Phase 1.

---

## Architecture Notes

### File Structure (agent modules)
```
agentSystemPrompt.js  — Agent persona, workflow rules, expression guidance, 45 tool documentation, known limitations
agentToolLoop.js      — LLM <> tool execution cycle with abort, streaming, expression validation
chatProvider.js       — Cloud.ru API with retry, SSE streaming
hostBridge.js         — Tool name -> ExtendScript mapping (single-load host script) + pre-call required-args validation
toolRegistry.js       — 45 OpenAI-compatible tool definitions
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
5. If read-only, add to `READ_ONLY_TOOLS` array in `main.js`
