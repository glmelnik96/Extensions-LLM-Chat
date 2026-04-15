# Brand Animation Roadmap — AE Motion Agent

> Анализ проектов Cloud.ru NewBB и план внедрения брендовых анимаций в панель.
> Дата анализа: 2026-04-15

---

## 1. Анализ проектов

### Источник: `/Desktop/Collects NewBB/`

Проанализировано **5 AE-проектов** (61+ композиция), покрывающих основные сценарии брендинга Cloud.ru:

| Проект | Композиций | Форматы | Основные элементы |
|--------|-----------|---------|-------------------|
| **SMM_Pack** | 20 | 1x1, 9x16 | Pattern BG, overlays, transitions, плашки |
| **Вебинары** | 15 | 1x1, 9x16 | Заставки со спикером/вижуалом, таймеры, логоблок |
| **Логошоты** | 10 | horizontal, vertical | Logo reveal + текстовые саблайны |
| **Обучающие курсы** | 13 | 3x2, 16x9 | Обложки, оверлеи, переходы, визуалы |
| **Titles** | 1 | — | Подписи спикеров (lower thirds) |

### Общие паттерны

**Шрифты:** SB Sans Display (Semibold, Regular), SB Sans Text (Regular)

**Используемые эффекты:**
- Fill (заливка shape/solid) — 4 проекта
- Fractal Noise (текстуры, паттерны) — 3 проекта
- Slider Control (параметры для expressions) — 3 проекта
- CC RepeTile (тайлинг паттернов) — 1 проект
- CC Threshold RGB (стилизация) — 1 проект
- CC Vignette (виньетирование) — 1 проект
- Lumetri Color (цветокоррекция) — 1 проект

**Архитектурные паттерны:**
1. **Multi-aspect ratio**: каждая анимация существует в 1x1, 9x16, 16x9, 3x2
2. **Precomp nesting**: основные элементы (Logo, Pattern, Timer, Speaker) в прекомпах
3. **Slider-driven**: параметры анимации через Slider Control для гибкости
4. **Pattern-based backgrounds**: геометрические паттерны (стрелки, формы) с CC RepeTile
5. **Self-contained logo shots**: не требуют внешних файлов — всё на shape layers

---

## 2. Категории анимаций для внедрения

### Категория A: Logo Shots (Высокий приоритет)

**Текущий проект:** Логошоты — 10 вариаций логоанимаций.

**Что нужно воспроизводить:**
- Logo reveal: scale 0% → 100% с easing + опциональный Fractal Noise texture
- Саблайн (подпись): fade/slide in после логотипа
- Плашка: цветная полоса-подложка за текстом
- Форматы: horizontal (16:9) и vertical (9:16)

**Оценка сложности:** ⭐⭐ Средняя
- Shape layers для логотипа — уже поддерживается (`add_shape_path`, `add_shape_rectangle`)
- Fill эффект — уже поддерживается (`add_effect("ADBE Fill")`)
- Slider Control для параметров — уже поддерживается
- Keyframe анимация scale/opacity/position — уже поддерживается

**Что нужно добавить:**
- Preset `logo_reveal` с параметрами (duration, delay, с/без саблайна)
- Template: создание composition нужного формата + logo layers

---

### Категория B: Text Block Animations (Высокий приоритет)

**Текущие проекты:** Titles (подписи спикеров), плашки из SMM_Pack.

**Что нужно воспроизводить:**
- Lower third: имя + должность с анимацией появления
- Плашка: цветной прямоугольник + текст поверх, анимация slide + fade
- Title card: крупный текст по центру с анимацией
- Подпись спикера: компактный блок с анимацией появления/исчезновения

**Оценка сложности:** ⭐⭐ Средняя
- Text layers — поддерживается (`create_layer(text)` + `set_text_document`)
- Shape layer подложка — поддерживается
- Keyframe анимации — поддерживается
- Easing — поддерживается

**Что нужно добавить:**
- Preset `lower_third` (имя, должность, стиль, duration)
- Preset `text_card` (текст, позиция, стиль анимации)
- Автоматическое создание подложки (shape) под текст с адаптивным размером

---

### Категория C: Pattern Backgrounds (Средний приоритет)

**Текущие проекты:** SMM_Pack — BG_pattern, Pattern_edit, Pattern_strelki.

