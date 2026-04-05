# Текущий анализ репозитория — Extensions LLM Chat

Документ фиксирует фактическую архитектуру проекта по состоянию кодовой базы (без внедрения нового multi-pass pipeline).

---

## 1. Карта файлов

| Файл | Назначение |
|------|------------|
| **main.js** | Единый центр логики: state (sessions, activeSessionId, nextSessionIndex, isRequestInFlight, compSummary, activeTarget), persistence (localStorage), UI (renderSessions, renderTranscript, status), выбор модели, вызов облачного API (callOllamaForSession), извлечение expression (extractExpressionFromResponse, sanitizeExpression), Apply (handleApplyExpression, getResolvedTarget), target layer/property (refreshActiveCompFromHost, handleTargetLayerChange, handleTargetPropertyChange). ~1429 строк. |
| **index.html** | Разметка панели: sidebar (session list, New, model select, Rename, Clear, Clear All), chat transcript, status line, target bar (@, layer/property dropdowns, target summary), input + Send + Apply Expression. Подключение скриптов: systemPrompt.js → aeDocsIndex → aeDocsRetrieval → aePromptContext → aeResponseValidation → lib/CSInterface.js → main.js. |
| **styles.css** | Стили панели: panel-root, sidebar, session-list, chat-area, status-line, target-bar, chat-input, кнопки, сообщения (user/assistant/system), expression block, model-status. |
| **systemPrompt.js** | Глобальная константа `EXTENSIONS_LLM_CHAT_SYSTEM_PROMPT`: инструкции для модели (AE 26.0, expression-only, формат ---EXPLANATION--- / ---NOTES---, русский ввод, документация [AFTER_EFFECTS_EXPRESSION_DOCS]). |
| **host/index.jsx** | ExtendScript-хост: `extensionsLlmChat_resolveActiveComp()`, `extensionsLlmChat_getActiveCompSummary()`, `extensionsLlmChat_applyExpression(expressionText)`, `extensionsLlmChat_applyExpressionToTarget(layerIndex, layerId, propertyPath, expressionText)`, `resultToJson()`. Вызывается через CSInterface.evalScript (buildHostEvalScript + getHostScriptContent). |
| **lib/CSInterface.js** | Официальный Adobe CEP bridge (внешняя зависимость). |
| **CSXS/manifest.xml** | CEP-манифест: Host AEFT [18.0,99.9], MainPath index.html, ScriptPath host/index.jsx, Panel 400×600. |
| **aeDocsIndex.js** | Локальный индекс документации AE: массив `AE_DOCS_INDEX` с объектами { id, category, title, aeVersion, keywords, apis, text }. Используется aeDocsRetrieval. |
| **aeDocsRetrieval.js** | Функция `AE_DOCS_RETRIEVE_RELEVANT(queryText, { maxSnippets })`: keyword/token overlap + русские категории, возвращает { snippets, debug }. |
| **aePromptContext.js** | `AE_BUILD_DOCS_CONTEXT_MESSAGE(userText, retrievalResult)`: собирает блок [AFTER_EFFECTS_EXPRESSION_DOCS] для вставки в system message. |
| **aeResponseValidation.js** | `AE_ANNOTATE_ASSISTANT_WITH_VALIDATION(assistantText, retrievalResult)`: проверка expression на разрешённые/запрещённые идентификаторы, добавление ---NOTES--- при проблемах. |
| **README.md** | Описание панели, flow, установки, CSInterface, сессий, Apply, troubleshooting. |

---

## 2. Карта основных функций (main.js)

- **State & persistence**: `state`, `persistState()`, `loadState()`, `STORAGE_KEY = 'extensions-llm-chat-state'`.
- **Session**: `createSession()`, `getActiveSession()`, `setActiveSession()`, `ensureInitialSession()`, `handleNewSession`, `handleRenameSession`, `handleClearSession`, `handleClearAll`.
- **Target**: `getResolvedTarget()`, `state.compSummary`, `state.activeTarget`, `refreshActiveCompFromHost()`, `handleTargetRefresh`, `handleTargetLayerChange`, `handleTargetPropertyChange`, `updateTargetSummary()`, `updatePromptTargetLine()`.
- **Host bridge**: `buildHostEvalScript(bodyExpression, hostScriptContent)`, `getHostScriptContent(done)`.
- **Send flow**: `handleSend()` → `callOllamaForSession(session)` (один fetch к CLOUD_API_CHAT_COMPLETIONS), без вызова `callOllamaWithFallback` при ошибке (fallback определён, но не вызывается).
- **LLM**: `callOllamaForSession(session)` — сбор payload (messages + docs context + target instruction), fetch, парсинг choices[0].message.content, опционально ANNOTATE_WITH_VALIDATION, push assistant message, extractExpressionFromResponse → session.latestExtractedExpression.
- **Extraction**: `extractExpressionFromResponse(text)` (разделитель ---EXPLANATION---), `sanitizeExpression(expr)` (code fences, разделители, метки).
- **Apply**: `handleApplyExpression()` — берёт session.latestExtractedExpression, getResolvedTarget(), вызывает extensionsLlmChat_applyExpressionToTarget(...) через evalScript; результат парсится и показывается как system message. Есть также `autoApplyExpressionForTarget(session, expressionText)` — не вызывается из текущего handleSend (ручной Apply только).
- **UI**: `renderSessions()`, `renderTranscript()`, `renderAssistantMessage()`, `updateSendEnabled()`, `updateApplyExpressionEnabled()`, `updateStatus()`, `updateModelStatus()`, `updateModelSelector()`, `updateTargetSummary()`, `bindEvents()`.
- **Init**: `init()` — привязка DOM, loadState/ensureInitialSession, renderSessions/renderTranscript, refreshActiveCompFromHost, beforeunload/pagehide → persistState.

