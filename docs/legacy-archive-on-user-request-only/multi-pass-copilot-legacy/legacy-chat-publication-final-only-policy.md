# Chat publication policy

## Current agent (main.js)

- Каждый **Send** добавляет сообщение **user**, затем после завершения **runAgentLoop** — одно сообщение **assistant** с финальным **text** и массивом **toolCalls** (карточки инструментов в UI).
- Ошибки (нет ключа, сеть, сбой цикла) добавляются как **system** сообщения.
- Промежуточные шаги LLM без финального ответа пользователю не дублируются отдельными сообщениями; ход работы виден через **toolCalls** и индикатор «Agent working».

**Продукт и инструменты:** [capabilities-and-roadmap.md](../../capabilities-and-roadmap.md).

---

## Legacy: multi-pass expression pipeline

The panel used to show **only the final result** of the multi-pass pipeline in the chat. Intermediate stages were never published as normal assistant messages. The following applies to that **historical** flow only.

---

## What is published (legacy)

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

## latestExtractedExpression and Apply (legacy)

- **latestExtractedExpression** was set only when the final disposition was **acceptable**.
- See **[legacy-final-disposition-and-apply-policy.md](legacy-final-disposition-and-apply-policy.md)** and **[legacy-manual-apply-expression-policy.md](legacy-manual-apply-expression-policy.md)**.

---

## Summary

- **Agent:** user message + assistant message with optional **toolCalls**; system on failure.
- **Legacy pipeline:** final-only publication; one assistant or system message per send; no intermediate pipeline stages in the transcript.
- User-facing errors are concise; internal detail is in diagnostics/logs.