**Что нужно воспроизводить:**
- Геометрические паттерны из shape layers (стрелки, точки, линии)
- Тайлинг через CC RepeTile
- Анимированное движение паттерна (position keyframes)
- Fractal Noise подложка для текстурного фона

**Оценка сложности:** ⭐⭐⭐ Высокая
- Shape paths для элементов паттерна — поддерживается (`add_shape_path`)
- CC RepeTile — нет в списке matchNames, нужно добавить
- Fractal Noise — нет в списке matchNames, нужно добавить
- Циклическая анимация — `loopOut("cycle")` уже поддерживается

**Что нужно добавить:**
- Новые matchNames для эффектов: `"CC RepeTile"`, `"ADBE Fractal Noise"`
- Preset `pattern_bg` (тип паттерна, цвет, скорость, формат)
- Shape generators: создание базовых форм для паттернов (стрелки, круги, линии)

---

### Категория D: Transitions (Средний приоритет)

**Текущие проекты:** SMM_Pack — Transition_gray/green/white, Transition with Logo.

**Что нужно воспроизводить:**
- Цветной slide-wipe переход (shape layer mask + keyframes)
- Transition с логотипом (logo появляется в середине перехода)
- Несколько цветовых вариантов (gray, green, white — фирменные цвета)

**Оценка сложности:** ⭐⭐ Средняя
- Shape layers для wipe — поддерживается
- Маски — поддерживается (`add_mask` + keyframes на expansion/path)
- Adjustment layers — поддерживается

**Что нужно добавить:**
- Preset `transition_wipe` (цвет, направление, duration, с/без логотипа)
- Автоматический расчёт keyframes для wipe анимации

---

### Категория E: Overlays (Средний приоритет)

**Текущие проекты:** SMM_Pack — Оверлей_1x1/9x16, Обучающие курсы — оверлеи.

**Что нужно воспроизводить:**
- Полупрозрачный фрейм поверх видео (shape layers + low opacity)
- Анимированные элементы по краям (линии, точки, фирменные метки)
- Формат-зависимый лейаут (1x1, 9x16, 16x9, 3x2)

**Оценка сложности:** ⭐⭐ Средняя
- Shape layers — поддерживается
- Opacity — поддерживается
- Всё стандартное

**Что нужно добавить:**
- Preset `overlay_frame` (формат, цвет, стиль, opacity)
- Авто-расчёт позиций элементов для разных аспектных соотношений

---

### Категория F: Timer / Countdown (Низкий приоритет)

**Текущие проекты:** Вебинары — Timer precomp, таймер с вижуалом/спикером.

**Что нужно воспроизводить:**
- Текстовый таймер с обратным отсчётом
- Визуальный индикатор прогресса (circle/bar)
- Анимированное обновление цифр

**Оценка сложности:** ⭐⭐ Средняя
- Text expressions для таймера — уже поддерживается
- Shape layer для индикатора — поддерживается
- `Slider Control` + expression — поддерживается

**Что нужно добавить:**
- Preset `countdown_timer` (формат, длительность, стиль)

---

### Категория G: Speaker Templates (Низкий приоритет)

**Текущие проекты:** Вебинары — заставки со спикером, Обучающие курсы — оверлей со спикером.

**Что нужно воспроизводить:**
- Фото спикера + обрезка (маска)
- Текстовый блок: имя, должность, тема
- Фоновое видео/паттерн
- Анимация появления всех элементов

**Оценка сложности:** ⭐⭐⭐ Высокая
- Требует импорт изображений — поддерживается (`import_file` + `add_item_to_comp`)
- Маски для обрезки — поддерживается
- Текст + анимация — поддерживается
- Комплексная сборка из многих элементов

**Что нужно добавить:**
- Template `speaker_card` (имя, должность, тема, путь к фото, формат)
- Workflow из 8+ шагов

---

## 3. Матрица готовности инструментов

