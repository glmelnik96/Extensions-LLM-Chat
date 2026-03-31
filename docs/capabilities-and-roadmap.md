# AE Motion Agent — Capabilities & Improvement Roadmap

## Current Capabilities

### Agent Tool System
The extension works as an AI agent that can inspect, create, and modify After Effects compositions through tool calls. The LLM plans a sequence of actions, executes them one by one via ExtendScript, and reports results.

**Supported tools (25):**

#### Read (inspection)
| Tool | Description |
|------|-------------|
| `get_detailed_comp_summary` | Full comp overview: layers, types, parents, effects, timing, expressions |
| `get_host_context` | Timeline state: current time, work area, selections |
| `get_property_value` | Read any property value (optionally at a specific time), plus expression info |
| `get_keyframes` | Read all keyframes with times, values, easing |
| `get_layer_properties` | Deep scan of all properties on a layer |
| `get_effect_properties` | List properties of a specific effect |

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

#### Animation
| Tool | Description |
|------|-------------|
| `add_keyframes` | Add keyframes with values, interpolation type, and easing |
| `delete_keyframes` | Delete keyframes at specific times or all |
| `set_keyframe_easing` | Change interpolation and easing on existing keyframes |
| `set_property_value` | Set a static value on any property |
| `apply_expression` | Apply an AE expression to any expressable property |

#### Effects
| Tool | Description |
|------|-------------|
| `add_effect` | Add effect by matchName or display name |
| `remove_effect` | Remove an effect |
| `set_effect_property` | Set a value on an effect property |

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

### UI
- Chat interface with tool-call visualization (collapsible cards showing args + results)
- Session management (create, rename, clear, switch between sessions)
- Model selector: Cloud.ru models + local Ollama models (when enabled)
- Undo button (triggers AE undo)
- Thinking indicator during agent execution

### API Providers
- **Cloud.ru Foundation Models** — OpenAI-compatible chat/completions with tool calling
- **Ollama (local)** — for both vision analysis and full chat (when `ollamaChatEnabled: true`)

---

## Known Limitations

1. **Shape layer content creation** — `create_layer('shape')` creates an empty shape layer. The agent cannot yet programmatically add shape paths (rectangles, ellipses, stars) as content groups. Workaround: agent creates shape layer, user adds shapes manually, agent then animates them.

2. **No mask operations** — cannot create, modify, or animate masks.

3. **No render/export** — cannot add to render queue or export compositions.

4. **No footage import** — cannot import files, images, or video into the project.

5. **No motion path control** — cannot set spatial bezier handles on position keyframes (only temporal easing is supported).

6. **No 3D layer toggle** — cannot enable/disable 3D on a layer.

7. **No markers** — cannot add or read layer/comp markers.

8. **Single comp context** — agent always works with the active composition. No explicit comp switching.

9. **No graph editor control** — easing is set via speed/influence values, not visual curve editing.

10. **Model limitations** — Cloud.ru models (Qwen3-Coder, GPT-OSS-120B) may occasionally confuse anchor point with position, or use wrong property paths. The system prompt mitigates this but doesn't eliminate it.

---

## Improvement Roadmap

### Priority 1 — Fix & Stabilize

**1.1 Shape content creation**
Add ExtendScript functions to programmatically add shape content:
- `addRectangle(layerIndex, size, position, roundness)`
- `addEllipse(layerIndex, size, position)`
- `addPathFromVertices(layerIndex, vertices, inTangents, outTangents, closed)`
- `addFill(layerIndex, color, opacity)`
- `addStroke(layerIndex, color, width)`

This is the most impactful improvement — shape layers are fundamental to motion design.

**1.2 3D layer support**
- `setLayer3D(layerIndex, enabled)` — toggle 3D
- Add Z position/rotation to keyframe tools
- Support camera and light property paths

**1.3 Better error recovery**
When a tool call fails, the agent currently reports the error but doesn't always retry with a corrected approach. Improve the system prompt to:
- Re-read the comp state after failures
- Try alternative property paths
- Fall back to `get_layer_properties` to discover correct paths

