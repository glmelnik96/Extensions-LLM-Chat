# AE Motion Agent — CEP Panel for After Effects

AI-агент для моушен-дизайна в Adobe After Effects. Панель принимает запросы на естественном языке (русском или английском) и выполняет их через 47 инструментов: создание слоёв, shape content, анимация, эффекты, 3D/камера/свет, маски, маркеры, импорт файлов, превью кадра и многое другое.

---

## Возможности

### 47 инструментов

| Категория | Инструменты |
|-----------|------------|
| Чтение | comp summary, host context, свойства, выражения, кейфреймы, свойства слоя/эффекта, маски, маркеры, элементы проекта |
| Слои | create, delete, duplicate, reorder, parent, timing, rename, 3D toggle |
| Shape content | rectangle, ellipse, custom path (с fill и stroke) |
| Анимация | keyframes (add/delete/easing), свойства, expressions (single + batch), presets (fade/pop/slide) |
| Эффекты | add, remove, set property |
| 3D / камера / свет | camera properties, light properties |
| Маски | add mask, set properties |
| Маркеры | add, delete |
| Импорт | import file, add to comp |
| Композиция | create, precompose, settings |
| Текст | set text document |
| Превью | capture comp frame |

Полная таблица: [docs/capabilities-and-roadmap.md](docs/capabilities-and-roadmap.md).

### UI

- **2 вкладки**: Chat / Presets & Logs — одна сессия на проект
- **Чат** с карточками tool calls и markdown-рендерингом (включая inline-изображения)
- **Streaming** — текст ответа агента появляется в реальном времени
- **Quick actions** — кнопки Wiggle, Counter, Slide In, Bounce, Preview
- **Preset toolbar** (вкладка Presets) — детерминированные пресеты Fade/Pop/Slide с параметрами
- **Tool Call Log** (вкладка Presets) — лог только от Apply Preset
- **Общий footer**: Undo, Clear, Export, Errors, Report — виден на обеих вкладках
- **Undo** — откат всех действий агента за один клик (batch-undo)
- **Stop** — отмена работающего агента
- **Export** — сохранение сессии в JSON на Desktop
- **Report** — LLM-анализ сессии → структурированный баг-репорт на Desktop
- Автоматическое растягивание textarea, прогресс (Step N), счётчик токенов, tooltips

### Надёжность

- SSE streaming с инкрементальным парсингом tool_call аргументов
- Retry API-запросов при 429/5xx (3 попытки, exponential backoff)
- Статическая валидация выражений перед отправкой в AE
- Knowledge base injection (подстановка документации по ключевым словам)
- Детекция ошибок выражений → агент исправляет автоматически
- Pruning истории диалога для контроля токенов

---

## Сценарии использования

### Создание анимации с нуля
> "Создай синий фон, белый текст HELLO WORLD с анимацией появления слева и fade-in, добавь тень"

Агент создаёт слои, добавляет keyframes с easing, применяет эффект Drop Shadow.

### Shape graphics
> "Создай красный круг диаметром 150px и анимируй scale от 0 до 100% с overshoot"

Shape layer с ellipse + scale keyframes.

### 3D сцена
> "Создай 3 слоя на разной глубине и камеру с depth of field"

3D layers + camera + Z позиции.

### Expressions
> "Добавь wiggle(3, 25) к позиции выделенных слоёв"

Или через кнопку **Wiggle** в Quick Actions.

### Маски
> "Сделай reveal: текст появляется через расширяющуюся маску"

Mask + animated expansion keyframes.

### Превью
> "Покажи как выглядит композиция"

`capture_comp_frame` → inline-изображение в чате.

---

## Установка

### 1. Разместить расширение

Скопировать проект в:
```
~/Library/Application Support/Adobe/CEP/extensions/Extensions LLM Chat
```

### 2. Установить CSInterface.js

