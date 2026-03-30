# Final disposition policy

This document clarifies how the pipeline maps internal outcomes to a **final disposition** and what that means for the user and for Apply.

---

## Disposition values

| Disposition | Meaning | latestExtractedExpression | Apply | Chat |
|-------------|---------|---------------------------|-------|------|
| **acceptable** | Final expression passed validation and rules; when a target was selected, both validators reported target_ok; safe to apply. | **Set** to the final expression. | **Enabled** | One assistant message (expression + explanation + notes). |
| **warned_draft** | Validation reported warn (or repair left issues); rules passed. Shown but not trusted as fully validated. | **Not** set (null). | **Disabled** | One assistant message with "[Warning: not fully validated]" prefix. |
| **blocked** | No valid expression (generator failed, rules failed, or validation unrecoverable). | **Not** set (null). | **Disabled** | One system message with short explanation. |
| **runtime_failure** | Infrastructure error (network, HTTP, malformed response, config). Pipeline did not complete. | **Not** set (null). | **Disabled** | One system message (e.g. "Error contacting cloud model: …"). |

---

## When latestExtractedExpression is updated

- **Set only** when the final disposition is **acceptable**. The value is the single final expression string used for display and for Apply.
- **Cleared (null)** when disposition is warned_draft, blocked, or runtime_failure; also when the user clears the session.

---

## When Apply is enabled

- Apply is enabled only when:
  - There is an active session,
  - `session.latestExtractedExpression` is non-null,
  - No request is in flight.

So in practice Apply is enabled **only after an acceptable result**. See **docs/manual-apply-policy.md**.

---

## Blocked vs runtime failure

- **Blocked**: Semantic or deterministic outcome — e.g. rules rejected the expression, or validation failed and repair did not succeed. The pipeline completed and decided "do not show an apply-ready result."
- **Runtime failure**: Request never completed successfully — e.g. missing config, network error, HTTP error, malformed API response. The pipeline did not reach a final disposition; the catch handler shows a user-facing error.

Diagnostics and error taxonomy (e.g. in diagnostics.js) categorize these for logging; the user sees a concise message in both cases, with Apply disabled.

---

## Summary

- **acceptable** → apply-ready; **warned_draft** / **blocked** / **runtime_failure** → no Apply, clear user message.
- **latestExtractedExpression** is the single source of truth for what can be applied; it is set only for acceptable.
- See **docs/chat-publication-policy.md** for what appears in the chat and **docs/final-result-policy.md** for the full result policy.
