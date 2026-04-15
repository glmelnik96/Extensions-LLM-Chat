# AE Motion Agent v4 — Manual Test Checklist

> 47 инструментов. Тесты выполняются **последовательно**.
> Блоки A, B, C, E, F, G, H, J полностью прошли 2026-04-15.

---

## Пройденные блоки (справка)

| Блок | Тесты | Статус |
|------|-------|--------|
| A — Базовые операции | create_layer, expression retry, keyframes, undo, get_expression, cancel | ✅ |
| B — Shape Content | rectangle, ellipse, custom path, shape+animation | ✅ |
| C — 3D / Camera / Light | 3D toggle, camera, light | ✅ |
| E — Markers | add/read/delete layer+comp markers | ✅ |
| F — Import / Project Items | list, import, add to comp | ✅ |
| G — Frame Preview | capture, preview after changes | ✅ |
| H — Streaming & UX | streaming, quick actions, textarea, session metadata | ✅ |
| J — Large Comp & Compact | compact mode, layer filter | ✅ |

### Пройденные в прогоне 2 (2026-04-15)

| Тест | Статус | Заметки |
|------|--------|---------|
| Easing на Position | ✅ | `_getTemporalEaseDims` + retry работает |
| Text + set_text_document | ✅ | Двухшаговый подход работает |
| Mask Add + feather | ✅ | Маска создана, feather 30 |
| Expression MM:SS (Date limitation) | ✅ | Агент использовал `timeToCurrentFormat()` |
| Slider Control expression | ✅ | add_effect → apply_expression workflow |
| Shape без gradient | ✅ | Ellipse + stroke + rotation |
| Export errors | ✅ | JSON с 4 ошибками корректно |
| Export full | ✅ | Полный JSON сессий |

---

## Подготовка

1. Открыть After Effects
2. **НЕ** открывать композицию (для теста 1)

---

## Тест 1. No-comp warning ✅

**Действие:** Панель не даёт вводить текст без активной композиции.
**Результат:** Пройден — панель блокирует ввод без открытой композиции.

> После теста: **создать композицию** (1920×1080, 5 сек).

---

## Тест 2. Создание solid + маска Add

**Действие:** "Создай красный solid и добавь маску с feather 30px"
**Ожидание:** Solid создан, маска Add mode, feather 30px. Результат содержит `actualMode`.
**Проверяем:** `add_mask` mode fix — раньше `TypeError: null is not an object` при доступе к mode property.
**Фикс прогона 3:** Пробуем несколько matchNames для mode property + fallback на `mask.maskMode`.

---

## Тест 3. Subtract mask + mode verification

**Зависит от:** Тест 2 (нужен solid + первая маска).
**Действие:** "Добавь вторую маску subtract mode в центре solid слоя"
**Ожидание:** `actualMode: "subtract"`. Если mode не установился — `warnings` в ответе.
**Проверяем:** `add_mask` mode fix + `setMaskProperties` mode fix.
**Прогон 2:** ⚠ mode failed (TypeError) + empty args. **Фиксы:** mode property lookup + prompt.

---

## Тест 4. Текстовый слой + Create Shapes from Text

**Действие:** "Создай текстовый слой HELLO, шрифт Arial, размер 120, белый. Затем создай shape-слой из контуров текста"
**Ожидание:** Text layer → `create_shapes_from_text` → новый shape layer с контурами букв.
**Проверяем:** `create_shapes_from_text` (замена сломанного `create_masks_from_text`, использует `app.executeCommand(3736)`).
**Прогон 2:** ❌ старая функция не работала (command ID 9158 не существует). **Фикс:** полная замена на `create_shapes_from_text`.

---

## Тест 5. set_property_value на свойстве с keyframes

**Действие:** "Анимируй позицию solid из [100,100] в [960,540] за 1 секунду. Затем установи позицию solid в [500,500]"
**Ожидание:** Второй вызов `set_property_value` удаляет keyframes и ставит статическое значение. Ответ содержит `keyframesRemoved: true`.
**Проверяем:** `set_property_value` при наличии keyframes.
**Прогон 2:** ❌ `setValue()` на keyed property → AE error. **Фикс:** автоматическое удаление keyframes перед setValue.

---

## Тест 6. 3D scene — agent layer_index

**Действие:** "Создай простую 3D сцену: 3 solid слоя на разной глубине и камеру"
**Ожидание:** Все tool calls содержат `layer_index` или `layer_id`. Нет ошибок "Layer not found" от пустых args.
**Проверяем:** Prompt fix — agent always provides layer_index.
**Прогон 2:** ⚠ `set_layer_3d({})` → "Layer not found". **Фикс:** усилено в prompt.

---

## Тест 7. Text reveal через shapes + matte

**Зависит от:** Текстовый слой (создаётся в тесте).
**Действие:** "Создай текст REVEAL и сделай reveal анимацию через контуры букв"
**Ожидание:** Agent: create text → `create_shapes_from_text` → animate (scale/opacity на shape layer, или mask expansion, или track matte).
**Проверяем:** Полный workflow с новым инструментом.

---

## Тест 8. Mask property path animation

**Действие:** "Добавь маску на solid и анимируй её expansion от -200 до 0 за 1 секунду"
**Ожидание:** `add_mask` → `add_keyframes("Masks>Mask 1>Mask Expansion", ...)` — путь резолвится через alias-таблицу.
**Проверяем:** `_resolveProperty` alias для mask properties.
**Прогон 2:** ❌ `Masks>Mask 1>Expansion` → "not found". **Фикс:** alias-таблица.

---

## Тест 9. get_property_value на Text>Source Text

**Действие:** "Прочитай значение Source Text на текстовом слое"
**Ожидание:** Результат содержит `value: {text: "...", font: "...", fontSize: ...}` — структурированный объект.
**Проверяем:** TextDocument сериализация.
**Прогон 2:** ❌ "Host returned empty result". **Фикс:** TextDocument → plain object extraction.

---

## Тест 10. Report с прогрессом

**Действие:** Нажать кнопку **Report**.
**Ожидание:** В чате появляются сообщения "📊 Report: analyzing N chunk(s)..." и "✅ Report saved to ~/Desktop/...". Файлы .md и .json на Desktop.
**Проверяем:** Report progress + serializer fix.
**Прогон 2:** ❌ crash `undefined.substring`. **Фикс:** serializer переписан.

---

## Результаты

| # | Тест | Прогон 2 | Прогон 3 |
|---|------|----------|----------|
| 1 | No-comp warning | ✅ | — |
| 2 | Mask Add + mode | ⚠ TypeError | |
| 3 | Mask Subtract + mode | ⚠ TypeError + empty args | |
| 4 | Create Shapes from Text | ❌ cmd не существует | |
| 5 | set_property_value + keyframes | ❌ AE error | |
| 6 | 3D scene + layer_index | ⚠ empty args | |
| 7 | Text reveal via shapes | ❌ cmd + path | |
| 8 | Mask property path | ❌ not found | |
| 9 | get_property_value TextDoc | ❌ empty result | |
| 10 | Report с прогрессом | ❌ crash | |
