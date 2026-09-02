/**
 * Tool gating — offer the model only the tool schemas a request plausibly
 * needs, and load the rest on demand.
 *
 * Why: the 69 tool schemas cost ~17k tokens on EVERY model call (60% of the
 * fixed context; the prompt itself is ~11k). Most requests touch a dozen
 * tools. A CORE set (inspection, layers, keyframes, values, text, switches,
 * batch) is always offered; rarely needed groups (shapes, masks, effects,
 * expressions, 3D, markers, project, compositing, subtitles, capture) are
 * added when the conversation mentions them — and, as a safety net, when the
 * model calls a gated tool anyway (it knows the names from the prompt): the
 * loop then loads that group for the rest of the run and still executes the
 * call, so a missed keyword costs nothing.
 *
 * Pure, side-effect-free. Loaded as a browser global (window.PURE_TOOL_GATING)
 * and as a Node module (require) so it can be unit-tested.
 */
;(function (root, factory) {
  var api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.PURE_TOOL_GATING = api
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  // Rarely needed tools, grouped. Anything NOT listed here is CORE.
  // Keyword regexes are deliberately generous (RU + EN, stems): over-inclusion
  // costs a few hundred tokens, under-inclusion is caught by on-demand loading.
  var GROUPS = {
    shapes: {
      tools: ['add_shape_rectangle', 'add_shape_ellipse', 'add_shape_path', 'create_shapes_from_text'],
      re: /фигур|shape|прямоуг|эллипс|круг|круж|овал|полос|полоск|квадрат|треугол|многоуг|звезд|контур|вершин|path|polygon|rectangle|ellipse|circle|square|triangle|из текста|outline|обвод|радуг|сетк|grid|фон\b|фона\b|фоном|background|плашк|плитк|бар\b|bars?\b/i
    },
    masks: {
      tools: ['add_mask', 'set_mask_properties', 'get_mask_info'],
      re: /маск|mask|вырез|обрез|crop|reveal|раскрыт|проявл|шторк|wipe/i
    },
    effects: {
      tools: ['list_available_effects', 'add_effect', 'remove_effect', 'set_effect_property', 'get_effect_properties'],
      re: /эффект|effect|blur|размыт|свеч|glow|slider|слайдер|checkbox|галочк|чекбокс|контроллер|controller|заливк|\bfill\b|tint|тонир|цветокор|color correction|тень|shadow|wipe|шум|noise|glitch|глитч|искаж|distort|градиент|gradient|обводк|stroke|скругл|round/i
    },
    expressions: {
      tools: ['get_expression', 'apply_expression', 'apply_expression_batch', 'link_properties', 'search_expression_library', 'save_user_expression', 'list_user_expressions', 'delete_user_expression'],
      re: /выражен|expression|экспрешен|expr\b|wiggle|loop|скрипт|формул|slider|слайдер|контроллер|controller|привяз|link|пиквип|pick.?whip|\btime\b|таймер|секундомер|счетчик|счётчик|counter|random|случайн|дрож|тряс|shake|bounce|пружин|inertia|инерц|overshoot|follow|повторя|задержк|delay|эхо|валют|библиотек|library|сохрани|мои выраж|орбит|orbit|крут|враща|rotate|spin|пульс|pulse|дыш|breath|плава|float|мига|blink|печата|typewriter|по букв|по слов|автомат|бесконечн|вечно|всё время|все время|ошибк|error|сломал|почини|fix/i
    },
    threed: {
      tools: ['set_layer_3d', 'set_camera_properties', 'set_light_properties'],
      re: /3d|3д|трёхмер|трехмер|камер|camera|\bсвет|light|объём|объем|глубин|depth|parallax|параллакс|перспектив/i
    },
    markers: {
      tools: ['add_marker', 'get_markers', 'delete_marker'],
      re: /маркер|marker|метк|отметк/i
    },
    project: {
      tools: ['list_project_items', 'import_file', 'add_item_to_comp', 'create_comp', 'precompose_layers', 'set_comp_settings', 'open_comp'],
      re: /импорт|import|файл|\bfile|footage|футаж|прекомп|precomp|pre-?compose|упакуй|композиц|\bcomp|проект|project|папк|folder|fps|фпс|frame ?rate|разрешен|resolution|длительн|duration|цвет фона|bg.?color|открой|open\b/i
    },
    compositing: {
      tools: ['set_blend_mode', 'set_track_matte', 'set_time_remap', 'split_layer'],
      re: /blend|режим.*налож|наложен|multiply|screen|overlay|matte|\bмат\b|матт|альфа|alpha|luma|люм|time.?remap|ремап|замедл|ускор|slow|speed|скорост|обратн|reverse|freeze|стоп-?кадр|split|разрез|раздел|разбей|порежь|полсекунд|в два раза|вдвое/i
    },
    subtitles: {
      tools: ['transcribe_comp_audio', 'create_subtitles', 'update_subtitles'],
      re: /субтитр|subtitle|транскри|transcri|whisper|речь|speech|аудио|audio|голос|voice|караоке|karaoke|титр/i
    },
    capture: {
      tools: ['capture_comp_frame'],
      re: /скриншот|screenshot|capture|захват|превью|preview|снимок|кадр\b|frame\b|покажи|посмотри|как выглядит|сфотк/i
    }
  }

  var _toolGroup = null
  function toolGroupMap () {
    if (_toolGroup) return _toolGroup
    _toolGroup = {}
    for (var g in GROUPS) {
      if (!GROUPS.hasOwnProperty(g)) continue
      for (var i = 0; i < GROUPS[g].tools.length; i++) _toolGroup[GROUPS[g].tools[i]] = g
    }
    return _toolGroup
  }

  /** Group id of a gated tool, or null when the tool is CORE / unknown. */
  function groupOfTool (name) {
    var m = toolGroupMap()
    return m.hasOwnProperty(name) ? m[name] : null
  }

  /** Group ids whose keywords match the text (in declaration order). */
  function groupsForText (text) {
    var t = String(text || '')
    var out = []
    for (var g in GROUPS) {
      if (GROUPS.hasOwnProperty(g) && GROUPS[g].re.test(t)) out.push(g)
    }
    return out
  }

  /**
   * Initial groups for a conversation: every USER message counts (a mid-task
   * reference from turn 1 must still be honoured in turn 3).
   */
  function initialGroups (messages) {
    var parts = []
    for (var i = 0; i < (messages ? messages.length : 0); i++) {
      var m = messages[i]
      if (m && m.role === 'user' && typeof m.content === 'string') parts.push(m.content)
    }
    return groupsForText(parts.join('\n'))
  }

  /**
   * Filter the registry: CORE tools + tools of the active groups, keeping
   * registry order. `activeGroups` is an array of group ids.
   */
  function selectTools (allTools, activeGroups) {
    var active = {}
    for (var i = 0; i < (activeGroups ? activeGroups.length : 0); i++) active[activeGroups[i]] = true
    var out = []
    for (var j = 0; j < (allTools ? allTools.length : 0); j++) {
      var t = allTools[j]
      var name = t && t.function && t.function.name
      var g = groupOfTool(name)
      if (!g || active[g]) out.push(t)
    }
    return out
  }

  return { GROUPS: GROUPS, groupOfTool: groupOfTool, groupsForText: groupsForText, initialGroups: initialGroups, selectTools: selectTools }
})
