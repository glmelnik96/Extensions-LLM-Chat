# Brand Presets — Implementation Spec

> Точные параметры анимаций из AE-проектов для создания детерминированных пресетов.
> Источники: Логошот.aep, Titles.aep, SMM_pack.aep

---

## Цветовая палитра Cloud.ru (из проектов)

| Название | RGB [0-1] | HEX | Использование |
|----------|-----------|-----|---------------|
| Brand Green | [0.149, 0.816, 0.486] | #26D07C | Лого icon fill, transition_green, текст плашек |
| Brand Dark | [0.133, 0.133, 0.133] | #222222 | Подложки, transition_gray, shape fills |
| Brand Light Green Text | [0.812, 0.961, 0] | #CFF500 | Текст на плашках (SMM) |
| Near White | [0.969, 0.969, 0.969] | #F7F7F7 | Cloud.ru text fill |
| White | [1, 1, 1] | #FFFFFF | Transition_white, overlay shapes, текст lower third |
| Black | [0, 0, 0] | #000000 | Текст на светлом фоне |

## Шрифты

| Шрифт | ID в AE | Использование |
|-------|---------|---------------|
| SB Sans Display Semibold | SBSansDisplay-Semibold | Заголовки, плашки, логошоты |
| SB Sans Display Regular | SBSansDisplay-Regular | Основной текст |
| SB Sans Text Regular | SBSansText-Regular | Подписи спикеров (lower third) |

---

## Preset 1: brand_logo_reveal (P0)

### Источник: Логошот без саблайна (1920×1080, 3s, 25fps)

### Структура слоёв

| # | Тип | Имя | Parent | BlendMode | Роль |
|---|-----|-----|--------|-----------|------|
| 1 | shape | Wipe Shape | Logo Icon | silhouetteAlpha | Анимированный wipe-reveal (горизонтальный) |
| 2 | shape | Cloud.ru Text | Logo Icon | silhouetteAlpha | Текст "Cloud.ru" как shape paths, Fill effect |
| 3 | shape | Logo Icon | — | silhouetteAlpha | Иконка Cloud.ru (3 paths), основной контроллер анимации |

### Анимация Logo Icon (Layer 3 — контроллер)

**Position** (4 keyframes, linear 16.7% influence):
```
t=0.000s  [1161, 540]    → начало слева от центра
t=1.000s  [1241, 540]    → проскакивает вправо
t=1.750s  [1019, 540]    → отскакивает влево
t=2.200s  [964, 540]     → финальная позиция (центр)
```
Паттерн: elastic/overshoot — logo скользит, проскакивает, возвращается.

**Scale** (4 keyframes, bezier с varied influence):
```
t=0.000s  [250, 250]     eOut: inf=33.3
t=1.000s  [350, 350]     eIn: inf=68.1, eOut: inf=50.6
t=1.750s  [221, 221]     eIn: inf=25.7, eOut: inf=30.6
t=2.200s  [189, 189]     eIn: inf=37.9
```
Паттерн: zoom overshoot — большой → ещё больше → меньше → финальный размер.

**Opacity** (2 keyframes):
```
t=0.000s  0     eOut: inf=33.3
t=1.000s  100   eIn: inf=68.1
```
Fade in за первую секунду.

### Wipe Shape (Layer 1)

**Position** (3 keyframes, линейное движение):
```
t=1.000s  [69, 18]     → начало (слева)
t=1.750s  [202, 18]    → середина (вправо)
t=2.200s  [234, 18]    → финал (полностью открыт)
```
Scale: [45, 45] static. Rectangle shape, silhouetteAlpha mode → создаёт wipe-reveal для текста.

### Cloud.ru Text (Layer 2)

Fill effect (ADBE Fill): color [0.969, 0.969, 0.969] (near-white).
Opacity fade out: t=5.68s val=100 → t=6.36s val=0 (eIn: inf=33.3, eOut: inf=100).

### Вариант с саблайном (Умное облако, 974×80)

Дополнительные слои:
- text 'умное облако с ИИ-помощником': font=SBSansDisplay-Semibold, size=100, scale=[40,40], color=[0,0,0]
- shape 'умное облако': 37 paths (кириллица как vector outlines)
- shape 'Back_1': animated position — slide in
- shape 'Back_2': static, parented to Back_1

**Back_1 Position** (основная анимация):
```
t=1.000s  [487, 40]    → далеко справа
t=2.400s  [139, 40]    → slide in на место (eIn/eOut: inf=16.7, linear)
t=3.320s  [139, 40]    → hold
t=4.320s  [349, 40]    → slide out вправо
```

