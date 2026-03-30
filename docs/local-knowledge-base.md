# Local Knowledge Base

The extension uses a **local**, repository-resident knowledge base. No remote doc retrieval at runtime. One shared corpus, three role-specific projections.

## Directory layout

- **knowledge-base/README.md** — Overview and source priority.
- **knowledge-base/corpus/** — Curated topic content.
  - **adobe/** — Primary: Adobe Help Center / After Effects Expression Language Reference. Markdown topic files (expression-basics, wiggle-valueAtTime-posterizeTime, sourceText-sourceRectAtTime, property-targeting-constraints). Source Text: in expressions, `value` may be a string — see sourceText-sourceRectAtTime for the defensive read pattern; the rules stage blocks unsafe `value.text` when target is Text > Source Text.
  - **docsforadobe/** — Secondary: docsforadobe mirror (common-patterns, repair-fix-recipes).
- **knowledge-base/projections/** — Which topics feed each role.
  - **generator/topic-map.json** — Topic IDs for intent, target-fit, patterns, examples.
  - **validator/topic-map.json** — Topic IDs for correctness, target mismatch, property suitability.
  - **repair/topic-map.json** — Topic IDs for fix recipes and patching.
- **knowledge-base/index/** — Runtime index.
  - **corpusIndex.js** — Single script loaded by the panel. Exposes `window.KB_CORPUS_INDEX` with:
    - `corpus`: object keyed by topic ID (title, source, body, snippets).
    - `projections`: { generator: [...topicIds], validator: [...], repair: [...] }.
    - `getGroundingForProjection(projectionName)`: returns a string of concatenated topic bodies and snippets for that projection.
- **knowledge-base/assembly/** — Reserved for future assembly helpers; main assembly is in extension **pipelineAssembly.js**.

## Source priority

- **Primary**: Adobe Help Center / official Adobe After Effects Expression Language Reference. Content in `corpus/adobe/` and in `corpusIndex.js` is derived from this.
- **Secondary**: docsforadobe After Effects Expression Reference. Content in `corpus/docsforadobe/` and corresponding entries in `corpusIndex.js` are the secondary mirror.

## Usage

The panel loads `knowledge-base/index/corpusIndex.js` via a script tag. It does not fetch markdown files at runtime; the index embeds the text so the extension works without a build step. Maintainers can edit the .md files and sync content into `corpusIndex.js`, or edit `corpusIndex.js` directly. See **docs/grounding-policy-by-stage.md** for how each pipeline stage uses the projections.