| Возможность | Статус | Инструмент |
|-------------|--------|------------|
| Shape rectangle/ellipse/path | ✅ Есть | `add_shape_rectangle/ellipse/path` |
| Fill эффект | ✅ Есть | `add_effect("ADBE Fill")` |
| Slider Control | ✅ Есть | `add_effect("ADBE Slider Control")` |
| Text layers | ✅ Есть | `create_layer(text)` + `set_text_document` |
| Keyframe animation | ✅ Есть | `add_keyframes` |
| Expressions | ✅ Есть | `apply_expression` |
| Masks | ✅ Есть | `add_mask` + keyframes |
| Import footage | ✅ Есть | `import_file` + `add_item_to_comp` |
| Adjustment layers | ✅ Есть | `create_layer(adjustment)` |
| Parenting | ✅ Есть | `set_parent` |
| Fractal Noise | ⚠ matchName нужен | `"ADBE Fractal Noise"` |
| CC RepeTile | ⚠ matchName нужен | `"CC RepeTile"` |
| CC Vignette | ⚠ matchName нужен | `"CC Vignette"` |
| Lumetri Color | ⚠ matchName нужен | `"ADBE Lumetri"` |
| CC Threshold RGB | ⚠ matchName нужен | `"CC Threshold RGB"` |
| Create composition | ❌ Нет инструмента | Нужен `create_composition` |
| Duplicate layer | ❌ Нет инструмента | Нужен `duplicate_layer` |
| Set blend mode | ❌ Нет инструмента | Нужен `set_blend_mode` |
| Track matte | ❌ Нет инструмента | Нужен `set_track_matte` |
| Pre-compose | ❌ Нет инструмента | Нужен `precompose_layers` |
| Set layer in/out point | ❌ Нет инструмента | Нужен `set_layer_timing` |

---

## 4. Roadmap внедрения

### Phase 1: Foundation Tools (1-2 недели)

Добавить недостающие инструменты, необходимые для всех категорий:

| # | Инструмент | Описание | Приоритет |
|---|-----------|----------|-----------|
| 1 | `create_composition` | Новая композиция: name, width, height, fps, duration | Критический |
| 2 | `duplicate_layer` | Дублирование слоя | Критический |
| 3 | `set_blend_mode` | Режим наложения (Add, Multiply, Screen, etc.) | Высокий |
| 4 | `set_track_matte` | Track matte (Alpha, Luma, etc.) | Высокий |
| 5 | `precompose_layers` | Прекомпозиция выбранных слоёв | Средний |
| 6 | `set_layer_timing` | In/Out point, start time слоя | Средний |

**Обновить matchName таблицу в `agentSystemPrompt.js`:**
```
- Fractal Noise: "ADBE Fractal Noise"
- CC RepeTile: "CC RepeTile"
- CC Vignette: "CC Vignette"
- Lumetri Color: "ADBE Lumetri"
- CC Threshold RGB: "CC Threshold RGB"
```

### Phase 2: Brand Presets — Logo & Text (2-3 недели)

**Preset 1: `brand_logo_reveal`**
```
Параметры: duration, delay, with_subline, subline_text, color_scheme, format (16:9 / 9:16)
Workflow:
1. create_composition (формат)
2. Создать shape layers для логотипа (или import SVG)
3. Анимация scale 0→100% с bezier easing
4. Опционально: саблайн fade in после logo
5. Fill эффект для цветовой схемы
```

**Preset 2: `brand_lower_third`**
```
Параметры: name, title, duration, style (minimal/with_bar), color
Workflow:
1. Shape layer подложка (rectangle с roundness)
2. Text layer: имя (bold) + должность (regular)
3. Анимация: slide in from left + fade in
4. Auto-out: slide out + fade out в конце duration
5. sourceRectAtTime для адаптивного размера подложки
```

**Preset 3: `brand_text_card`**
```
Параметры: text, position (center/top/bottom), style, duration
Workflow:
1. Опциональная подложка shape
2. Text layer по центру
3. Scale + opacity анимация появления
4. Auto-out
```

### Phase 3: Brand Presets — Backgrounds & Transitions (2-3 недели)

**Preset 4: `brand_pattern_bg`**
```
Параметры: pattern_type (arrows/dots/lines/grid), color, speed, format
Workflow:
1. Shape layer с паттерном элементов
2. CC RepeTile для тайлинга
3. Position keyframes + loopOut("cycle") для движения
4. Опционально: Fractal Noise фон
```

**Preset 5: `brand_transition_wipe`**
```
Параметры: color (gray/green/white/custom), direction (left/right/up/down), duration, with_logo
Workflow:
1. Shape layer (rectangle full-screen)
2. Position keyframes: off-screen → cover → off-screen
3. Опционально: logo layer поверх в середине
4. Fill для цвета
```

**Preset 6: `brand_overlay_frame`**
```
Параметры: format (1x1/9x16/16x9), color, opacity, style
Workflow:
1. Shape layers: рамка по краям (lines/corners)
2. Opacity для полупрозрачности
3. Minimal анимация элементов
```

