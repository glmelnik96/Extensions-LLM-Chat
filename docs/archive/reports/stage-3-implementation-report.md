# Stage 3 Implementation Report

This document records what was implemented in Stage 3 (multi-pass pipeline), how current extension behavior was preserved, and what the next stage must add.

---

## Implemented pipeline summary

- **Entry point**: **handleSend()** now calls **runPipelineFlow(session, userText)** instead of runCurrentSinglePassFlow. The primary production path is the new multi-pass pipeline.
- **Stage order**: prepare → generate → validate1 → rules → validate2 → repair1 (if needed) → repair2 (if needed) → finalize.
- **Models**: openai/gpt-oss-120b for generator and both validator passes; Qwen/Qwen3-Coder-Next for repair and for runtime fallback (HTTP/network/malformed response only).
- **Structured outputs**: Generator returns expression, assumptions, target_confirmation, self_check_status, self_check_notes (parsed from ---STRUCTURED--- JSON or fallback to extractExpressionFromResponse). Validator returns status, issues, fix_instructions, ae_invariants_checked, target_ok, explanation_for_user (parsed from ---REPORT--- JSON).
- **Rules layer**: Deterministic checks between validate1 and validate2 (missing/empty expression, leftover markers, sanitization, target context). No LLM; code-only.
- **Final-only output**: A single assistant (or system for blocked) message is published only in finalize. No intermediate generator/validator/repair output in the transcript.
- **Disposition**: acceptable (expression stored, Apply enabled), warned_draft (draft shown with warning, Apply disabled), blocked (explanation only, Apply disabled).
- **Runtime fallback**: invokeCloudChatWithFallback(primaryModel, fallbackModel, messages) retries once with fallback model on HTTP/network/malformed response. Not used for semantic/validation failure.
- **UI status**: setPipelineStage and finalizePipelineState drive the status line (Preparing request…, Generating expression…, Validating…, Applying checks…, Repairing…, Finalizing…, Completed successfully. / Completed with warnings. / Failed / blocked.).
- **Compact pipeline state**: session.pipeline (stage, status, finalDisposition, userStatusText, draftAvailable, manualApplyOnly) is updated; no full trace of all prompts/responses is stored in the session.

---

## Files modified and created

| Action   | Path |
|----------|------|
| Modified | **main.js** — Pipeline prompts (PIPELINE_GENERATOR_INSTRUCTION, PIPELINE_VALIDATOR_INSTRUCTION, PIPELINE_REPAIR_INSTRUCTION); tryParseJsonBlock; parseGeneratorStructuredResponse; parseValidatorStructuredReport; runDeterministicRules; buildPipelineGeneratorPayload, buildPipelineValidatorPayload, buildPipelineRepairPayload; invokeCloudChatWithFallback; publishFinalResultToChat; buildDisplayTextForResult; full runPipelineFlow (prepare → generate → validate1 → rules → validate2 → repair → finalize). handleSend now calls runPipelineFlow(session, text). Comment on autoApplyExpressionForTarget (legacy, not used in production). |
| Created  | **docs/pipeline-runtime-flow.md** — Stage sequence, model roles, rules role, status line. |
| Created  | **docs/final-result-policy.md** — Final-only publication, disposition logic, warning/draft/block, fallback rules. |
| Created  | **docs/manual-apply-policy.md** — Manual Apply only, when Apply is enabled, unchanged Apply flow. |
| Created  | **docs/stage-3-implementation-report.md** — This file. |

---

## How current extension behavior was preserved

- **Panel startup**: Unchanged; index.html, init(), bindEvents(), loadState(), ensureInitialSession(), renderSessions(), renderTranscript() unchanged.
- **Sessions**: createSession(), handleNewSession(), handleRenameSession(), handleClearSession(), handleClearAll(), setActiveSession(), persistState(), loadState() unchanged. session.pipeline is additive; old sessions without pipeline still load and get pipeline on first run.
- **Target selection**: refreshActiveCompFromHost(), target dropdowns, getResolvedTarget(), updateTargetSummary(), updatePromptTargetLine() unchanged. The pipeline reads targetSnapshot once at prepare and uses it for generator/validator/repair; it does not change targeting semantics.
- **Manual Apply**: handleApplyExpression() unchanged. It still reads session.latestExtractedExpression and calls extensionsLlmChat_applyExpressionToTarget via CSInterface. The pipeline only sets latestExtractedExpression when disposition is acceptable; for warned_draft and blocked it is null, so Apply stays disabled as designed.
- **Host and CEP**: host/index.jsx, CSInterface, buildHostEvalScript, getHostScriptContent unchanged. No new backend or build system.

