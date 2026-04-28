# Local Knowledge Base

**Scope:** This file describes only the knowledge-base folder (corpus, projections, index). Runtime prompt content lives in **`agentSystemPrompt.js`**; the chat agent selects KB snippets by keyword match in **`main.js`** and injects them into the system prompt before each request.

Repository-resident reference material for the AE expression agent. One shared corpus, three role-oriented projections.

## Source priority

- **Primary**: Adobe Help Center / official After Effects Expression Language Reference.
- **Secondary**: docsforadobe After Effects Expression Reference (mirror and convenience).

## Layout

- **corpus/** — Curated topic content. `adobe/` = primary, `docsforadobe/` = secondary mirror.
- **projections/** — Topic groupings retained for reference: `generator/`, `validator/`, `repair/`. The current chat-only runtime uses keyword matching, not these projections directly.
- **index/** — `corpusIndex.js` snippet manifest (kept for reference; chat runtime currently does keyword-based matching in `main.js`).
- **assembly/** — Reserved for future assembly helpers; not loaded by the runtime.

## How the chat agent uses this

`main.js` performs simple keyword detection on each user message and injects matching corpus snippets into the system prompt for that turn. There is no multi-pass pipeline anymore; the projections and assembly folders are kept as authoring references for future curation work.
