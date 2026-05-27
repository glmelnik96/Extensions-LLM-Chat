# Configuration

The panel reads two globals injected by config scripts in `index.html`:

- `window.EXTENSIONS_LLM_CHAT_CONFIG` — non-secret settings (URLs, models, timeouts)
- `window.EXTENSIONS_LLM_CHAT_SECRETS` — API key only

## Source files (load order)

`index.html` loads them in this order — later files override earlier ones via `Object.assign`:

1. **`config/example.config.js`** (tracked) — defaults. `apiKey` stays empty here.
2. **`config/runtime-config.js`** (gitignored) — optional overrides. Do not put the API key here. Copy from `runtime-config.example.js`.
3. **`config/secrets.local.js`** (gitignored) — sets `EXTENSIONS_LLM_CHAT_SECRETS.apiKey`. Copy from `secrets.local.example.js`. See **[secret-handling.md](secret-handling.md)**.

## Fields (current chat-only build)

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `apiKey` | string | `''` | Bearer token for Cloud.ru chat/completions. Required for Send. Prefer setting via `EXTENSIONS_LLM_CHAT_SECRETS.apiKey` in `secrets.local.js`; `EXTENSIONS_LLM_CHAT_CONFIG.apiKey` is a legacy fallback. |
| `baseUrl` | string | `https://foundation-models.api.cloud.ru/v1` | API base URL. |
| `cloudChatTimeoutMs` | number | `120000` | Timeout for chat/completions requests (ms). |
| `defaultModel` | string | `openai/gpt-oss-120b` | Default LLM. Prefix `cloudru/` is auto-applied for routing. |
| `fallbackModel` | string | `Qwen/Qwen3-Coder-Next` | Used by `invokeWithFallback` if primary model fails. |
| `agentMaxSteps` | number | `150` | Maximum number of LLM ↔ tool-call rounds per user message. |
| `agentTemperature` | number | `0.3` | Temperature for tool-use generation. |

> **Removed in chat-only cleanup (2026-04-30):** legacy fields `captureEnabled`, `captureTimeoutMs`, `previewCaptureInset` (related to deleted screen-capture node helpers), plus all `ollama*` fields. If you see these in old configs, they are silently ignored.

## Behavior

- If the config script fails to load entirely, the panel falls back to built-in defaults and shows a status message.
- If `apiKey` is empty, the Send button is blocked with a clear inline message.
- Sessions, model selector, and Quick Action buttons remain usable without a key — only model calls are blocked.
- The non-secret `EXTENSIONS_LLM_CHAT_CONFIG` is safe to view in DevTools console; the secrets object is also reachable but should never be logged or exported.

## CEP deployment

For production deployment:

- Ship `example.config.js` with no key.
- Have users add their key via local `secrets.local.js` (gitignored).
- Or build a small loader that sets `EXTENSIONS_LLM_CHAT_SECRETS` from environment / system keychain at panel startup.

Do not ship real keys in any tracked file. The `.gitignore` already excludes `secrets.local.js` and `runtime-config.js`.
