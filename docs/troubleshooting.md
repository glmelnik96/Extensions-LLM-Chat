# Troubleshooting

Common issues and known error patterns in AE Motion Agent.

---

## Panel doesn't appear in Window → Extensions menu

This is almost always **`PlayerDebugMode` set on the wrong `CSXS.N` key**. The key number is the CEP version, which is tied to the AE version — not a fixed `11`:

| After Effects | CEP | Key |
|---------------|-----|-----|
| 2024 / 2025 / 2026 (24.x–26.x) | 12 | `CSXS.12` |
| 2022 / 2023 (22.x–23.x) | 11 | `CSXS.11` |
| 2021 (18.x) | 10 | `CSXS.10` |

Confirm your CEP version from the open panel's DevTools console: `window.__adobe_cep__.getCurrentApiVersion()` → `{major: 12, ...}` means set `CSXS.12`. The simplest fix is to set 10/11/12 all at once (see README step 3), then **restart AE** (macOS: also `killall cfprefsd`). Verified live 2026-06-18: AE 26.2.1 reports CEP **12**, so `CSXS.12` is the relevant key on current AE.

- **`manifest.xml` host range**: `<Host Name="AEFT" Version="[18.0,99.9]">` covers AE 2021+, and `RequiredRuntime CSXS 11.0` is a *floor* (loads fine under CEP 12). The manifest is not the usual culprit — the `PlayerDebugMode` key is.

## Panel opens but is blank

- **Script load order**: All config + library + module scripts must load before `main.js` (see order in `index.html`). One failing script blanks the panel — open CEP DevTools (`http://localhost:8088` if `.debug` is present in the panel folder).
- **CSInterface.js missing**: Already bundled at `lib/CSInterface.js` — no download needed. If you deleted it, restore from the repo.

---

## Status bar says "Set API key in config/secrets.local.js"

```
cp config/secrets.local.example.js config/secrets.local.js
# Edit secrets.local.js, paste Cloud.ru Bearer token (no "Bearer " prefix)
```

See [secret-handling.md](secret-handling.md).

---

## Send is disabled

- **No API key** — status bar shows the config message.
- **No active composition** — system message in chat asks to open one.
- **Request in flight** — Send is disabled until current request finishes. Click Stop to cancel.

---

## "Error contacting cloud model"

- **Network / firewall**: check `baseUrl` reachable.
- **HTTP 4xx/5xx**: verify `baseUrl` and `apiKey`. See [configuration.md](configuration.md).
- **Automatic retry**: panel retries on 429/5xx with exponential backoff (3 attempts).
- **Status spinner stuck**: model may be timing out. Bump `cloudChatTimeoutMs` or stop and retry.

---

## Tool errors: known patterns and what they mean

These are surfaced in the Tool Call Card and in `~/Desktop/ae-agent-errors-*.json` when you press the Errors button.

### `RETRY_BLOCKED` — anti-spam guard fired

```
Tool reorder_layer called 4 times with the same arguments and the same error...
```

**Cause:** the same tool call with identical args failed 3 times in a row. The 4th attempt is blocked client-side to prevent spirals.

**Fix:** call `get_detailed_comp_summary` to refresh layer state, change `layer_id`, or ask the user. The agent should already do this — if not, the system prompt or model context is missing the guidance.

### `Layer "X" is type "solid", but add_shape_ellipse requires a shape layer`

**Cause:** trying to add shape content (ellipse / rectangle / path) to a non-shape layer.

**Fix:** the agent must call `create_layer(layer_type:"shape")` first, then pass the returned `layerId` to `add_shape_*`. The host already includes this hint in the error.

### `... cannot move this layer: it appears to be inside a precomp ...`

**Cause:** `reorder_layer` on a layer inside a nested composition. AE's `layer.moveTo()` requires the layer's parent to be an `INDEXED_GROUP` — precomps don't satisfy this.

**Fix:** open the parent comp first, or skip the reorder.

### `Unable to set value as it is not associated with a layer` (rare after iter 2)

**Cause:** AE quirk — setting `font` or `fontSize` on a standalone `TextDocument` before attaching it via `addText()`.

**Fix:** should not happen after iter 2 Fix A. If it appears, check `extensionsLlmChat_createLayer` for the text branch — must call `addText(doc)` first, then mutate via `sourceText.value` + `setValue(doc)`.

### `Transform>Position expects [x, y] for 2D or [x, y, z] for 3D layers`

**Cause:** wrong value shape for a known property path. Type hints catch this before AE rejects it.

**Fix:** the agent should retry with the correct array shape — the error message includes both formats.

### `Unknown tool: apply_expression<|channel|>commentary`

**Cause:** gpt-oss-120b harmony format leak into `function.name`.

**Fix:** should not happen after iter 3 Fix I — `executeToolCall` strips `<|...|>` suffixes. If it appears, check `hostBridge.js` for the normalizer at the top of `executeToolCall`.

### `add_shape_ellipse: missing required layer_id or layer_index`

**Cause:** model emitted empty `args:{}` for a shape-tool. Without Fix K, host fallback would silently insert into the selected layer.

