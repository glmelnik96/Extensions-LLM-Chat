# QA Test Plan (AE Motion Agent)

Краткий smoke-чеклист. Полная матрица на 40 тестов (12 блоков): [manual-test-v3.md](manual-test-v3.md).

---

## 1. Запуск и конфиг

1. Открыть панель в AE — без ошибок, статус **Ready**.
2. Без ключа: **Send** → сообщение о `secrets.local.js`, без падения.
3. С ключом: **Send** работает.

---

## 2. Сессии

4. **New** — новая сессия, чат пустой.
5. Переключение между сессиями — разный transcript и модель.
6. **Rename**, **Clear**, **Clear All** — ожидаемое поведение, восстановление после перезагрузки.

---

## 3. Агент и инструменты

7. Простой запрос (создать слой, анимировать) — карточки tool calls + итоговый текст.
8. **Undo** — откат всех мутирующих действий.
9. Ошибка инструмента — `error` в карточке, панель стабильна.
10. **Stop** — отмена выполнения.

---

## 4. Shape content

11. "Создай красный круг" — shape layer с ellipse и fill.
12. "Создай прямоугольник с округлением" — rectangle с roundness.

---

## 5. 3D / Camera / Light

13. "Включи 3D на слое" — `threeDLayer = true`.
14. "Создай камеру с zoom 800" — camera layer.

---

## 6. Маски

15. "Добавь маску с feather 30" — маска с feather.
16. "Покажи маски слоя" — `get_mask_info` возвращает данные.
17. "Добавь subtract маску" — результат содержит `actualMode: "subtract"`.
18. "Создай маски из контуров текста" (на text layer) — `create_masks_from_text` создаёт маски.

---

## 7. Маркеры

19. "Добавь маркер на 2 секунде" — маркер создан.
20. "Покажи маркеры" — список маркеров.

---

## 8. Импорт

21. "Покажи элементы проекта" — `list_project_items`.
22. "Импортируй файл" (подготовить PNG) — файл в Project panel.

---

## 9. Превью

23. "Покажи текущий кадр" — `capture_comp_frame` → картинка в чате.

---

## 10. Streaming и UX

24. Отправить запрос — текст появляется по мере генерации.
25. Quick action (Wiggle) — prompt отправляется.
26. Textarea растёт при наборе текста.
27. Session metadata видна в sidebar.

---

## 11. Preset toolbar

28. Dropdown пресетов открывается, выбор меняет название.
29. **Apply preset** на выделенных слоях — пресет применён.
30. Без выделенных слоёв — ошибка, панель стабильна.

---

## 12. Export / Report

31. **Export** — JSON файл на Desktop.
32. **Report** — LLM-обработанный отчёт + raw JSON на Desktop.

---

## 13. Выражения

33. Expression с ошибкой — агент обнаруживает, исправляет, retry.
34. `get_expression` — возвращает текст существующего выражения.

---

## 14. Phase 11 — исправления

35. Easing на Position — keyframes с easing без ошибки `setTemporalEaseAtKey`.
36. Без открытой композиции — системное предупреждение перед запуском агента.
37. `add_mask(mode: "subtract")` — результат содержит `actualMode` и `warnings` при ошибке.

---

## 15. Brand Presets (Cloud.ru)

### Подготовка
- Композиция 1920×1080, 10 сек, CTI на 0
- Шрифты SBSansDisplay-Semibold, SBSansText-Regular установлены (если нет — тест 38a проверяет fallback)

### UI (вкладка Presets & Logs)

38. Brand dropdown открывается, выбор Logo Reveal / Lower Third / Text Card переключает поля:
    - Logo Reveal: скрыто Name, показан Subline, duration=2.2
    - Lower Third: Name + Title, duration=5
    - Text Card: Line 1 + Line 2, duration=7
39. **Apply** без открытой композиции — ошибка в чате, панель стабильна.

### Logo Reveal (кнопка Apply)

40. Apply Logo Reveal (дефолт, duration=2.2)
    **Ожидание:** 3+ слоёв: "Logo Reveal Ctrl" (null, opacity=0), "Logo Icon" (shape, 3 paths зелёный куб), "Cloud.ru Text" (text). Все parented к null.
    **Проверяем:** Icon Position имеет 4 keyframes (elastic overshoot), Scale 4 keyframes (0→130→90→100), Opacity 0→100.
41. Apply Logo Reveal с subline (ввести текст в поле Subline)
    **Ожидание:** +слой "Subline" с fade+slide-in после logo. Parented к null.
42. Apply Logo Reveal с subline + bg (включить with_background)
    **Ожидание:** +слой "Subline BG" (dark bar, horizontal grow). Parented к null.
43. **Undo** — все слои Logo Reveal удалены одним undo.

### Lower Third (кнопка Apply)

44. Apply Lower Third (name="Иван Иванов", title="Директор", duration=5)
    **Ожидание:** 7 слоёв: "LT Controller" (null, opacity=0), "LT Bar 1", "LT Bar 2", "LT Flash 1", "LT Flash 2", "LT Name", "LT Title". Все parented к null.
    **Проверяем:**
    - Bars: scaleX 0→122.8→hold→0 (bar1), 0→91.5→hold→0 (bar2, stagger 240ms)
    - Flash bars имеют opacity keyframes (80→0→0→80)
    - Bars растут от левого края (не от центра!)
    - Текст появляется с задержкой (inPoint stagger)
45. Apply Lower Third с duration=3 (минимальная безопасная)
    **Ожидание:** Анимация без наложения keyframes — bar2 hold phase > 0.
46. **Undo** — все слои удалены одним undo.

### Text Card (кнопка Apply)

47. Apply Text Card (line1="Облачные", line2="Технологии", duration=7)
    **Ожидание:** 4 слоя: "TC Controller" (null, opacity=0), "TC Bar 1" (shape), "TC Line 1", "TC Line 2". Все parented к null.
    **Проверяем:**
    - fontSize=100 (не 80), без Scale [50,50]
    - Bar scaleX: 0→102→hold→0, stagger 400ms
    - Цвет текста: Brand Light Green [0.812, 0.961, 0]
    - Шрифт: SBSansDisplay-Semibold
48. Apply Text Card 4 строки (line3, line4 через чат: "создай текстовую плашку: строка1 / строка2 / строка3 / строка4")
    **Ожидание:** 2 bar группы, 4 текста, 1 null = 7 слоёв. Bar 2 stagger 400ms, target scaleX=80.
49. **Undo** — все слои удалены одним undo.

### Agent (через чат)

50. "Создай логошот Cloud.ru" → агент вызывает `apply_brand_logo_reveal`.
51. "Добавь нижнюю плашку для Петра Сидорова, продакт-менеджер" → агент вызывает `apply_brand_lower_third` с правильными name/title.
52. "Сделай SMM плашку: Облачная / Платформа" → агент вызывает `apply_brand_text_card`.

### Parent Null (общий контроль)

53. После создания любого пресета — выбрать null контроллер, изменить Scale на [150,150] → все дочерние элементы масштабируются пропорционально.
54. Переместить null → все дочерние элементы смещаются вместе.

### Edge Cases

55. Apply пресет на CTI=8s в 10-секундной композиции — keyframes выходят за duration. Анимация создаётся, ошибок нет.
56. Apply пресет без установленных SB Sans шрифтов — текст создаётся с fallback шрифтом, без ошибок (38a).
