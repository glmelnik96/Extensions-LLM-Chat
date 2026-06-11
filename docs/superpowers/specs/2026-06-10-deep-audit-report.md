# Глубокий аудит: точность и надёжность агента (2026-06-10)

Цель: значительно усилить точность работы агента как **editing-ассистента** для моушен-дизайна
(экспрешены, поиск/связывание слоёв, эффекты) — не генератора анимаций с нуля.

Методика: внутренний аудит кода (субагент) + исследование 6 shipped AE-MCP/AI-решений +
исследование GLM thinking-механики (официальные доки Z.ai, шаблон чата GLM-5.1, vLLM issues) +
**живые пробы на Cloud.ru GLM-5.1** (полные реплики агентного цикла с синтетическим хостом).

---

## 1. КРИТИЧЕСКОЕ — необходимо поправить

### P0-1. Cloud.ru streaming проглатывает tool_calls — агентный цикл сейчас сломан на 100%

**Доказано живой пробой (10/10 воспроизведений, thinking on и off):**
со `stream: true` + `tools` поток завершается `finish_reason: "tool_calls"`, но **ни один**
`delta.tool_calls` чанк не приходит (токены вызова видны только как скачок `completion_tokens`
в финальном чанке). Со `stream: false` тот же запрос возвращает `message.tool_calls` корректно
**каждый раз**. `system_fingerprint: vllm-0.22.0-tp8-ep-3925efab` — класс известных багов
стримингового glm-парсера vLLM (vllm#27703/#39614/#31319).

**Это корень инцидента юзера** («думал 5+ минут, слой создал, ответа в чат не вернул»):
- `agentToolLoop.js:115` — Case 1 срабатывает по `finish_reason === 'tool_calls'` **даже при
  пустом списке** tool_calls → в историю пушится пустое assistant-сообщение → выполняется 0
  тулов → цикл повторяется. Каждый ход = новый полный reasoning (минуты) на растущей истории.
- Финал: либо maxSteps(60), либо 300s-таймаут (`cloudChatTimeoutMs`) → catch-ветка
  `main.js:797` — и **toolCallLog теряется целиком** (см. P1-2).

**Фиксы:**
1. В агентном цикле использовать **non-streaming** вызовы (стриминг оставить только как
   прогресс-индикатор недоступен — взамен показывать elapsed-таймер; reasoning-стрим временно
   теряем). Альтернатива: стрим → детект (`finish_reason==='tool_calls' && tcArray.length===0`)
   → авто-ретрай non-streaming. Сегодня детект сработает на 100% ходов, т.е. двойная цена —
   поэтому на время серверного бага дефолт non-streaming, с конфиг-флагом `agentStreaming`.
2. Guard в `agentToolLoop.js`: Case 1 только при `tool_calls.length > 0`. Пустой список при
   `finish_reason='tool_calls'` = серверная аномалия → ретрай хода (1 раз), потом ошибка с
   внятным сообщением.
3. Тикет в Cloud.ru со ссылкой на vllm#39614 и фингерпринтом деплоя.

### P0-2. Пустой финальный ответ рендерится как ничто

- `agentToolLoop.js:138` — `content: assistantMsg.content || ''` проходит насквозь;
- `main.js:206` — `if (msg.text)` молча пропускает пустой текст;
- В промпте **нет правила «всегда заканчивай видимым ответом»** (строка 172 лишь описывает
  формат, но не обязывает).

Проба подтвердила: с thinking ON весь «план» уходит в reasoning-канал, `content` первого хода
пуст — если цикл умирает, юзер не видит вообще ничего.

**Фиксы:** (a) в `agentToolLoop.js` при пустом content на финальном шаге синтезировать сводку
из toolCallLog («Выполнено N операций: …»); (b) правило в промпт: «ВСЕГДА завершай ход видимым
текстом-сводкой»; (c) в `renderTranscript` для assistant-сообщения с тулами но без текста
показывать хотя бы счётчик операций.

### P0-3. На timeout/error выполненная работа исчезает из чата и из контекста модели

`main.js:797-806`: catch пушит только `Error: …` — **toolCallLog не сохраняется**. Слои уже
созданы в AE, но: юзер не видит карточек выполненных тулов, а следующий запрос юзера уйдёт в
модель **без записи о выполненных операциях** → модель работает по устаревшему представлению.

**Фикс:** прокидывать partial toolCallLog в reject (custom error с полем) или собирать его
через onToolCall в state — и в catch пушить assistant-сообщение с toolCalls + system-ошибку.

### P1-1. Thinking в агентном цикле не управляется

Факты (доки Z.ai + шаблон GLM-5.1 + пробы):
- Бюджета thinking у GLM **не существует** (только on/off через
  `chat_template_kwargs: {enable_thinking: false}`).
- Z.ai официально рекомендует **turn-level thinking** для агентов: ON для планирования,
  OFF для исполнительных ходов.
- Проба A (продакшен-реплика): один ход set_keyframes_batch = **67.9с, 13 556 символов
  reasoning, 5303 токена**. Проба B (thinking OFF): весь цикл 12 ходов = 94с суммарно,
  3.6× меньше completion-токенов, финальный ответ качественный.

**Фикс:** thinking OFF на всех ходах агентного цикла, кроме (опционально) первого
(планирование). Плюс client-side watchdog: если reasoning-стрим превысил N секунд/токенов —
abort + ретрай с `enable_thinking: false` (единственный заменитель бюджета).

### P1-2. Эхо reasoning в истории цикла идёт под неверным ключом

Шаблон чата GLM-5.1 ждёт `reasoning_content` на in-loop assistant-сообщениях (иначе вставляет
пустой `<think></think>` — модель теряет свою цепочку между tool-ходами; официальная
рекомендация Z.ai — возвращать его в рамках текущего цикла). Cloud.ru отдаёт поле `reasoning`,
и `agentToolLoop.js:119` пушит его как есть → сервер, вероятно, игнорирует.

**Фикс:** при push в `messages` переименовывать `reasoning` → `reasoning_content`.
(Между юзер-ходами — не передавать: шаблон сам стрипает, текущее поведение main.js корректно.)

### P1-3. Реплей истории сплющивает мульти-ходовой запуск в один мега-ход

`main.js:678-702`: все tool_calls целого запуска (N ходов) собираются в **одно**
assistant-сообщение + пачку tool-результатов. Парность id сохранена, но модель видит
искажённую структуру диалога (один ход с 20 вызовами вместо 8 ходов по 2-3). Может влиять
на качество продолжения сессии.

**Фикс:** хранить в session.messages по одному assistant-сообщению на каждый шаг цикла
(или хотя бы группировать по step).

---

## 2. Несоответствия миссии — про инструменты

Миссия: ассистент для экспрешенов / связывания слоёв / эффектов. Сейчас 47 тулов, из них
по миссии не хватает:

| # | Пробел | Решение (проверено в shipped-аналогах) |
|---|--------|----------------------------------------|
| 1 | **Нет property-link (pick-whip)** — связывание свойств слоёв = ядро миссии | `link_properties(from, to, with_offset)` — генерирует `thisComp.layer("A").transform.position` сам (ishu86/after-effects-mcp делает именно так) |
| 2 | **Нет list_available_effects** — в промпте захардкожено 9 matchName, остальное модель галлюцинирует | Тул-перечисление `app.effects` (matchName + displayName + category), как у TheLlamainator. Убивает главный фейл-режим apply_effect |
| 3 | **Нет библиотеки канонических экспрешенов** — модель каждый раз сочиняет bounce/overshoot | `search_expression_library`: ~30-50 проверенных сниппетов (Ebberts inertial bounce, overshoot, wiggle-семейство c posterizeTime/seedRandom, loopOut-паттерны, sourceRectAtTime text-box, valueAtTime-эхо, linear/ease remap, counters, marker-triggered). Параметры — сразу через Slider Controls (паттерн Good Boy Ninja) |
| 4 | **apply_expression не возвращает readback** | После применения возвращать `expressionError` + вычисленное значение свойства — бесплатный unit-test (паттерн «give the agent a check it can run», Klutz GPT/Atom делают так) |
| 5 | Текстовые аниматоры (range selectors, per-char) отсутствуют | Отдельный тул или хотя бы доки в промпте, что недоступно — чтобы агент не выдумывал пути |
| 6 | Промпт: «create animations from scratch» (`agentSystemPrompt.js:17`) | Переформулировать под editing-ассистента — влияет на склонность к гигантским самодеятельным билдам (и длинному thinking) |
| 7 | Ошибки экспрешенов: AE-строка без контекста | В результат добавлять сниппет выражения вокруг ошибки; ретрай-кап 2-3 на одно выражение, затем вопрос юзеру |

Дополнительно из чужих решений (опционально, [adapt]):
- **Чекпоинты в чате** (Atom): undo-группа на каждый мутирующий тул уже есть — добавить кнопку
  «Revert last run» (executeCommand(16) × lastMutatingToolCount уже реализовано как handleUndo ✓).
- **Версия AE в промпте** (`app.version` + expression engine type) — гардит ES6-в-Legacy ошибки.
- **Подтверждение деструктивных действий** (delete_layer, перезапись непустого экспрешена) —
  кнопка-подтверждение вместо авто-применения (паттерн jhd3197).

---

## 3. Данные живых проб (Cloud.ru GLM-5.1, 2026-06-10)

Запрос: «создай необычный эффект появления слова "привет", чтобы потом он прыгал из края в край кадра».
Полный продакшен-промпт + 47 тулов, синтетический хост.

| Сценарий | Ходов | Время | Reasoning, символов | Completion-токенов | Финальный ответ |
|---|---|---|---|---|---|
| **B: thinking OFF все ходы** | 12 | 94с | 0 | 2 201 | ✅ 879 зн., качественный |
| E: ON ход 0, OFF дальше | 14 (cap) | 147с | 414 | 2 456 | ❌ артефакт фейк-хоста* |
| C: thinking ON, echo reasoning_content | 14 (cap) | 128с | 6 687 | 4 995 | ❌ артефакт фейк-хоста* |
| **A: продакшен-реплика (thinking ON)** | 10 | 115с | **17 868** | **7 862** | ✅ 958 зн. |

\* Фейк-хост возвращал `layers: []` после успешного create_layer — модель сожгла все ходы на
перепроверку. Само по себе показательно: **противоречивые результаты тулов → агент уходит в
verify-цикл** вместо ответа. Реальный хост согласован, но это аргумент за качество readback.

Отдельные наблюдения:
- Один ход может стоить 68с и 13.5k символов reasoning (A, ход 3) — при длинной истории
  таймаут 300с на ход реален. Бюджета thinking у GLM нет — только off/watchdog.
- Стриминговая проба (до фикса методики): 10/10 ходов «проглочены» — см. P0-1.
- Сервер принимает и `reasoning_content`, и `reasoning` в input без ошибок.
- Скорость генерации плавает: 18-120 ток/с (нагрузка Cloud.ru).

---

## 4. План внедрения (по приоритету)

**Этап 1 — реанимация (необходимо):**
1. Non-streaming в агентном цикле + guard на пустые tool_calls + ретрай (P0-1)
2. Синтез финального ответа из toolCallLog при пустом content + правило в промпт (P0-2)
3. Сохранение toolCallLog при ошибке/таймауте (P0-3)

**Этап 2 — скорость и точность:**
4. enable_thinking: false для исполнительных ходов (+ ON для первого хода — конфиг-флаг) (P1-1)
5. reasoning → reasoning_content при эхо в цикле (P1-2)
6. Readback в apply_expression/_batch (expressionError + value) (#4 §2)

**Этап 3 — миссия:**
7. link_properties (pick-whip) тул
8. list_available_effects тул
9. search_expression_library (канон ~30-50 сниппетов, Slider Controls)
10. Промпт: editing-ассистент вместо «from scratch»; версия AE/engine в контекст
11. Пошаговая структура истории вместо мега-хода (P1-3)

**Параллельно:** тикет в Cloud.ru (vllm#39614, fingerprint vllm-0.22.0-tp8-ep-3925efab);
после их апдейта — перепроверить стриминг пробой и вернуть live-reasoning UI.

---

## 5. Этап 1 — РЕАЛИЗОВАН (2026-06-10)

| Фикс | Файл | Что сделано |
|---|---|---|
| P0-1 | agentToolLoop.js | Streaming теперь opt-in (`options.streaming === true`); Case 1 только при реально доставленных tool_calls; пустой `finish_reason=tool_calls` → ретрай того же шага ×2, затем громкая ошибка с сводкой выполненного |
| P0-1 | main.js, config/example.config.js | Конфиг-флаг `agentStreaming` (default false), причина задокументирована в конфиге |
| P0-2 | agentToolLoop.js | Пустой финальный content → синтез сводки `summarizeToolCallLog()` («Done — N tool calls: …»); пустой ответ без тулов → плейсхолдер |
| P0-2 | agentSystemPrompt.js | Правило #10: «ALWAYS end with a visible answer» |
| P0-3 | agentToolLoop.js, main.js | Rejection несёт `err.toolCallLog`; catch в main.js пушит assistant-сообщение с выполненными тулами ПЕРЕД ошибкой (юзер видит карточки, модель получает реальное состояние при следующем запросе); общий хелпер `serializeToolCalls()` |

**Валидация:**
- Юнит: 38/38 (`node --test test/*.test.js`), новые — test/agentLoop.test.js (6 тестов: guard+retry, синтез сводки, плейсхолдер, toolCallLog на reject, streaming opt-in, парность tool_call_id).
- Live e2e через продакшен-модули (agentToolLoop+chatProvider+registry+prompt в vm-сандбоксе, синтетический согласованный хост, реальный Cloud.ru GLM-5.1): запрос юзера из инцидента → 15 ходов, 26 тулов, финальный ответ 1354 зн. — PASS. Тул-вызовы доставляются на 100% ходов (vs 0% со стримингом).
- Время e2e: 18.8 мин с thinking ON — живой аргумент за этап 2 (enable_thinking: false для исполнительных ходов; в пробе B тот же сценарий с OFF занял 94 с).

---

## 6. Этап 2 — РЕАЛИЗОВАН (2026-06-10)

| Фикс | Файл | Что сделано |
|---|---|---|
| P1-1 | agentToolLoop.js | `chat_template_kwargs: {enable_thinking: false}` на каждом ходу по умолчанию; opt-in `thinkingFirstTurn` оставляет серверный дефолт (thinking ON) только на ходу 0 для планирования — паттерн turn-level thinking из доков Z.ai |
| P1-1 | main.js, config/example.config.js | Конфиг-флаг `agentThinkingFirstTurn` (default false), причина (12x на пробе B) задокументирована |
| P1-2 | agentToolLoop.js | `reasoning` → `reasoning_content` на эхо-ответах assistant внутри цикла (chat template GLM ждёт именно этот ключ; иначе цепочка рассуждений теряется, вставляется пустой `<think></think>`) |
| Readback | host/index.jsx | `_exprReadbackValue()` (ES3): после применения экспрешена читается вычисленное значение свойства на текущем времени; `evaluatedValue` + суффикс в message в обоих путях (apply_expression и batch) — модель видит, что экспрешен реально вычисляется, а не только «применился» |

**Валидация:**
- Юнит: 40/40, новые 2 теста в test/agentLoop.test.js (kwargs на всех ходах / exemption хода 0 при thinkingFirstTurn; rename reasoning→reasoning_content).
- Live e2e (та же методика и тот же запрос из инцидента, thinking OFF на всех ходах): **PASS** — финальный ответ 886 зн., 10 тулов (10 ok), 2714 completion-токенов.
- Сравнение с базлайном этапа 1 (thinking ON): тулы **26 → 10** (исчезли verify-петли), completion-токены **7862 → 2714 (−65%)**, время **18.8 → 14.3 мин (−24%)**.
- Время упало меньше, чем токены: 160k кумулятивных prompt-токенов за ран (полный system prompt + история пересылаются каждый ход) + нагрузка Cloud.ru доминируют над генерацией. Проба B (94 c) была одношаговой и нагрузку префилла не отражала. Вывод: следующий рычаг скорости — не thinking, а размер пересылаемого контекста на ход (P1-3, этап 3).

---

## 7. Этап 3 — РЕАЛИЗОВАН (2026-06-11)

| Что | Файл | Детали |
|---|---|---|
| Миссия-рефрейм | agentSystemPrompt.js | INTRO: «motion design EDITING assistant», задача — ускорять работу пользователя над ЕГО композицией (экспрешены, линковка, эффекты, тайминг); строить анимации с нуля только по явной просьбе. Строка «create animations from scratch» удалена. Workflow и модули указывают на новые тулы |
| `search_expression_library` | lib/pure/expressionLibrary.js (новый), hostBridge.js, toolRegistry.js | 28 канонических сниппетов (Ebberts inertial bounce, typewriter, wiggle-семейство, loopOut, auto-fade, squash&stretch, trail/stagger by index, sourceRectAtTime-плашка, marker pulse, slider-риги…). Ключевые слова EN+RU, скоринговый поиск. Panel-local — БЕЗ round-trip в AE. `requires` декларирует контроллер-эффекты (Slider Control) для add_effect-prerequisite |
| `link_properties` | host/index.jsx, hostBridge.js, toolRegistry.js | Генерирует `thisComp.layer("...").transform.position` (+ опциональные scale/offset) из panel-style путей (Transform>\*, Effects>Name>Prop, Masks>Name>Prop, Text>Source Text), проверяет существование source-property, делегирует в applyExpressionToTarget (rollback + evaluatedValue readback), возвращает применённый expression |
| `list_available_effects` | host/index.jsx, hostBridge.js, toolRegistry.js | Поиск по `app.effects` (установленные built-in + third-party) по substring имени/matchName + категория. Закрывает галлюцинации matchName для экзотики |
| P1-3 контекст-трим | agentToolLoop.js | `trimOldToolResults()` перед каждым ходом: tool-результаты старше последних 8 обрезаются до 400 зн. с маркером «re-read with a get_* tool if needed». Live-замер этапа 2 показал 160k кумулятивных prompt-токенов за ран — префилл стал главным рычагом скорости |
| Валидация аргументов | hostBridge.js | `_validateRequiredArgs` для link_properties (target/source path + source layer) и list_available_effects (filter) |

Регистр: 47 → **50 тулов**. Оба новых read-тула включены в READ_ONLY_TOOLS (параллельное исполнение).

**Валидация:** юнит 51/51 (`node --test test/*.test.js`); новые — test/expressionLibrary.test.js (9: well-formed сниппеты, анти-питфолы text.sourceText.value/Date()/баланс скобок, поиск EN+RU, max_results, requires, трим старых tool-результатов с сохранением свежих 8, короткие не трогаются) + 2 в registry.test.js (схемы новых тулов, рефрейм промпта). host/index.jsx: parse OK, новый регион ES3-safe.

**Не сделано / дальше:** AE-версия в контексте промпта (нужен host-вызов `app.version` при старте сессии); ручной чек-лист пользователя в панели.

---

## 8. Live-валидация в реальном AE (2026-06-12)

Методика: панель с CEP debug-портом (`.debug`, порт 8092) + `scripts/cdp-eval.js` — выполнение JS внутри живой панели через Chrome DevTools Protocol, вызовы реального `HOST_BRIDGE.executeToolCall(...)` → настоящий ExtendScript/композиция. Воспроизводимо без ручных кликов.

**Прошло сразу:** `list_available_effects` (реальный `app.effects`, нашёл built-in ADBE Glo2 и third-party Mettle SkyBox Glow; пустой фильтр → 0 без ошибки); `search_expression_library` (panel-local, 28 сниппетов в живой панели); `auto-fade` сниппет на Opacity (readback 0 на t=0 — корректно).

**Найдено и исправлено 3 live-бага, невидимых для node-тестов:**

| # | Баг | Симптом | Фикс |
|---|---|---|---|
| 1 | ExtendScript кидает «invalid numeric result (divide by zero?)» на конкатенации `строка + Array` (даже чистый пересобранный массив; `join()` работает) | apply_expression/link_properties возвращали ok:false при УСПЕШНО применённом экспрешене — на всех многомерных свойствах | host/index.jsx: readback-сообщение строится через `join(', ')` |
| 2 | `resultToJson` не экранировал control-символы; AE кладёт сырые `\r\n` в expressionError | Невалидный JSON → панель не парсила ответ → fallback-обёртка с **ok:true при реальной ошибке экспрешена** | host/index.jsx: эскейп `\r\n\t` + все `\u0000-\u001f` |
| 3 | `add_effect` не умел задавать имя инстанса эффекта | Сниппеты-риги ссылаются на `effect("Wiggle Freq")` — агент не мог создать такое имя вообще | `effect_name` опциональный параметр (registry + hostBridge + host, rename в undo-группе) |

**Прошло после фиксов (живой AE):** `link_properties` Scale×0.5 (источник A=80 → B evaluated [40,40,100], линк живой при изменении источника), Position+offset [200,100] ([960,540]→[1160,640]); полный slider-риг цикл: add_effect×2 с rename → set_effect_property по index → `wiggle-slider` сниппет на Rotation (evaluated 5.96, живой wiggle от слайдеров); заведомо битый экспрешен → ok:false + expressionError доезжают до панели корректно. Юнит после фиксов: 51/51.

### 8.1 Стресс-раунд (та же сессия)

Батареи: unicode/escaping, текст+typewriter+авто-плашка, кейфреймы+loop, маски/3D/камера/свет/parenting/precompose/duplicate/timing, error-пути/идемпотентность/capture_comp_frame.

**Прошло без правок:** кавычки/кириллица/эмодзи в именах слоёв (включая корректный эскейп внутри сгенерированных expressions), маркеры с `\n`, rename с backslash, поиск по кириллице; create text + set_text_document («ёлочки», цвет, кегль) + typewriter (readback: пустая строка на t=0 — верно); add_keyframes/get_keyframes/set_keyframes_batch/loopOut; маски (feather/opacity), set_layer_3d, камера (zoom/DOF), свет, parenting, duplicate, set_layer_timing; error-пути (несуществующие id/path/index → чистые сообщения); идемпотентность client_op_id (dedup, один слой); capture_comp_frame (PNG 27KB записан; `fileSize:-1` — косметика).

**Найдено и исправлено ещё 4 бага:**

| # | Баг | Симптом | Фикс |
|---|---|---|---|
| 4 | `_resolveProperty`: alias `contents→ADBE Root Vectors Group` затирал исходный сегмент и для direct lookup, и для fallback-скана | Внутренние `Contents` шейп-групп (matchName `ADBE Vectors Group`) не резолвились НИКОГДА — даже пути, которые выдаёт сам get_layer_properties | direct lookup пробует alias и оригинал; name-скан — по оригинальному сегменту |
| 5 | add_shape_rect/ellipse/path: чтение `rect.name` после `addProperty(Fill/Stroke)` | ExtendScript «Object is invalid» — addProperty инвалидирует соседние ссылки; плюс ok:true при ошибке (catch не сбрасывал ok) | имена захватываются сразу после создания; catch ставит ok=false; результат теперь содержит готовые `sizePath`/`positionPath`/`pathPropertyPath` — агенту не нужно угадывать пути |
| 6 | `reorder_layer` использовал `layer.moveTo(index)` — у Layer НЕТ moveTo (это метод Property) | «parent is not an INDEXED_GROUP» на ЛЮБОМ слое — тул не работал никогда | moveToBeginning/moveToEnd/moveBefore/moveAfter по направлению; проверено: вниз/вверх/в начало/в конец/noop |
| 7 | `precompose_layers` принимал только layer_indices | Агент рефлекторно передаёт layer_ids (как все остальные тулы) и получает отказ; индексы сдвигаются при reorder | поддержка `layer_ids` (резолв id→index в хосте), required теперь только comp_name |

Дополнительно: подсказка пути в сниппете `auto-size-box` исправлена на реальный формат (`Contents><Group>>Contents>Rectangle Path 1>Size`) и указывает брать `sizePath` из результата add_shape_rectangle. Авто-плашка проверена end-to-end: rect Size получил sourceRectAtTime-экспрешен от текстового слоя, evaluated [40,40] при пустом тексте (typewriter на t=0) — связка библиотека+шейпы+текст работает.

Все тестовые слои удалены (9/9), комп чист. Юнит: 51/51. В бин проекта остался item «Прекомп плашки» и тестовые solids — мусор от прогона, можно удалить вручную или `File > Reduce Project`.

---

## Источники

- Внутренний аудит: agentToolLoop.js, chatProvider.js, main.js, agentSystemPrompt.js, hostBridge.js, host/index.jsx
- AE-решения: Dakkshin/after-effects-mcp, hodor/ae-mcp, Aodaruma/after-effects-mcp-rs, ishu86/after-effects-mcp, TheLlamainator/after-effects-mcp, jhd3197/after-effects-automation; Klutz GPT, AE GPT (Plugin Play), Atom (tryatom.ai), Good Boy Ninja
- Экспрешены: Animoplex gists, Plainly library (~120 сниппетов), motionscript.com (Dan Ebberts), Adobe expression examples
- GLM: docs.z.ai (thinking mode, function calling, turn-level thinking), HF zai-org/GLM-5.1 chat_template.jinja, vllm#27703/#39614/#31319, HF GLM-5.1-FP8 discussion
- Агентные паттерны: Anthropic «Building Effective Agents», «Writing tools for agents», Claude Code best practices, Cline auto-approve/checkpoints
