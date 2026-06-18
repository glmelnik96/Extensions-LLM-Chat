# AE Motion Agent — CEP Panel for After Effects

> **Status: MVP shipped 2026-04-30 → stability iterations 2-4 (2026-05-12) → Cloud.ru reasoning models (2026-06-04) → Stage 3 editing-assistant + live validation в реальном AE, 7 host-багов исправлено (2026-06-10) → 3-model selector (gpt-oss-120b / MiniMax-M2.5 / GLM-4.7), live-verified (2026-06-18).** Chat-only AI agent for motion-design work inside Adobe After Effects 26+. Cloud.ru Foundation Models drive 50 tools mapped to ExtendScript.

**Tagline:** «buddy for motion design, not autopilot». The agent helps with hard expression logic, parameter dependencies, and AE quirks — not auto-generate entire animations from one sentence.

---

## 🧑‍💻 New agent or contributor? Start here

Read **[AGENTS.md](AGENTS.md)** — the project HANDOFF. It has the 30-second project map, mental model, iteration history, Cloud.ru tool-call quirks you will hit, and where to find what.

---

## Возможности

AI-агент принимает запросы на естественном языке (русском или английском) и выполняет их через 50 инструментов: создание слоёв, shape content, анимация, эффекты, 3D/камера/свет, маски, маркеры, импорт файлов, превью кадра, библиотека выражений и многое другое.

### 50 инструментов

| Категория | Инструменты |
|-----------|------------|
| Чтение | comp summary, host context, свойства, выражения, кейфреймы, свойства слоя/эффекта, маски, маркеры, элементы проекта, search_layers |
| Слои | create, delete, duplicate, reorder, parent, timing, rename, 3D toggle, set_blend_mode |
| Shape content | rectangle, ellipse, custom path (с fill и stroke; результат возвращает готовые property paths) |
| Анимация | keyframes (add/delete/easing/batch), свойства, expressions (single + batch) |
| Выражения | search_expression_library (28 проверенных сниппетов), link_properties (pick-whip между свойствами) |
| Эффекты | list_available_effects (поиск по установленным), add (с переименованием), remove, set property |
| 3D / камера / свет | camera properties, light properties |
| Маски | add mask, set properties, get mask info, create_shapes_from_text |
| Маркеры | add, get, delete |
| Импорт | import file, add to comp |
| Композиция | create, precompose, settings |
| Текст | set text document |
| Превью | capture comp frame (opt-in) |

Полная таблица: [docs/capabilities-and-roadmap.md](docs/capabilities-and-roadmap.md).

### UI

- **Чат** с карточками tool calls (collapsible, args + результат JSON) и markdown-рендерингом
- **Streaming** — ответ агента появляется в реальном времени (SSE)
- **Quick actions** — кнопки Wiggle, Counter, Slide In, Bounce, Preview над input
- **Footer**: Undo, Clear, Export, Errors, Report
- **Undo** — batch-undo всех мутирующих действий последнего запроса (N × Cmd+Z)
- **Stop** — отмена работающего агента
- **Export** — сессия в JSON на Desktop
- **Errors** — только ошибочные tool calls в JSON
- **Report** — LLM-анализ сессии + tool latency table на Desktop
- Auto-resize textarea, селектор моделей в chat header (`Cloud.ru` + 3 кнопки: gpt-oss-120b / MiniMax-M2.5 / GLM-4.7; переключение блокируется во время запроса), token usage display

### Архитектура надёжности (после MVP + итераций 1-4)

