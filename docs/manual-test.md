# Manual Test — Brand Presets (Cloud.ru)

> **Статус:** Анимации не верифицированы — визуально не совпадают с референсами.
> Тесты проверяют техническую работоспособность (слои создаются, keyframes ставятся, undo работает), но НЕ качество анимации.
> См. `brand-presets-status.md` для деталей.
>
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

## Export Tab — HTML Animation Export

> Тесты для третьей вкладки Export. Chat и Presets не должны быть затронуты.

### Подготовка к тестированию Export tab

1. **Перезагрузить плагин в After Effects:**
   - Закрыть панель `Window → Extensions → AE Motion Agent`
   - Открыть её снова **— или** нажать `Cmd+R` внутри панели если включён PlayerDebugMode CEP.
   - Должны быть видны **3 таб-кнопки**: `Chat | Presets & Logs | Export`.
2. **Открыть тестовую композицию** в AE: 1920×1080, 25 fps, 5 сек.
3. **Подготовить минимум один анимированный слой:**
   - Опция A (быстро): на вкладке `Presets & Logs` нажать `Apply Preset` → Logo Reveal или Lower Third.
   - Опция B (через чат): "Создай shape rectangle и анимируй position с overshoot 1 сек".
   - Опция C (вручную): создать solid/shape, добавить keyframes для Position и Opacity.
4. **Создать пустую папку для экспорта**, например `~/Desktop/ae-html-test/` (или плагин создаст её автоматически).

### Smoke-тест (60 секунд) — быстрая проверка end-to-end

1. Перейти на вкладку `Export`.
2. Format: `CSS + inline SVG`.
3. Animation name: оставить пустым (подставится имя композиции).
4. Output directory: нажать `Browse` → выбрать `~/Desktop/ae-html-test/`.
5. Нажать `Export`.

**Ожидание:**
- Статус-линия: жёлтый "Extracting composition from AE...", потом "Generating css-svg artifact...", потом зелёный "Wrote 1 file(s) → /Users/.../ae-html-test/<имя>.html".
- В папке появился `.html` файл — открыть его в браузере вручную для визуальной проверки.
- На вкладке `Presets & Logs` в Tool Log появилась запись `html-export ok Wrote 1 file(s) ...`.
- Композиция в AE НЕ изменилась (нет новых слоёв).

Если smoke-тест прошёл — переходить к тестам 20–30 ниже для покрытия edge-cases.

### Где смотреть подробности при ошибке

- **Статус красный?** Ошибка указана в самом статус-line.
- **Plugin не реагирует / JS ошибки?** Открыть DevTools панели:
  - PlayerDebugMode + порт CEP (порт указан в `CSXS/manifest.xml` в `<CEFCommandLine><Parameter>--remote-debugging-port=...</Parameter>`).
  - Открыть `localhost:<port>` в Chrome → выбрать панель → Console.
- **Tool Log** на вкладке `Presets & Logs` показывает все вызовы `html-export` с уровнями ok/warn/error.

### 20. Вкладка Export появляется и активируется

**Действие:** Открыть панель, кликнуть по таб-кнопке "Export"
**Ожидание:** Активной становится третья вкладка. Chat/Presets исчезают. В Export видны: Format select, Animation name input, Output directory input+Browse, hints секция (жёлтая левая граница), Export button, статус "Ready".

### 21. Format селектор переключает подсказку

**Действие:** Переключить Format между "CSS + inline SVG", "GSAP + inline SVG", "Raw JSON"
**Ожидание:** Текст в подсказке (`#export-hints-format`) обновляется для каждого формата. Опция "Lottie-compatible JSON" disabled.

### 22. Browse открывает системный диалог выбора папки

**Действие:** Кликнуть Browse
**Ожидание:** Открывается AE-диалог выбора папки. Выбрать Desktop → путь появляется в Output directory. Статус: "Selected: ...".
**Проверка отмены:** Открыть Browse ещё раз и нажать Cancel → статус "Picker cancelled", путь в инпуте НЕ меняется.

### 23. Export без открытой композиции

**Действие:** Закрыть все композиции в AE, указать путь и нажать Export
**Ожидание:** Статус становится красным: "Extract failed: No active composition". Файлы в папку НЕ пишутся. Композиции в AE не создаются.

### 24. Export CSS+SVG: запись файла

