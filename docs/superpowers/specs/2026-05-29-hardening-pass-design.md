# Hardening pass — design spec (2026-05-29)

> Scope decided with user: option **A–C** = code fixes + minimal pure-function test harness.
> No commit will be made without explicit user request. This doc is the running record of all edits.

## Goal

Close the verified High/Medium hardening issues from the 2026-05-29 codebase review, without expanding the chat-only architecture or adding lint/CI. Add a minimal zero-dependency test harness for the two pure functions worth protecting.

## Scope

In scope:
- **#1 (High) XSS in `renderMarkdown`** — `main.js`
- **#2 (Medium) idempotency cache never invalidated** — `hostBridge.js`
- **#4 (Medium) step limit too high + no per-step host timeout** — `agentToolLoop.js`, `main.js`, `config/example.config.js`
- **#5 (Medium) localStorage quota → silent session loss** — `main.js`
- **Test harness** — `node --test`, no deps; extract the two pure functions

Dropped after verification:
- **#3 (anti-spam key granularity)** — NOT a real bug. `_spamKey` (`hostBridge.js:204`) is `toolName + '|' + JSON.stringify(args)`, which already includes `layer_id`/`property_path`. Different layers already produce different keys; the guard only trips on byte-identical repeated failing calls, which is the intended runaway-spiral defense. No change.

Out of scope (noted, not touched this pass):
- `evalHostFunction` parse-failure returning `{ok:true}` (`hostBridge.js:75`) — separate Medium, not in A–C.
- ESLint / Prettier / CI / `package.json` scripts beyond the test runner.

## Approach (Q2 = A): node built-in test runner + extraction

Both target functions live inside browser IIFEs and aren't requireable. Extract each into a UMD-style module under `lib/pure/` that attaches to a global AND sets `module.exports` when present:

```
lib/pure/markdown.js   → window.PURE_MARKDOWN = { renderMarkdown }
lib/pure/esLiteral.js  → window.PURE_ES = { toESLiteral }
```

- `index.html` loads these `<script>`s before `main.js` / `hostBridge.js`.
- `main.js` `renderMarkdown` and `hostBridge.js` `toESLiteral` become thin references to the global (single source of truth, no logic duplication).
- Tests `require()` the modules directly: `node --test test/`.
- A `package.json` is added ONLY to define `"test": "node --test"` and mark `"private": true`. No dependencies, no `node_modules`.

## Fix designs

### #1 XSS (`lib/pure/markdown.js`)
Root cause: `main.js:348` builds `<img alt="...">` without escaping `"` in alt text; `>`/`<`/`&` are escaped globally at `main.js:343` but `"` is not, so `![x" onerror=js](src)` breaks out of the attribute. Amplified by `--enable-nodejs` in the CEP manifest (XSS → RCE surface).

Fix:
1. Escape `"` (and `'`) in the `alt` text before interpolation.
2. Restrict image `src` to a safe scheme allowlist: `file:`, `https:`, `data:image/`. Anything else → drop the image (render the literal alt text), preventing `javascript:`/unknown-scheme `src`.
3. Keep `innerHTML` (full DOM-construction rewrite is out of scope); targeted escaping + scheme allowlist is the focused fix.

### #2 idempotency TTL (`hostBridge.js`)
Root cause: `_idempotencyCache` entries persist until manual session clear; after a user manually deletes/renames a layer, a re-run with the same `client_op_id` returns a stale "success".

Fix: store `{ result, ts }` and treat entries older than `IDEMPOTENCY_TTL_MS` (60_000) as absent on read. Rationale: idempotency exists to dedup retries after a transient network error, which happen within seconds — 60s preserves that while preventing hours-stale reuse. No new config field.

### #4 step limit + per-step host timeout
- Lower default step cap **150 → 60** in all three spots: `config/example.config.js:20` (`agentMaxSteps`), `main.js:29` (`DEFAULT_AGENT_MAX_STEPS`), `agentToolLoop.js:13` (`DEFAULT_MAX_STEPS`). 60 comfortably covers observed worst case (T10 settled at 27 calls) with headroom; caps runaway cost.
- Add a per-call timeout to `evalHostFunction` (`hostBridge.js`): if `CSInterface.evalScript`'s callback hasn't fired within `HOST_EVAL_TIMEOUT_MS` (30_000), reject with a clear timeout error so the loop surfaces it instead of hanging forever. (API-side calls already have chatProvider's AbortController timeout.)

### #5 localStorage quota (`main.js persistState`)
Root cause: `persistState` swallows `QuotaExceededError` in a bare `catch` → session silently not saved, lost on next load.

Fix: on `setItem` failure, detect quota error, prune the oldest half of `session.messages`, retry once; if still failing, surface a visible status-line warning ("Session too large to save — older messages dropped"). No IndexedDB (out of scope).

## Testing

`test/markdown.test.js`:
- bold/italic/code/list/header rendering sanity
- XSS payloads stay inert: `![x" onerror=alert(1)](data:image/png;base64,xx)` → no `onerror` attribute escapes; `<script>`/`<svg onload>` escaped; `javascript:` src dropped.

`test/esLiteral.test.js`:
- primitives, nested arrays/objects, string quoting, null/undefined, special chars in keys/values produce valid ES literals.

Run: `node --test`. ExtendScript host layer remains untested (requires running AE) — unchanged.

## Files touched (running edit log)

| File | Change |
|------|--------|
| `lib/pure/markdown.js` | NEW — extracted + hardened `renderMarkdown` |
| `lib/pure/esLiteral.js` | NEW — extracted `toESLiteral` |
| `index.html` | load the two pure scripts before main/hostBridge |
| `main.js` | use `PURE_MARKDOWN.renderMarkdown`; #5 quota handling |
| `hostBridge.js` | use `PURE_ES.toESLiteral`; #2 TTL; #4 host eval timeout |
| `agentToolLoop.js` | #4 `DEFAULT_MAX_STEPS` 150→60 |
| `config/example.config.js` | #4 `agentMaxSteps` 150→60 |
| `package.json` | NEW — `{ private, scripts.test: "node --test" }` |
| `test/markdown.test.js` | NEW |
| `test/esLiteral.test.js` | NEW |

## Non-goals / boundaries respected
- Chat-only architecture unchanged (AGENTS.md:243).
- No localStorage schema change (AGENTS.md:239) — pruning drops messages but keeps the shape.
- No commit without explicit user request.
