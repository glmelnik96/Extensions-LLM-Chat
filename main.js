;(function () {
  'use strict'

  // ── Boot error handler ─────────────────────────────────────────────────
  function showBootError (err, context) {
    try {
      var msg = (err && err.stack) ? String(err.stack) : (err && err.message ? String(err.message) : String(err))
      var header = '[AE Motion Agent] Panel error' + (context ? ' (' + context + ')' : '')
      if (typeof console !== 'undefined' && console.error) console.error(header, err)
      if (typeof document === 'undefined' || !document.body) return
      document.body.innerHTML = ''
      document.body.style.cssText = 'margin:0;padding:8px;background:#1f1f1f;color:#ffd2d2;font:11px Menlo,monospace'
      var pre = document.createElement('pre')
      pre.textContent = header + '\n\n' + msg
      document.body.appendChild(pre)
    } catch (_) {}
  }

  try {
    if (typeof window !== 'undefined') {
      window.addEventListener('error', function (e) { showBootError(e.error || new Error(e.message), 'window.error') })
      window.addEventListener('unhandledrejection', function (e) { showBootError(e.reason || new Error('Unhandled rejection'), 'unhandledrejection') })
    }
  } catch (_) {}

  // ── Constants ──────────────────────────────────────────────────────────
  var STORAGE_KEY = 'ae-motion-agent-state'
  var VISION_CHECK_KEY = 'ae-motion-agent-vision-check'
  var DRAFT_KEY = 'ae-motion-agent-draft'
  var PENDING_RUN_KEY = 'ae-motion-agent-pending-run'
  var QUICK_ACTIONS_KEY = 'ae-motion-agent-quick-actions'
  var SUBTITLE_SETTINGS_KEY = 'ae-motion-agent-subtitle-settings'

  // User-selectable models (panel selector). Each entry tuned from the live
  // 8-model × 4-task benchmark (2026-06-18, real AE, Russian prompts):
  //  - gpt-oss-120b   : fastest (~28s/4 tasks), clean tool use, 4/4 correct.
  //  - MiniMax-M2.5   : cleanest tool use (0 errors, fewest calls), 4/4.
  //  - GLM-4.7        : 4/4 but thrashes on the hardest task (30+ calls,
  //                     up to ~377k tokens); GLM family respects
  //                     enable_thinking:false, so thinking is forced off.
  //  - Kimi-K2.6      : 262K context, separate `reasoning` field (same as
  //                     GLM); streaming + tool_calls both work correctly.
  // `thinking` controls the chat_template_kwargs.enable_thinking flag the loop
  // sends; only the GLM family honors it (others ignore the kwarg harmlessly).
  var AVAILABLE_MODELS = [
    { id: 'openai/gpt-oss-120b', label: 'gpt-oss-120b', family: 'gpt-oss' },
    { id: 'MiniMaxAI/MiniMax-M2.5', label: 'MiniMax-M2.5', family: 'minimax' },
    { id: 'zai-org/GLM-4.7', label: 'GLM-4.7', family: 'glm' },
    { id: 'moonshotai/Kimi-K2.6', label: 'Kimi-K2.6', family: 'kimi' }
  ]
  // Default = fastest clean model from the benchmark.
  var DEFAULT_MODEL = AVAILABLE_MODELS[0].id
  var DEFAULT_AGENT_MAX_STEPS = 60

  function getModelById (id) {
    for (var i = 0; i < AVAILABLE_MODELS.length; i++) {
      if (AVAILABLE_MODELS[i].id === id) return AVAILABLE_MODELS[i]
    }
    return null
  }

  function getModelLabel (id) {
    var m = getModelById(id)
    return m ? m.label : (id || '').split('/').pop()
  }

  // Compute the ruble cost of a single usage event, priced by the model that
  // produced it (chat model vs. vision model bill very differently). Fail-safe:
  // returns {rub:0, known:false} if the pricing module is unavailable.
  function accrueCost (modelId, usage) {
    if (!window.PURE_PRICING || !usage) return { rub: 0, known: false }
    var cfg = window.EXTENSIONS_LLM_CHAT_CONFIG || {}
    var table = window.PURE_PRICING.mergePricing(
      window.PURE_PRICING.DEFAULT_PRICING, cfg.modelPricing)
    return window.PURE_PRICING.costFor(
      modelId, usage.prompt_tokens, usage.completion_tokens, table)
  }

  // ── State ──────────────────────────────────────────────────────────────
  var state = {
    sessions: [],            // all chat sessions (multi-chat, 2026-07-27)
    activeSessionId: null,   // id of the session shown in the transcript
    isRequestInFlight: false,
    currentAbortHandle: null,
    lastMutatingToolCount: 0,
    lastModelStatus: { status: 'unknown', label: 'model: unknown' },
    // { id: {functionCalling, contextLength} } from GET /models, or null while
    // the availability of the panel's models is unknown (probe not run/failed).
    modelAvailability: null
  }

  function getActiveSession () {
    for (var i = 0; i < state.sessions.length; i++) {
      if (state.sessions[i].id === state.activeSessionId) return state.sessions[i]
    }
    return null
  }

  // ── DOM refs ───────────────────────────────────────────────────────────
  var els = {}

  function cacheDomRefs () {
    els.clearSessionBtn = document.getElementById('clear-session-btn')
    els.exportSessionsBtn = document.getElementById('export-sessions-btn')
    els.exportErrorsBtn = document.getElementById('export-errors-btn')
    els.reportBtn = document.getElementById('report-btn')
    els.chatTranscript = document.getElementById('chat-transcript')
    els.activeCompNote = document.getElementById('active-comp-note')
    els.userInput = document.getElementById('user-input')
    els.sendBtn = document.getElementById('send-btn')
    els.undoBtn = document.getElementById('undo-btn')
    els.cancelBtn = document.getElementById('cancel-btn')
    els.statusText = document.getElementById('status-text')
    els.modelStatus = document.getElementById('model-status')
    els.modelSelector = document.getElementById('model-selector')
    els.providerBadge = document.getElementById('provider-badge')
    els.sessionSelect = document.getElementById('session-select')
    els.sessionNewBtn = document.getElementById('session-new-btn')
    els.sessionRenameBtn = document.getElementById('session-rename-btn')
    els.sessionDeleteBtn = document.getElementById('session-delete-btn')
    els.visionCheckToggle = document.getElementById('vision-check-toggle')
    els.subtitlesBtn = document.getElementById('subtitles-btn')
    els.subtitlesLang = document.getElementById('subtitles-lang')
    els.subtitlesStyle = document.getElementById('subtitles-style')
    els.subtitlesStatus = document.getElementById('subtitles-status')
    els.subtitlesPanelStatus = document.getElementById('subtitles-panel-status')
    els.subtitlesRebuildBtn = document.getElementById('subtitles-rebuild-btn')
    els.subtitlesPanel = document.getElementById('subtitles-panel')
    els.subtitlesOpenBtn = document.getElementById('subtitles-open-btn')
    els.subtitlesCloseBtn = document.getElementById('subtitles-close-btn')
    els.subtitlesFont = document.getElementById('subtitles-font')
    els.subtitlesFontStyle = document.getElementById('subtitles-font-style')
    els.subtitlesFontSize = document.getElementById('subtitles-font-size')
    els.subtitlesColor = document.getElementById('subtitles-color')
    els.subtitlesPlateColor = document.getElementById('subtitles-plate-color')
    els.subtitlesSpokenColor = document.getElementById('subtitles-spoken-color')
    els.transcriptSaveBtn = document.getElementById('transcript-save-btn')
    els.transcriptLoadBtn = document.getElementById('transcript-load-btn')
    els.contextMeter = document.getElementById('context-meter')
    els.contextMeterFill = document.getElementById('context-meter-fill')
    els.contextMeterText = document.getElementById('context-meter-text')
  }

  // Resolve a persisted/selected model id to one of the AVAILABLE_MODELS.
  // Unknown ids (older sessions saved with a now-removed model) migrate
  // transparently to DEFAULT_MODEL.
  function normalizeModelId (id) {
    return getModelById(id) ? id : DEFAULT_MODEL
  }

  function getAgentMaxSteps (cfg) {
    var raw = cfg && cfg.agentMaxSteps
    if (typeof raw !== 'number' || !isFinite(raw)) return DEFAULT_AGENT_MAX_STEPS
    var steps = Math.floor(raw)
    if (steps < 1) return 1
    return steps
  }

  // ── Persistence ────────────────────────────────────────────────────────
  function isQuotaError (e) {
    if (!e) return false
    return e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22 || e.code === 1014 ||
      /quota/i.test(String(e.message || ''))
  }

  function buildPersistData () {
    return window.PURE_SESSION_STORE.serializeForPersist(state.sessions, state.activeSessionId)
  }

  function persistState () {
    var active = getActiveSession()
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buildPersistData()))
      return
    } catch (e) {
      if (!isQuotaError(e) || !active || !active.messages || active.messages.length <= 2) {
        console.warn('persistState error:', e)
        return
      }
    }
    // Quota exceeded: drop the oldest half of the ACTIVE session's messages
    // (keeping the most recent context) and retry once so it isn't lost.
    var msgs = active.messages
    var dropCount = Math.floor(msgs.length / 2)
    active.messages = msgs.slice(dropCount)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buildPersistData()))
      setStatus('Session storage full — dropped ' + dropCount + ' oldest message(s) to save.')
    } catch (e2) {
      console.warn('persistState retry failed after pruning:', e2)
      setStatus('Session too large to save — recent changes may not persist.')
    }
  }

  // ── Input draft autosave ───────────────────────────────────────────────
  // A half-typed prompt survives panel reloads (AE restart, panel re-dock,
  // update). Cleared on successful send.
  var draftTimer = null
  function saveDraft () {
    if (draftTimer) clearTimeout(draftTimer)
    draftTimer = setTimeout(function () {
      draftTimer = null
      try {
        var v = els.userInput ? els.userInput.value : ''
        if (v) localStorage.setItem(DRAFT_KEY, v)
        else localStorage.removeItem(DRAFT_KEY)
      } catch (_) {}
    }, 300)
  }

  function clearDraft () {
    if (draftTimer) { clearTimeout(draftTimer); draftTimer = null }
    try { localStorage.removeItem(DRAFT_KEY) } catch (_) {}
  }

  function restoreDraft () {
    try {
      var v = localStorage.getItem(DRAFT_KEY)
      if (v && els.userInput && !els.userInput.value) {
        els.userInput.value = v
        els.userInput.style.height = 'auto'
        els.userInput.style.height = Math.min(els.userInput.scrollHeight, 120) + 'px'
      }
    } catch (_) {}
  }

  // ── Mid-run persist (crash safety) ─────────────────────────────────────
  // The final assistant message is only persisted when the run FINISHES; if
  // AE/the panel dies mid-run, every executed tool call would vanish from the
  // transcript while the changes stay in the project — the model would then
  // reason from false state. Each completed step snapshots the partial tool
  // log to a side key; on boot it is folded back into the session.
  function savePendingRun (sessionId, runLog) {
    try {
      localStorage.setItem(PENDING_RUN_KEY, JSON.stringify({
        sessionId: sessionId,
        savedAt: Date.now(),
        toolCalls: serializeToolCalls(runLog)
      }))
    } catch (_) {}
  }

  function clearPendingRun () {
    try { localStorage.removeItem(PENDING_RUN_KEY) } catch (_) {}
  }

  function recoverPendingRun () {
    var pending = null
    try { pending = JSON.parse(localStorage.getItem(PENDING_RUN_KEY)) } catch (_) {}
    clearPendingRun()
    if (!pending || !pending.sessionId || !pending.toolCalls || pending.toolCalls.length === 0) return
    var session = null
    for (var i = 0; i < state.sessions.length; i++) {
      if (state.sessions[i].id === pending.sessionId) { session = state.sessions[i]; break }
    }
    if (!session) return
    // If the session was updated AFTER the last step snapshot, the run
    // finished normally and its result is already in the transcript.
    if ((session.updatedAt || 0) >= (pending.savedAt || 0)) return
    session.messages.push({ role: 'assistant', text: '', toolCalls: pending.toolCalls })
    session.messages.push({
      role: 'system',
      text: '\u26A0 Panel was reloaded mid-run. ' + pending.toolCalls.length +
        ' completed tool call(s) were recovered above \u2014 the project may already contain their changes.'
    })
    session.updatedAt = Date.now()
    persistState()
  }

  function loadState () {
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      var data = JSON.parse(raw)
      // Handles both the current { sessions, activeSessionId } shape and the
      // legacy single-session { session } shape (pre multi-chat upgrade).
      var store = window.PURE_SESSION_STORE.migratePersisted(data)
      state.sessions = store.sessions
      state.activeSessionId = store.activeSessionId
      for (var i = 0; i < state.sessions.length; i++) {
        state.sessions[i].model = normalizeModelId(state.sessions[i].model)
      }
    } catch (e) {
      console.warn('loadState error:', e)
    }
  }

  // ── Session management (multi-chat) ────────────────────────────────────
  function ensureSession () {
    var active = getActiveSession()
    if (active) return active
    // Inherit the model from the previously active chat so a new chat doesn't
    // silently reset the user's model choice.
    var prev = state.sessions.length > 0 ? state.sessions[state.sessions.length - 1] : null
    var session = window.PURE_SESSION_STORE.createSession(
      prev ? normalizeModelId(prev.model) : DEFAULT_MODEL, state.sessions)
    state.sessions.push(session)
    state.activeSessionId = session.id
    persistState()
    renderTranscript()
    renderSessionBar()
    return session
  }

  // Switch chats. Blocked mid-request for the same reason as model switching:
  // the running agent loop writes into the session it started with.
  function switchSession (id) {
    if (id === state.activeSessionId) return
    if (state.isRequestInFlight) {
      setStatus('Finish or stop the current request before switching chats.')
      renderSessionBar()
      return
    }
    for (var i = 0; i < state.sessions.length; i++) {
      if (state.sessions[i].id !== id) continue
      state.activeSessionId = id
      // Same client_op_id values may repeat across chats — a stale cached
      // host result from another chat must never be replayed here.
      if (window.HOST_BRIDGE && typeof window.HOST_BRIDGE.clearIdempotencyCache === 'function') {
        try { window.HOST_BRIDGE.clearIdempotencyCache() } catch (_) {}
      }
      persistState()
      renderTranscript()
      renderModelSelector()
      renderSessionBar()
      setStatus('Chat: ' + state.sessions[i].title)
      return
    }
    renderSessionBar()
  }

  function handleNewSession () {
    if (state.isRequestInFlight) {
      setStatus('Finish or stop the current request before creating a chat.')
      return
    }
    state.activeSessionId = null
    var session = ensureSession()
    renderModelSelector()
    setStatus('New chat: ' + session.title)
  }

  function handleRenameSession () {
    var session = getActiveSession()
    if (!session) return
    var next = prompt('Chat name:', session.title)
    if (next === null) return
    next = next.replace(/^\s+|\s+$/g, '')
    if (!next || next === session.title) return
    session.title = next.slice(0, 60)
    session.updatedAt = Date.now()
    persistState()
    renderSessionBar()
    setStatus('Chat renamed: ' + session.title)
  }

  function handleDeleteSession () {
    var session = getActiveSession()
    if (!session) return
    if (state.isRequestInFlight) {
      setStatus('Finish or stop the current request before deleting a chat.')
      return
    }
    if (!confirm('Delete chat "' + session.title + '" and all its messages? This cannot be undone.')) return
    var next = []
    for (var i = 0; i < state.sessions.length; i++) {
      if (state.sessions[i].id !== session.id) next.push(state.sessions[i])
    }
    state.sessions = next
    state.activeSessionId = next.length > 0 ? next[next.length - 1].id : null
    if (window.HOST_BRIDGE && typeof window.HOST_BRIDGE.clearIdempotencyCache === 'function') {
      try { window.HOST_BRIDGE.clearIdempotencyCache() } catch (_) {}
    }
    ensureSession() // recreate if the last chat was deleted
    persistState()
    renderTranscript()
    renderModelSelector()
    renderSessionBar()
    setStatus('Chat deleted')
  }

  // Render the chat switcher <select> in the header.
  function renderSessionBar () {
    if (!els.sessionSelect) return
    els.sessionSelect.innerHTML = ''
    for (var i = 0; i < state.sessions.length; i++) {
      var s = state.sessions[i]
      var opt = document.createElement('option')
      opt.value = s.id
      opt.textContent = s.title
      if (s.id === state.activeSessionId) opt.selected = true
      els.sessionSelect.appendChild(opt)
    }
    var only = state.sessions.length <= 1
    if (els.sessionDeleteBtn) els.sessionDeleteBtn.title = only
      ? 'Delete this chat (a fresh one is created)'
      : 'Delete this chat'
  }

  // ── Quick actions (user-editable) ──────────────────────────────────────
  // Left-click sends the prompt; right-click edits or deletes the button;
  // "+" adds a new one; "⟲" resets to the shipped defaults. The full list
  // persists in localStorage — absent/invalid state falls back to defaults.
  function getQuickActions () {
    var raw = null
    try { raw = localStorage.getItem(QUICK_ACTIONS_KEY) } catch (_) {}
    return window.PURE_QUICK_ACTIONS.loadActions(raw)
  }

  function saveQuickActions (actions) {
    try { localStorage.setItem(QUICK_ACTIONS_KEY, window.PURE_QUICK_ACTIONS.serialize(actions)) } catch (_) {}
  }

  function renderQuickActions () {
    var box = document.getElementById('quick-actions')
    if (!box) return
    var actions = getQuickActions()
    box.innerHTML = ''
    for (var i = 0; i < actions.length; i++) {
      var a = actions[i]
      var btn = document.createElement('button')
      btn.className = 'quick-action-btn'
      btn.textContent = a.label
      btn.title = (a.title || a.prompt) + '\n(right-click to edit or delete)'
      btn.setAttribute('data-prompt', a.prompt)
      btn.setAttribute('data-qa-id', a.id)
      box.appendChild(btn)
    }
    var addBtn = document.createElement('button')
    addBtn.className = 'quick-action-btn quick-action-manage'
    addBtn.id = 'quick-action-add'
    addBtn.textContent = '+'
    addBtn.title = 'Add a custom quick action'
    box.appendChild(addBtn)
    var resetBtn = document.createElement('button')
    resetBtn.className = 'quick-action-btn quick-action-manage'
    resetBtn.id = 'quick-action-reset'
    resetBtn.textContent = '\u27F2'
    resetBtn.title = 'Reset quick actions to defaults'
    box.appendChild(resetBtn)
  }

  function handleQuickActionAdd () {
    var label = prompt('Button label (up to 24 chars):', '')
    if (label === null) return
    var promptText = prompt('Prompt the button sends to the agent:', '')
    if (promptText === null) return
    var next = window.PURE_QUICK_ACTIONS.addAction(getQuickActions(), label, promptText)
    if (!next) { setStatus('Quick action needs both a label and a prompt.'); return }
    saveQuickActions(next)
    renderQuickActions()
    setStatus('Quick action added')
  }

  function handleQuickActionEdit (id) {
    var actions = getQuickActions()
    var current = null
    for (var i = 0; i < actions.length; i++) if (actions[i].id === id) current = actions[i]
    if (!current) return
    var choice = prompt('Edit "' + current.label + '":\n1 = change label/prompt, 2 = delete\n(Enter 1 or 2)', '1')
    if (choice === null) return
    if (choice.replace(/\s/g, '') === '2') {
      if (!confirm('Delete quick action "' + current.label + '"?')) return
      saveQuickActions(window.PURE_QUICK_ACTIONS.removeAction(actions, id))
      renderQuickActions()
      setStatus('Quick action deleted')
      return
    }
    var label = prompt('Button label:', current.label)
    if (label === null) return
    var promptText = prompt('Prompt:', current.prompt)
    if (promptText === null) return
    var next = window.PURE_QUICK_ACTIONS.updateAction(actions, id, label, promptText)
    if (!next) { setStatus('Quick action needs both a label and a prompt.'); return }
    saveQuickActions(next)
    renderQuickActions()
    setStatus('Quick action updated')
  }

  function handleQuickActionReset () {
    if (!confirm('Reset quick actions to the default set? Your custom buttons will be removed.')) return
    try { localStorage.removeItem(QUICK_ACTIONS_KEY) } catch (_) {}
    renderQuickActions()
    setStatus('Quick actions reset to defaults')
  }

  // ── Render: welcome hint (empty session) ──────────────────────────────
  var WELCOME_CAPABILITIES = [
    'Выражения — написать, починить, объяснить; линковка свойств (pick-whip); библиотека из 54 проверенных сниппетов',
    'Анимация — кейфреймы с изингом, batch-операции; копирование изинга, реверс кейфреймов, каскад слоёв (stagger), рандомизация свойств',
    'Слои и контент — шейпы, текст, маски, solid/null/adjustment, порядок и парентинг',
    'Эффекты — поиск установленных, добавление с переименованием, настройка параметров',
    '3D — камера, свет, глубина, depth of field',
    'Превью кадра — по запросу (capture/preview)'
  ]

  var WELCOME_EXAMPLES = [
    'Сделай счётчик от 0 до 100 за 2 секунды с easing',
    'Привяжи Opacity текста к Scale шейп-слоя',
    'Добавь wiggle к позиции выделенного слоя и объясни параметры',
    'Текст появляется слева с fade-in и overshoot',
    'Скопируй изинг с первого слоя на остальные выделенные',
    'Сделай каскад: выдели слои и запусти их появление со сдвигом в 3 кадра',
    'Поставь якорь выделенного слоя в центр без сдвига картинки',
    'Немного разбросай поворот выделенных слоёв в пределах ±15°'
  ]

  function renderWelcomeHint () {
    var box = document.createElement('div')
    box.className = 'welcome-hint'

    var title = document.createElement('div')
    title.className = 'welcome-title'
    title.textContent = 'AE Motion Agent — напарник для моушн-дизайна'
    box.appendChild(title)

    var intro = document.createElement('div')
    intro.className = 'welcome-intro'
    intro.textContent = 'Опишите задачу на русском или английском — выполню её в активной композиции через инструменты After Effects. Что умею:'
    box.appendChild(intro)

    var list = document.createElement('ul')
    list.className = 'welcome-list'
    for (var i = 0; i < WELCOME_CAPABILITIES.length; i++) {
      var li = document.createElement('li')
      li.textContent = WELCOME_CAPABILITIES[i]
      list.appendChild(li)
    }
    box.appendChild(list)

    var examplesLabel = document.createElement('div')
    examplesLabel.className = 'welcome-examples-label'
    examplesLabel.textContent = 'Примеры (клик — подставить в поле ввода):'
    box.appendChild(examplesLabel)

    var examples = document.createElement('div')
    examples.className = 'welcome-examples'
    for (var j = 0; j < WELCOME_EXAMPLES.length; j++) {
      var btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'welcome-example-btn'
      btn.textContent = WELCOME_EXAMPLES[j]
      btn.addEventListener('click', (function (prompt) {
        return function () {
          if (!els.userInput) return
          els.userInput.value = prompt
          els.userInput.dispatchEvent(new Event('input'))
          els.userInput.focus()
        }
      })(WELCOME_EXAMPLES[j]))
      examples.appendChild(btn)
    }
    box.appendChild(examples)

    var foot = document.createElement('div')
    foot.className = 'welcome-foot'
    foot.textContent = 'Работаю только с активной композицией. Изменения последнего запроса можно откатить кнопкой Undo.'
    box.appendChild(foot)

    return box
  }

  // ── Message actions (copy / retry) ─────────────────────────────────────
  function copyTextToClipboard (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text)
        .then(function () { return true })
        .catch(function () { return copyViaExec(text) })
    }
    return Promise.resolve(copyViaExec(text))
  }

  function copyViaExec (text) {
    try {
      var ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;left:-9999px;top:0'
      document.body.appendChild(ta)
      ta.select()
      var ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch (_) { return false }
  }

  function makeMsgActionBtn (label, title, onClick) {
    var btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'msg-action-btn'
    btn.textContent = label
    btn.title = title
    btn.addEventListener('click', onClick)
    return btn
  }

  function appendMsgActions (div, msg, isUser) {
    var text = msg.text || ''
    if (!text) return
    var row = document.createElement('div')
    row.className = 'msg-actions'
    row.appendChild(makeMsgActionBtn('copy', 'Copy message text', function () {
      var self = this
      copyTextToClipboard(text).then(function (ok) {
        self.textContent = ok ? 'copied' : 'failed'
        setTimeout(function () { self.textContent = 'copy' }, 1200)
      })
    }))
    if (isUser) {
      row.appendChild(makeMsgActionBtn('retry', 'Send this message again', function () {
        if (state.isRequestInFlight) {
          setStatus('Finish or stop the current request before retrying.')
          return
        }
        if (els.userInput) {
          els.userInput.value = text
          handleSend()
        }
      }))
    }
    div.appendChild(row)
  }

  // ── Render: chat transcript ────────────────────────────────────────────
  function renderTranscript () {
    if (!els.chatTranscript) return
    updateContextMeter()
    els.chatTranscript.innerHTML = ''
    var session = getActiveSession()
    if (!session || session.messages.length === 0) {
      els.chatTranscript.appendChild(renderWelcomeHint())
      return
    }

    for (var i = 0; i < session.messages.length; i++) {
      var msg = session.messages[i]
      var div = document.createElement('div')

      if (msg.role === 'user') {
        div.className = 'chat-message user'
        var roleLabel = document.createElement('div')
        roleLabel.className = 'msg-role'
        roleLabel.textContent = 'you'
        div.appendChild(roleLabel)
        var textDiv = document.createElement('div')
        textDiv.className = 'msg-text'
        textDiv.textContent = msg.text
        div.appendChild(textDiv)
        appendMsgActions(div, msg, true)

      } else if (msg.role === 'assistant') {
        div.className = 'chat-message assistant'
        var roleLabel2 = document.createElement('div')
        roleLabel2.className = 'msg-role'
        roleLabel2.textContent = 'agent'
        div.appendChild(roleLabel2)

        // Render tool calls if present.
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          var toolsContainer = document.createElement('div')
          toolsContainer.className = 'tool-calls-container'
          for (var t = 0; t < msg.toolCalls.length; t++) {
            toolsContainer.appendChild(renderToolCallCard(msg.toolCalls[t]))
          }
          div.appendChild(toolsContainer)
        }

        // Render text content with markdown.
        if (msg.text) {
          var textDiv2 = document.createElement('div')
          textDiv2.className = 'msg-text'
          textDiv2.innerHTML = renderMarkdown(msg.text)
          div.appendChild(textDiv2)
        }
        appendMsgActions(div, msg, false)

      } else if (msg.role === 'system') {
        div.className = 'chat-message system'
        var roleLabel3 = document.createElement('div')
        roleLabel3.className = 'msg-role'
        roleLabel3.textContent = 'system'
        div.appendChild(roleLabel3)
        var textDiv3 = document.createElement('div')
        textDiv3.className = 'msg-text'
        textDiv3.textContent = msg.text
        div.appendChild(textDiv3)
      }

      els.chatTranscript.appendChild(div)
    }
    // Full re-render happens at discrete moments (message sent, run finished)
    // — always reveal the newest message.
    scrollToBottom(true)
  }

  function renderToolCallCard (tc) {
    var card = document.createElement('div')
    card.className = 'tool-call-card'

    var header = document.createElement('div')
    header.className = 'tool-call-header'

    var icon = document.createElement('span')
    icon.className = 'tool-icon'
    icon.textContent = '\u2692' // hammer and wrench
    header.appendChild(icon)

    var name = document.createElement('span')
    name.className = 'tool-name'
    name.textContent = tc.name
    header.appendChild(name)

    var status = document.createElement('span')
    status.className = 'tool-status ' + (tc.status || 'ok')
    status.textContent = tc.status === 'ok' ? 'ok' : (tc.status === 'error' ? 'error' : tc.status)
    header.appendChild(status)

    var chevron = document.createElement('span')
    chevron.className = 'tool-chevron'
    chevron.textContent = '\u25BC'
    header.appendChild(chevron)

    header.addEventListener('click', function () {
      card.classList.toggle('expanded')
    })

    card.appendChild(header)

    var details = document.createElement('div')
    details.className = 'tool-call-details'

    var argsLabel = document.createElement('div')
    argsLabel.className = 'tool-detail-label'
    argsLabel.textContent = 'args:'
    details.appendChild(argsLabel)

    var argsContent = document.createElement('div')
    argsContent.className = 'tool-detail-content'
    try {
      argsContent.textContent = JSON.stringify(tc.args, null, 2)
    } catch (e) {
      argsContent.textContent = String(tc.args)
    }
    details.appendChild(argsContent)

    if (tc.result) {
      var resultLabel = document.createElement('div')
      resultLabel.className = 'tool-detail-label'
      resultLabel.textContent = 'result:'
      details.appendChild(resultLabel)

      var resultContent = document.createElement('div')
      resultContent.className = 'tool-detail-content'
      try {
        var r = tc.result
        if (r.message) {
          resultContent.textContent = r.message
        } else {
          resultContent.textContent = JSON.stringify(r, null, 2)
        }
      } catch (e) {
        resultContent.textContent = String(tc.result)
      }
      details.appendChild(resultContent)
    }

    card.appendChild(details)
    return card
  }

  // Smart scroll: auto-scroll only when the user is already near the bottom
  // (otherwise streaming chunks fight the user's manual scroll-back), and
  // throttle the per-chunk scrolls. Pass force=true for user-initiated
  // events (own message sent, run finished).
  var _lastAutoScrollTs = 0

  function isNearTranscriptBottom () {
    var el = els.chatTranscript
    if (!el) return true
    return (el.scrollHeight - el.scrollTop - el.clientHeight) < 80
  }

  function scrollToBottom (force) {
    var el = els.chatTranscript
    if (!el) return
    if (!force) {
      if (!isNearTranscriptBottom()) return
      var now = Date.now()
      if (now - _lastAutoScrollTs < 100) return
      _lastAutoScrollTs = now
    }
    el.scrollTop = el.scrollHeight
  }

  // ── Thinking indicator ─────────────────────────────────────────────────
  var thinkingEl = null
  var thinkingToolCount = 0
  var thinkingStartTime = 0
  var thinkingTimerId = null
  // Live reasoning view keeps only the tail — full CoT can run to tens of
  // thousands of chars and the DOM update is O(length) per chunk.
  var REASONING_TAIL_CAP = 8000
  var reasoningBuffer = ''

  function formatElapsed (ms) {
    var s = Math.floor(ms / 1000)
    if (s < 60) return s + 's'
    return Math.floor(s / 60) + 'm ' + (s % 60) + 's'
  }

  function showThinking () {
    if (thinkingEl) return
    thinkingToolCount = 0
    streamingTextBuffer = ''
    reasoningBuffer = ''
    thinkingEl = document.createElement('div')
    thinkingEl.className = 'agent-thinking'

    var header = document.createElement('div')
    header.className = 'thinking-header'
    var label = document.createElement('span')
    label.className = 'thinking-label'
    label.textContent = 'Agent working'
    header.appendChild(label)
    var dots = document.createElement('span')
    dots.className = 'thinking-dots'
    dots.innerHTML = '<span></span><span></span><span></span>'
    header.appendChild(dots)
    var elapsed = document.createElement('span')
    elapsed.className = 'thinking-elapsed'
    elapsed.textContent = '0s'
    header.appendChild(elapsed)
    thinkingEl.appendChild(header)

    els.chatTranscript.appendChild(thinkingEl)

    thinkingStartTime = Date.now()
    thinkingTimerId = setInterval(function () {
      if (!thinkingEl) return
      var el = thinkingEl.querySelector('.thinking-elapsed')
      if (el) el.textContent = formatElapsed(Date.now() - thinkingStartTime)
    }, 1000)

    scrollToBottom(true)
  }

  function removeThinking () {
    if (thinkingTimerId) {
      clearInterval(thinkingTimerId)
      thinkingTimerId = null
    }
    if (thinkingEl && thinkingEl.parentNode) {
      thinkingEl.parentNode.removeChild(thinkingEl)
    }
    thinkingEl = null
  }

  var streamingTextBuffer = ''

  function _setThinkingLabel (text) {
    if (!thinkingEl) return
    var label = thinkingEl.querySelector('.thinking-label')
    if (label) label.textContent = text
  }

  function updateThinkingWithStreamText (chunk) {
    if (!thinkingEl) return
    streamingTextBuffer += chunk
    var preview = streamingTextBuffer.length > 200 ? '...' + streamingTextBuffer.slice(-200) : streamingTextBuffer
    var streamDiv = thinkingEl.querySelector('.stream-preview')
    if (!streamDiv) {
      streamDiv = document.createElement('div')
      streamDiv.className = 'stream-preview'
      thinkingEl.appendChild(streamDiv)
    }
    streamDiv.textContent = preview
    scrollToBottom()
  }

  // Reasoning models (GLM-5.1 etc.) stream a separate `reasoning` field before
  // any answer/tool_calls. Show the live CoT tail in a collapsible block so
  // long thinks aren't a silent black box. textContent only — never innerHTML
  // (model output is untrusted).
  function updateThinkingReasoning (chunk) {
    if (!thinkingEl) return
    if (typeof chunk === 'string' && chunk) {
      reasoningBuffer += chunk
      if (reasoningBuffer.length > REASONING_TAIL_CAP) {
        reasoningBuffer = reasoningBuffer.slice(-REASONING_TAIL_CAP)
      }
    }
    if (!streamingTextBuffer) _setThinkingLabel('Agent reasoning')

    var box = thinkingEl.querySelector('.reasoning-box')
    if (!box) {
      box = document.createElement('div')
      box.className = 'reasoning-box'
      var toggle = document.createElement('div')
      toggle.className = 'reasoning-toggle'
      toggle.textContent = '\u25B8 reasoning'
      var body = document.createElement('div')
      body.className = 'reasoning-body'
      toggle.addEventListener('click', function () {
        var expanded = box.classList.toggle('expanded')
        toggle.textContent = (expanded ? '\u25BE' : '\u25B8') + ' reasoning'
        if (expanded) body.scrollTop = body.scrollHeight
      })
      box.appendChild(toggle)
      box.appendChild(body)
      thinkingEl.appendChild(box)
    }
    var bodyEl = box.querySelector('.reasoning-body')
    if (bodyEl) {
      bodyEl.textContent = reasoningBuffer
      if (box.classList.contains('expanded')) bodyEl.scrollTop = bodyEl.scrollHeight
    }
    scrollToBottom()
  }

  function updateThinkingWithToolCall (tc) {
    if (!thinkingEl) return
    if (tc.status === 'running') thinkingToolCount++
    var statusText = tc.status === 'running' ? 'calling ' + tc.name + '...' : tc.name + ' ' + tc.status
    _setThinkingLabel('Agent [' + thinkingToolCount + ']: ' + statusText)
    scrollToBottom()
  }

  // ── Status bar ─────────────────────────────────────────────────────────
  function setStatus (text) {
    if (els.statusText) els.statusText.textContent = text
  }

  function setModelStatus (status, label) {
    if (!els.modelStatus) return
    els.modelStatus.textContent = label
    els.modelStatus.className = 'model-status model-status-' + status
    state.lastModelStatus = { status: status, label: label }
  }

  // ── Context meter ───────────────────────────────────────────────────────
  // Shows how full the model's INPUT context is relative to the pruning
  // budget (maxConversationTokens). This is the copy sent to the API, NOT the
  // visible transcript — pruning trims the oldest history from what the model
  // sees while session.messages stays intact on screen. Making this visible is
  // the fix for "growing context silently makes edits expensive/error-prone":
  // the user can watch it fill and compact on demand before it costs them.
  function estimateSessionContextTokens () {
    var session = getActiveSession()
    if (!session || !window.PURE_PRUNE) return 0
    var msgs = session.messages || []
    var est = []
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i]
      if (m.role === 'user' || m.role === 'system') {
        est.push({ role: m.role, content: m.text || '' })
      } else if (m.role === 'assistant') {
        if (m.toolCalls && m.toolCalls.length > 0) {
          var tcs = []
          for (var t = 0; t < m.toolCalls.length; t++) {
            tcs.push({ function: { name: m.toolCalls[t].name || '', arguments: JSON.stringify(m.toolCalls[t].args || {}) } })
          }
          est.push({ role: 'assistant', content: m.text || '', tool_calls: tcs })
          for (var r = 0; r < m.toolCalls.length; r++) {
            est.push({ role: 'tool', content: JSON.stringify(m.toolCalls[r].result || { ok: true }) })
          }
        } else if (m.text) {
          est.push({ role: 'assistant', content: m.text })
        }
      }
    }
    return window.PURE_PRUNE.estimateTokens(est)
  }

  function getMaxConversationTokens () {
    var cfg = window.EXTENSIONS_LLM_CHAT_CONFIG || {}
    return cfg.maxConversationTokens || 120000
  }

  function updateContextMeter () {
    if (!els.contextMeter) return
    var used = estimateSessionContextTokens()
    var budget = getMaxConversationTokens()
    var pct = budget > 0 ? Math.round((used / budget) * 100) : 0
    var fillPct = Math.max(0, Math.min(100, pct))
    if (els.contextMeterFill) els.contextMeterFill.style.width = fillPct + '%'
    var level = pct >= 90 ? 'high' : (pct >= 60 ? 'mid' : 'low')
    els.contextMeter.className = 'context-meter context-meter-' + level
    if (els.contextMeterText) els.contextMeterText.textContent = 'ctx ' + pct + '%'
    els.contextMeter.setAttribute('title',
      'Model context: ~' + used.toLocaleString() + ' / ' + budget.toLocaleString() + ' tokens (' + pct + '%). ' +
      'Above 100% the oldest history is trimmed from what the model sees — your visible transcript is never touched. Click to compact now.')
  }

  // ── Model selector ───────────────────────────────────────────────────────
  // Render the selectable model buttons and highlight the active one.
  function renderModelSelector () {
    if (!els.modelSelector) return
    var session = getActiveSession()
    var active = normalizeModelId(session ? session.model : DEFAULT_MODEL)
    els.modelSelector.innerHTML = ''
    for (var i = 0; i < AVAILABLE_MODELS.length; i++) {
      var m = AVAILABLE_MODELS[i]
      var btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'model-btn' + (m.id === active ? ' model-btn-active' : '')
      btn.textContent = m.label
      btn.setAttribute('data-model-id', m.id)
      btn.setAttribute('title', m.id)
      // Availability from the last GET /models probe: a model the account can
      // no longer call (or that lost tool support) is dimmed BEFORE it is used.
      if (state.modelAvailability) {
        var info = state.modelAvailability[m.id]
        if (!info) {
          btn.className += ' model-btn-unavailable'
          btn.setAttribute('title', m.id + ' \u2014 NOT available on this account/endpoint')
        } else if (!info.functionCalling) {
          btn.className += ' model-btn-unavailable'
          btn.setAttribute('title', m.id + ' \u2014 served, but without function calling: the agent cannot use tools with it')
        } else {
          btn.setAttribute('title', m.id + ' \u2014 available, tools supported' +
            (info.contextLength ? ', context ' + Math.round(info.contextLength / 1024) + 'K' : ''))
        }
      }
      els.modelSelector.appendChild(btn)
    }
  }

  // Ask the endpoint which models it actually serves (GET /models) and show it
  // on the provider badge + model buttons. Cheap (one request, no tokens) and
  // fail-safe: a failed probe leaves availability unknown, nothing is blocked.
  function probeModelAvailability () {
    if (!window.CHAT_PROVIDER || typeof window.CHAT_PROVIDER.listModels !== 'function') return
    if (els.providerBadge) els.providerBadge.textContent = 'Cloud.ru \u2026'
    window.CHAT_PROVIDER.listModels().then(function (res) {
      var checkedAt = new Date().toLocaleTimeString()
      if (!res.ok) {
        state.modelAvailability = null
        if (els.providerBadge) {
          els.providerBadge.textContent = 'Cloud.ru ?'
          els.providerBadge.title = 'Model availability unknown (' + res.message + ') \u2014 click to re-check'
        }
        renderModelSelector()
        return
      }
      state.modelAvailability = res.models
      var okCount = 0
      for (var i = 0; i < AVAILABLE_MODELS.length; i++) {
        var info = res.models[AVAILABLE_MODELS[i].id]
        if (info && info.functionCalling) okCount++
      }
      if (els.providerBadge) {
        els.providerBadge.textContent = 'Cloud.ru ' + okCount + '/' + AVAILABLE_MODELS.length
        els.providerBadge.title = okCount + ' of ' + AVAILABLE_MODELS.length + ' panel models available (' +
          res.message + ', checked ' + checkedAt + ') \u2014 click to re-check'
      }
      renderModelSelector()
    })
  }

  // Switch the active model. Blocked mid-request so a run always finishes on the
  // model it started with (mixing models within one tool-call chain corrupts the
  // tool_call/tool message pairing).
  function selectModel (id) {
    if (!getModelById(id)) return
    if (state.isRequestInFlight) {
      setStatus('Finish or stop the current request before switching models.')
      return
    }
    var session = ensureSession()
    if (session.model === id) return
    session.model = id
    session.updatedAt = Date.now()
    persistState()
    renderModelSelector()
    setModelStatus(state.lastModelStatus.status === 'error' ? 'ok' : state.lastModelStatus.status, getModelLabel(id))
    setStatus('Model: ' + getModelLabel(id))
  }

  // ── Minimal markdown → HTML ─────────────────────────────────────────────
  // Delegates to the extracted, unit-tested renderer in lib/pure/markdown.js
  // (single source of truth; hardened against attribute-injection XSS).
  function renderMarkdown (text) {
    if (window.PURE_MARKDOWN && typeof window.PURE_MARKDOWN.renderMarkdown === 'function') {
      return window.PURE_MARKDOWN.renderMarkdown(text)
    }
    // Defensive fallback: if the pure module failed to load, escape everything
    // rather than risk emitting unescaped LLM output into innerHTML.
    if (!text) return ''
    return '<p>' + String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>'
  }

  // ── Conversation pruning ────────────────────────────────────────────────
  // Delegates to the extracted, unit-tested module in lib/pure/prune.js
  // (single source of truth: Cyrillic-aware token estimate, protected tail,
  // old-tool-result truncation, tool-pairing preservation).
  function pruneConversation (messages, maxTokens) {
    if (window.PURE_PRUNE && typeof window.PURE_PRUNE.pruneConversation === 'function') {
      return window.PURE_PRUNE.pruneConversation(messages, maxTokens)
    }
    return messages
  }

  // ── Knowledge Base Context (Phase 4) ──────────────────────────────────
  var KB_SNIPPETS = [
    {
      keywords: ['expression', 'expr', 'wiggle', 'loopout', 'loopin', 'valueattime', 'posterize', 'экспрешен', 'экспрессию', 'выражени'],
      text: 'Expression engine: AE 26+ uses V8 JavaScript. Globals: thisComp, thisLayer, thisProperty, time, value, velocity. No DOM/browser APIs. Common: wiggle(freq,amp), loopOut("cycle"), linear(t,tMin,tMax,vMin,vMax), ease(). Property refs: thisComp.layer("Name").transform.position. Expression MUST end with a value (the property result). Use camelCase (thisComp, toWorld), not snake_case.'
    },
    {
      keywords: ['sourcetext', 'source text', 'текст', 'text layer', 'текстов', 'counter', 'счётчик', 'typewriter', 'печатн'],
      text: 'SourceText: expressions must return a string or number (AE auto-wraps into TextDocument). Use \\r for line breaks, NOT \\n. Do NOT use text.sourceText.value — use text.sourceText directly. Do NOT construct TextDocument objects. Examples: Math.floor(linear(time,0,3,0,100)) for counter; text.sourceText.slice(0,Math.floor(time*10)) for typewriter.'
    },
    {
      keywords: ['sourcerectattime', 'bounding', 'boundingrect', 'rect'],
      text: 'sourceRectAtTime(t, includeExtents): returns {left, top, width, height}. Use on text layers for bounding box. Common: var r = thisLayer.sourceRectAtTime(time, false); [r.left + r.width/2, r.top + r.height/2] for text center.'
    },
    {
      keywords: ['repair', 'fix', 'error', 'ошибк', 'исправ', 'починить', 'debug'],
      text: 'Common expression errors: "undefined is not a function" = wrong method name; "Expected ] or ," = array syntax error; "Can\'t access" = property doesn\'t exist on this layer type. After apply_expression returns error, read the error message, fix the expression, retry. Use get_expression to read existing expressions before modifying.'
    }
  ]

  function buildKnowledgeBaseContext (userText) {
    if (!userText) return ''
    var lower = userText.toLowerCase()
    var parts = []
    for (var i = 0; i < KB_SNIPPETS.length; i++) {
      var snippet = KB_SNIPPETS[i]
      for (var k = 0; k < snippet.keywords.length; k++) {
        if (lower.indexOf(snippet.keywords[k]) >= 0) {
          parts.push(snippet.text)
          break
        }
      }
    }
    return parts.join('\n\n')
  }

  // ── Expression Validation (Phase 10, extended 2026-04-30) ────────────
  // Static checks that ship pre-flight warnings to the agent so it can
  // fix common JS-in-AE mistakes without a round trip to AE.
  function validateExpression (exprText) {
    var warnings = []
    if (!exprText || typeof exprText !== 'string') return warnings

    // 1. Text source-text API misuse.
    if (exprText.indexOf('text.sourceText.value') >= 0) {
      warnings.push('WARN: "text.sourceText.value" is incorrect. Use "text.sourceText" directly (it is already a TextDocument; do not call .value on it).')
    }

    // 2. Line breaks in SourceText use \r, not \n.
    if (exprText.indexOf('\\n') >= 0 && exprText.indexOf('\\r') < 0 && exprText.toLowerCase().indexOf('sourcetext') >= 0) {
      warnings.push('WARN: Use "\\r" for line breaks in SourceText, not "\\n" — AE does not honor \\n in TextDocument.')
    }

    // 3. Parenthesis balance (catches truncated batch payloads).
    var opens = 0; var closes = 0
    for (var i = 0; i < exprText.length; i++) {
      if (exprText.charAt(i) === '(') opens++
      if (exprText.charAt(i) === ')') closes++
    }
    if (opens !== closes) warnings.push('WARN: Unbalanced parentheses (' + opens + ' open, ' + closes + ' close). Likely truncated expression — try a shorter version.')

    // 4. Bracket balance.
    var squareOpen = 0; var squareClose = 0
    for (var j = 0; j < exprText.length; j++) {
      if (exprText.charAt(j) === '[') squareOpen++
      if (exprText.charAt(j) === ']') squareClose++
    }
    if (squareOpen !== squareClose) warnings.push('WARN: Unbalanced brackets [' + squareOpen + ' open, ' + squareClose + ' close].')

    // 5. Curly brace balance.
    var braceOpen = 0; var braceClose = 0
    for (var k = 0; k < exprText.length; k++) {
      if (exprText.charAt(k) === '{') braceOpen++
      if (exprText.charAt(k) === '}') braceClose++
    }
    if (braceOpen !== braceClose) warnings.push('WARN: Unbalanced braces {' + braceOpen + ' open, ' + braceClose + ' close}.')

    // 6. `if (cond) val1 else val2` used as an expression (invalid JS — needs ternary).
    //    Match on a literal `else` adjacent to a value expression rather than a block.
    //    Heuristic: an `if` followed by `(...) <something-without-braces> else` where
    //    the next character after the if-condition's closing `)` is NOT `{`.
    if (/\bif\s*\([^){]*\)\s*(?!\{)[^;{}]+\s+else\s+/.test(exprText)) {
      warnings.push('WARN: `if (cond) v1 else v2` is invalid as a JS expression. Use the ternary operator: `cond ? v1 : v2`.')
    }

    // 7. seedRandom with a constant seed and frozen=true (random will not change over time).
    //    Common LLM mistake: seedRandom(index, true) → random() returns the same number forever.
    //    Allow seeds that include `time` or arithmetic on time/Math.floor/index+time.
    var seedMatch = exprText.match(/seedRandom\s*\(\s*([^,]+?)\s*,\s*true\s*\)/)
    if (seedMatch) {
      var seedExpr = seedMatch[1]
      if (seedExpr.indexOf('time') < 0 && seedExpr.indexOf('Math.floor') < 0 && seedExpr.indexOf('frame') < 0) {
        warnings.push('WARN: seedRandom(' + seedExpr + ', true) freezes the random sequence — output will be a single constant for all frames. Drive the seed from `time` (e.g. `seedRandom(Math.floor(time * 2), true)`) so values change over time.')
      }
    }

    // 8. Double-call on effect controller: effect("...")("...").something()
    //    Common mistake: effect("Slider Control")("Slider")() — extra trailing ().
    if (/effect\s*\(\s*"[^"]*"\s*\)\s*\(\s*"[^"]*"\s*\)\s*\(\s*\)/.test(exprText)) {
      warnings.push('WARN: Trailing `()` after effect controller access — `effect("Name")("Property")` already resolves to the value; remove the empty parentheses.')
    }

    // 9. Trailing `.value` on a property reference inside an expression.
    //    AE auto-evaluates the property; appending `.value` returns undefined.
    if (/(thisProperty|thisLayer\.\w+|transform\.\w+)\.value\b/.test(exprText)) {
      warnings.push('WARN: Avoid `.value` on property references — `thisProperty`, `transform.position`, etc. already evaluate to the current value. `.value` returns undefined.')
    }

    // 10. Empty body (no value at end). Heuristic: trim, ensure last non-comment
    //     non-empty token is not a `;` after a statement keyword like `var`/`if`/`for`
    //     without a final expression. We approximate: the LAST line (after trimming)
    //     must contain at least one identifier or literal. Skip if expression contains
    //     a function declaration that returns a value.
    var trimmed = exprText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '')
    if (trimmed.length > 0) {
      var lastChar = trimmed.charAt(trimmed.length - 1)
      // If expression ends with `;` AND the last statement is a declaration, AE returns
      // undefined — usually a sign the model forgot the final value.
      if (lastChar === ';' && /\bvar\s+\w+\s*=[^;]+;\s*$/.test(trimmed)) {
        warnings.push('WARN: Expression ends with a `var` declaration — AE expression must evaluate to a value. Add the final value on its own line (e.g. last line: `myVar`).')
      }
    }

    // 11. Backtick / template-literal syntax — the AE expression engine is ES3.
    if (exprText.indexOf('`') >= 0) {
      warnings.push('WARN: Backtick/template-literal syntax is not supported — the AE expression engine is ES3. Build strings with `+` concatenation and double quotes.')
    }

    // 12. setValue()/setValueAtTime() are ExtendScript (scripting) methods, not
    //     valid inside an expression. An expression must END with the value it returns.
    if (/\.setValue(AtTime)?\s*\(/.test(exprText)) {
      warnings.push('WARN: setValue()/setValueAtTime() are scripting methods, not valid inside an expression. An expression must end with the value it returns — remove setValue and just return the computed value.')
    }

    // 13. Unclamped manual progress: `(time - t0) / dur` goes below 0 / above 1
    //     outside the window, so the property over/undershoots. Skip when the
    //     expression already guards the range (clamp/linear/ease/Math.min/max),
    //     loops (%/loopOut), or is string work (substr/split/sourceText).
    var _hasGuard = /clamp\s*\(|linear\s*\(|\bease(In|Out)?\s*\(|substr|Math\.(min|max)|%|sourceText|split\s*\(|loopOut|loopIn|[<>]=?\s*[01]\s*\?/.test(exprText)
    if (!_hasGuard && /\(\s*time\b[^)]*\)\s*\/\s*[\w.()\-\s]+/.test(exprText)) {
      warnings.push('WARN: Manual progress like `(time - t0) / dur` is not clamped — before/after the window it drops below 0 / rises above 1 and the property over/undershoots. Wrap the ratio in `clamp(..., 0, 1)` or use `linear(time, t0, t1, from, to)`, which clamps automatically.')
    }

    return warnings
  }

  /**
   * Convert tool loop log entries to the persisted session shape.
   * Used by both the success path and the error path (partial logs), so a
   * timed-out run still records what actually executed in AE.
   */
  function serializeToolCalls (calls) {
    return (calls || []).map(function (tc) {
      return {
        id: tc.id,
        name: tc.name,
        args: tc.args,
        result: tc.result,
        status: tc.status,
        // Timing is included so the Report (#9) and any future analytics
        // can compute per-tool latency without re-running the session.
        startTime: tc.startTime || null,
        endTime: tc.endTime || null
      }
    })
  }

  // ── Vision check helpers ────────────────────────────────────────────────
  function isVisionCheckEnabled () {
    try {
      var stored = localStorage.getItem(VISION_CHECK_KEY)
      if (stored === 'false') return false
    } catch (_) {}
    return true // default ON
  }

  function initVisionCheckToggle () {
    if (!els.visionCheckToggle) return
    els.visionCheckToggle.checked = isVisionCheckEnabled()
    els.visionCheckToggle.addEventListener('change', function () {
      try {
        localStorage.setItem(VISION_CHECK_KEY, String(els.visionCheckToggle.checked))
      } catch (_) {}
    })
  }

  /**
   * Downscale a PNG file to a ~480px-wide JPEG data URL via canvas.
   * Reads the file from disk, draws onto a canvas, returns a data URL.
   * @param {string} filePath - absolute path to the PNG on disk
   * @returns {Promise<string>} data:image/jpeg;base64,... string
   */
  function downscaleFrameToDataUrl (filePath) {
    return new Promise(function (resolve, reject) {
      try {
        var fs = require('fs')
        var raw = fs.readFileSync(filePath)
        var base64 = raw.toString('base64')
        var img = new Image()
        img.onload = function () {
          try {
            if (!img.width || !img.height) { reject(new Error('Frame image has zero dimensions')); return }
            var TARGET_W = 480
            var scale = Math.min(1, TARGET_W / img.width)
            var w = Math.round(img.width * scale)
            var h = Math.round(img.height * scale)
            var canvas = document.createElement('canvas')
            canvas.width = w
            canvas.height = h
            var ctx = canvas.getContext('2d')
            ctx.drawImage(img, 0, 0, w, h)
            var dataUrl = canvas.toDataURL('image/jpeg', 0.7)
            canvas.width = 0
            canvas.height = 0
            resolve(dataUrl)
          } catch (e) { reject(e) }
        }
        img.onerror = function () { reject(new Error('Failed to decode frame image')) }
        img.src = 'data:image/png;base64,' + base64
      } catch (e) { reject(e) }
    })
  }

  /**
   * Poll until a file exists and has size > 0 on disk.
   * capture_comp_frame resolves before the PNG finishes writing.
   * @param {string} filePath
   * @param {number} intervalMs - polling interval (default 500)
   * @param {number} timeoutMs  - total timeout (default 10000)
   * @returns {Promise<void>}
   */
  function pollFileReady (filePath, intervalMs, timeoutMs) {
    intervalMs = intervalMs || 500
    timeoutMs = timeoutMs || 10000
    var fs = require('fs')
    return new Promise(function (resolve, reject) {
      var elapsed = 0
      var timer = setInterval(function () {
        elapsed += intervalMs
        try {
          var stat = fs.statSync(filePath)
          if (stat.size > 0) {
            clearInterval(timer)
            resolve()
            return
          }
        } catch (_) {}
        if (elapsed >= timeoutMs) {
          clearInterval(timer)
          reject(new Error('Frame file not ready after ' + timeoutMs + 'ms'))
        }
      }, intervalMs)
    })
  }

  /**
   * Run the vision check flow after a successful mutating agent run.
   * Captures the comp frame, downscales, sends to M3, returns verdict.
   * On any error, fails open (returns ok:true) and logs to console.
   *
   * @param {string} userRequest   - the original user message text
   * @param {string} agentSummary  - the agent's text response
   * @param {Object} session       - the current session object
   * @param {boolean} isCorrectionRound - true if this is already the correction pass
   * @returns {Promise<{ok: boolean, issues: string[], correctionRan: boolean}>}
   */
  function runVisionCheck (userRequest, agentSummary, session, isCorrectionRound) {
    var VC = window.PURE_VISION_CHECK
    if (!VC) {
      console.warn('[vision] PURE_VISION_CHECK not loaded')
      return Promise.resolve({ ok: true, issues: [], correctionRan: false })
    }

    setStatus('Visual check...')
    var failOpen = { ok: true, issues: [], correctionRan: false }

    return window.HOST_BRIDGE.executeToolCall('capture_comp_frame', {})
      .then(function (captureResult) {
        if (!captureResult || !captureResult.ok || !captureResult.path) {
          console.warn('[vision] capture failed:', captureResult)
          return failOpen
        }
        return pollFileReady(captureResult.path)
          .then(function () { return downscaleFrameToDataUrl(captureResult.path) })
          .then(function (dataUrl) {
            var messages = VC.buildMessages(userRequest, agentSummary, dataUrl)
            return window.CHAT_PROVIDER.invoke(VC.VISION_MODEL_ID, messages, {
              max_tokens: 512,
              temperature: 0.1,
              timeoutMs: 30000,
              abortHandle: state.currentAbortHandle
            })
          })
          .then(function (response) {
            var content = ''
            if (response && response.choices && response.choices[0]) {
              content = (response.choices[0].message && response.choices[0].message.content) || ''
            }
            // Account vision tokens in the session counter. Price with the
            // vision model's own rates (M3) — NOT the chat model's.
            if (response && response.usage && response.usage.total_tokens > 0) {
              session.totalTokens = (session.totalTokens || 0) + response.usage.total_tokens
              session.promptTokens = (session.promptTokens || 0) + (response.usage.prompt_tokens || 0)
              session.completionTokens = (session.completionTokens || 0) + (response.usage.completion_tokens || 0)
              session.costRub = (session.costRub || 0) + accrueCost(VC.VISION_MODEL_ID, response.usage).rub
            }
            var verdict = VC.parseVerdict(content)
            if (verdict.ok) {
              setStatus('Visual check: OK')
              session.messages.push({ role: 'system', text: 'Visual check: OK' })
              renderTranscript()
              persistState()
              return { ok: true, issues: [], correctionRan: false }
            }

            // Verdict has issues
            var issueNote = 'Visual check found issues:\n' + verdict.issues.map(function (s) { return '- ' + s }).join('\n')
            session.messages.push({ role: 'system', text: issueNote })
            renderTranscript()
            persistState()

            if (isCorrectionRound) {
              // Already ran one correction — hard stop, no second correction.
              setStatus('Visual check: issues remain after correction')
              return { ok: false, issues: verdict.issues, correctionRan: false }
            }

            // Run ONE correction round.
            setStatus('Fixing visual issues...')
            var correctionText = VC.buildCorrectionPrompt(verdict.issues)
            return runCorrectionLoop(correctionText, session, userRequest)
              .then(function (corrResult) {
                return { ok: false, issues: verdict.issues, correctionRan: true, correctionResult: corrResult }
              })
          })
      })
      .catch(function (err) {
        console.warn('[vision] error (failing open):', err)
        setStatus('Visual check: skipped (error)')
        return failOpen
      })
  }

  /**
   * Run a single correction agent-loop pass. The correction prompt becomes
   * a new user message in the conversation, and the agent fixes the issues.
   * After the correction loop, run vision check again but with isCorrectionRound=true
   * so it NEVER triggers a second correction (hard bound).
   *
   * Undo semantics: correction-round mutations are ADDED to lastMutatingToolCount
   * so a single Undo reverts both the original run and the correction.
   */
  function runCorrectionLoop (correctionText, session, originalUserRequest) {
    // Push correction as a user message in the conversation.
    session.messages.push({ role: 'user', text: correctionText })
    session.updatedAt = Date.now()
    renderTranscript()
    persistState()

    // Build API messages the same way handleSend does.
    var apiMessages = []
    for (var i = 0; i < session.messages.length; i++) {
      var m = session.messages[i]
      if (m.role === 'user') {
        apiMessages.push({ role: 'user', content: m.text })
      } else if (m.role === 'assistant') {
        if (m.toolCalls && m.toolCalls.length > 0) {
          var toolCallDefs = []
          for (var tc = 0; tc < m.toolCalls.length; tc++) {
            var call = m.toolCalls[tc]
            toolCallDefs.push({
              id: call.id,
              type: 'function',
              function: {
                name: call.name,
                arguments: JSON.stringify(call.args || {})
              }
            })
          }
          var assistantApiMsg = { role: 'assistant', tool_calls: toolCallDefs }
          if (m.text) assistantApiMsg.content = m.text
          apiMessages.push(assistantApiMsg)

          for (var tr = 0; tr < m.toolCalls.length; tr++) {
            var tcResult = m.toolCalls[tr]
            apiMessages.push({
              role: 'tool',
              tool_call_id: tcResult.id,
              content: JSON.stringify(tcResult.result || { ok: true })
            })
          }
        } else if (m.text) {
          apiMessages.push({ role: 'assistant', content: m.text })
        }
      }
    }

    var agentCfg = window.EXTENSIONS_LLM_CHAT_CONFIG || {}
    var maxConversationTokens = agentCfg.maxConversationTokens || 120000
    var maxSteps = getAgentMaxSteps(agentCfg)
    apiMessages = pruneConversation(apiMessages, maxConversationTokens)

    var systemPrompt = ''
    if (window.AGENT_SYSTEM_PROMPT_BUILDER && typeof window.AGENT_SYSTEM_PROMPT_BUILDER.build === 'function') {
      var built = window.AGENT_SYSTEM_PROMPT_BUILDER.build(correctionText)
      systemPrompt = built && built.prompt ? built.prompt : (window.AGENT_SYSTEM_PROMPT || '')
    } else {
      systemPrompt = window.AGENT_SYSTEM_PROMPT || ''
    }
    var kbContext = buildKnowledgeBaseContext(correctionText)
    if (kbContext) systemPrompt += '\n\n## Expression Reference (from documentation)\n\n' + kbContext

    showThinking()

    return window.AGENT_TOOL_LOOP.runAgentLoop({
      modelId: session.model,
      systemPrompt: systemPrompt,
      messages: apiMessages,
      tools: (window.AGENT_TOOL_REGISTRY && window.AGENT_TOOL_REGISTRY.tools) || [],
      maxSteps: maxSteps,
      temperature: agentCfg.agentTemperature || 0.3,
      streaming: agentCfg.agentStreaming === true,
      thinkingFirstTurn: agentCfg.agentThinkingFirstTurn === true,
      abortHandle: state.currentAbortHandle,
      onTextChunk: function (chunk) { updateThinkingWithStreamText(chunk) },
      onReasoningChunk: function (chunk) { updateThinkingReasoning(chunk) },
      onToolCall: function (tc) { updateThinkingWithToolCall(tc) },
      onStepStart: function (stepIdx) {
        _setThinkingLabel('Correction · step ' + (stepIdx + 1) + '/' + maxSteps)
      },
      onStepComplete: function (stepIdx, results) {
        setStatus('Correction step ' + (stepIdx + 1))
      }
    }).then(function (result) {
      removeThinking()

      var READ_ONLY_TOOLS = (window.AGENT_TOOL_LOOP && window.AGENT_TOOL_LOOP.READ_ONLY_TOOLS) || {}
      var corrMutating = 0
      var allCalls = result.toolCallLog || []
      for (var ci = 0; ci < allCalls.length; ci++) {
        if (!READ_ONLY_TOOLS[allCalls[ci].name] && allCalls[ci].status === 'ok') {
          corrMutating++
        }
      }
      // ADD correction mutations to existing count (single Undo scope).
      state.lastMutatingToolCount += corrMutating
      updateUndoButton()

      var assistantMsg = {
        role: 'assistant',
        text: result.content || '',
        toolCalls: serializeToolCalls(allCalls)
      }
      session.messages.push(assistantMsg)
      session.updatedAt = Date.now()

      if (result.usage && result.usage.total_tokens > 0) {
        session.totalTokens = (session.totalTokens || 0) + result.usage.total_tokens
        session.promptTokens = (session.promptTokens || 0) + (result.usage.prompt_tokens || 0)
        session.completionTokens = (session.completionTokens || 0) + (result.usage.completion_tokens || 0)
        session.costRub = (session.costRub || 0) + accrueCost(session.model, result.usage).rub
      }

      renderTranscript()
      persistState()

      // Run vision check AFTER correction, but with isCorrectionRound=true
      // so it can never trigger yet another correction (hard bound: max 1).
      var corrAgentSummary = result.content || ''
      return runVisionCheck(originalUserRequest, corrAgentSummary, session, true)
    }).catch(function (err) {
      removeThinking()
      var errMsg = (err && err.message) || String(err)
      session.messages.push({ role: 'system', text: 'Correction error: ' + errMsg })
      renderTranscript()
      persistState()
      console.warn('[vision] correction loop error:', err)
      return { ok: false, correctionError: errMsg }
    })
  }

  // ── Handle Send ────────────────────────────────────────────────────────
  function handleSend () {
    if (state.isRequestInFlight) return
    var text = (els.userInput.value || '').trim()
    if (!text) return

    var session = ensureSession()
    session.model = normalizeModelId(session.model)

    // Push user message.
    session.messages.push({ role: 'user', text: text })
    session.updatedAt = Date.now()
    // Auto-title: a chat still carrying its default name takes its title from
    // the first message, so the switcher shows what each chat is about.
    if (session.messages.length === 1 && window.PURE_SESSION_STORE.isDefaultTitle(session.title)) {
      var autoTitle = window.PURE_SESSION_STORE.titleFromFirstMessage(text)
      if (autoTitle) {
        session.title = autoTitle
        renderSessionBar()
      }
    }
    els.userInput.value = ''
    clearDraft()
    renderTranscript()
    persistState()

    // Check API key for cloud models.
    var parsed = window.CHAT_PROVIDER.parseModelId(session.model)
    if (parsed.provider === 'cloudru') {
      var secrets = window.EXTENSIONS_LLM_CHAT_SECRETS || {}
      var cfg = window.EXTENSIONS_LLM_CHAT_CONFIG || {}
      var apiKey = secrets.apiKey || cfg.apiKey || ''
      if (!apiKey) {
        session.messages.push({ role: 'system', text: 'No API key configured. Create config/secrets.local.js with your Cloud.ru API key.' })
        renderTranscript()
        persistState()
        return
      }
    }

    // Warn if no composition is open.
    if (els.activeCompNote && els.activeCompNote.textContent.indexOf('unavailable') !== -1) {
      session.messages.push({ role: 'system', text: '\u26A0 No active composition detected. Open a composition in After Effects before sending requests \u2014 most tools require an active comp.' })
      renderTranscript()
      persistState()
    }

    // Start agent flow.
    state.isRequestInFlight = true
    state.currentAbortHandle = window.AGENT_TOOL_LOOP.createAbortHandle()
    els.sendBtn.disabled = true
    if (els.cancelBtn) els.cancelBtn.style.display = ''
    setStatus('Working...')
    showThinking()

    // Build conversation messages for the API.
    var apiMessages = []
    for (var i = 0; i < session.messages.length; i++) {
      var m = session.messages[i]
      if (m.role === 'user') {
        apiMessages.push({ role: 'user', content: m.text })
      } else if (m.role === 'assistant') {
        if (m.toolCalls && m.toolCalls.length > 0) {
          var toolCallDefs = []
          for (var tc = 0; tc < m.toolCalls.length; tc++) {
            var call = m.toolCalls[tc]
            toolCallDefs.push({
              id: call.id,
              type: 'function',
              function: {
                name: call.name,
                arguments: JSON.stringify(call.args || {})
              }
            })
          }
          var assistantApiMsg = { role: 'assistant', tool_calls: toolCallDefs }
          if (m.text) assistantApiMsg.content = m.text
          apiMessages.push(assistantApiMsg)

          for (var tr = 0; tr < m.toolCalls.length; tr++) {
            var tcResult = m.toolCalls[tr]
            apiMessages.push({
              role: 'tool',
              tool_call_id: tcResult.id,
              content: JSON.stringify(tcResult.result || { ok: true })
            })
          }
        } else if (m.text) {
          apiMessages.push({ role: 'assistant', content: m.text })
        }
      }
    }

    var agentCfg = window.EXTENSIONS_LLM_CHAT_CONFIG || {}
    var maxConversationTokens = agentCfg.maxConversationTokens || 120000
    var maxSteps = getAgentMaxSteps(agentCfg)
    apiMessages = pruneConversation(apiMessages, maxConversationTokens)

    var kbContext = buildKnowledgeBaseContext(text)
    // Prefer the modular builder so we only pay tokens for sections relevant
    // to this request (#1). Falls back to the full prompt if the builder
    // isn't loaded (older agentSystemPrompt.js or boot order issues).
    var systemPrompt = ''
    var promptModulesUsed = ['core']
    if (window.AGENT_SYSTEM_PROMPT_BUILDER && typeof window.AGENT_SYSTEM_PROMPT_BUILDER.build === 'function') {
      var built = window.AGENT_SYSTEM_PROMPT_BUILDER.build(text)
      systemPrompt = built && built.prompt ? built.prompt : (window.AGENT_SYSTEM_PROMPT || '')
      if (built && built.modules) promptModulesUsed = ['core'].concat(built.modules)
    } else {
      systemPrompt = window.AGENT_SYSTEM_PROMPT || ''
    }
    if (kbContext) systemPrompt += '\n\n## Expression Reference (from documentation)\n\n' + kbContext

    var runLog = [] // accumulated tool-call log for mid-run crash persistence

    window.AGENT_TOOL_LOOP.runAgentLoop({
      modelId: session.model,
      systemPrompt: systemPrompt,
      messages: apiMessages,
      tools: (window.AGENT_TOOL_REGISTRY && window.AGENT_TOOL_REGISTRY.tools) || [],
      maxSteps: maxSteps,
      temperature: agentCfg.agentTemperature || 0.3,
      // Default false: Cloud.ru (vllm-0.22.0) drops tool_calls in streaming
      // mode for GLM-5.1 (verified 2026-06-10). Flip agentStreaming in config
      // to re-enable live reasoning once the server is fixed.
      streaming: agentCfg.agentStreaming === true,
      // Thinking OFF on all loop turns by default (12x faster, see config).
      thinkingFirstTurn: agentCfg.agentThinkingFirstTurn === true,
      abortHandle: state.currentAbortHandle,
      onTextChunk: function (chunk) {
        updateThinkingWithStreamText(chunk)
      },
      onReasoningChunk: function (chunk) {
        updateThinkingReasoning(chunk)
      },
      onToolCall: function (tc) {
        runLog.push(tc) // live reference — result/status fill in as it runs
        updateThinkingWithToolCall(tc)
      },
      onStepStart: function (stepIdx) {
        // Non-streaming turns give no token feedback while the model thinks,
        // so without this the label stays stuck on the previous tool's status
        // for 7-14s and looks frozen. Show an explicit "waiting" state; the
        // elapsed-seconds timer in the indicator keeps ticking alongside it.
        _setThinkingLabel('Agent · waiting for model (step ' + (stepIdx + 1) + '/' + maxSteps + ')')
      },
      onStepComplete: function (stepIdx, results) {
        setStatus('Step ' + (stepIdx + 1) + '/' + maxSteps + ' (' + results.length + ' tool calls)')
        savePendingRun(session.id, runLog)
      }
    }).then(function (result) {
      removeThinking()

      // Shared read-only list from the tool loop (single source of truth).
      // A stale local copy here once omitted search_expression_library /
      // list_available_effects, inflating the Undo count — Undo then reverted
      // the user's OWN edits beyond the agent's actions.
      var READ_ONLY_TOOLS = (window.AGENT_TOOL_LOOP && window.AGENT_TOOL_LOOP.READ_ONLY_TOOLS) || {}
      var mutatingCount = 0
      var allCalls = result.toolCallLog || []
      for (var ci = 0; ci < allCalls.length; ci++) {
        if (!READ_ONLY_TOOLS[allCalls[ci].name] && allCalls[ci].status === 'ok') {
          mutatingCount++
        }
      }
      state.lastMutatingToolCount = mutatingCount
      updateUndoButton()

      var assistantMsg = {
        role: 'assistant',
        text: result.content || '',
        toolCalls: serializeToolCalls(allCalls)
      }
      session.messages.push(assistantMsg)
      session.updatedAt = Date.now()

      setModelStatus('ok', getModelLabel(session.model))
      var usageNote = ''
      if (result.usage && result.usage.total_tokens > 0) {
        session.totalTokens = (session.totalTokens || 0) + result.usage.total_tokens
        session.promptTokens = (session.promptTokens || 0) + (result.usage.prompt_tokens || 0)
        session.completionTokens = (session.completionTokens || 0) + (result.usage.completion_tokens || 0)
        var reqCost = accrueCost(session.model, result.usage)
        session.costRub = (session.costRub || 0) + reqCost.rub
        usageNote = ' | tokens: ' + result.usage.total_tokens
        if (reqCost.rub > 0) {
          usageNote += ' · ≈ ' + window.PURE_PRICING.formatRub(reqCost.rub)
        }
        usageNote += ' (session ' + session.totalTokens
        if (session.costRub > 0 && window.PURE_PRICING) {
          usageNote += ' · ≈ ' + window.PURE_PRICING.formatRub(session.costRub)
        }
        usageNote += ')'
      }
      setStatus('Ready' + usageNote)
      renderTranscript()
      persistState()
      clearPendingRun()

      // ── Vision check (post-agent) ──────────────────────────────────
      // Trigger only when: toggle enabled, run succeeded, mutating calls > 0.
      if (isVisionCheckEnabled() && mutatingCount > 0 && window.PURE_VISION_CHECK && window.HOST_BRIDGE) {
        var agentSummary = result.content || ''
        return runVisionCheck(text, agentSummary, session, false).then(function () {
          // Update status with final token count after vision + possible correction.
          var finalUsage = ' | tokens session: ' + (session.totalTokens || 0)
          if (session.costRub > 0 && window.PURE_PRICING) {
            finalUsage += ' · ≈ ' + window.PURE_PRICING.formatRub(session.costRub)
          }
          setStatus('Ready' + finalUsage)
        })
      }
    }).catch(function (err) {
      removeThinking()
      // Preserve already-executed tool calls (P0-3): the layers/keyframes may
      // already exist in AE, so the user must see what ran, and the next
      // request must replay these calls so the model knows the real state.
      var partialLog = (err && err.toolCallLog) || []
      if (partialLog.length > 0) {
        session.messages.push({
          role: 'assistant',
          text: '',
          toolCalls: serializeToolCalls(partialLog)
        })
      }
      // A failed run may still have mutated the project — count the partial
      // log the same way as the success path so Undo reflects reality instead
      // of keeping the count from the PREVIOUS run.
      var roTools = (window.AGENT_TOOL_LOOP && window.AGENT_TOOL_LOOP.READ_ONLY_TOOLS) || {}
      var partialMutating = 0
      for (var pi = 0; pi < partialLog.length; pi++) {
        if (!roTools[partialLog[pi].name] && partialLog[pi].status === 'ok') partialMutating++
      }
      state.lastMutatingToolCount = partialMutating
      updateUndoButton()
      var errMsg = err.message || String(err)
      session.messages.push({ role: 'system', text: 'Error: ' + errMsg })
      session.updatedAt = Date.now()

      setModelStatus('error', 'model: error')
      setStatus('Error')
      renderTranscript()
      persistState()
      clearPendingRun() // partial log is now in the transcript (see above)
    }).then(function () {
      state.isRequestInFlight = false
      state.currentAbortHandle = null
      if (els.sendBtn) els.sendBtn.disabled = false
      if (els.cancelBtn) els.cancelBtn.style.display = 'none'
      refreshActiveCompNote(true)
    })
  }

  // ── Subtitles task button ──────────────────────────────────────────────
  // One-click pipeline that drives the two subtitle tools directly (no LLM
  // round-trip): transcribe_comp_audio → create_subtitles. Stage + elapsed
  // seconds are shown in the task bar; the finished run is stored in the
  // transcript as regular tool calls so the NEXT agent request replays them
  // and the model knows the subtitle layers exist.
  var subtitlesTaskTimer = null

  // Status is mirrored into the task bar (visible when the studio is closed)
  // and into the studio itself, where it can wrap onto several lines.
  function setSubtitlesStatus (text, isError) {
    var targets = [els.subtitlesStatus, els.subtitlesPanelStatus]
    for (var i = 0; i < targets.length; i++) {
      if (!targets[i]) continue
      targets[i].textContent = text || ''
      targets[i].classList.toggle('task-status-error', !!isError)
      if (text) targets[i].title = text
    }
  }

  function getSubtitleStyle () {
    var v = (els.subtitlesStyle && els.subtitlesStyle.value) || 'word_reveal'
    return (v === 'karaoke' || v === 'none') ? v : 'word_reveal'
  }

  function setTaskControlsDisabled (disabled) {
    var ctrls = [els.sendBtn, els.subtitlesBtn, els.subtitlesLang, els.subtitlesStyle,
      els.subtitlesRebuildBtn, els.transcriptSaveBtn, els.transcriptLoadBtn,
      els.subtitlesFont, els.subtitlesFontStyle, els.subtitlesFontSize, els.subtitlesColor,
      els.subtitlesPlateColor, els.subtitlesSpokenColor]
    for (var i = 0; i < ctrls.length; i++) if (ctrls[i]) ctrls[i].disabled = !!disabled
  }

  // ── Subtitles studio (overlay) ─────────────────────────────────────────
  // Style/font/size/color controls live in their own overlay so they do not
  // compete with the chat input and quick actions. Settings persist in
  // localStorage — a look is usually reused across many comps.
  var SUBTITLE_COLOR_FIELDS = [
    { el: 'subtitlesColor', sw: 'subtitles-color-sw', key: 'color', def: '#ffffff' },
    { el: 'subtitlesPlateColor', sw: 'subtitles-plate-color-sw', key: 'plateColor', def: '#ffd700' },
    { el: 'subtitlesSpokenColor', sw: 'subtitles-spoken-color-sw', key: 'spokenColor', def: '#0f0f0f' }
  ]

  // '#rrggbb' → AE's [r,g,b] in 0..1, or null when the field is unusable
  // (the host then keeps its own default instead of painting things black).
  function hexToRgb01 (hex) {
    var m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex == null ? '' : hex).trim())
    if (!m) return null
    var n = parseInt(m[1], 16)
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
  }

  function refreshColorSwatches () {
    for (var i = 0; i < SUBTITLE_COLOR_FIELDS.length; i++) {
      var f = SUBTITLE_COLOR_FIELDS[i]
      var input = els[f.el]
      var sw = document.getElementById(f.sw)
      if (!input || !sw) continue
      var ok = !!hexToRgb01(input.value)
      sw.style.backgroundColor = ok ? input.value : 'transparent'
      input.classList.toggle('task-status-error', !ok && input.value !== '')
    }
  }

  // Karaoke is the only style with a plate / spoken-word color.
  function refreshSubtitleStyleUI () {
    var karaoke = getSubtitleStyle() === 'karaoke'
    var rows = document.querySelectorAll('.karaoke-only')
    for (var i = 0; i < rows.length; i++) rows[i].style.display = karaoke ? '' : 'none'
  }

  // ── Font pickers ───────────────────────────────────────────────────────
  // The family/style lists come from AE itself (app.fonts), so a typo can no
  // longer produce a silently-substituted font. Families are cached by the
  // bridge; the style list is rebuilt whenever the family changes.
  // Preferred family first, then a fallback chain: "SB Sans Text" is a
  // Windows-side corporate font, so on a Mac the picker would otherwise land
  // on whatever sorts first alphabetically (a random display face). These
  // are ordered Mac-system → Windows-system so both platforms get a neutral
  // sans instead.
  var SUBTITLE_FAMILY_FALLBACKS = ['SB Sans Text', 'Helvetica Neue', 'Helvetica', 'Arial', 'Segoe UI']
  var SUBTITLE_DEFAULT_FAMILY = SUBTITLE_FAMILY_FALLBACKS[0]
  var SUBTITLE_DEFAULT_STYLE = 'Regular'
  var _fontFamilies = null // [{ f: familyName, s: [[styleName, postScriptName], ...] }]
  var _wantFamily = SUBTITLE_DEFAULT_FAMILY
  var _wantStyle = SUBTITLE_DEFAULT_STYLE

  function _findFamily (name) {
    if (!_fontFamilies || !name) return null
    for (var i = 0; i < _fontFamilies.length; i++) {
      if (_fontFamilies[i].f === name) return _fontFamilies[i]
    }
    return null
  }

  // Fill #subtitles-font-style with the selected family's styles, preferring
  // `want`, then Regular, then whatever the family offers first.
  function refreshFontStyles (want) {
    var sel = els.subtitlesFontStyle
    if (!sel) return
    var fam = _findFamily(els.subtitlesFont ? els.subtitlesFont.value : '')
    sel.innerHTML = ''
    if (!fam) return
    var pick = 0
    for (var i = 0; i < fam.s.length; i++) {
      var opt = document.createElement('option')
      opt.value = fam.s[i][1] // PostScript name — what AE's TextDocument wants
      opt.textContent = fam.s[i][0]
      sel.appendChild(opt)
      if (want && fam.s[i][0] === want) pick = i
      else if (!want && fam.s[i][0] === SUBTITLE_DEFAULT_STYLE) pick = i
    }
    sel.selectedIndex = pick
  }

  function populateFontPickers () {
    var sel = els.subtitlesFont
    if (!sel || !window.HOST_BRIDGE || !window.HOST_BRIDGE.listFonts) return
    window.HOST_BRIDGE.listFonts().then(function (res) {
      if (!res || !res.ok || !res.families || !res.families.length) {
        setSubtitlesStatus('Could not read the installed fonts \u2014 AE will use its default.', true)
        return
      }
      _fontFamilies = res.families
      sel.innerHTML = ''
      for (var i = 0; i < _fontFamilies.length; i++) {
        var opt = document.createElement('option')
        opt.value = _fontFamilies[i].f
        opt.textContent = _fontFamilies[i].f
        sel.appendChild(opt)
      }
      // Saved family → fallback chain → first installed family.
      var target = null
      if (_findFamily(_wantFamily)) target = _wantFamily
      for (var fi = 0; target === null && fi < SUBTITLE_FAMILY_FALLBACKS.length; fi++) {
        if (_findFamily(SUBTITLE_FAMILY_FALLBACKS[fi])) target = SUBTITLE_FAMILY_FALLBACKS[fi]
      }
      sel.value = (target === null) ? _fontFamilies[0].f : target
      refreshFontStyles(_wantStyle)
    }).catch(function () {
      setSubtitlesStatus('Could not read the installed fonts \u2014 AE will use its default.', true)
    })
  }

  // Style name of the current selection (what we persist — PostScript names
  // are not stable across families, the style label is).
  function currentFontStyleName () {
    var sel = els.subtitlesFontStyle
    if (!sel || sel.selectedIndex < 0) return ''
    var opt = sel.options[sel.selectedIndex]
    return opt ? opt.textContent : ''
  }

  function saveSubtitleSettings () {
    try {
      var data = {
        lang: els.subtitlesLang ? els.subtitlesLang.value : 'ru',
        style: getSubtitleStyle(),
        fontFamily: els.subtitlesFont ? els.subtitlesFont.value : '',
        fontStyle: currentFontStyleName(),
        fontSize: els.subtitlesFontSize ? els.subtitlesFontSize.value : ''
      }
      for (var i = 0; i < SUBTITLE_COLOR_FIELDS.length; i++) {
        var f = SUBTITLE_COLOR_FIELDS[i]
        data[f.key] = els[f.el] ? els[f.el].value : f.def
      }
      localStorage.setItem(SUBTITLE_SETTINGS_KEY, JSON.stringify(data))
    } catch (_) {}
  }

  function loadSubtitleSettings () {
    var data = null
    try { data = JSON.parse(localStorage.getItem(SUBTITLE_SETTINGS_KEY)) } catch (_) {}
    if (data && typeof data === 'object') {
      if (els.subtitlesLang && data.lang) els.subtitlesLang.value = data.lang
      if (els.subtitlesStyle && data.style) els.subtitlesStyle.value = data.style
      if (typeof data.fontFamily === 'string' && data.fontFamily) _wantFamily = data.fontFamily
      if (typeof data.fontStyle === 'string' && data.fontStyle) _wantStyle = data.fontStyle
      if (els.subtitlesFontSize && typeof data.fontSize === 'string') els.subtitlesFontSize.value = data.fontSize
      for (var i = 0; i < SUBTITLE_COLOR_FIELDS.length; i++) {
        var f = SUBTITLE_COLOR_FIELDS[i]
        if (els[f.el] && typeof data[f.key] === 'string' && data[f.key]) els[f.el].value = data[f.key]
      }
    }
    refreshColorSwatches()
    refreshSubtitleStyleUI()
    populateFontPickers()
  }

  function openSubtitlesPanel () {
    if (!els.subtitlesPanel) return
    els.subtitlesPanel.style.display = ''
    refreshSubtitleStyleUI()
    if (els.subtitlesStyle) els.subtitlesStyle.focus()
  }

  function closeSubtitlesPanel () {
    if (els.subtitlesPanel) els.subtitlesPanel.style.display = 'none'
  }

  function toggleSubtitlesPanel () {
    if (!els.subtitlesPanel) return
    if (els.subtitlesPanel.style.display === 'none') openSubtitlesPanel()
    else closeSubtitlesPanel()
  }

  /**
   * Collect the studio's look settings as create_subtitles arguments. Empty
   * fields are omitted so the host keeps its own defaults (notably: no font
   * size = auto-fit to comp width).
   */
  function buildSubtitleStyleArgs () {
    var style = getSubtitleStyle()
    var out = { animation: style }
    // The style <option> value is the PostScript name — the only identifier
    // AE's TextDocument.font accepts without silently substituting a font.
    var font = els.subtitlesFontStyle ? String(els.subtitlesFontStyle.value || '').trim() : ''
    if (font) out.font = font
    var size = els.subtitlesFontSize ? parseFloat(els.subtitlesFontSize.value) : NaN
    if (isFinite(size) && size > 0) out.font_size = size
    var fill = els.subtitlesColor ? hexToRgb01(els.subtitlesColor.value) : null
    if (fill) out.fill_color = fill
    if (style === 'karaoke') {
      var plate = els.subtitlesPlateColor ? hexToRgb01(els.subtitlesPlateColor.value) : null
      if (plate) out.highlight_color = plate
      var spoken = els.subtitlesSpokenColor ? hexToRgb01(els.subtitlesSpokenColor.value) : null
      if (spoken) out.highlight_text_color = spoken
    }
    return out
  }

  /**
   * Run the subtitle pipeline. reuseTranscript=true skips transcription and
   * builds from the cached/loaded transcript (Rebuild — how a different style
   * is tried without paying Whisper again).
   */
  function runSubtitlesTask (reuseTranscript) {
    if (state.isRequestInFlight) {
      setStatus('Finish or stop the current request before running Subtitles.')
      return
    }
    if (!window.HOST_BRIDGE) return
    if (reuseTranscript && !window.HOST_BRIDGE.getLastTranscription()) {
      setSubtitlesStatus('No transcript cached \u2014 run Subtitles or load a saved transcript first.', true)
      return
    }
    var lang = (els.subtitlesLang && els.subtitlesLang.value) || 'ru'
    var style = getSubtitleStyle()
    var buildArgs = buildSubtitleStyleArgs()
    var session = ensureSession()

    state.isRequestInFlight = true
    setTaskControlsDisabled(true)

    var startedAt = Date.now()
    // Rendering + Whisper can legitimately take minutes on long comps — the
    // ticking elapsed counter is what tells the user the task is alive.
    var stageLabel = reuseTranscript
      ? 'Rebuilding subtitle layer (' + style + ')'
      : 'Step 1/2: rendering + transcribing audio (' + lang + ')'
    function tick () {
      setSubtitlesStatus(stageLabel + '\u2026 ' + Math.round((Date.now() - startedAt) / 1000) + 's', false)
    }
    tick()
    subtitlesTaskTimer = setInterval(tick, 1000)
    setStatus('Subtitles: working\u2026')

    var taskCalls = []
    function logTaskCall (name, args, res) {
      taskCalls.push({
        id: 'subtask_' + Date.now() + '_' + taskCalls.length,
        name: name,
        args: args,
        result: res,
        status: (res && res.ok === true) ? 'ok' : 'error',
        startTime: null,
        endTime: null
      })
    }
    function finishTask () {
      if (subtitlesTaskTimer) { clearInterval(subtitlesTaskTimer); subtitlesTaskTimer = null }
      state.isRequestInFlight = false
      setTaskControlsDisabled(false)
      if (taskCalls.length > 0) {
        session.messages.push({ role: 'assistant', text: '', toolCalls: serializeToolCalls(taskCalls) })
        session.updatedAt = Date.now()
        renderTranscript()
        persistState()
      }
      refreshActiveCompNote(true)
    }

    var first = reuseTranscript
      ? Promise.resolve(null)
      : window.HOST_BRIDGE.executeToolCall('transcribe_comp_audio', { language: lang })
    first
      .then(function (res) {
        if (!reuseTranscript) {
          logTaskCall('transcribe_comp_audio', { language: lang }, res)
          if (!res || res.ok !== true) throw new Error((res && res.message) || 'transcription failed')
          stageLabel = 'Step 2/2: building subtitle layer (' + res.segmentCount + ' segment' + (res.segmentCount === 1 ? '' : 's') + ', ' + style + ')'
          tick()
        }
        return window.HOST_BRIDGE.executeToolCall('create_subtitles', buildArgs)
      })
      .then(function (res) {
        logTaskCall('create_subtitles', buildArgs, res)
        if (!res || res.ok !== true) throw new Error((res && res.message) || 'subtitle layer creation failed')
        // create_subtitles wraps everything in ONE undo group — a single
        // Undo click reverts the whole rig (text layer + box).
        state.lastMutatingToolCount = 1
        updateUndoButton()
        var secs = Math.round((Date.now() - startedAt) / 1000)
        setSubtitlesStatus('Done in ' + secs + 's \u2014 ' + res.cueCount + ' cue(s), ' + style + ', layer "' + res.layerName + '"', false)
        setStatus('Ready')
        finishTask()
      })
      .catch(function (err) {
        var msg = (err && err.message) || String(err)
        setSubtitlesStatus('Failed: ' + msg, true)
        setStatus('Subtitles failed')
        session.messages.push({ role: 'system', text: 'Subtitles task error: ' + msg })
        finishTask()
      })
  }

  // ── Transcript save / load ─────────────────────────────────────────────
  // The Whisper result (segments + ffmpeg silence map) is cached in memory by
  // hostBridge only. Saving it to disk makes an expensive transcription
  // survive a panel reload and lets the same audio be re-styled later.
  function handleTranscriptSave () {
    if (!window.HOST_BRIDGE) return
    var tr = window.HOST_BRIDGE.getLastTranscription()
    if (!tr || !tr.segments || !tr.segments.length) {
      setSubtitlesStatus('Nothing to save \u2014 no transcript in this session yet.', true)
      return
    }
    try {
      var fs = require('fs')
      var path = require('path')
      var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      var outPath = path.join(resolveOutputDir(), 'ae-transcript-' + ts + '.json')
      fs.writeFileSync(outPath, JSON.stringify({
        savedAt: new Date().toISOString(),
        language: tr.language || null,
        durationSec: tr.durationSec || null,
        segments: tr.segments,
        silences: tr.silences || null
      }, null, 2), 'utf8')
      setSubtitlesStatus('Transcript saved: ' + outPath, false)
      setStatus('Transcript saved to ' + outPath)
    } catch (e) {
      setSubtitlesStatus('Save failed: ' + ((e && e.message) || String(e)), true)
    }
  }

  function pickTranscriptFile () {
    // CEP's native dialog; fall back to a typed path when the API is absent
    // (e.g. the panel opened in a plain browser for UI work).
    try {
      if (window.cep && window.cep.fs && typeof window.cep.fs.showOpenDialogEx === 'function') {
        var res = window.cep.fs.showOpenDialogEx(false, false, 'Select a saved transcript JSON', resolveOutputDir(), ['json'])
        if (res && res.data && res.data.length) return res.data[0]
        return null
      }
    } catch (_) {}
    var typed = window.prompt('Full path to the transcript JSON:')
    return typed || null
  }

  function handleTranscriptLoad () {
    if (!window.HOST_BRIDGE) return
    var file = pickTranscriptFile()
    if (!file) return
    try {
      var data = JSON.parse(require('fs').readFileSync(file, 'utf8'))
      var segments = window.PURE_SUBTITLES.normalizeWhisperSegments(data.segments || data, 0)
      if (!segments.length) {
        setSubtitlesStatus('Load failed: no usable segments in ' + file, true)
        return
      }
      var silences = (data.silences && data.silences.length) ? data.silences : null
      window.HOST_BRIDGE.setLastTranscription({
        segments: segments,
        silences: silences,
        language: data.language || null,
        durationSec: data.durationSec || null
      })
      setSubtitlesStatus('Transcript loaded \u2014 ' + segments.length + ' segment(s)' +
        (silences ? ', ' + silences.length + ' silence gap(s)' : ', no silence map') +
        '. Press Rebuild to create the layer.', false)
      setStatus('Transcript loaded from ' + file)
    } catch (e) {
      setSubtitlesStatus('Load failed: ' + ((e && e.message) || String(e)), true)
    }
  }

  // ── Handle Undo ────────────────────────────────────────────────────────
  // Reflect the pending agent-action count on the Undo button. Disabled +
  // plain "Undo" when there is nothing to revert — a blind executeCommand(16)
  // here used to revert the user's OWN manual edit.
  function updateUndoButton () {
    if (!els.undoBtn) return
    var count = state.lastMutatingToolCount || 0
    els.undoBtn.disabled = count < 1
    els.undoBtn.textContent = count > 0 ? 'Undo (' + count + ')' : 'Undo'
  }

  function handleUndo () {
    if (!window.HOST_BRIDGE) return
    var count = state.lastMutatingToolCount || 0
    if (count < 1) {
      setStatus('Nothing to undo — no agent changes since the last run')
      updateUndoButton()
      return
    }

    var script = '(function(){ for (var i = 0; i < ' + count + '; i++) { app.executeCommand(16); } return "' + count + '"; })()'
    window.HOST_BRIDGE.evalHostFunction(script)
      .then(function () { setStatus('Undo: ' + count + ' action' + (count > 1 ? 's' : '') + ' reverted') })
      .catch(function (e) { setStatus('Undo failed: ' + e.message) })
    state.lastMutatingToolCount = 0
    updateUndoButton()
  }

  // ── Session actions ────────────────────────────────────────────────────
  // Shared tail of every clear variant: drop any idempotency keys cached by
  // hostBridge (so a fresh session starting with the same client_op_id values
  // doesn't return stale host results), then persist + re-render.
  function finishClear () {
    if (window.HOST_BRIDGE && typeof window.HOST_BRIDGE.clearIdempotencyCache === 'function') {
      try { window.HOST_BRIDGE.clearIdempotencyCache() } catch (_) {}
    }
    persistState()
    renderTranscript()
  }

  // Guard shared by both clear variants: a running agent loop writes into the
  // session it started with, so clearing mid-request would resurrect messages.
  function clearBlockedByRequest () {
    if (!state.isRequestInFlight) return false
    setStatus('Finish or stop the current request before clearing.')
    return true
  }

  // Clear THIS chat only (left-click on Clear).
  function handleClearSession () {
    var session = getActiveSession()
    if (!session) return
    if (clearBlockedByRequest()) return
    if (!confirm('Clear all messages in "' + session.title + '"? Other chats are not affected. This cannot be undone.')) return
    session.messages = []
    session.updatedAt = Date.now()
    finishClear()
    setStatus('Chat "' + session.title + '" cleared')
  }

  // Full clear: delete ALL chats and start over with one fresh chat
  // (right-click on Clear).
  function handleClearAllSessions () {
    if (clearBlockedByRequest()) return
    var n = state.sessions.length
    if (!confirm('Delete ALL ' + n + ' chat(s) and all their messages? This cannot be undone.')) return
    state.sessions = []
    state.activeSessionId = null
    ensureSession()
    finishClear()
    renderModelSelector()
    renderSessionBar()
    setStatus('All chats deleted')
  }

  // Manually shrink the model's INPUT context without deleting any message the
  // user can see. We truncate the RESULT payloads of old tool calls (outside the
  // protected recent tail) down to a short stub. The tool-call cards stay in the
  // transcript so the user still sees WHAT ran — only the verbose result body the
  // model re-reads every turn is collapsed. This is the on-demand version of the
  // automatic pruning, giving the user direct control over cost.
  function handleCompactContext () {
    var session = getActiveSession()
    if (!session || state.isRequestInFlight) return
    var msgs = session.messages || []
    var PROTECT = (window.PURE_PRUNE && window.PURE_PRUNE.PROTECT_RECENT) || 20
    var CAP = (window.PURE_PRUNE && window.PURE_PRUNE.TOOL_RESULT_CAP) || 400
    var before = estimateSessionContextTokens()
    var protectFrom = Math.max(0, msgs.length - PROTECT)
    var trimmed = 0
    for (var i = 0; i < protectFrom; i++) {
      var m = msgs[i]
      if (m.role !== 'assistant' || !m.toolCalls) continue
      for (var t = 0; t < m.toolCalls.length; t++) {
        var tc = m.toolCalls[t]
        if (tc._compacted) continue
        var s = JSON.stringify(tc.result || {})
        if (s.length > CAP) {
          tc.result = { ok: (tc.result && tc.result.ok) !== false, _compacted: true, note: 'result collapsed to save context (' + s.length + ' chars)' }
          tc._compacted = true
          trimmed++
        }
      }
    }
    persistState()
    renderTranscript()
    var after = estimateSessionContextTokens()
    if (trimmed === 0) {
      setStatus('Context already compact — nothing older than the protected tail to collapse.')
    } else {
      setStatus('Compacted ' + trimmed + ' old tool results · context ~' + before.toLocaleString() + ' → ~' + after.toLocaleString() + ' tokens')
    }
  }

  // Resolve a writable output directory for exports/reports. Prefers the user's
  // Desktop but GUARANTEES the directory exists before callers write into it.
  // On machines where ~/Desktop is absent (Windows OneDrive desktop redirection,
  // localized folder names, headless/CI), writing straight to ~/Desktop throws
  // ENOENT and the whole export crashes; here we create it (or fall back to the
  // home dir) so a write never fails for a missing directory.
  function resolveOutputDir () {
    var os = require('os')
    var fs = require('fs')
    var path = require('path')
    var home = os.homedir()
    var desktop = path.join(home, 'Desktop')
    try {
      fs.mkdirSync(desktop, { recursive: true })
      return desktop
    } catch (e) {
      return home
    }
  }

  function handleExportSessions () {
    try {
      var fs = require('fs')
      var path = require('path')
      var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      var filename = 'ae-agent-session-' + ts + '.json'
      var outDir = resolveOutputDir()
      var outPath = path.join(outDir, filename)
      var data = {
        exportedAt: new Date().toISOString(),
        activeSessionId: state.activeSessionId,
        sessions: state.sessions
      }
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8')
      setStatus('Exported to ~/Desktop/' + filename)
      alert('Session exported to:\n' + outPath)
    } catch (e) {
      console.error('Export error:', e)
      alert('Export failed: ' + (e.message || String(e)))
    }
  }

  function handleExportErrors () {
    try {
      var fs = require('fs')
      var path = require('path')
      var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      var filename = 'ae-agent-errors-' + ts + '.json'
      var outDir = resolveOutputDir()
      var outPath = path.join(outDir, filename)

      var errorEntries = []
      var sessions = state.sessions
      for (var si = 0; si < sessions.length; si++) {
        var session = sessions[si]
        var msgs = session.messages || []
        for (var mi = 0; mi < msgs.length; mi++) {
          var msg = msgs[mi]
          if (msg.role !== 'assistant' || !msg.toolCalls) continue
          var failedCalls = []
          for (var ti = 0; ti < msg.toolCalls.length; ti++) {
            var tc = msg.toolCalls[ti]
            var res = tc.result || {}
            if (tc.status === 'error' || res.ok === false || res.expressionError) {
              failedCalls.push({
                tool: tc.name,
                args: tc.args,
                status: tc.status,
                error: res.message || res.expressionError || 'unknown error'
              })
            }
          }
          if (failedCalls.length === 0) continue
          var userText = ''
          for (var ui = mi - 1; ui >= 0; ui--) {
            if (msgs[ui].role === 'user') { userText = msgs[ui].text; break }
          }
          errorEntries.push({
            session: session.title,
            userRequest: userText,
            failedTools: failedCalls,
            agentResponse: msg.text || ''
          })
        }
      }

      if (errorEntries.length === 0) {
        setStatus('No errors found in session')
        alert('No errors found \u2014 nothing to export.')
        return
      }

      var data = {
        exportedAt: new Date().toISOString(),
        totalErrors: errorEntries.length,
        errors: errorEntries
      }
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8')
      setStatus('Exported ' + errorEntries.length + ' error(s) to ~/Desktop/' + filename)
      alert('Exported ' + errorEntries.length + ' error(s) to:\n' + outPath)
    } catch (e) {
      console.error('Export errors:', e)
      alert('Export failed: ' + (e.message || String(e)))
    }
  }

  // ── Report generation ────────────────────────────────────────────────
  var REPORT_CHUNK_CHARS = 24000
  var REPORT_SYSTEM_PROMPT = [
    'You are a QA analyst reviewing session logs from an Adobe After Effects AI agent panel (AE Motion Agent).',
    'The panel has ' +
      ((window.AGENT_TOOL_REGISTRY && window.AGENT_TOOL_REGISTRY.tools) ? window.AGENT_TOOL_REGISTRY.tools.length : 'dozens of') +
      ' tools that create/modify layers, shapes, keyframes, expressions, effects, masks, markers, 3D, camera, light, import files, capture frames.',
    '',
    'Analyze the provided session log chunk and produce a structured report in this EXACT format:',
    '',
    '## Errors & Failures',
    'For each error found:',
    '- **Tool**: tool_name | **Status**: error/expression_error | **Args**: brief summary of args',
    '- **Error message**: the actual error text',
    '- **Context**: what the user asked / what the agent was trying to do',
    '- **Probable cause**: your analysis of why it failed',
    '- **Fix suggestion**: specific technical suggestion for the developer',
    '',
    '## Warnings',
    '- Expression validation warnings, retries that eventually succeeded, suspicious patterns',
    '',
    '## Working Features',
    '- Brief list of tools/features that worked correctly in this chunk',
    '',
    '## Patterns & Observations',
    '- Recurring issues, model behavior problems, prompt issues, UX friction',
    '',
    'Be concise but technically precise. Include tool names, property paths, error messages verbatim.',
    'If the chunk has no errors, still list what worked.',
    'Write in English for developer consumption. Do not add preamble or conclusions beyond the sections above.'
  ].join('\n')

  /**
   * Aggregate per-tool latency and error rate from a session's tool calls.
   * Used in the Report (#9) so the LLM analyzing the session sees not just
   * what happened but also which tools were slow or unreliable.
   */
  function computeToolStats (session) {
    var byTool = {}
    var msgs = session.messages || []
    for (var i = 0; i < msgs.length; i++) {
      var calls = msgs[i].toolCalls || []
      for (var c = 0; c < calls.length; c++) {
        var tc = calls[c]
        var name = tc.name || 'unknown'
        var bucket = byTool[name] || (byTool[name] = { count: 0, errors: 0, latencies: [] })
        bucket.count++
        if (tc.status === 'error' || (tc.result && tc.result.ok === false)) bucket.errors++
        if (tc.startTime && tc.endTime && tc.endTime > tc.startTime) {
          bucket.latencies.push(tc.endTime - tc.startTime)
        }
      }
    }
    var rows = []
    for (var n in byTool) {
      if (!byTool.hasOwnProperty(n)) continue
      var b = byTool[n]
      var min = null, max = null, sum = 0
      for (var k = 0; k < b.latencies.length; k++) {
        var v = b.latencies[k]
        if (min === null || v < min) min = v
        if (max === null || v > max) max = v
        sum += v
      }
      var avg = b.latencies.length > 0 ? Math.round(sum / b.latencies.length) : null
      rows.push({
        name: n,
        count: b.count,
        errors: b.errors,
        errorRate: b.count > 0 ? Math.round(100 * b.errors / b.count) : 0,
        avgMs: avg,
        minMs: min,
        maxMs: max
      })
    }
    rows.sort(function (a, b) { return b.count - a.count })
    return rows
  }

  function formatToolStatsTable (rows) {
    if (!rows.length) return ''
    var lines = []
    lines.push('| Tool | Calls | Errors | Err% | Avg ms | Min ms | Max ms |')
    lines.push('|---|---:|---:|---:|---:|---:|---:|')
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i]
      lines.push('| ' + r.name + ' | ' + r.count + ' | ' + r.errors + ' | ' + r.errorRate + '% | ' +
        (r.avgMs !== null ? r.avgMs : '—') + ' | ' +
        (r.minMs !== null ? r.minMs : '—') + ' | ' +
        (r.maxMs !== null ? r.maxMs : '—') + ' |')
    }
    return lines.join('\n')
  }

  function serializeSessionForReport (session) {
    var lines = []
    lines.push('=== Session: ' + session.title + ' (model: ' + (session.model || 'unknown') + ') ===')
    var stats = computeToolStats(session)
    if (stats.length > 0) {
      lines.push('')
      lines.push('=== Tool performance (per-tool counts, error rate, latency) ===')
      lines.push(formatToolStatsTable(stats))
      lines.push('')
    }
    var msgs = session.messages || []
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i]
      var textContent = m.text || m.content || ''
      if (m.role === 'user') {
        var userStr = typeof textContent === 'string' ? textContent : JSON.stringify(textContent)
        lines.push('\n[USER] ' + (userStr || '').substring(0, 500))
      } else if (m.role === 'assistant') {
        var calls = m.toolCalls || m.tool_calls || []
        if (calls.length > 0) {
          for (var tc = 0; tc < calls.length; tc++) {
            var call = calls[tc]
            var toolName = call.name || (call.function ? call.function.name : 'unknown')
            var toolArgs = call.args ? JSON.stringify(call.args) : (call.function ? (call.function.arguments || '{}') : '{}')
            var toolResult = call.result ? JSON.stringify(call.result) : ''
            var isErr = call.status === 'error' || (toolResult.indexOf('"ok":false') !== -1)
            lines.push('[TOOL_CALL] ' + toolName + ' | args: ' + (toolArgs || '{}').substring(0, 300))
            if (toolResult) {
              lines.push('[TOOL_RESULT] ' + (isErr ? toolResult.substring(0, 1000) : toolResult.substring(0, 400)))
            }
          }
        }
        var assistStr = typeof textContent === 'string' ? textContent : JSON.stringify(textContent)
        if (assistStr) {
          lines.push('[ASSISTANT] ' + assistStr.substring(0, 800))
        }
      } else if (m.role === 'tool') {
        var resultStr = typeof textContent === 'string' ? textContent : JSON.stringify(textContent)
        var isError = resultStr.indexOf('"ok":false') !== -1 || resultStr.indexOf('"ok": false') !== -1 || resultStr.indexOf('expressionError') !== -1
        lines.push('[TOOL_RESULT] ' + (isError ? resultStr.substring(0, 1000) : resultStr.substring(0, 400)))
      } else if (m.role === 'system') {
        lines.push('[SYSTEM] ' + (typeof textContent === 'string' ? textContent : JSON.stringify(textContent)).substring(0, 300))
      }
    }
    return lines.join('\n')
  }

  function splitIntoChunks (text, maxChars) {
    var chunks = []
    var lines = text.split('\n')
    var current = ''
    for (var i = 0; i < lines.length; i++) {
      if (current.length + lines[i].length + 1 > maxChars && current.length > 0) {
        chunks.push(current)
        current = ''
      }
      current += (current ? '\n' : '') + lines[i]
    }
    if (current) chunks.push(current)
    return chunks
  }

  function handleGenerateReport () {
    if (!window.CHAT_PROVIDER || typeof window.CHAT_PROVIDER.invoke !== 'function') {
      alert('Chat provider not available.')
      return
    }
    var activeSession = getActiveSession()
    if (!activeSession || !activeSession.messages || activeSession.messages.length === 0) {
      alert('No session data to analyze.')
      return
    }

    var allText = serializeSessionForReport(activeSession) + '\n\n'

    if (allText.trim().length < 50) {
      alert('Session is empty, nothing to analyze.')
      return
    }

    var chunks = splitIntoChunks(allText, REPORT_CHUNK_CHARS)
    var totalChunks = chunks.length

    setStatus('Generating report... (0/' + totalChunks + ' chunks)')
    if (els.reportBtn) els.reportBtn.disabled = true

    // Show progress in chat
    var session = activeSession
    session.messages.push({ role: 'system', text: '\uD83D\uDCCA Report: analyzing ' + totalChunks + ' chunk(s)...' })
    renderTranscript()

    var modelId = normalizeModelId(session.model)
    var chunkReports = []

    function processChunk (idx) {
      if (idx >= totalChunks) {
        return finalizeReport(chunkReports)
      }
      setStatus('Generating report... (' + (idx + 1) + '/' + totalChunks + ' chunks)')
      if (totalChunks > 1) {
        session.messages.push({ role: 'system', text: '\uD83D\uDCCA Report: processing chunk ' + (idx + 1) + '/' + totalChunks + '...' })
        renderTranscript()
      }

      var userContent = 'Session log chunk ' + (idx + 1) + '/' + totalChunks + ':\n\n' + chunks[idx]
      var messages = [
        { role: 'system', content: REPORT_SYSTEM_PROMPT },
        { role: 'user', content: userContent }
      ]

      return window.CHAT_PROVIDER.invoke(modelId, messages, {
        max_tokens: 4096,
        temperature: 0.2,
        // Report is summarization, not problem-solving — disable reasoning
        // for a ~3-4x faster response (probe 2026-06-10: completion 98→2
        // tokens of overhead). Only chat_template_kwargs works on Cloud.ru.
        chat_template_kwargs: { enable_thinking: false }
      }).then(function (response) {
        var content = ''
        if (response.choices && response.choices[0] && response.choices[0].message) {
          content = response.choices[0].message.content || ''
        }
        chunkReports.push({ chunkIndex: idx + 1, report: content })
        return processChunk(idx + 1)
      }).catch(function (err) {
        chunkReports.push({ chunkIndex: idx + 1, report: '[ERROR generating report for this chunk: ' + (err.message || String(err)) + ']' })
        return processChunk(idx + 1)
      })
    }

    function finalizeReport (reports) {
      try {
        var fs = require('fs')
        var path = require('path')
        var ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        var outDir = resolveOutputDir()

        var md = []
        md.push('# AE Motion Agent \u2014 Session Analysis Report')
        md.push('')
        md.push('Generated: ' + new Date().toISOString())
        md.push('Chunks processed: ' + reports.length)
        md.push('')
        md.push('---')
        md.push('')

        for (var ri = 0; ri < reports.length; ri++) {
          if (reports.length > 1) {
            md.push('# Chunk ' + reports[ri].chunkIndex + '/' + totalChunks)
            md.push('')
          }
          md.push(reports[ri].report)
          md.push('')
          if (ri < reports.length - 1) {
            md.push('---')
            md.push('')
          }
        }

        var reportFilename = 'ae-agent-report-' + ts + '.md'
        var reportPath = path.join(outDir, reportFilename)
        fs.writeFileSync(reportPath, md.join('\n'), 'utf8')

        var rawFilename = 'ae-agent-raw-log-' + ts + '.json'
        var rawPath = path.join(outDir, rawFilename)
        var rawData = {
          exportedAt: new Date().toISOString(),
          session: session
        }
        fs.writeFileSync(rawPath, JSON.stringify(rawData, null, 2), 'utf8')

        setStatus('Report saved to Desktop')
        if (els.reportBtn) els.reportBtn.disabled = false
        session.messages.push({ role: 'system', text: '\u2705 Report saved to ~/Desktop/' + reportFilename })
        renderTranscript()
        persistState()
        alert('Report saved:\n' + reportPath + '\n\nRaw log:\n' + rawPath)
      } catch (e) {
        console.error('Report save error:', e)
        if (els.reportBtn) els.reportBtn.disabled = false
        alert('Report save failed: ' + (e.message || String(e)))
      }
    }

    processChunk(0)
  }

  function refreshActiveCompNote (silent) {
    if (!els.activeCompNote) return
    // .warn turns the note amber when no comp is active — the agent's
    // mutating tools will fail in that state, so make it visually obvious.
    function setNote (text, warn) {
      els.activeCompNote.textContent = text
      els.activeCompNote.classList.toggle('warn', !!warn)
    }
    if (!window.HOST_BRIDGE || typeof window.HOST_BRIDGE.evalHostFunction !== 'function') {
      setNote('Active comp: unavailable.', true)
      return
    }
    return window.HOST_BRIDGE.evalHostFunction('extensionsLlmChat_getActiveCompNote()')
      .then(function (ctx) {
        if (ctx && ctx.ok && ctx.compName) {
          setNote('Active composition: "' + ctx.compName + '". Changes are applied to this composition.', false)
          return
        }
        var msg = (ctx && ctx.message) ? ctx.message : 'No active composition.'
        setNote('Active composition: unavailable. ' + msg, true)
      })
      .catch(function (err) {
        setNote('Active composition: unavailable.', true)
        if (!silent) setStatus('Active comp note unavailable: ' + (err.message || String(err)))
      })
  }

  // ── Event binding ──────────────────────────────────────────────────────
  function bindEvents () {
    // Footer buttons
    if (els.clearSessionBtn) {
      els.clearSessionBtn.addEventListener('click', handleClearSession)
      // Right-click = full clear (all chats), mirroring quick-action buttons
      // where contextmenu is the "manage" gesture.
      els.clearSessionBtn.addEventListener('contextmenu', function (e) {
        e.preventDefault()
        handleClearAllSessions()
      })
    }
    if (els.exportSessionsBtn) els.exportSessionsBtn.addEventListener('click', handleExportSessions)
    if (els.exportErrorsBtn) els.exportErrorsBtn.addEventListener('click', handleExportErrors)
    if (els.reportBtn) els.reportBtn.addEventListener('click', handleGenerateReport)
    if (els.undoBtn) els.undoBtn.addEventListener('click', handleUndo)
    if (els.providerBadge) els.providerBadge.addEventListener('click', probeModelAvailability)
    if (els.subtitlesBtn) els.subtitlesBtn.addEventListener('click', function () { runSubtitlesTask(false) })
    if (els.subtitlesRebuildBtn) els.subtitlesRebuildBtn.addEventListener('click', function () { runSubtitlesTask(true) })
    if (els.transcriptSaveBtn) els.transcriptSaveBtn.addEventListener('click', handleTranscriptSave)
    if (els.transcriptLoadBtn) els.transcriptLoadBtn.addEventListener('click', handleTranscriptLoad)
    if (els.contextMeter) els.contextMeter.addEventListener('click', handleCompactContext)

    // Subtitles studio
    if (els.subtitlesOpenBtn) els.subtitlesOpenBtn.addEventListener('click', toggleSubtitlesPanel)
    if (els.subtitlesCloseBtn) els.subtitlesCloseBtn.addEventListener('click', closeSubtitlesPanel)
    if (els.subtitlesStyle) {
      els.subtitlesStyle.addEventListener('change', function () {
        refreshSubtitleStyleUI()
        saveSubtitleSettings()
      })
    }
    if (els.subtitlesFont) {
      els.subtitlesFont.addEventListener('change', function () {
        refreshFontStyles(null) // new family → keep Regular, styles differ per family
        saveSubtitleSettings()
      })
    }
    var studioInputs = [els.subtitlesLang, els.subtitlesFontStyle, els.subtitlesFontSize,
      els.subtitlesColor, els.subtitlesPlateColor, els.subtitlesSpokenColor]
    for (var si = 0; si < studioInputs.length; si++) {
      if (!studioInputs[si]) continue
      studioInputs[si].addEventListener('input', function () {
        refreshColorSwatches()
        saveSubtitleSettings()
      })
      studioInputs[si].addEventListener('change', function () {
        refreshColorSwatches()
        saveSubtitleSettings()
      })
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && els.subtitlesPanel && els.subtitlesPanel.style.display !== 'none') {
        closeSubtitlesPanel()
      }
    })

    // Chat switcher
    if (els.sessionSelect) {
      els.sessionSelect.addEventListener('change', function () {
        switchSession(this.value)
      })
    }
    if (els.sessionNewBtn) els.sessionNewBtn.addEventListener('click', handleNewSession)
    if (els.sessionRenameBtn) els.sessionRenameBtn.addEventListener('click', handleRenameSession)
    if (els.sessionDeleteBtn) els.sessionDeleteBtn.addEventListener('click', handleDeleteSession)

    // Model selector (event delegation — buttons are re-rendered on switch).
    if (els.modelSelector) {
      els.modelSelector.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.model-btn') : null
        if (!btn) return
        var id = btn.getAttribute('data-model-id')
        if (id) selectModel(id)
      })
    }

    // Chat buttons
    if (els.sendBtn) els.sendBtn.addEventListener('click', handleSend)
    if (els.cancelBtn) els.cancelBtn.addEventListener('click', function () {
      if (state.currentAbortHandle) {
        state.currentAbortHandle.aborted = true
        if (typeof state.currentAbortHandle.abort === 'function') {
          try { state.currentAbortHandle.abort() } catch (_) {}
        }
        setStatus('Cancelling...')
      }
    })

    // Enter to send (Shift+Enter for newline) + auto-resize.
    if (els.userInput) {
      els.userInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          handleSend()
        }
      })
      els.userInput.addEventListener('input', function () {
        this.style.height = 'auto'
        this.style.height = Math.min(this.scrollHeight, 120) + 'px'
        saveDraft()
      })
    }

    // Quick actions (event delegation — buttons are re-rendered on edit).
    var quickBox = document.getElementById('quick-actions')
    if (quickBox) {
      quickBox.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('.quick-action-btn') : null
        if (!btn) return
        if (btn.id === 'quick-action-add') { handleQuickActionAdd(); return }
        if (btn.id === 'quick-action-reset') { handleQuickActionReset(); return }
        var promptText = btn.getAttribute('data-prompt')
        if (promptText && els.userInput) {
          els.userInput.value = promptText
          handleSend()
        }
      })
      quickBox.addEventListener('contextmenu', function (e) {
        var btn = e.target.closest ? e.target.closest('.quick-action-btn') : null
        if (!btn) return
        var id = btn.getAttribute('data-qa-id')
        if (!id) return
        e.preventDefault()
        handleQuickActionEdit(id)
      })
    }

    // Persist on page unload (flush the draft synchronously — the debounce
    // timer dies with the page).
    function persistOnUnload () {
      persistState()
      try {
        var v = els.userInput ? els.userInput.value : ''
        if (v) localStorage.setItem(DRAFT_KEY, v)
        else localStorage.removeItem(DRAFT_KEY)
      } catch (_) {}
    }
    window.addEventListener('beforeunload', persistOnUnload)
    window.addEventListener('pagehide', persistOnUnload)
    window.addEventListener('focus', function () { refreshActiveCompNote(true) })
  }

  // ── Host theme sync (AppSkinInfo) ──────────────────────────────────────
  // Follow AE's brightness slider like native panels do: derive the token
  // palette from the host's panel background and re-derive on the CEP
  // ThemeColorChanged event. Outside CEP (plain browser) this is a no-op —
  // the :root defaults in styles.css stay in effect.
  function applyHostTheme (skinInfo) {
    if (!window.PURE_THEME) return
    var bg = window.PURE_THEME.backgroundFromSkinInfo(skinInfo)
    if (!bg) return
    var palette = window.PURE_THEME.derivePalette(bg)
    var rootStyle = document.documentElement.style
    for (var k in palette.vars) {
      if (Object.prototype.hasOwnProperty.call(palette.vars, k)) {
        rootStyle.setProperty(k, palette.vars[k])
      }
    }
  }

  function initHostThemeSync () {
    if (typeof CSInterface === 'undefined') return
    try {
      var cs = new CSInterface()
      var env = cs.getHostEnvironment()
      if (env && env.appSkinInfo) applyHostTheme(env.appSkinInfo)
      cs.addEventListener(CSInterface.THEME_COLOR_CHANGED_EVENT, function () {
        // Event payload lacks the skin info in some CEP versions — re-query.
        try {
          var fresh = cs.getHostEnvironment()
          if (fresh && fresh.appSkinInfo) applyHostTheme(fresh.appSkinInfo)
        } catch (_) {}
      })
    } catch (e) {
      console.warn('Host theme sync unavailable:', e)
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────
  function init () {
    initHostThemeSync()
    cacheDomRefs()
    loadState()
    recoverPendingRun()
    restoreDraft()

    // Ensure at least one chat exists and render the switcher.
    ensureSession()
    renderTranscript()
    renderModelSelector()
    renderSessionBar()
    renderQuickActions()

    bindEvents()
    initVisionCheckToggle()
    loadSubtitleSettings()
    setStatus('Ready')
    updateUndoButton()
    refreshActiveCompNote(true)
    checkHostCapabilities()

    // Check Cloud.ru connectivity.
    var secrets = (window.EXTENSIONS_LLM_CHAT_SECRETS) || {}
    var cfg = (window.EXTENSIONS_LLM_CHAT_CONFIG) || {}
    var apiKey = secrets.apiKey || cfg.apiKey || ''
    var initSession = getActiveSession()
    var modelLabel = getModelLabel(initSession ? initSession.model : DEFAULT_MODEL)
    if (apiKey) {
      setModelStatus('ok', modelLabel)
      probeModelAvailability()
    } else {
      setModelStatus('unknown', modelLabel + ' (no API key)')
    }
  }

  /**
   * Capability handshake (#10): probe the host script for required helpers
   * so a stale/incomplete `host/index.jsx` is surfaced before the user hits
   * a cryptic "Function ... is undefined" error mid-session.
   */
  function checkHostCapabilities () {
    if (!window.HOST_BRIDGE || typeof window.HOST_BRIDGE.evalHostFunction !== 'function') return
    try {
      window.HOST_BRIDGE.evalHostFunction('extensionsLlmChat_getCapabilities()')
        .then(function (caps) {
          if (!caps || caps.ok === false) {
            var msg = 'Host capability probe failed: ' + ((caps && caps.message) || 'unknown')
            setStatus(msg)
            if (typeof console !== 'undefined') console.warn('[host]', msg)
            return
          }
          var helpers = caps.helpers || {}
          var missing = []
          for (var name in helpers) {
            if (helpers.hasOwnProperty(name) && !helpers[name]) missing.push(name)
          }
          if (missing.length > 0) {
            var warn = 'Host script outdated — missing: ' + missing.join(', ') + '. Reload the panel.'
            setStatus(warn)
            setModelStatus('error', 'host: outdated')
            if (typeof console !== 'undefined') console.warn('[host]', warn)
          } else if (typeof console !== 'undefined') {
            console.log('[host] capabilities OK — version ' + (caps.version || 'unknown'))
          }
        })
        .catch(function (err) {
          var msg = 'Host capability probe error: ' + ((err && err.message) || String(err))
          if (typeof console !== 'undefined') console.warn('[host]', msg)
          // Don't surface to status line — the probe is best-effort, and a
          // failure here doesn't block normal usage. Tools that actually
          // need a missing helper will fail with their own errors.
        })
    } catch (e) {
      if (typeof console !== 'undefined') console.warn('[host] capability probe threw', e)
    }
  }

  // Export expression validation for agent tool loop
  if (typeof window !== 'undefined') {
    window.validateExpression = validateExpression
  }

  // Boot.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