### Phase 4: Complex Templates (3-4 недели)

**Template 1: `brand_webinar_intro`**
```
Параметры: speaker_name, speaker_title, topic, speaker_photo_path, bg_video_path, format
Workflow (10+ шагов):
1. create_composition
2. import_file (bg video) → add_item_to_comp
3. Pattern overlay (precomp)
4. import_file (speaker photo) → mask circle crop
5. Text layers: тема, спикер, должность
6. Logo precomp
7. Staggered animation (logo → text → speaker → bg)
```

**Template 2: `brand_course_cover`**
```
Параметры: course_title, visual_path, format (3x2/16x9)
Workflow:
1. create_composition
2. Pattern background
3. Visual image import
4. Text layers
5. Logo block
6. Coordinated animations
```

**Template 3: `brand_countdown_timer`**
```
Параметры: total_seconds, style (circle/bar/numeric), color
Workflow:
1. Text layer с expression: Math.floor(slider/60) + ":" + pad(slider%60)
2. Slider Control: animated from total_seconds to 0
3. Visual indicator: shape layer trim paths / scale
```

### Phase 5: Multi-Format System (2 недели)

Система автоматической генерации нескольких форматов:

```
brand_multiformat({
  template: "webinar_intro",
  formats: ["1x1", "9x16", "16x9"],
  params: { speaker_name: "...", ... }
})
```

Для каждого формата:
1. Создать отдельную composition с нужными размерами
2. Пересчитать позиции элементов для формата
3. Применить тот же набор анимаций

---

## 5. Приоритеты и оценка трудоёмкости

| Phase | Описание | Трудоёмкость | Ценность | Приоритет |
|-------|----------|-------------|----------|-----------|
| 1 | Foundation Tools | 1-2 нед | Критическая (blocker) | P0 |
| 2 | Logo & Text Presets | 2-3 нед | Высокая (покрывает 60% use cases) | P1 |
| 3 | BG & Transitions | 2-3 нед | Средняя | P2 |
| 4 | Complex Templates | 3-4 нед | Средняя-Высокая | P2 |
| 5 | Multi-Format | 2 нед | Высокая (автоматизация) | P3 |

**Итого:** ~10-14 недель для полного внедрения.
**MVP (Phase 1+2):** ~3-5 недель — покрывает логошоты, lower thirds, text cards.

---

## 6. Архитектура (решение принято)

### Гибридный подход (Вариант C)

**Простые пресеты** (logo_reveal, lower_third, text_card, transition_wipe) → **детерминированные ExtendScript функции** в `host/index.jsx`. Фиксированные keyframes, не требуют LLM, быстро и предсказуемо.

**Сложные шаблоны** (webinar_intro, course_cover, speaker_card) → **prompt-driven через агента**. Нажатие "Apply" отправляет промпт-шаблон с параметрами → агент вызывает существующие tools.

### Два пути вызова brand presets

1. **Вкладка Presets** — dropdown с brand presets, поля параметров, кнопка Apply
2. **Чат по ключевым словам** — агент распознаёт запрос и вызывает нужный preset tool

Ключевые слова для агента (в `agentSystemPrompt.js`):
- "логошот", "logo shot", "logo reveal" → `apply_brand_logo_reveal`
- "lower third", "подпись спикера", "плашка с текстом" → `apply_brand_lower_third`
- "текстовый блок", "text card", "title card" → `apply_brand_text_card`
- "переход", "transition", "wipe" → `apply_brand_transition`

### Файловая структура

```
brandPresets.js          — конфиг: метаданные, параметры, UI labels, ключевые слова
host/index.jsx           — детерминированные ExtendScript функции (apply_brand_*)
hostBridge.js            — mapping tool name → ExtendScript
toolRegistry.js          — OpenAI tool definitions для brand presets
agentSystemPrompt.js     — ключевые слова + workflow guidance
index.html               — UI: brand preset section во вкладке Presets
main.js                  — buildBrandPresetCallFromUi(), brand preset dropdown logic
```

### Конфиг brand presets (`brandPresets.js`)