- **Модульный system prompt** — CORE (~2.8k токенов) + lazy modules по keyword. ~40% экономии токенов на простых запросах.
- **Параллельные read-only tools** — contiguous reads в одном round'е через `Promise.all`. Mutating tools остаются sequential (AE single-threaded).
- **Pre-call validation** — `_validateRequiredArgs` ловит Cloud.ru `args:{}` для tool'ов с required-полями.
- **Anti-spam guard** — 4-й identical-failing call блокируется client-side (`RETRY_BLOCKED`). Разрывает спирали типа 137-call.
- **Idempotency через `client_op_id`** — `create_*`, `add_effect/mask/marker` кешируют successful results.
- **Capability handshake** — host script probed at startup (20 функций/констант); stale script → visible warning.
- **Type hints для known property paths** — `Transform>Position expects [x,y]` вместо cryptic AE-ошибки.
- **Static expression validator** — 8 паттернов (`if/else as expression`, `seedRandom(constant, true)`, unbalanced brackets, `.value` misuse, и т.д.). Warnings прокидываются модели через tool result.
- **Reasoning field handling** — модель стримит chain-of-thought в отдельном поле `reasoning` (не в `content`); парсер прокидывает его в индикатор «Agent reasoning», в чат он не попадает.
- **Harmony name normalize** — legacy-страховка от gpt-oss decoder leak (`<|channel|>commentary` в `function.name`) сохранена как дешёвый no-op; на GLM-5.1 практически не срабатывает.
- **Persistent capture frames** — `~/AE-agent-captures/<дата>/`, auto-prune до 50.
- **Anti-fabrication preview rule** — модель НЕ может эмиттить `![preview](file:///...)` без реального вызова `capture_comp_frame`.
- **No-CoT rule** — chain-of-thought leakage suppressed в финальном ответе.
- **`max_tokens: 65536`** — покрывает reasoning + tool_call chains + ответ в одном turn без truncation.
- **API retry on 429/5xx** — 3 попытки, exponential backoff.
- **Conversation pruning** — старые сообщения подрезаются под token budget.

---

## Сценарии использования

### Hard expression logic
> "Сделай счётчик от 0 до 100 за 2 секунды с easing — не linear"

```
Math.round(ease(time, 0, 2, 0, 100)).toString()
```

### Linked parameters
> "Привяжи Opacity текстового слоя к Scale shape-слоя так, чтобы при scale 100% opacity была 100%, при scale 0% — 0%"

`apply_expression` с `linear(thisComp.layer("Shape").transform.scale[0], 0, 100, 0, 100)`.

### Animation from scratch
> "Создай синий фон, белый текст HELLO WORLD с анимацией появления слева и fade-in, добавь тень"

Агент создаёт слои, добавляет keyframes с easing, применяет эффект Drop Shadow через `property_name`.

### Shape graphics
> "Создай красный круг диаметром 150px и анимируй scale от 0 до 100% с overshoot"

`create_layer(shape)` + `add_shape_ellipse` + scale keyframes с custom easing.

### 3D scene
> "Создай 3 слоя на разной глубине и камеру с depth of field"

3D layers + camera + Z-позиции + DOF.

### Quick wiggle
> "Добавь wiggle(3, 25) к позиции выделенных слоёв"

Или через кнопку **Wiggle** в Quick Actions.

### Masks
> "Сделай reveal: текст появляется через расширяющуюся маску слева направо"

`add_mask` + animated `Masks>Mask 1>Mask Expansion`.

---

## Установка

Все зависимости (включая `lib/CSInterface.js`) уже в репозитории — ничего докачивать не нужно.

### 1. Клонировать репозиторий

```bash
git clone https://github.com/glmelnik96/Extensions-LLM-Chat.git
```

### 2. Подключить расширение к CEP

Папку репозитория нужно разместить (или засимлинкать — удобнее для разработки) в директорию CEP-расширений:

**Windows:**

```powershell
# симлинк (рекомендуется — git pull сразу обновляет панель)
mklink /D "%APPDATA%\Adobe\CEP\extensions\Extensions LLM Chat" "C:\path\to\Extensions-LLM-Chat"
```

**macOS:**

```bash
ln -s "/path/to/Extensions-LLM-Chat" \
  "$HOME/Library/Application Support/Adobe/CEP/extensions/Extensions LLM Chat"
```

Альтернатива без симлинка — просто скопировать папку репозитория в эту директорию.

### 3. Разрешить неподписанные CEP-расширения (PlayerDebugMode)

Расширение не подписано, поэтому нужен debug-режим CEP. `CSXS.11` соответствует CEP 11 (AE 2022+); для других версий AE может понадобиться другой номер.

**Windows:**

```cmd
reg add HKCU\Software\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1
```

**macOS:**

```bash
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
```

После изменения перезапустить After Effects.

### 4. Настроить API-ключ

В корне репозитория:

```bash
cp config/secrets.local.example.js config/secrets.local.js
# открыть secrets.local.js и вставить Bearer-токен Cloud.ru в apiKey
```

`secrets.local.js` в `.gitignore` — токен не попадёт в git.

Опционально: `cp config/runtime-config.example.js config/runtime-config.js` для переопределения `baseUrl` и моделей.

### 5. Открыть панель

