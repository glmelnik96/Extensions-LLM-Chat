# Repository validation

Maintainers can run lightweight checks to verify the project structure and required assets before release or after cloning.

## Scripts

- **scripts/validate-repo.js** — Verifies required directories and core integration points (index.html, main.js, diagnostics.js, config, prompt-library, knowledge-base, host, lib, CSXS manifest).
- **scripts/check-required-files.js** — Verifies prompt-library, knowledge-base, config example, and expected docs exist.

Both scripts are Node.js and assume they are run from the repository root.

## How to run

From the extension root:

```bash
node scripts/validate-repo.js
node scripts/check-required-files.js
```

Exit code 0 means all checks passed; non-zero means one or more required items are missing.

## What is checked

- **validate-repo.js**: Required directories (`config`, `docs`, `host`, `knowledge-base`, `lib`, `prompt-library`, `scripts`, etc.) and required files (main.js, index.html, diagnostics.js, config/example.config.js, knowledge-base/index/corpusIndex.js, prompt-library/promptsBundle.js, pipelineAssembly.js, systemPrompt.js, lib/captureMacOS.js, lib/ollamaVision.js, lib/CSInterface.js, host/index.jsx, CSXS/manifest.xml).
- **check-required-files.js**: Prompt-library system prompts, knowledge-base index and README, config example, and key docs (configuration, secret-handling, manual-apply-policy, final-result-policy).

## When to run

- After cloning the repo.
- Before packaging for release (see docs/release-checklist.md).
- After adding or moving required paths (update the script lists accordingly).