### Priority 2 — Expand Capabilities

**2.1 Mask operations**
- `addMask(layerIndex, vertices, mode)`
- `getMaskProperties(layerIndex, maskIndex)`
- `setMaskPath(layerIndex, maskIndex, vertices)`
- Mask feather, expansion, opacity animation

**2.2 Footage and asset management**
- `importFile(path)` — import image/video/audio
- `addToComp(itemId, compIndex)` — add project item to comp
- `listProjectItems()` — list all project items

**2.3 Spatial keyframe control**
- Set spatial bezier handles (roving keyframes, motion path curves)
- `setSpatialTangentsAtKey(layerIndex, propPath, keyIndex, inTangent, outTangent)`

**2.4 Markers**
- `addLayerMarker(layerIndex, time, comment, duration)`
- `addCompMarker(time, comment, duration)`
- `getMarkers(layerIndex)` — read existing markers

**2.5 Render queue**
- `addToRenderQueue(outputModule, outputPath)`
- `renderComp()` — start render
- Useful for automated workflows

### Priority 3 — Agent Intelligence

**3.1 Vision-informed animation**
Currently Ollama vision (screen capture + comp frame analysis) exists but is disconnected from the agent loop. Reconnect it:
- Agent can request a comp frame capture and analyze it
- Use visual context to make better animation decisions
- "This frame looks dark, I'll add a bright element" type reasoning

**3.2 Reference-based animation**
- User provides a reference video/GIF frame
- Ollama vision describes the motion
- Agent recreates the motion pattern using keyframes/expressions

**3.3 Animation presets / templates**
Build a library of common animation patterns in the knowledge base:
- Fade in + scale up (standard reveal)
- Typewriter text animation
- Logo reveal with mask wipe
- Parallax scrolling layers
- Particle-like scatter/gather
- Elastic/spring overshoot

The system prompt can reference these so the model doesn't reinvent them each time.

**3.4 Multi-step undo awareness**
Currently each tool call is a separate undo group. For complex animations (10+ tool calls), this means 10+ undos. Improvement:
- Group related operations into a single undo group
- "Create bouncing ball" = 1 undo, not 5

**3.5 Comp frame preview after changes**
After making changes, automatically capture and show a frame preview in the chat, so the user can see results without switching to AE.

### Priority 4 — Workflow & UX

**4.1 Persistent animation library**
Save and recall animation patterns across sessions:
- "Save this animation as 'bounce reveal'"
- "Apply 'bounce reveal' to layer 3"
- Stored as templates with parameterized values

**4.2 Before/after comparison**
Capture a frame before agent changes and after, show side-by-side in chat.

**4.3 Batch mode**
"Apply this animation to all text layers" — detect matching layers and batch-apply.

**4.4 Expression library integration**
The existing knowledge base (`knowledge-base/corpus/`) has curated AE expression docs. Wire it into the agent flow so expression-related requests get relevant docs injected into context.

**4.5 Context persistence across sessions**
Remember comp structure between sessions — "last time we worked on the intro comp with 12 layers" — so the agent doesn't need to re-inspect every time.

---

## Architecture Notes

### File Structure (new modules)
```
agentSystemPrompt.js  — Agent persona and workflow rules
agentToolLoop.js      — LLM ↔ tool execution cycle
chatProvider.js       — Cloud.ru + Ollama unified API
hostBridge.js         — Tool name → ExtendScript mapping
toolRegistry.js       — 25 OpenAI-compatible tool definitions
host/index.jsx        — ExtendScript functions (AE operations)
main.js               — UI rendering, sessions, event handling
```

### Adding a New Tool
1. Add ExtendScript function in `host/index.jsx` (follow existing pattern: try/catch, undo group, `resultToJson`)
2. Add tool definition in `toolRegistry.js` (OpenAI function schema)
3. Add mapping in `hostBridge.js` (`executeToolCall` switch case)
4. Update system prompt if the tool needs special guidance
