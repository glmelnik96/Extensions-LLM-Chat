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
      id: 'marker-pulse',
      name: 'Pulse on every layer marker',
      keywords: ['marker', 'pulse', 'beat', 'sync', 'music', 'маркер', 'бит', 'пульс'],
      target: 'Transform>Scale (add to both dims) or any',
      expression: 'var amp = 15, decay = 6, freq = 8;\nvar n = 0;\nif (marker.numKeys > 0) {\n  n = marker.nearestKey(time).index;\n  if (marker.key(n).time > time) n--;\n}\nif (n > 0) {\n  var t = time - marker.key(n).time;\n  value + amp * Math.sin(freq * t) / Math.exp(decay * t);\n} else {\n  value;\n}',
      notes: 'Add layer markers on the beats (add_marker), the property pulses at each one. For Scale wrap: value + [p, p] where p is the pulse term.',
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
        ? ('Found ' + out.length + ' snippet(s) for "' + q + '". Apply with apply_expression; create any `requires` effects first via add_effect.')
        : ('No library snippets match "' + q + '". Write the expression manually following the Expression Expertise rules.'),
      snippets: out
    }
  }

  if (typeof window !== 'undefined') {
    window.PURE_EXPR_LIB = { SNIPPETS: SNIPPETS, search: search }
  }
})()
