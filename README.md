# Extensions LLM Chat (After Effects CEP Panel)

Extensions LLM Chat — это расширение (CEP panel) для Adobe After Effects, которое открывает чат с облачной моделью и помогает писать, валидировать и применять выражения (Expressions) для After Effects через локальный multi-pass pipeline.

Панель понимает запросы на русском языке и генерирует корректные, готовые к копированию выражения, а также короткие структурированные объяснения.

---

## Что делает это расширение

- Открывает панель чата внутри After Effects.
- Через локальный multi-pass pipeline (prepare → generate → validate → rules → repair → finalize) общается с облачной моделью (configurable baseUrl + модели по умолчанию/фолбэк; см. `docs/configuration.md` и `docs/final-architecture.md`).
- Использует системный и роль-специфичные промпты (generator/validator/repair) и локальную knowledge base для устойчивого поведения.
- Возвращает выражение + краткое объяснение в стабильном формате, удобном для парсинга.
- Позволяет вручную применить финальное, прошедшее проверки выражение к выбранному свойству в композиции.

---

## Основные возможности

- **Мультисессионный чат**
  - Создание новых сессий.
  - Переключение между сессиями.
  - Переименование активной сессии.
  - Очистка текущей сессии (с подтверждением).
  - Полная очистка всех сессий (с подтверждением) с созданием новой чистой.

- **Работа с облачной моделью**
  - Запросы к облачному API `https://foundation-models.api.cloud.ru/v1/chat/completions`.
  - **Модель по умолчанию**: `Qwen/Qwen3-Coder-Next` (используется и как основная, и как фолбэк).

- **Генерация Expressions**
  - Встроенный системный промпт для After Effects 26.0.
  - Поддержка типичных задач: привязки (links), лупы, задержки, смещения, wiggle, valueAtTime, posterizeTime, sourceRectAtTime, текстовая логика, контроллеры и т.д.
  - Стабильный формат ответа:
    1. Только выражение (без комментариев и обёрток).
    2. `---EXPLANATION---`.
    3. 1–5 коротких буллетов.
    4. Опционально `---NOTES---` с допущениями/заметками по совместимости.

- **Применение выражений**
  - Кнопка **Apply Expression** отправляет последнее извлечённое выражение в ExtendScript.
  - Если возможно, выражение применяется к выбранному свойству.
  - В панель возвращается структурированный статус (успех / ошибка) и показывается как сообщение в чате.

---

## Поддерживаемый рабочий процесс

Типичный сценарий:

1. Открываете панель **Extensions LLM Chat** в After Effects.
2. Убедитесь, что у вас есть действующий доступ к облачному API и корректный API-ключ.
3. В левой колонке создаёте сессию или используете `Session 1`.
4. Пишете запрос **на русском** (например:  
   «Сделай wiggle по позиции, но только по X, с лёгким затуханием»).
5. Нажимаете **Send**:
   - Пока запрос выполняется, кнопка Send и выбор модели блокируются.
   - В ответ вы получаете:
     - Выражение (первая часть ответа).
     - `---EXPLANATION---`.
     - Несколько буллетов с объяснением (могут быть на русском).
     - При необходимости `---NOTES---` с краткими комментариями.
6. Если выражение успешно извлечено, кнопка **Apply Expression** становится активной.
7. В After Effects выбираете нужное свойство (например, Position слоя) и нажимаете **Apply Expression** — выражение применяется к выбранному свойству.

---

## Структура проекта (высокоуровнево)

- `CSXS/manifest.xml` – CEP-манифест панели для After Effects.
- `index.html` – HTML-разметка панели, подключение стилей и скриптов.
- `styles.css` – компактные стили под панель After Effects.
- `main.js` – основной рантайм: сессии, UI, multi-pass pipeline, связь с облачной моделью, парсинг и ручной Apply Expression.
- `systemPrompt.js` – базовый системный промпт для AE Expressions 26.0+.
- `host/index.jsx` – ExtendScript-хост, выполняющий операции в AE (target summary, apply expression).
- `lib/CSInterface.js` – официальный Adobe CSInterface (**нужно установить вручную**, см. ниже).
- `config/` – локальная конфигурация API (см. `config/README.md`, `docs/configuration.md`).
- `knowledge-base/` – локальная база знаний по Expressions (см. `knowledge-base/README.md`, `docs/local-knowledge-base.md`).
- `prompt-library/` – role-specific prompt library для generator/validator/repair (см. `prompt-library/README.md`, `docs/prompt-library-architecture.md`).
- `docs/` – основная документация (архитектура, конфиг, pipeline, apply policy, troubleshooting, QA). **Индекс активной документации:** [docs/README.md](docs/README.md).

---

## Установка CSInterface.js (обязательно)

