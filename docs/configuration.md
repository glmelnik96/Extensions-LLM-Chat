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
| `cloudChatTimeoutMs` | number | `300000` | Timeout for chat/completions requests (ms). Raised for reasoning-model latency before first token. |
| `defaultModel` | string | `MiniMaxAI/MiniMax-M2.5` | Default LLM for code paths outside the panel selector (chat-provider fallback, eval corpus). The panel itself defaults to the first `ALL_MODELS` entry in `main.js` that is not in `unavailableModels` — keep the two equal (a test checks it). The selection is stored per-session as `session.model`. Was `openai/gpt-oss-120b` until the project lost access to it (2026-10-18). |
| `unavailableModels` | string[] | `["openai/gpt-oss-120b", "moonshotai/Kimi-K2.6", "MiniMaxAI/MiniMax-M3", "openai/whisper-large-v3"]` | Models the Cloud.ru project behind the key cannot call (HTTP 403 "Requested model is not available for this project", verified 2026-10-18 — GET /models lists them anyway). Listed chat models are hidden from the selector (sessions saved with one migrate to the default), a listed vision model turns the visual check off, a listed Whisper model disables Transcribe + build and makes `transcribe_comp_audio` fail fast with `MODEL_UNAVAILABLE` before rendering audio. Logic: `lib/pure/modelAccess.js`. Delete an id once access is restored. |
| `agentMaxSteps` | number | `60` | Maximum number of LLM ↔ tool-call rounds per user message. |
| `agentTemperature` | number | `0.3` | Temperature for tool-use generation. |
| `maxConversationTokens` | number | `120000` | Conversation-history pruning budget (well within each model's context window). |
| `agentStreaming` | boolean | `false` | Streaming in the agent loop. Off by default: Cloud.ru vLLM 0.22 drops `delta.tool_calls` in streaming mode (verified 2026-06-10). |
| `agentThinkingFirstTurn` | boolean | `false` | Allow a reasoning turn at the start of each run (applies to the plan turn when `agentPlanTurn` is on). Off: measured 12x faster with equal quality. |
| `agentPlanTurn` | boolean | `true` | Plan-first turn (2026-09-02): one tool-less model call per request writes targets / hard constraints / expected result / steps before the comp is touched; the plan is shown to the user and kept in the loop history. |
| `agentToolGating` | boolean | `true` | Tool gating (2026-09-02): the model sees CORE tool schemas (28) plus keyword-matched groups (shapes, masks, effects, expressions, 3D, markers, project, compositing, subtitles, capture); a gated group loads on demand when the model calls one of its tools (the call still executes). Eval corpus: same pass-rate as ungated, −21% prompt tokens per call, −24% wall-clock. Set `false` to offer all 69 schemas on every call; A/B with `scripts/eval-corpus.js --gating off`. |
| `agentVerifyTurn` | boolean | `true` | Verify turn (2026-09-02): before a final answer after a mutating run, the loop hands the model the actual before/after scene diff and demands measurement (`probe_motion`) and fixes. Once per run. |

> **Removed in chat-only cleanup (2026-04-30):** legacy fields `captureEnabled`, `captureTimeoutMs`, `previewCaptureInset` (related to deleted screen-capture node helpers), plus all `ollama*` fields. If you see these in old configs, they are silently ignored.
> **Removed 2026-07-04:** `fallbackModel` + `CHAT_PROVIDER.invokeWithFallback` — dead code, never wired into the agent loop.

## Behavior

- If the config script fails to load entirely, the panel falls back to built-in defaults and shows a status message.
- If `apiKey` is empty, the Send button is blocked with a clear inline message.
- Sessions and Quick Action buttons remain usable without a key — only model calls are blocked.
- The non-secret `EXTENSIONS_LLM_CHAT_CONFIG` is safe to view in DevTools console; the secrets object is also reachable but should never be logged or exported.

## CEP deployment

For production deployment:

- Ship `example.config.js` with no key.
- Have users add their key via local `secrets.local.js` (gitignored).
- Or build a small loader that sets `EXTENSIONS_LLM_CHAT_SECRETS` from environment / system keychain at panel startup.

Do not ship real keys in any tracked file. The `.gitignore` already excludes `secrets.local.js` and `runtime-config.js`.
