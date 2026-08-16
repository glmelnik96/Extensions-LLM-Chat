/**
 * Quick-action definitions + user customization logic (pure, no DOM).
 * Browser global window.PURE_QUICK_ACTIONS + Node module for tests.
 *
 * The 16 defaults reproduce the previously hardcoded index.html buttons
 * (2026-07 demand research: row 1 = single expressions, row 2 = task-level
 * animations). Users can edit/delete any button and add their own; the full
 * list persists in localStorage. An absent/invalid stored list falls back to
 * the defaults, and reset simply deletes the stored list.
 */
;(function (root, factory) {
  var api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.PURE_QUICK_ACTIONS = api
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  // Prompts are Russian (RU-first product, bug-hunt 2026-08-16 finding #5:
  // English preset prompts made the agent answer Russian users in English).
  // Labels stay English — they are compact industry terms motion designers use.
  var DEFAULT_ACTIONS = [
    { id: 'qa_wiggle', label: 'Wiggle', prompt: 'Добавь wiggle(3, 25) к выделенным слоям', title: 'Wiggle-экспрешен на выделении' },
    { id: 'qa_loop', label: 'Loop', prompt: 'Зацикли существующие ключи на выделенных слоях через loopOut cycle', title: 'Бесконечный повтор анимации' },
    { id: 'qa_bounce', label: 'Bounce', prompt: 'Добавь bounce-изинг (упругий отскок) ко всем ключам на выделенных слоях', title: 'Отскок с перелётом на ключах' },
    { id: 'qa_counter', label: 'Counter', prompt: 'Создай счётчик от 0 до 100 на выделенном текстовом слое', title: 'Экспрешен-счётчик на тексте' },
    { id: 'qa_textbox', label: 'Text Box', prompt: 'Создай авторастягивающуюся подложку позади выделенного текстового слоя через sourceRectAtTime, с привязкой, работающей и при левом/правом выравнивании текста', title: 'Авто-подложка под текст (lower third)' },
    { id: 'qa_fade', label: 'Fade', prompt: 'Добавь экспрешен авто fade in/out на прозрачность выделенных слоёв', title: 'Фейд у точек входа/выхода, без ключей' },
    { id: 'qa_spin', label: 'Spin', prompt: 'Заставь выделенные слои непрерывно вращаться через экспрешен с time', title: 'Бесконечное вращение без ключей' },
    { id: 'qa_preview', label: 'Preview', prompt: 'Сохрани превью текущего кадра', title: 'Сохранить и показать текущий кадр' },
    { id: 'qa_stagger', label: 'Stagger', prompt: 'Сделай каскад из выделенных слоёв: сдвинь анимацию каждого слоя на 3 кадра позже предыдущего', title: 'Каскад слоёв с шагом 3 кадра' },
    { id: 'qa_popin', label: 'Pop In', prompt: 'Сделай pop-in для выделенных слоёв: отцентрируй якорь каждого без сдвига слоя, затем анимируй scale от 0 до 100 с пружинным перелётом от in-point слоя', title: 'Scale 0\u2192100 с перелётом от центрированного якоря' },
    { id: 'qa_typewriter', label: 'Typewriter', prompt: 'Добавь печатающийся текст (typewriter) на выделенный текстовый слой', title: 'Появление текста по буквам' },
    { id: 'qa_camshake', label: 'Cam Shake', prompt: 'Добавь тряску камеры в композицию: adjustment или null-риг со slider-управляемым wiggle, масштаб ~103%, чтобы края кадра не было видно', title: 'Риг тряски камеры со слайдером' },
    { id: 'qa_drawon', label: 'Draw-On', prompt: 'Анимируй прорисовку обводки выделенного shape-слоя через Trim Paths от 0 до 100', title: 'Прорисовка линии через Trim Paths' },
    { id: 'qa_slidein', label: 'Slide In', prompt: 'Сделай выезд выделенных слоёв слева с плавным изингом от их in-point', title: 'Плавный въезд слева' },
    { id: 'qa_smoothease', label: 'Smooth Ease', prompt: 'Примени плавный easy ease с лёгким перелётом ко всем существующим ключам на выделенных слоях', title: 'Полировка ключей: изинг + перелёт' },
    { id: 'qa_centeranchor', label: 'Center Anchor', prompt: 'Перемести якорную точку каждого выделенного слоя в его центр без сдвига слоя', title: 'Центрировать якоря (с компенсацией)' }
  ]

  function isValidAction (a) {
    return !!(a && typeof a === 'object' &&
      typeof a.id === 'string' && a.id &&
      typeof a.label === 'string' && a.label &&
      typeof a.prompt === 'string' && a.prompt)
  }

  // Parse a persisted JSON string (or null). Any invalid input → defaults.
  function loadActions (raw) {
    if (!raw) return DEFAULT_ACTIONS.slice()
    var data
    try { data = JSON.parse(raw) } catch (_) { return DEFAULT_ACTIONS.slice() }
    var list = data && data.actions
    if (Object.prototype.toString.call(list) !== '[object Array]') return DEFAULT_ACTIONS.slice()
    var out = []
    for (var i = 0; i < list.length; i++) {
      if (isValidAction(list[i])) {
        out.push({
          id: list[i].id,
          label: String(list[i].label).slice(0, 24),
          prompt: String(list[i].prompt),
          title: typeof list[i].title === 'string' ? list[i].title : String(list[i].prompt).slice(0, 120)
        })
      }
    }
    // A stored empty list is legitimate (user deleted everything).
    return out
  }

  function serialize (actions) {
    return JSON.stringify({ actions: actions })
  }

  function addAction (actions, label, promptText) {
    label = String(label || '').replace(/^\s+|\s+$/g, '').slice(0, 24)
    promptText = String(promptText || '').replace(/^\s+|\s+$/g, '')
    if (!label || !promptText) return null
    var next = actions.slice()
    next.push({
      id: 'qa_user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      label: label,
      prompt: promptText,
      title: promptText.slice(0, 120)
    })
    return next
  }

  function updateAction (actions, id, label, promptText) {
    label = String(label || '').replace(/^\s+|\s+$/g, '').slice(0, 24)
    promptText = String(promptText || '').replace(/^\s+|\s+$/g, '')
    if (!label || !promptText) return null
    var next = []
    var found = false
    for (var i = 0; i < actions.length; i++) {
      if (actions[i].id === id) {
        found = true
        next.push({ id: id, label: label, prompt: promptText, title: promptText.slice(0, 120) })
      } else {
        next.push(actions[i])
      }
    }
    return found ? next : null
  }

  function removeAction (actions, id) {
    var next = []
    for (var i = 0; i < actions.length; i++) {
      if (actions[i].id !== id) next.push(actions[i])
    }
    return next
  }

  return {
    DEFAULT_ACTIONS: DEFAULT_ACTIONS,
    loadActions: loadActions,
    serialize: serialize,
    addAction: addAction,
    updateAction: updateAction,
    removeAction: removeAction
  }
})
