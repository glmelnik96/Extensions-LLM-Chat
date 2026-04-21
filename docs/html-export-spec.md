# HTML-export Spec: Brand Presets для сайтов и display-баннеров

> **Статус:** 🛠️ **Частично реализовано (MVP third-tab Export).** Версия 1 — экспорт из активной композиции AE через UI-панель. Бренд-preset-специфичные гарантии fidelity остаются roadmap-ом.
>
> **Дата фиксации:** 2026-04-16
> **Источник:** deep-dive-интервью → trace (3 lanes) → spec (ambiguity ~15%) → реализация third-tab
> **Архив сессии:** `.omc/specs/deep-dive-trace-analyze-animation-export-json-lottie.md` (trace), `.omc/specs/deep-dive-analyze-animation-export-json-lottie.md` (полный spec с Interview Transcript)

## UI Flow (implemented)

Третья вкладка **Export** в панели плагина реализует общий экспорт из активной композиции AE в HTML/JSON. Пайплайн:

1. Пользователь собирает анимацию на таймлайне AE как обычно (через Chat, Presets, или вручную).
2. Переходит на вкладку **Export**.
3. Выбирает **Format**: CSS + inline SVG (лёгкий, zero-dep) / GSAP + inline SVG (timeline) / Raw JSON (дамп данных).
4. Опционально правит **Animation name** (по умолчанию — имя композиции).
5. Нажимает **Browse** — открывается нативный диалог `Folder.selectDialog`, выбирает папку.
6. Нажимает **Export** — запускается: `extensionsLlmChat_extractCompForHtml` (host) → `HtmlExporter.generate` (client) → `fs.writeFileSync` в выбранную папку.
7. Статус-линия показывает результат (ok/error/working) с полным путём к созданному файлу.
8. Tool Log на вкладке Presets & Logs собирает warnings (expression / effect / blend-mode / mask), которые не переносятся в HTML.

### Файлы реализации

| Файл | Назначение |
|---|---|
| `index.html` | третий `<button class="tab-btn" data-tab="export">` + `<div class="tab-panel" data-tab="export">` |
| `styles.css` | секция `.export-panel`, `.export-hints`, `.export-status.ok/.error/.working` |
| `main.js` | `cacheDomRefs` (export refs), `handleExportBrowse`, `handleExportRun`, `updateExportFormatHint`, `writeExportFiles`, `setExportStatus` |
| `htmlExporter.js` | `window.HtmlExporter.generate(format, compData, opts)` — генераторы css-svg / gsap-svg / json-raw |
| `host/index.jsx` | `extensionsLlmChat_extractCompForHtml()` + `extensionsLlmChat_selectExportFolder()` |

### Реализовано (HTML ↔ AE fidelity — что переносится)

- **Размеры композиции + viewBox с hard-clip**: `<svg viewBox>` + `<clipPath>` + `overflow="hidden"` — контент вне комп-размеров обрезается даже в lenient-рендерерах (QuickLook, старые WebView).
- **Transform**: position / scale / rotation / opacity — keyframes с per-stop cubic-bezier easing (сохраняет AE speed+influence).
- **Expression-driven tracks** запекаются в keyframes с частотой comp.frameRate (cap 30fps, max 600 сэмплов на свойство).
- **Layer timing**: `animation-delay` = `inPoint`, `animation-duration` = `outPoint - inPoint`, `animation-fill-mode: both` — слой "существует" только в своём активном диапазоне.
- **Blend modes** → `mix-blend-mode`: normal / multiply / screen / overlay / darken / lighten / color-dodge / color-burn / hard-light / soft-light / difference / exclusion / hue / saturation / color / luminosity. Add / Linear Dodge → fallback на `screen`. AE-specific (Stencil/Silhouette Alpha, Alpha Add, Luminescent Premul) — warning, fallback на normal.
- **AV-слои**: footage-изображения и видео копируются в `assets/` рядом с HTML, эмитятся через `<image>` / `<foreignObject><video>`. Solid-слои эмитятся как `<rect fill>`.
- **Anchor point**: статическое значение из `ADBE Anchor Point`, offset применяется на inner-shape так что rotate/scale работают корректно для footage с центральным anchor.
- **Text-слои**: `<text>` с font-family, font-size, fill, justification, **stroke** (applyStroke + strokeColor + strokeWidth + paint-order через strokeOverFill), faux bold/italic (`font-weight`/`font-style`), letter-spacing из `tracking`.
- **Shape-слои**: rect / ellipse / bezier path с:
  - Fill color + fill-opacity
  - **Stroke**: color, width, opacity, line-cap (butt/round/square), line-join (miter/round/bevel)
