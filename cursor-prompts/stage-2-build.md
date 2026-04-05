# Промпт этапа 2: Инфраструктурный рефакторинг и каркас pipeline

**Назначение**: Задать контекст и задачи для безопасного рефакторинга кода и введения каркаса pipeline без изменения пользовательского поведения. Использовать вместе с shared-project-context.md и docs/legacy-archive-on-user-request-only/planning/plan-staged-implementation-stages-2-through-4.md (этап 2).

---

## Контекст

- Этап 1 (аудит) выполнен; документация в docs/ создана.
- Цель этапа 2: выделить вызов LLM и сборку сообщений в переиспользуемые единицы и ввести единую точку входа «pipeline», внутри которой пока выполняется текущий single-pass flow. Поведение для пользователя не меняется: один Send → один ответ в чат → Apply по кнопке.

---

## Задачи (кратко)

1. Выделить из main.js логику вызова облачной модели (и при необходимости сборки messages/docs/target) в функцию или модуль, вызываемый с разными параметрами (например, модель, список сообщений). Сохранить текущее поведение вызова (один запрос на Send).
2. Ввести каркас pipeline: например, функция runPipeline(session) или runSinglePassPipeline(session), внутри которой выполняется текущая последовательность: сбор сообщений + docs + target instruction → один вызов LLM → обработка ответа → extractExpressionFromResponse → session.latestExtractedExpression + один assistant message. handleSend вызывать только этот каркас.
3. Не менять: формат сессии в localStorage, handleApplyExpression, getResolvedTarget(), refreshActiveCompFromHost, isRequestInFlight и обновление кнопок/статуса. Не удалять callOllamaForSession до тех пор, пока его поведение не перенесено в каркас и проверено.
4. Definition of done: после изменений сценарий «Send → один ответ → Apply» работает идентично текущему; код готов к подстановке нескольких шагов (generate/validate/repair) на этапе 3.

---

## Что здесь не делаем

- Не добавляем multi-pass (несколько вызовов моделей за один Send).
- Не меняем вывод в чат (один assistant message) и не меняем статусную строку по стадиям.
- Не подключаем новые проекции knowledge base; docs используются как сейчас (один retrieval на запрос).

*(Ниже при необходимости можно добавить конкретные acceptance criteria и ссылки на строки main.js для рефакторинга.)*