**Действие:** Открыть композицию с несколькими слоями (text + shape + keyframes). На Export: Format=CSS+SVG, Name=test-anim, Output=~/Desktop/ae-html-test, нажать Export
**Ожидание:** Статус зелёный: "Wrote 1 file(s) → .../test-anim.html". Файл test-anim.html существует, открывается в браузере, показывает HTML5 страницу с inline `<svg>` и CSS `@keyframes`. Композиция в AE НЕ мутируется (слои не добавлены/удалены).

### 25. Export GSAP+SVG: GSAP timeline в коде

**Действие:** Тот же процесс, Format=GSAP+SVG
**Ожидание:** test-anim.html содержит `<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/`, `gsap.timeline()` и серию `tl.to(...)` / `tl.set(...)` вызовов. В браузере анимация запускается.

### 26. Export JSON-raw: дамп composition

**Действие:** Format=Raw JSON, Export
**Ожидание:** Создан test-anim.json. Содержимое — валидный JSON с ключами `ok`, `comp` (name/width/height/duration), `layers` (массив), `warnings` (массив). Открывается в любом JSON-viewer без ошибок.

### 28. Warnings при неподдерживаемых фичах

**Действие:** Добавить в слой expression или эффект Drop Shadow, Export
**Ожидание:** Статус: "Wrote 1 file(s) → ... (warnings: N)". В Tool Log появляются записи вида `html-export warn Layer "X" has N effect(s) — not exported to HTML`.

### 28b. Изображения-слои экспортируются с копированием в assets/

**Действие:**
1. Перетащить в композицию файл `jpg`/`png` как футаж.
2. Добавить keyframes Position (или использовать expression).
3. Export → Format=CSS+SVG → Output=~/Desktop/ae-html-test.

**Ожидание:**
- В папке создаётся `<name>.html` **и** подпапка `assets/<имя-изображения>.<ext>` с копией оригинала.
- `.html` содержит `<image xlink:href="./assets/<name>" width="<W>" height="<H>" ...>` с реальными размерами изображения.
- В браузере изображение видно (не placeholder-рамка), анимируется по Position.
- Scale из AE применяется корректно (например, 73% → `scale(0.73, 0.73)` в CSS).

**Проверка anchor:**
- Если anchor point изображения был смещён от центра — изображение правильно позиционируется по position (не съезжает).

**Проверка видео:** то же самое для `mp4`/`mov` → в HTML эмитится `<foreignObject>` с `<video autoplay muted loop>`.

### 28a. Expression-анимация запекается в keyframes (bake)

**Действие:**
1. Создать shape layer.
2. На Position применить expression, например: `wiggle(2, 100)` или `[value[0] + Math.sin(time * 2) * 200, value[1]]`.
3. **Убедиться**, что на Position нет обычных keyframes (только expression).
4. Export → Format=CSS+SVG.

**Ожидание:**
- Файл `.html` содержит полноценный `@keyframes` с ~25-30 stops на секунду (сэмплировано с частотой комп-fps, cap 30).
- В браузере слой реально движется (а НЕ замирает на стартовой позиции — это был прежний баг).
- В Tool Log появляется запись: `html-export warn Layer "X": baked 1 expression-driven property into NN sample keyframe(s)`.
- При переключении на Format=GSAP+SVG: в `.html` видно много `tl.set(...)` / `tl.to(...)` вызовов — по одному на сэмпл.

**Проверка JSON-raw:**
- Format=Raw JSON → в `layers[0].transform.position` массив содержит много объектов `{ t, v, iType:"linear", oType:"linear" }` с равномерным шагом времени (`1/fps`), а не 1 статичный.

### 28c. Fill-эффект: переопределение и анимация цвета

**Действие:**
1. Создать solid (любого цвета) или text.
2. Effect → Generate → **Fill**. Поменять `Color` — скажем, на красный.
3. На Color property поставить 2-3 keyframe с разными цветами (0s: red, 2s: green, 4s: blue).
4. Export → Format=CSS+SVG.

**Ожидание:**
- В HTML `<rect fill="#ff0000"/>` (для solid) или `<text fill="#ff0000">` (для text) — **цвет из Fill-эффекта**, не исходный цвет слоя.
- В `<style>` присутствует `@keyframes ae-fill-<layerId>_inner { 0% { fill: #ff0000 } 50% { fill: #00ff00 } 100% { fill: #0000ff } }`.
- Внутренний `<rect>` / `<text>` имеет `id="..._inner"`, CSS-правило привязывает к нему анимацию.
- В браузере цвет меняется во времени.

### 28d. Drop Shadow → CSS filter: drop-shadow

**Действие:**
1. Создать text или shape с контрастным цветом.
2. Effect → Perspective → **Drop Shadow**. Параметры по умолчанию (Shadow Color=black, Opacity=50%, Direction=135°, Distance=5, Softness=5).
3. Export → Format=CSS+SVG.

