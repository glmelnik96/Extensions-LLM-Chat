# Documentation

This file is the **source-of-truth map** for active documentation. This folder holds the **active** operational and reference documentation for the Extensions LLM Chat CEP extension. Historical implementation reports and planning artifacts are in [archive/](archive/).

## Active documentation (source of truth)

### Architecture and runtime

| Doc | Purpose |
|-----|---------|
| [final-architecture.md](final-architecture.md) | **Implemented** stack: agent tool loop, config, hostBridge; pointers to legacy multi-pass modules. |
| [capabilities-and-roadmap.md](capabilities-and-roadmap.md) | **Source of truth** for tools, limitations, roadmap (see Product direction). |
| [final-target-architecture.md](final-target-architecture.md) | Historical target for multi-pass + KB (superseded as primary UX by agent). |
| [pipeline-runtime-flow.md](pipeline-runtime-flow.md) | **Legacy** pipeline stages, model roles, rules, status line. |
| [runtime-state-schema.md](runtime-state-schema.md) | **Agent** session/localStorage schema; legacy fields noted at end. |

### Policies and behavior

| Doc | Purpose |
|-----|---------|
| [final-disposition-policy.md](final-disposition-policy.md) | Disposition values and when Apply is enabled. |
| [final-result-policy.md](final-result-policy.md) | Result publication and fallback rules. |
| [chat-publication-policy.md](chat-publication-policy.md) | Final-only chat output. |
| [manual-apply-policy.md](manual-apply-policy.md) | Manual Apply only; when Apply is enabled. |
| [host-bridge-notes.md](host-bridge-notes.md) | Panel ↔ AE: **hostBridge** + agent tools; legacy Apply/target note. |

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
| [grounding-policy-by-stage.md](grounding-policy-by-stage.md) | How each pipeline stage uses KB projections. |

### Product direction (roadmap)

| Doc | Purpose |
|-----|---------|
| [capabilities-and-roadmap.md](capabilities-and-roadmap.md) | **Source of truth:** 25 agent tools, UI/API, limitations, roadmap, adding a tool (also linked from Architecture table). |
| [north-star-vision-agent.md](north-star-vision-agent.md) | Target motion assistant: local vision (Ollama), automated UI capture via **CEP + Node**, phases and file touchpoints; complements current architecture docs. |

### Operations and release

| Doc | Purpose |
|-----|---------|
| [runtime-diagnostics.md](runtime-diagnostics.md) | Diagnostics API and error categories. |
| [repository-validation.md](repository-validation.md) | How to run validate-repo and check-required-files. |
| [release-checklist.md](release-checklist.md) | Pre-release and deployment checklist. |
| [qa-test-plan.md](qa-test-plan.md) | Step-by-step QA scenarios. |
| [troubleshooting.md](troubleshooting.md) | Common issues and fixes. |

### Archived docs

| Location | Contents |
|----------|----------|
| [archive/](archive/) | Implementation reports, plans, analysis, QA matrix. See [archive/README.md](archive/README.md). |

## Where to add new docs

- **Current behavior, config, pipeline, policies, release, QA**: add or edit files in this folder (`docs/`) and link from the table above or from the root [README.md](../README.md).
- **One-off reports, stage reports, old plans, historical analysis**: add to [docs/archive/](archive/) in the appropriate subfolder (reports, plans, analysis, qa) and list in [archive/README.md](archive/README.md).
