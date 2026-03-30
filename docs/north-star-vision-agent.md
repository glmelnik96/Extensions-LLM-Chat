# North Star: motion assistant with local vision

This document is the **durable product and technical brief** for evolving **Extensions LLM Chat** into a motion-design–aware assistant. It records decisions from planning so **new chat sessions or contributors** can implement work without relying on conversation history.

**Current implemented behavior** remains described in [final-architecture.md](final-architecture.md), [pipeline-runtime-flow.md](pipeline-runtime-flow.md), and the root [README.md](../README.md). This file describes **target direction** and **planned phases**.

---

## Vision

- **Copilot (today):** multi-pass pipeline, grounded expressions, manual Apply, Cloud.ru chat/completions.
- **Target:** same quality bar for expressions, plus **accurate task understanding** via:
  - **Structured host state** from ExtendScript (authoritative).
  - **Frame analysis** (comp still at playhead → local vision → text summary for the cloud model).
  - **UI analysis** (automated screenshots of AE chrome/regions → local vision → text summary).
- **Explicitly out of scope for vision:** generative frame/video creation; cloud-hosted vision (unless added later). **Pixels stay on the machine** when using local Ollama.

---

## Hard constraints

| Topic | Decision |
|--------|-----------|
| **Host OS / CPU** | **Apple Silicon only** (arm64). No Intel macOS binary requirement. |
| **After Effects** | **2025–2026** only for **testing and supported behavior**; expression/host features may assume modern AE (align with existing AE 26+ / JavaScript expression engine stance in prompts). |
| **LLM (cloud)** | **Cloud.ru Foundation Models**, OpenAI-compatible `chat/completions` — see [configuration.md](configuration.md). |
| **Vision (local)** | **Ollama**; default primary **`llava-phi3:latest`**, fallback **`moondream:latest`** (tune in config). |
| **UI capture** | **CEP + Node.js**: enable Node in the panel via **`CSXS/manifest.xml`** (`CEFCommandLine`), then use **`require('child_process')`** (and optionally **`fs`**) from panel code to run **`screencapture`** and/or small helpers. **No file-picker-first workflow** for UI capture; automation is the default path. |
| **Privacy / persistence** | Do **not** persist raw screenshots or base64 images in **localStorage**. Keep **`lastFrameAnalysis` / `lastUiAnalysis`** as **short text** if persisted at all; prefer in-memory with optional session discard on reload. |
| **Apply safety** | Preserve **manual Apply** and disposition rules unless explicitly redesigned; vision improves **grounding**, not silent writes. |

---

## Capture architecture (locked decision)

**The panel runs automated capture as follows:**

1. **`CSXS/manifest.xml`** — add CEF parameters required for **Node integration** in CEP (per Adobe CEP-Resources guidance for your CEP runtime), e.g. enabling Node and mixed context where applicable.
2. **Panel JavaScript** — use Node APIs only behind guards (`typeof require !== 'undefined'`) so behavior degrades clearly if Node is misconfigured.
3. **`child_process.execFile` / `spawn`** — invoke macOS **`screencapture`** with **window id** or **`-R x,y,w,h`** to write PNGs to a **temp path** (CEP temp or OS temp), then read bytes for Ollama.
4. **Permissions** — user must grant **Screen Recording** to **After Effects** (and any separate helper process if introduced later) in **System Settings → Privacy & Security**.

Optional later: a **bundled arm64 binary** under `bin/macos/arm64/` if `screencapture` is insufficient; still spawned from Node in the panel.

---

## Implementation phases (file-level touchpoints)

Use this as a **checklist**; order matters within each phase.

### Phase 0 — Baseline & config

- [x] `scripts/validate-repo.js` — includes `lib/captureMacOS.js` in required files.
- [x] `scripts/check-required-files.js` — unchanged (optional to extend later).
- [x] `config/example.config.js` — `ollamaBaseUrl`, vision model names, `captureEnabled`, `previewCaptureInset`, `captureTimeoutMs`, `ollamaVisionMaxEdgePx`, etc.
- [x] `config/runtime-config.js` (user, gitignored) — upgrade path documented in **config/README.md** (“Upgrading”) + **`runtime-config.example.js`** commented keys.
- [x] `config/README.md` — documents new keys, CEP Node note, and upgrading.
- [x] `main.js` — `getConfig()` defaults for all new keys.
- [x] `docs/runtime-state-schema.md` — ephemeral capture state + future session text fields.
- [x] `docs/configuration.md`, root `README.md` — capture / config notes.

### Phase 1 — Node + automated UI capture

