# QA test plan (AE Motion Agent)

Краткий чеклист для **текущей** панели. Расширенные сценарии и исторический план Copilot — только по явному запросу, в архиве: **[legacy-archive-on-user-request-only/qa-testing/](legacy-archive-on-user-request-only/qa-testing/)** (см. [README](legacy-archive-on-user-request-only/README.md) архива).

---

## 1. Запуск и конфиг

1. Открыть панель в After Effects — без ошибок в консоли CEP, строка статуса **Ready**.
2. Без ключа Cloud.ru: **Send** с облачной моделью → сообщение о `secrets.local.js`, без падения.
3. С валидным ключом: **Send** доступен, запрос уходит.

---

## 2. Сессии

4. **New** — новая сессия в списке, чат пустой (или только системные сообщения после действий).
5. Переключение между двумя сессиями — разный transcript и выбранная модель.
6. **Rename**, **Clear**, **Clear All** (с подтверждением) — ожидаемое поведение, после перезагрузки панели состояние восстанавливается из `localStorage` (ключ `ae-motion-agent-state`).

---

## 3. Агент и инструменты

7. Простой запрос (например добавить текстовый слой или изменить opacity) — в ответе есть карточки **tool calls** и итоговый текст агента; в композиции видны изменения.
8. **Undo** в панели — откат последней операции в AE (в разумных пределах undo AE).
9. Ошибка инструмента (намеренно неверный expression) — в карточке виден `error` / сообщение хоста; агент не ломает панель.

---

## 4. Модели

10. Облачная модель из списка — успешный цикл.
11. В текущем UI доступны только Cloud.ru модели; отсутствие Ollama не влияет на чат-цикл.

---

## 5. Deterministic preset toolbar

12. Клик по кнопке пресета открывает список (`Fade/Pop/Slide`); выбор пункта меняет название кнопки.
13. Подписи полей отображаются корректно: `Duration (s)`, `Delay (s)`, `Intensity` (для Pop), `Amplitude (px)` (для Slide); для Fade третье поле отключено.
14. `Apply preset` на выделенных слоях применяет соответствующий deterministic tool (`apply_fade_preset` / `apply_pop_preset` / `apply_slide_preset`) без запуска LLM-цикла.
15. Без выделенных слоев `Apply preset` возвращает понятную ошибку и не ломает UI.

---

## Дополнительно

- Матрица pass/fail и длинный план старого UI: [legacy-archive-on-user-request-only/qa-testing/qa-manual-test-matrix-compact-pass-fail.md](legacy-archive-on-user-request-only/qa-testing/qa-manual-test-matrix-compact-pass-fail.md), [qa-legacy-full-test-plan-copilot-pipeline-ui.md](legacy-archive-on-user-request-only/qa-testing/qa-legacy-full-test-plan-copilot-pipeline-ui.md).
- Детальный чеклист v2 по агенту: [qa-motion-agent-manual-checklist-v2.md](legacy-archive-on-user-request-only/qa-testing/qa-motion-agent-manual-checklist-v2.md).