```js
window.BRAND_PRESETS = {
  logo_reveal: {
    label: "Logo Reveal",
    category: "deterministic",    // → ExtendScript
    keywords: ["логошот", "logo shot", "logo reveal"],
    params: [
      { name: "duration", type: "number", default: 2, min: 0.5, max: 5, label: "Duration (s)" },
      { name: "with_subline", type: "boolean", default: true, label: "With subline" },
      { name: "subline_text", type: "string", default: "Умное облако", label: "Subline text" },
      { name: "format", type: "enum", values: ["16:9", "9:16"], default: "16:9", label: "Format" }
    ]
  },
  lower_third: {
    label: "Lower Third",
    category: "deterministic",
    keywords: ["lower third", "подпись спикера", "подпись", "speaker title"],
    params: [
      { name: "name", type: "string", default: "", label: "Name" },
      { name: "title", type: "string", default: "", label: "Title/Position" },
      { name: "duration", type: "number", default: 4, min: 1, max: 10, label: "Duration (s)" },
      { name: "style", type: "enum", values: ["minimal", "with_bar"], default: "with_bar", label: "Style" }
    ]
  },
  text_card: {
    label: "Text Card",
    category: "deterministic",
    keywords: ["текстовый блок", "text card", "title card", "плашка"],
    params: [
      { name: "text", type: "string", default: "", label: "Text" },
      { name: "with_shape_bg", type: "boolean", default: true, label: "Shape background" },
      { name: "position", type: "enum", values: ["center", "top", "bottom"], default: "center", label: "Position" },
      { name: "duration", type: "number", default: 3, min: 0.5, max: 10, label: "Duration (s)" }
    ]
  },
  webinar_intro: {
    label: "Webinar Intro",
    category: "agent",            // → prompt-driven
    keywords: ["вебинар", "webinar", "заставка вебинара"],
    params: [
      { name: "speaker_name", type: "string", default: "", label: "Speaker" },
      { name: "speaker_title", type: "string", default: "", label: "Speaker title" },
      { name: "topic", type: "string", default: "", label: "Topic" },
      { name: "format", type: "enum", values: ["16:9", "9:16", "1:1"], default: "16:9", label: "Format" }
    ],
    promptTemplate: "Create a webinar intro: speaker {{speaker_name}} ({{speaker_title}}), topic '{{topic}}', format {{format}}. Use Cloud.ru brand style: SB Sans Display font, brand colors. Create pattern background, logo block, speaker text block with staggered animation."
  }
}
```

### Цветовая палитра Cloud.ru

> **TODO:** Заполнить из Figma

```js
window.BRAND_COLORS = {
  green:     [0, 0, 0],    // TODO: из Figma
  gray:      [0, 0, 0],    // TODO: из Figma
  white:     [1, 1, 1],
  black:     [0, 0, 0],
  text:      [0, 0, 0],    // TODO: из Figma
  textAlt:   [0, 0, 0]     // TODO: из Figma
}
```

### Шрифты (из проектов)

| Шрифт | Стиль | Использование |
|-------|-------|---------------|
| SB Sans Display | Semibold | Заголовки, логошоты |
| SB Sans Display | Regular | Основной текст |
| SB Sans Text | Regular | Подписи спикеров |

---

## 7. MVP Scope (решение принято)

### MVP: Logo Reveal + Text Blocks

| Preset | Тип | Приоритет |
|--------|-----|-----------|
| `brand_logo_reveal` | Детерминированный | P0 |
| `brand_lower_third` | Детерминированный | P0 |
| `brand_text_card` | Детерминированный | P1 |
| `brand_transition_wipe` | Детерминированный | P2 |
| `brand_webinar_intro` | Agent-driven | P3 |

### Блокеры MVP

| Что нужно | Статус | Как получить |
|-----------|--------|-------------|
| Точные keyframes из проектов | ❌ | Открыть AEP → extraction guide → Export JSON |
| Логотип Cloud.ru (shape data) | ❌ | Figma → SVG → vertices |
| Цветовая палитра RGB | ❌ | Figma |

### Не блокеры (нужны позже для P2+)

| Инструмент | Зачем | Когда |
|-----------|-------|-------|
| `set_blend_mode` | Оверлеи, transitions (Add/Multiply/Screen) | Phase 3+ |

### Уже готовые инструменты

Из 47 tools — все базовые покрывают MVP:
- `create_layer`, `create_comp`, `duplicate_layer`, `precompose_layers`, `set_layer_timing` — есть
- `add_shape_*`, `set_text_document`, `add_keyframes`, `add_mask` — есть
- `add_effect("ADBE Fill")`, `add_effect("ADBE Slider Control")` — есть

### Extraction Guide

Подробная инструкция: [brand-extraction-guide.md](brand-extraction-guide.md)
