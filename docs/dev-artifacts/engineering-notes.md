# Engineering Notes & Development Artifacts

Consolidated technical notes from the development of AE Motion Agent. Reference material for developers maintaining or extending the codebase.

---

## Legacy Multi-Pass Pipeline (archived)

The project originally used a multi-pass expression pipeline (generator → validator → rules → repair → finalize) with a manual "Apply Expression" button. This was replaced by the current agent tool loop architecture. Key differences:

- **Old**: User described an expression → LLM generated it → validator checked → rules applied → repair if needed → user clicked Apply
- **Current**: User describes any task → LLM plans tool calls → tools execute directly in AE → results feed back to LLM

Legacy modules (`pipelineAssembly.js`, `systemPrompt.js`, `aeDocsIndex.js`, `aeDocsRetrieval.js`, `aePromptContext.js`, `aeResponseValidation.js`, `diagnostics.js`) are archived in `/legacy-archive/`.

---

## Knowledge Base Architecture

The extension includes a local knowledge base for AE expression documentation:

- **Corpus**: `knowledge-base/corpus/adobe/` (expression basics, wiggle, sourceText, property targeting) and `knowledge-base/corpus/docsforadobe/` (common patterns, repair recipes)
- **Current usage**: `main.js` has `KB_SNIPPETS` array with keyword-matched snippets injected into the system prompt when relevant keywords are detected in user messages (e.g. "expression", "sourceText", "wiggle")
- **Legacy usage**: Previously fed through `corpusIndex.js` → `pipelineAssembly.js` → per-stage grounding. That path is no longer active.

---

## Prompt Library (archived)

The `prompt-library/` directory contains role-specific prompts from the legacy pipeline:

- `shared/` — project context, output contracts, targeting rules
- `generator/`, `validator/`, `repair/` — system prompts and grounding templates
- `promptsBundle.js` — runtime bundle exposing `window.PIPELINE_PROMPTS`

These are **not used** by the current agent. The agent uses `agentSystemPrompt.js` for its system prompt and `toolRegistry.js` for tool definitions.

---

## Diagnostics Module (archived)

`diagnostics.js` (now in `legacy-archive/`) exposed `window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS` with:

- `createLogger(options)` — component-specific loggers
- `logInfo/logWarn/logError/logDebug` — prefixed console logging
- `sanitizeForLog(str, maxLen)` — safe string truncation
- `logPhaseTiming(phase, elapsedMs)` — timing for capture/vision
- `normalizeRuntimeError(err)` — error categorization
- Error categories: configuration, network_transport, http, malformed_response, host_apply, etc.

The current agent uses direct `console.error/warn` in catch blocks. If verbose debugging is needed, check the CEP DevTools console.

---

## Repository Validation Scripts

Two Node.js scripts exist in `scripts/`:

- `validate-repo.js` — checks required directories and core files exist
- `check-required-files.js` — verifies prompt-library, knowledge-base, config, and docs

**Note**: These scripts reference files from the legacy architecture (e.g. `diagnostics.js`, `pipelineAssembly.js`, `corpusIndex.js`). They need updating if used — some referenced files have been moved to `legacy-archive/`.

---

## ExtendScript API Notes

### Shape Content Creation
`addProperty()` works on `ADBE Root Vectors Group` for shape content:
```javascript
var contents = layer.property("ADBE Root Vectors Group");
var group = contents.addProperty("ADBE Vector Group");
var rect = group.property("ADBE Vectors Group").addProperty("ADBE Vector Shape - Rect");
var fill = group.property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Fill");
```

### 3D Layer Toggle
`layer.threeDLayer` is writable (boolean). Camera and light layers are inherently 3D.

### Mask Creation
`layer.property('ADBE Mask Parade').addProperty('ADBE Mask Atom')` creates a mask. Shape object for path vertices requires careful coordinate construction. Simple shapes (rect, ellipse) are computed from vertices; freeform paths are fragile.

### Markers
`new MarkerValue(comment)` + `marker.setValueAtTime(time, mv)`. Duration set via `mv.duration = seconds`.

### Import
`app.project.importFile(new ImportOptions(new File(path)))` for images/video/audio.

### Frame Capture
`comp.saveFrameToPng(time, filePath)` — saves current frame. CEP panel can display via `<img src="file:///path">`.

### Undo Limitation
AE auto-closes undo groups when `evalScript()` returns. Cannot span a single undo group across multiple tool calls. Solution: batch-undo via N × `app.executeCommand(16)`.

---

## Streaming SSE Implementation Notes

Cloud.ru supports `stream: true` (OpenAI-compatible SSE). Key implementation details in `chatProvider.js`:

- Uses `fetch()` + `ReadableStream` + `getReader()` (available in CEP 11.0 Chromium)
- Tool call arguments arrive incrementally: `{"ke` → `y": 123}`. Buffer by `call_id`, `JSON.parse` only when complete.
- Text chunks forwarded via `onTextChunk` callback for real-time display

---

## Vision Integration (not connected)

`lib/captureMacOS.js` and `lib/ollamaVision.js` exist for screen capture + Ollama vision analysis. They are loaded in `index.html` but **not connected** to the agent tool loop. Future work could add a tool that captures a frame and sends it to a vision model for analysis.

---

## Ollama Integration

Ollama chat path exists in `chatProvider.js` but is not exposed in the model selector UI. Config fields (`ollamaBaseUrl`, `ollamaChatTimeoutMs`, `ollamaVisionModel`, etc.) are documented in `configuration.md`. The Ollama path was used for the legacy vision pipeline.
