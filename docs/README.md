# Documentation

This file is the **source-of-truth map** for **active** documentation in `docs/`. Historical material lives under **`legacy-archive-on-user-request-only/`** — see the warning in that folder’s README; **do not open the archive unless the user explicitly asks** (saves context on long legacy files).

---

## Active documentation

### Architecture and runtime

| Doc | Purpose |
|-----|---------|
| [final-architecture.md](final-architecture.md) | Implemented stack: agent tool loop, config, hostBridge; pointers to legacy modules. |
| [capabilities-and-roadmap.md](capabilities-and-roadmap.md) | **Source of truth:** tools, limitations, roadmap, adding a tool. |
| [runtime-state-schema.md](runtime-state-schema.md) | Agent session / localStorage; legacy session fields noted at end. |
| [vision-grounding.md](vision-grounding.md) | Vision / Ollama grounding design (historical wiring + current notes). |

### Short redirects (stub at path; full text in archive)

These files stay at stable paths for links and `check-required-files.js`. Each points into **`legacy-archive-on-user-request-only/multi-pass-copilot-legacy/`** for the full multi-pass Copilot document.

| Stub | Archive file |
|------|----------------|
| [final-target-architecture.md](final-target-architecture.md) | legacy-multi-pass-target-architecture.md |
| [pipeline-runtime-flow.md](pipeline-runtime-flow.md) | legacy-pipeline-runtime-flow-stages-and-models.md |
| [chat-publication-policy.md](chat-publication-policy.md) | legacy-chat-publication-final-only-policy.md (includes “Current agent” section) |
| [final-disposition-policy.md](final-disposition-policy.md) | legacy-final-disposition-and-apply-policy.md |
| [final-result-policy.md](final-result-policy.md) | legacy-final-result-publication-policy.md |
| [manual-apply-policy.md](manual-apply-policy.md) | legacy-manual-apply-expression-policy.md |
| [grounding-policy-by-stage.md](grounding-policy-by-stage.md) | legacy-grounding-policy-by-pipeline-stage.md |

### Policies and behavior (current)

| Doc | Purpose |
|-----|---------|
| [host-bridge-notes.md](host-bridge-notes.md) | Panel ↔ AE: hostBridge, agent tools. |

### Configuration and security

| Doc | Purpose |
|-----|---------|
| [configuration.md](configuration.md) | Config shape and behavior. |
| [secret-handling.md](secret-handling.md) | API keys and secrets policy. |

### Prompt library and knowledge base

| Doc | Purpose |
|-----|---------|
| [prompt-library-architecture.md](prompt-library-architecture.md) | Prompt library layout and assembly. |
| [local-knowledge-base.md](local-knowledge-base.md) | KB layout, corpus, projections. |

### Product direction (roadmap)

| Doc | Purpose |
|-----|---------|
| [capabilities-and-roadmap.md](capabilities-and-roadmap.md) | Same as above — primary product reference. |
| [north-star-vision-agent.md](north-star-vision-agent.md) | Long-term vision: local vision, CEP + Node capture, phases. |

### Operations and release

| Doc | Purpose |
|-----|---------|
| [runtime-diagnostics.md](runtime-diagnostics.md) | Diagnostics API and error categories. |
| [repository-validation.md](repository-validation.md) | validate-repo and check-required-files. |
| [release-checklist.md](release-checklist.md) | Pre-release checklist. |
| [qa-test-plan.md](qa-test-plan.md) | **Short** agent smoke plan; extended checklists → archive `qa-testing/`. |
| [troubleshooting.md](troubleshooting.md) | Common issues (agent + some legacy notes). |

---

## Legacy archive (explicit user request only)

| Location | Contents |
|----------|----------|
| [legacy-archive-on-user-request-only/README.md](legacy-archive-on-user-request-only/README.md) | **Read this first** if the user asked for archive material. |
| `…/multi-pass-copilot-legacy/` | Full legacy policy markdown (renamed files). |
| `…/implementation-reports/` | Stage 2–5 reports (renamed). |
| `…/planning/` | Staged plan, pipeline prep, deployment notes (renamed). |
| `…/analysis-notes/` | Audits, risks, gap reports (renamed). |
| `…/qa-testing/` | Full Copilot test plan, agent checklist v2, compact matrix. |

---

## Where to add new docs

- **Current behavior, config, release:** add or edit files in **`docs/`** (not under `legacy-archive-on-user-request-only/`) and link from this README or the root [README.md](../README.md).
- **Historical reports, old test matrices:** add under **`docs/legacy-archive-on-user-request-only/`** in the matching subfolder; update that archive’s README if you add a new category.
