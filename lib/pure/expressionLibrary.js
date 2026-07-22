/**
 * Curated After Effects expression snippet library (panel-side, no host call).
 * Canonical, battle-tested snippets: Dan Ebberts / motionscript.com classics,
 * Animoplex patterns, and standard AE expression idioms.
 *
 * Searched by the `search_expression_library` agent tool. Each snippet:
 *   id        — stable identifier
 *   name      — human-readable name
 *   keywords  — search terms (EN + RU where useful)
 *   target    — property kind the snippet is meant for
 *   expression— ready-to-apply code (replace UPPERCASE placeholders if noted)
 *   notes     — usage hints, placeholders, tuning knobs
 *   requires  — effects that must exist on the layer BEFORE applying (add_effect first)
 */
(function () {
  'use strict'

  var SNIPPETS = [
    {
      id: 'inertial-bounce',
      name: 'Inertial bounce after keyframes (Ebberts)',
      keywords: ['bounce', 'inertia', 'spring', 'elastic', 'overshoot', 'jiggle', 'пружина', 'отскок'],
      target: 'Any keyframed property (Position, Scale, Rotation)',
      expression: 'var n = 0;\nif (numKeys > 0) {\n  n = nearestKey(time).index;\n  if (key(n).time > time) n--;\n}\nif (n > 0 && time - key(n).time < 1) {\n  var t = time - key(n).time;\n  var v = velocityAtTime(key(n).time - thisComp.frameDuration / 10);\n  var amp = 0.05, freq = 4.0, decay = 8.0;\n  value + v * amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t);\n} else {\n  value;\n}',
      notes: 'Add AFTER setting keyframes — overshoots past each keyframe and settles. Tune: amp (strength), freq (oscillations/sec), decay (how fast it settles).',
      requires: []
    },
    {
      id: 'wiggle-basic',
      name: 'Wiggle (organic random motion)',
      keywords: ['wiggle', 'random', 'shake', 'jitter', 'handheld', 'тряска', 'дрожание'],
      target: 'Position / Rotation / Scale / any',
      expression: 'wiggle(3, 30)',
      notes: 'wiggle(frequency, amplitude). 3 = times per second, 30 = max deviation in units of the property.',
      requires: []
    },
    {
      id: 'wiggle-one-axis',
      name: 'Wiggle one axis only',
      keywords: ['wiggle', 'horizontal', 'vertical', 'x only', 'y only', 'axis', 'одна ось'],
      target: 'Position (2D)',
      expression: 'var w = wiggle(3, 50);\n[w[0], value[1]]',
      notes: 'Wiggles X only; swap to [value[0], w[1]] for Y only. For 3D add value[2].',
      requires: []
    },
    {
      id: 'wiggle-slider',
      name: 'Wiggle controlled by sliders',
      keywords: ['wiggle', 'slider', 'control', 'rig', 'adjustable', 'контроллер'],
      target: 'Any',
      expression: 'wiggle(effect("Wiggle Freq")("Slider"), effect("Wiggle Amp")("Slider"))',
      notes: 'Add TWO Slider Controls first and rename them "Wiggle Freq" and "Wiggle Amp" (or keep default names and update the expression). Lets the user keyframe wiggle intensity.',
      requires: ['ADBE Slider Control', 'ADBE Slider Control']
    },
    {
      id: 'wiggle-loop',
      name: 'Seamlessly looping wiggle',
      keywords: ['wiggle', 'loop', 'seamless', 'cycle', 'gif', 'бесшовный'],
      target: 'Any',
      expression: 'var freq = 1, amp = 50, loopTime = 3;\nvar t = time % loopTime;\nvar w1 = wiggle(freq, amp, 1, 0.5, t);\nvar w2 = wiggle(freq, amp, 1, 0.5, t - loopTime);\nlinear(t, 0, loopTime, w1, w2)',
      notes: 'Wiggle that repeats perfectly every loopTime seconds — for GIFs/loops.',
      requires: []
    },
    {
      id: 'loop-cycle',
      name: 'Loop keyframes (cycle)',
      keywords: ['loop', 'repeat', 'cycle', 'loopout', 'зациклить', 'повтор'],
      target: 'Any keyframed property',
      expression: 'loopOut("cycle")',
      notes: 'Requires 2+ keyframes. Variants: loopOut("pingpong") back-and-forth, loopOut("offset") keeps accumulating, loopOut("continue") extrapolates last velocity. loopIn() mirrors before the first key.',
      requires: []
    },
    {
      id: 'loop-pingpong',
      name: 'Loop keyframes (pingpong)',
      keywords: ['loop', 'pingpong', 'back and forth', 'туда-сюда', 'маятник'],
      target: 'Any keyframed property',
      expression: 'loopOut("pingpong")',
      notes: 'Plays keyframes forward then backward, repeating. Requires 2+ keyframes.',
      requires: []
    },
    {
      id: 'typewriter',
      name: 'Typewriter text reveal',
      keywords: ['typewriter', 'typing', 'text reveal', 'letters', 'печатная машинка', 'набор текста'],
      target: 'Text>Source Text',
      expression: 'var full = text.sourceText;\nvar dur = 2.0;\nvar chars = Math.floor(linear(time - inPoint, 0, dur, 0, full.length));\nfull.substr(0, chars)',
      notes: 'Reveals the layer\'s own text over `dur` seconds starting at the layer in-point. Pure expression — no animator needed.',
      requires: []
    },
    {
      id: 'counter-number',
      name: 'Animated number counter',
      keywords: ['counter', 'number', 'count up', 'increment', 'счетчик', 'число'],
      target: 'Text>Source Text',
      expression: 'Math.floor(linear(time, 0, 3, 0, 100)).toString()',
      notes: 'Counts 0→100 over 3 seconds. For thousands separators see counter-formatted.',
      requires: []
    },
    {
      id: 'counter-formatted',
      name: 'Counter with thousands separator',
      keywords: ['counter', 'number', 'comma', 'thousands', 'format', 'разряды', 'счетчик'],
      target: 'Text>Source Text',
      expression: 'var n = Math.round(linear(time, 0, 3, 0, 25000));\nvar s = "" + n, out = "";\nwhile (s.length > 3) { out = "," + s.substr(-3) + out; s = s.substr(0, s.length - 3); }\ns + out',
      notes: 'Counts to 25 000 with commas (25,000). Change targets/timing in linear().',
      requires: []
    },
    {
      id: 'countdown-timer',
      name: 'Countdown timer mm:ss',
      keywords: ['countdown', 'timer', 'clock', 'minutes', 'seconds', 'таймер', 'обратный отсчет'],
      target: 'Text>Source Text',
      expression: 'var t = Math.max(0, 10 - time);\nvar m = Math.floor(t / 60);\nvar s = Math.floor(t % 60);\nm + ":" + (s < 10 ? "0" + s : s)',
      notes: 'Counts down from 10s. Replace 10 with total seconds.',
      requires: []
    },
    {
      id: 'auto-fade',
      name: 'Auto fade in/out at layer in/out points',
      keywords: ['fade', 'fade in', 'fade out', 'opacity', 'auto', 'появление', 'исчезновение'],
      target: 'Transform>Opacity',
      expression: 'var fade = 0.5;\nMath.min(linear(time, inPoint, inPoint + fade, 0, 100), linear(time, outPoint - fade, outPoint, 100, 0))',
      notes: 'No keyframes needed — fades 0.5s after in-point and 0.5s before out-point. Survives retiming the layer.',
      requires: []
    },
    {
      id: 'follow-delay',
      name: 'Follow another layer with delay (lag)',
      keywords: ['follow', 'delay', 'lag', 'trail', 'chase', 'следовать', 'задержка', 'хвост'],
      target: 'Transform>Position',
      expression: 'var delay = 0.2;\nthisComp.layer("LEADER").transform.position.valueAtTime(time - delay)',
      notes: 'Replace LEADER with the source layer name (or use link_properties for a direct link without delay). For chains of copies use trail-by-index.',
      requires: []
    },
    {
      id: 'trail-by-index',
      name: 'Trail — each copy follows the layer above',
      keywords: ['trail', 'snake', 'chain', 'follow', 'duplicate', 'хвост', 'цепочка'],
      target: 'Transform>Position',
      expression: 'var delay = 0.1;\nthisComp.layer(index - 1).transform.position.valueAtTime(time - delay)',
      notes: 'Apply to duplicates stacked under an animated leader: each layer follows the one above with 0.1s lag.',
      requires: []
    },
    {
      id: 'stagger-by-index',
      name: 'Stagger animation by layer index',
      keywords: ['stagger', 'offset', 'cascade', 'delay', 'sequence', 'каскад', 'смещение'],
      target: 'Any keyframed property (on duplicated layers)',
      expression: 'var delay = 0.1 * (index - 1);\nvalueAtTime(time - delay)',
      notes: 'Duplicate one keyframed layer N times — each copy plays the same animation 0.1s later. Classic cascade.',
      requires: []
    },
    {
      id: 'squash-stretch',
      name: 'Squash & stretch from velocity',
      keywords: ['squash', 'stretch', 'velocity', 'cartoon', 'ball', 'деформация', 'мячик'],
      target: 'Transform>Scale',
      expression: 'var v = length(transform.position.velocity);\nvar f = linear(v, 0, 1500, 1, 1.3);\n[value[0] / f, value[1] * f]',
      notes: 'Volume-preserving: stretches along Y while moving fast. Animate Position with keyframes first. Tune 1500 (speed for max stretch) and 1.3 (max factor). For horizontal motion swap the axes.',
      requires: []
    },
    {
      id: 'rotate-to-motion',
      name: 'Rotate toward direction of motion',
      keywords: ['rotate', 'direction', 'orient', 'velocity', 'arrow', 'поворот', 'направление'],
      target: 'Transform>Rotation',
      expression: 'var d = 0.01;\nvar v = transform.position.valueAtTime(time + d) - transform.position.valueAtTime(time);\nlength(v) > 0.001 ? radiansToDegrees(Math.atan2(v[1], v[0])) : value',
      notes: 'Expression alternative to Layer > Transform > Auto-Orient. Add a constant offset (e.g. + 90) if the artwork points up.',
      requires: []
    },
    {
      id: 'circular-motion',
      name: 'Circular / orbital motion',
      keywords: ['circle', 'orbit', 'rotation path', 'around', 'круг', 'орбита'],
      target: 'Transform>Position',
      expression: 'var center = [thisComp.width / 2, thisComp.height / 2];\nvar radius = 200, speed = 0.5;\nvar a = time * speed * 2 * Math.PI;\ncenter + [Math.cos(a) * radius, Math.sin(a) * radius]',
      notes: 'Orbits comp center. speed = revolutions per second.',
      requires: []
    },
    {
      id: 'pendulum',
      name: 'Pendulum swing (decaying)',
      keywords: ['pendulum', 'swing', 'rock', 'oscillate', 'маятник', 'качание'],
      target: 'Transform>Rotation',
      expression: 'var freq = 1.0, amp = 30, decay = 0.7;\namp * Math.sin(freq * time * 2 * Math.PI) / Math.exp(decay * time)',
      notes: 'Swings ±30° and settles. Set decay to 0 for perpetual swing. Move the anchor point to the pivot first.',
      requires: []
    },
    {
      id: 'auto-size-box',
      name: 'Box auto-sizes to text (sourceRectAtTime)',
      keywords: ['box', 'background', 'auto size', 'sourcerectattime', 'lower third', 'плашка', 'подложка'],
      target: 'Shape rectangle Size — use the exact sizePath returned by add_shape_rectangle (e.g. "Contents>Rectangle>Contents>Rectangle Path 1>Size")',
      expression: 'var t = thisComp.layer("TEXT");\nvar r = t.sourceRectAtTime(time, false);\nvar pad = 20;\n[r.width + pad * 2, r.height + pad * 2]',
      notes: 'Replace TEXT with the text layer name. Apply to the sizePath from the add_shape_rectangle result. Also link the box position: thisComp.layer("TEXT").transform.position (offset by [r.left + r.width/2, r.top + r.height/2] for exact centering).',
      requires: []
    },
    {
      id: 'grid-by-index',
      name: 'Grid layout by layer index',
      keywords: ['grid', 'layout', 'rows', 'columns', 'arrange', 'сетка', 'раскладка'],
      target: 'Transform>Position',
      expression: 'var cols = 5, spacing = 150, origin = [200, 200];\nvar i = index - 1;\n[origin[0] + (i % cols) * spacing, origin[1] + Math.floor(i / cols) * spacing]',
      notes: 'Apply to many duplicates — they arrange themselves into a grid by layer index.',
      requires: []
    },
    {
      id: 'opacity-flicker',
      name: 'Random opacity flicker',
      keywords: ['flicker', 'random', 'opacity', 'neon', 'glitch', 'мерцание', 'неон'],
      target: 'Transform>Opacity',
      expression: 'seedRandom(Math.floor(time * 10), true);\nrandom(20, 100)',
      notes: 'New random opacity 10x per second. seedRandom driven by time is REQUIRED — with a constant seed the value freezes.',
      requires: []
    },
    {
      id: 'blink',
      name: 'Hard on/off blink',
      keywords: ['blink', 'on off', 'strobe', 'toggle', 'мигание', 'строб'],
      target: 'Transform>Opacity',
      expression: 'var period = 0.5;\nMath.floor(time / period) % 2 === 0 ? 100 : 0',
      notes: 'Visible for `period` seconds, hidden for `period` seconds, repeating.',
      requires: []
    },
    {
      id: 'clamp-to-comp',
      name: 'Clamp position inside the comp',
      keywords: ['clamp', 'bounds', 'limit', 'inside', 'границы', 'ограничить'],
      target: 'Transform>Position',
      expression: '[clamp(value[0], 0, thisComp.width), clamp(value[1], 0, thisComp.height)]',
      notes: 'Keeps the layer anchor inside frame regardless of keyframes/wiggle. Combine: apply after wiggle in the same expression.',
      requires: []
    },
    {
      id: 'posterize-time',
      name: 'Stop-motion feel (posterizeTime)',
      keywords: ['stop motion', 'choppy', 'fps', 'posterize', 'frame rate', 'стоп-моушен'],
      target: 'Any animated property',
      expression: 'posterizeTime(8);\nvalue',
      notes: 'Re-samples the property at 8 fps for a hand-made look. Works on wiggle too: posterizeTime(8); wiggle(3, 30).',
      requires: []
    },
    {
      id: 'slider-opacity',
      name: 'Property driven by a Slider Control',
      keywords: ['slider', 'control', 'rig', 'driver', 'expression control', 'контроллер', 'слайдер'],
      target: 'Any 1D property (Opacity, Rotation, …)',
      expression: 'effect("Slider Control")("Slider")',
      notes: 'Add the Slider Control effect FIRST (add_effect "ADBE Slider Control"), then apply. Keyframe the slider instead of the property — classic rig pattern. For text: Math.round(effect("Slider Control")("Slider")).toString().',
      requires: ['ADBE Slider Control']
    },
    {
      id: 'scale-by-distance',
      name: 'Scale by distance to another layer',
      keywords: ['distance', 'proximity', 'scale', 'near', 'attract', 'дистанция', 'близость'],
      target: 'Transform>Scale',
      expression: 'var target = thisComp.layer("NULL 1");\nvar d = length(transform.position, target.transform.position);\nvar s = linear(d, 0, 500, 150, 50);\n[s, s]',
      notes: 'Replace NULL 1 with the controller layer. Layers grow to 150% when near it, shrink to 50% when 500px away.',
      requires: []
    },
    {
      id: 'spin-forever',
      name: 'Constant rotation (spin forever)',
      keywords: ['spin', 'rotate', 'rotation', 'time', 'constant', 'endless', 'вращение', 'крутится'],
      target: 'Transform>Rotation',
      expression: 'time * 90',
      notes: '90 = degrees per second (360 = full turn per second; negative = counter-clockwise). Zero keyframes needed. The time * n idiom works on any property.',
      requires: []
    },
    {
      id: 'overshoot-settle',
      name: 'Overshoot & settle after last keyframe (spring pop)',
      keywords: ['overshoot', 'settle', 'spring', 'pop', 'snappy', 'juicy', 'перелет', 'пружинит'],
      target: 'Any keyframed property (Scale, Position, Rotation)',
      expression: 'var freq = 3, decay = 5;\nvar n = 0;\nif (numKeys > 0) {\n  n = nearestKey(time).index;\n  if (key(n).time > time) n--;\n}\nif (n > 0) {\n  var t = time - key(n).time;\n  var v = velocityAtTime(key(n).time - 0.001);\n  value + v * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t) / (freq * 2 * Math.PI);\n} else {\n  value;\n}',
      notes: 'Softer than inertial-bounce: a single smooth spring past the target that settles — the classic "juicy" UI/logo pop. Add AFTER keyframes. Tune freq (oscillations/sec) and decay (settle speed).',
      requires: []
    },
    {
      id: 'audio-reactive',
      name: 'Property reacts to music (Audio Amplitude)',
      keywords: ['audio', 'music', 'beat', 'react', 'amplitude', 'sound', 'музыка', 'звук', 'бит'],
      target: 'Transform>Scale (or any property)',
      expression: 'var a = thisComp.layer("Audio Amplitude").effect("Both Channels")("Slider");\nvar s = linear(a, 0, 25, 100, 130);\n[s, s]',
      notes: 'FIRST: right-click the audio layer > Keyframe Assistant > Convert Audio to Keyframes — that creates the "Audio Amplitude" layer this reads. Tune 25 (max expected amplitude) and 100→130 (output range). For 1D properties drop the [s, s] wrapper.',
      requires: []
    },
    {
      id: 'random-per-layer',
      name: 'Stable random value per duplicated layer',
      keywords: ['random', 'seed', 'seedrandom', 'duplicate', 'variation', 'разброс', 'случайный'],
      target: 'Any 1D property (Rotation, Opacity, …)',
      expression: 'seedRandom(index, true);\nrandom(50, 100)',
      notes: 'Each duplicate gets its OWN fixed random value — stable across frames thanks to timeless=true. For 2D: seedRandom(index, true); [random(0, thisComp.width), random(0, thisComp.height)].',
      requires: []
    },
    {
      id: 'snap-zoom',
      name: 'Snap zoom in/out at layer bounds',
      keywords: ['snap', 'zoom', 'scale in', 'scale out', 'entrance', 'exit', 'intro', 'вылет', 'появление'],
      target: 'Transform>Scale',
      expression: 'var snap = 300, frames = 4;\nvar tr = frames * thisComp.frameDuration;\nvar tIn = easeOut(time, inPoint, inPoint + tr, [snap, snap], [0, 0]);\nvar tOut = easeIn(time, outPoint, outPoint - tr, [0, 0], [snap, snap]);\nvalue + tIn + tOut',
      notes: 'Scales down from +300% at the in-point and back up at the out-point over 4 frames. Trim the layer — the transitions follow. Pairs well with auto-fade.',
      requires: []
    },
    {
      id: 'look-at-layer',
      name: 'Point rotation at another layer (2D look-at)',
      keywords: ['look at', 'aim', 'point at', 'target', 'arrow', 'eyes', 'смотреть', 'цель'],
      target: 'Transform>Rotation',
      expression: 'var d = thisComp.layer("TARGET").transform.position - transform.position;\nradiansToDegrees(Math.atan2(d[1], d[0]))',
      notes: 'Replace TARGET with the layer to track. Add a constant offset (e.g. + 90) if the artwork points up instead of right. For facing own movement use rotate-to-motion.',
      requires: []
    },
    {
      id: 'effect-point-to-3d',
      name: 'Pin 2D effect point to a 3D layer (toComp)',
      keywords: ['tocomp', '3d', 'effect point', 'lens flare', 'null', 'track', 'привязать', 'блик'],
      target: 'Effect point property (e.g. Lens Flare > Center of Flare)',
      expression: 'thisComp.layer("NULL 1").toComp([0, 0, 0])',
      notes: 'Replace NULL 1 with the (3D) layer to follow. The 2D effect point then tracks the 3D layer through camera moves — classic lens-flare-on-a-3D-null setup.',
      requires: []
    },
    {
      id: 'keep-scale-when-parented',
      name: 'Keep size when parent scales (inverse scale)',
      keywords: ['parent', 'scale', 'inverse', 'compensate', 'keep size', 'родитель', 'масштаб'],
      target: 'Transform>Scale',
      expression: 'var ps = parent.transform.scale.value;\nvar out = [];\nfor (var i = 0; i < ps.length; i++) out[i] = value[i] * 100 / ps[i];\nout',
      notes: 'Child keeps its on-screen size while the parent scales. The layer must HAVE a parent or the expression errors — apply after parenting.',
      requires: []
    },
    {
      id: 'loop-offset',
      name: 'Loop keyframes accumulating (offset)',
      keywords: ['loop', 'offset', 'accumulate', 'walk cycle', 'stairs', 'зациклить', 'накопление'],
      target: 'Any keyframed property',
      expression: 'loopOut("offset")',
      notes: 'Repeats the keyframed move ADDING the delta each cycle — walk cycles, endless steps. loopOut("continue") instead extrapolates the last velocity in a straight line. Requires 2+ keyframes.',
      requires: []
    },
    {
      id: 'clamp-range',
      name: 'Clamp any value to a range (safe wiggle)',
      keywords: ['clamp', 'limit', 'range', 'min max', 'restrict', 'ограничение', 'диапазон'],
      target: 'Any 1D property (Opacity, Slider, …)',
      expression: 'clamp(wiggle(3, 40), 0, 100)',
      notes: 'clamp(expr, min, max) — guard rails so wiggled/linked values stay legal (Opacity 0–100 here). Replace the wiggle with any expression or plain `value`.',
      requires: []
    },
    {
      id: 'marker-pulse',
      name: 'Pulse on every layer marker',
      keywords: ['marker', 'pulse', 'beat', 'sync', 'music', 'маркер', 'бит', 'пульс'],
      target: 'Transform>Scale (add to both dims) or any',
      expression: 'var amp = 15, decay = 6, freq = 8;\nvar n = 0;\nif (marker.numKeys > 0) {\n  n = marker.nearestKey(time).index;\n  if (marker.key(n).time > time) n--;\n}\nif (n > 0) {\n  var t = time - marker.key(n).time;\n  value + amp * Math.sin(freq * t) / Math.exp(decay * t);\n} else {\n  value;\n}',
      notes: 'Add layer markers on the beats (add_marker), the property pulses at each one. For Scale wrap: value + [p, p] where p is the pulse term.',
      requires: []
    },
    {
      id: 'checkbox-toggle',
      name: 'Show/hide via Checkbox Control',
      keywords: ['checkbox', 'toggle', 'visibility', 'show', 'hide', 'switch', 'чекбокс', 'видимость', 'переключатель'],
      target: 'Transform>Opacity',
      expression: 'effect("Checkbox Control")("Checkbox") == 1 ? 100 : 0',
      notes: 'Add the Checkbox Control effect FIRST (add_effect "ADBE Checkbox Control"). One checkbox can drive many layers — link their Opacity to a checkbox on a controller null. Core MOGRT rig pattern.',
      requires: ['ADBE Checkbox Control']
    },
    {
      id: 'dropdown-switch',
      name: 'Switch variants via Dropdown Menu Control',
      keywords: ['dropdown', 'menu', 'switch', 'variant', 'option', 'mogrt', 'выпадающий', 'меню', 'вариант'],
      target: 'Any 1D property (Opacity shown)',
      expression: 'var choice = effect("Dropdown Menu Control")("Menu").value;\nchoice == 1 ? 100 : choice == 2 ? 50 : 0',
      notes: 'Add the effect FIRST (add_effect "ADBE Dropdown Control"). choice is 1-based. Extend the ternary chain per menu item — standard multi-variant MOGRT switch.',
      requires: ['ADBE Dropdown Control']
    },
    {
      id: 'auto-box-anchored',
      name: 'Auto text box that tracks alignment (position part)',
      keywords: ['box', 'background', 'anchor', 'alignment', 'left', 'right', 'sourcerectattime', 'плашка', 'выравнивание', 'подложка'],
      target: 'Shape rectangle Position — the sibling of the Size path from add_shape_rectangle (e.g. "Contents>Rectangle>Contents>Rectangle Path 1>Position")',
      expression: 'var t = thisComp.layer("TEXT");\nvar r = t.sourceRectAtTime(time, false);\n[r.left + r.width / 2, r.top + r.height / 2]',
      notes: 'Companion to auto-size-box: apply THIS to the rectangle Position and the size expression to Size, then set the box layer position equal to the TEXT layer position (or parent it). The box now hugs the text even with left/right paragraph alignment — fixes the classic "box drifts on left-aligned text" problem.',
      requires: []
    },
    {
      id: 'camera-shake',
      name: 'Camera shake rig (slider-driven wiggle)',
      keywords: ['camera', 'shake', 'earthquake', 'handheld', 'impact', 'камера', 'землетрясение', 'дрожание'],
      target: 'Transform>Position of an adjustment layer, camera or parent null',
      expression: 'wiggle(effect("Shake Freq")("Slider"), effect("Shake Amp")("Slider"))',
      notes: 'Add TWO Slider Controls first and rename them "Shake Freq" and "Shake Amp" (freq ~8, amp ~15 for handheld; freq 20+, amp 40+ for impact). On a 2D adjustment-layer rig also scale the layer to ~103% so edges never show. Keyframe the Amp slider to ramp the shake in/out.',
      requires: ['ADBE Slider Control', 'ADBE Slider Control']
    },
    {
      id: 'attach-to-path',
      name: 'Move layer along a mask path (pointOnPath)',
      keywords: ['path', 'follow', 'motion path', 'pointonpath', 'trajectory', 'путь', 'маске', 'траектория'],
      target: 'Transform>Position',
      expression: 'var L = thisComp.layer("PATH");\nvar p = L.mask("Mask 1").maskPath;\nvar t = effect("Progress")("Slider") / 100;\nL.toComp(p.pointOnPath(clamp(t, 0, 1)))',
      notes: 'Draw a mask path on a layer named PATH, add a Slider Control renamed "Progress" to THIS layer, keyframe it 0→100. To aim along the path add to Rotation: var tg = thisComp.layer("PATH").mask("Mask 1").maskPath.tangentOnPath(effect("Progress")("Slider")/100); radiansToDegrees(Math.atan2(tg[1], tg[0])).',
      requires: ['ADBE Slider Control']
    },
    {
      id: 'trim-paths-reveal',
      name: 'Draw-on line reveal (Trim Paths End)',
      keywords: ['trim', 'paths', 'draw on', 'write on', 'line', 'stroke', 'reveal', 'прорисовка', 'линия', 'обводка'],
      target: 'Shape layer "Contents>Trim Paths 1>End" (add the Trim Paths operator to the shape group first)',
      expression: 'linear(time, inPoint, inPoint + 1, 0, 100)',
      notes: 'Trim Paths is a shape operator, not an effect — it must exist on the shape layer before applying (Add > Trim Paths in the shape contents). Draws the stroke on over 1s from the layer in-point; retiming the layer retimes the reveal. Reverse (0←100 swap) for erase-off.',
      requires: []
    },
    {
      id: 'freeze-frame',
      name: 'Freeze frame via Time Remap + slider',
      keywords: ['freeze', 'frame', 'hold', 'still', 'time remap', 'стоп-кадр', 'заморозить', 'пауза'],
      target: 'Time Remap (enable Layer > Time > Enable Time Remapping first)',
      expression: 'framesToTime(Math.round(effect("Freeze Frame")("Slider")))',
      notes: 'Enable Time Remapping on the footage layer FIRST, add a Slider Control renamed "Freeze Frame", then apply to the Time Remap property. The slider picks the source frame to hold — keyframe it for play/freeze/play sequences.',
      requires: ['ADBE Slider Control']
    },
    {
      id: 'time-remap-loop',
      name: 'Loop footage seamlessly (Time Remap)',
      keywords: ['loop', 'footage', 'video', 'seamless', 'time remap', 'зациклить', 'видео', 'футаж'],
      target: 'Time Remap (enable Layer > Time > Enable Time Remapping first)',
      expression: '(time - inPoint) % (source.duration - thisComp.frameDuration)',
      notes: 'Enable Time Remapping FIRST, then apply and extend the layer out-point as far as needed. Subtracting one frame duration skips the blank last time-remap frame — the classic loop bug fix.',
      requires: []
    },
    {
      id: 'timecode',
      name: 'Timecode burn-in HH:MM:SS:FF',
      keywords: ['timecode', 'clock', 'burn in', 'frames', 'counter', 'таймкод', 'время', 'часы'],
      target: 'Text>Source Text',
      expression: 'var fps = 1 / thisComp.frameDuration;\nvar t = Math.max(0, time);\nvar h = Math.floor(t / 3600);\nvar m = Math.floor((t % 3600) / 60);\nvar s = Math.floor(t % 60);\nvar f = Math.floor((t % 1) * fps + 0.0001);\nfunction p2 (n) { return (n < 10 ? "0" : "") + n }\np2(h) + ":" + p2(m) + ":" + p2(s) + ":" + p2(f)',
      notes: 'Live comp timecode on a text layer — dailies/burn-in staple. Use (time - inPoint) instead of time to count from the layer start.',
      requires: []
    },
    {
      id: 'autofocus-dof',
      name: 'Camera auto-focus on a layer (Focus Distance)',
      keywords: ['focus', 'dof', 'depth', 'field', 'camera', 'rack focus', 'автофокус', 'фокус', 'резкость'],
      target: 'Camera Options>Focus Distance (on the camera layer)',
      expression: 'var t = thisComp.layer("TARGET");\nlength(toWorld(anchorPoint), t.toWorld(t.anchorPoint))',
      notes: 'Replace TARGET with the layer to keep sharp. Enable Depth of Field on the camera. Swap TARGET over time (or use a null) for automatic rack-focus.',
      requires: []
    },
    {
      id: 'pin-to-edge',
      name: 'Pin layer to comp edge/corner (responsive)',
      keywords: ['pin', 'edge', 'corner', 'responsive', 'margin', 'угол', 'край', 'отступ'],
      target: 'Transform>Position',
      expression: 'var margin = 50;\n[thisComp.width - margin, thisComp.height - margin]',
      notes: 'Pins to the bottom-right corner with a 50px margin — survives comp resizes (9:16 adaptations). Variants: top-left [margin, margin]; bottom-center [thisComp.width/2, thisComp.height - margin]. Mind the anchor point.',
      requires: []
    },
    {
      id: 'auto-fit-text',
      name: 'Shrink text to fit a max width',
      keywords: ['fit', 'shrink', 'width', 'auto scale', 'text', 'ужать', 'ширина', 'вместить'],
      target: 'Transform>Scale (of the text layer)',
      expression: 'var maxW = 800;\nvar w = sourceRectAtTime(time, false).width;\nvar s = w > 0 ? Math.min(100, maxW / w * 100) : 100;\n[s, s]',
      notes: 'Long strings scale down to stay within maxW pixels; short ones stay at 100%. Essential for data-driven/localized text. Set maxW to the safe width of your template.',
      requires: []
    },
    {
      id: 'keep-stroke-width',
      name: 'Constant stroke width while layer scales',
      keywords: ['stroke', 'width', 'constant', 'compensate', 'outline', 'толщина', 'обводка', 'масштаб'],
      target: 'Shape layer stroke width (e.g. "Contents>Shape 1>Contents>Stroke 1>Stroke Width")',
      expression: 'value * 100 / transform.scale[0]',
      notes: 'The stroke keeps its on-screen thickness while the layer scale animates (zooms, pops). Assumes uniform scale — for non-uniform use the axis that matters.',
      requires: []
    },
    {
      id: 'heartbeat-pulse',
      name: 'Heartbeat / BPM pulse',
      keywords: ['heartbeat', 'pulse', 'bpm', 'throb', 'beat', 'пульс', 'сердце', 'сердцебиение'],
      target: 'Transform>Scale',
      expression: 'var bpm = 60, amp = 8;\nvar p = Math.pow(Math.sin(time * bpm * Math.PI / 60), 8) * amp;\nvalue + [p, p]',
      notes: 'Sharp organic pulse at bpm beats per minute (pow-of-sin narrows the spike). amp = size of the pulse in scale %. Great for hearts, likes, notification badges; no keyframes needed.',
      requires: []
    },
    {
      id: 'word-by-word-reveal',
      name: 'Text reveal word by word',
      keywords: ['word', 'words', 'reveal', 'text', 'subtitles', 'слово', 'словам', 'субтитры'],
      target: 'Text>Source Text',
      expression: 'var words = text.sourceText.split(" ");\nvar dur = 2.0;\nvar n = Math.floor(linear(time - inPoint, 0, dur, 0, words.length));\nwords.slice(0, n).join(" ")',
      notes: 'Reveals the layer\'s own text one word at a time over dur seconds from the in-point — kinetic-subtitle staple. Sister of the typewriter snippet (per-letter).',
      requires: []
    },
    {
      id: 'cubic-bezier-ease',
      name: 'Custom cubic-bezier ease (CSS / MD3 / Apple curves)',
      keywords: ['bezier', 'cubic bezier', 'easing', 'ease', 'curve', 'md3', 'material', 'apple', 'custom ease', 'безье', 'кривая', 'плавность'],
      target: 'Any 1D property (Opacity, Rotation, 1 axis) — wrap [e, e] for 2D (Scale/Position)',
      expression: 'var t0 = inPoint, t1 = inPoint + 1;\nvar vA = 0, vB = 100;\nvar x1 = 0.16, y1 = 1.0, x2 = 0.3, y2 = 1.0;\nvar p = (t1 > t0) ? (time - t0) / (t1 - t0) : 1;\np = p < 0 ? 0 : (p > 1 ? 1 : p);\nfunction bez(c1, c2, u) { var v = 1 - u; return 3 * v * v * u * c1 + 3 * v * u * u * c2 + u * u * u; }\nvar u = p;\nfor (var i = 0; i < 8; i++) {\n  var x = bez(x1, x2, u) - p;\n  var d = 3 * (1 - u) * (1 - u) * x1 + 6 * (1 - u) * u * (x2 - x1) + 3 * u * u * (1 - x2);\n  if (d === 0) break;\n  u = u - x / d;\n  if (Math.abs(x) < 0.0001) break;\n}\nu = u < 0 ? 0 : (u > 1 ? 1 : u);\nvA + (vB - vA) * bez(y1, y2, u)',
      notes: 'Drives vA→vB over the time window [t0,t1] along a CSS-style cubic-bezier(x1,y1,x2,y2) — gives named UI curves AE\'s linear()/ease() cannot. Newton-Raphson solves x(u)=p then returns y(u); ES3-safe. Set the 4 control points from the table:\n  • Crisp out 0.16,1,0.3,1  • Slide-in 0.22,1,0.36,1  • Editorial inOut 0.45,0,0.55,1\n  • MD3 Standard 0.2,0,0,1  • MD3 Emphasized 0.05,0.7,0.1,1  • Apple HIG 0.25,0.1,0.25,1\n  • Overshoot pop 0.34,1.56,0.64,1  • Bounce settle 0.175,0.885,0.32,1.275\nControl points with y>1 (overshoot/bounce) push past vB on purpose. For 2D: replace the last line with `var e = bez(y1, y2, u); vA + (vB - vA) * e` and wrap the property, e.g. `[eX, eY]`. Numbers are standard CSS cubic-bezier values.',
      requires: []
    }
  ]

  /**
   * Keyword search over the snippet library.
   * Scoring: exact keyword hit = 3, keyword prefix/substring = 2,
   * name/notes substring = 1 per query token.
   */
  function search (query, maxResults) {
    var max = (typeof maxResults === 'number' && maxResults > 0) ? maxResults : 5
    var q = String(query || '').toLowerCase().trim()
    if (!q) {
      return {
        ok: false,
        message: 'search_expression_library: provide a non-empty `query` (e.g. "bounce", "typewriter", "loop").'
      }
    }
    var tokens = q.split(/[\s,;]+/).filter(function (t) { return t.length > 1 })
    if (tokens.length === 0) tokens = [q]

    var scored = []
    for (var i = 0; i < SNIPPETS.length; i++) {
      var s = SNIPPETS[i]
      var score = 0
      for (var t = 0; t < tokens.length; t++) {
        var tok = tokens[t]
        for (var k = 0; k < s.keywords.length; k++) {
          var kw = s.keywords[k]
          if (kw === tok) { score += 3 } else if (kw.indexOf(tok) !== -1 || tok.indexOf(kw) !== -1) { score += 2 }
        }
        if (s.name.toLowerCase().indexOf(tok) !== -1) score += 1
        if (s.notes.toLowerCase().indexOf(tok) !== -1) score += 1
      }
      if (score > 0) scored.push({ score: score, snippet: s })
    }
    scored.sort(function (a, b) { return b.score - a.score })

    var out = []
    for (var j = 0; j < scored.length && j < max; j++) {
      var sn = scored[j].snippet
      out.push({
        id: sn.id,
        name: sn.name,
        target: sn.target,
        expression: sn.expression,
        notes: sn.notes,
        requires: sn.requires
      })
    }
    return {
      ok: true,
      message: out.length > 0
        ? ('Found ' + out.length + ' snippet(s) for "' + q + '". Apply with apply_expression; create any `requires` effects first via add_effect. NOTE: on localized AE (RU etc.) effect display names differ — reference effects by the exact name reported after add_effect, not the English name from the snippet.')
        : ('No library snippets match "' + q + '". Write the expression manually following the Expression Expertise rules.'),
      snippets: out
    }
  }

  if (typeof window !== 'undefined') {
    window.PURE_EXPR_LIB = { SNIPPETS: SNIPPETS, search: search }
  }
})()
