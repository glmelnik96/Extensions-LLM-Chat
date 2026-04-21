# Brand Presets — Current State (2026-04-16)

> **Статус:** текущий код работоспособен технически, но анимации не соответствуют референсам.
> **Новый подход:** ручное пошаговое кодирование ExtendScript по новому JSON + скриншотам + руководству от пользователя. Начинаем с анимаций текста.

---

## Что работает

### Техническая инфраструктура
- **UI:** Вкладка Presets & Logs, dropdown с 3 пресетами, динамические поля параметров
- **Агент:** Распознавание ключевых слов ("логошот", "lower third", "текстовый блок") → автовызов tool
- **Pipeline:** UI Apply / chat keyword → toolRegistry → hostBridge → ExtendScript → результат в чат
- **Undo:** Все пресеты оборачиваются в beginUndoGroup/endUndoGroup

### Реализованные пресеты (3 функции в host/index.jsx)
| Пресет | Функция | Параметры |
|--------|---------|-----------|
| Logo Reveal | `extensionsLlmChat_applyBrandLogoReveal` | duration, with_subline, subline_text, with_background |
| Lower Third | `extensionsLlmChat_applyBrandLowerThird` | name_text, title_text, display_duration |
| Text Card | `extensionsLlmChat_applyBrandTextCard` | line1-4, display_duration |

### Файловая структура
```
brandPresets.js      — конфиг: цвета, шрифты, labels, defaults, keywords
host/index.jsx       — ExtendScript функции (~lines 1315-1850)
hostBridge.js        — mapping tool name → ExtendScript (lines 558-585)
toolRegistry.js      — 3 tool definitions (lines 889-940)
main.js              — UI handlers (lines 159-291)
index.html           — Brand preset UI section
agentSystemPrompt.js — ключевые слова для агента
```

### Helpers в host/index.jsx
- `_addBrandPath` — straight-line shape paths (SVG → AE vertices)
- `_addBrandFill` — shape fill
- `_addBrandRect` — rectangle shape с опциональным offset
- `_createBrandWipeBar` — left-edge anchored bar (scaleX grows rightward)
- `_setTextDoc` — text document setup с try/catch для font/text
- `_addTextRevealAnimator` — character-by-character reveal via AE Text Animator + Range Selector

---

## Что НЕ работает

### Анимации не соответствуют референсам
Несмотря на несколько итераций фиксов (scale values, easing, Linear Wipe, character reveal, bar timing), визуальный результат кардинально отличается от референсных AE-проектов.

### Причина провала первой итерации
Подход "извлечь параметры из JSON → записать keyframes в ExtendScript" без визуального feedback loop не сходится:

1. **Техники не переносимы напрямую:** Референсы используют silhouetteAlpha track mattes, nested precomps, shape-path wipe reveals, 6-bar flash системы — всё это нельзя надёжно упростить до "задать N keyframes с такими значениями"
2. **Контекст теряется:** JSON extraction даёт числа, но не даёт визуальный контекст — как слои взаимодействуют через blend modes, маски, parenting chains
3. **Итеративная подгонка не сходится:** Каждый фикс одного параметра сдвигает баланс других. Без визуальной верификации в AE нет feedback loop

### Отклонённые альтернативы (2026-04-16)

**MOGRT import via ExtendScript** — технически невозможно:
- `ImportOptions` не поддерживает `.mogrt` формат
- Essential Graphics API доступен только для слоёв, размещённых вручную через панель EGP
- Подтверждено Architect и Critic review

**AEP precomp import** — отклонено пользователем:
- Хотя технически возможно (`ImportOptions` + `importAs = ImportAsType.COMP`), требует бандлить минимальные AEP-файлы и разрабатывать механизм параметризации через доступ к слоям precomp'а по именам
- Не соответствует желанию пользователя работать пошагово через чат-агента

---

## Выбранный подход (v3 — 2026-04-16)

**Ручное пошаговое кодирование ExtendScript через чат-агента.**

### Принципы
1. **Итерация на уровне одной анимации за раз** — не пресет целиком, а конкретный паттерн (character reveal, bar wipe, logo bounce)
2. **Пользователь предоставит новый JSON + скриншоты + руководство** для каждой анимации
3. **Визуальная верификация в AE** — пользователь проверяет каждый шаг, фиксирует расхождения
4. **Начинаем с анимаций текста** — character reveal, Linear Wipe, slide-in паттерны
5. **После подтверждения подхода на тексте** — масштабируем на shape-анимации (bars, flashes, logo)

### Workflow (цикл на одну анимацию)
1. Пользователь даёт: JSON с параметрами + скриншоты из AE + текстовое руководство
2. Я читаю данные, пишу ExtendScript-функцию
3. Пользователь тестирует в AE, даёт обратную связь (скриншот / описание расхождения)
4. Итерируем до визуального совпадения
5. Фиксируем паттерн → переходим к следующей анимации

### Текущая точка входа
**Ожидание:** пользователь подготовит JSON + скриншоты + guide для первой текстовой анимации.

---

## Доступные референсные материалы

### На Desktop (read-only, не в проекте)
- `/Desktop/Animation_params/Логошот_animation_params.json` — 10 compositions, ~650KB
- `/Desktop/Animation_params/Titles_animation_params.json` — 4 compositions
- `/Desktop/Animation_params/SSM pack_animation_params.json` — 21 compositions, ~2.4MB
- `/Desktop/Collects NewBB/` — оригинальные AE-проекты (5 штук, 61+ композиция)

### В проекте (docs/)
- `brand-presets-spec.md` — keyframe значения первой итерации (справочник)
- `brand-figma-assets.md` — SVG paths логотипа, color tokens

### Будет предоставлено пользователем
- Новый JSON с параметрами текстовых анимаций
- Скриншоты из AE (референс + текущий результат)
- Руководство по анимации (какой паттерн, какие параметры, как должно выглядеть)
