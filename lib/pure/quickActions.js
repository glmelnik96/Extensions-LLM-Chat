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
  var DEFAULT_ACTIONS = [
    { id: 'qa_wiggle', label: 'Wiggle', prompt: 'Add wiggle(3, 25) to selected layers', title: 'Apply wiggle expression to selection' },
    { id: 'qa_loop', label: 'Loop', prompt: 'Loop existing keyframes on selected layers with loopOut cycle', title: 'Repeat keyframed animation forever' },
    { id: 'qa_bounce', label: 'Bounce', prompt: 'Add bounce easing expression to all keyframes on selected layers', title: 'Bounce overshoot on keyframes' },
    { id: 'qa_counter', label: 'Counter', prompt: 'Create a counter from 0 to 100 on selected text layer', title: 'Counter expression on text' },
    { id: 'qa_textbox', label: 'Text Box', prompt: 'Create an auto-resizing background box behind the selected text layer using sourceRectAtTime, anchored so it works with left/right text alignment too', title: 'Auto-resizing text background (lower third)' },
    { id: 'qa_fade', label: 'Fade', prompt: 'Add auto fade in/out expression to opacity of selected layers', title: 'Fade at layer in/out points, no keyframes' },
    { id: 'qa_spin', label: 'Spin', prompt: 'Make selected layers rotate continuously using a time expression', title: 'Endless rotation without keyframes' },
    { id: 'qa_preview', label: 'Preview', prompt: 'Capture current frame preview', title: 'Save and show current comp frame' },
    { id: 'qa_stagger', label: 'Stagger', prompt: "Stagger the selected layers: offset each layer's animation to start 3 frames after the previous one", title: 'Cascade layers with 3-frame offsets' },
    { id: 'qa_popin', label: 'Pop In', prompt: 'Make selected layers pop in: center each anchor point without shifting the layer, then animate scale 0 to 100 with a spring overshoot at the layer in point', title: 'Scale 0\u2192100 with overshoot from centered anchor' },
    { id: 'qa_typewriter', label: 'Typewriter', prompt: 'Add a typewriter text reveal to the selected text layer', title: 'Reveal text letter by letter' },
    { id: 'qa_camshake', label: 'Cam Shake', prompt: 'Add camera shake to this composition: an adjustment or null rig with slider-driven wiggle, scaled ~103% so edges never show', title: 'Slider-controlled camera shake rig' },
    { id: 'qa_drawon', label: 'Draw-On', prompt: "Animate the selected shape layer's stroke drawing on with Trim Paths from 0 to 100", title: 'Draw-on line reveal via Trim Paths' },
    { id: 'qa_slidein', label: 'Slide In', prompt: 'Make selected layers slide in from the left with smooth easing at their in points', title: 'Eased slide-in entrance' },
    { id: 'qa_smoothease', label: 'Smooth Ease', prompt: 'Apply smooth easy ease with a slight overshoot to all existing keyframes on selected layers', title: 'Polish existing keyframes: ease + overshoot' },
    { id: 'qa_centeranchor', label: 'Center Anchor', prompt: 'Move the anchor point of each selected layer to its center without shifting the layer', title: 'Center anchor points (compensated)' }
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