- **Masks (Mask Parade) — lottie-web pattern, multi-mask composition**:
  - Все маски слоя композируются в единое определение: `<clipPath>` если все маски Add/opaque/static (fast-path), иначе `<mask>` с альфа-композицией.
  - **Координатная система**: mask path emits в layer-local пространстве без wrapping `<g transform>` — SVG применяет mask-attribute до transform родительского `<g>`, так что координаты маски автоматически совпадают с layer content (см. lottie-web `mask.js`).
  - **Add mode**: white path → reveal (add).
  - **Subtract mode**: comp-size white rect base + black path punch-out.
  - **Inverted flag**: comp-size white rect base + path в противоположном цвете mode-а.
  - **Multi-mask**: любая комбинация Add + Subtract + Inverted композируется корректно в один `<mask>`.
  - **Mask Shape animation**: SMIL `<animate attributeName="d" values=... keyTimes=... dur begin repeatCount="indefinite">`.
  - **Mask Opacity**: `fill-opacity` на path (static + animated через SMIL).
  - **Mask Feather**: SVG `<feGaussianBlur stdDeviation="feather/2">` внутри `<filter>` applied на path.
  - **Mask Expansion (static)**: SVG `<feMorphology operator="erode|dilate" radius="...">` — геометрический inset/outset.
  - **Mask Expansion (animated)**: fade-approximation через `fill-opacity` (per-frame feMorphology — roadmap).
  - **Works for ALL layer types**: text/shape/av/solid/null (layer-type-agnostic).
  - **Baseline-aligned text** (critical for text masks): `y="0"` + `dominant-baseline="alphabetic"` — AE text layer-space y=0 = baseline, так же как AE mask vertices. Автоматическое выравнивание без font-ascent compensation.
  - **Simplified modes**: Intersect/Lighten/Darken/Difference downgrade до Add с warning (lottie тоже не реализует Darken/Lighten/Difference).
- **Effects (recognized, 7 типов):**
  - **ADBE Fill** — цвет заливки слоя (override shape/text fill). Анимированный цвет эмитится как `@keyframes { fill: #color }` на inner shape element, синхронно с layer-таймингом.
  - **ADBE Drop Shadow** — CSS `filter: drop-shadow(dx dy softness rgba)`. AE direction (0°=up, clockwise) конвертируется в dx/dy; opacity → alpha канал. **Static first-frame** (animation — roadmap).
  - **ADBE Gaussian Blur / Gaussian Blur 2** — CSS `filter: blur(Xpx)`. Static first-frame.
  - **ADBE Invert** — CSS `filter: invert(100%)`.
  - **ADBE Brightness & Contrast (2)** — CSS `filter: brightness(X) contrast(Y)`. AE range −100..+100 → CSS 0..2 factor.
  - **ADBE HUE SATURATION** — CSS `filter: hue-rotate(Xdeg) saturate(Y)` + опционально `brightness(Z)` для lightness.
  - **ADBE Tint** — approximate через `filter: grayscale(A) sepia(A) hue-rotate(Hdeg)` (рассчитано из target white hue). Exact Black→White mapping требует SVG `<feColorMatrix>` (roadmap).
  - Несколько recognized effects стакаются в одном `filter:` пропе.