### Вариант с плашкой

Дополнительный layer 'Подложка':
- Rect: 470×113, fill [0.133, 0.133, 0.133] (Brand Dark)
- **Scale animation** (3 keyframes — horizontal grow):
```
t=1.000s  [0, 59.5]       → скрыт
t=1.626s  [28.6, 59.5]    → растёт
t=2.200s  [49.3, 59.5]    → финальный размер
```

### Упрощённая модель для preset

Для детерминированного preset используем упрощённую анимацию:
1. Logo icon: scale 0→overshoot→100%, opacity 0→100, position center
2. Опционально: subline slide in с задержкой
3. Опционально: подложка horizontal grow

---

## Preset 2: brand_lower_third (P0)

### Источник: Titles / Антон Нефедов (1500×500, 6.04s, 25fps)

### Структура слоёв

| # | Тип | Имя | Parent | Роль |
|---|-----|-----|--------|------|
| 1 | null | Размер плашек | — | Контроллер (scale=250%, opacity=0) |
| 2 | text | [Имя] | Размер плашек | Имя спикера (SBSansText-Regular, 40px, white) |
| 3 | text | [Должность] | Размер плашек | Должность (SBSansText-Regular, 20px, white) |
| 4 | shape | Bar 1 (dark) | Размер плашек | Основная полоса — horizontal scale animation |
| 5 | shape | Bar 2 (dark) | Размер плашек | Вторая полоса — staggered |
| 6 | shape | Bar 3 (white) | Размер плашек | White flash (exit) |
| 7 | shape | Bar 4 (white) | Размер плашек | White flash (enter) |
| 8 | shape | Bar 5 (white) | Размер плашек | White flash (exit bar 2) |
| 9 | shape | Bar 6 (white) | Размер плашек | White flash (enter bar 2) |

### Null Controller
- Position: [493, 204] (left-aligned lower area)
- Scale: [250, 250] — все дочерние элементы масштабируются через parent
- Opacity: 0 — null невидим

### Text layers
- **Имя**: font=SBSansText-Regular, size=40, fill=[1,1,1], justification=7413 (left)
  - inPoint=0.24s (stagger delay 240ms)
  - position relative: [381, 179]

- **Должность**: font=SBSansText-Regular, size=20, fill=[1,1,1], justification=7413
  - inPoint=0.56s (stagger delay 560ms)
  - position relative: [381, 233]

### Shape Bars — анимация

Все bars: Rectangle 272×52, no roundness, fill Brand Dark [0.133, 0.133, 0.133].

**Bar 1 (основная полоса, layer 4)** — Scale X animation:
```
t=0.000s  scaleX=0     eOut: inf=33.3  (hidden)
t=0.800s  scaleX=122.8  eIn: inf=100   (overshoot! 122.8% then settles)
t=5.240s  scaleX=122.8  eIn: inf=100   (hold)
t=6.040s  scaleX=0     eOut: inf=33.3  (close)
```
Паттерн: **horizontal wipe-in** с overshoot → hold → **horizontal wipe-out**.

**Bar 2 (вторая полоса, layer 5)** — staggered 240ms:
```
t=0.240s  scaleX=0     (start delayed)
t=1.040s  scaleX=91.5  (smaller overshoot)
t=5.000s  scaleX=91.5  (hold)
t=5.800s  scaleX=0     (close earlier)
```

**White flash bars (layers 6-9)**: same rectangle, fill=[1,1,1].
- Visible only during transitions (0→0.8s enter, 5.0→6.0s exit)
- Same scale animation but different timing = white "flash" effect

### Анимационный паттерн

```
0.0s — Bar 1 starts growing (dark)
0.0s — Bar 4 white flash (same timing as bar 1, visible only 0-0.8s)
0.24s — Bar 2 starts growing (dark, stagger)
0.24s — Bar 3/9 white flash for bar 2
0.24s — Name text appears (inPoint)
0.56s — Title text appears (inPoint)
0.8s  — Bars fully open, white flashes gone
5.0s  — Bar 2 starts closing
5.04s — Exit white flashes appear
5.24s — Bar 1 starts closing
5.28s — More exit flashes
6.04s — Everything closed
```

### Упрощённая модель для preset

1. Null controller → parent for all
2. Dark bar 1: scaleX 0→120%→hold→0 (ease: in=100%, out=33.3%)
3. Dark bar 2: same, staggered 240ms, smaller target (91.5%)
4. White flash bar: same rect, visible only during in/out transitions
5. Text name: inPoint = bar1 start + 240ms
6. Text title: inPoint = bar1 start + 560ms