Панель не заработает с After Effects без этого файла. Без него в консоли будет ошибка загрузки и список слоёв не появится.

1. **Скачайте файл** в папку `lib` расширения одной командой в Терминале (macOS):

   ```bash
   curl -sL "https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_11.x/CSInterface.js" -o "$HOME/Library/Application Support/Adobe/CEP/extensions/Extensions LLM Chat/lib/CSInterface.js"
   ```

   Если ссылка не сработает (404), попробуйте версию CEP_9.x:

   ```bash
   curl -sL "https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_9.x/CSInterface.js" -o "$HOME/Library/Application Support/Adobe/CEP/extensions/Extensions LLM Chat/lib/CSInterface.js"
   ```

2. **Или установите вручную**: откройте [Adobe CEP-Resources](https://github.com/Adobe-CEP/CEP-Resources), зайдите в папку **CEP_11.x** (или **CEP_9.x**), скачайте **CSInterface.js** и положите его в каталог:

   ```text
   ~/Library/Application Support/Adobe/CEP/extensions/Extensions LLM Chat/lib/
   ```

   Итоговый путь к файлу: `.../Extensions LLM Chat/lib/CSInterface.js`.

3. После добавления файла закройте и снова откройте панель в After Effects (или перезапустите AE).

---

## Сессии и состояние

Актуальная схема сессии и pipeline описана в `docs/runtime-state-schema.md` и `docs/final-architecture.md`. Вкратце:

- Сессии персистятся (localStorage) между перезапусками панели.
- Каждая сессия хранит:
  - `id`, `title`, `createdAt`, `updatedAt`, `model`;
  - `messages` (включая первый `system`-месседж с системным промптом);
  - `latestExtractedExpression` — последнее финальное выражение (только при disposition `acceptable`);
  - `pipeline` — компактное состояние multi-pass pipeline.
- В UI поддерживаются:
  - Создание сессий (**New**).
  - Переключение между сессиями.
  - Переименование активной сессии (**Rename**).
  - Очистка текущей сессии (**Clear**, с подтверждением).
  - Полная очистка всех сессий (**Clear All**, с подтверждением).

---

## Установка (macOS, CEP)

1. **Путь установки**
   - Скопируйте всю папку проекта в:
     ```text
     ~/Library/Application Support/Adobe/CEP/extensions/Extensions LLM Chat
     ```
   - Имя папки должно быть ровно `Extensions LLM Chat`.

2. **Разрешение CEP-расширений**
   - В зависимости от версии AE и macOS может понадобиться включить загрузку не подписанных CEP расширений (через debug-файл или настройки AE).

3. **CSInterface** (обязательно)
   - Установите `CSInterface.js` в папку `lib/` по инструкции выше (раздел «Установка CSInterface.js»). Без этого файла панель не сможет получать список слоёв и применять выражения.

4. **Настройка облачного API**
   - Убедитесь, что у вас есть Bearer-токен для Cloud.ru Foundation Models.
   - Скопируйте `config/secrets.local.example.js` → `config/secrets.local.js` и вставьте ключ в `apiKey` (без префикса `Bearer `). Файл **не коммитится** (см. `.gitignore`).
   - При необходимости скопируйте `config/runtime-config.example.js` → `config/runtime-config.js` для переопределения `baseUrl` / моделей **без** хранения ключа там.
   - В `index.html` уже подключены `example.config.js`, затем `runtime-config.js`, затем `secrets.local.js` — см. `config/README.md`, `docs/secret-handling.md`.

5. **Открытие панели в After Effects**
   - Запустите After Effects.
   - Откройте меню Extensions и выберите **Extensions LLM Chat**.

---

## Работа на русском языке

- Вы можете писать запросы на русском (например: «Объясни, как сделать циклическую анимацию по opacity»).
- Модель обязана правильно интерпретировать русский текст и выдать:
  - Корректное expression-выражение (на английском синтаксисе AE).
  - Краткие буллеты-объяснения; они могут быть на русском.
- Имена свойств, функций и API After Effects **не переводятся**:
  - Используются реальные имена: `thisComp`, `thisLayer`, `transform.position`, `effect("Slider Control")("Slider")`, `wiggle()`, `valueAtTime()`, `posterizeTime()`, `sourceRectAtTime()` и т.п.

---

## Формат ответа ассистента

Каждый ответ ассистента внутри панели имеет строгий формат:

1. **Только выражение** (expression) — без комментариев и обёрток.
2. Строка-разделитель: `---EXPLANATION---`
3. 1–5 коротких буллетов с пояснением (часто на русском, если запрос был на русском).
4. Опционально строка: `---NOTES---`
5. 1–3 коротких буллета с допущениями или заметками о совместимости (версия AE, тип слоя/свойства и т.п.).

Это позволяет панели надёжно извлекать выражение (часть до `---EXPLANATION---`) для применения.

---

## Как работает Apply Expression

1. Вы делаете запрос и получаете ответ ассистента в корректном формате.
2. Панель автоматически извлекает всё, что идёт **до** строки `---EXPLANATION---` — это и есть `latestExtractedExpression` для текущей сессии.
3. Кнопка **Apply Expression** становится активной, если:
   - Есть валидное извлечённое выражение.
- В данный момент не выполняется запрос к модели.
4. В After Effects выбираете свойство, которое поддерживает Expressions (например, Position, Opacity, Source Text и т.п.).
5. Нажимаете **Apply Expression**:
   - Панель вызывает через `CSInterface.evalScript` функцию `extensionsLlmChat_applyExpression(expressionText)` в `host/index.jsx`.
   - ExtendScript:
     - Проверяет наличие активного проекта и композиции.
     - Проверяет, выбрано ли хотя бы одно свойство.
     - Ищет первое свойство, у которого `canSetExpression === true`.
     - Применяет выражение (`property.expression = expressionText`, `expressionEnabled = true`) внутри `app.beginUndoGroup(...)`.
     - Возвращает JSON-строку с полями `ok` и `message`.
   - Панель парсит JSON и добавляет `system`-сообщение с текстом `message` (успех или ошибка).

История чата при этом **не стирается** — добавляется только новый статус.

---

## Выбор слоя и свойства (targeting)

- **Что работает:** откройте композицию в AE (или выберите её в панели Project), нажмите **@** в поле ввода или кнопку **@** над ним — панель запросит у After Effects список слоёв активной композиции и заполнит выпадающие списки «Layer» и «Property». Выберите слой и свойство — выражение будет применяться к этому свойству.
- **Что не реализовано:** перетаскивание слоя из таймлайна AE в чат (drag-and-drop) и автоматическая подстановка слоя в поле ввода при клике по слою в таймлайне в текущей версии AE/CEP недоступны; используется только синхронизация по @ и выбор из списков.

---

## Захват экрана (macOS, UI analysis)

- **Capture full screen** и **Capture comp area** вызывают `screencapture` через **Node.js внутри CEP** (см. `CSXS/manifest.xml`: `--enable-nodejs`, `--mixed-context`). **Comp area** — приблизительный кроп окна AE в сторону панели Composition (доли `previewCaptureInset` в конфиге; может понадобиться **Автоматизация** для System Events).
- Нужно разрешение **Screen Recording** для **After Effects** (Системные настройки → Конфиденциальность и безопасность).
- PNG сохраняется во временный каталог; путь — в строке статуса. Отдельная строка **Ollama** показывает этапы локального анализа.
- **Clear All:** удаляет временные PNG (`ext-llm-chat-capture-*`, `ext-llm-chat-frame-*`) из системного temp и запрашивает у Ollama выгрузку моделей из памяти (`/api/ps` + `keep_alive: 0`). Постоянной «истории ответов» у Ollama по HTTP нет; выгрузка сбрасывает удерживаемое в RAM состояние.
- **Analyze UI (Ollama)** / **Analyze frame (Ollama):** локальный Ollama описывает последний захват или кадр композиции (`comp.saveFrameToPng`). Текст сохраняется в сессии и подмешивается в облачный запрос как `[UI_ANALYSIS]` (если включён чекбокс) и `[FRAME_ANALYSIS]`. Как это используется облачной моделью: **`docs/vision-grounding.md`**. Перед Send хост отдаёт `[AE_HOST_STATE]`.
- Дорожная карта: **`docs/north-star-vision-agent.md`**.

---

## Известные ограничения

- Применение выражения выполняется только к **первому** выбранному свойству, которое поддерживает Expressions.
- Некоторые типы свойств в AE не могут иметь выражения — в этом случае вы получите понятное сообщение об ошибке.
- Панель ожидает стандартный формат ответа от облачного API (`choices[0].message.content`); другие форматы могут приводить к ошибке парсинга.
- Не реализована тонкая настройка таймаутов запросов — сетевые проблемы отображаются как общие ошибки связи с облачной моделью.
- Системный промпт ориентирован на After Effects 26.0+ и использует современный JavaScript Expression Engine; в старых версиях возможны расхождения.

---

## Troubleshooting и QA

Актуальный troubleshooting, QA и релизные чек-листы находятся в:

- `docs/troubleshooting.md`
- `docs/qa-test-plan.md`
- `docs/archive/qa/manual-test-matrix.md`
- `docs/release-checklist.md`

Этот README даёт только обзор и ссылки; подробности уточняются в документации выше.

# Extensions-LLM-Chat
