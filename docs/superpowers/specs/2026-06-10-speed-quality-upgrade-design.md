# Speed & Quality Upgrade — agent round-trip reduction + live UX

Date: 2026-06-10
Status: implemented, validated (unit + live LLM), **not committed**

## Context

Audit (2026-06-10) of task quality/speed found the architecture still tuned for
gpt-oss/12k-token-era economics: tokens were scarce, so the prompt was lazily
modularized and tool results minimal. With GLM-5.1 (202k ctx, 120k budget) the
economics inverted — **tokens are cheap, round trips (LLM turns × evalScript
calls) are the cost**. Top-10 improvements implemented in this pass.

## Endpoint probe (verified live 2026-06-10)

- `chat_template_kwargs: { enable_thinking: false }` is the ONLY working switch
  to disable GLM-5.1 reasoning on Cloud.ru (reasoningLen 357→0, completion
  98→2 tokens). `thinking:{type:...}` and `reasoning_effort` are accepted but
  silently ignored.
- Decision: agent loop keeps reasoning ON (quality); Report path disables it
  (pure summarization, ~3-4x faster).

## Changes

### Tools layer
- **`set_keyframes_batch`** (new, 47th tool): keyframes to N properties/layers in
  ONE host call, one undo group, per-target results. Mirrors
  `apply_expression_batch`. Shared worker `_applyKeyframesToProp` extracted from
  `add_keyframes` (ES3).
- **`search_layers`** (new): name-substring + type filter, minimal per-match info
  (index/id/name/type, cap 50). Cheap alternative to full comp summary.
  Whitelisted as read-only (parallel execution) in agentToolLoop + main.js.
- **Richer results** (fewer follow-up reads):
  - `add_keyframes` → returns `addedTimes` + times in message.
  - `add_effect` → returns settable `properties` inline (no follow-up
    `get_effect_properties` round trip).
  - `get_detailed_comp_summary` → per-layer `expressions: [{path, snippet, error}]`
    instead of bare `hasExpressions` flag.
- `add_keyframes` description now says WHEN to prefer the batch tool.
- hostBridge: dispatch + `_validateRequiredArgs` for both new tools.

### Prompt layer (agentSystemPrompt.js)
- **Always-full prompt**: lazy keyword-gated modules removed (KEYWORDS regex
  deleted). A missed keyword silently dropped expertise mid-task; the ~3k-token
  saving is irrelevant at 202k ctx. `build()` API kept for compatibility.
- Old "No chain-of-thought in visible response" rule (gpt-oss legacy) replaced
  with "plan + outcome" rule: brief numbered plan for 3+-step tasks, short
  change summary at the end.
- New workflow rules: **Batch aggressively** (#5), **Verify before claiming
  done** (#9: ≥4 mutating calls → one compact read-back check).
- Batch-failure advice softened: re-send only failed targets, don't abandon
  batching for one-at-a-time calls.
- Tool count 45 → 47.

### UI (main.js + styles.css)
- **Live collapsible reasoning**: `.reasoning-box` under the thinking indicator
  streams the CoT tail (cap 8000 chars, `textContent` only — XSS-safe),
  toggle ▸/▾. Default collapsed.
- **Elapsed timer** in the thinking header (1s tick, `Xs` / `Xm Ys`).
- **Smart scroll**: auto-scroll only when user is near bottom (<80px) and
  throttled to 10/s; `force` scroll on message-send / render.
- Report path: `chat_template_kwargs: { enable_thinking: false }`.

### Context management (lib/pure/prune.js — new pure module)
- **Cyrillic-aware token estimator**: non-ASCII chars count ~1 token each
  (chars/4 underestimated Russian by ~4x → premature/late pruning).
- **Smart pruning**: phase 1 truncates OLD tool results to 400 chars (outside
  the protected last-20-message tail); phase 2 FIFO-drops keeping tool-call
  pairing; never starts conversation with orphaned tool results.
- main.js delegates (same pattern as markdown/esLiteral); loaded in index.html.

### chatProvider.js
- `options.chat_template_kwargs` passthrough in both streaming and
  non-streaming Cloud.ru paths.

## Validation

- `node --check` on all edited JS + index.jsx (via .js copy): clean.
- Unit tests: 32/32 pass (`node --test`) — new `test/prune.test.js`
  (estimator, truncation, protected tail, pairing) and `test/registry.test.js`
  (47 tools, schema invariants, batch/search schemas, prompt rules present,
  always-full prompt).
- **Live behavioral test** (GLM-5.1, real endpoint, synthetic comp state),
  task "logo entrance: Position + Opacity + Scale over 1s":
  - Baseline (old registry/prompt): 2 LLM turns, **3 tool calls** (3× add_keyframes).
  - Improved (new): 2 LLM turns, **1 tool call** (1× set_keyframes_batch with
    all 3 targets). → 3x fewer host round trips, PASS.

## Files touched

- `toolRegistry.js`, `hostBridge.js`, `host/index.jsx`, `agentToolLoop.js`
- `agentSystemPrompt.js`
- `main.js`, `styles.css`, `index.html`, `chatProvider.js`
- `lib/pure/prune.js` (new), `test/prune.test.js` (new), `test/registry.test.js` (new)

## Not in scope

- Debounced persistState (current per-run persist is fine; revisit if quota
  warnings appear).
- Automatic primary→fallback model failover.
- set-comp-time tool for timed captures.

## Manual test checklist (in AE)

1. «Сделай появление логотипа: позиция+прозрачность+масштаб за 1с» → expect ONE
   `set_keyframes_batch` card in transcript, all 3 props animated, single undo.
2. «Найди слои со словом text» в комплексной композиции → `search_layers` card,
   fast, no full summary.
3. Long task → reasoning ▸-toggle shows live CoT tail; timer ticks; scrolling up
   during streaming is NOT yanked back down.
4. `add_effect` («добавь glow») → агент настраивает свойства без отдельного
   get_effect_properties вызова.
5. Report button → noticeably faster than before (no reasoning phase).