---

## Exact stage order implemented

1. **prepare** — getResolvedTarget(), docs retrieval, set status "Preparing request…".
2. **generate** — buildPipelineGeneratorPayload, invokeCloudChatWithFallback(DEFAULT_MODEL, FALLBACK_MODEL), normalizeChatResponse, parseGeneratorStructuredResponse.
3. **validate1** — buildPipelineValidatorPayload, invokeCloudChatWithFallback(DEFAULT_MODEL, FALLBACK_MODEL), parseValidatorStructuredReport.
4. **rules** — runDeterministicRules(currentExpression, targetSnapshot); on block, reject and go to catch → finalize blocked.
5. **validate2** — buildPipelineValidatorPayload (with report1 context), invokeCloudChatWithFallback(DEFAULT_MODEL, FALLBACK_MODEL), parseValidatorStructuredReport.
6. **repair1 / repair2** — If (report1.status === 'fail' || report2.status === 'fail' || (report1.status === 'warn' && report2.status === 'warn')) and currentExpression: buildPipelineRepairPayload, invokeCloudChat(FALLBACK_MODEL), extractExpressionFromResponse, runDeterministicRules; if rules still block, retry once (repair2).
7. **finalize** — decideAndPublish(): set disposition (acceptable | warned_draft | blocked), buildDisplayTextForResult, publishFinalResultToChat, finalizePipelineState.

---

## Exact final-disposition logic implemented

- **acceptable**: (report1.status === 'pass' || report2.status === 'pass'). Publish assistant message with expression + explanation + notes; set session.latestExtractedExpression = finalExpression; finalizePipelineState(session, 'success', 'Completed successfully.').
- **warned_draft**: (report1.status === 'warn' || report2.status === 'warn') or validation did not fully pass. Publish assistant message with "[Warning: not fully validated]" prefix; set session.latestExtractedExpression = null; finalizePipelineState(session, 'warned', 'Completed with warnings.').
- **blocked**: No valid currentExpression (e.g. generator failed or rules failed), or pipeline threw. Publish system message with explanation; session.latestExtractedExpression = null; finalizePipelineState(session, 'blocked', 'Failed / blocked.').

---

## Handoff to next stage (Stage 4)

Stage 4 should add:

1. **Local knowledge base** — Build and index a corpus from Adobe Help Center (primary) and docsforadobe (secondary). Integrate retrieval so that generator, validator, and repair can receive role-specific context from the knowledge base.
2. **Role-specific prompt libraries** — Populate **prompt-library/generator**, **prompt-library/validator**, **prompt-library/repair** with prompts (or fragments) that reference the knowledge base and the three projections. Replace or extend the current inline PIPELINE_GENERATOR_INSTRUCTION, PIPELINE_VALIDATOR_INSTRUCTION, PIPELINE_REPAIR_INSTRUCTION with content from the prompt library.
3. **Grounded prompt assembly** — For each pipeline stage that calls a model (generate, validate1, validate2, repair), assemble the request messages using the appropriate projection of the knowledge base and the role-specific prompt from the prompt library, so that model calls are grounded in the local docs rather than only in the current system prompt and user message.

The pipeline in main.js already has clear hooks: buildPipelineGeneratorPayload, buildPipelineValidatorPayload, buildPipelineRepairPayload each accept context (e.g. docsRetrieval or targetSnapshot). Stage 4 can introduce a knowledge-base service and three projections (generator / validator / repair) and pass the projected snippets into these builders without changing the pipeline stage order or the final-result policy.
