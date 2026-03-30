# Схема runtime state и session (совместимая с текущими данными)

Краткое описание состояния приложения и формата сессии с учётом будущего поля pipeline. Цель — не ломать существующие сессии в localStorage и не требовать разрушающей миграции.

---

## 1. Глобальный state (в памяти, не весь персистится)

Текущий объект `state` в main.js:

- **sessions**: массив сессий (персистится).
- **activeSessionId**: id активной сессии (персистится).
- **nextSessionIndex**: счётчик для новых сессий (персистится).
- **isRequestInFlight**: флаг запроса (не персистится).
- **compSummary**: результат getActiveCompSummary (не персистится).
- **activeTarget**: выбранный layer/property (не персистится).
- **isCaptureInFlight**: идёт ли захват экрана (не персистится).
- **includeUiCaptureInNextSend**: флаг чекбокса «Include UI capture in next Send» (не персистится; позже может учитываться в prepare).
- **lastUiCapturePath** (на сессии): путь к последнему успешному PNG от **Capture full screen** или **Capture comp area**; сохраняется в **localStorage** вместе с сессией (только путь к файлу в temp, не base64). Новая попытка захвата, которая **завершилась ошибкой**, старый путь **не сбрасывает**.
- **lastUiCaptureError**: краткая ошибка последнего захвата (не персистится).

В localStorage через persistState() сохраняется только:

```json
{
  "sessions": [ ... ],
  "activeSessionId": "session-1",
  "nextSessionIndex": 2
}
```

---

## 2. Формат объекта сессии (существующие поля)

Каждый элемент `state.sessions[]` сегодня имеет вид:

- **id**: string (например, `"session-1"`).
- **title**: string (например, `"Session 1"`).
- **createdAt**: number (Date.now()).
- **updatedAt**: number (Date.now()).
- **model**: string (`"openai/gpt-oss-120b"` | `"Qwen/Qwen3-Coder-Next"`).
- **messages**: массив `{ role: "system" | "user" | "assistant", text: string }`. Первое сообщение обычно system с системным промптом.
- **latestExtractedExpression**: string | null — последнее успешно извлечённое выражение (до ---EXPLANATION---).
- **lastUiAnalysis**: string | null — краткий текст от локального Ollama по последнему захвату экрана (PNG); подмешивается в облачный pipeline только если включён чекбокс «Include UI capture in next Send». См. **docs/vision-grounding.md**.
- **lastFrameAnalysis**: string | null — краткий текст от Ollama по кадру композиции (**Analyze frame**); подмешивается в каждый следующий cloud Send, пока не очищено (Clear session / новая сессия).

Обратная совместимость: старые сохранённые сессии могут не содержать `latestExtractedExpression` (в старом коде оно уже есть); при отсутствии считать null. Остальные поля не удалять и не менять тип.

---

## 3. Опциональное поле session.pipeline (для multi-pass)

Для нового pipeline предлагается **одно опциональное** поле в объекте сессии:

- **pipeline**: объект или null/отсутствует.

Рекомендуемая минимальная структура (сокращённая, только для нужд отображения статуса и отката, без хранения полной истории проходов в сессии):

```ts
// Псевдо-тип для документации
session.pipeline?: {
  lastRun?: number;        // timestamp последнего запуска pipeline (опционально)
  lastStage?: string;     // последняя стадия: 'generate' | 'validate1' | 'validate2' | 'repair' | 'done' (опционально)
} | null;
```

Правила:

- При загрузке сессии: если `session.pipeline` отсутствует или не объект — не обращать внимания, считать сессию обычной (single-pass или legacy).
- При сохранении: не удалять существующие поля; добавлять или обновлять `pipeline` только при использовании нового pipeline. Старые сессии при открытии не требуют записи `pipeline`.
- В transcript и в messages **не** дублировать промежуточные ответы моделей; в messages по-прежнему только user/assistant/system в текущем формате. Поле pipeline нужно только для отладки или будущих расширений (например, отображение «последняя стадия»), не для восстановления полной истории проходов.

Без разрушающей миграции: старые данные остаются валидными; новые поля только добавляются при работе нового кода.

---

## 4. Что не хранить в session

- Полная история всех проходов (generate, validate-1, validate-2, repair) — не сохранять в messages и не в session, чтобы не раздувать localStorage и не менять формат transcript. Пользователь видит только финальный ответ.
- Промежуточные выражения по стадиям — не записывать в session; достаточно финального результата в latestExtractedExpression.
- **Скриншоты и base64 изображений** — не персистить в localStorage. Текстовые поля вроде `lastFrameAnalysis` / `lastUiAnalysis` (когда появятся) — только короткий текст, опционально; предпочтительно держать анализ в памяти до явного решения о формате сессии.

---

## 5. Будущие поля сессии (vision / pipeline)

По [north-star-vision-agent.md](north-star-vision-agent.md) позже могут появиться **опциональные** строковые поля на объекте сессии, например `lastFrameAnalysis`, `lastUiAnalysis` (только текст, без изображений). Старые сохранённые сессии без этих полей остаются валидными; при отсутствии полей считать `null`/пусто.
