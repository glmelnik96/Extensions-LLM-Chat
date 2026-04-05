# Общий контекст проекта — Extensions LLM Chat

> **Устарело для текущего продукта.** Репозиторий переведён на **AE Motion Agent** (см. **docs/capabilities-and-roadmap.md**, **docs/final-architecture.md**). Ниже — инварианты эпохи **multi-pass Copilot**; используй только если восстанавливаешь старый flow по запросу.

Используй этот блок как общий контекст при выполнении этапов 2–4 (исторический план в **docs/legacy-archive-on-user-request-only/planning/**).

---

## Репозиторий

- CEP-расширение для Adobe After Effects: панель чата с облачной LLM для генерации и применения After Effects expressions.
- Путь: `.../Adobe/CEP/extensions/Extensions LLM Chat/`.
- Ключевые файлы: main.js (логика, state, UI, LLM, extraction, Apply), index.html, styles.css, systemPrompt.js, host/index.jsx, lib/CSInterface.js, CSXS/manifest.xml. Доп. модули: aeDocsIndex.js, aeDocsRetrieval.js, aePromptContext.js, aeResponseValidation.js.

---

## Инварианты (не ломать)

- Панель запускается; Send даёт один ответ в чат (формат: expression + ---EXPLANATION--- + ---NOTES---).
- Сессии в localStorage: id, title, createdAt, updatedAt, model, messages, latestExtractedExpression; обратная совместимость со старыми сохранёнными сессиями.
- Выбор target layer/property (@, dropdowns, getResolvedTarget()) работает для контекста промпта и для Apply.
- Apply Expression — только ручная кнопка; применяет session.latestExtractedExpression к выбранному target через host extensionsLlmChat_applyExpressionToTarget(...).
- Host: CSInterface.evalScript, ExtendScript в host/index.jsx; протокол applyExpressionToTarget(layerIndex, layerId, propertyPath, expressionText) и getActiveCompSummary() не менять.
- isRequestInFlight, updateSendEnabled(), updateApplyExpressionEnabled(), статусная строка — не ломать логику блокировки и отображения.

---

## Текущий flow (кратко)

- handleSend → push user message → isRequestInFlight = true → callOllamaForSession(session) → один fetch к CLOUD_API_CHAT_COMPLETIONS → ответ → extractExpressionFromResponse → session.latestExtractedExpression → один assistant message в transcript → finally: isRequestInFlight = false, updateSendEnabled, updateApplyExpressionEnabled.
- Apply: handleApplyExpression читает latestExtractedExpression и getResolvedTarget(), вызывает evalScript(applyExpressionToTarget(...)), результат — system message в чат.

---

## Целевая архитектура (после этапов 2–4)

- Оркестрация в main.js; один последовательный async pipeline: generate → validate-1 → validate-2 → при необходимости repair. gpt-oss-120b — generator + validators; Qwen — repair. Пользователь видит только финальный результат в чате; стадии — в UI status. Apply только manual. Локальная knowledge base с тремя проекциями (generator / validator / repair). См. **docs/final-target-architecture.md** (stub) и **docs/legacy-archive-on-user-request-only/planning/plan-staged-implementation-stages-2-through-4.md**.

---

## Риски

См. **docs/legacy-archive-on-user-request-only/analysis-notes/analysis-risk-register-pipeline-implementation.md**: поломка handleSend, target/getResolvedTarget, совместимость сессий, конфликт с latestExtractedExpression, поломка Apply, нарушение isRequestInFlight и статусной строки. Все изменения — с учётом реестра рисков.