**Fix:** the model should retry with `layer_id` from `create_layer(layer_type:"shape")`. Error message guides it.

### `rename_layer: missing required \`new_name\` string` / `... must be a non-empty string`

**Cause:** `rename_layer` was called without a `new_name` (or with an empty/whitespace-only one).

**Fix:** pass a non-empty `new_name`. **Why this is guarded:** before the fix, a missing `new_name` reached `layer.name = String(newName)` and silently renamed the layer to the literal `"null"`/`"undefined"` — silent corruption. The host now returns a clean error instead, consistent with every other tool. (Found via live multi-model testing 2026-06-19.)

### `set_layer_timing: in_point (X) must be less than out_point (Y)`

**Cause:** both `in_point` and `out_point` were supplied in one call with `in_point >= out_point`.

**Fix:** pass an `in_point` strictly less than `out_point`. **Why this is guarded:** before the fix, AE silently accepted the inverted range and left the layer with a negative duration — a degenerate, hard-to-notice state. Single-field calls (only `in_point` or only `out_point`) are unaffected. (Found via live multi-model testing 2026-06-19.)

### `capture_comp_frame` result has no `fileSize` field

**Cause:** **not an error.** The PNG is flushed on AE's main thread only *after* the host call returns, so `outFile.length` reads back as `-1`/`0` at capture time even though the file writes correctly (~200ms later). The host now omits `fileSize` rather than reporting a misleading `-1`.

**Fix:** trust `ok:true` and the returned `path`; the file will exist shortly. Do not retry on a missing `fileSize`. (Found via live multi-model testing 2026-06-19.)

### `fontWarning: Font "Inter-Bold" not found; AE substituted "MyriadPro-Regular"`

**Cause:** requested PostScript font name doesn't exist on the user's system.

**Fix:** **not an error** — operation succeeds with the substituted font. The agent may notify the user. Make sure the font name is the PostScript name (e.g. `Inter-Regular`, not `Inter Regular`).

### `validationWarnings` present in tool result

```json
{ "ok": true, "validationWarnings": ["WARN: `if (cond) v1 else v2` is invalid as a JS expression..."] }
```

**Cause:** static `validateExpression` caught a likely-bad pattern in `apply_expression` / `apply_expression_batch` args. The call still went through (AE may be lenient), but the warning indicates a bug.

**Fix:** the agent should rewrite the expression per the warning text and retry.

---

## Undo doesn't revert everything

- **Batch undo** sends `N × Cmd+Z` where N = number of mutating tool calls in the last request.
- If AE's undo history is shorter than N (long sessions, low Edit > Preferences > General > Levels of Undo), only the last K actions are undone.
- **Read-only tools** (`get_*`, `list_*`, `capture_*`) are not counted as mutating.

---

## Captures: where are they?

Persistent capture frames (iter 1 #12) are written to `~/AE-agent-captures/<YYYY-MM-DD>/frame-<timestamp>.png`. Auto-pruned to the newest 50 across all date folders.

If the chat shows broken image icons (Markdown `![preview](file:///...)` with no PNG behind it), the model fabricated the link without calling `capture_comp_frame`. This should not happen after iter 4 Fix J. If it does — check `CORE_PREVIEW` in `agentSystemPrompt.js` for the anti-fabrication rule.

---

## Streaming not appearing

- SSE streaming is enabled by default in `chatProvider.invokeCloudRuStreaming`.
- If text doesn't appear incrementally, the `onTextChunk` callback may not be wired — check `main.js handleSend` → `runAgentLoop({ onTextChunk })`.
- DevTools console should show no fetch errors during streaming.

---

## Export / Report fails

- Both use Node `require('fs')` — needs `--enable-nodejs` + `--mixed-context` in CEP manifest.
- **Report** sends session logs to the Cloud.ru model for analysis — requires a working API key.
- Both write to `~/Desktop/`. Ensure Desktop exists and is writable.

---

## Session lost after panel reload

- Sessions live in `localStorage` under key `ae-motion-agent-state`.
- Clearing CEP cache or changing the panel's extension ID resets the storage.
- Use **Export** button to back up sessions before any clear.

---

## Host script "outdated" warning

```
[host] Host script outdated — missing _getTemporalEaseDims, resultToJson
```

**Cause:** capability handshake (iter 1 #10) at panel startup probed the host script and found missing helpers. Usually means a partial refactor left helpers behind.

**Fix:** check `host/index.jsx` for the function. The probe list lives in `extensionsLlmChat_getCapabilities` (last function in the file). If a helper was intentionally removed, also remove its name from the probe list.

---

## Debug logging

In CEP DevTools console:

```js
// Full session state:
console.log(JSON.stringify(JSON.parse(localStorage.getItem('ae-motion-agent-state')), null, 2))

// Composed system prompt for a given message:
window.AGENT_SYSTEM_PROMPT_BUILDER.build('your prompt here').prompt

// Manually clear idempotency cache:
window.HOST_BRIDGE.clearIdempotencyCache()

// Manually reset anti-spam streaks:
window.HOST_BRIDGE.resetSpamGuard()
```
