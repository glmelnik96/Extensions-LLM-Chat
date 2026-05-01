# Local Knowledge Base

Reference material on After Effects expressions kept inside the repo.

## Layout

- **corpus/adobe/** — Adobe Help Center / official Expression Language Reference (primary source).
- **corpus/docsforadobe/** — Mirror of docsforadobe Expression Reference (secondary).

These markdown files are **authoring references for humans** — the chat runtime does not read them at run time. They exist so you can quickly look up wiggle / sourceText / sourceRectAtTime semantics while editing the prompt or expression-related code.

## How the chat agent injects KB snippets

The chat agent uses a small inline list of snippets defined directly in `main.js` (search for `KB_SNIPPETS`). When a user message contains keywords like `wiggle`, `sourceText`, `valueAtTime`, etc., the matching snippet is appended to the system prompt for that single turn.

If you want to teach the agent a new pattern, add an entry to `KB_SNIPPETS` in `main.js`. Folders under `corpus/` are unrelated to runtime — they are only useful for grounding your own additions.