---

## Preset 3: brand_text_card (P1)

### Источник: SMM_Pack / Плашки_1x1 (1440×1440, 7.84s)

### Структура

| # | Тип | Имя | Роль |
|---|-----|-----|------|
| 1-4 | text | Текстовые строки | 4 строки текста (SBSansDisplay-Semibold, 100px, Brand Light Green) |
| 5 | shape | Shape Layer 3 | Верхняя подложка bar (behind text lines 1-2) |
| 6 | shape | Shape Layer 4 | Нижняя подложка bar (behind text lines 3-4) |

### Цвета
- Текст: [0.812, 0.961, 0] (Brand Light Green / #CFF500)
- Shape bars: [0.133, 0.133, 0.133] (Brand Dark)
- Размер bar: 1231×110

### Анимация Shape Bars

**Bar 1 (верхний, layer 5)** — 6 keyframes, 2-phase:
```
Phase 1 (enter):
  t=0.400s  scaleX=0        (hidden)
  t=1.280s  scaleX=102.1    (slight overshoot, eIn: inf=100)
Phase 2 (text change mid-animation):
  t=3.400s  scaleX=102.1    (hold)
  t=4.200s  scaleX=101.7    (slight adjust)
Phase 3 (exit):
  t=7.000s  scaleX=101.7    (hold)
  t=7.800s  scaleX=0        (close)
```

**Bar 2 (нижний, layer 6)** — staggered 400ms earlier:
```
  t=0.000s  scaleX=0
  t=0.880s  scaleX=80.3     (eIn: inf=100)
  t=3.000s  scaleX=80.3     (hold)
  t=3.800s  scaleX=78.5     (adjust)
  t=6.600s  scaleX=78.5     (hold)
  t=7.400s  scaleX=0        (close)
```

### Формат 9:16 (Плашки_9x16)

Тот же паттерн, но scaleX targets и scaleY отличаются:
- Bar 1: scaleX=74.5, scaleY=75
- Bar 2: scaleX=62.1, scaleY=75

### Упрощённая модель для preset

1. 2-4 строки текста (SBSansDisplay-Semibold)
2. Shape bar под каждой парой строк: scaleX 0→~100%→hold→0
3. Stagger 400ms между bars
4. Easing: eIn influence=100% (smooth deceleration)

---

## Preset 4: brand_transition (P2)

### Источник: SMM_Pack / Transition_gray (1080×1920, 0.875s)

### Структура

2 shape layers, каждый с 5 прямоугольников разного размера, движутся навстречу:

**Layer 1 (Transition_1)**: движение слева→вправо
```
t=0.000s  pos=[-1476, 753]   (за левым краем)
t=0.833s  pos=[2241, 753]    (за правым краем)
```

**Layer 2 (Transition_2)**: движение справа→влево
```
t=0.000s  pos=[2130, 753]    (за правым краем)
t=0.833s  pos=[-1162, 753]   (за левым краем)
```

Easing: linear (inf=17 ≈ default).

### Цвета transition

| Вариант | Fill |
|---------|------|
| gray | [0.133, 0.133, 0.133] |
| green | [0.149, 0.816, 0.486] |
| white | [1, 1, 1] |

### Упрощённая модель

2 shape layers с набором прямоугольников разного размера.
Встречное движение за 0.83s (20 frames @24fps).
Опционально: logo precomp поверх в середине перехода.

---

## Общие паттерны анимации

### Easing

| Паттерн | eIn influence | eOut influence | Использование |
|---------|---------------|----------------|---------------|
| Linear | 16.7% | 16.7% | Transitions, wipe |
| Smooth stop | 100% | 33.3% | Bar growth (overshoot) |
| Smooth start | 33.3% | 100% | Bar close |
| Elastic | 68.1% / 25.7% / 37.9% | 50.6% / 30.6% | Logo scale overshoot |

### Stagger timing

| Элемент | Задержка |
|---------|---------|
| Bar 2 vs Bar 1 | 240ms |
| Name text vs Bar 1 | 240ms |
| Title text vs Bar 1 | 560ms |
| Lower bar vs Upper bar (plashki) | 400ms |

### BlendMode

Все проекты используют `silhouetteAlpha` на большинстве слоёв. Это специфика precomp-based workflow в оригинальных проектах. Для standalone presets использовать `normal`.
