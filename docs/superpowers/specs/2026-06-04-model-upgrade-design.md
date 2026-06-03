# Model upgrade — GLM-5.1 / reasoning models (2026-06-04)

> Scope decided with user: switch the plugin to the new Cloud.ru reasoning models,
> models + context window **predetermined** (no panel selection), tuned with headroom.
> "Limits/costs don't matter, quality gain matters." No commit without explicit request.
> This doc is the running record of all edits.

## Context

Cloud.ru opened access (2026-06) to three new open-weight reasoning models on the same
OpenAI-compatible endpoint (`foundation-models.api.cloud.ru/v1`):

| Model | id | in/1M | out/1M | context | modality |
|---|---|---|---|---|---|
| GLM-5.1 (Z.ai)        | `zai-org/GLM-5.1`            | 198.86₽ | 829.6₽ | 202k  | text |
| Kimi-K2.6 (Moonshot)  | `moonshotai/Kimi-K2.6`      | 175.68₽ | 725.9₽ | 262k  | text+image |
| DeepSeek-V4-Pro       | `deepseek-ai/DeepSeek-V4-Pro` | 183₽  | 732₽   | 1048k | text |

All three: Function Calling + Structured Output.

## Live probe findings (2026-06-04, real endpoint via secrets.local.js)

1. **Reasoning is in a SEPARATE field `reasoning`** (non-stream `message.reasoning`,
   stream `delta.reasoning`) — NEVER merged into `content`. GLM-5.1 returned 1707 chars
   of `reasoning` + 581 chars of `content` for a math prompt.
   → Our current streaming parser reads only `delta.content`/`delta.tool_calls`, so it
     already ignores `reasoning`. **No CoT-leak risk.** Fix L (no-CoT prompt rule) is now
     moot but harmless.
2. **Tool calling is clean first-try** on all three: correct args, `finish_reason:tool_calls`,
   no harmony `<|channel|>` leak, no `args:{}`. gpt-oss-specific Fixes A/B/I/K become
   near-dead insurance (kept, cheap).
3. **`reasoning` counts as `completion_tokens`** → eats the `max_tokens` budget. Must raise
   output budget so reasoning + tool_calls JSON + answer all fit.
4. **`max_tokens` up to 131072 accepted** (HTTP 200) on all three. Big headroom.

## Decisions

- **Primary model:** `zai-org/GLM-5.1` — best schema-adherence / lowest hallucinated-tool-name,
  directly targets our tool-dispatch reliability. 202k context.
- **Fallback model (config only, unwired as before):** `deepseek-ai/DeepSeek-V4-Pro`.
- **No panel model selector** — removed from `index.html`; model is hardcoded via `DEFAULT_MODEL`
  + `config.defaultModel`.
- **Context budget:** `maxConversationTokens` 12000 → 120000 (well within 202k).
- **Output budget:** agent-loop `max_tokens` 32768 → 65536 (reasoning + chain).
- **Timeout:** `cloudChatTimeoutMs` 120000 → 300000 (reasoning latency before first token).
- **Reasoning UX:** streaming parser captures `delta.reasoning` separately and exposes an
  `onReasoningChunk` callback; panel shows a "thinking…" indicator during the reasoning phase.

## Files touched

- `config/example.config.js` — defaultModel/fallbackModel, cloudChatTimeoutMs, maxConversationTokens.
- `config/runtime-config.example.js` — commented examples updated to new ids.
- `main.js` — `DEFAULT_MODEL`, remove model-select wiring, maxConversationTokens fallback,
  onReasoningChunk → thinking indicator, model badge in status.
- `chatProvider.js` — streaming parser handles `delta.reasoning` + `onReasoningChunk`,
  exposes `reasoning` on the assembled message.
- `agentToolLoop.js` — `max_tokens` 32768 → 65536, plumb `onReasoningChunk`, comment update.
- `index.html` — remove `<select id="model-select">`, add static model badge.

## Not in scope

- Wiring automatic primary→fallback failover into the loop (unchanged from today).
- Sending capture frames to Kimi's vision input (future; pipeline doesn't pass images back).
- Removing gpt-oss insurance code (harmony strip, validators) — kept as cheap no-ops.
