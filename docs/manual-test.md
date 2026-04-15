# Manual Test — Brand Presets (Cloud.ru)

> Тесты для текущей фичи. После прохождения — результаты фиксируются внизу, тесты архивируются.

---

## Подготовка

1. Открыть After Effects
2. Создать композицию 1920x1080, 10 сек, CTI на 0
3. Открыть панель Extensions LLM Chat
4. Шрифты SBSansDisplay-Semibold, SBSansText-Regular (если нет — тест 18 проверяет fallback)

---

## UI (вкладка Presets & Logs)

### 1. Brand dropdown переключение полей

**Действие:** Открыть вкладку Presets & Logs, кликнуть Brand dropdown
**Ожидание:** Logo Reveal / Lower Third / Text Card. При переключении:
- Logo Reveal: скрыто Name, показан Subline, duration=2.2
- Lower Third: Name + Title, duration=5
- Text Card: Line 1 + Line 2, duration=7

### 2. Apply без открытой композиции

**Действие:** Закрыть все композиции, нажать Apply
**Ожидание:** Ошибка в чате, панель стабильна

---

## Logo Reveal

### 3. Дефолтный Logo Reveal

**Действие:** Apply Logo Reveal (duration=2.2, без subline)
**Ожидание:** 3+ слоёв: "Logo Reveal Ctrl" (null, opacity=0), "Logo Icon" (shape, 3 paths зелёный куб), "Cloud.ru Text" (text)
**Проверяем:**
- Все слои parented к null
- Icon Position: 4 keyframes (elastic overshoot)
- Icon Scale: 4 keyframes (0->130->90->100)
- Icon Opacity: 0->100

### 4. Logo Reveal с subline

**Действие:** Ввести текст в поле Subline, Apply
**Ожидание:** +слой "Subline" с fade+slide-in после logo. Parented к null.

### 5. Logo Reveal с subline + background

**Действие:** Включить with_background (через чат: "создай логошот с подложкой и сублайном: текст")
**Ожидание:** +слой "Subline BG" (dark bar, horizontal grow). Parented к null.

### 6. Undo Logo Reveal

**Действие:** Ctrl+Z
**Ожидание:** Все слои Logo Reveal удалены одним undo

---

## Lower Third

### 7. Полный Lower Third

**Действие:** Apply Lower Third (name="Иван Иванов", title="Директор", duration=5)
**Ожидание:** 7 слоёв: "LT Controller" (null, opacity=0), "LT Bar 1", "LT Bar 2", "LT Flash 1", "LT Flash 2", "LT Name", "LT Title"
**Проверяем:**
- Все parented к null
- Bar 1 scaleX: 0->122.8->hold->0
- Bar 2 scaleX: 0->91.5->hold->0, stagger 240ms
- Flash bars: opacity 80->0->0->80
- Bars растут от левого края (не от центра!)
- Текст inPoint с задержкой (name +240ms, title +560ms)

### 8. Lower Third min duration

**Действие:** Apply Lower Third с duration=3
**Ожидание:** Анимация без наложения keyframes — bar2 hold phase > 0

### 9. Undo Lower Third

**Действие:** Ctrl+Z
**Ожидание:** Все слои удалены одним undo

---

## Text Card

### 10. Text Card 2 строки

**Действие:** Apply Text Card (line1="Облачные", line2="Технологии", duration=7)
**Ожидание:** 4 слоя: "TC Controller" (null, opacity=0), "TC Bar 1", "TC Line 1", "TC Line 2"
**Проверяем:**
- Все parented к null
- fontSize=100 (не 80), без Scale [50,50]
- Bar scaleX: 0->102->hold->0
- Цвет текста: Brand Light Green [0.812, 0.961, 0]
- Шрифт: SBSansDisplay-Semibold

### 11. Text Card 4 строки

**Действие:** Через чат: "создай текстовую плашку: строка1 / строка2 / строка3 / строка4"
**Ожидание:** 2 bar группы, 4 текста, 1 null = 7 слоёв. Bar 2 stagger 400ms, target scaleX=80.

### 12. Undo Text Card

**Действие:** Ctrl+Z
**Ожидание:** Все слои удалены одним undo

---

## Agent (через чат)

### 13. Keyword: logo reveal

**Действие:** "Создай логошот Cloud.ru"
**Ожидание:** Агент вызывает `apply_brand_logo_reveal`

### 14. Keyword: lower third

**Действие:** "Добавь нижнюю плашку для Петра Сидорова, продакт-менеджер"
**Ожидание:** Агент вызывает `apply_brand_lower_third` с правильными name/title

### 15. Keyword: text card

**Действие:** "Сделай SMM плашку: Облачная / Платформа"
**Ожидание:** Агент вызывает `apply_brand_text_card`

---

## Parent Null

### 16. Scale через контроллер

**Действие:** Создать любой пресет, выбрать null, Scale -> [150,150]
**Ожидание:** Все дочерние элементы масштабируются пропорционально

### 17. Position через контроллер

**Действие:** Переместить null
**Ожидание:** Все дочерние элементы смещаются вместе

---

## Edge Cases

### 18. Без шрифтов SB Sans

**Действие:** Apply пресет без установленных SB Sans
**Ожидание:** Текст создаётся с fallback шрифтом, без ошибок

### 19. CTI у конца композиции

**Действие:** CTI=8s в 10-секундной композиции, Apply любой пресет
**Ожидание:** Keyframes выходят за duration. Анимация создаётся, ошибок нет.

---

## Результаты

| # | Тест | Статус | Заметки |
|---|------|--------|---------|
| 1 | Brand dropdown | | |
| 2 | Apply без композиции | | |
| 3 | Logo Reveal дефолт | | |
| 4 | Logo Reveal + subline | | |
| 5 | Logo Reveal + subline + bg | | |
| 6 | Undo Logo Reveal | | |
| 7 | Lower Third полный | | |
| 8 | Lower Third min duration | | |
| 9 | Undo Lower Third | | |
| 10 | Text Card 2 строки | | |
| 11 | Text Card 4 строки | | |
| 12 | Undo Text Card | | |
| 13 | Keyword: logo reveal | | |
| 14 | Keyword: lower third | | |
| 15 | Keyword: text card | | |
| 16 | Scale через null | | |
| 17 | Position через null | | |
| 18 | Без шрифтов SB Sans | | |
| 19 | CTI у конца композиции | | |
