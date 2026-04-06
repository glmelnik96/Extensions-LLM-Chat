# Final architecture

Practical overview of the extension as implemented today. **Authoritative list of tools, UI behavior, limitations, and roadmap:** **[capabilities-and-roadmap.md](capabilities-and-roadmap.md)**.

---

## Stack

- **Panel**: HTML/CSS/JS CEP panel; **index.html**; runtime **main.js** (AE Motion Agent).
- **Agent loop**: **agentToolLoop.js** (`runAgentLoop`), **agentSystemPrompt.js**, **toolRegistry.js** (30 OpenAI-style tools, including deterministic motion presets for fade/pop/slide), **chatProvider.js** (Cloud.ru provider in active Send flow; Ollama path retained for compatibility modules), **hostBridge.js** (promise wrapper around **CSInterface.evalScript** + host script inlining).
- **Host**: After Effects ExtendScript in **host/index.jsx** — invoked per tool call (not a single “apply only” entry).
- **Cloud**: Configurable **baseUrl** (default Cloud.ru Foundation Models), **chat/completions** with **tool calling**.
- **Local optional**: **Ollama** integrations exist in code for vision/legacy compatibility, but Ollama chat is not exposed in the current model selector UI.
- **Still loaded (non–Send-path)**: **pipelineAssembly.js**, **systemPrompt.js**, **aeDocsIndex.js**, **aeDocsRetrieval.js**, **aePromptContext.js**, **aeResponseValidation.js**, **lib/captureMacOS.js**, **lib/ollamaVision.js** — kept for compatibility or future wiring; the active **Send** path does not run the multi-pass expression pipeline or inject vision grounding into the agent loop (see **capabilities-and-roadmap.md**, *Vision-informed animation*).

---

## Config loading

- **index.html** order: **config/example.config.js** → **config/runtime-config.js** (optional) → **config/secrets.local.js** (API key via **EXTENSIONS_LLM_CHAT_SECRETS.apiKey**).
- **getConfig()** / **isConfigValid()** behavior: see **docs/configuration.md** and **docs/secret-handling.md**. Cloud models require a key; Ollama-only sessions do not use Cloud.ru key.

---

## Primary runtime: agent tool loop

1. User sends a message → **main.js** appends a **user** message and calls **AGENT_TOOL_LOOP.runAgentLoop** with conversation history, **AGENT_SYSTEM_PROMPT**, and **AGENT_TOOL_REGISTRY.tools**.
2. The loop calls **CHAT_PROVIDER** (Cloud.ru or Ollama) with messages + tools until the model returns final **content** or **maxSteps** is reached.
3. Each tool call is executed via **hostBridge** → ExtendScript in **host/index.jsx**; results are sent back to the model as **tool** messages.
4. On success, **main.js** appends one **assistant** message with **text** and **toolCalls** (name, args, result, status) for the UI cards.
5. **Undo** triggers After Effects undo (last host operations are grouped in ExtendScript as appropriate).
6. **Preset toolbar** in **main.js** can directly call deterministic tools (`apply_fade_preset`, `apply_pop_preset`, `apply_slide_preset`) for selected layers.

Session persistence (**localStorage** key **ae-motion-agent-state**): see **docs/runtime-state-schema.md**.

---

## Legacy: multi-pass expression Copilot

The repo still contains documentation and scripts for a historical **multi-pass expression pipeline** (prepare → generate → validate → rules → repair → finalize, **manual Apply Expression**, **latestExtractedExpression**). That pipeline is **not** invoked from the current **main.js** **Send** handler.

| Topic | Legacy doc (full text under `legacy-archive-on-user-request-only/`) |
|-------|------------|
| Stage sequence | `multi-pass-copilot-legacy/legacy-pipeline-runtime-flow-stages-and-models.md` |
| Chat output rules | `multi-pass-copilot-legacy/legacy-chat-publication-final-only-policy.md` |
| Disposition / Apply | `multi-pass-copilot-legacy/legacy-final-disposition-and-apply-policy.md`, `multi-pass-copilot-legacy/legacy-manual-apply-expression-policy.md` |
| Stage grounding policy | `multi-pass-copilot-legacy/legacy-grounding-policy-by-pipeline-stage.md` |
| Target + Apply bridge | **docs/host-bridge-notes.md** (current agent path; legacy Apply note inside) |

Use these when maintaining or restoring the old flow, not when describing the shipping agent UX.

---

## Knowledge-base and prompt-library

- **knowledge-base** and **prompt-library** feed **pipelineAssembly.js** and related retrieval helpers. The **agent** uses **agentSystemPrompt.js** and tool schemas in **toolRegistry.js**; deeper KB injection into the agent loop is roadmap item **4.4** in **capabilities-and-roadmap.md**.

---

## Diagnostics and troubleshooting

- **diagnostics.js** exposes **window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS**. See **docs/runtime-diagnostics.md** and **docs/troubleshooting.md**.

---

## Validating the repo before release

- Run **node scripts/validate-repo.js** and **node scripts/check-required-files.js** from repo root. See **docs/repository-validation.md** and **docs/release-checklist.md**.
