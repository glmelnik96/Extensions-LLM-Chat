# Architecture

Runtime architecture of the AE Motion Agent CEP extension.

---

## Stack

- **Panel**: HTML/CSS/JS CEP panel (`index.html`, `styles.css`, `main.js`)
- **Agent loop**: `agentToolLoop.js` — LLM ↔ tool execution cycle with abort and streaming support
- **System prompt**: `agentSystemPrompt.js` — agent persona, 47 tool documentation, workflow rules, known limitations
- **Tool registry**: `toolRegistry.js` — 47 OpenAI-compatible function definitions
- **Chat provider**: `chatProvider.js` — Cloud.ru (with SSE streaming) + Ollama API abstraction, retry on 429/5xx
- **Host bridge**: `hostBridge.js` — promise wrapper around `CSInterface.evalScript`, single-load host script caching
- **Host**: `host/index.jsx` — ExtendScript functions for all AE operations (shapes, 3D, masks, markers, import, etc.)
- **Cloud API**: Cloud.ru Foundation Models `chat/completions` with tool calling and SSE streaming
- **Vision modules**: `lib/captureMacOS.js`, `lib/ollamaVision.js` — loaded but not connected to agent loop

---

## Config loading

`index.html` load order:
1. `config/example.config.js` — defaults (tracked)
2. `config/runtime-config.js` — optional overrides (gitignored)
3. `config/secrets.local.js` — API key (gitignored)

Details: [configuration.md](configuration.md), [secret-handling.md](secret-handling.md).

---

## Agent tool loop

1. User sends a message → `main.js` builds conversation history + system prompt (with KB snippets injected by keyword matching) → calls `AGENT_TOOL_LOOP.runAgentLoop`
2. Loop calls `CHAT_PROVIDER.invoke()` with messages + tools. If `onTextChunk` callback is set and provider is Cloud.ru, SSE streaming is used.
3. If model returns `tool_calls` → each tool is executed sequentially via `hostBridge.executeToolCall()` → ExtendScript runs in AE → results sent back as `tool` messages → loop continues
4. Static expression validation (`validateExpression()`) runs on `apply_expression` / `apply_expression_batch` calls before sending to AE
5. When model returns plain content → done, result displayed in chat with tool call cards
6. Abort: user can cancel via Stop button at any point (`abortHandle.aborted = true`)

---

## Tool categories (47 tools)

| Category | Tools |
|----------|-------|
| Read/inspect | `get_detailed_comp_summary`, `get_host_context`, `get_property_value`, `get_expression`, `get_keyframes`, `get_layer_properties`, `get_effect_properties`, `get_mask_info`, `get_markers`, `list_project_items` |
| Layer ops | `create_layer`, `delete_layer`, `duplicate_layer`, `reorder_layer`, `set_layer_parent`, `set_layer_timing`, `rename_layer`, `set_layer_3d` |
| Shape content | `add_shape_rectangle`, `add_shape_ellipse`, `add_shape_path` |
| Animation | `add_keyframes`, `delete_keyframes`, `set_keyframe_easing`, `set_property_value`, `apply_expression`, `apply_expression_batch`, `apply_fade_preset`, `apply_pop_preset`, `apply_slide_preset` |
| Effects | `add_effect`, `remove_effect`, `set_effect_property` |
| 3D/Camera/Light | `set_camera_properties`, `set_light_properties` |
| Masks | `add_mask`, `set_mask_properties` |
| Markers | `add_marker`, `delete_marker` |
| Import | `import_file`, `add_item_to_comp` |
| Composition | `create_comp`, `precompose_layers`, `set_comp_settings` |
| Text | `set_text_document` |
| Preview | `capture_comp_frame` |

---

## UI features

- Chat with collapsible tool call cards (args + results)
- Markdown rendering (headers, bold, code blocks, lists, inline images)
- Session management (create, rename, clear, switch)
- Quick action buttons (Wiggle, Counter, Slide In, Bounce, Preview)
- Preset toolbar (Fade/Pop/Slide with duration, delay, strength)
- Streaming text preview during generation
- Batch-undo (N x Cmd+Z for all mutating tool calls)
- Stop (cancel running agent)
- Export sessions to JSON
- Report generation (LLM-analyzed session logs)
- Auto-resize textarea, session metadata, token usage display

---

## Persistence

- **localStorage** key: `ae-motion-agent-state`
- Stores: sessions array, activeSessionId, nextSessionIndex
- Each session: id, title, createdAt, updatedAt, model, messages[]
- Details: [runtime-state-schema.md](runtime-state-schema.md)

---

## Adding a new tool

1. Add ExtendScript function in `host/index.jsx` (try/catch, undo group, `resultToJson`)
2. Add tool definition in `toolRegistry.js` (OpenAI function schema)
3. Add case in `hostBridge.js` `executeToolCall` switch
4. Update `agentSystemPrompt.js` if the tool needs special guidance
5. If read-only, add to `READ_ONLY_TOOLS` array in `main.js`