- **Disabled layers** (eye-off): пропускаются при экспорте.
- **Layer parenting**: `parentIndex` извлекается и логируется в diagnostic comment, **композиция transform НЕ применяется** (warning в Tool Log). Pre-compose родителя в AE перед экспортом для работоспособности.
- **Pixel Aspect Ratio**: `comp.pixelAspect` извлекается и отображается в диагностике; CSS-stretch для non-square — deferred (редкий кейс для web/banner).
- **Diagnostic HTML comment** в начале файла: комп (name, w×h, fps, duration, bg), per-layer сводка (имя, тип, in/out, tracks, blend mode) — для быстрой проверки что экстрактор увидел.
- **Diagnostic JSON (`<name>.diagnostic.json`)** рядом с HTML: structured dump для reproducible diffs:
  - `comp` — все метаданные (name, width, height, duration, frameRate, pixelAspect, bgColor)
  - `summary` — derived counts: `layersTotal`, `bakedExpressions`, `totalTransformKeyframes`, `effectsRecognized: {fill, dropShadow, blur, invert, brightnessContrast, hueSaturation, tint}`, `blendModes: {...}`, `masks: {total, withAnimatedShape, withAnimatedOpacity, withAnimatedExpansion, inverted}`, `parentedLayers`
  - `layers[]` — per-layer compact data (index, name, type, in/out, enabled, blendMode, parentIndex, tracks counts, likelyBakedExpression, masks[], effects{})
  - `warnings[]` — все сгенерированные warnings
  - `raw.layers[]` — полные raw data (каждый keyframe с t, v, ei, eo, iType, oType), для byte-level diffing
  - **Использование:** открыть оба файла (AE-export-A.diagnostic.json vs AE-export-B.diagnostic.json), сравнить через `diff` или любой JSON-differ — сразу видно что изменилось между экспортами. При жалобе на "что-то не так" можно попросить прислать `.diagnostic.json` вместо пояснений на пальцах.
- **Asset dedupe**: если N слоёв ссылаются на один файл, копируется 1 раз.
- **Detеrministic output**: никаких `Date.now` / `Math.random` в сгенерированном коде.

### Архитектурные пробелы (известные limitations)

После roadmap-проходов P1-P4 большинство прежних gaps закрыто. Что всё ещё не экспортируется:

- **Pre-compositions (nested comps)** — пропускаются полностью (`continue` в loop). *Workaround:* flatten до экспорта через Layer → Pre-compose или превратить precomp в основную comp.
- **Unsupported effects**: Glow, Fractal Noise, Lumetri Color, Levels, Curves, Stroke (отдельный effect, не путать с Shape Stroke), Gradient Ramp, Color Balance, Channel Mixer, CC* effects, 3rd-party plugins и всё остальное кроме 7 recognized (Fill / Drop Shadow / Gaussian Blur / Invert / Brightness & Contrast / Hue/Saturation / Tint). Warnings логируются.
- **Masks: Intersect/Lighten/Darken/Difference modes** — downgraded до Add при композиции. Add/Subtract/Inverted/Feather/Expansion полноценно поддерживаются.
- **Text animators: полная Range Selector математика** — стагер-MVP реализован (per-char `<tspan>` с staggered opacity keyframes), но shape / smoothness / inter-selector composition не учитываются.
- **Per-group animated transforms** — статический snapshot на t=0 (animated Vector Group Transform — roadmap).
- **Repeater: keyframed copies/offset/transform** — bake статичный на t=0 (animated Repeater — roadmap).
- **Animated anchor point** — извлекается один статический snapshot.
- **3D layers** → flattened to 2D; camera / light layers — игнорируются.
- **Time remapping** — не поддерживается.
- **Non-square pixel aspect ratio** — не учитывается (предполагается 1.0).
- **Motion blur / frame blending** — недоступно в CSS/SVG без дорогостоящей симуляции.
- **Font embedding**: используется web-font fallback. Для SBSans требуется либо пользователь добавляет `@font-face` с WOFF2, либо outline-to-path вручную.

### Что добавлено в итерации P1–P4 (из lottie-web / AE2Canvas / project-Cue audit)

