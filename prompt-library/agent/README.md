# Agent prompts (reserved namespace)

This folder is reserved for a dedicated **agent prompt namespace**. The panel already uses a tool loop, but these prompts are not wired into the shipped runtime path yet (see **docs/final-architecture.md**).

## Not used today

The production pipeline loads **prompt-library/promptsBundle.js** only for **generator**, **validator**, and **repair** roles. No code path imports from **`prompt-library/agent/`** yet.

## Intended contents (later)

- Agent **system** prompt (tool use policy, After Effects safety).
- Tool description snippets (read comp state, apply expression to target, etc.) as JSON or markdown blocks consumed by a future assembler.
- Optional: few-shot examples for structured multi-target expression batches (`{ layer, property, expression }[]`).

## Conventions

- Keep agent prompts **separate** from Copilot generator/validator/repair to avoid accidental mixing in **pipelineAssembly.js**.
- When implementing, add a small loader (or extend **promptsBundle.js** with explicit `agent:` namespace) rather than editing role prompts in place.
