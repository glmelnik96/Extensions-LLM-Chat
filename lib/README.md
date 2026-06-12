# lib/

**Scope:** Contents of **lib/** and how the extension uses them. For full CEP install and config, see the root README and config/README.md; do not duplicate those here.

## CSInterface.js

Adobe's CEP bridge library (`CSInterface.js`, CEP 11.x) — **tracked in the repo**, no manual download needed. The panel loads it from this folder; it provides `evalScript` for all panel ↔ After Effects communication.

If you ever see `Failed to load resource: net::ERR_FILE_NOT_FOUND` for `CSInterface.js`, the file is missing (e.g. broken checkout) — restore it via `git checkout lib/CSInterface.js` or re-download from [Adobe CEP-Resources](https://github.com/Adobe-CEP/CEP-Resources) (CEP_11.x folder).

## pure/

Pure JS modules with no CEP/DOM dependencies, shared between the panel and node unit tests (`test/`):

- `esLiteral.js` — safe serialization of JS values into ExtendScript literals
- `markdown.js` — markdown → HTML renderer for chat messages
- `prune.js` — conversation pruning under token budget
- `expressionLibrary.js` — 28 curated AE expression snippets + local search (`search_expression_library` tool)

Each file exposes itself on `window.PURE_*` when loaded in the panel and via `module.exports` under node.
