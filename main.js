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
  var DEFAULT_MODEL = 'cloudru/Qwen/Qwen3-Coder-Next'
  var DEFAULT_AGENT_MAX_STEPS = 150

  // ── State ──────────────────────────────────────────────────────────────
  var state = {
    sessions: [],
    activeSessionId: null,
    nextSessionIndex: 1,
    isRequestInFlight: false,
    isPresetInFlight: false,
    selectedPresetKey: 'fade_in',
    currentAbortHandle: null,
    lastMutatingToolCount: 0,
    lastModelStatus: { status: 'unknown', label: 'model: unknown' }
  }

  // ── DOM refs ───────────────────────────────────────────────────────────
  var els = {}

  function cacheDomRefs () {
    els.sessionList = document.getElementById('session-list')
    els.newSessionBtn = document.getElementById('new-session-btn')
    els.renameSessionBtn = document.getElementById('rename-session-btn')
    els.clearSessionBtn = document.getElementById('clear-session-btn')
    els.clearAllBtn = document.getElementById('clear-all-btn')
    els.chatTranscript = document.getElementById('chat-transcript')
    els.activeCompNote = document.getElementById('active-comp-note')
    els.userInput = document.getElementById('user-input')
    els.modelSelect = document.getElementById('model-select')
    els.sendBtn = document.getElementById('send-btn')
    els.undoBtn = document.getElementById('undo-btn')
    els.cancelBtn = document.getElementById('cancel-btn')
    els.presetDropdownBtn = document.getElementById('preset-dropdown-btn')
    els.presetDropdownMenu = document.getElementById('preset-dropdown-menu')
    els.presetDuration = document.getElementById('preset-duration')
    els.presetDelay = document.getElementById('preset-delay')
    els.presetStrength = document.getElementById('preset-strength')
    els.presetStrengthLabel = document.getElementById('preset-strength-label')
    els.applyPresetBtn = document.getElementById('apply-preset-btn')
    els.statusText = document.getElementById('status-text')
    els.modelStatus = document.getElementById('model-status')
  }

  var PRESET_LABELS = {
    fade_in: 'Fade In',
    fade_out: 'Fade Out',
    pop_in: 'Pop In',
    pop_out: 'Pop Out',
    slide_left: 'Slide Left',
    slide_right: 'Slide Right',
    slide_up: 'Slide Up',
    slide_down: 'Slide Down'
  }

  function closePresetDropdown () {
    if (els.presetDropdownMenu) els.presetDropdownMenu.style.display = 'none'
  }

  function openPresetDropdown () {
    if (els.presetDropdownMenu) els.presetDropdownMenu.style.display = ''
  }

  function togglePresetDropdown () {
    if (!els.presetDropdownMenu) return
    if (els.presetDropdownMenu.style.display === 'none') openPresetDropdown()
    else closePresetDropdown()
  }

  function updatePresetDropdownUi () {
    if (els.presetDropdownBtn) {
      els.presetDropdownBtn.textContent = PRESET_LABELS[state.selectedPresetKey] || 'Preset'
    }
    if (els.presetDropdownMenu) {
      var options = els.presetDropdownMenu.querySelectorAll('.preset-option-btn')
      for (var i = 0; i < options.length; i++) {
        var key = options[i].getAttribute('data-preset') || ''
        if (key === state.selectedPresetKey) options[i].classList.add('active')
        else options[i].classList.remove('active')
      }
    }
  }

  function updatePresetStrengthUi () {
    if (!els.presetStrength) return
    var key = String(state.selectedPresetKey || '')
    var isFade = key.indexOf('fade_') === 0
    var isPop = key.indexOf('pop_') === 0
    var isSlide = key.indexOf('slide_') === 0
    if (isFade) {
      els.presetStrength.disabled = true
      els.presetStrength.value = ''
      els.presetStrength.title = 'Not used for fade preset'
      if (els.presetStrengthLabel) els.presetStrengthLabel.textContent = 'Strength'
      return
    }
    els.presetStrength.disabled = false
    if (isPop) {
      if (!els.presetStrength.value) els.presetStrength.value = '1'
      els.presetStrength.title = 'Intensity (0.2..1.5) for pop preset'
      if (els.presetStrengthLabel) els.presetStrengthLabel.textContent = 'Intensity'
      return
    }
    if (isSlide) {
      if (!els.presetStrength.value) els.presetStrength.value = '120'
      els.presetStrength.title = 'Amplitude in px (8..2000) for slide preset'
      if (els.presetStrengthLabel) els.presetStrengthLabel.textContent = 'Amplitude (px)'
    }
  }

  function setPresetUiBusy (busy) {
    state.isPresetInFlight = !!busy
    if (busy) closePresetDropdown()
    if (els.applyPresetBtn) els.applyPresetBtn.disabled = !!busy
    if (els.presetDropdownBtn) els.presetDropdownBtn.disabled = !!busy
    if (els.presetDuration) els.presetDuration.disabled = !!busy
    if (els.presetDelay) els.presetDelay.disabled = !!busy
    if (els.presetStrength && !els.presetStrength.disabled) els.presetStrength.disabled = !!busy
    if (!busy) updatePresetStrengthUi()
  }

  function parsePresetNumberInput (el) {
    if (!el) return null
    var raw = String(el.value || '').trim()
    if (!raw.length) return null
    var n = parseFloat(raw)
    if (!isFinite(n)) return null
    return n
  }

  function buildPresetCallFromUi () {
    var key = String(state.selectedPresetKey || '')
    var duration = parsePresetNumberInput(els.presetDuration)
    var delay = parsePresetNumberInput(els.presetDelay)
    var strength = parsePresetNumberInput(els.presetStrength)
    var payload = {}
    if (duration !== null) payload.duration = duration
    if (delay !== null) payload.delay = delay

    if (key === 'fade_in') {
      payload.direction = 'in'
      return { toolName: 'apply_fade_preset', args: payload }
    }
    if (key === 'fade_out') {
      payload.direction = 'out'
      return { toolName: 'apply_fade_preset', args: payload }
    }
    if (key === 'pop_in') {
      payload.direction = 'in'
      if (strength !== null) payload.intensity = strength
      return { toolName: 'apply_pop_preset', args: payload }
    }
    if (key === 'pop_out') {
      payload.direction = 'out'
      if (strength !== null) payload.intensity = strength
      return { toolName: 'apply_pop_preset', args: payload }
    }
    if (key === 'slide_left') {
      payload.direction = 'left'
      if (strength !== null) payload.amplitude = strength
      return { toolName: 'apply_slide_preset', args: payload }
    }
    if (key === 'slide_right') {
      payload.direction = 'right'
      if (strength !== null) payload.amplitude = strength
      return { toolName: 'apply_slide_preset', args: payload }
    }
    if (key === 'slide_up') {
      payload.direction = 'up'
      if (strength !== null) payload.amplitude = strength
      return { toolName: 'apply_slide_preset', args: payload }
    }
    if (key === 'slide_down') {
      payload.direction = 'down'
      if (strength !== null) payload.amplitude = strength
      return { toolName: 'apply_slide_preset', args: payload }
    }
    return null
  }

  function pushSystemMessageToActiveSession (text) {
    var session = getActiveSession()
    if (!session) return
    session.messages.push({ role: 'system', text: text })
    session.updatedAt = Date.now()
    renderTranscript()
    persistState()
  }

  function handleApplyPresetFromUi () {
    if (state.isRequestInFlight || state.isPresetInFlight) {
      setStatus('Busy: wait for current operation to finish')
      return
    }
    if (!window.HOST_BRIDGE || typeof window.HOST_BRIDGE.executeToolCall !== 'function') {
      setStatus('Preset apply unavailable: host bridge not ready')
      return
    }

    var presetCall = buildPresetCallFromUi()
    if (!presetCall) {
      setStatus('Preset apply unavailable: invalid preset selection')
      return
    }

    setPresetUiBusy(true)
    setStatus('Applying preset...')

    window.HOST_BRIDGE.executeToolCall('get_host_context', {})
      .then(function (ctx) {
        var selected = (ctx && ctx.selectedLayers && ctx.selectedLayers.length) ? ctx.selectedLayers : []
        if (selected.length === 0) {
          throw new Error('Select at least one layer in the active composition.')
        }

        var applyQueue = Promise.resolve()
        var okCount = 0
        var errCount = 0
        var firstErr = null
        for (var i = 0; i < selected.length; i++) {
          (function (layerInfo) {
            applyQueue = applyQueue.then(function () {
              var args = {}
              for (var k in presetCall.args) args[k] = presetCall.args[k]
              if (typeof layerInfo.id === 'number') args.layer_id = layerInfo.id
              else args.layer_index = layerInfo.index
              return window.HOST_BRIDGE.executeToolCall(presetCall.toolName, args)
                .then(function (res) {
                  if (res && res.ok) okCount++
                  else {
                    errCount++
                    if (!firstErr) firstErr = (res && res.message) ? res.message : 'Unknown host error'
                  }
                })
                .catch(function (err) {
                  errCount++
                  if (!firstErr) firstErr = err.message || String(err)
                })
            })
          })(selected[i])
        }

        return applyQueue.then(function () {
          state.lastMutatingToolCount = okCount
          if (errCount === 0) {
            setStatus('Preset applied to ' + okCount + ' layer(s)')
            pushSystemMessageToActiveSession('Preset "' + presetCall.toolName + '" applied to ' + okCount + ' selected layer(s).')
          } else {
            setStatus('Preset applied with errors: ' + okCount + ' ok, ' + errCount + ' failed')
            pushSystemMessageToActiveSession('Preset "' + presetCall.toolName + '" finished: ' + okCount + ' ok, ' + errCount + ' failed. ' + (firstErr || ''))
          }
          return refreshActiveCompNote(true)
        })
      })
      .catch(function (err) {
        var msg = err && err.message ? err.message : String(err)
        setStatus('Preset apply failed: ' + msg)
        pushSystemMessageToActiveSession('Preset apply failed: ' + msg)
      })
      .then(function () {
        setPresetUiBusy(false)
      })
  }

  function normalizeModelId (modelId) {
    if (!modelId || typeof modelId !== 'string') return DEFAULT_MODEL
    // Local Ollama chat is intentionally disabled in this runtime.
    if (modelId.indexOf('ollama/') === 0) return DEFAULT_MODEL
    return modelId
  }

  function getAgentMaxSteps (cfg) {
    var raw = cfg && cfg.agentMaxSteps
    if (typeof raw !== 'number' || !isFinite(raw)) return DEFAULT_AGENT_MAX_STEPS
    var steps = Math.floor(raw)
    if (steps < 1) return 1
    return steps
  }

  // ── Persistence ────────────────────────────────────────────────────────
  function persistState () {
    try {
      var data = {
        sessions: state.sessions.map(function (s) {
          return {
            id: s.id,
            title: s.title,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            model: s.model,
            messages: s.messages
          }
        }),
        activeSessionId: state.activeSessionId,
        nextSessionIndex: state.nextSessionIndex
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch (e) {
      console.warn('persistState error:', e)
    }
  }

  function loadState () {
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      var data = JSON.parse(raw)
      if (data.sessions && data.sessions.length) {
        state.sessions = data.sessions.map(function (s) {
          var copy = {}
          for (var k in s) copy[k] = s[k]
          copy.model = normalizeModelId(copy.model)
          return copy
        })
        state.activeSessionId = data.activeSessionId || data.sessions[0].id
        state.nextSessionIndex = data.nextSessionIndex || data.sessions.length + 1
      }
    } catch (e) {
      console.warn('loadState error:', e)
    }
  }

  // ── Session management ─────────────────────────────────────────────────
  function createSession () {
    var id = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)
    var session = {
      id: id,
      title: 'Chat ' + state.nextSessionIndex,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      model: normalizeModelId((els.modelSelect && els.modelSelect.value) || DEFAULT_MODEL),
      messages: []
    }
    state.nextSessionIndex++
    state.sessions.unshift(session)
    state.activeSessionId = id
    persistState()
    renderSessions()
    renderTranscript()
    return session
  }

  function getActiveSession () {
    if (!state.activeSessionId && state.sessions.length) {
      state.activeSessionId = state.sessions[0].id
    }
    for (var i = 0; i < state.sessions.length; i++) {
      if (state.sessions[i].id === state.activeSessionId) return state.sessions[i]
    }
    return null
  }

  function setActiveSession (id) {
    state.activeSessionId = id
    var session = getActiveSession()
    if (session && els.modelSelect) {
      session.model = normalizeModelId(session.model)
      // Try to set the model select to the session's model.
      var opts = els.modelSelect.options
      var matched = false
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].value === session.model) {
          els.modelSelect.selectedIndex = i
          matched = true
          break
        }
      }
      if (!matched && opts.length > 0) {
        els.modelSelect.selectedIndex = 0
        session.model = normalizeModelId(opts[0].value)
      }
    }
    renderSessions()
    renderTranscript()
    persistState()
  }

  // ── Render: sessions sidebar ───────────────────────────────────────────
  function renderSessions () {
    if (!els.sessionList) return
    els.sessionList.innerHTML = ''
    for (var i = 0; i < state.sessions.length; i++) {
      var s = state.sessions[i]
      var li = document.createElement('li')
      li.className = 'session-item' + (s.id === state.activeSessionId ? ' active' : '')
      li.setAttribute('data-id', s.id)

      var titleSpan = document.createElement('span')
      titleSpan.className = 'session-title'
      titleSpan.textContent = s.title
      li.appendChild(titleSpan)

      var badge = document.createElement('span')
      badge.className = 'session-model-badge'
      badge.textContent = 'cloud'
      li.appendChild(badge)

      ;(function (sessionId) {
        li.addEventListener('click', function () { setActiveSession(sessionId) })
      })(s.id)

      els.sessionList.appendChild(li)
    }
  }

  // ── Render: chat transcript ────────────────────────────────────────────
  function renderTranscript () {
    if (!els.chatTranscript) return
    els.chatTranscript.innerHTML = ''
    var session = getActiveSession()
    if (!session) return

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
    scrollToBottom()
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
        // Show a concise version — message + key fields.
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

  function scrollToBottom () {
    if (els.chatTranscript) {
      els.chatTranscript.scrollTop = els.chatTranscript.scrollHeight
    }
  }

  // ── Thinking indicator ─────────────────────────────────────────────────
  var thinkingEl = null
  var thinkingToolCount = 0

  function showThinking () {
    if (thinkingEl) return
    thinkingToolCount = 0
    thinkingEl = document.createElement('div')
    thinkingEl.className = 'agent-thinking'
    thinkingEl.innerHTML = '<span>Agent working</span><span class="thinking-dots"><span></span><span></span><span></span></span>'
    els.chatTranscript.appendChild(thinkingEl)
    scrollToBottom()
  }

  function removeThinking () {
    if (thinkingEl && thinkingEl.parentNode) {
      thinkingEl.parentNode.removeChild(thinkingEl)
    }
    thinkingEl = null
  }

  function updateThinkingWithToolCall (tc) {
    if (!thinkingEl) return
    if (tc.status === 'running') thinkingToolCount++
    var statusText = tc.status === 'running' ? 'calling ' + tc.name + '...' : tc.name + ' ' + tc.status
    thinkingEl.querySelector('span').textContent = 'Agent [' + thinkingToolCount + ']: ' + statusText
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

  // ── Minimal markdown → HTML ─────────────────────────────────────────────
  /**
   * Convert a subset of markdown to HTML for rendering agent responses.
   * Supports: headers, bold, italic, inline code, code blocks, lists, paragraphs.
   */
  function renderMarkdown (text) {
    if (!text) return ''
    // Escape HTML entities.
    var s = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    // Code blocks (``` ... ```).
    s = s.replace(/```(\w*)\n([\s\S]*?)```/g, function (_, lang, code) {
      return '<pre class="md-code-block"><code>' + code.replace(/\n$/, '') + '</code></pre>'
    })

    // Inline code.
    s = s.replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')

    // Headers.
    s = s.replace(/^### (.+)$/gm, '<strong class="md-h3">$1</strong>')
    s = s.replace(/^## (.+)$/gm, '<strong class="md-h2">$1</strong>')
    s = s.replace(/^# (.+)$/gm, '<strong class="md-h1">$1</strong>')

    // Bold and italic.
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>')

    // Unordered list items.
    s = s.replace(/^- (.+)$/gm, '<li>$1</li>')
    // Wrap consecutive <li> in <ul>.
    s = s.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')

    // Numbered list items.
    s = s.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')

    // Line breaks for remaining lines (but not inside pre/ul).
    s = s.replace(/\n\n/g, '</p><p>')
    s = s.replace(/\n/g, '<br>')

    return '<p>' + s + '</p>'
  }

  // ── Conversation pruning ────────────────────────────────────────────────
  /**
   * Estimate token count for a message array (~4 chars per token).
   */
  function estimateTokens (messages) {
    var total = 0
    for (var i = 0; i < messages.length; i++) {
      var m = messages[i]
      if (m.content) total += m.content.length
      if (m.tool_calls) {
        for (var t = 0; t < m.tool_calls.length; t++) {
          var tc = m.tool_calls[t]
          total += (tc.function.name || '').length
          total += (tc.function.arguments || '').length
        }
      }
    }
    return Math.ceil(total / 4)
  }

  /**
   * Prune old messages to fit within a token budget.
   * Always keeps the last user message. Removes oldest messages first,
   * but preserves message groups (assistant+tool pairs stay together).
   */
  function pruneConversation (messages, maxTokens) {
    if (estimateTokens(messages) <= maxTokens) return messages

    // Always keep at least the last 2 messages (last user + preceding context).
    var minKeep = 2
    var pruned = messages.slice()

    while (estimateTokens(pruned) > maxTokens && pruned.length > minKeep) {
      // Remove from the front. If front is a tool message, keep removing
      // until we clear the full assistant+tool group.
      var removed = pruned.shift()
      // If we removed an assistant message with tool_calls, also remove
      // the subsequent tool result messages.
      if (removed && removed.tool_calls && removed.tool_calls.length > 0) {
        while (pruned.length > minKeep && pruned[0] && pruned[0].role === 'tool') {
          pruned.shift()
        }
      }
    }

    return pruned
  }

  // ── Handle Send ────────────────────────────────────────────────────────
  function handleSend () {
    if (state.isRequestInFlight) return
    var text = (els.userInput.value || '').trim()
    if (!text) return

    var session = getActiveSession()
    if (!session) session = createSession()
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

    // Start agent flow.
    state.isRequestInFlight = true
    state.currentAbortHandle = window.AGENT_TOOL_LOOP.createAbortHandle()
    els.sendBtn.disabled = true
    if (els.cancelBtn) els.cancelBtn.style.display = ''
    setStatus('Working...')
    showThinking()

    // Build conversation messages for the API (convert our format to OpenAI format).
    // Include tool call history so the agent remembers what it did in previous turns.
    var apiMessages = []
    for (var i = 0; i < session.messages.length; i++) {
      var m = session.messages[i]
      if (m.role === 'user') {
        apiMessages.push({ role: 'user', content: m.text })
      } else if (m.role === 'assistant') {
        // If this assistant message had tool calls, reconstruct the full
        // assistant+tool message sequence so the model sees its prior actions.
        if (m.toolCalls && m.toolCalls.length > 0) {
          // First: push the assistant message with tool_calls (as the API expects).
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

          // Then: push each tool result message.
          for (var tr = 0; tr < m.toolCalls.length; tr++) {
            var tcResult = m.toolCalls[tr]
            apiMessages.push({
              role: 'tool',
              tool_call_id: tcResult.id,
              content: JSON.stringify(tcResult.result || { ok: true })
            })
          }
        } else if (m.text) {
          // Plain text assistant response (no tool calls).
          apiMessages.push({ role: 'assistant', content: m.text })
        }
      }
      // Skip system messages from our UI — the agent system prompt is injected separately.
    }

    // Prune conversation to fit within token budget.
    // Rough estimate: ~4 chars per token. Keep system prompt + tools budget (~2000 tokens)
    // and reserve the rest for conversation. Default context budget: 12000 tokens for messages.
    var agentCfg = window.EXTENSIONS_LLM_CHAT_CONFIG || {}
    var maxConversationTokens = agentCfg.maxConversationTokens || 12000
    var maxSteps = getAgentMaxSteps(agentCfg)
    apiMessages = pruneConversation(apiMessages, maxConversationTokens)

    var toolCallLog = []

    window.AGENT_TOOL_LOOP.runAgentLoop({
      modelId: session.model,
      systemPrompt: window.AGENT_SYSTEM_PROMPT || '',
      messages: apiMessages,
      tools: (window.AGENT_TOOL_REGISTRY && window.AGENT_TOOL_REGISTRY.tools) || [],
      maxSteps: maxSteps,
      temperature: agentCfg.agentTemperature || 0.3,
      abortHandle: state.currentAbortHandle,
      onToolCall: function (tc) {
        updateThinkingWithToolCall(tc)
      },
      onStepComplete: function (stepIdx, results) {
        setStatus('Step ' + (stepIdx + 1) + '/' + maxSteps + ' (' + results.length + ' tool calls)')
      }
    }).then(function (result) {
      removeThinking()

      // Count mutating tool calls for the Undo button.
      var READ_ONLY_TOOLS = {
        get_detailed_comp_summary: true, get_host_context: true,
        get_property_value: true, get_keyframes: true,
        get_layer_properties: true, get_effect_properties: true,
        get_expression: true
      }
      var mutatingCount = 0
      var allCalls = result.toolCallLog || []
      for (var ci = 0; ci < allCalls.length; ci++) {
        if (!READ_ONLY_TOOLS[allCalls[ci].name] && allCalls[ci].status === 'ok') {
          mutatingCount++
        }
      }
      state.lastMutatingToolCount = mutatingCount

      // Push assistant message with tool calls and final content.
      var assistantMsg = {
        role: 'assistant',
        text: result.content || '',
        toolCalls: allCalls.map(function (tc) {
          return {
            id: tc.id,
            name: tc.name,
            args: tc.args,
            result: tc.result,
            status: tc.status
          }
        })
      }
      session.messages.push(assistantMsg)
      session.updatedAt = Date.now()

      setModelStatus('ok', 'model: ok')
      var usageNote = ''
      if (result.usage && result.usage.total_tokens > 0) {
        usageNote = ' | tokens: ' + result.usage.total_tokens
      }
      setStatus('Ready' + usageNote)
      renderTranscript()
      persistState()
    }).catch(function (err) {
      removeThinking()
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
  /**
   * Undo all mutating tool calls from the last agent request.
   * Each tool call creates its own undo group in AE, so we call
   * app.executeCommand(16) once per mutating tool call.
   */
  function handleUndo () {
    if (!window.HOST_BRIDGE) return
    var count = state.lastMutatingToolCount || 1
    if (count < 1) count = 1

    // Build a script that calls undo N times in a single evalScript.
    var script = '(function(){ for (var i = 0; i < ' + count + '; i++) { app.executeCommand(16); } return "' + count + '"; })()'
    window.HOST_BRIDGE.evalHostFunction(script)
      .then(function () { setStatus('Undo: ' + count + ' action' + (count > 1 ? 's' : '') + ' reverted') })
      .catch(function (e) { setStatus('Undo failed: ' + e.message) })
    state.lastMutatingToolCount = 0
  }

  // ── Session actions ────────────────────────────────────────────────────
  function handleRenameSession () {
    var session = getActiveSession()
    if (!session) return
    var name = prompt('Rename session:', session.title)
    if (name && name.trim()) {
      session.title = name.trim()
      session.updatedAt = Date.now()
      persistState()
      renderSessions()
    }
  }

  function handleClearSession () {
    var session = getActiveSession()
    if (!session) return
    if (!confirm('Clear all messages in "' + session.title + '"?')) return
    session.messages = []
    session.updatedAt = Date.now()
    persistState()
    renderTranscript()
  }

  function handleClearAll () {
    if (!confirm('Delete ALL sessions? This cannot be undone.')) return
    state.sessions = []
    state.activeSessionId = null
    state.nextSessionIndex = 1
    persistState()
    createSession()
  }

  function handleModelChange () {
    var session = getActiveSession()
    if (!session) return
    session.model = normalizeModelId(els.modelSelect.value)
    session.updatedAt = Date.now()
    persistState()
    renderSessions()
  }

  function refreshActiveCompNote (silent) {
    if (!els.activeCompNote) return
    if (!window.HOST_BRIDGE || typeof window.HOST_BRIDGE.evalHostFunction !== 'function') {
      els.activeCompNote.textContent = 'Active comp: unavailable.'
      return
    }
    return window.HOST_BRIDGE.evalHostFunction('extensionsLlmChat_getActiveCompNote()')
      .then(function (ctx) {
        if (ctx && ctx.ok && ctx.compName) {
          els.activeCompNote.textContent =
            'Active composition: "' + ctx.compName + '". Changes are applied to this composition.'
          return
        }
        var msg = (ctx && ctx.message) ? ctx.message : 'No active composition.'
        els.activeCompNote.textContent = 'Active composition: unavailable. ' + msg
      })
      .catch(function (err) {
        els.activeCompNote.textContent = 'Active composition: unavailable.'
        if (!silent) setStatus('Active comp note unavailable: ' + (err.message || String(err)))
      })
  }

  // ── Event binding ──────────────────────────────────────────────────────
  function bindEvents () {
    if (els.newSessionBtn) els.newSessionBtn.addEventListener('click', createSession)
    if (els.renameSessionBtn) els.renameSessionBtn.addEventListener('click', handleRenameSession)
    if (els.clearSessionBtn) els.clearSessionBtn.addEventListener('click', handleClearSession)
    if (els.clearAllBtn) els.clearAllBtn.addEventListener('click', handleClearAll)
    if (els.sendBtn) els.sendBtn.addEventListener('click', handleSend)
    if (els.undoBtn) els.undoBtn.addEventListener('click', handleUndo)
    if (els.cancelBtn) els.cancelBtn.addEventListener('click', function () {
      if (state.currentAbortHandle) {
        state.currentAbortHandle.aborted = true
        if (typeof state.currentAbortHandle.abort === 'function') {
          try { state.currentAbortHandle.abort() } catch (_) {}
        }
        setStatus('Cancelling...')
      }
    })
    if (els.modelSelect) els.modelSelect.addEventListener('change', handleModelChange)
    if (els.presetDropdownBtn) {
      els.presetDropdownBtn.addEventListener('click', function (e) {
        e.preventDefault()
        e.stopPropagation()
        if (!state.isPresetInFlight) togglePresetDropdown()
      })
    }
    if (els.presetDropdownMenu) {
      var optionButtons = els.presetDropdownMenu.querySelectorAll('.preset-option-btn')
      for (var pi = 0; pi < optionButtons.length; pi++) {
        optionButtons[pi].addEventListener('click', function (e) {
          e.preventDefault()
          e.stopPropagation()
          var key = this.getAttribute('data-preset') || ''
          if (!key) return
          state.selectedPresetKey = key
          updatePresetDropdownUi()
          updatePresetStrengthUi()
          closePresetDropdown()
        })
      }
    }
    document.addEventListener('click', function (e) {
      if (!els.presetDropdownMenu || !els.presetDropdownBtn) return
      var menu = els.presetDropdownMenu
      var btn = els.presetDropdownBtn
      if (!menu.contains(e.target) && !btn.contains(e.target)) closePresetDropdown()
    })
    if (els.applyPresetBtn) els.applyPresetBtn.addEventListener('click', handleApplyPresetFromUi)

    // Enter to send (Shift+Enter for newline).
    if (els.userInput) {
      els.userInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          handleSend()
        }
      })
    }

    // Persist on page unload.
    window.addEventListener('beforeunload', persistState)
    window.addEventListener('pagehide', persistState)
    window.addEventListener('focus', function () { refreshActiveCompNote(true) })
  }

  // ── Init ───────────────────────────────────────────────────────────────
  function init () {
    cacheDomRefs()
    loadState()

    // Ensure at least one session.
    if (state.sessions.length === 0) {
      createSession()
    } else {
      renderSessions()
      renderTranscript()
    }

    // Set model selector to active session's model.
    var session = getActiveSession()
    if (session && els.modelSelect) {
      var opts = els.modelSelect.options
      for (var i = 0; i < opts.length; i++) {
        if (opts[i].value === session.model) {
          els.modelSelect.selectedIndex = i
          break
        }
      }
    }

    bindEvents()
    updatePresetDropdownUi()
    updatePresetStrengthUi()
    setStatus('Ready')
    refreshActiveCompNote(true)

    // Check Cloud.ru connectivity.
    var secrets = (window.EXTENSIONS_LLM_CHAT_SECRETS) || {}
    var cfg = (window.EXTENSIONS_LLM_CHAT_CONFIG) || {}
    var apiKey = secrets.apiKey || cfg.apiKey || ''
    if (apiKey) {
      setModelStatus('ok', 'cloud: ready')
    } else {
      setModelStatus('unknown', 'no API key')
    }
  }

  // Boot.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
