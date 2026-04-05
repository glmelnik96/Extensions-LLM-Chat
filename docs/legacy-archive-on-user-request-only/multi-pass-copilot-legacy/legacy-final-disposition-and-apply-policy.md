# Final disposition policy

## Current agent

The **AE Motion Agent** does not use **disposition** / **latestExtractedExpression**. Success is an **assistant** message with text + **toolCalls**; failure is a **system** message or thrown error handled in **main.js**. Tool-level failures appear inside **toolCalls** with **status** / **result**.

**Capabilities:** [capabilities-and-roadmap.md](capabilities-and-roadmap.md).

---

## Legacy: pipeline disposition and Apply

This section clarifies how the **historical multi-pass pipeline** mapped internal outcomes to a **final disposition** and what that meant for **Apply Expression**.

---

## Disposition values (legacy)

| Disposition | Meaning | latestExtractedExpression | Apply | Chat |
|-------------|---------|---------------------------|-------|------|
| **acceptable** | Final expression passed validation and rules; when a target was selected, both validators reported target_ok; safe to apply. | **Set** to the final expression. | **Enabled** | One assistant message (expression + explanation + notes). |
| **warned_draft** | Validation reported warn (or repair left issues); rules passed. Shown but not trusted as fully validated. | **Not** set (null). | **Disabled** | One assistant message with "[Warning: not fully validated]" prefix. |
| **blocked** | No valid expression (generator failed, rules failed, or validation unrecoverable). | **Not** set (null). | **Disabled** | One system message with short explanation. |
| **runtime_failure** | Infrastructure error (network, HTTP, malformed response, config). Pipeline did not complete. | **Not** set (null). | **Disabled** | One system message (e.g. "Error contacting cloud model: …"). |

---

## When latestExtractedExpression is updated (legacy)

- **Set only** when the final disposition is **acceptable**.
- **Cleared (null)** when disposition is warned_draft, blocked, or runtime_failure; also when the user clears the session.

---

## When Apply is enabled (legacy)

- Apply was enabled only when `session.latestExtractedExpression` is non-null and no request is in flight. See **[legacy-manual-apply-expression-policy.md](legacy-manual-apply-expression-policy.md)**.

---

## Blocked vs runtime failure (legacy)

- **Blocked**: Semantic or deterministic outcome — e.g. rules rejected the expression, or validation failed and repair did not succeed.
- **Runtime failure**: Request never completed successfully — e.g. missing config, network error, HTTP error, malformed API response.

Diagnostics and error taxonomy (e.g. in diagnostics.js) may still categorize errors for logging.

---

## Summary

- **Agent today:** outcomes via assistant + toolCalls or system errors; no disposition table.
- **Legacy pipeline:** **acceptable** → apply-ready; **warned_draft** / **blocked** / **runtime_failure** → no Apply, clear user message; **latestExtractedExpression** only for acceptable.
- See **[legacy-chat-publication-final-only-policy.md](legacy-chat-publication-final-only-policy.md)** and **[legacy-final-result-publication-policy.md](legacy-final-result-publication-policy.md)** for legacy publication rules.
