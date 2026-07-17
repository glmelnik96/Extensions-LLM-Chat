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
    session: null,           // single session object
    isRequestInFlight: false,
    currentAbortHandle: null,
    lastMutatingToolCount: 0,
    lastModelStatus: { status: 'unknown', label: 'model: unknown' }
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
    els.visionCheckToggle = document.getElementById('vision-check-toggle')
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
    return {
      session: state.session ? {
        id: state.session.id,
        title: state.session.title,
        createdAt: state.session.createdAt,
        updatedAt: state.session.updatedAt,
        model: state.session.model,
        totalTokens: state.session.totalTokens || 0,
        promptTokens: state.session.promptTokens || 0,
        completionTokens: state.session.completionTokens || 0,
        costRub: state.session.costRub || 0,
        messages: state.session.messages
      } : null
    }
  }

  function persistState () {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buildPersistData()))
      return
    } catch (e) {
      if (!isQuotaError(e) || !state.session || !state.session.messages || state.session.messages.length <= 2) {
        console.warn('persistState error:', e)
        return
      }
    }
    // Quota exceeded: drop the oldest half of the messages (keeping the most
    // recent context) and retry once so the session isn't silently lost.
    var msgs = state.session.messages
    var dropCount = Math.floor(msgs.length / 2)
    state.session.messages = msgs.slice(dropCount)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buildPersistData()))
      setStatus('Session storage full — dropped ' + dropCount + ' oldest message(s) to save.')
    } catch (e2) {
      console.warn('persistState retry failed after pruning:', e2)
      setStatus('Session too large to save — recent changes may not persist.')
    }
  }

  function loadState () {
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      var data = JSON.parse(raw)
      if (data.session) {
        state.session = data.session
        state.session.model = normalizeModelId(state.session.model)
      }
    } catch (e) {
      console.warn('loadState error:', e)
    }
  }

  // ── Session management (single session) ────────────────────────────────
  function ensureSession () {
    if (state.session) return state.session
    var id = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)
    state.session = {
      id: id,
      title: 'Session',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: DEFAULT_MODEL,
      totalTokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      costRub: 0,
      messages: []
    }
    persistState()
    renderTranscript()
    return state.session
  }

  // ── Render: welcome hint (empty session) ──────────────────────────────
  var WELCOME_CAPABILITIES = [
    'Выражения — написать, починить, объяснить; линковка свойств (pick-whip); библиотека из 28 проверенных сниппетов',
    'Анимация — кейфреймы с изингом, batch-операции по нескольким свойствам',
    'Слои и контент — шейпы, текст, маски, solid/null/adjustment, порядок и парентинг',
    'Эффекты — поиск установленных, добавление с переименованием, настройка параметров',
    '3D — камера, свет, глубина, depth of field',
    'Превью кадра — по запросу (capture/preview)'
  ]

  var WELCOME_EXAMPLES = [
    'Сделай счётчик от 0 до 100 за 2 секунды с easing',
    'Привяжи Opacity текста к Scale шейп-слоя',
    'Добавь wiggle к позиции выделенного слоя и объясни параметры',
    'Текст появляется слева с fade-in и overshoot'
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

  // ── Render: chat transcript ────────────────────────────────────────────
  function renderTranscript () {
    if (!els.chatTranscript) return
    updateContextMeter()
    els.chatTranscript.innerHTML = ''
    var session = state.session
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
    if (!state.session || !window.PURE_PRUNE) return 0
    var msgs = state.session.messages || []
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
    var active = normalizeModelId(state.session ? state.session.model : DEFAULT_MODEL)
    els.modelSelector.innerHTML = ''
    for (var i = 0; i < AVAILABLE_MODELS.length; i++) {
      var m = AVAILABLE_MODELS[i]
      var btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'model-btn' + (m.id === active ? ' model-btn-active' : '')
      btn.textContent = m.label
      btn.setAttribute('data-model-id', m.id)
      btn.setAttribute('title', m.id)
      els.modelSelector.appendChild(btn)
    }
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
    els.userInput.value = ''
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
    }).then(function () {
      state.isRequestInFlight = false
      state.currentAbortHandle = null
      if (els.sendBtn) els.sendBtn.disabled = false
      if (els.cancelBtn) els.cancelBtn.style.display = 'none'
      refreshActiveCompNote(true)
    })
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
  function handleClearSession () {
    if (!state.session) return
    if (!confirm('Clear all messages? This cannot be undone.')) return
    state.session.messages = []
    state.session.updatedAt = Date.now()
    // Drop any idempotency keys cached by hostBridge so a fresh session
    // starting with the same client_op_id values doesn't return stale
    // host results from the previous run.
    if (window.HOST_BRIDGE && typeof window.HOST_BRIDGE.clearIdempotencyCache === 'function') {
      try { window.HOST_BRIDGE.clearIdempotencyCache() } catch (_) {}
    }
    persistState()
    renderTranscript()
  }

  // Manually shrink the model's INPUT context without deleting any message the
  // user can see. We truncate the RESULT payloads of old tool calls (outside the
  // protected recent tail) down to a short stub. The tool-call cards stay in the
  // transcript so the user still sees WHAT ran — only the verbose result body the
  // model re-reads every turn is collapsed. This is the on-demand version of the
  // automatic pruning, giving the user direct control over cost.
  function handleCompactContext () {
    if (!state.session || state.isRequestInFlight) return
    var msgs = state.session.messages || []
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
        session: state.session
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
      // Work with single session (wrap in array for consistent logic)
      var sessions = state.session ? [state.session] : []
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
    if (!state.session || !state.session.messages || state.session.messages.length === 0) {
      alert('No session data to analyze.')
      return
    }

    var allText = serializeSessionForReport(state.session) + '\n\n'

    if (allText.trim().length < 50) {
      alert('Session is empty, nothing to analyze.')
      return
    }

    var chunks = splitIntoChunks(allText, REPORT_CHUNK_CHARS)
    var totalChunks = chunks.length

    setStatus('Generating report... (0/' + totalChunks + ' chunks)')
    if (els.reportBtn) els.reportBtn.disabled = true

    // Show progress in chat
    var session = state.session
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
          session: state.session
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
    if (els.clearSessionBtn) els.clearSessionBtn.addEventListener('click', handleClearSession)
    if (els.exportSessionsBtn) els.exportSessionsBtn.addEventListener('click', handleExportSessions)
    if (els.exportErrorsBtn) els.exportErrorsBtn.addEventListener('click', handleExportErrors)
    if (els.reportBtn) els.reportBtn.addEventListener('click', handleGenerateReport)
    if (els.undoBtn) els.undoBtn.addEventListener('click', handleUndo)
    if (els.contextMeter) els.contextMeter.addEventListener('click', handleCompactContext)

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
      })
    }

    // Quick actions
    var quickBtns = document.querySelectorAll('.quick-action-btn')
    for (var qi = 0; qi < quickBtns.length; qi++) {
      quickBtns[qi].addEventListener('click', function () {
        var prompt = this.getAttribute('data-prompt')
        if (prompt && els.userInput) {
          els.userInput.value = prompt
          handleSend()
        }
      })
    }

    // Persist on page unload.
    window.addEventListener('beforeunload', persistState)
    window.addEventListener('pagehide', persistState)
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

    // Ensure single session exists
    ensureSession()
    state.session.model = normalizeModelId(state.session.model)
    renderTranscript()
    renderModelSelector()

    bindEvents()
    initVisionCheckToggle()
    setStatus('Ready')
    updateUndoButton()
    refreshActiveCompNote(true)
    checkHostCapabilities()

    // Check Cloud.ru connectivity.
    var secrets = (window.EXTENSIONS_LLM_CHAT_SECRETS) || {}
    var cfg = (window.EXTENSIONS_LLM_CHAT_CONFIG) || {}
    var apiKey = secrets.apiKey || cfg.apiKey || ''
    var modelLabel = getModelLabel(state.session ? state.session.model : DEFAULT_MODEL)
    if (apiKey) {
      setModelStatus('ok', modelLabel)
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