---

## 3. Карта потоков данных

1. **UI → Send**: User input → handleSend → push user message → isRequestInFlight = true → updateSendEnabled/updateStatus/updateModelStatus → callOllamaForSession(session).
2. **callOllamaForSession**: lastUserMessage + getResolvedTarget() → retrievalQueryText; RETRIEVE_DOCS(retrievalQueryText) → docsRetrieval; payloadMessages = session.messages с инъекцией system message (BUILD_DOCS_CONTEXT_MESSAGE) и target instruction перед последним user message; fetch CLOUD_API_CHAT_COMPLETIONS (session.model, DEFAULT_MODEL = openai/gpt-oss-120b); ответ → assistantText → ANNOTATE_WITH_VALIDATION (если есть) → push assistant message → extractExpressionFromResponse → session.latestExtractedExpression или null + system message «Nothing was applied» → renderTranscript, persistState, finally: isRequestInFlight = false, updateSendEnabled, updateApplyExpressionEnabled, updateStatus('Готово.').
3. **Target context**: state.compSummary из refreshActiveCompFromHost (extensionsLlmChat_getActiveCompSummary); state.activeTarget из выбора layer/property в UI; getResolvedTarget() используется в callOllamaForSession (target instruction + docs query) и в handleApplyExpression (параметры для applyExpressionToTarget).
4. **Apply path**: handleApplyExpression → session.latestExtractedExpression + getResolvedTarget() → buildHostEvalScript('extensionsLlmChat_applyExpressionToTarget(...)') → CSInterface.evalScript → host возвращает JSON { ok, message } → system message в чат.
5. **Persistence**: persistState() пишет в localStorage: { sessions, activeSessionId, nextSessionIndex }. loadState() восстанавливает state.sessions и activeSessionId/nextSessionIndex. Сессии содержат id, title, createdAt, updatedAt, model, messages, latestExtractedExpression (в коде есть, в комментарии в начале main.js в модели сессии не упомянут — фактически хранится).

---

## 4. Зависимости: UI ↔ LLM ↔ target ↔ apply

- **UI**: Send блокируется по isRequestInFlight; Apply Expression включается при session.latestExtractedExpression && !isRequestInFlight. Status line и model status обновляются в процессе запроса и в finally.
- **LLM**: Один endpoint, одна модель на сессию (session.model). Docs context и target instruction зависят от getResolvedTarget() и последнего user message.
- **Target**: compSummary и activeTarget не персистятся (только в state в памяти); при перезагрузке панели нужно снова нажать @ для обновления слоёв. getResolvedTarget() используется и для промпта, и для Apply.
- **Apply**: Всегда manual; использует только latestExtractedExpression и getResolvedTarget(); протокол host — applyExpressionToTarget(layerIndex, layerId, propertyPath, expressionText).

---

## 5. Текущие слабые места main.js для внедрения multi-pass pipeline

1. **Монолитность**: Вся оркестрация в одном файле; нет выделенного слоя «pipeline» (generator → validator → repair), поэтому добавление нескольких проходов потребует либо разбиения callOllamaForSession на этапы, либо введения отдельного модуля/объекта pipeline с сохранением обратной совместимости.
2. **Один путь успеха**: Успех определяется одним ответом модели и одним вызовом extractExpressionFromResponse; нет понятий «черновик», «валидация», «репар». Состояние сессии не различает «single-pass result» и «multi-pass result».
3. **callOllamaWithFallback не вызывается**: Код fallback на FALLBACK_MODEL есть, но handleSend при ошибке только добавляет system message с ошибкой и не вызывает callOllamaWithFallback; при желании использовать Qwen как repair-model эту функцию можно переиспользовать или заменить на явный repair-pass.
4. **latestExtractedExpression — единственная точка входа для Apply**: Любой новый pipeline должен в конце записывать финальное выражение в session.latestExtractedExpression, иначе Apply перестанет работать без изменения handleApplyExpression.
5. **Формат сообщений**: В чат добавляется один assistant message с полным текстом (expression + ---EXPLANATION--- + ---NOTES---). Для multi-pass нужно показывать пользователю только финальный результат, а промежуточные стадии — через status line, не засоряя messages.
6. **Docs retrieval один на запрос**: Сейчас один вызов RETRIEVE_DOCS для последнего user message. Для трёх проекций (generator / validator / repair) понадобится либо три вызова с разными запросами/ролями, либо один корпус с разными «проекциями» без изменения контракта текущих модулей.
7. **Нет явного pipeline state в session**: Поля session.pipeline или session.pipelineHistory нет; при добавлении нужно сохранять обратную совместимость со старыми сессиями без pipeline.

---

## 6. Инварианты рабочего проекта (не ломать)

- Панель запускается (index.html + main.js + CSInterface + host path).
- Send работает: handleSend → callOllamaForSession → один запрос к облаку → один assistant message + извлечение expression в latestExtractedExpression.
- Сессии открываются и сохраняются в текущем формате (localStorage, sessions[].id/title/createdAt/updatedAt/model/messages/latestExtractedExpression) с обратной совместимостью.
- Выбор target layer/property работает: @ → refreshActiveCompFromHost, dropdowns и state.activeTarget, getResolvedTarget() для промпта и Apply.
- Apply Expression остаётся только ручным; кнопка активна при наличии latestExtractedExpression и без isRequestInFlight.
- Host-side интеграция через CSInterface.evalScript и ExtendScript (applyExpressionToTarget, getActiveCompSummary) не повреждена.
- Формат ответа модели: выражение до ---EXPLANATION---, затем буллеты и опционально ---NOTES---; extractExpressionFromResponse и sanitizeExpression продолжают корректно извлекать одно выражение для Apply.