After Effects → меню **Window** → **Extensions** → **Extensions LLM Chat**.

Если панели нет в меню — проверить шаг 3 (PlayerDebugMode) и путь из шага 2. Подробнее: [docs/troubleshooting.md](docs/troubleshooting.md).

---

## Структура проекта

```
Extensions LLM Chat/
├── AGENTS.md                  # ← entry point для агентов и контрибьюторов
├── README.md                  # ← этот файл (user-facing)
├── index.html                 # панель root
├── styles.css                 # стили
├── main.js                    # UI, sessions, markdown, KB injection, quick actions, undo
├── agentSystemPrompt.js       # модульный system prompt (CORE + lazy modules)
├── agentToolLoop.js           # LLM ↔ tool execution cycle
├── chatProvider.js            # Cloud.ru API + SSE
├── hostBridge.js              # tool name → ExtendScript dispatch (с pipeline защит)
├── toolRegistry.js            # 50 OpenAI-format tool definitions
├── host/index.jsx             # ExtendScript: ~3850 lines, 54 функции
├── CSXS/manifest.xml          # CEP manifest
├── lib/CSInterface.js         # Adobe CSInterface (в репозитории)
├── lib/pure/                  # чистые модули (esLiteral, markdown, prune, expression library)
├── config/                    # default + runtime + secrets (gitignored)
├── knowledge-base/            # AE expression reference corpus
├── scripts/cdp-eval.js        # CDP-помощник для live-тестов панели в реальном AE
├── test/                      # node:test юнит-тесты (51 тест)
└── docs/                      # детальная документация
```

### Документация

- **[AGENTS.md](AGENTS.md)** — HANDOFF для агентов
- **[docs/README.md](docs/README.md)** — индекс всей документации
- **[docs/capabilities-and-roadmap.md](docs/capabilities-and-roadmap.md)** — полный список 50 tools + ограничения + roadmap
- **[docs/final-architecture.md](docs/final-architecture.md)** — runtime архитектура агентного цикла
- **[docs/host-bridge-notes.md](docs/host-bridge-notes.md)** — детали panel ↔ AE моста
- **[docs/configuration.md](docs/configuration.md)** — config fields, loading order
- **[docs/troubleshooting.md](docs/troubleshooting.md)** — известные паттерны ошибок
- **[docs/qa-test-plan.md](docs/qa-test-plan.md)** — smoke checklist
- **[docs/release-checklist.md](docs/release-checklist.md)** — pre-release validation

---

## API-провайдер

**Cloud.ru Foundation Models** — OpenAI-compatible chat/completions с tool calling + SSE streaming.

Модели (селектор в панели, хранится per-session как `session.model`, список — `AVAILABLE_MODELS` в `main.js`): `openai/gpt-oss-120b` (дефолт, самый быстрый чистый tool-caller), `MiniMaxAI/MiniMax-M2.5`, `zai-org/GLM-4.7`. Fallback в конфиге: `deepseek-ai/DeepSeek-V4-Pro`. Reasoning-модели стримят chain-of-thought в отдельном поле `reasoning`, которое биллится как completion-токены.

---

## Известные ограничения

- Нет рендера (`renderQueue.render()` блокирует UI)
- Нет spatial bezier handles (только temporal easing)
- Работает только с активной композицией
- Freeform mask paths ограничены (простые формы работают)
- `capture_comp_frame` захватывает только current playhead (без параметра `time`)
- Solid color нельзя поменять после создания (workaround: `add_effect("ADBE Fill")`)

Полный список: [docs/capabilities-and-roadmap.md](docs/capabilities-and-roadmap.md).

---

## Добавление нового инструмента

См. [AGENTS.md](AGENTS.md) — раздел "How to add a new tool". 5-step recipe со всеми touch points (`host/index.jsx` → `toolRegistry.js` → `hostBridge.js` → опционально `agentSystemPrompt.js` → `READ_ONLY_TOOLS`).

---

## Связанные расширения

`Cloud.ru Motion Presets` и `Cloud.ru Motion Export` — отдельные CEP-расширения в той же директории CEP extensions. Они **не** часть этого проекта. Бренд-пресеты и HTML-экспорт были вынесены туда во время chat-only cleanup 2026-04-30.

---

## Troubleshooting

[docs/troubleshooting.md](docs/troubleshooting.md) — common error patterns с конкретными причинами и фиксами.
