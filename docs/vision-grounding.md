# How local vision (Ollama) reaches the cloud model

This panel runs **two** LLM roles:

1. **Local Ollama** (optional) — reads a **PNG** (UI screenshot or exported comp frame) and returns **plain text**.
2. **Cloud model** (Cloud.ru) — generates and validates **expressions** using the normal pipeline.

## Is Ollama analysis used by the cloud LLM?

**Yes, when you Send a message** after analysis, the cloud model receives that text as extra **system** grounding blocks (see `main.js`: `buildExtraGroundingForSession`, `prependGroundingToRoleMessages`):

| Source | Session field | Injected block | When included |
|--------|---------------|----------------|---------------|
| ExtendScript | (per request) | `[AE_HOST_STATE]` | When host context is fetched successfully |
| Analyze frame (Ollama) | `lastFrameAnalysis` | `[FRAME_ANALYSIS]` | Always for that session until cleared / overwritten |
| Analyze UI (Ollama) | `lastUiAnalysis` | `[UI_ANALYSIS]` | Only if **Include UI capture in next Send** is checked |

Order in the generator payload is roughly: base system prompt → **host** → docs KB → **frame** → **UI** → target → user (see `docs/north-star-vision-agent.md` Phase 5).

The cloud model does **not** see raw pixels; it only sees the **summaries** you produced with Ollama. Improving Ollama prompts (structure, uncertainty, readable text) therefore improves **grounding quality** for the cloud pass.

## Grammar / language analysis

The UI/frame prompts ask for **accurate transcription when readable** and to **avoid guessing**. They do **not** run a dedicated “grammar checker” on arbitrary text. If you need spelling/grammar as a product feature, extend the Ollama prompt explicitly and accept that vision models may still hallucinate unreadable UI.

## Operational notes

- **HTTP 500 / “zero length image”** from Ollama usually means the PNG on disk was empty or not yet flushed after export. The panel retries until a minimal PNG size and signature are valid (`waitForValidPngPath` in `main.js`, checks in `lib/ollamaVision.js`).
- **HTTP 500 / “model runner has unexpectedly stopped”** on large frames: PNGs are downscaled on macOS (`sips`, `ollamaVisionMaxEdgePx`) before `/api/chat`; lower that value if the runner still dies (VRAM).
- **Capture comp area** uses AppleScript (System Events) + fractional crop toward the Composition viewer; tune `previewCaptureInset` in config if the crop does not match your workspace.
