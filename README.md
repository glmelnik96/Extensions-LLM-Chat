# Extensions LLM Chat (After Effects CEP Panel)

Extensions LLM Chat — это CEP-панель для Adobe After Effects с **AI-агентом (AE Motion Agent)**, который через вызовы инструментов может осматривать, создавать и изменять активную композицию в ExtendScript. Модель планирует последовательность действий, выполняет их по одному и возвращает результат в чат.

Актуальный перечень инструментов, ограничений и планов развития — в **[docs/capabilities-and-roadmap.md](docs/capabilities-and-roadmap.md)** (точка истины по текущим возможностям).

Панель понимает запросы на русском языке.

---

## Что делает это расширение

- Запускает **чат с агентом** внутри After Effects: запросы на естественном языке превращаются в цепочку операций над композицией.
- Использует **26 инструментов** (чтение состояния компа и слоёв, чтение экспрешенов, слои, анимация и кейфреймы, эффекты, композиция, текст и др.) — полная таблица в [docs/capabilities-and-roadmap.md](docs/capabilities-and-roadmap.md).
- Подключается к **Cloud.ru Foundation Models** (OpenAI-совместимый chat completions с tool calling) и при настройке — к **Ollama (локально)** для чата и сценариев с анализом изображений.
- Сохраняет **сессии** чата, показывает **карточки вызовов инструментов** (аргументы и результаты), **markdown-рендеринг** ответов, **прогресс выполнения** (Step 2/15), кнопки **Undo** (batch-откат всех мутирующих действий агента) и **Stop** (отмена агента).

Дополнительные детали архитектуры конфигурации, knowledge base, диагностики и политик ответов — в [docs/README.md](docs/README.md), [docs/final-architecture.md](docs/final-architecture.md) и связанных файлах.

---

## Основные возможности

- **Агент и инструменты**
  - Категории: осмотр (comp summary, свойства, кейфреймы, эффекты), операции со слоями, анимация и выражения, эффекты, композиция, текст.
  - Выполнение через единый цикл **LLM ↔ tool calls ↔ ExtendScript** (см. структуру модулей ниже).

- **Интерфейс**
  - Чат с визуализацией tool calls и **markdown-рендерингом** ответов.
  - Сессии: создание, переименование, очистка, переключение.
  - Выбор модели: модели Cloud.ru и локальные модели Ollama (при включении в конфиге).
  - **Undo** — откатывает все мутирующие действия агента за один клик (batch-undo через N × Cmd+Z).
  - **Stop** — отмена работающего агента.
  - **Прогресс**: Step N/15, счётчик tool calls, отображение использованных токенов.
  - Подсказки (tooltips) на всех кнопках.

- **Надёжность**
  - Автоматический retry API-запросов при 429/5xx ошибках (3 попытки, exponential backoff).
  - Обрезка истории диалога для контроля лимита токенов.
  - Детекция и возврат ошибок экспрешенов агенту для самоисправления.
  - Сохранение полной истории tool calls между запросами в сессии.

- **Провайдеры API**
  - **Cloud.ru Foundation Models** — основной облачный чат с поддержкой инструментов.
  - **Ollama** — локальный чат и анализ кадров/скриншотов при `ollamaChatEnabled: true` (подробности конфигурации: [docs/configuration.md](docs/configuration.md), [config/README.md](config/README.md)).

- **Русский язык**
  - Запросы и пояснения в чате могут быть на русском; имена API After Effects, свойств и выражений остаются в синтаксисе AE.

---

## Типичный сценарий работы

1. Установите панель и `CSInterface.js` (см. ниже), настройте API-ключ Cloud.ru в `config/secrets.local.js`.
2. Откройте композицию в After Effects и панель **Extensions LLM Chat**.
3. Создайте сессию или используйте существующую, выберите модель.
4. Опишите задачу на русском или английском (например: «добавь текст по центру и анимацию появления по opacity»).
5. Агент при необходимости осмотрит комп (`get_detailed_comp_summary` и др.), затем вызовет нужные инструменты; результаты отображаются в чате.
6. При ошибке инструмента сообщение попадает в чат; часть ограничений и обходных путей описана в [docs/capabilities-and-roadmap.md](docs/capabilities-and-roadmap.md) (раздел Known Limitations).

Целевое развитие продукта и UX — в том же файле, раздел **Improvement Roadmap**.

---

## Структура проекта (высокоуровнево)

Модули агента (актуальная схема):

| Файл | Назначение |
|------|------------|
| `agentSystemPrompt.js` | Персона агента и правила рабочего процесса |
| `agentToolLoop.js` | Цикл LLM ↔ выполнение инструментов |
| `chatProvider.js` | Единый API: Cloud.ru и Ollama |
| `hostBridge.js` | Сопоставление имён инструментов и вызовов ExtendScript |
| `toolRegistry.js` | Описания 26 инструментов в формате OpenAI functions |
| `host/index.jsx` | Реализация операций в After Effects |
| `main.js` | UI, сессии, обработка событий |

Также:

