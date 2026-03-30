# Final Result Policy

This document describes how the pipeline publishes results to the chat and how disposition (acceptable, warned_draft, blocked) affects what the user sees and whether Apply is available.

---

## Final-only chat publication

- **No intermediate messages**: Generator drafts, validator reports, rules findings, and repair attempts are **not** shown as normal chat messages. They are used only inside the pipeline.
- **Single final message**: Only after the **finalize** stage does the pipeline add **one** new message to the transcript:
  - **Acceptable** or **warned_draft**: one **assistant** message in the panel’s usual format (expression + ---EXPLANATION--- + bullets [+ ---NOTES---]). For warned_draft, the text is prefixed with "[Warning: not fully validated]".
  - **Blocked**: one **system** message with a short explanation (e.g. "Pipeline failed: …" or "Expression could not be generated or validated. Please try again or rephrase your request.").

So the chat output no longer reflects the old single-pass contract as the internal source of truth; the internal source of truth is the structured generator/validator/repair outputs, and only the final decision is rendered for the user.

---

## Disposition logic

| Disposition      | Condition | Chat output | latestExtractedExpression | Apply button |
|------------------|-----------|-------------|---------------------------|--------------|
| **acceptable**   | At least one of validate1/validate2 reported **pass**; when a target is selected, both validators report **target_ok**; rules passed; optional repair succeeded. | One assistant message (expression + explanation + notes). | Set to the final expression. | Enabled (manual Apply allowed). |
| **warned_draft** | Validation reported **warn**; or validators reported **target_ok: false** (target mismatch); or repair was used and checks still reported issues; rules passed. | One assistant message with "[Warning: not fully validated]" prefix. | **Not** set (null). | Disabled. |
| **blocked**      | Generator produced no valid expression; or rules failed; or pipeline threw (e.g. network error). | One system message with explanation. | **Not** set (null). | Disabled. |

Blocked outcomes never store an apply-ready expression; the user cannot Apply when the result is blocked or warned_draft (warned_draft explicitly keeps Apply disabled).

---

## Warning / draft / block behavior (summary)

- **Acceptable**: Final expression is shown in the usual format; user can copy and manually Apply; pipeline state finalDisposition = 'success', status "Completed successfully.".
- **Warned draft**: Final expression is shown with a warning; it is **not** stored as latestExtractedExpression, so the Apply button stays disabled; pipeline state finalDisposition = 'warned', status "Completed with warnings.".
- **Blocked**: No expression is shown as the main result; only a system explanation; latestExtractedExpression remains null; pipeline state finalDisposition = 'blocked', status "Failed / blocked.".

---

## Fallback rules

Runtime fallback (retry with Qwen when the primary model call fails) is used **only** for:

- HTTP failure (e.g. 4xx/5xx)
- Network failure
- Malformed model response (e.g. missing choices or content)
- Unavailable primary model (openai/gpt-oss-120b) at request time

It is **not** used for:

- Semantic disagreement (e.g. validator says "fail")
- Validation warnings
- Repairable expression issues (those are handled by the repair passes)

See **docs/pipeline-runtime-flow.md** for the stage sequence and model roles.