```bash
curl -sL "https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_11.x/CSInterface.js" \
  -o "$HOME/Library/Application Support/Adobe/CEP/extensions/Extensions LLM Chat/lib/CSInterface.js"
```

Если 404, попробовать CEP_9.x. Или скачать вручную с [Adobe CEP-Resources](https://github.com/Adobe-CEP/CEP-Resources).

### 3. Настроить API-ключ

```bash
cd ~/Library/Application\ Support/Adobe/CEP/extensions/Extensions\ LLM\ Chat
cp config/secrets.local.example.js config/secrets.local.js
```

Открыть `config/secrets.local.js`, вставить Bearer-токен Cloud.ru в поле `apiKey` (без префикса `Bearer `).

Опционально: `cp config/runtime-config.example.js config/runtime-config.js` для переопределения `baseUrl` и моделей.

### 4. Разрешить CEP-расширения

Может понадобиться включить загрузку неподписанных CEP-расширений (зависит от версии AE и macOS).

### 5. Открыть панель

After Effects → меню **Window** → **Extensions** → **Extensions LLM Chat**.

---

## Структура проекта

### Модули агента

| Файл | Назначение |
|------|------------|
| `agentSystemPrompt.js` | Системный промпт, документация 47 инструментов |
| `agentToolLoop.js` | Цикл LLM ↔ выполнение инструментов |
| `chatProvider.js` | Cloud.ru API (SSE streaming) |
| `hostBridge.js` | Tool name → ExtendScript mapping |
| `toolRegistry.js` | 47 определений инструментов (OpenAI format) |
| `host/index.jsx` | ExtendScript: все операции в After Effects |
| `main.js` | UI, сессии, markdown, KB injection, quick actions, export/report |

### Остальное

| Путь | Назначение |
|------|------------|
| `index.html`, `styles.css` | Разметка и стили панели |
| `CSXS/manifest.xml` | Манифест CEP |
| `lib/CSInterface.js` | Adobe CSInterface (устанавливается вручную) |
| `lib/captureMacOS.js` | Захват экрана (macOS screencapture) |
| `lib/ollamaVision.js` | Legacy vision module (не используется) |
| `config/` | Конфиг и API-ключи |
| `knowledge-base/` | Корпус документации AE expressions |
| `legacy-archive/` | Архив модулей старой архитектуры |
| `docs/` | Документация |

---

## Конфигурация

Три файла в порядке загрузки:

1. `config/example.config.js` — defaults (tracked)
2. `config/runtime-config.js` — optional overrides (gitignored)
3. `config/secrets.local.js` — API key (gitignored)

Подробности: [docs/configuration.md](docs/configuration.md), [docs/secret-handling.md](docs/secret-handling.md).

---

## API-провайдер

- **Cloud.ru Foundation Models** — chat/completions с tool calling и SSE streaming

---

## Известные ограничения

- Нет рендера (`renderQueue.render()` блокирует UI)
- Нет spatial bezier handles (только temporal easing)
- Работает только с активной композицией
- Freeform mask paths ограничены (простые формы работают)
- Модели иногда путают anchor point / position (смягчается промптом)

Полный список: [docs/capabilities-and-roadmap.md](docs/capabilities-and-roadmap.md).

---

## Тестирование

- Шаблон тестов: [docs/manual-test-v3.md](docs/manual-test-v3.md)
- Release checklist: [docs/release-checklist.md](docs/release-checklist.md)

---

## Добавление нового инструмента

1. ExtendScript функция в `host/index.jsx`
2. Tool definition в `toolRegistry.js`
3. Case в `hostBridge.js`
4. Обновить `agentSystemPrompt.js` если нужно
5. Если read-only — добавить в `READ_ONLY_TOOLS` в `main.js`

Подробнее: [docs/final-architecture.md](docs/final-architecture.md).

---

## Troubleshooting

[docs/troubleshooting.md](docs/troubleshooting.md)

---

## Документация

[docs/README.md](docs/README.md) — индекс всех документов.
