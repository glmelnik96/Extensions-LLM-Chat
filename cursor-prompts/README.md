# Cursor Prompts — Библиотека промптов по этапам

**Scope:** Developer-only. These are Cursor (or similar) workflow prompts for implementing stages 2–4. They are **not** the runtime prompt source: runtime prompts are in **prompt-library/** and **systemPrompt.js**. Do not confuse this folder with the extension’s prompt library.

Эта папка содержит каркас промптов для поэтапной сборки multi-pass pipeline и knowledge base в проекте Extensions LLM Chat. Промпты предназначены для использования в Cursor (или аналоге) при выполнении этапов 2–4 из docs/archive/plans/staged-implementation-plan.md.

---

## Содержимое

- **shared-project-context.md** — общий контекст проекта: репозиторий, инварианты, ключевые файлы и ограничения. Подключать к любому этапу.
- **stage-2-build.md** — промпт для этапа 2: инфраструктурный рефакторинг и каркас pipeline без смены поведения.
- **stage-3-build.md** — промпт для этапа 3: внедрение multi-pass (generate → validate-1 → validate-2 → repair), UI status по стадиям, финальный результат в чат.
- **stage-4-build.md** — промпт для этапа 4: подключение локальной knowledge base и трёх проекций (generator / validator / repair).

На текущем шаге (этап 1) **окончательные production-промпты для этапов 2–4 не заполнены** — только структура и назначение каждого файла. Общий контекст в shared-project-context.md заполнен по факту репозитория.

В этапе 2 в репозитории добавлены каркасы **prompt-library/** (generator, validator, repair) и **knowledge-base/** — см. их README и docs/archive/reports/stage-2-refactor-report.md.

---

## Как использовать

1. Перед началом этапа 2 (или 3, 4) прочитать docs/archive/analysis/current-repo-analysis.md, docs/final-target-architecture.md, docs/archive/plans/staged-implementation-plan.md и docs/archive/analysis/risk-register.md.
2. В диалог Cursor подставить содержимое shared-project-context.md и соответствующего stage-*-build.md.
3. Дополнить stage-*-build.md конкретными задачами и acceptance criteria при необходимости; затем выполнять изменения по плану этапа, не нарушая инвариантов из shared-project-context.md.