- **Layer parenting chain composition**: полностью композируется multi-level parenting → композированная матрица per keyframe time.
- **Track Mattes**: Alpha / Inverted Alpha / Luma / Inverted Luma — через SVG `<mask>` с `mask-type`+filter.
- **Separate Dimensions (Position X / Y)** — union time points, независимый easing per axis.
- **Auto-orient (Along Path)** — rotation от position velocity через `atan2`.
- **Spatial Bezier (curved motion paths)** — 6 intermediate samples per bezier segment при non-zero spatial tangents.
- **Per-group Transform** (Vector Group's own Transform) — nested `<g transform="matrix(...)">` wrapping.
- **Shape multi-fill / multi-stroke stacking** — все Fill/Stroke в Contents стекаются в AE paint-order.
- **Gradient fills / strokes** (linear + radial) — SVG `<linearGradient>`/`<radialGradient>` в `<defs>` с per-stop colors.
- **Trim Paths** — `pathLength=100` + `stroke-dasharray`/`stroke-dashoffset` (стороны start/end/offset).
- **Stroke dash patterns** — `stroke-dasharray`/`stroke-dashoffset` attributes.
- **Polystar** (polygon + star) — cubic-bezier path math.
- **Round Corners** — rx/ry on rects, bezier recompute on paths.
- **Repeater** — N `<use>` clones с cumulative transform + linear opacity ramp.
- **Text on Path** — SVG `<textPath href>` ссылается на mask path.
- **Text animators (per-char stagger MVP)** — per-character `<tspan>` с staggered opacity animation.
- **Animated Drop Shadow / Blur / B&C / Hue-Sat / Tint** — union keyframe times → filter @keyframes.
- **Ease-and-Wizz palette** — 25 Penner easings доступны как `HtmlExporter.easings`.
- **Lottie JSON (bodymovin) export format** — MVP mapping для shapes + text + transforms + keyframe easing.

### Operational-детали

- GSAP-формат подгружается с CDN (cdnjs). Для Яндекс/VK-баннеров ≤150 KB пользователь вручную заменяет `<script src=...>` на инлайн-bundle (warning в диагностике).
- ZIP-packaging для баннеров с per-size вариантами не реализован — roadmap.
- Solid-цвет и comp.bgColor берутся напрямую из AE `SolidSource.color` / `CompItem.bgColor` (массив [r,g,b] в 0..1 → hex).
- Все AV-слои (и image, и video) попадают в `assets/`; `<video>` получает `autoplay muted loop playsinline`.

---

## TL;DR

Добавить в CEP-плагин экспорт трёх brand-preset-ов (Logo Reveal, Text Card, Lower Third) в **HTML-анимацию (GSAP + inline SVG + CSS)** для двух поверхностей:

- **OwnedSite** — отдельные `.html/.css/.js` для вёрстки dev-командой Cloud.ru.
- **DisplayBanner** — self-contained HTML5 ZIP ≤150 KB для Яндекс Директ / VK Реклама / myTarget / Google Ads.

**Lottie/JSON отклонены.** Причины в §Rejected Alternatives.

---

## Pre-Implementation Checklist

Эти вопросы должны быть закрыты ДО старта имплементации:

- [ ] **GSAP Standard License** подтверждён юристами Cloud.ru для маркетинговых баннеров (fallback: pure CSS @keyframes + SVG без JS-библиотеки — генератор сложнее, код объёмнее, 0 license risk).
- [ ] **Cloud.ru brand font strategy** выбран: либо embed WOFF2 файлов (вес, нужно лицензировать шрифт для встраивания), либо text-to-outlined-SVG-paths (теряется editability, но гарантированная fidelity).
- [ ] **Размеры баннеров для первой кампании** согласованы с marketing-командой (типовой набор Яндекс Директ: 240×400, 300×250, 300×600, 336×280, 728×090, 970×250, 1000×120 — подмножество).
- [ ] **Подтверждение scope** — только Cloud.ru sites + display-banners; никакого video (Meta/YouTube/TikTok) и email (GIF).

---

## Goal

Плагин должен за один экспорт-ран генерировать brand-compliant HTML-анимации, визуально эквивалентные AE-референсу (overshoot, stagger, flash), без ручной работы dev-команды по реверсу анимаций из AE.

## Scope

### In Scope

- Экспорт активной композиции или указанного preset-а (Logo Reveal / Lower Third / Text Card) в HTML.
- Две target-поверхности: `OwnedSite` и `DisplayBanner`.
- Tech stack: GSAP 3.x + inline SVG + CSS (opacity-only flash, без blend modes — соответствует текущей реализации preset-ов).
- UI в панели: выбор preset → выбор surface → если banner: выбор размеров → export.
- ZIP-packaging для banner-surface с проверкой веса ≤150 KB.
- Детерминизм: одинаковый вход → байт-в-байт одинаковый выход.

### Non-Goals (явно исключено)

- ❌ **Lottie/JSON экспорт как deliverable** — см. §Rejected Alternatives.
- ❌ **Video-реклама (MP4/WebM для Meta, YouTube, TikTok, VK Video)** — вне целевых поверхностей.
- ❌ **Email GIF-ы** — вне целевых поверхностей.
- ❌ **clickTag-обвязка** — dev-команда оборачивает в `<a href="${CLICKTAG}">` вручную; плагин генерит только анимацию.
- ❌ **Автоматический рендер в MP4 через AE render queue** — возможное будущее расширение.
- ❌ **Интерактивность** (hover, click внутри баннера) — auto-play only.

---

## Constraints

### Hard

- **Вес ZIP для баннера:** ≤150 KB суммарно (Яндекс Директ / VK Реклама HTML5-requirement).
- **Нет внешних CDN для баннеров:** Яндекс/VK запрещают внешние сетевые запросы → GSAP **инлайнится** в ZIP.
- **Латинские имена файлов** внутри ZIP (Яндекс Директ / VK Реклама).
- **Brand-compliance анимации:** overshoot curves, stagger timings и flash-эффекты должны соответствовать существующему AE-референсу (см. `docs/brand-presets-spec.md`).
- **Детерминизм:** никаких `Date.now()`, random IDs, timestamps в генерированном коде.
- **ExtendScript ES3 compatibility** для host-side кода (нет `let`, `const`, arrow functions в `host/index.jsx`).

### Soft

- GSAP Standard License (бесплатная) покрывает use case. Business Green (~$199/год) не требуется (анимация — маркетинг Cloud.ru, не продукт-as-animation). **Validation required** (см. Pre-Implementation Checklist).
- Читабельность сгенерированного кода (dev-команда правит размеры, добавляет clickTag).
- Работа в существующей CEP-инфраструктуре плагина (`--enable-nodejs`, File I/O, tool registry).

---

## Acceptance Criteria

### AC-1: Tool registry
- В `toolRegistry.js` добавлены tools: `export_brand_html_site` и `export_brand_html_banner` (либо унифицированный `export_brand_html` с параметром `target: "site" | "banner"`).
- В `hostBridge.js:117–150` добавлены соответствующие case-ветки.
- В `host/index.jsx` реализованы функции генерации HTML/CSS/JS + ZIP-упаковки.

### AC-2: Size selector UI
- В панели появляется элемент (checkbox-list или multi-select) для выбора размеров из типового набора Яндекс Директ + ручной ввод кастомных.
- Пользователь выбирает активную композицию, surface (site | banner), размеры (для banner), запускает экспорт.

### AC-3: Output для OwnedSite
- Результат: папка `{preset}-site/` с `index.html`, `style.css`, `animation.js`, inline-SVG внутри `index.html`.
- HTML: `<div id="brand-animation-{preset}">` с inline-SVG для shapes.
- CSS: brand colors, позиционирование.
- JS: GSAP timeline с keyframes точно соответствующими AE.
- GSAP подгружается отдельно (`<script src="./gsap.min.js">`) или инлайнится — решение dev-команды (плагин кладёт файл рядом).

### AC-4: Output для DisplayBanner
- На каждый выбранный размер генерируется отдельный ZIP: `{preset}_{width}x{height}.zip`.
- Внутри ZIP: `index.html` с инлайновыми `<style>`, `<script>` (GSAP + animation code), `<svg>`.
- Размер ZIP ≤150 KB (автопроверка; при превышении — ошибка с указанием что уменьшить).
- Имена файлов латиницей.
- Нет внешних `<link>`, `<script src="http...">`, `@import` с CDN.

### AC-5: Brand-fidelity для всех трёх presets

**Logo Reveal:**
- Position keyframes: elastic overshoot (4 stages: slide-in → overshoot → bounce-back → settle) — cubic-bezier совпадает с AE speed+influence конверсией.
- Scale keyframes: 132% → 185% → 117% → 100% zoom overshoot.
- Opacity fade-in 0→100.
- Text: wipe-in slide from right, параллельно с logo.
- Subline + background bar (если включены) — horizontal scale grow.

**Lower Third:**
- 2 бара (dark): scaleX 0 → 122.8% → hold → 0 с 240ms stagger.
- Flash-эффект (white) поверх каждого бара: **opacity-only alpha stacking** (80→0→0→80) — идентично существующей реализации в `host/index.jsx`, которая НЕ использует blend modes. Белый бар с opacity-keyframes поверх тёмного бара даёт brand-compliant flash.
  - ⚠️ НЕ использовать `mix-blend-mode: screen` — это даст другой визуал и противоречит существующему AE-референсу.
- Name и title text появляются по расписанию (stagger-based appearance).

**Text Card:**
- 2–4 text-линии + 2 шейп-бара (upper/lower).
- Bars: scaleX 0 → ~100% → hold → 0, staggered.
- Easing: smooth deceleration (influence=100% → CSS `cubic-bezier(0, 0, 0.2, 1)`).

### AC-6: Параметры preset сохраняются
- Duration, display_duration, text content, optional subline — всё, что пользователь выставил в AE, попадает в HTML с точным таймингом.

### AC-7: Deterministic output
- Повторный экспорт того же preset с теми же параметрами → идентичный байт-в-байт output.

### AC-8: Документация
- Дополнительный `docs/html-export-guide.md`: как пользоваться экспортом, какие surface и размеры доступны, как dev-команда оборачивает в clickTag для Яндекс/VK/Google.

---

## Technical Context

### Опорные точки в существующем коде (brownfield)

| Элемент | Файл:линия | Назначение в новом функционале |
|---|---|---|
| `apply_brand_logo_reveal` | `host/index.jsx:~1405` | Источник данных для HTML-генератора (keyframes, paths, colors) |
| `apply_brand_lower_third` | `host/index.jsx:~1560` | Источник данных с flash-keyframes (opacity-based) |
| `apply_brand_text_card` | `host/index.jsx:~1689` | Источник данных со staggered bars |
| `_BRAND_LOGO_PATHS`, `_BRAND_COLORS` | `host/index.jsx:1325–1340` | Shape paths и цвета, переиспользуются в SVG-генераторе |
| `_setKeyAtTimeAndGetIndex`, `_setKeyEaseBezier` | `host/index.jsx:~1000–1070` | Pattern для чтения/записи временных easing-кривых (нужна обратная операция: AE speed+influence → CSS cubic-bezier) |
| `resultToJson` | `host/index.jsx:3940–3976` | ES3-совместимый JSON-сериализатор (для intermediate-представления) |
| `extractAnimationParams.jsx` | `scripts/extractAnimationParams.jsx:27–85` | Reference-шаблон для AE → JSON pipeline |
| File I/O pattern | `host/index.jsx:3900+` | `new File(path).open('w')` — используется для записи ZIP-ов и html-файлов |
| Tool registry | `toolRegistry.js` | Добавление новых tool definitions |
| Tool dispatcher | `hostBridge.js:117–150` | Добавление case для новых tool names |
| CEP Node.js | `CSXS/manifest.xml:24–25` | `--enable-nodejs` включён — можно использовать `require('fs')`, `require('path')` в panel JS-слое для ZIP-упаковки |

### Новые компоненты

1. **HTML Generator (ExtendScript)** — читает параметры preset и генерирует:
   - SVG markup (shapes → `<path>`, `<rect>`)
   - CSS (colors, positioning; **opacity-only для flash, без `mix-blend-mode`**)
   - GSAP timeline-код (keyframes → `.to()` calls с корректным easing)

2. **AE Easing → cubic-bezier converter** — математика перевода AE speed/influence в CSS `cubic-bezier(x1,y1,x2,y2)`. Стандартная формула, документирована в multiple AE-to-web migration guides.

3. **ZIP Packager (panel JS-слой)** — использует Node.js `fs` + архиватор (JSZip инлайн или child_process `zip`). Проверяет вес ≤150 KB.

4. **Size Selector UI** — новая секция в панели с checkbox-списком размеров + кастомный ввод.

5. **GSAP Bundle Asset** — GSAP 3.x minified (~40 KB uncompressed / ~18 KB gzipped) кладётся в `assets/gsap.min.js` плагина, инлайнится в banner-ZIP при генерации.

### Что НЕ меняется

- Существующие brand preset tools (`apply_brand_*`) — без изменений.
- Agent loop, LLM-интеграция, chat-провайдер, session-management — без изменений.
- 47 существующих tools не трогаются.

---

## Assumptions Exposed

- **GSAP Standard License достаточна** для use case Cloud.ru (маркетинг-баннеры). Business Green (~$199/год) не требуется. *Валидация перед имплементацией.*
- **Cloud.ru brand font** (`SBSansDisplay-Semibold`, `SBSansText-Regular`, `SBSansDisplay-Regular`) доступен как WOFF2 для embedding, либо будет преобразован в outlined SVG paths.
- **dev-команда Cloud.ru** умеет работать с HTML5 ZIP-ами для Яндекс Директ и добавлять clickTag-обвязку.
- **Существующие 3 brand presets** не меняются структурно. Для новых presets из `docs/brand-animation-roadmap.md` — расширение генератора отдельным scope.
- **JSON export** не является отдельным deliverable, но промежуточный JSON (keyframe-данные preset) может использоваться как intermediate representation внутри генератора и/или сохраняться для archiving/диффов.

---

## Ontology

| Entity | Values | Notes |
|---|---|---|
| **BrandPreset** | `LogoReveal`, `LowerThird`, `TextCard` | Существующие 3 пресета |
| **Surface** | `OwnedSite`, `DisplayBanner` | Определяет структуру вывода |
| **Output** | `SiteEmbed` (folder .html/.css/.js) | Для OwnedSite |
| **Output** | `BannerBundle` (ZIP per size ≤150 KB) | Для DisplayBanner |
| **TechStack** | `GSAP + inline SVG + CSS` | Fallback: pure CSS @keyframes + SVG |
| **BannerSize** | user-selected IAB/Yandex dim | Примеры: `240x400`, `300x250`, `728x090` |
| **ExportTool** | `export_brand_html_site`, `export_brand_html_banner` | Новые CEP tools |
| **EasingConverter** | AE speed+influence → CSS cubic-bezier | Математика перевода |
| **FidelityLevel** | `brand-compliant (vector-equivalent)` | Не pixel-identical (vector ≠ raster), но deterministic rendering |

---

## Rejected Alternatives

### Почему НЕ Lottie

1. **Ни одна площадка не принимает Lottie нативно.** Яндекс Директ, VK Реклама, myTarget, Google Ads/DV360, Meta — все требуют HTML5 ZIP или MP4. Lottie — максимум intermediate-формат, не deliverable.
2. **Вес + no-CDN-rule для Яндекс/VK.** lottie-web ~60 KB gzipped съедает 40% бюджета 150 KB; Яндекс/VK запрещают внешние CDN → всё инлайн. HTML+GSAP+SVG инлайн в 150 KB укладывается легче.
3. **Font fidelity** (`SBSansDisplay-Semibold`, `SBSansText-Regular`) — Bodymovin-экспорт требует опцию "Glyphs" (text → outlined shapes), иначе fallback на системный шрифт в lottie-web. С HTML+SVG мы контролируем это нативно.
4. **Parent-null `Opacity=0` propagation** — известный Bodymovin bug: некоторые рендереры мультиплицируют opacity родителя в детей, все слои становятся невидимыми. Все 3 preset-а используют ctrlNull.opacity=0 → риск.
5. **4-кадровые non-monotonic elastic overshoot-curves** могут упрощаться Bodymovin-ом (lottie-web #2620).
6. **inPoint/outPoint + non-zero t0** — Bodymovin может вырезать слой при экспорте, если visibility-range вне work area.

### Почему НЕ MP4/GIF (video)

- Video-реклама (Meta, YouTube, TikTok, VK Video) вне scope текущих целевых поверхностей.
- Для display-баннеров MP4 тяжелее HTML+GSAP и менее гибко (нельзя перевёрстывать под разные размеры без повторного рендера).
- Возможное будущее расширение через AE render queue automation — отдельный scope.

### Почему НЕ pure CSS @keyframes (без GSAP)

- Работает, но генератор сложнее: elastic overshoot требует декомпозиции на 5–8 промежуточных frames.
- Stagger реализуется через `animation-delay` per element — verbose в сгенерированном коде.
- Оставлено как **fallback** если GSAP Standard License не подойдёт.

---

## Reference Links

- **Full session archive:**
  - Trace: `.omc/specs/deep-dive-trace-analyze-animation-export-json-lottie.md`
  - Spec с Interview Transcript: `.omc/specs/deep-dive-analyze-animation-export-json-lottie.md`
- **Existing spec/roadmap:**
  - `docs/brand-presets-spec.md` — спецификация brand presets (в т.ч. требование `normal` blending)
  - `docs/brand-animation-roadmap.md` — roadmap brand-анимаций
  - `docs/capabilities-and-roadmap.md` — общий roadmap возможностей
- **Memory:** `feedback_brand_presets.md` — требование точного соответствия референсу

---

## When ready to start implementation

1. Закрыть Pre-Implementation Checklist (GSAP license, font strategy, banner sizes list).
2. Определить: единый tool (`export_brand_html`) vs два tools (`_site` / `_banner`) — commit в design early.
3. Запустить одну из execution-mod команд с этим spec-ом:
   - `/oh-my-claudecode:omc-plan --consensus --direct docs/html-export-spec.md` → ралплан-рефайнинг → затем `/oh-my-claudecode:autopilot`
   - Или напрямую `/oh-my-claudecode:autopilot docs/html-export-spec.md`
   - Или `/oh-my-claudecode:ralph docs/html-export-spec.md` для persistence-loop с верификацией по AC
