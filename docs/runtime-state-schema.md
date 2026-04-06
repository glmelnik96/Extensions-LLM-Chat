# Схема runtime state и session (AE Motion Agent)

Описание состояния панели и формата сессии для **текущей** реализации (**main.js** + agent loop). Историческое описание multi-pass pipeline и полей вроде **latestExtractedExpression** см. в конце документа.

**Точка истины по продукту:** [capabilities-and-roadmap.md](capabilities-and-roadmap.md).

---

## 1. Глобальный `state` (в памяти)

В **main.js** используется объект примерно следующего вида:

- **sessions** — массив сессий (персистится).
- **activeSessionId** — id активной сессии (персистится).
- **nextSessionIndex** — счётчик для заголовков новых чатов (персистится).
- **isRequestInFlight** — идёт ли запрос агента (не персистится).
- **lastModelStatus** — последний статус для строки `model-status` (не персистится).

В **localStorage** через `persistState()` сохраняется:

```json
{
  "sessions": [ ... ],
  "activeSessionId": "session_…",
  "nextSessionIndex": 2
}
```

**Ключ localStorage:** `ae-motion-agent-state` (не старый ключ расширения «Extensions LLM Chat», если он остался у пользователя от прошлой версии — данные не мигрируются автоматически).

---

## 2. Формат сессии

Каждый элемент **sessions[]**:

| Поле | Тип | Описание |
|------|-----|----------|
| **id** | string | Уникальный id (например `session_…`). |
| **title** | string | Отображаемое имя («Chat 1», …). |
| **createdAt** | number | `Date.now()` при создании. |
| **updatedAt** | number | Обновляется при изменении сообщений. |
| **model** | string | Id модели, например `cloudru/Qwen/Qwen3-Coder-Next` или `ollama/llama3.2`. |
| **messages** | array | История чата (см. ниже). |

В **persistState** в хранилище попадают только перечисленные поля сессии (без временных полей UI).

---

## 3. Сообщения в `messages`

- **user:** `{ role: 'user', text: string }`
- **assistant:** `{ role: 'assistant', text: string, toolCalls?: array }`
  - **toolCalls[]** (после завершения шага агента): элементы с полями вроде **id**, **name**, **args**, **result**, **status** (`ok` | `error` | …) — для карточек в UI.
- **system:** `{ role: 'system', text: string }` — ошибки конфигурации, сеть и т.д.

Для API в **runAgentLoop** в **apiMessages** попадают **user** и текстовые **assistant** сообщения; системный промпт агента подмешивается отдельно.

---

## 4. Исторический контекст (multi-pass / Copilot)

Ранее документировались:

- поля **latestExtractedExpression**, **lastUiAnalysis**, **lastFrameAnalysis** на сессии;
- глобальные **compSummary**, **activeTarget**, флаги захвата экрана;
- опциональное **session.pipeline** (стадии generate / validate / repair).

В **текущем** UI агента эти поля **не используются** в **main.js** для Send/persist. Старые сохранённые JSON в localStorage с другим ключом или форматом панель не подхватывает как текущее состояние. Если восстанавливаете старый pipeline из кода, ориентируйтесь на историческую схему в git и на архивный документ **[legacy-pipeline-runtime-flow-stages-and-models.md](legacy-archive-on-user-request-only/multi-pass-copilot-legacy/legacy-pipeline-runtime-flow-stages-and-models.md)**.

---

## 5. Что не хранить

- Полные ответы сырого API и промежуточные «мысли» модели — не обязательно дублировать; в логе остаётся финальный assistant + toolCalls.
- Большие бинарные данные (PNG, base64) — не класть в **localStorage**; при появлении vision в агенте — только пути или краткий текст по политике продукта.
