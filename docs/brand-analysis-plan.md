# Brand Animation Analysis — Plan

## Статус

### ✅ Завершено
- [x] `set_blend_mode` tool добавлен (48 инструментов)
- [x] JSON экстракции проанализированы (4 проекта, 70+ композиций)
- [x] Логошоты: keyframes, easing, structure → `brand-presets-spec.md`
- [x] Titles / Lower third: keyframes, rect sizes, stagger timing → `brand-presets-spec.md`
- [x] SMM Pack / Плашки: keyframes, colors, shapes → `brand-presets-spec.md`
- [x] SMM Pack / Transitions: position keyframes, colors → `brand-presets-spec.md`
- [x] Цветовая палитра Cloud.ru извлечена из проектов

### ✅ Figma (подключена)
- [x] Логотип SVG paths извлечены (icon 3 paths + text 1 path) → `brand-figma-assets.md`
- [x] Цвета подтверждены: #26D07C (icon), #222222 (text), #FFFFFF (bg)
- [ ] Типографика — SB Sans Display/Text (подтверждено из AE проектов, Figma не содержит доп. данных)

### ✅ Имплементация
- [x] brandPresets.js — config (colors, fonts, labels, defaults, keywords)
- [x] host/index.jsx — 3 ExtendScript preset functions + helpers (_addBrandPath, _addBrandRect, _createBrandWipeBar, _setTextDoc)
- [x] toolRegistry.js — 3 tool definitions (apply_brand_logo_reveal, apply_brand_lower_third, apply_brand_text_card)
- [x] hostBridge.js — bridge mappings for brand tools
- [x] main.js — brand UI handlers + BRAND_PRESET_LABELS dedup
- [x] index.html — brand preset UI section (dropdown, text fields, duration, apply)
- [x] agentSystemPrompt.js — brand section for agent keyword recognition
- [x] Аудит AE API: left-edge bar anchoring, parent nulls, elastic easing, min duration guard (3s)

### Следующий шаг
- [ ] Мануальное тестирование в AE (logo_reveal, lower_third, text_card)

## Промежуточные документы

| Документ | Содержание |
|----------|-----------|
| `brand-presets-spec.md` | **ГЛАВНЫЙ** — точные keyframes, easing, цвета, структуры для всех 4 presets |
| `brand-animation-roadmap.md` | Архитектура, MVP scope, блокеры |
| `brand-extraction-guide.md` | Инструкция извлечения (уже не нужна — автоматизировано) |
| `brand-figma-assets.md` | SVG paths логотипа, color tokens из Figma |
| `brand-analysis-plan.md` | Этот файл |