- [x] `CSXS/manifest.xml` — `--enable-nodejs`, `--mixed-context`.
- [x] `lib/captureMacOS.js` — `child_process` + `/usr/sbin/screencapture`: **full screen** and **AE preview approx** (window bounds + `previewCaptureInset`).
- [x] `main.js` — **Capture full screen** / **Capture comp area**, `session.lastUiCapturePath` (persisted), `updateCaptureUiEnabled`, checkbox `includeUiCaptureInNextSend` (flag only until prepare injects analysis).
- [x] `index.html` (script order), `styles.css` — vision bar + checkbox.

### Phase 2 — Rich host state (no vision)

- [x] `host/index.jsx` — `extensionsLlmChat_getHostContext()` (time, work area, selected layers/properties).
- [x] `main.js` — `fetchHostContextPromise()` + **`[AE_HOST_STATE]`** in generator/validator/repair via `buildExtraGroundingForSession` / `prependGroundingToRoleMessages`.
- [x] `prompt-library/shared/project-context.md` — host vs vision priority note.

### Phase 3 — Comp frame → Ollama

- [x] `host/index.jsx` — `extensionsLlmChat_saveCompFramePng(path)` using `comp.saveFrameToPng(comp.time, file)` when available.
- [x] `lib/ollamaVision.js` — `POST` `/api/chat` with `images` + prompts.
- [x] `main.js` — **Analyze frame (Ollama)**; `session.lastFrameAnalysis`; **`[FRAME_ANALYSIS]`** in cloud payload when set.
- [x] `docs/troubleshooting.md` — Ollama / frame notes.
- [x] `lib/captureMacOS.js` — `getTempPngPath`, purge includes `ext-llm-chat-frame-*`.

### Phase 4 — UI capture → Ollama

- [x] `lib/captureMacOS.js` — rectangle + comp-area flow; **`screencapture -l` window-id** explicitly deferred (see file header comment).
- [x] `main.js` — **Analyze UI (Ollama)**; `session.lastUiAnalysis`; **`[UI_ANALYSIS]`** when “Include UI capture in next Send” is checked.
- [x] `diagnostics.js` — **`logPhaseTiming`** for capture + Ollama vision when `setDebug(true)` (no image bytes).

### Phase 5 — Grounding assembly & docs

- [x] `main.js` — order in generator: system → **host** → docs KB → **frame** → **UI** → target → user (via `buildPipelineGeneratorPayload` + `extraGrounding`).
- [x] `docs/pipeline-runtime-flow.md` — mermaid diagram + grounding note.
- [x] `docs/secret-handling.md` — Cloud API / Bearer summary section.

### Phase 6 — QA & polish

- [x] `docs/qa-test-plan.md` — section 9: Ollama, capture, frame export, grounding, debug timing.
- [x] `README.md` — Ollama / analysis / host state summary.

### Phase 7 — Agent mode (later)

- [ ] `main.js` — tool loop; `host/index.jsx` — allow-listed mutating tools with undo groups.
- [x] `prompt-library/agent/README.md` — reserved namespace and conventions for future agent prompts (not wired into pipeline yet).
- [ ] **Multi-target expression sets:** today the pipeline optimizes for **one** expression on **one** selected property (generate → validate → repair). Real tasks often need **several** expressions applied to **different** layers/properties (or a small plan: which property gets which snippet). The agent should be able to **emit and validate structured batches** (e.g. list of `{ layer, property, expression }` or equivalent), not only a single validated expression string.
- [x] `docs/final-architecture.md` — **Copilot vs Agent** table and scope (implementation of agent loop still pending).

---

## Is this document enough to start?

**Yes**, for engineering: combined with the **existing codebase** and **active docs** linked above, a new session can start **Phase 0 → Phase 1** without prior chat context.

**You still need at runtime:** AE 2025/2026 on Apple Silicon, Ollama with the vision models set in config (e.g. `ollama pull llava-phi3:latest` and `ollama pull moondream:latest`), Cloud.ru credentials in `secrets.local.js`, and **Screen Recording** permission for automated capture.

**Natural first implementation step after this doc:** edit **`CSXS/manifest.xml`** for Node, add **`lib/captureMacOS.js`**, extend **`config/example.config.js`**, and prove a **test PNG** from `screencapture` before wiring Ollama.

---

## Related documentation

| Doc | Relevance |
|-----|-----------|
| [final-architecture.md](final-architecture.md) | Current stack and pipeline |
| [host-bridge-notes.md](host-bridge-notes.md) | Panel ↔ host bridge |
| [configuration.md](configuration.md) | Config loading |
| [secret-handling.md](secret-handling.md) | Keys and privacy |
| [runtime-state-schema.md](runtime-state-schema.md) | Session shape |
| [vision-grounding.md](vision-grounding.md) | How Ollama text is injected into cloud requests |
