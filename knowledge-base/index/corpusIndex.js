/**
 * Runtime index for the local knowledge base. One shared corpus, three projections.
 * Loaded by the extension via <script src="knowledge-base/index/corpusIndex.js">.
 * Adobe = primary; docsforadobe = secondary. Content is embedded so no fetch is required.
 */
(function () {
  'use strict'

  var corpus = {
    expression_basics: {
      title: 'Expression language basics',
      source: 'adobe',
      body: 'Expressions run in the AE expression environment (no DOM, no browser/Node). Globals: thisComp, thisLayer, thisProperty, parent, time, value, velocity. Property groups: transform, position, anchorPoint, scale, rotation, opacity; effect("Name")("Property"). No app, $, File, Folder, system.callSystem. Target: expression is evaluated for the property it is applied to; value is that property\'s value. Expression must evaluate to a single value of the correct type. JavaScript engine pitfalls: do not use this() — use thisLayer; no snake_case (use camelCase: thisComp, toWorld); Source Text character access use text.sourceText.value[i]; Source Text baseline read: value may be string — do not use value.text alone, use (typeof value === \'string\' ? value : value.text); if/else needs brackets and explicit else; expression must end in a value, not a function declaration only. Link: thisComp.layer("Controller").effect("Slider")("Slider"). Time: time, valueAtTime(time - delay), key(). Loop: loopOut(), loopIn(), loopOut("cycle"), loopOut("pingpong").',
      snippets: [
        'thisComp, thisLayer, thisProperty, parent, time, value, velocity are expression globals.',
        'Use effect("Effect Name")("Property Name") for expression controls.',
        'loopOut("cycle"), loopIn(), valueAtTime(time - delay) for common patterns.',
        'Forbidden in expressions: app, $, document, window, require, File, Folder, system.callSystem.',
        'Use thisLayer not this(). Use camelCase not snake_case (thisComp not this_comp). Source Text: text.sourceText.value[i]. Source Text baseline read: value may be string; do not use value.text alone — use (typeof value === \'string\' ? value : value.text) or documented APIs.',
      ],
    },
    wiggle_valueAtTime_posterizeTime: {
      title: 'wiggle, valueAtTime, posterizeTime',
      source: 'adobe',
      body: 'wiggle(freq, amp): freq in Hz, amp in property units (degrees, pixels, 0-100 for opacity). valueAtTime(t): value at time t; use for delays. posterizeTime(fps): sample at lower fps for stepped animation. time, inPoint, outPoint, key(n), nearestKey(time), numKeys.',
      snippets: [
        'wiggle(2, 20) on Position: 2 Hz, 20 px amplitude.',
        'valueAtTime(time - 0.2) for 0.2 s delay.',
        'posterizeTime(12) then wiggle for stepped motion.',
      ],
    },
    sourceText_sourceRectAtTime: {
      title: 'Source Text and sourceRectAtTime',
      source: 'adobe',
      body: 'Source Text: Text > Source Text; text animators, textIndex, textTotal. On Source Text, value may be a string — do not use value.text without checking; use (typeof value === \'string\' ? value : value.text) for baseline text. sourceRectAtTime(t, includeExtents): left, top, width, height, right, bottom. Used for text bounds and layout. Restriction: not all text properties are expression-accessible; use documented APIs only.',
      snippets: [
        'sourceRectAtTime(time) for text layer bounds.',
        'Text animators: text.animator("Name").property("Selector").property("Property").',
        'Source Text: value may be string; use (typeof value === \'string\' ? value : value.text) for full text, not value.text alone.',
      ],
    },
    property_targeting_constraints: {
      title: 'Property targeting constraints',
      source: 'adobe',
      body: 'Expression must be for the exact property selected. Position: [x, y] or [x, y, z]. Scale: array. Rotation: degrees. Opacity: 0-100. Slider / Effect > Slider Control: number. Wrong type causes runtime errors. Paths: Transform>Position, Text>Source Text. Manual apply only; single expression string, no code fences.',
      snippets: [
        'Position expects [x, y] or [x, y, z].',
        'Match target property type; validator checks target_ok.',
      ],
    },
    common_patterns: {
      title: 'Common expression patterns',
      source: 'docsforadobe',
      body: 'Linking: comp.layer("A").transform.position + [10, 0]. Slider: effect("Slider Control")("Slider"). loopOut("cycle", 0), loopOut("pingpong", 0). linear(t, tMin, tMax, v1, v2), ease(), easeIn, easeOut, easeInOut. Use only documented globals.',
      snippets: [
        'effect("Slider Control")("Slider") for slider-driven values.',
        'loopOut("cycle", 0) or loopOut("pingpong", 0) for keyframe loops.',
      ],
    },
    repair_fix_recipes: {
      title: 'Repair fix recipes',
      source: 'docsforadobe',
      body: 'Fix only reported issues. Syntax: add semicolons where required. Wrong type: Position returns [x,y]; Slider returns number. Forbidden: replace app, $, document, window with expression-safe APIs. Target mismatch: use thisLayer, thisComp.layer(index), exact property path. wiggle/valueAtTime/posterizeTime: numeric arguments only. Engine-specific: this() → thisLayer; snake_case → camelCase (thisComp, toWorld); Source Text use text.sourceText.value[i]; Source Text baseline read: use (typeof value === \'string\' ? value : value.text), not value.text alone; if/else brackets and explicit else; expression must end in a value.',
      snippets: [
        'Replace app, $, document, window with thisComp/thisLayer/effect().',
        'Position must return [x, y]; Slider must return a number.',
        'Do not rewrite the whole expression; patch the reported issue.',
        'Add semicolons only where required; do not refactor the rest.',
        'Replace this() with thisLayer; snake_case with camelCase; Source Text use .value for character access. Source Text: if value.text causes undefined, use (typeof value === \'string\' ? value : value.text) for baseline read.',
      ],
    },
  }

  var projections = {
    generator: ['expression_basics', 'wiggle_valueAtTime_posterizeTime', 'sourceText_sourceRectAtTime', 'property_targeting_constraints', 'common_patterns'],
    validator: ['expression_basics', 'property_targeting_constraints', 'sourceText_sourceRectAtTime', 'wiggle_valueAtTime_posterizeTime', 'common_patterns'],
    repair: ['repair_fix_recipes', 'wiggle_valueAtTime_posterizeTime', 'property_targeting_constraints', 'common_patterns'],
  }

  function getGroundingForProjection (projectionName) {
    var topicIds = projections[projectionName]
    if (!topicIds || !topicIds.length) return ''
    var out = []
    for (var i = 0; i < topicIds.length; i++) {
      var topic = corpus[topicIds[i]]
      if (!topic) continue
      out.push('[Topic: ' + topic.title + ']\n' + topic.body)
      if (topic.snippets && topic.snippets.length) {
        topic.snippets.forEach(function (s) {
          out.push('- ' + s)
        })
      }
    }
    return out.join('\n\n')
  }

  if (typeof window !== 'undefined') {
    window.KB_CORPUS_INDEX = {
      corpus: corpus,
      projections: projections,
      getGroundingForProjection: getGroundingForProjection,
    }
  }
})()
