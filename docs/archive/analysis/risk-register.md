# Реестр рисков — Внедрение Multi-pass pipeline

Опасные места при изменении кода. При рефакторинге и добавлении pipeline эти точки нужно трогать с особой осторожностью или обходить без изменения контракта.

---

## 1. Поломка handleSend

**Риск**: Изменение порядка операций, условий или замены callOllamaForSession на несовместимый flow приведёт к тому, что Send перестанет возвращать ответ или корректно обновлять чат.

**Где**: main.js — функция handleSend (приблизительно строки 653–696). Критично: push user message → isRequestInFlight = true → вызов LLM → обработка ответа → push assistant message → extractExpressionFromResponse → latestExtractedExpression → finally (isRequestInFlight = false, updateSendEnabled, updateApplyExpressionEnabled).

**Митигация**: Рефакторинг вводить через прослойку: handleSend вызывает только «runPipeline(session)» или аналог; внутри прослойки сначала выполнять текущий single-pass, проверять тестами/ручной проверкой перед добавлением multi-pass.

---

## 2. Поломка target selection и getResolvedTarget

**Риск**: Изменение state.compSummary, state.activeTarget или логики getResolvedTarget() приведёт к неверному контексту в промпте (target instruction) или к ошибке Apply (неверный layer/property).

**Где**: main.js — getResolvedTarget (строки ~283–304), handleTargetLayerChange, handleTargetPropertyChange, refreshActiveCompFromHost, обновление targetLayerSelectEl/targetPropertySelectEl и state.activeTarget. Host: extensionsLlmChat_getActiveCompSummary, extensionsLlmChat_applyExpressionToTarget(layerIndex, layerId, propertyPath, expressionText).

**Митигация**: Не менять сигнатуру getResolvedTarget() и структуру возвращаемого объекта (compName, layerIndex, layerId, layerName, propertyPath, propertyDisplayName). Не менять способ построения scriptBody для applyExpressionToTarget. При добавлении pipeline использовать getResolvedTarget() только на чтение в начале запроса и в handleApplyExpression.

---

## 3. Потеря совместимости со старыми session objects

**Риск**: Старые сессии в localStorage не содержат полей pipeline (или новых полей). Чтение таких сессий с обязательной проверкой новых полей или миграция «на месте» с перезаписью формата может сломать загрузку или отображение истории.

**Где**: loadState(), persistState(), везде, где читаются state.sessions[].*; createSession(), renderTranscript(), renderSessions().

**Митигация**: Все новые поля в session делать опциональными. При чтении session.pipeline проверять наличие; если нет — считать сессию «legacy», вести себя как single-pass. Не удалять и не переименовывать существующие поля (id, title, createdAt, updatedAt, model, messages, latestExtractedExpression). См. [../../runtime-state-schema.md](../../runtime-state-schema.md).

---

## 4. Конфликт нового пайплайна с latestExtractedExpression

**Риск**: В multi-pass финальное выражение должно по-прежнему попадать в session.latestExtractedExpression. Если pipeline будет писать в другое поле или в промежуточные сообщения без финальной записи в latestExtractedExpression, кнопка Apply перестанет работать или применит устаревшее выражение.

**Где**: main.js — присвоение session.latestExtractedExpression (в callOllamaForSession после extractExpressionFromResponse); updateApplyExpressionEnabled() (проверяет session.latestExtractedExpression); handleApplyExpression() (читает session.latestExtractedExpression).

**Митигация**: В конце любого варианта pipeline (single- или multi-pass) всегда выполнять: извлечь финальный текст ответа → extractExpressionFromResponse → присвоить session.latestExtractedExpression (или null при отсутствии выражения). Не добавлять «второй» источник выражения для Apply.

---

## 5. Поломка ручного Apply

**Риск**: Изменение handleApplyExpression или протокола с host приведёт к тому, что выражение не применится к выбранному свойству или вернётся некорректный статус.

**Где**: main.js — handleApplyExpression (строки ~698–764): чтение latestExtractedExpression, getResolvedTarget(), buildHostEvalScript с extensionsLlmChat_applyExpressionToTarget(…), evalScript, парсинг JSON, добавление system message. Host: index.jsx — extensionsLlmChat_applyExpressionToTarget(layerIndex, layerId, propertyPath, expressionText), resultToJson().

**Митигация**: Не менять сигнатуру applyExpressionToTarget и формат возвращаемого JSON (ok, message). Не вводить auto-apply; не вызывать apply из pipeline по успеху. Apply только по клику на кнопку.

---

## 6. Нарушение UI-логики isRequestInFlight и статусной строки

**Риск**: Если isRequestInFlight не выставляется в true на время всего multi-pass или сбрасывается раньше времени, пользователь сможет отправить второй запрос во время первого или кнопки будут в некорректном состоянии. Если статусная строка не обновляется по стадиям, пользователь не увидит прогресс pipeline.

**Где**: main.js — state.isRequestInFlight; updateSendEnabled(), updateApplyExpressionEnabled(); updateStatus(), updateModelStatus(); блок finally в handleSend и эквивалент в будущем pipeline.

**Митигация**: В каркасе pipeline: в начале запроса установить isRequestInFlight = true и вызвать updateSendEnabled/updateApplyExpressionEnabled; на каждой стадии вызывать updateStatus(…); в конце (success или error) в finally сбросить isRequestInFlight = false и снова обновить кнопки и статус. Не делать асинхронные ветки, которые забывают сбросить isRequestInFlight.
