# Cursor Prompts — Библиотека промптов по этапам

**Scope:** Developer-only. These are Cursor (or similar) workflow prompts for implementing **historical stages 2–4** (multi-pass pipeline + KB). They are **not** the runtime prompt source: runtime agent prompts are in **agentSystemPrompt.js** / **toolRegistry.js**; legacy Copilot prompts in **prompt-library/**. Исторические планы и отчёты перенесены в **`docs/legacy-archive-on-user-request-only/`** — открывайте эту папку только при явной работе с legacy.

Эта папка содержит каркас промптов для поэтапной сборки multi-pass pipeline и knowledge base. Промпты предназначены для использования в Cursor при выполнении этапов 2–4 из **[docs/legacy-archive-on-user-request-only/planning/plan-staged-implementation-stages-2-through-4.md](../docs/legacy-archive-on-user-request-only/planning/plan-staged-implementation-stages-2-through-4.md)**.

---

## Содержимое

- **shared-project-context.md** — общий контекст проекта (устаревающий; в репозитории сейчас **AE Motion Agent** — см. **docs/capabilities-and-roadmap.md**).
- **stage-2-build.md**, **stage-3-build.md**, **stage-4-build.md** — промпты этапов 2–4.

В этапе 2 в репозитории добавлены каркасы **prompt-library/** и **knowledge-base/** — см. **[docs/legacy-archive-on-user-request-only/implementation-reports/report-stage-02-infrastructure-refactor.md](../docs/legacy-archive-on-user-request-only/implementation-reports/report-stage-02-infrastructure-refactor.md)**.

---

## Как использовать (legacy workflow)

1. Прочитать **[docs/legacy-archive-on-user-request-only/analysis-notes/analysis-repo-snapshot-pre-multipass.md](../docs/legacy-archive-on-user-request-only/analysis-notes/analysis-repo-snapshot-pre-multipass.md)**, **docs/final-target-architecture.md** (stub), план этапов и **[analysis-risk-register-pipeline-implementation.md](../docs/legacy-archive-on-user-request-only/analysis-notes/analysis-risk-register-pipeline-implementation.md)**.
2. В диалог Cursor подставить **shared-project-context.md** и соответствующий **stage-*-build.md**.