**Ожидание:**
- В `<g>` слоя присутствует inline `filter: drop-shadow(3.536px 3.536px 5px rgba(0,0,0,0.5))` (для direction=135°, dist=5: dx=dy ≈ 5·sin/cos(135°) ≈ 3.54).
- В браузере за текстом/шейпом видна тень.
- Если поменять направление на 90° (right) → dx=5, dy=0.
- При анимированном Drop Shadow: в Tool Log warning "animated Drop Shadow / Blur — only first-frame values applied".

### 28e. Gaussian Blur → CSS filter: blur

**Действие:**
1. Создать text "Hello".
2. Effect → Blur & Sharpen → **Gaussian Blur**, Blurriness=8.
3. Export → Format=CSS+SVG.

**Ожидание:**
- В `<g>` слоя inline `filter: blur(8px)`.
- Если на слое есть и Drop Shadow, и Blur: оба стакуются `filter: drop-shadow(...) blur(8px)`.
- В браузере текст размыт.

### 28f. Mask reveal: анимированная маска

**Действие:**
1. Создать text "Hello" шириной ~400px.
2. Выделить text layer → Layer → Mask → New Mask (rectangular).
3. Открыть mask → **Mask Shape** — поставить keyframe на t=0 со shape 0×высота_текста (текст полностью скрыт), на t=2s keyframe со shape, покрывающим весь текст (full reveal).
4. Export → Format=CSS+SVG.

**Ожидание:**
- В `<defs>` присутствует `<mask id="ae-mask-...">` с `<path>` и SMIL `<animate attributeName="d" values="M...; M..." keyTimes="0;1" dur="2s" begin="0s" repeatCount="indefinite"/>`.
- В `<g>` слоя атрибут `mask="url(#ae-mask-...)"`.
- В браузере (Chrome/Safari) текст появляется слева направо (mask растягивается).
- Если масок несколько: применяется только первая, в extraCss-комменте: "N additional mask(s) not composed".

### 28g. Unsupported эффект → warning, layer экспортируется без эффекта

**Действие:**
1. Создать слой, добавить effect НЕ из списка (например, **Glow** или **Levels**).
2. Export.

**Ожидание:**
- Статус: "Wrote ... (warnings: N)".
- В diagnostic-коммент HTML и Tool Log: `Layer "X" has 1 unsupported effect(s) — not exported (supported: Fill, Drop Shadow, Gaussian Blur, Invert, Brightness & Contrast, Hue/Saturation, Tint)`.
- Слой экспортируется без эффекта (layer стиль нормальный, filter не применяется).

### 28h. Invert effect → filter: invert(100%)

**Действие:** Shape + Effect → Channel → **Invert**. Export.
**Ожидание:** В `<g>` слоя inline `filter: invert(100%)`. В браузере цвета инвертированы.

### 28i. Brightness & Contrast → filter: brightness + contrast

**Действие:** Text + Effect → Color Correction → **Brightness & Contrast**. Brightness=30, Contrast=50. Export.
**Ожидание:** `filter: brightness(1.3) contrast(1.5)` на `<g>`. В браузере ярче и контрастнее.

### 28j. Hue/Saturation → filter: hue-rotate + saturate

**Действие:** Shape + Effect → Color Correction → **Hue/Saturation**. Master Hue=60, Master Saturation=-30. Export.
**Ожидание:** `filter: hue-rotate(60deg) saturate(0.7)` на `<g>`.

### 28k. Tint effect → approximated filter

**Действие:** Solid + Effect → Color Correction → **Tint**. Map White To=blue (`#2b3440`). Amount to Tint=100. Export.
**Ожидание:**
- `filter: grayscale(1) sepia(1) hue-rotate(...)` на `<g>` (approximation).
- В Tool Log / extraCss: "ADBE Tint approximated via grayscale+sepia+hue-rotate. Exact Black→White mapping requires SVG <feColorMatrix> (roadmap)".

### 28l. Shape stroke + fill opacity

**Действие:** Shape layer (rect) с Fill color=blue + Stroke color=red, width=5px, opacity=80%, line-cap=round. Export.
**Ожидание:** В SVG `<rect ... fill="#... " stroke="#ff..." stroke-width="5" stroke-opacity="0.8" stroke-linecap="round"/>`.

### 28m. Text stroke (applyStroke + strokeColor + strokeWidth)

