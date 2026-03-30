# Chat publication policy

The panel shows **only the final result** of the multi-pass pipeline in the chat. Intermediate stages are never published as normal assistant messages.

---

## What is published

- **One message per Send** after the pipeline finishes:
  - **Acceptable**: One **assistant** message in the standard format (expression, ---EXPLANATION---, bullets, optional ---NOTES---). This is the only user-facing expression output.
  - **Warned draft**: One **assistant** message with the same format, prefixed by "[Warning: not fully validated]".
  - **Blocked or runtime failure**: One **system** message with a short explanation (e.g. "Pipeline failed: …" or "Error contacting cloud model: …").

---

## What is not published

- Generator output (drafts, self-check) — internal only.
- Validator reports (pass/warn/fail, issues, fix_instructions) — internal only.
- Rules stage result — internal only; only the final decision is reflected (blocked → system message).
- Repair attempts and intermediate expressions — internal only.
- Internal stack traces or raw API errors — not shown in chat; user sees a short, safe message. Detailed diagnostics go to the console when diagnostics are enabled.

---

## latestExtractedExpression and Apply

- **latestExtractedExpression** is set only when the final disposition is **acceptable**. That value is what the user sees in the assistant message and what Apply sends to the host.
- When disposition is warned_draft or blocked, latestExtractedExpression is not set; Apply stays disabled.
- So the chat transcript and the Apply button are both driven by the **same** final result and disposition. See **docs/final-disposition-policy.md** and **docs/manual-apply-policy.md**.

---

## Summary

- Final-only publication: one assistant or system message per send.
- No intermediate pipeline stages in the transcript.
- User-facing errors are concise; internal detail is in diagnostics/logs.