- `CSXS/manifest.xml` — манифест CEP для After Effects.
- `index.html`, `styles.css` — разметка и стили панели.
- `lib/CSInterface.js` — Adobe CSInterface (**нужно установить вручную**, см. ниже).
- `lib/captureMacOS.js`, `lib/ollamaVision.js` — захват и локальный анализ изображений (macOS / Ollama), см. [docs/vision-grounding.md](docs/vision-grounding.md).
- `config/` — ключи и runtime-конфиг ([config/README.md](config/README.md)).
- `knowledge-base/`, `prompt-library/` — база знаний и промпты ([docs/local-knowledge-base.md](docs/local-knowledge-base.md), [docs/prompt-library-architecture.md](docs/prompt-library-architecture.md)).
- `pipelineAssembly.js`, `systemPrompt.js` и др. — вспомогательные части legacy-пайплайна и контекста; детали в [docs/final-architecture.md](docs/final-architecture.md), [docs/pipeline-runtime-flow.md](docs/pipeline-runtime-flow.md).

**Индекс документации:** [docs/README.md](docs/README.md).

**Архив (legacy):** [docs/legacy-archive-on-user-request-only/](docs/legacy-archive-on-user-request-only/) — старые отчёты, multi-pass Copilot и расширенные тест-планы. Для ассистентов: не читать эту папку без **явного запроса пользователя** (см. [README архива](docs/legacy-archive-on-user-request-only/README.md)).

---

## Установка CSInterface.js (обязательно)

Панель не заработает с After Effects без этого файла. Без него в консоли будет ошибка загрузки и связь с хостом AE не появится.

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

- Сессии сохраняются в **localStorage** между перезапусками панели.
- В UI: **New**, переключение списка сессий, **Rename**, **Clear** (текущая), **Clear All** (с подтверждением).
- Детальная схема полей сессии, пайплайна и публикации ответов — [docs/runtime-state-schema.md](docs/runtime-state-schema.md), [docs/final-architecture.md](docs/final-architecture.md).

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
   - Установите `CSInterface.js` в папку `lib/` по инструкции выше.

4. **Настройка облачного API**
   - Bearer-токен для Cloud.ru Foundation Models.
   - Скопируйте `config/secrets.local.example.js` → `config/secrets.local.js` и вставьте ключ в `apiKey` (без префикса `Bearer `). Файл **не коммитится** (см. `.gitignore`).
   - При необходимости скопируйте `config/runtime-config.example.js` → `config/runtime-config.js` для переопределения `baseUrl` и моделей **без** хранения ключа там.
   - Порядок подключения скриптов в `index.html`: см. [config/README.md](config/README.md), [docs/secret-handling.md](docs/secret-handling.md).

5. **Открытие панели в After Effects**
   - Запустите After Effects → меню **Extensions** → **Extensions LLM Chat**.

---

## Захват экрана и Ollama (macOS)

- **Capture full screen** и **Capture comp area** используют `screencapture` через **Node.js внутри CEP** (`CSXS/manifest.xml`: `--enable-nodejs`, `--mixed-context`). Для **comp area** может понадобиться доступ **Автоматизация** для System Events.
- Нужно разрешение **Screen Recording** для **After Effects** (Системные настройки → Конфиденциальность и безопасность).
- **Analyze UI (Ollama)** / **Analyze frame (Ollama):** локальное описание захвата или кадра композиции; текст может подмешиваться в контекст запроса. Подробности: [docs/vision-grounding.md](docs/vision-grounding.md).
- По [docs/capabilities-and-roadmap.md](docs/capabilities-and-roadmap.md): vision-сценарии пока **не интегрированы в основной цикл агента**; в roadmap запланировано переподключение (раздел *Vision-informed animation*).

Дополнительно о направлении «vision + автоматизация»: [docs/north-star-vision-agent.md](docs/north-star-vision-agent.md).

---

## Известные ограничения (кратко)

Полный список и формулировки — [docs/capabilities-and-roadmap.md](docs/capabilities-and-roadmap.md) (Known Limitations).

- Пустой shape-слой при `create_layer('shape')` без программного добавления контента путей; обходной путь — дорисовать формы вручную, затем анимировать.
- Нет операций с масками, импорта футажа, очереди рендера, маркеров, переключения 3D у слоя.
- Нет тонкого управления пространственными безье по position (только временной easing).
- Агент работает в контексте **активной** композиции; явного переключения компа нет.
- Ограничения моделей (путаница anchor/position, пути свойств) смягчаются системным промптом и few-shot примерами. Ошибки экспрешенов теперь обнаруживаются и агент пытается исправить их автоматически.

---

## Добавление нового инструмента

Порядок шагов — в [docs/capabilities-and-roadmap.md](docs/capabilities-and-roadmap.md) (раздел *Adding a New Tool*): ExtendScript в `host/index.jsx`, схема в `toolRegistry.js`, маппинг в `hostBridge.js`, при необходимости правки `agentSystemPrompt.js`.

---

## Troubleshooting и QA

- [docs/troubleshooting.md](docs/troubleshooting.md)
- [docs/qa-test-plan.md](docs/qa-test-plan.md)
- Расширенные чеклисты: [docs/legacy-archive-on-user-request-only/qa-testing/](docs/legacy-archive-on-user-request-only/qa-testing/) (открывать при необходимости; см. [README архива](docs/legacy-archive-on-user-request-only/README.md))
- [docs/release-checklist.md](docs/release-checklist.md)

Корневой README даёт обзор и ссылки; детали — в `docs/`.
