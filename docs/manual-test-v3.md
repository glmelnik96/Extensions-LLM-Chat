# AE Motion Agent — Manual Test Template

> Шаблон для ручного тестирования. Создавайте новые блоки тестов по этому формату.

---

## Подготовка

1. Открыть After Effects
2. Создать композицию 1920×1080, 5 сек (или использовать существующую)
3. Открыть панель Extensions LLM Chat

---

## Шаблон теста

### Тест N. Название

**Зависит от:** (предыдущий тест или «нет»)
**Действие:** "Текст запроса агенту"
**Ожидание:** Описание ожидаемого результата (tool calls, значения, поведение UI)
**Проверяем:** Какой именно код/фикс валидируется

---

## Результаты

| # | Тест | Статус | Заметки |
|---|------|--------|---------|
| 1 | ... | | |

---

## Пройденные блоки (справка)

Все тесты до прогона 5 включительно пройдены:

| Блок | Статус |
|------|--------|
| Базовые операции (create_layer, expression retry, keyframes, undo, get_expression, cancel) | ✅ |
| Shape Content (rectangle, ellipse, custom path, shape+animation) | ✅ |
| 3D / Camera / Light (3D toggle, camera, light) | ✅ |
| Masks (add, subtract, mode, expansion animation, text reveal, sourceRectAtTime) | ✅ |
| Markers (add/read/delete layer+comp markers) | ✅ |
| Import / Project Items (list, import, add to comp) | ✅ |
| Frame Preview (capture, preview after changes) | ✅ |
| Streaming & UX (streaming, quick actions, textarea, session metadata) | ✅ |
| Large Comp & Compact (compact mode, layer filter) | ✅ |
| Presets (Slide/Fade/Pop, multi-layer apply, tool log scope) | ✅ |
| UI (2-tab layout, model selector, footer, migration, tab switching) | ✅ |
