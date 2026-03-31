# How local vision (Ollama) reaches the cloud model

> **Current UI (AE Motion Agent):** **main.js** не подмешивает `lastFrameAnalysis` / `lastUiAnalysis` / `[AE_HOST_STATE]` в цикл агента при **Send**. Модули **lib/captureMacOS.js** и **lib/ollamaVision.js** по-прежнему подключаются в **index.html** для совместимости или будущей интеграции. Запланировано переподключение vision к агенту: **[capabilities-and-roadmap.md](capabilities-and-roadmap.md)** (*Vision-informed animation*), **[north-star-vision-agent.md](north-star-vision-agent.md)**.

This document describes the **intended grounding design** when the panel ran a **cloud multi-pass expression pipeline** and optional local Ollama vision analysis. Use it as a reference for how PNG capture and text summaries would feed the cloud model if that wiring is restored or ported to the agent.

---

## Historical: two LLM roles

1. **Local Ollama** (optional) — reads a **PNG** (UI screenshot or exported comp frame) and returns **plain text**.
2. **Cloud model** (Cloud.ru) — in the legacy flow, generated and validated **expressions** using the multi-pass pipeline.

## Was Ollama analysis used by the cloud LLM? (legacy wiring)

**In the legacy Send path**, after analysis the cloud model could receive extra **system** grounding blocks (implementation lived in older **main.js**: `buildExtraGroundingForSession`, `prependGroundingToRoleMessages`):

| Source | Session field | Injected block | When included |
|--------|---------------|----------------|---------------|
| ExtendScript | (per request) | `[AE_HOST_STATE]` | When host context was fetched successfully |
| Analyze frame (Ollama) | `lastFrameAnalysis` | `[FRAME_ANALYSIS]` | For that session until cleared / overwritten |
| Analyze UI (Ollama) | `lastUiAnalysis` | `[UI_ANALYSIS]` | If **Include UI capture in next Send** was checked |

Order in the generator payload was roughly: base system prompt → **host** → docs KB → **frame** → **UI** → target → user (see **north-star-vision-agent.md** Phase 5).

The cloud model does **not** see raw pixels; it only sees **summaries** from Ollama. Improving Ollama prompts improves **grounding quality** when this path is active.

## Grammar / language analysis

The UI/frame prompts ask for **accurate transcription when readable** and to **avoid guessing**. They do **not** run a dedicated “grammar checker” on arbitrary text. If you need spelling/grammar as a product feature, extend the Ollama prompt explicitly and accept that vision models may still hallucinate unreadable UI.

## Operational notes

- **HTTP 500 / “zero length image”** from Ollama usually means the PNG on disk was empty or not yet flushed after export. When the capture UI is wired, retries typically use helpers in `lib/ollamaVision.js` (legacy panels also used `waitForValidPngPath` in **main.js** — confirm in current code if you re-enable capture).
- **HTTP 500 / “model runner has unexpectedly stopped”** on large frames: PNGs are downscaled on macOS (`sips`, `ollamaVisionMaxEdgePx`) before `/api/chat`; lower that value if the runner still dies (VRAM).
- **Capture comp area** uses AppleScript (System Events) + fractional crop toward the Composition viewer; tune `previewCaptureInset` in config if the crop does not match your workspace.
