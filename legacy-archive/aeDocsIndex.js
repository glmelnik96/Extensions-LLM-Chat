;(function () {
  'use strict';

  /**
   * Curated, compact After Effects expressions reference.
   *
   * This is intentionally small and hand-edited so it can be maintained locally.
   * You can safely extend it with more snippets and categories over time.
   *
   * Data shape (per entry):
   * {
   *   id: string,
   *   category: string,          // e.g. 'transforms', 'looping'
   *   title: string,
   *   aeVersion: string,         // e.g. '26.0+'
   *   keywords: string[],        // lowercased, may contain Russian and English
   *   apis: string[],            // known AE identifiers / helpers used in the snippet
   *   text: string               // short, practical description or pattern summary
   * }
   */

  var DOCS = [
    // Transforms
    {
      id: 'transforms_basic_position_link',
      category: 'transforms',
      title: 'Link position to another layer',
      aeVersion: 'CS6+',
      keywords: [
        'position',
        'transform',
        'link',
        'relative',
        'parent',
        'позиция',
        'связать',
        'другой слой'
      ],
      apis: ['thisComp', 'layer', 'transform', 'position', 'value'],
      text:
        'Position expressions commonly reference another layer via thisComp.layer("Name").transform.position ' +
        'and may add an offset. Parent-child relationships use parent.transform to inherit transforms.'
    },
    {
      id: 'transforms_anchor_rotation_scale',
      category: 'transforms',
      title: 'Anchor / rotation / scale basics',
      aeVersion: 'CS6+',
      keywords: [
        'anchorPoint',
        'rotation',
        'scale',
        'anchor',
        'якорь',
        'масштаб',
        'вращение'
      ],
      apis: ['transform', 'anchorPoint', 'rotation', 'scale', 'value'],
      text:
        'Transform properties are accessed via transform.anchorPoint, transform.position, transform.scale, ' +
        'transform.rotation and transform.opacity. Expressions usually modify these relative to value.'
    },
    {
      id: 'transforms_parent_like_link',
      category: 'transforms',
      title: 'Parent-like transform linking',
      aeVersion: 'CS6+',
      keywords: [
        'parent',
        'link',
        'inherit',
        'transform',
        'position',
        'rotation',
        'scale',
        'родитель',
        'наследование',
        'позиция родителя'
      ],
      apis: ['parent', 'transform', 'position', 'rotation', 'scale'],
      text:
        'When a layer has a parent, expressions can read parent.transform.position, parent.transform.rotation and ' +
        'parent.transform.scale to inherit or offset transforms relative to the parent, similar to pick-whipped links.'
    },

    // Interpolation and easing
    {
      id: 'easing_linear',
      category: 'interpolation_easing',
      title: 'linear() interpolation',
      aeVersion: 'CS6+',
      keywords: [
        'linear',
        'interpolation',
        'mapping',
        'ремап',
        'интерполяция',
        'плавность'
      ],
      apis: ['linear'],
      text:
        'linear(t, tMin, tMax, value1, value2) maps t from [tMin, tMax] to a value between value1 and value2 ' +
        'without easing. It is often driven by time or a Slider Control.'
    },
    {
      id: 'easing_ease',
      category: 'interpolation_easing',
      title: 'ease()/easeIn()/easeOut() basics',
      aeVersion: 'CS6+',
      keywords: [
        'ease',
        'easein',
        'easeout',
        'easing',
        'интерполяция',
        'легкий вход',
        'легкий выход'
      ],
      apis: ['ease', 'easeIn', 'easeOut', 'easeInOut'],
      text:
        'ease(t, tMin, tMax, value1, value2) maps t between tMin and tMax to a smoothed value between value1 ' +
        'and value2. easeIn, easeOut and easeInOut provide variants of this behavior.'
    },

    // Random and wiggle
    {
      id: 'random_basic_scalar',
      category: 'random',
      title: 'random() basic scalar usage',
      aeVersion: 'CS6+',
      keywords: [
        'random',
        'noise',
        'rand',
        'случайное',
        'рандом',
        'шум'
      ],
      apis: ['random'],
      text:
        'random() with no arguments returns a value between 0 and 1. random(max) returns a value between 0 and max. ' +
        'random(min, max) returns a value between min and max. These patterns are documented in the random number ' +
        'section of the After Effects expression reference.'
    },
    {
      id: 'random_array_values',
      category: 'random',
      title: 'random() with arrays',
      aeVersion: 'CS6+',
      keywords: [
        'random array',
        'vector random',
        'случайный вектор',
        'массив',
        'цвет random'
      ],
      apis: ['random'],
      text:
        'random() can take arrays to generate random multi-dimensional values, such as random([0,0], [1920,1080]) ' +
        'for 2D positions or random([0,0,0], [1,1,1]) for 3D. Each component is randomized within the given range.'
    },
    {
      id: 'random_seedRandom_timeless',
      category: 'random',
      title: 'seedRandom() for repeatable random',
      aeVersion: 'CS6+',
      keywords: [
        'seedrandom',
        'random seed',
        'timeless',
        'фиксированный рандом',
        'детерминированный'
      ],
      apis: ['seedRandom', 'random', 'time'],
      text:
        'seedRandom(offset, timeless) sets the seed for random(). With timeless = true, random values do not change ' +
        'over time, which is useful for stable per-layer or per-character randomness as described in the random ' +
        'numbers section of the expression reference.'
    },
    {
      id: 'wiggle_basic',
      category: 'random',
      title: 'wiggle() basic usage',
      aeVersion: 'CS6+',
      keywords: [
        'wiggle',
        'noise',
        'shake',
        'wiggle expression',
        'тряска',
        'шевеление'
      ],
      apis: ['wiggle'],
      text:
        'wiggle(freq, amp, octaves, amp_mult, t) randomly varies a property value around its current value. ' +
        'freq is wiggles per second and amp is amplitude. Additional optional parameters match the wiggle() ' +
        'signature documented in the After Effects expression reference.'
    },

    // Time-based functions
    {
      id: 'time_based_time_value',
      category: 'time_based',
      title: 'Using time and value',
      aeVersion: 'CS6+',
      keywords: ['time', 'seconds', 'анимация', 'по времени', 'time based'],
      apis: ['time', 'value'],
      text:
        'time is the current comp time in seconds. Expressions often combine time with value to animate ' +
        'properties, for example value + time * speed.'
    },
    {
      id: 'time_based_valueAtTime',
      category: 'valueAtTime',
      title: 'valueAtTime() offsets',
      aeVersion: 'CS6+',
      keywords: [
        'valueattime',
        'delay',
        'offset',
        'trail',
        'задержка',
        'сдвиг по времени'
      ],
      apis: ['valueAtTime', 'time'],
      text:
        'valueAtTime(t) evaluates the same property at the specified time t (in seconds). ' +
        'Delay expressions often use valueAtTime(time - delaySeconds).'
    },
    {
      id: 'time_based_valueAtTime_index_delay',
      category: 'valueAtTime',
      title: 'valueAtTime() with layer index delay',
      aeVersion: 'CS6+',
      keywords: [
        'delay by index',
        'offset by index',
        'stagger',
        'trail layers',
        'задержка по индексу',
        'каскад'
      ],
      apis: ['valueAtTime', 'time', 'index'],
      text:
        'Staggered animations often use valueAtTime(time - index * delaySeconds) so each layer with a higher index ' +
        'plays the same keyframed motion later in time. This is a common pattern described in examples of ' +
        'delay/trail expressions.'
    },

    // Looping
    {
      id: 'looping_loopOut',
      category: 'looping',
      title: 'loopOut() and loopIn()',
      aeVersion: 'CS6+',
      keywords: [
        'loopout',
        'loopin',
        'cycle',
        'loop',
        'циклическая',
        'зациклить'
      ],
      apis: ['loopOut', 'loopIn'],
      text:
        'loopOut(type, numKeyframes) and loopIn(type, numKeyframes) repeat keyframed animation ' +
        'before or after the existing keyframes. Common types include "cycle", "pingpong", "offset" and "continue".'
    },
    {
      id: 'looping_loopOut_cycle',
      category: 'looping',
      title: 'loopOut(\"cycle\") repeat last keyframes',
      aeVersion: 'CS6+',
      keywords: [
        'loopout cycle',
        'циклический луп',
        'повтор анимации',
        'loop cycle'
      ],
      apis: ['loopOut'],
      text:
        'loopOut(\"cycle\") repeats the animation between the first and last keyframes for as long as the layer ' +
        'exists, seamlessly looping the motion. This is one of the documented loopOut() types.'
    },
    {
      id: 'looping_loopOut_pingpong',
      category: 'looping',
      title: 'loopOut(\"pingpong\") back-and-forth',
      aeVersion: 'CS6+',
      keywords: [
        'loopout pingpong',
        'pingpong',
        'back and forth',
        'обратный луп',
        'туда-сюда'
      ],
      apis: ['loopOut'],
      text:
        'loopOut(\"pingpong\") plays the keyframed animation forward and then backward, repeating this ' +
        'back-and-forth motion over time, as documented in the loop expressions section.'
    },
    {
      id: 'looping_loopOut_offset',
      category: 'looping',
      title: 'loopOut(\"offset\") with accumulating offset',
      aeVersion: 'CS6+',
      keywords: [
        'loopout offset',
        'offset',
        'накопление',
        'постоянный сдвиг'
      ],
      apis: ['loopOut'],
      text:
        'loopOut(\"offset\") repeats the animation while adding the value change from the last keyframe range ' +
        'each time, creating a continually increasing or drifting motion, as described in the loopOut() reference.'
    },

    // Text and sourceRectAtTime
    {
      id: 'text_sourceRectAtTime',
      category: 'text_sourceRectAtTime',
      title: 'Text layer sourceRectAtTime()',
      aeVersion: 'CC 2014+',
      keywords: [
        'sourcerectattime',
        'text',
        'bounding box',
        'текст',
        'рамка',
        'ширина текста'
      ],
      apis: ['sourceRectAtTime', 'text', 'sourceText'],
      text:
        'On text and shape layers, sourceRectAtTime(time, includeExtents) returns an object with left, top, ' +
        'width and height fields describing the layer content bounds in layer space.'
    },
    {
      id: 'text_per_character_textIndex',
      category: 'text_index',
      title: 'Per-character expressions with textIndex',
      aeVersion: 'CS6+',
      keywords: [
        'textindex',
        'text total',
        'per-character',
        'по символам',
        'анимация текста',
        'индекс символа'
      ],
      apis: ['textIndex', 'textTotal'],
      text:
        'On text layers, textIndex is the 1-based index of the current character and textTotal is the total ' +
        'number of characters. Per-character expressions often use these values to stagger or offset properties ' +
        'across the text range.'
    },
    {
      id: 'text_sourceText_basic',
      category: 'text_source',
      title: 'Accessing Source Text',
      aeVersion: 'CS6+',
      keywords: [
        'sourcetext',
        'text.sourceText',
        'text layer',
        'исходный текст',
        'менять текст'
      ],
      apis: ['text', 'sourceText'],
      text:
        'For text layers, text.sourceText references the Source Text property value in expressions. ' +
        'You can read this value or combine it with other logic to drive text-based effects.'
    },
    {
      id: 'text_sourceRectAtTime_center_anchor',
      category: 'text_sourceRectAtTime',
      title: 'Center anchorPoint using sourceRectAtTime()',
      aeVersion: 'CC 2014+',
      keywords: [
        'center anchor',
        'центрировать якорь',
        'по центру текста',
        'anchorpoint text',
        'sourcerectattime center'
      ],
      apis: ['sourceRectAtTime', 'anchorPoint', 'text', 'sourceText'],
      text:
        'A common pattern is to use var r = sourceRectAtTime(time, false); then offset anchorPoint by ' +
        'r.left + r.width/2 and r.top + r.height/2 to center the text around the anchor, as shown in ' +
        'examples using sourceRectAtTime() for text alignment.'
    },

    // Expression controls
    {
      id: 'expression_controls_slider',
      category: 'expression_controls',
      title: 'Slider Control access',
      aeVersion: 'CS6+',
      keywords: [
        'slider control',
        'effect',
        'экспрешн контрол',
        'слайдер',
        'управление выражениями'
      ],
      apis: ['effect', 'Slider Control', 'Slider'],
      text:
        'Expression Controls are usually accessed via effect("Slider Control")("Slider") and similar. ' +
        'Dropdown Menu Control and other controls use their display names and match the Effect and property names.'
    },
    {
      id: 'expression_controls_angle',
      category: 'expression_controls',
      title: 'Angle Control access',
      aeVersion: 'CS6+',
      keywords: [
        'angle control',
        'rotation control',
        'угол',
        'контрол угла',
        'effect angle'
      ],
      apis: ['effect', 'Angle Control', 'Angle'],
      text:
        'Angle Control is accessed via effect("Angle Control")("Angle") and is commonly used to drive ' +
        'rotation or other angle-based properties from a single control layer.'
    },
    {
      id: 'expression_controls_color',
      category: 'expression_controls',
      title: 'Color Control access',
      aeVersion: 'CS6+',
      keywords: [
        'color control',
        'цвет',
        'контрол цвета',
        'effect color'
      ],
      apis: ['effect', 'Color Control', 'Color'],
      text:
        'Color Control is accessed via effect("Color Control")("Color") and returns an RGBA color array. ' +
        'Expressions often link other color properties directly to this control.'
    },
    {
      id: 'expression_controls_point',
      category: 'expression_controls',
      title: 'Point Control access',
      aeVersion: 'CS6+',
      keywords: [
        'point control',
        '2d control',
        'position control',
        'точка',
        'point эффект'
      ],
      apis: ['effect', 'Point Control', 'Point'],
      text:
        'Point Control is accessed via effect("Point Control")("Point") and returns a 2D point. ' +
        'It is useful for driving positions or other 2D vector properties from a controller layer.'
    },

    // Path-related logic
    {
      id: 'paths_basic_points',
      category: 'paths',
      title: 'Shape path points() and tangents',
      aeVersion: 'CC 2018+',
      keywords: [
        'path',
        'shape',
        'points',
        'inTangents',
        'outTangents',
        'контур',
        'точки контура'
      ],
      apis: ['path', 'points', 'inTangents', 'outTangents'],
      text:
        'On a shape path property, value is a Path object whose points(), inTangents() and outTangents() methods ' +
        'return arrays describing the vertices and Bezier handles. Reading these arrays is supported in ' +
        'expressions; writing complex path data is more advanced and version-dependent.'
    },
    {
      id: 'paths_points_indexing',
      category: 'paths',
      title: 'Indexing path points',
      aeVersion: 'CC 2018+',
      keywords: [
        'path points index',
        'точки по индексу',
        'контур точки',
        'shape path point'
      ],
      apis: ['path', 'points'],
      text:
        'For shape paths, value.points() returns an array of vertices that can be indexed like points()[0], ' +
        'points()[1], etc. Expressions often read specific points to drive other properties or attach layers to a path.'
    },

    // Property references
    {
      id: 'property_references_thisProperty',
      category: 'property_references',
      title: 'thisProperty and value',
      aeVersion: 'CS6+',
      keywords: [
        'thisproperty',
        'value',
        'property',
        'текущее свойство',
        'значение по умолчанию'
      ],
      apis: ['thisProperty', 'value'],
      text:
        'Inside an expression, thisProperty refers to the property the expression is applied to. ' +
        'value is the property’s current value before the expression modifies it.'
    },
    {
      id: 'property_references_toComp_fromComp',
      category: 'property_references',
      title: 'toComp() and fromComp() coordinate conversion',
      aeVersion: 'CS6+',
      keywords: [
        'tocomp',
        'fromcomp',
        'layer space',
        'comp space',
        'координаты композиции',
        'пространство слоя'
      ],
      apis: ['toComp', 'fromComp'],
      text:
        'Layer space transform methods like toComp() and fromComp() convert points between layer space and ' +
        'composition space. These helpers are used when aligning properties across layers in different spaces, ' +
        'as documented in the layer space transforms section of the expression reference.'
    },

    // Compatibility/version notes
    {
      id: 'compat_dropdown_menu_control',
      category: 'compatibility',
      title: 'Dropdown Menu Control expression access',
      aeVersion: '26.0+',
      keywords: [
        'dropdown',
        'dropdown menu control',
        'меню выбора',
        'ae 26',
        '26.0'
      ],
      apis: ['effect', 'Dropdown Menu Control'],
      text:
        'In After Effects 26.0 and later, Dropdown Menu Control allows expressions to access the selected index ' +
        'and, in newer builds, the selected item name as documented in the AE expression reference.'
    }
  ];

  if (typeof window !== 'undefined') {
    window.AE_DOCS_INDEX = DOCS;
  } else {
    this.AE_DOCS_INDEX = DOCS;
  }
})();

