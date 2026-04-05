# Final documentation consolidation plan

One-time pass to finalize documentation structure, clarify README ownership, and keep archive vs active separation. No runtime behavior changes.

---

## 1. Documentation structure audit

### Current state

- **docs/** (root): 20 active .md files (architecture, policies, config, prompt-library, KB, operations, release, QA, troubleshooting). One README.md that already acts as a map with tables.
- **docs/archive/**: Four subfolders — reports/, plans/, analysis/, qa/. Contains stage reports (2–5), staged-implementation-plan, pipeline-preparation-notes, deployment-notes, current-repo-analysis, risk-register, doc-audit, manual-test-matrix. **Gap**: archive/README.md does not list three newer analysis files: prompt-kb-gap-report.md, pipeline-hardening-checklist.md, ae-expressions-audit.md.
- **Root README.md**: Project entry point (Russian); high-level features, install, CSInterface, config pointer, session state, Apply workflow, troubleshooting/QA links. Points to docs/ as "основная документация" but does not name docs/README.md as the docs map.
- **config/README.md**: Config setup, example vs runtime, .gitignore; links to docs/configuration.md and docs/secret-handling.md. Clear scope.
- **knowledge-base/README.md**: KB layout, source priority, projections, index; links to docs/local-knowledge-base.md and grounding-policy-by-stage. Clear scope.
- **docs/README.md**: Strong already: tables for active docs by category, "Where to add new docs," link to archive. Could state explicitly that it is the **source-of-truth map**.
- **cursor-prompts/README.md**: Cursor workflow prompts for stages 2–4; references archive plans. Does not state that it is **not** the runtime prompt source (prompt-library/ and systemPrompt.js are).
- **lib/README.md**: CSInterface.js only; install instructions. Clear. Could state "Scope: contents of lib/ only."

### Classification

| Classification | Docs |
|----------------|------|
| **ACTIVE** | final-architecture, final-target-architecture, pipeline-runtime-flow, runtime-state-schema, final-disposition-policy, final-result-policy, chat-publication-policy, manual-apply-policy, host-bridge-notes, configuration, secret-handling, prompt-library-architecture, local-knowledge-base, grounding-policy-by-stage, runtime-diagnostics, repository-validation, release-checklist, qa-test-plan, troubleshooting |
| **ARCHIVE** | All under docs/archive/: reports/* (stage-2 through stage-5), plans/* (staged-implementation-plan, pipeline-preparation-notes, deployment-notes), analysis/* (current-repo-analysis, risk-register, doc-audit, prompt-kb-gap-report, pipeline-hardening-checklist, ae-expressions-audit), qa/manual-test-matrix |
| **REVIEW** | None; no doc is ambiguous. |

No docs need to be **moved**; the "likely archive candidates" (stage-2–5, staged-implementation-plan, pipeline-preparation-notes, current-repo-analysis, risk-register, manual-test-matrix, deployment-notes) are already in docs/archive/. Only **archive/README.md** needs to list the three additional analysis files.

---

## 2. README responsibility map

| File | Audience | Scope | Source of truth? | What it should contain | What it should not duplicate | Links to read next |
|------|----------|--------|------------------|-------------------------|------------------------------|--------------------|
| **README.md** | Users, developers | Project entry point | Yes, for project overview | What the extension is, main features, install/run basics, CSInterface, config pointer, session/Apply overview, link to full docs | Full config shape, full QA steps, full pipeline internals | docs/README.md, config/README.md, docs/configuration.md, docs/troubleshooting.md, docs/qa-test-plan.md |
| **config/README.md** | Developers, deployers | Config only | Yes, for config folder | Example vs runtime config, setup steps, config shape summary, secret handling pointer | Full install from root; full docs/configuration.md content | docs/configuration.md, docs/secret-handling.md |
| **knowledge-base/README.md** | Maintainers | KB only | Yes, for KB folder | Source priority (Adobe/docsforadobe), layout (corpus, projections, index), three projections, usage | Prompt-library content; full local-knowledge-base.md | docs/local-knowledge-base.md, docs/grounding-policy-by-stage.md |
| **docs/README.md** | All | Active documentation map | **Yes, for all active docs** | Tables of active docs by category, where to add new docs, link to archive | Body of each doc; root install details | archive/README.md, root README.md, individual doc links in tables |
| **cursor-prompts/README.md** | Developers (Cursor) | Cursor workflow only | Yes, for cursor-prompts folder | Purpose: prompts for Cursor when doing stages 2–4. Contents: shared-project-context, stage-*-build. How to use | Runtime prompt content (lives in prompt-library/ and systemPrompt.js) | docs/archive/plans/staged-implementation-plan.md, prompt-library/README.md |
| **lib/README.md** | Developers | lib/ contents only | Yes, for lib/ | What is in lib (CSInterface.js), why required, how to obtain it | Full CEP install; config; other docs | Root README (install overview) |

---

## 3. Active vs archive plan

- **Active**: All 19 operational docs listed in docs/README.md tables remain in docs/ root. No moves.
- **Archive**: Already correct. Only change: **docs/archive/README.md** — add to the analysis section the three files: prompt-kb-gap-report.md, pipeline-hardening-checklist.md, ae-expressions-audit.md.
- **Proposed archive targets** (already in use): docs/archive/reports/, docs/archive/plans/, docs/archive/analysis/, docs/archive/qa/. No new folders.

---

## 4. Execution summary (Phase 2)

1. **docs/README.md**: Add one sentence at top: this file is the source-of-truth map for active documentation.
2. **docs/archive/README.md**: List the three missing analysis docs in the analysis section.
3. **README.md** (root): Add under "Структура проекта" a line that the documentation index is docs/README.md.
4. **config/README.md**: Add a one-line "Scope" note (config only; do not duplicate install or full configuration.md).
5. **knowledge-base/README.md**: Add a one-line "Scope" note (KB only; runtime prompts are in prompt-library/).
6. **cursor-prompts/README.md**: Add a clear "Scope" note: developer-only; not the runtime prompt source.
7. **lib/README.md**: Add a one-line "Scope" note (lib/ contents and usage only).
8. **No file moves**; no link fixes required (archive paths already correct in release-checklist and archive README).

---

## 5. Release-critical docs (must remain)

Per release-checklist.md and check-required-files.js:

- docs/configuration.md, docs/secret-handling.md, docs/manual-apply-policy.md, docs/final-result-policy.md, docs/pipeline-runtime-flow.md, docs/qa-test-plan.md, docs/troubleshooting.md — all present in docs/ root.
- Root README and config/README and docs/README remain. No deletions.