**Действие:** Text layer, Character panel → включить Stroke, strokeColor=black, strokeWidth=2, Fill Over Stroke. Export.
**Ожидание:** `<text ... fill="..." stroke="#000000" stroke-width="2" paint-order="stroke fill">`. Faux bold / italic / tracking также переносятся.

### 28n. Mask feather → SVG Gaussian blur

**Действие:** Shape layer с маской, Mask Feather=[20, 20]. Export.
**Ожидание:** В `<defs>` присутствует `<filter id="ae-mask-...-feather"><feGaussianBlur stdDeviation="10"/></filter>`, applied к path маски через `filter="url(#...)"`. В браузере mask-края размыты.

### 28o. Layer parenting → warning

**Действие:** Создать Null Object, привязать текст к null через parent pick whip. Export.
**Ожидание:** Warning в Tool Log и diagnostic-коммент: `Layer "текст" is parented to layer #N — parent chain transform composition is NOT applied; for moving/rotating/scaling parents you need to pre-compose in AE first`.
**Mitigation:** выделить child + parent → Layer → Pre-compose → "Move all attributes". Экспортировать precomp-layer.

### 28q. Diagnostic JSON рядом с HTML

**Действие:** Любой Export (css-svg / gsap-svg / json-raw).
**Ожидание:**
- В output-директории создан `<name>.diagnostic.json` рядом с основным файлом.
- Файл — валидный JSON (парсится любым JSON viewer).
- Содержит ключи: `exporter`, `format`, `comp` (все поля), `summary` (layersTotal, bakedExpressions, totalTransformKeyframes, effectsRecognized counts, blendModes, masks stats, parentedLayers), `layers[]` (per-layer compact), `warnings[]`, `raw.layers[]` (full keyframes tree).
- Детерминизм: повторный экспорт того же comp даёт **байт-в-байт идентичный** JSON.

**Use case:**
- Reproducible diffs: `diff A.diagnostic.json B.diagnostic.json` показывает что изменилось между экспортами (например, после изменения в AE одной маски).
- Structured issue reporting: вместо «текст пропал» пользователь может прислать .diagnostic.json → сразу видно что `masks[0].expansionKeyframes=2` (animated reveal который не применяется).

### 28p. Disabled layers (eye off) не экспортируются

**Действие:** Создать 3 слоя, отключить "eye" иконку у второго. Export.
**Ожидание:** В HTML только 2 слоя. Disabled layer отсутствует в diagnostic-comment.

### 29. Output directory не существует

**Действие:** Ввести вручную путь `~/Desktop/does-not-exist-yet/animated`, Export
**Ожидание:** Папка создаётся автоматически (`fs.mkdirSync recursive`), файл пишется. Статус зелёный.

### 30. Chat и Presets вкладки не затронуты

**Действие:** После работы с Export вернуться на Chat, отправить сообщение. Затем на Presets & Logs, применить любой preset.
**Ожидание:** Обе вкладки работают как раньше. Нет никаких регрессий.

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
| 20 | Export таб появляется | | |
| 21 | Format hint обновляется | | |
| 22 | Browse открывает диалог | | |
| 23 | Export без композиции | | |
| 24 | Export CSS+SVG запись | | |
| 25 | Export GSAP+SVG timeline | | |
| 26 | Export JSON-raw дамп | | |
| 28 | Warnings в Tool Log | | |
| 28a | Expression baking | | |
| 28b | Image layer → assets/ + <image> | | |
| 28c | Fill effect (color override + anim) | | |
| 28d | Drop Shadow → filter: drop-shadow | | |
| 28e | Gaussian Blur → filter: blur | | |
| 28f | Mask reveal (SMIL animate d) | | |
| 28g | Unsupported effect → warning | | |
| 28h | Invert → filter: invert(100%) | | |
| 28i | Brightness & Contrast | | |
| 28j | Hue/Saturation | | |
| 28k | Tint (approximated) | | |
| 28l | Shape stroke + fill-opacity | | |
| 28m | Text stroke + paint-order | | |
| 28n | Mask feather → feGaussianBlur | | |
| 28o | Layer parenting warning | | |
| 28p | Disabled layers skipped | | |
| 28q | Diagnostic JSON alongside HTML | | |
| 29 | Output dir auto-create | | |
| 30 | Chat/Presets не затронуты | | |
| 12 | Undo Text Card | | |
| 13 | Keyword: logo reveal | | |
| 14 | Keyword: lower third | | |
| 15 | Keyword: text card | | |
| 16 | Scale через null | | |
| 17 | Position через null | | |
| 18 | Без шрифтов SB Sans | | |
| 19 | CTI у конца композиции | | |
