# Configuration

The panel uses a single config object exposed as `window.EXTENSIONS_LLM_CHAT_CONFIG`, loaded via a script tag before `main.js`.

## Source

- **Default**: `config/example.config.js` (tracked) — full defaults; `apiKey` stays empty.
- **Optional overrides**: `config/runtime-config.js` (gitignored) merges onto the default; copy from `runtime-config.example.js`. Do not put the API key here.
- **Secrets**: `config/secrets.local.js` (gitignored) sets `window.EXTENSIONS_LLM_CHAT_SECRETS.apiKey`. Copy from `secrets.local.example.js`. See **docs/secret-handling.md**.

## Fields

| Field | Type | Description |
|-------|------|-------------|
| apiKey | string | Bearer token for the cloud chat/completions API. Required for Send. Prefer **`secrets.local.js`** (`EXTENSIONS_LLM_CHAT_SECRETS.apiKey`); `EXTENSIONS_LLM_CHAT_CONFIG.apiKey` is a legacy fallback. |
| baseUrl | string | API base URL (e.g. `https://foundation-models.api.cloud.ru/v1`). |
| cloudChatTimeoutMs | number | Timeout for Cloud.ru `/chat/completions` requests in milliseconds (default `120000`). |
| defaultModel | string | Model used for generator and validator passes. |
| fallbackModel | string | Model used for repair and for runtime fallback on transport failure. |
| ollamaBaseUrl | string | Local Ollama HTTP API root (no trailing slash). Default `http://127.0.0.1:11434`. Reserved for vision phases. |
| ollamaChatTimeoutMs | number | Timeout for Ollama `/api/chat` requests in milliseconds (default `120000`). |
| ollamaVisionModel | string | Primary vision model tag (default `llava-phi3:latest`). |
| ollamaVisionFallbackModel | string | Fallback vision model (default `moondream:latest`). |
| captureEnabled | boolean | When `false`, screen capture buttons are disabled. Default true. |
| previewCaptureInset | object | Fractional rectangle inside the frontmost After Effects window for **Capture comp area** (`leftFrac`, `topFrac`, `widthFrac`, `heightFrac`). |
| captureTimeoutMs | number | Subprocess timeout in milliseconds (default 15000). |
| ollamaVisionTimeoutMs | number | Timeout for Ollama `/api/chat` when sending images (default 90000). |
| ollamaVisionMaxEdgePx | number | On macOS, resize PNG so longest edge ≤ this value before Ollama (default **1024**). **0** = send full resolution. Lowers GPU OOM risk on **Analyze frame**. |

## Behavior

- If the config script fails to load or `EXTENSIONS_LLM_CHAT_CONFIG` is missing, the panel uses built-in defaults (empty apiKey, same URLs/models). Status will indicate that configuration is missing.
- If `apiKey` is empty, the panel does not send requests and shows a clear message directing the user to config (see **config/README.md**).
- Sessions, target selection, and UI remain usable when config is missing; only Send and model calls are blocked.
- **Screen capture** depends on CEP Node (`manifest.xml`) and macOS **Screen Recording** for After Effects, not on `apiKey`. If Node is unavailable, capture stays disabled with a tooltip. Preview capture may also need **Automation** for System Events. See [dev-artifacts/engineering-notes.md](dev-artifacts/engineering-notes.md).

## CEP deployment

For deployment, either ship with `example.config.js` and have users add their key via a local `runtime-config.js`, or use a secure mechanism (e.g. environment or secure storage) and build a small config loader that sets `EXTENSIONS_LLM_CHAT_CONFIG` from that source. Do not ship real keys in the repository.
