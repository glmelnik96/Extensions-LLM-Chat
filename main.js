;(function () {
  'use strict'

  function showBootError (err, context) {
    try {
      var msg = (err && err.stack) ? String(err.stack) : (err && err.message ? String(err.message) : String(err))
      var header = '[Extensions LLM Chat] Panel error' + (context ? ' (' + context + ')' : '')
      if (typeof console !== 'undefined' && console && console.error) console.error(header, err)
      if (typeof document === 'undefined' || !document.body) return
      document.body.innerHTML = ''
      document.body.style.margin = '0'
      document.body.style.padding = '8px'
      document.body.style.background = '#1f1f1f'
      document.body.style.color = '#ffd2d2'
      document.body.style.fontFamily = 'Menlo, Monaco, Consolas, monospace'
      document.body.style.fontSize = '11px'
      var pre = document.createElement('pre')
      pre.textContent = header + '\n\n' + msg
      document.body.appendChild(pre)
    } catch (_) {
      // If we can't render, there's nothing else we can do here.
    }
  }

  // Surface boot-time errors in CEP (otherwise it may appear as a blank panel).
  try {
    if (typeof window !== 'undefined' && window) {
      window.addEventListener('error', function (evt) {
        var e = evt && evt.error ? evt.error : (evt && evt.message ? new Error(String(evt.message)) : new Error('Unknown error'))
        showBootError(e, 'window.error')
      })
      window.addEventListener('unhandledrejection', function (evt) {
        var reason = evt && evt.reason ? evt.reason : new Error('Unhandled promise rejection')
        showBootError(reason, 'unhandledrejection')
      })
    }
  } catch (_) {}

  /**
   * Session store. Sessions are persisted (e.g. localStorage) via persistState/loadState.
   *
   * Session data model (per session):
   * {
   *   id: string,
   *   title: string,
   *   createdAt: number,
   *   updatedAt: number,
   *   model: string,
   *   messages: Array<{ role: 'system' | 'user' | 'assistant', text: string }>,
   *   latestExtractedExpression: string | null,
   *   pipeline?: object
   * }
   */
  const state = {
    sessions: [],
    activeSessionId: null,
    nextSessionIndex: 1,
    isRequestInFlight: false,
    /** Ephemeral (never persisted): Phase 1+ capture / vision UI. */
    isCaptureInFlight: false,
    includeUiCaptureInNextSend: false,
    lastUiCaptureError: null,
    isVisionAnalyzeInFlight: false,
    /** Ephemeral: last known cloud connectivity indicator for the status bar. */
    lastCloudModelStatus: { status: 'unknown', label: 'model: unknown' },
    isAgentToolLoopInFlight: false,
    /** Ephemeral: Date.now() when screen capture subprocess started (debug timing). */
    capturePhaseStartMs: null,
  }

  var cachedHostScript = null

  /**
   * Build a host-side script: either run the given body after loading the host
   * via evalFile (path-based), or after injecting host script content (when provided).
   * bodyExpression is the ExtendScript expression to run (e.g. "extensionsLlmChat_getActiveCompSummary()").
   */
  function buildHostEvalScript (bodyExpression, hostScriptContent) {
    if (typeof hostScriptContent === 'string' && hostScriptContent.length > 0) {
      return hostScriptContent + '\n; ' + String(bodyExpression)
    }
    var hostPath = '~/Library/Application Support/Adobe/CEP/extensions/Extensions LLM Chat/host/index.jsx'
    try {
      if (typeof location !== 'undefined' && location.pathname) {
        var base = location.pathname.replace(/\/[^/]*$/, '')
        if (base.indexOf('Extensions LLM Chat') !== -1) {
          hostPath = base + '/host/index.jsx'
        }
      }
    } catch (e) {}
    return '$.evalFile(' + JSON.stringify(hostPath) + '); ' + String(bodyExpression)
  }

  // DOM elements
  let sessionListEl
  let newSessionBtn
  let renameSessionBtn
  let clearSessionBtn
  let clearAllBtn
  let chatTranscriptEl
  let userInputEl
  let modelSelectEl
  let sendBtn
  let applyExpressionBtn
  let applyBatchExpressionsBtn
  let statusLineEl
  let statusTextEl
  let modelStatusEl
  let targetRefreshBtn
  let targetLayerSelectEl
  let targetPropertySelectEl
  let targetSummaryEl
  let targetLayerTriggerEl
  let targetLayerListEl
  let targetPropertyTriggerEl
  let targetPropertyListEl
  let promptTargetLineEl
  let captureFullScreenBtn
  let capturePreviewBtn
  let includeUiCaptureCheckboxEl
  let visionOllamaStatusEl
  let analyzeUiOllamaBtn
  let analyzeFrameOllamaBtn

  var UI_OLLAMA_PROMPT =
    'You are helping a motion designer. This image is a screenshot of Adobe After Effects (UI). ' +
    'Describe in clear English: (1) Which areas are visible (timeline, viewer, effects, etc.). ' +
    '(2) Whether layers or keyframes appear selected if readable. (3) Any readable text or numbers; if text is partly illegible, say so (do not guess spellings). ' +
    '(4) What is uncertain. Use short bullet points, max ~350 words. Do not invent layer names you cannot read.'

  var FRAME_OLLAMA_PROMPT =
    'You are helping a motion designer. This image is one frame from an After Effects composition. ' +
    'Describe subject matter, layout, readable text (transcribe only what you can read clearly), dominant colors, and obvious motion/blur. ' +
    'Short bullets, max ~350 words. Note if the frame looks empty or unclear.'

  function normalizePreviewCaptureInset (c) {
    var def = { leftFrac: 0.24, topFrac: 0.13, widthFrac: 0.5, heightFrac: 0.45 }
    var p = c && typeof c === 'object' && c.previewCaptureInset && typeof c.previewCaptureInset === 'object' ? c.previewCaptureInset : null
    if (!p) return def
    return {
      leftFrac: typeof p.leftFrac === 'number' ? p.leftFrac : def.leftFrac,
      topFrac: typeof p.topFrac === 'number' ? p.topFrac : def.topFrac,
      widthFrac: typeof p.widthFrac === 'number' ? p.widthFrac : def.widthFrac,
      heightFrac: typeof p.heightFrac === 'number' ? p.heightFrac : def.heightFrac,
    }
  }

  /**
   * After saveFrameToPng the file can briefly be 0 bytes; wait until a non-trivial PNG exists.
   * @param {function (Error|null, string|null)} done  second arg = validated path
   */
  function waitForValidPngPath (filePath, opts, done) {
    if (typeof done !== 'function') return
    var pathStr = typeof filePath === 'string' ? filePath.trim() : ''
    if (!pathStr) {
      done(new Error('No PNG path from host.'), null)
      return
    }
    var o = opts || {}
    var maxAttempts = typeof o.maxAttempts === 'number' && o.maxAttempts > 0 ? o.maxAttempts : 20
    var delayMs = typeof o.delayMs === 'number' && o.delayMs > 0 ? o.delayMs : 150
    var minBytes = typeof o.minBytes === 'number' && o.minBytes > 0 ? o.minBytes : 100
    if (typeof require === 'undefined') {
      done(null, pathStr)
      return
    }
    var fs
    try {
      fs = require('fs')
    } catch (e) {
      done(null, pathStr)
      return
    }
    var attempt = 0
    function tryOnce () {
      attempt++
      try {
        if (!fs.existsSync(pathStr)) {
          if (attempt >= maxAttempts) {
            done(new Error('PNG not found after export: ' + pathStr), null)
            return
          }
          setTimeout(tryOnce, delayMs)
          return
        }
        var st = fs.statSync(pathStr)
        if (!st || st.size < minBytes) {
          if (attempt >= maxAttempts) {
            done(
              new Error('PNG still empty or too small (' + (st ? st.size : 0) + ' bytes). Try Analyze frame again.'),
              null
            )
            return
          }
          setTimeout(tryOnce, delayMs)
          return
        }
        var fd = fs.openSync(pathStr, 'r')
        var buf = new Uint8Array(8)
        try {
          fs.readSync(fd, buf, 0, 8, 0)
        } finally {
          fs.closeSync(fd)
        }
        if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
          if (attempt >= maxAttempts) {
            done(new Error('Export path is not a valid PNG (bad signature).'), null)
            return
          }
          setTimeout(tryOnce, delayMs)
          return
        }
        done(null, pathStr)
      } catch (err) {
        if (attempt >= maxAttempts) {
          done(err instanceof Error ? err : new Error(String(err)), null)
          return
        }
        setTimeout(tryOnce, delayMs)
      }
    }
    tryOnce()
  }

  function updateVisionOllamaStatus (text) {
    if (visionOllamaStatusEl) {
      visionOllamaStatusEl.textContent = text || 'Ollama: idle'
    }
  }

  function setVisionModelStatusBar (kind, modelName) {
    var k = (kind && String(kind).trim()) ? String(kind).trim() : 'vision'
    var m = (modelName && String(modelName).trim()) ? String(modelName).trim() : 'unknown'
    updateModelStatus('unknown', k + ': ' + m)
  }

  function restoreCloudModelStatusBar () {
    var s = state && state.lastCloudModelStatus ? state.lastCloudModelStatus : null
    if (s && typeof s.label === 'string') {
      updateModelStatus(s.status || 'unknown', s.label)
      return
    }
    updateModelStatus('unknown', 'model: unknown')
  }

  function readSecretsApiKey () {
    var s = typeof window !== 'undefined' && window.EXTENSIONS_LLM_CHAT_SECRETS
    if (!s || typeof s !== 'object') return ''
    var k = s.apiKey
    return typeof k === 'string' ? k.trim() : ''
  }

  function getConfig () {
    var c = typeof window !== 'undefined' && window.EXTENSIONS_LLM_CHAT_CONFIG
    var secretKey = readSecretsApiKey()
    if (!c || typeof c !== 'object') {
      return {
        apiKey: secretKey,
        baseUrl: 'https://foundation-models.api.cloud.ru/v1',
        defaultModel: 'openai/gpt-oss-120b',
        fallbackModel: 'Qwen/Qwen3-Coder-Next',
        ollamaBaseUrl: 'http://127.0.0.1:11434',
        ollamaVisionModel: 'llava-phi3:latest',
        ollamaVisionFallbackModel: 'moondream:latest',
        captureEnabled: true,
        captureTimeoutMs: 15000,
        previewCaptureInset: normalizePreviewCaptureInset(null),
        ollamaVisionTimeoutMs: 90000,
        ollamaVisionMaxEdgePx: 1024,
      }
    }
    var cfgKey = typeof c.apiKey === 'string' ? c.apiKey.trim() : ''
    var apiKey = secretKey || cfgKey
    return {
      apiKey: apiKey,
      baseUrl: typeof c.baseUrl === 'string' && c.baseUrl ? c.baseUrl : 'https://foundation-models.api.cloud.ru/v1',
      defaultModel: typeof c.defaultModel === 'string' && c.defaultModel ? c.defaultModel : 'openai/gpt-oss-120b',
      fallbackModel: typeof c.fallbackModel === 'string' && c.fallbackModel ? c.fallbackModel : 'Qwen/Qwen3-Coder-Next',
      ollamaBaseUrl:
        typeof c.ollamaBaseUrl === 'string' && c.ollamaBaseUrl ? c.ollamaBaseUrl.replace(/\/$/, '') : 'http://127.0.0.1:11434',
      ollamaVisionModel:
        typeof c.ollamaVisionModel === 'string' && c.ollamaVisionModel ? c.ollamaVisionModel : 'llava-phi3:latest',
      ollamaVisionFallbackModel:
        typeof c.ollamaVisionFallbackModel === 'string' && c.ollamaVisionFallbackModel
          ? c.ollamaVisionFallbackModel
          : 'moondream:latest',
      captureEnabled: c.captureEnabled !== false,
      captureTimeoutMs:
        typeof c.captureTimeoutMs === 'number' && c.captureTimeoutMs > 0 ? c.captureTimeoutMs : 15000,
      previewCaptureInset: normalizePreviewCaptureInset(c),
      ollamaVisionTimeoutMs:
        typeof c.ollamaVisionTimeoutMs === 'number' && c.ollamaVisionTimeoutMs > 0
          ? c.ollamaVisionTimeoutMs
          : 90000,
      ollamaVisionMaxEdgePx:
        typeof c.ollamaVisionMaxEdgePx === 'number' && c.ollamaVisionMaxEdgePx >= 0
          ? c.ollamaVisionMaxEdgePx
          : 1024,
    }
  }

  function isConfigValid () {
    var key = getConfig().apiKey
    return typeof key === 'string' && key.trim().length > 0
  }

  function ensureSessionVisionFields (session) {
    if (!session || typeof session !== 'object') return
    if (!Object.prototype.hasOwnProperty.call(session, 'lastUiAnalysis')) session.lastUiAnalysis = null
    if (!Object.prototype.hasOwnProperty.call(session, 'lastFrameAnalysis')) session.lastFrameAnalysis = null
    if (!Object.prototype.hasOwnProperty.call(session, 'lastUiCapturePath')) session.lastUiCapturePath = null
    if (!Object.prototype.hasOwnProperty.call(session, 'latestBatchPlan')) session.latestBatchPlan = null
  }

  function formatHostContextBlock (ctx) {
    if (!ctx || !ctx.ok) return ''
    var lines = []
    lines.push('[AE_HOST_STATE]')
    lines.push('Authoritative data from After Effects host (not inferred from screenshots):')
    lines.push('Composition: ' + (ctx.compName || '(unknown)'))
    lines.push(
      'Time (s): ' +
        ctx.time +
        ' | workArea start ' +
        ctx.workAreaStart +
        ' duration ' +
        ctx.workAreaDuration +
        ' | comp duration ' +
        ctx.compDuration +
        ' | fps ' +
        ctx.fps
    )
    if (ctx.selectedLayers && ctx.selectedLayers.length) {
      lines.push('Selected layers:')
      ctx.selectedLayers.forEach(function (l) {
        lines.push(
          '- index ' + l.index + ', id ' + l.id + ', name "' + (l.name || '') + '", matchName ' + (l.matchName || '')
        )
      })
    } else {
      lines.push('No layers reported as selected in the timeline.')
    }
    if (ctx.selectedProperties && ctx.selectedProperties.length) {
      lines.push('Selected properties:')
      ctx.selectedProperties.forEach(function (p) {
        var line = '- "' + (p.name || '') + '" matchName ' + (p.matchName || '')
        if (p.canSetExpression !== undefined) line += ' canSetExpression=' + p.canSetExpression
        lines.push(line)
      })
    } else {
      lines.push('No properties reported as selected.')
    }
    lines.push('[/AE_HOST_STATE]')
    return lines.join('\n')
  }

  function buildExtraGroundingForSession (session, hostParsed) {
    var g = { hostBlock: '', frameBlock: '', uiBlock: '' }
    if (hostParsed && hostParsed.ok) {
      g.hostBlock = formatHostContextBlock(hostParsed)
    }
    if (session && session.lastFrameAnalysis && String(session.lastFrameAnalysis).trim()) {
      g.frameBlock =
        '[FRAME_ANALYSIS]\n' + String(session.lastFrameAnalysis).trim() + '\n[/FRAME_ANALYSIS]'
    }
    if (
      state.includeUiCaptureInNextSend &&
      session &&
      session.lastUiAnalysis &&
      String(session.lastUiAnalysis).trim()
    ) {
      g.uiBlock = '[UI_ANALYSIS]\n' + String(session.lastUiAnalysis).trim() + '\n[/UI_ANALYSIS]'
    }
    return g
  }

  function prependGroundingToRoleMessages (messages, extraGrounding) {
    if (!messages || !messages.length) return messages
    if (!extraGrounding) return messages
    var insert = []
    if (extraGrounding.hostBlock) insert.push({ role: 'system', content: extraGrounding.hostBlock })
    if (extraGrounding.frameBlock) insert.push({ role: 'system', content: extraGrounding.frameBlock })
    if (extraGrounding.uiBlock) insert.push({ role: 'system', content: extraGrounding.uiBlock })
    if (!insert.length) return messages
    return [messages[0]].concat(insert).concat(messages.slice(1))
  }

  var _cfg = getConfig()
  var DEFAULT_MODEL = _cfg.defaultModel
  var FALLBACK_MODEL = _cfg.fallbackModel
  var CLOUD_API_CHAT_COMPLETIONS = _cfg.baseUrl.replace(/\/$/, '') + '/chat/completions'
  var CLOUD_API_KEY = _cfg.apiKey

  // System prompt is provided by systemPrompt.js and exposed as a global.
  const SYSTEM_PROMPT =
    (typeof EXTENSIONS_LLM_CHAT_SYSTEM_PROMPT === 'string'
      ? EXTENSIONS_LLM_CHAT_SYSTEM_PROMPT
      : 'Extensions LLM Chat – After Effects Expressions helper. System prompt failed to load; behavior may be degraded.')

  // Optional documentation-grounding helpers (loaded via separate scripts).
  const RETRIEVE_DOCS =
    (typeof AE_DOCS_RETRIEVE_RELEVANT === 'function' ? AE_DOCS_RETRIEVE_RELEVANT : null)
  const BUILD_DOCS_CONTEXT_MESSAGE =
    (typeof AE_BUILD_DOCS_CONTEXT_MESSAGE === 'function' ? AE_BUILD_DOCS_CONTEXT_MESSAGE : null)
  const ANNOTATE_WITH_VALIDATION =
    (typeof AE_ANNOTATE_ASSISTANT_WITH_VALIDATION === 'function'
      ? AE_ANNOTATE_ASSISTANT_WITH_VALIDATION
      : null)

  // Target selection state: reflects the last comp summary pulled from AE and
  // the currently chosen layer/property pair for auto-apply and grounding.
  state.compSummary = null
  state.activeTarget = null

  const STORAGE_KEY = 'extensions-llm-chat-state'

  // Pipeline runtime state schema (session-level). Backward compatible: only set when missing.
  const DEFAULT_PIPELINE_STATE = {
    stage: 'idle',
    status: 'idle',
    currentAttempt: 0,
    finalDisposition: null,
    userStatusText: '',
    draftAvailable: false,
    manualApplyOnly: true,
  }

  function ensureSessionPipelineState (session) {
    if (!session || typeof session !== 'object') return
    if (!session.pipeline || typeof session.pipeline !== 'object') {
      session.pipeline = {
        stage: DEFAULT_PIPELINE_STATE.stage,
        status: DEFAULT_PIPELINE_STATE.status,
        currentAttempt: DEFAULT_PIPELINE_STATE.currentAttempt,
        finalDisposition: DEFAULT_PIPELINE_STATE.finalDisposition,
        userStatusText: DEFAULT_PIPELINE_STATE.userStatusText,
        draftAvailable: DEFAULT_PIPELINE_STATE.draftAvailable,
        manualApplyOnly: DEFAULT_PIPELINE_STATE.manualApplyOnly,
      }
    }
  }

  function setPipelineStage (session, stage, status, userStatusText) {
    ensureSessionPipelineState(session)
    if (session.pipeline) {
      session.pipeline.stage = stage
      session.pipeline.status = status
      if (userStatusText !== undefined && userStatusText !== '') {
        session.pipeline.userStatusText = userStatusText
      }
    }
    if (typeof userStatusText === 'string' && userStatusText) {
      updateStatus(userStatusText)
    }
  }

  function resetPipelineState (session) {
    ensureSessionPipelineState(session)
    if (session.pipeline) {
      session.pipeline.stage = DEFAULT_PIPELINE_STATE.stage
      session.pipeline.status = DEFAULT_PIPELINE_STATE.status
      session.pipeline.currentAttempt = DEFAULT_PIPELINE_STATE.currentAttempt
      session.pipeline.finalDisposition = DEFAULT_PIPELINE_STATE.finalDisposition
      session.pipeline.userStatusText = DEFAULT_PIPELINE_STATE.userStatusText
      session.pipeline.draftAvailable = DEFAULT_PIPELINE_STATE.draftAvailable
      session.pipeline.manualApplyOnly = DEFAULT_PIPELINE_STATE.manualApplyOnly
    }
  }

  function finalizePipelineState (session, disposition, statusText) {
    ensureSessionPipelineState(session)
    if (session.pipeline) {
      session.pipeline.stage = 'idle'
      session.pipeline.status = 'idle'
      session.pipeline.finalDisposition = disposition
      session.pipeline.userStatusText = statusText || ''
      session.pipeline.draftAvailable = !!session.latestExtractedExpression
    }
    if (typeof statusText === 'string') {
      updateStatus(statusText)
    }
  }

  function persistState () {
    try {
      var payload = {
        sessions: state.sessions,
        activeSessionId: state.activeSessionId,
        nextSessionIndex: state.nextSessionIndex,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch (e) {}
  }

  function loadState () {
    try {
      var raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return false
      var data = JSON.parse(raw)
      if (!data || !Array.isArray(data.sessions) || data.sessions.length === 0) return false
      state.sessions = data.sessions
      state.sessions.forEach(ensureSessionVisionFields)
      state.activeSessionId = data.activeSessionId != null ? data.activeSessionId : (state.sessions[0] && state.sessions[0].id)
      state.nextSessionIndex = typeof data.nextSessionIndex === 'number' ? data.nextSessionIndex : state.sessions.length + 1
      return true
    } catch (e) {
      return false
    }
  }

  function handleTargetRefresh () {
    updateStatus('Refreshing layers from After Effects…')
    refreshActiveCompFromHost()
  }

  function closeTargetDropdowns () {
    if (targetLayerListEl) targetLayerListEl.classList.remove('is-open')
    if (targetPropertyListEl) targetPropertyListEl.classList.remove('is-open')
  }

  function updateLayerTriggerText () {
    if (!targetLayerTriggerEl || !targetLayerSelectEl) return
    var opt = targetLayerSelectEl.options[targetLayerSelectEl.selectedIndex]
    targetLayerTriggerEl.textContent = opt ? opt.textContent : 'No layer'
  }

  function updatePropertyTriggerText () {
    if (!targetPropertyTriggerEl || !targetPropertySelectEl) return
    var opt = targetPropertySelectEl.options[targetPropertySelectEl.selectedIndex]
    targetPropertyTriggerEl.textContent = opt ? opt.textContent : 'No property'
  }

  function handleTargetLayerChange () {
    const summary = state.compSummary
    if (!summary || !targetLayerSelectEl) return
    const layerIndex = parseInt(targetLayerSelectEl.value, 10)
    if (!layerIndex) {
      state.activeTarget = null
      if (targetPropertySelectEl) {
        targetPropertySelectEl.innerHTML = '<option value="">No property</option>'
        targetPropertySelectEl.disabled = true
      }
      updatePropertyTriggerText()
      if (targetPropertyListEl) {
        targetPropertyListEl.innerHTML = ''
      }
      if (targetPropertyTriggerEl) targetPropertyTriggerEl.disabled = true
      updateTargetSummary()
      updateLayerTriggerText()
      return
    }
    const layer = (summary.layers || []).find(l => l.index === layerIndex)
    if (!layer) {
      state.activeTarget = null
      updateTargetSummary()
      updateLayerTriggerText()
      return
    }
    if (targetPropertySelectEl) {
      targetPropertySelectEl.innerHTML = ''
      if (!layer.properties || !layer.properties.length) {
        targetPropertySelectEl.innerHTML = '<option value="">No property</option>'
        targetPropertySelectEl.disabled = true
      } else {
        layer.properties.forEach(function (p) {
          const opt = document.createElement('option')
          opt.value = p.path
          opt.textContent = p.displayName
          targetPropertySelectEl.appendChild(opt)
        })
        targetPropertySelectEl.disabled = false
      }
    }
    updatePropertyTriggerText()
    if (targetPropertyListEl) {
      targetPropertyListEl.innerHTML = ''
      if (layer.properties && layer.properties.length) {
        layer.properties.forEach(function (p) {
          const li = document.createElement('li')
          li.setAttribute('data-value', p.path)
          li.setAttribute('role', 'option')
          li.textContent = p.displayName
          targetPropertyListEl.appendChild(li)
        })
      }
    }
    if (targetPropertyTriggerEl) targetPropertyTriggerEl.disabled = !(layer.properties && layer.properties.length)
    state.activeTarget = null
    updateTargetSummary()
    updateLayerTriggerText()
  }

  function handleTargetPropertyChange () {
    const summary = state.compSummary
    if (!summary || !targetLayerSelectEl || !targetPropertySelectEl) return
    const layerIndex = parseInt(targetLayerSelectEl.value, 10)
    const propPath = targetPropertySelectEl.value || ''
    if (!layerIndex || !propPath) {
      state.activeTarget = null
      updateTargetSummary()
      return
    }
    const layer = (summary.layers || []).find(l => l.index === layerIndex)
    if (!layer) {
      state.activeTarget = null
      updateTargetSummary()
      return
    }
    const prop = (layer.properties || []).find(p => p.path === propPath)
    if (!prop) {
      state.activeTarget = null
      updateTargetSummary()
      return
    }
    state.activeTarget = {
      compName: summary.compName,
      layerIndex: layer.index,
      layerId: typeof layer.id === 'number' ? layer.id : null,
      layerName: layer.name,
      propertyPath: prop.path,
      propertyDisplayName: prop.displayName,
    }
    updateTargetSummary()
  }

  function updateTargetSummary () {
    if (!targetSummaryEl) return
    const target = state.activeTarget
    const summary = state.compSummary
    if (!summary || !summary.ok) {
      targetSummaryEl.textContent = 'No active composition'
      updatePromptTargetLine(null)
      return
    }
    if (!target) {
      targetSummaryEl.textContent =
        'Comp: "' +
        summary.compName +
        '" — target not selected (type "@" to pick a layer)'
      updatePromptTargetLine(null)
      return
    }
    targetSummaryEl.textContent =
      'Comp: "' +
      target.compName +
      '" — Layer ' +
      target.layerIndex +
      ' "' +
      target.layerName +
      '", ' +
      target.propertyDisplayName
    updatePromptTargetLine(target)
  }

  function updatePromptTargetLine (target) {
    if (!promptTargetLineEl) return
    if (!target) {
      promptTargetLineEl.textContent = ''
      promptTargetLineEl.classList.remove('is-set')
      return
    }
    promptTargetLineEl.textContent =
      'Writing for: Layer ' + target.layerIndex + ' "' + target.layerName + '" → ' + target.propertyDisplayName
    promptTargetLineEl.classList.add('is-set')
  }

  /** Return state.activeTarget, or build from current dropdown values so Apply uses panel selection. */
  function getResolvedTarget () {
    if (state.activeTarget && state.activeTarget.layerIndex && state.activeTarget.propertyPath) {
      return state.activeTarget
    }
    var summary = state.compSummary
    if (!summary || !summary.ok || !summary.layers || !summary.layers.length) return null
    if (!targetLayerSelectEl || !targetPropertySelectEl) return null
    var layerIndex = parseInt(targetLayerSelectEl.value, 10)
    var propPath = targetPropertySelectEl.value || ''
    if (!layerIndex || !propPath) return null
    var layer = (summary.layers || []).find(function (l) { return l.index === layerIndex })
    if (!layer) return null
    var prop = (layer.properties || []).find(function (p) { return p.path === propPath })
    if (!prop) return null
    return {
      compName: summary.compName,
      layerIndex: layer.index,
      layerId: typeof layer.id === 'number' ? layer.id : null,
      layerName: layer.name,
      propertyPath: prop.path,
      propertyDisplayName: prop.displayName,
    }
  }

  var refreshTimeoutId = null
  var refreshInProgress = false

  function getHostScriptContent (done) {
    if (cachedHostScript) {
      done(cachedHostScript)
      return
    }
    var url = 'host/index.jsx'
    try {
      fetch(url)
        .then(function (r) { return r.text() })
        .then(function (text) {
          cachedHostScript = text
          done(text)
        })
        .catch(function () {
          done(null)
        })
    } catch (e) {
      done(null)
    }
  }

  function refreshActiveCompFromHost () {
    if (typeof CSInterface === 'undefined') {
      state.compSummary = {
        ok: false,
        message: 'CSInterface is not available in this environment.',
      }
      updateTargetSummary()
      return
    }

    if (refreshTimeoutId) {
      clearTimeout(refreshTimeoutId)
      refreshTimeoutId = null
    }
    refreshInProgress = true

    getHostScriptContent(function (hostContent) {
      var script = buildHostEvalScript('extensionsLlmChat_getActiveCompSummary()', hostContent)
      var csInterface = new CSInterface()
      csInterface.evalScript(script, function (resultString) {
        refreshInProgress = false
        if (refreshTimeoutId) {
          clearTimeout(refreshTimeoutId)
          refreshTimeoutId = null
        }

        var summary = null
        if (typeof resultString === 'string' && resultString.length) {
          try {
            summary = JSON.parse(resultString)
          } catch (e) {
            summary = {
              ok: false,
              message: 'Failed to parse host response: ' + (resultString.length > 80 ? resultString.slice(0, 80) + '…' : resultString),
            }
          }
        }
        if (!summary) {
          summary = {
            ok: false,
            message: 'After Effects returned no data. Ensure a project is open and try again.',
          }
        }
        state.compSummary = summary

        // Update layer/property selects and custom dropdown lists.
        if (!summary.ok || !summary.layers || !summary.layers.length) {
          if (targetLayerSelectEl) {
            targetLayerSelectEl.innerHTML = '<option value="">No layer</option>'
            targetLayerSelectEl.disabled = true
          }
          if (targetLayerListEl) targetLayerListEl.innerHTML = ''
          if (targetLayerTriggerEl) {
            targetLayerTriggerEl.textContent = 'No layer'
            targetLayerTriggerEl.disabled = true
          }
          if (targetPropertySelectEl) {
            targetPropertySelectEl.innerHTML = '<option value="">No property</option>'
            targetPropertySelectEl.disabled = true
          }
          if (targetPropertyListEl) targetPropertyListEl.innerHTML = ''
          if (targetPropertyTriggerEl) {
            targetPropertyTriggerEl.textContent = 'No property'
            targetPropertyTriggerEl.disabled = true
          }
          state.activeTarget = null
        } else {
          if (targetLayerSelectEl) {
            targetLayerSelectEl.innerHTML = ''
            var optEmpty = document.createElement('option')
            optEmpty.value = ''
            optEmpty.textContent = 'Select layer'
            targetLayerSelectEl.appendChild(optEmpty)
            summary.layers.forEach(function (layer) {
              var opt = document.createElement('option')
              opt.value = String(layer.index)
              opt.textContent = layer.index + ': ' + layer.name
              targetLayerSelectEl.appendChild(opt)
            })
            targetLayerSelectEl.disabled = false
          }
          if (targetLayerListEl) {
            targetLayerListEl.innerHTML = ''
            summary.layers.forEach(function (layer) {
              var li = document.createElement('li')
              li.setAttribute('data-value', String(layer.index))
              li.setAttribute('role', 'option')
              li.textContent = layer.index + ': ' + layer.name
              targetLayerListEl.appendChild(li)
            })
          }
          if (targetLayerTriggerEl) targetLayerTriggerEl.disabled = false
          updateLayerTriggerText()
          if (targetPropertySelectEl) {
            targetPropertySelectEl.innerHTML = '<option value="">No property</option>'
            targetPropertySelectEl.disabled = true
          }
          if (targetPropertyListEl) targetPropertyListEl.innerHTML = ''
          if (targetPropertyTriggerEl) {
            targetPropertyTriggerEl.textContent = 'No property'
            targetPropertyTriggerEl.disabled = true
          }
          state.activeTarget = null
        }
        updateTargetSummary()
        if (summary.message) {
          var statusText = summary.message
          var extra = []
          if (summary.compStatusCode) {
            extra.push('status=' + summary.compStatusCode)
          }
          if (summary.viewerType) {
            extra.push('viewer=' + summary.viewerType)
          }
          if (summary.projectActiveItemType) {
            extra.push('activeItem=' + summary.projectActiveItemType)
          }
          if (extra.length) {
            statusText += ' [' + extra.join(', ') + ']'
          }
          updateStatus(statusText)
        }
      });
    });

    refreshTimeoutId = setTimeout(function () {
      refreshTimeoutId = null
      if (refreshInProgress) {
        refreshInProgress = false
        state.compSummary = {
          ok: false,
          message: 'After Effects did not respond. Ensure a project is open, then try @ or the refresh button again.',
        }
        updateTargetSummary()
        updateStatus(state.compSummary.message)
      }
    }, 12000)
  }

  function fetchHostContextPromise () {
    return new Promise(function (resolve) {
      if (typeof CSInterface === 'undefined') {
        resolve(null)
        return
      }
      getHostScriptContent(function (hostContent) {
        var script = buildHostEvalScript('extensionsLlmChat_getHostContext()', hostContent)
        try {
          var csInterface = new CSInterface()
          csInterface.evalScript(script, function (resultString) {
            if (typeof resultString !== 'string' || !resultString.length) {
              resolve(null)
              return
            }
            try {
              resolve(JSON.parse(resultString))
            } catch (e) {
              resolve(null)
            }
          })
        } catch (e) {
          resolve(null)
        }
      })
    })
  }

  function getOllamaVisionApi () {
    var w = typeof window !== 'undefined' ? window : null
    return w && w.EXTENSIONS_LLM_CHAT_OLLAMA_VISION ? w.EXTENSIONS_LLM_CHAT_OLLAMA_VISION : null
  }

  function handleAnalyzeUiOllama () {
    var session = getActiveSession()
    if (!session) return
    ensureSessionVisionFields(session)
    var path = session.lastUiCapturePath
    if (!path) {
      updateStatus('Capture full screen or comp area first, then run Analyze UI (Ollama).')
      return
    }
    var api = getOllamaVisionApi()
    if (!api || typeof api.analyzePngFile !== 'function') {
      updateStatus('Ollama vision script missing. Load lib/ollamaVision.js before main.js.')
      return
    }
    if (!api.isNodeFsAvailable || !api.isNodeFsAvailable()) {
      updateStatus('Node fs not available for Ollama vision.')
      return
    }
    var cfg = getConfig()
    state.isVisionAnalyzeInFlight = true
    updateCaptureUiEnabled()
    setVisionModelStatusBar('vision', cfg.ollamaVisionModel)
    updateStatus('Ollama · UI · checking screenshot file…')
    updateVisionOllamaStatus('Ollama · UI · waiting for PNG on disk')
    waitForValidPngPath(path, { minBytes: 100, maxAttempts: 15, delayMs: 200 }, function (wErr, validPath) {
      if (wErr) {
        state.isVisionAnalyzeInFlight = false
        updateCaptureUiEnabled()
        updateVisionOllamaStatus('Ollama: idle')
        restoreCloudModelStatusBar()
        updateStatus('UI analysis: ' + (wErr.message || String(wErr)))
        return
      }
      updateStatus('Ollama · UI · running vision model…')
      updateVisionOllamaStatus('Ollama · UI · ' + cfg.ollamaVisionModel)
      setVisionModelStatusBar('vision', cfg.ollamaVisionModel)
      var tVisionUi = Date.now()
      api.analyzePngFile(
        validPath,
        {
          baseUrl: cfg.ollamaBaseUrl,
          model: cfg.ollamaVisionModel,
          fallbackModel: cfg.ollamaVisionFallbackModel,
          timeoutMs: cfg.ollamaVisionTimeoutMs,
          maxEdgePx: cfg.ollamaVisionMaxEdgePx,
          prompt: UI_OLLAMA_PROMPT,
        },
        function (err, text) {
          var diagT = window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS
          if (diagT && diagT.logPhaseTiming) {
            diagT.logPhaseTiming('ollama_vision_ui', Date.now() - tVisionUi, err ? 'error' : 'ok')
          }
          state.isVisionAnalyzeInFlight = false
          updateCaptureUiEnabled()
          updateVisionOllamaStatus('Ollama: idle')
          restoreCloudModelStatusBar()
          if (err) {
            updateStatus('Ollama UI analysis failed: ' + (err.message || String(err)))
            var diag = window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS
            if (diag && diag.logError) diag.logError('Ollama UI vision failed', 'local_vision', err)
            return
          }
          session.lastUiAnalysis = text
          session.updatedAt = Date.now()
          persistState()
          updateStatus(
            'Ollama · UI · done (' + String(text).length + ' chars). Check “Include UI capture” to send with next cloud request.'
          )
        }
      )
    })
  }

  function handleAnalyzeFrameOllama () {
    var session = getActiveSession()
    if (!session) return
    if (typeof CSInterface === 'undefined') {
      updateStatus('CSInterface not available.')
      return
    }
    var cap = getCaptureMacOSApi()
    var api = getOllamaVisionApi()
    if (!cap || typeof cap.getTempPngPath !== 'function' || !cap.isNodeCaptureAvailable()) {
      updateStatus('Node capture helpers required for frame export path.')
      return
    }
    if (!api || typeof api.analyzePngFile !== 'function') {
      updateStatus('Ollama vision script missing.')
      return
    }
    var outPath = cap.getTempPngPath('ext-llm-chat-frame')
    if (!outPath) {
      updateStatus('Could not allocate temp PNG path.')
      return
    }
    var cfg = getConfig()
    state.isVisionAnalyzeInFlight = true
    updateCaptureUiEnabled()
    setVisionModelStatusBar('vision', cfg.ollamaVisionModel)
    updateStatus('Ollama · frame · exporting from host…')
    updateVisionOllamaStatus('Frame · saveFrameToPng…')
    getHostScriptContent(function (hostContent) {
      var script = buildHostEvalScript(
        'extensionsLlmChat_saveCompFramePng(' + JSON.stringify(outPath) + ')',
        hostContent
      )
      try {
        var csInterface = new CSInterface()
        csInterface.evalScript(script, function (resultString) {
          var data = null
          try {
            data = JSON.parse(resultString)
          } catch (e) {}
          if (!data || !data.ok) {
            state.isVisionAnalyzeInFlight = false
            updateCaptureUiEnabled()
            updateVisionOllamaStatus('Ollama: idle')
            restoreCloudModelStatusBar()
            updateStatus((data && data.message) || 'Frame export failed.')
            return
          }
          var pathFromHost =
            data.path && String(data.path).trim().length ? String(data.path).trim() : outPath
          updateStatus('Ollama · frame · waiting for PNG on disk…')
          updateVisionOllamaStatus('Frame · validating PNG')
          waitForValidPngPath(pathFromHost, { minBytes: 100, maxAttempts: 25, delayMs: 200 }, function (wErr, validPath) {
            if (wErr) {
              state.isVisionAnalyzeInFlight = false
              updateCaptureUiEnabled()
              updateVisionOllamaStatus('Ollama: idle')
              restoreCloudModelStatusBar()
              updateStatus('Frame PNG: ' + (wErr.message || String(wErr)))
              return
            }
            updateStatus('Ollama · frame · running vision model…')
            updateVisionOllamaStatus('Ollama · frame · ' + cfg.ollamaVisionModel)
            setVisionModelStatusBar('vision', cfg.ollamaVisionModel)
            var tVisionFrame = Date.now()
            api.analyzePngFile(
              validPath,
              {
                baseUrl: cfg.ollamaBaseUrl,
                model: cfg.ollamaVisionModel,
                fallbackModel: cfg.ollamaVisionFallbackModel,
                timeoutMs: cfg.ollamaVisionTimeoutMs,
                maxEdgePx: cfg.ollamaVisionMaxEdgePx,
                prompt: FRAME_OLLAMA_PROMPT,
              },
              function (err, text) {
                var diagTf = window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS
                if (diagTf && diagTf.logPhaseTiming) {
                  diagTf.logPhaseTiming('ollama_vision_frame', Date.now() - tVisionFrame, err ? 'error' : 'ok')
                }
                state.isVisionAnalyzeInFlight = false
                updateCaptureUiEnabled()
                updateVisionOllamaStatus('Ollama: idle')
                restoreCloudModelStatusBar()
                try {
                  if (typeof require !== 'undefined') {
                    var fs = require('fs')
                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath)
                    if (validPath !== outPath && fs.existsSync(validPath)) fs.unlinkSync(validPath)
                  }
                } catch (eU) {}
                if (err) {
                  updateStatus('Ollama frame analysis failed: ' + (err.message || String(err)))
                  var diag = window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS
                  if (diag && diag.logError) diag.logError('Ollama frame vision failed', 'local_vision', err)
                  return
                }
                session.lastFrameAnalysis = text
                session.updatedAt = Date.now()
                persistState()
                updateStatus(
                  'Ollama · frame · done (' + String(text).length + ' chars). Included on next cloud request as [FRAME_ANALYSIS].'
                )
              }
            )
          })
        })
      } catch (e) {
        state.isVisionAnalyzeInFlight = false
        updateCaptureUiEnabled()
        updateVisionOllamaStatus('Ollama: idle')
        restoreCloudModelStatusBar()
        updateStatus('Frame export error: ' + (e.message || String(e)))
      }
    })
  }

  function sanitizeExpression (expr) {
    if (!expr || typeof expr !== 'string') return expr
    var s = expr.trim()
    // Strip leading and trailing markdown code fences if present.
    if (s.indexOf('```') === 0) {
      s = s.replace(/^```[a-zA-Z0-9]*\s*/, '')
      // Remove a trailing fence if it exists.
      var fenceIndex = s.lastIndexOf('```')
      if (fenceIndex !== -1) {
        s = s.slice(0, fenceIndex)
      }
      s = s.trim()
    }
    // Remove any residual separators or obvious labels if they leaked in.
    if (s.indexOf('---EXPLANATION---') !== -1) {
      s = s.split('---EXPLANATION---')[0].trim()
    }
    if (s.indexOf('---NOTES---') !== -1) {
      s = s.split('---NOTES---')[0].trim()
    }
    // Clean common leading labels.
    s = s.replace(/^\s*Expression\s*:\s*/i, '')
    return s.trim()
  }

  /** Legacy: not used by the production pipeline. Manual Apply only via handleApplyExpression(). */
  function autoApplyExpressionForTarget (session, expressionText) {
    var target = getResolvedTarget()
    if (!target || !expressionText) return
    if (typeof CSInterface === 'undefined') {
      session.messages.push({
        role: 'system',
        text:
          'Cannot auto-apply expression to target: CSInterface is not available in this environment.',
      })
      session.updatedAt = Date.now()
      renderTranscript()
      scrollTranscriptToBottom()
      return
    }
    var csInterface = new CSInterface()
    var scriptBody =
      'extensionsLlmChat_applyExpressionToTarget(' +
      Number(target.layerIndex) +
      ', ' +
      (typeof target.layerId === 'number' ? String(target.layerId) : 'null') +
      ', ' +
      JSON.stringify(target.propertyPath) +
      ', ' +
      JSON.stringify(expressionText) +
      ')'
    getHostScriptContent(function (hostContent) {
      var script = buildHostEvalScript(scriptBody, hostContent)
      csInterface.evalScript(script, function (resultString) {
        var statusMessage = 'Expression auto-apply: unknown host response.'
        if (typeof resultString === 'string' && resultString.length) {
          try {
            var parsed = JSON.parse(resultString)
            if (parsed && typeof parsed.message === 'string') {
              statusMessage = parsed.message
              var extra = []
              if (parsed.compStatusCode) extra.push('status=' + parsed.compStatusCode)
              if (parsed.viewerType) extra.push('viewer=' + parsed.viewerType)
              if (parsed.projectActiveItemType) extra.push('activeItem=' + parsed.projectActiveItemType)
              if (extra.length) statusMessage += ' [' + extra.join(', ') + ']'
            }
          } catch (e) {
            statusMessage = 'Expression auto-apply: non-JSON response from host.'
          }
        } else {
          statusMessage = 'Expression auto-apply: empty response from host.'
        }
        session.messages.push({
          role: 'system',
          text: statusMessage,
        })
        session.updatedAt = Date.now()
        renderTranscript()
        scrollTranscriptToBottom()
      })
    })
  }

  function init () {
    sessionListEl = document.getElementById('session-list')
    newSessionBtn = document.getElementById('new-session-btn')
    renameSessionBtn = document.getElementById('rename-session-btn')
    clearSessionBtn = document.getElementById('clear-session-btn')
    clearAllBtn = document.getElementById('clear-all-btn')
    chatTranscriptEl = document.getElementById('chat-transcript')
    userInputEl = document.getElementById('user-input')
    modelSelectEl = document.getElementById('model-select')
    sendBtn = document.getElementById('send-btn')
    applyExpressionBtn = document.getElementById('apply-expression-btn')
    applyBatchExpressionsBtn = document.getElementById('apply-batch-btn')
    statusLineEl = document.getElementById('status-line')
    statusTextEl = document.getElementById('status-text')
    modelStatusEl = document.getElementById('model-status')
    targetRefreshBtn = document.getElementById('target-refresh-btn')
    targetLayerSelectEl = document.getElementById('target-layer-select')
    targetPropertySelectEl = document.getElementById('target-property-select')
    targetSummaryEl = document.getElementById('target-summary')
    targetLayerTriggerEl = document.getElementById('target-layer-trigger')
    targetLayerListEl = document.getElementById('target-layer-list')
    targetPropertyTriggerEl = document.getElementById('target-property-trigger')
    targetPropertyListEl = document.getElementById('target-property-list')
    promptTargetLineEl = document.getElementById('prompt-target-line')
    captureFullScreenBtn = document.getElementById('capture-fullscreen-btn')
    capturePreviewBtn = document.getElementById('capture-comp-area-btn')
    includeUiCaptureCheckboxEl = document.getElementById('include-ui-capture-send')
    visionOllamaStatusEl = document.getElementById('vision-ollama-status')
    analyzeUiOllamaBtn = document.getElementById('analyze-ui-ollama-btn')
    analyzeFrameOllamaBtn = document.getElementById('analyze-frame-ollama-btn')

    bindEvents()
    if (!loadState()) {
      ensureInitialSession()
    }
    renderSessions()
    renderTranscript()
    updateStatus('Готово.')
    updateModelStatus('unknown', 'model: unknown')
    persistState()
    window.addEventListener('beforeunload', persistState)
    window.addEventListener('pagehide', persistState)
    // Try to read the active composition once on startup so that, when
    // available, layers and properties appear without manual refresh.
    refreshActiveCompFromHost()
    updateVisionOllamaStatus('Ollama: idle')
    updateCaptureUiEnabled()
  }

  function getCaptureMacOSApi () {
    var w = typeof window !== 'undefined' ? window : null
    return w && w.EXTENSIONS_LLM_CHAT_CAPTURE_MACOS ? w.EXTENSIONS_LLM_CHAT_CAPTURE_MACOS : null
  }

  function updateCaptureUiEnabled () {
    if (!captureFullScreenBtn && !capturePreviewBtn && !analyzeUiOllamaBtn && !analyzeFrameOllamaBtn) return
    var cfg = getConfig()
    var capApi = getCaptureMacOSApi()
    var nodeOk = !!(capApi && typeof capApi.isNodeCaptureAvailable === 'function' && capApi.isNodeCaptureAvailable())
    var fullOk = !!(capApi && typeof capApi.captureFullScreenToPng === 'function')
    var previewOk = !!(capApi && typeof capApi.captureAeCompositionPreviewApproxToPng === 'function')
    var ollamaApi = getOllamaVisionApi()
    var ollamaFsOk = !!(ollamaApi && ollamaApi.isNodeFsAvailable && ollamaApi.isNodeFsAvailable())
    var visionBusy = state.isVisionAnalyzeInFlight || state.isRequestInFlight

    var capDisabled =
      state.isCaptureInFlight || state.isRequestInFlight || !cfg.captureEnabled || !nodeOk || !fullOk
    if (captureFullScreenBtn) {
      captureFullScreenBtn.disabled = capDisabled
      if (!cfg.captureEnabled) {
        captureFullScreenBtn.title = 'Screen capture is disabled in config (captureEnabled: false).'
      } else if (!nodeOk) {
        captureFullScreenBtn.title =
          'Node.js is not enabled in the CEP panel. Add --enable-nodejs and --mixed-context to manifest.xml, then reload.'
      } else {
        captureFullScreenBtn.title =
          'Save a full-screen PNG for UI analysis (macOS Screen Recording must allow After Effects).'
      }
    }
    var prevDisabled =
      state.isCaptureInFlight || state.isRequestInFlight || !cfg.captureEnabled || !nodeOk || !previewOk
    if (capturePreviewBtn) {
      capturePreviewBtn.disabled = prevDisabled
      if (!cfg.captureEnabled) {
        capturePreviewBtn.title = 'Screen capture is disabled in config.'
      } else if (!nodeOk) {
        capturePreviewBtn.title = captureFullScreenBtn ? captureFullScreenBtn.title : 'Node not available.'
      } else {
        capturePreviewBtn.title =
          'Crop the frontmost After Effects window toward the Composition viewer (previewCaptureInset in config). Requires Automation: After Effects → System Events.'
      }
    }
    if (includeUiCaptureCheckboxEl) {
      includeUiCaptureCheckboxEl.disabled = !nodeOk || !cfg.captureEnabled
    }

    var ollamaDisabled = visionBusy || !nodeOk || !ollamaFsOk
    if (analyzeUiOllamaBtn) {
      analyzeUiOllamaBtn.disabled = ollamaDisabled
      analyzeUiOllamaBtn.title = !ollamaFsOk
        ? 'Requires Node and lib/ollamaVision.js (local Ollama vision).'
        : 'Describe the last captured PNG for this session (path is saved until you capture again or Clear All).'
    }
    if (analyzeFrameOllamaBtn) {
      analyzeFrameOllamaBtn.disabled = ollamaDisabled
      analyzeFrameOllamaBtn.title = !ollamaFsOk
        ? 'Requires Node and lib/ollamaVision.js.'
        : 'Export current comp frame (saveFrameToPng) and describe it via Ollama.'
    }
  }

  function finishCaptureResult (err, result) {
    state.isCaptureInFlight = false
    var diag = typeof window !== 'undefined' && window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS
    var capStart = state.capturePhaseStartMs
    state.capturePhaseStartMs = null
    if (capStart != null && diag && diag.logPhaseTiming) {
      diag.logPhaseTiming('capture_macos', Date.now() - capStart, err ? 'fail' : 'ok')
    }
    var session = getActiveSession()
    if (err) {
      state.lastUiCaptureError = err.message || String(err)
      updateStatus('Capture failed: ' + state.lastUiCaptureError + (session && session.lastUiCapturePath ? ' (previous capture for this session is kept.)' : ''))
      if (diag && diag.logError) diag.logError('Capture failed', 'capture_macos', err)
      updateCaptureUiEnabled()
      return
    }
    state.lastUiCaptureError = null
    if (session) {
      ensureSessionVisionFields(session)
      session.lastUiCapturePath = result.path
      session.updatedAt = Date.now()
      persistState()
    }
    updateStatus('Screen saved: ' + result.path)
    if (diag && diag.logInfo) diag.logInfo('Capture OK', result.path)
    updateCaptureUiEnabled()
  }

  function handleCaptureFullScreen () {
    var cfg = getConfig()
    if (!cfg.captureEnabled) {
      updateStatus('Screen capture is disabled in config.')
      return
    }
    var api = getCaptureMacOSApi()
    if (!api || typeof api.captureFullScreenToPng !== 'function') {
      updateStatus('Capture module missing. Ensure lib/captureMacOS.js is loaded before main.js.')
      return
    }
    if (!api.isNodeCaptureAvailable()) {
      updateStatus('Node not available: enable Node in CSXS/manifest.xml and reload the panel.')
      var diag0 = typeof window !== 'undefined' && window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS
      if (diag0 && diag0.logWarn) diag0.logWarn('Capture: Node.js not available in CEP')
      return
    }
    state.isCaptureInFlight = true
    state.lastUiCaptureError = null
    state.capturePhaseStartMs = Date.now()
    updateCaptureUiEnabled()
    updateStatus('Capturing full screen…')
    api.captureFullScreenToPng({ captureTimeoutMs: cfg.captureTimeoutMs }, function (err, result) {
      finishCaptureResult(err, result)
    })
  }

  function handleCapturePreview () {
    var cfg = getConfig()
    if (!cfg.captureEnabled) {
      updateStatus('Screen capture is disabled in config.')
      return
    }
    var api = getCaptureMacOSApi()
    if (!api || typeof api.captureAeCompositionPreviewApproxToPng !== 'function') {
      updateStatus('Capture module missing (preview API). Reload the panel after updating lib/captureMacOS.js.')
      return
    }
    if (!api.isNodeCaptureAvailable()) {
      updateStatus('Node not available: enable Node in CSXS/manifest.xml and reload the panel.')
      return
    }
    state.isCaptureInFlight = true
    state.lastUiCaptureError = null
    state.capturePhaseStartMs = Date.now()
    updateCaptureUiEnabled()
    updateStatus('Capturing comp area (frontmost AE window, approx. viewer)…')
    api.captureAeCompositionPreviewApproxToPng(
      { captureTimeoutMs: cfg.captureTimeoutMs, previewCaptureInset: cfg.previewCaptureInset },
      function (err, result) {
        finishCaptureResult(err, result)
      }
    )
  }

  /**
   * After Clear All: delete temp capture PNGs and ask Ollama to unload loaded models (frees VRAM / in-memory state).
   * Ollama HTTP chat is stateless; there is no global "chat history" API — unload is the practical reset.
   */
  function unloadOllamaLoadedModelsFromMemory (done) {
    var cfg = getConfig()
    var base = (cfg.ollamaBaseUrl || '').replace(/\/$/, '')
    if (!base || typeof fetch === 'undefined') {
      if (done) done('')
      return
    }
    fetch(base + '/api/ps')
      .then(function (r) {
        if (!r.ok) throw new Error('ps ' + r.status)
        return r.json()
      })
      .then(function (data) {
        var models = data && Array.isArray(data.models) ? data.models : []
        if (models.length === 0) {
          if (done) done('Ollama: nothing loaded in memory.')
          return undefined
        }
        return Promise.all(
          models.map(function (entry) {
            var name = entry && entry.name
            if (!name) return Promise.resolve()
            return fetch(base + '/api/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model: name,
                prompt: ' ',
                keep_alive: 0,
              }),
            }).catch(function () {})
          })
        ).then(function () {
          if (done) done('Ollama: unloaded ' + models.length + ' model(s) from memory.')
        })
      })
      .catch(function () {
        if (done) done('')
      })
  }

  function runClearAllCachesAndOllamaUnload (done) {
    var api = getCaptureMacOSApi()
    var messages = []
    function finish () {
      if (typeof done === 'function') done(messages.filter(Boolean).join(' '))
    }
    if (api && typeof api.purgeExtensionCapturePngs === 'function' && api.isNodeCaptureAvailable()) {
      api.purgeExtensionCapturePngs(function (err, info) {
        if (!err && info && typeof info.deletedCount === 'number') {
          messages.push('Deleted ' + info.deletedCount + ' capture PNG(s).')
        } else if (err && err.message) {
          messages.push('Capture purge: ' + err.message)
        }
        unloadOllamaLoadedModelsFromMemory(function (ollamaLine) {
          if (ollamaLine) messages.push(ollamaLine)
          finish()
        })
      })
    } else {
      unloadOllamaLoadedModelsFromMemory(function (ollamaLine) {
        if (ollamaLine) messages.push(ollamaLine)
        finish()
      })
    }
  }

  function bindEvents () {
    if (newSessionBtn) newSessionBtn.addEventListener('click', handleNewSession)
    if (renameSessionBtn) renameSessionBtn.addEventListener('click', handleRenameSession)
    if (clearSessionBtn) clearSessionBtn.addEventListener('click', handleClearSession)
    if (clearAllBtn) clearAllBtn.addEventListener('click', handleClearAll)
    if (modelSelectEl) modelSelectEl.addEventListener('change', handleModelChange)
    if (sendBtn) sendBtn.addEventListener('click', handleSend)
    if (applyExpressionBtn) applyExpressionBtn.addEventListener('click', handleApplyExpression)
    if (applyBatchExpressionsBtn) applyBatchExpressionsBtn.addEventListener('click', handleApplyBatchExpressions)
    if (targetRefreshBtn) targetRefreshBtn.addEventListener('click', handleTargetRefresh)
    if (captureFullScreenBtn) captureFullScreenBtn.addEventListener('click', handleCaptureFullScreen)
    if (capturePreviewBtn) capturePreviewBtn.addEventListener('click', handleCapturePreview)
    if (includeUiCaptureCheckboxEl) {
      includeUiCaptureCheckboxEl.addEventListener('change', function () {
        state.includeUiCaptureInNextSend = !!(includeUiCaptureCheckboxEl && includeUiCaptureCheckboxEl.checked)
      })
    }
    if (analyzeUiOllamaBtn) analyzeUiOllamaBtn.addEventListener('click', handleAnalyzeUiOllama)
    if (analyzeFrameOllamaBtn) analyzeFrameOllamaBtn.addEventListener('click', handleAnalyzeFrameOllama)
    if (targetLayerSelectEl) targetLayerSelectEl.addEventListener('change', handleTargetLayerChange)
    if (targetPropertySelectEl) targetPropertySelectEl.addEventListener('change', handleTargetPropertyChange)

    if (targetLayerTriggerEl) {
      targetLayerTriggerEl.addEventListener('click', function (e) {
        e.stopPropagation()
        if (targetLayerTriggerEl.disabled) return
        if (targetPropertyListEl) targetPropertyListEl.classList.remove('is-open')
        if (targetLayerListEl) targetLayerListEl.classList.toggle('is-open')
      })
    }
    if (targetPropertyTriggerEl) {
      targetPropertyTriggerEl.addEventListener('click', function (e) {
        e.stopPropagation()
        if (targetPropertyTriggerEl.disabled) return
        if (targetLayerListEl) targetLayerListEl.classList.remove('is-open')
        if (targetPropertyListEl) targetPropertyListEl.classList.toggle('is-open')
      })
    }
    if (targetLayerListEl) {
      targetLayerListEl.addEventListener('click', function (e) {
        var li = e.target.closest('li[data-value]')
        if (!li) return
        var val = li.getAttribute('data-value')
        if (targetLayerSelectEl && val !== undefined) {
          targetLayerSelectEl.value = val
          targetLayerSelectEl.dispatchEvent(new Event('change'))
        }
        if (targetLayerListEl) targetLayerListEl.classList.remove('is-open')
        updateLayerTriggerText()
      })
    }
    if (targetPropertyListEl) {
      targetPropertyListEl.addEventListener('click', function (e) {
        var li = e.target.closest('li[data-value]')
        if (!li) return
        var val = li.getAttribute('data-value')
        if (targetPropertySelectEl && val !== undefined) {
          targetPropertySelectEl.value = val
          targetPropertySelectEl.dispatchEvent(new Event('change'))
        }
        if (targetPropertyListEl) targetPropertyListEl.classList.remove('is-open')
        updatePropertyTriggerText()
      })
    }
    document.addEventListener('click', function (evt) {
      if (!evt.target.closest('.target-dropdown-wrap')) {
        closeTargetDropdowns()
      }
    })

    if (userInputEl) {
      userInputEl.addEventListener('keydown', function (evt) {
        if (evt.key === '@') {
          updateStatus('Refreshing layers from After Effects…')
          refreshActiveCompFromHost()
        }
        if (evt.key === 'Enter' && (evt.metaKey || evt.ctrlKey)) {
          evt.preventDefault()
          handleSend()
        }
      })
    }

    if (!isConfigValid()) {
      var diag = typeof window !== 'undefined' && window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS
      if (diag && diag.logWarn) diag.logWarn('API key empty. Set config/secrets.local.js. See config/README.md')
      updateStatus('Set API key in config/secrets.local.js. See config/README.md')
    }
  }

  function ensureInitialSession () {
    if (state.sessions.length === 0) {
      const first = createSession()
      state.sessions.push(first)
      state.activeSessionId = first.id
    }
  }

  function createSession () {
    const idx = state.nextSessionIndex++
    const now = Date.now()
    const session = {
      id: 'session-' + idx,
      title: 'Session ' + idx,
      createdAt: now,
      updatedAt: now,
      model: DEFAULT_MODEL,
      latestExtractedExpression: null,
      latestBatchPlan: null,
      lastUiAnalysis: null,
      lastFrameAnalysis: null,
      lastUiCapturePath: null,
      messages: [
        {
          role: 'system',
          text: SYSTEM_PROMPT,
        },
      ],
    }
    ensureSessionPipelineState(session)
    ensureSessionVisionFields(session)
    return session
  }

  function getActiveSession () {
    return state.sessions.find(s => s.id === state.activeSessionId) || null
  }

  function setActiveSession (id) {
    state.activeSessionId = id
    renderSessions()
    renderTranscript()
    persistState()
  }

  function handleNewSession () {
    const session = createSession()
    state.sessions.push(session)
    setActiveSession(session.id)
    persistState()
  }

  function handleRenameSession () {
    const session = getActiveSession()
    if (!session) return
    const nextName = window.prompt('Rename session:', session.title)
    if (typeof nextName === 'string' && nextName.trim()) {
      session.title = nextName.trim()
      session.updatedAt = Date.now()
      renderSessions()
      persistState()
    }
  }

  function handleClearSession () {
    const session = getActiveSession()
    if (!session) return
    if (!window.confirm('Clear current session messages?')) return
    session.messages = [
      {
        role: 'system',
        text: SYSTEM_PROMPT,
      },
    ]
    session.latestExtractedExpression = null
    session.latestBatchPlan = null
    session.lastUiAnalysis = null
    session.lastFrameAnalysis = null
    resetPipelineState(session)
    session.updatedAt = Date.now()
    renderTranscript()
    persistState()
  }

  function handleClearAll () {
    if (
      !window.confirm(
        'Clear all sessions and reset?\n\nThis also deletes capture PNG temp files and requests Ollama to unload any models currently loaded in memory (if Ollama is running).'
      )
    ) {
      return
    }
    state.sessions = []
    state.activeSessionId = null
    state.nextSessionIndex = 1
    state.lastUiCaptureError = null
    state.includeUiCaptureInNextSend = false
    if (includeUiCaptureCheckboxEl) includeUiCaptureCheckboxEl.checked = false
    ensureInitialSession()
    renderSessions()
    renderTranscript()
    updateSendEnabled()
    persistState()
    runClearAllCachesAndOllamaUnload(function (summary) {
      if (summary) updateStatus(summary)
      else updateStatus('Готово.')
    })
  }

  function handleSend () {
    const text = (userInputEl && userInputEl.value) ? userInputEl.value.trim() : ''
    if (!text) return
    if (state.isRequestInFlight) return
    const session = getActiveSession()
    if (!session) return
    if (!isConfigValid()) {
      updateStatus('Set API key in config/secrets.local.js. See config/README.md')
      return
    }

    session.messages.push({ role: 'user', text: text })
    session.latestBatchPlan = null
    session.updatedAt = Date.now()
    userInputEl.value = ''
    renderTranscript()
    scrollTranscriptToBottom()
    persistState()

    state.isRequestInFlight = true
    updateSendEnabled()
    var runPromise = (isLikelyBatchIntent(text) || text.indexOf('/agent') === 0)
      ? runPhase7AgentFlow(session, text.replace(/^\/agent\s*/i, ''))
      : runPipelineFlow(session, text)
    runPromise
      .catch(function (err) {
        var diag = typeof window !== 'undefined' && window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS
        var userMsg = (err && err.message) ? err.message : String(err)
        if (diag && diag.normalizeRuntimeError) {
          var norm = diag.normalizeRuntimeError(err)
          if (diag.logError) diag.logError('Pipeline error', norm.category, err)
          userMsg = norm.userMessage
        }
        session.messages.push({
          role: 'system',
          text: 'Error contacting cloud model: ' + userMsg,
        })
        session.updatedAt = Date.now()
        renderTranscript()
        scrollTranscriptToBottom()
        updateStatus('Ошибка при обращении к облачному API.')
        updateModelStatus('error', 'model: offline / error')
      })
      .finally(function () {
        state.isRequestInFlight = false
        updateSendEnabled()
        updateApplyExpressionEnabled()
        if (!state.isRequestInFlight) {
          updateStatus('Готово.')
        }
      })
  }

  function handleApplyExpression () {
    const session = getActiveSession()
    if (!session || !session.latestExtractedExpression) return

    var expressionText = session.latestExtractedExpression

    if (typeof CSInterface === 'undefined') {
      session.messages.push({
        role: 'system',
        text: 'Cannot apply expression: CSInterface is not available in this environment.',
      })
      session.updatedAt = Date.now()
      renderTranscript()
      scrollTranscriptToBottom()
      return
    }

    var target = getResolvedTarget()
    if (!target) {
      session.messages.push({
        role: 'system',
        text: 'Select a layer and a property above (use @ to load layers, then pick from the lists), then click Apply Expression.',
      })
      session.updatedAt = Date.now()
      renderTranscript()
      scrollTranscriptToBottom()
      return
    }

    updatePromptTargetLine(target)

    var csInterface = new CSInterface()
    var scriptBody =
      'extensionsLlmChat_applyExpressionToTarget(' +
      Number(target.layerIndex) +
      ', ' +
      (typeof target.layerId === 'number' ? String(target.layerId) : 'null') +
      ', ' +
      JSON.stringify(target.propertyPath) +
      ', ' +
      JSON.stringify(expressionText) +
      ')'

    getHostScriptContent(function (hostContent) {
      var script = buildHostEvalScript(scriptBody, hostContent)
      csInterface.evalScript(script, function (resultString) {
        var statusMessage = 'Expression apply: unknown host response.'
        if (typeof resultString === 'string' && resultString.length) {
          try {
            var parsed = JSON.parse(resultString)
            if (parsed && typeof parsed.message === 'string') {
              statusMessage = parsed.message
              var extra = []
              if (parsed.compStatusCode) extra.push('status=' + parsed.compStatusCode)
              if (parsed.viewerType) extra.push('viewer=' + parsed.viewerType)
              if (parsed.projectActiveItemType) extra.push('activeItem=' + parsed.projectActiveItemType)
              if (extra.length) statusMessage += ' [' + extra.join(', ') + ']'
            }
          } catch (e) {
            statusMessage = 'Expression apply: non-JSON response from host.'
          }
        } else {
          statusMessage = 'Expression apply: empty response from host.'
        }

        session.messages.push({
          role: 'system',
          text: statusMessage,
        })
        session.updatedAt = Date.now()
        renderTranscript()
        scrollTranscriptToBottom()
      })
    })
  }

  function handleApplyBatchExpressions () {
    var session = getActiveSession()
    if (!session || !session.latestBatchPlan || !session.latestBatchPlan.length) return
    var batch = session.latestBatchPlan.slice()
    state.isRequestInFlight = true
    updateSendEnabled()
    updateApplyExpressionEnabled()
    updateStatus('Applying batch: 0/' + batch.length + '…')

    executeAllowedAgentToolCall('get_active_comp_summary', {})
      .then(function (sum) {
        if (!sum || !sum.ok) {
          throw new Error((sum && sum.message) || 'No active composition.')
        }
        return executeAllowedAgentToolCall('apply_expression_batch', { targets: batch })
      })
      .then(function (res) {
        session.updatedAt = Date.now()
        if (res && res.ok) {
          session.messages.push({
            role: 'system',
            text: (res.message || 'Batch apply completed.') + ' (manual apply policy preserved)',
          })
          updateStatus('Batch apply completed.')
        } else {
          session.messages.push({
            role: 'system',
            text: (res && res.message) || 'Batch apply failed.',
          })
          updateStatus('Batch apply failed.')
        }
        renderTranscript()
        scrollTranscriptToBottom()
        persistState()
      })
      .catch(function (err) {
        session.messages.push({
          role: 'system',
          text:
            'Batch apply failed: ' +
            (err && err.message ? err.message : String(err)) +
            '\nIf you just updated host/index.jsx, reload the panel so new host functions are loaded.',
        })
        session.updatedAt = Date.now()
        renderTranscript()
        scrollTranscriptToBottom()
        persistState()
        updateStatus('Batch apply failed.')
      })
      .finally(function () {
        state.isRequestInFlight = false
        updateSendEnabled()
        updateApplyExpressionEnabled()
      })
  }

  function scrollTranscriptToBottom () {
    if (!chatTranscriptEl) return
    chatTranscriptEl.scrollTop = chatTranscriptEl.scrollHeight
  }

  function renderSessions () {
    if (!sessionListEl) return
    sessionListEl.innerHTML = ''
    state.sessions.forEach(function (session) {
      const li = document.createElement('li')
      const titleSpan = document.createElement('span')
      titleSpan.className = 'session-title'
      titleSpan.textContent = session.title

      const modelSpan = document.createElement('span')
      modelSpan.className = 'session-model-badge'
      var label = 'Cloud model'
      if (session.model === 'Qwen/Qwen3-Coder-Next') {
        label = 'Qwen3'
      } else if (session.model === 'openai/gpt-oss-120b') {
        label = 'GPT-OSS 120B'
      }
      modelSpan.textContent = label

      li.appendChild(titleSpan)
      li.appendChild(modelSpan)
      li.className = 'session-item' + (session.id === state.activeSessionId ? ' active' : '')
      li.dataset.sessionId = session.id
      li.addEventListener('click', function () {
        setActiveSession(session.id)
      })
      sessionListEl.appendChild(li)
    })
  }

  function renderTranscript () {
    if (!chatTranscriptEl) return
    const session = getActiveSession()
    chatTranscriptEl.innerHTML = ''
    if (!session) return

    session.messages.forEach(function (msg, idx) {
      // Hide the initial large system prompt from the visible chat, but keep it in the session
      if (msg.role === 'system' && msg.text === SYSTEM_PROMPT && idx === 0) {
        return
      }
      const div = document.createElement('div')
      div.className =
        'chat-message ' +
        (msg.role === 'user' ? 'user' : (msg.role === 'assistant' ? 'assistant' : 'system'))

      if (msg.role === 'assistant') {
        renderAssistantMessage(div, msg.text)
      } else {
        div.textContent = '[' + msg.role + '] ' + msg.text
      }

      chatTranscriptEl.appendChild(div)
    })

    updateModelSelector()
    updateApplyExpressionEnabled()
    updateTargetSummary()
  }

  function handleModelChange () {
    const session = getActiveSession()
    if (!session || !modelSelectEl) return
    const value = modelSelectEl.value || DEFAULT_MODEL
    session.model = value
    session.updatedAt = Date.now()
  }

  function updateModelSelector () {
    if (!modelSelectEl) return
    const session = getActiveSession()
    if (!session) {
      modelSelectEl.value = DEFAULT_MODEL
      modelSelectEl.disabled = true
      return
    }
    modelSelectEl.disabled = state.isRequestInFlight
    if (session.model === FALLBACK_MODEL) {
      modelSelectEl.value = FALLBACK_MODEL
    } else {
      modelSelectEl.value = DEFAULT_MODEL
    }
  }

  // -------- Multi-pass pipeline: role prompts and structured output (Stage 3) --------
  const PIPELINE_GENERATOR_INSTRUCTION =
    'You are the generator role. Produce exactly one After Effects expression for the user request. ' +
    'Output format: (1) The expression only, no code fences. (2) A line: ---EXPLANATION--- (3) 1-5 short bullet points. ' +
    '(4) A line: ---STRUCTURED--- then a single JSON object with keys: expression (string), assumptions (string), target_confirmation (string), self_check_status (ok|warning|fail), self_check_notes (string); then ---END---.'
  const PIPELINE_VALIDATOR_INSTRUCTION =
    'You are the validator role. Check the given expression for correctness, AE API usage, and target match. ' +
    'Reply with a short human explanation, then a line ---REPORT--- then a single JSON object (raw JSON only; no markdown code fences) with keys: ' +
    'status (pass|warn|fail), issues (array of strings), fix_instructions (string), ae_invariants_checked (boolean), target_ok (boolean), explanation_for_user (string); then ---END---.'
  const PIPELINE_REPAIR_INSTRUCTION =
    'You are the repair role. Fix the given After Effects expression using the issues and fix_instructions. ' +
    'Output only the corrected expression, then ---EXPLANATION--- then 1-3 short bullets. No code fences. No ---STRUCTURED--- block.'
  const AGENT_STEP_INSTRUCTION =
    'You are an AE tool-using agent. If you need host data, return exactly one JSON object between ---AGENT_STEP--- and ---END--- with action="tool_call", tool_name and arguments. ' +
    'When ready, return ---AGENT_STEP--- JSON ---END--- with action="final", final_message (string), and batch (array of objects with keys: layer (string), property (string), expression (string), notes (string optional)). ' +
    'Allow-listed tools: get_active_comp_summary(arguments {}), get_host_context(arguments {}). Do not request tools outside this allow-list. No markdown fences inside the JSON block.'
  const AGENT_MAX_STEPS = 6

  function parseAgentStep (rawContent) {
    var parsed = tryParseJsonBlock(rawContent, '---AGENT_STEP---', '---END---')
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  }

  function isLikelyBatchIntent (text) {
    if (!text || typeof text !== 'string') return false
    var s = text.toLowerCase()
    return (
      s.indexOf('batch') !== -1 ||
      s.indexOf('multi') !== -1 ||
      s.indexOf('several') !== -1 ||
      /\b\d+\s+layers?\b/.test(s) ||
      (s.indexOf('expressions') !== -1 && (s.indexOf('layers') !== -1 || s.indexOf('properties') !== -1)) ||
      s.indexOf('multiple layers') !== -1 ||
      s.indexOf('different layers') !== -1
    )
  }

  function evalHostFunctionPromise (expression) {
    return new Promise(function (resolve, reject) {
      if (typeof CSInterface === 'undefined') {
        reject(new Error('CSInterface is not available.'))
        return
      }
      getHostScriptContent(function (hostContent) {
        var script = buildHostEvalScript(expression, hostContent)
        try {
          var csInterface = new CSInterface()
          csInterface.evalScript(script, function (resultString) {
            if (typeof resultString !== 'string' || !resultString.length) {
              reject(new Error('Empty host response.'))
              return
            }
            try {
              resolve(JSON.parse(resultString))
            } catch (e) {
              var snippet = resultString.length > 220 ? resultString.slice(0, 220) + '…' : resultString
              reject(new Error('Non-JSON host response: ' + snippet))
            }
          })
        } catch (e2) {
          reject(e2 instanceof Error ? e2 : new Error(String(e2)))
        }
      })
    })
  }

  function executeAllowedAgentToolCall (toolName, args) {
    var t = typeof toolName === 'string' ? toolName : ''
    var a = args && typeof args === 'object' ? args : {}
    if (t === 'get_active_comp_summary') {
      return evalHostFunctionPromise('extensionsLlmChat_getActiveCompSummary()')
    }
    if (t === 'get_host_context') {
      return evalHostFunctionPromise('extensionsLlmChat_getHostContext()')
    }
    if (t === 'apply_expression_to_target') {
      var layerIndex = typeof a.layerIndex === 'number' ? a.layerIndex : parseInt(a.layerIndex, 10)
      var layerId = typeof a.layerId === 'number' ? a.layerId : null
      var propertyPath = typeof a.propertyPath === 'string' ? a.propertyPath : ''
      var expressionText = typeof a.expressionText === 'string' ? a.expressionText : ''
      var scriptBody =
        'extensionsLlmChat_applyExpressionToTarget(' +
        Number(layerIndex) +
        ', ' +
        (typeof layerId === 'number' ? String(layerId) : 'null') +
        ', ' +
        JSON.stringify(propertyPath) +
        ', ' +
        JSON.stringify(expressionText) +
        ')'
      return evalHostFunctionPromise(scriptBody)
    }
    if (t === 'apply_expression_batch') {
      var targets = Array.isArray(a.targets) ? a.targets : []
      var scriptBatch = 'extensionsLlmChat_applyExpressionBatch(' + JSON.stringify(targets) + ')'
      return evalHostFunctionPromise(scriptBatch)
    }
    return Promise.reject(new Error('Tool is not allow-listed: ' + t))
  }

  function normalizeBatchPlanItems (batchRaw, summary) {
    var items = []
    var issues = []
    if (!Array.isArray(batchRaw) || !batchRaw.length) {
      return { items: items, issues: ['Batch plan is empty.'] }
    }
    var layers = summary && summary.layers ? summary.layers : []
    batchRaw.forEach(function (item, idx) {
      if (!item || typeof item !== 'object') {
        issues.push('Item ' + (idx + 1) + ': not an object.')
        return
      }
      var layerHint = typeof item.layer === 'string' ? item.layer.trim() : ''
      var propertyPath = typeof item.property === 'string' ? item.property.trim() : ''
      var expr = sanitizeExpression(typeof item.expression === 'string' ? item.expression : '')
      if (!propertyPath || !expr) {
        issues.push('Item ' + (idx + 1) + ': missing property or expression.')
        return
      }
      var layerMatch = null
      var layerIndex = parseInt(layerHint, 10)
      if (!isNaN(layerIndex)) {
        layerMatch = layers.find(function (l) { return l.index === layerIndex })
      }
      if (!layerMatch && layerHint) {
        var low = layerHint.toLowerCase()
        layerMatch = layers.find(function (l) { return String(l.name || '').toLowerCase() === low })
      }
      if (!layerMatch) {
        issues.push('Item ' + (idx + 1) + ': layer not found (' + (layerHint || 'empty') + ').')
        return
      }
      var propMatch = (layerMatch.properties || []).find(function (p) { return p.path === propertyPath })
      if (!propMatch) {
        issues.push('Item ' + (idx + 1) + ': property not found (' + propertyPath + ') on layer "' + layerMatch.name + '".')
        return
      }
      items.push({
        layerIndex: layerMatch.index,
        layerId: typeof layerMatch.id === 'number' ? layerMatch.id : null,
        layerName: layerMatch.name,
        propertyPath: propMatch.path,
        propertyDisplayName: propMatch.displayName,
        expressionText: expr,
        notes: typeof item.notes === 'string' ? item.notes.trim() : '',
      })
    })
    return { items: items, issues: issues }
  }

  function buildBatchAssistantText (finalMessage, items, issues) {
    var lines = []
    lines.push((finalMessage || 'Batch plan is ready.').trim())
    lines.push('---EXPLANATION---')
    lines.push('- Generated a structured multi-target plan with manual apply only.')
    lines.push('- Review targets and run "Apply Batch" to execute per target.')
    if (issues && issues.length) {
      lines.push('---NOTES---')
      issues.forEach(function (it) { lines.push('- ' + it) })
    }
    return lines.join('\n')
  }

  function runPhase7AgentFlow (session, userText) {
    var diag = typeof window !== 'undefined' && window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS
    var messages = [
      { role: 'system', content: SYSTEM_PROMPT + '\n\n' + AGENT_STEP_INSTRUCTION },
      { role: 'user', content: userText || '' },
    ]
    var summary = null
    state.isAgentToolLoopInFlight = true
    updateStatus('Agent loop: preparing tools…')
    updateModelStatus('unknown', 'model: checking...')
    function step (i) {
      if (i >= AGENT_MAX_STEPS) {
        return Promise.reject(new Error('Agent reached max tool-loop steps.'))
      }
      updateStatus('Agent loop: step ' + (i + 1) + '/' + AGENT_MAX_STEPS + '…')
      return invokeCloudChatWithFallback(DEFAULT_MODEL, FALLBACK_MODEL, messages)
        .then(function (data) {
          var normalized = normalizeChatResponse(data)
          updateModelStatus('ok', 'model: online')
          var parsed = parseAgentStep(normalized.content)
          if (!parsed || !parsed.action) {
            return Promise.reject(new Error('Agent response missing ---AGENT_STEP--- JSON block.'))
          }
          if (parsed.action === 'tool_call') {
            var toolName = typeof parsed.tool_name === 'string' ? parsed.tool_name : ''
            var args = parsed.arguments && typeof parsed.arguments === 'object' ? parsed.arguments : {}
            if (toolName === 'apply_expression_to_target') {
              messages.push({ role: 'assistant', content: normalized.content })
              messages.push({
                role: 'system',
                content: 'TOOL_RESULT ' + JSON.stringify({
                  tool_name: toolName,
                  ok: false,
                  error: 'mutating tools are blocked during planning; manual Apply Batch is required',
                }),
              })
              return step(i + 1)
            }
            return executeAllowedAgentToolCall(toolName, args)
              .then(function (toolResult) {
                if (toolName === 'get_active_comp_summary' && toolResult && toolResult.ok) {
                  summary = toolResult
                  state.compSummary = toolResult
                }
                messages.push({ role: 'assistant', content: normalized.content })
                messages.push({
                  role: 'system',
                  content:
                    'TOOL_RESULT ' +
                    JSON.stringify({
                      tool_name: toolName,
                      ok: !!(toolResult && toolResult.ok),
                      result: toolResult || null,
                    }),
                })
                return step(i + 1)
              })
          }
          if (parsed.action === 'final') {
            var fallbackSummary = summary
              ? Promise.resolve(summary)
              : executeAllowedAgentToolCall('get_active_comp_summary', {})
            return fallbackSummary.then(function (sum) {
              summary = sum
              if (!summary || !summary.ok) {
                throw new Error((summary && summary.message) || 'No active composition for batch plan.')
              }
              var norm = normalizeBatchPlanItems(parsed.batch, summary)
              session.latestBatchPlan = norm.items.length ? norm.items : null
              session.latestExtractedExpression = null
              session.updatedAt = Date.now()
              var assistantText = buildBatchAssistantText(parsed.final_message, norm.items, norm.issues)
              session.messages.push({ role: 'assistant', text: assistantText })
              if (norm.items.length) {
                session.messages.push({
                  role: 'system',
                  text: 'Batch plan ready with ' + norm.items.length + ' item(s). Use Apply Batch to run it manually.',
                })
              } else {
                session.messages.push({
                  role: 'system',
                  text: 'No valid batch items were produced. Check target layer/property names and retry.',
                })
              }
              renderTranscript()
              scrollTranscriptToBottom()
              persistState()
            })
          }
          return Promise.reject(new Error('Unknown agent action: ' + String(parsed.action)))
        })
    }
    return step(0)
      .finally(function () {
        state.isAgentToolLoopInFlight = false
      })
      .catch(function (err) {
        if (diag && diag.logError) diag.logError('Agent tool loop failed', 'agent_loop', err)
        throw err
      })
  }

  /**
   * Strip optional markdown code fences from the outer edges of a block (e.g. ```json ... ```).
   * Only removes leading/trailing fence lines so JSON content is unchanged. Used to tolerate model output that wraps JSON in fences.
   */
  function stripOuterJsonFences (block) {
    if (!block || typeof block !== 'string') return block
    var s = block.trim()
    // Leading fence: optional whitespace, ```, optional language id, newline
    if (/^\s*```\w*\s*\n?/.test(s)) {
      s = s.replace(/^\s*```\w*\s*\n?/, '')
    }
    // Trailing fence: newline, optional whitespace, ```
    if (/\n?\s*```\s*$/.test(s)) {
      s = s.replace(/\n?\s*```\s*$/, '')
    }
    return s.trim()
  }

  function tryParseJsonBlock (content, startMarker, endMarker) {
    var diag = typeof window !== 'undefined' && window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS
    if (!content || typeof content !== 'string') return null
    var start = content.indexOf(startMarker)
    if (start === -1) return null
    start += startMarker.length
    var end = content.indexOf(endMarker, start)
    if (end === -1) return null
    var block = content.slice(start, end).trim()
    var stripped = stripOuterJsonFences(block)
    try {
      var parsed = JSON.parse(stripped)
      if (stripped !== block && diag && diag.logDebug) {
        diag.logDebug('[pipeline] JSON block had outer fences stripped before parse')
      }
      return parsed
    } catch (e) {
      return null
    }
  }

  function parseGeneratorStructuredResponse (rawContent) {
    var diag = typeof window !== 'undefined' && window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS
    var parsed = tryParseJsonBlock(rawContent, '---STRUCTURED---', '---END---')
    if (parsed && typeof parsed.expression === 'string') {
      var expr = sanitizeExpression(parsed.expression)
      if (expr && expr.indexOf('---EXPLANATION---') === -1 && expr.indexOf('---NOTES---') === -1) {
        return {
          expression: expr,
          assumptions: typeof parsed.assumptions === 'string' ? parsed.assumptions : '',
          target_confirmation: typeof parsed.target_confirmation === 'string' ? parsed.target_confirmation : '',
          self_check_status: parsed.self_check_status === 'ok' || parsed.self_check_status === 'warning' || parsed.self_check_status === 'fail' ? parsed.self_check_status : 'unknown',
          self_check_notes: typeof parsed.self_check_notes === 'string' ? parsed.self_check_notes : '',
        }
      }
    }
    if (diag && diag.logDebug) {
      var sample = diag.sanitizeForLog ? diag.sanitizeForLog(rawContent, 80) : (rawContent ? String(rawContent).slice(0, 80) : '')
      diag.logDebug('[pipeline] generator parse failed; using fallback extraction', sample)
    }
    var fallbackExpr = extractExpressionFromResponse(rawContent)
    return {
      expression: fallbackExpr || '',
      assumptions: '',
      target_confirmation: '',
      self_check_status: fallbackExpr ? 'unknown' : 'fail',
      self_check_notes: 'Structured parse failed; used fallback extraction.',
    }
  }

  function parseValidatorStructuredReport (rawContent) {
    var diag = typeof window !== 'undefined' && window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS
    var parsed = tryParseJsonBlock(rawContent, '---REPORT---', '---END---')
    if (parsed) {
      return {
        status: parsed.status === 'pass' || parsed.status === 'warn' || parsed.status === 'fail' ? parsed.status : 'unknown',
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        fix_instructions: typeof parsed.fix_instructions === 'string' ? parsed.fix_instructions : '',
        ae_invariants_checked: !!parsed.ae_invariants_checked,
        target_ok: !!parsed.target_ok,
        explanation_for_user: typeof parsed.explanation_for_user === 'string' ? parsed.explanation_for_user : '',
      }
    }
    if (diag && diag.logDebug) {
      var sample = diag.sanitizeForLog ? diag.sanitizeForLog(rawContent, 80) : (rawContent ? String(rawContent).slice(0, 80) : '')
      diag.logDebug('[pipeline] validator parse failed; status=unknown', sample)
    }
    return {
      status: 'unknown',
      issues: [],
      fix_instructions: '',
      ae_invariants_checked: false,
      target_ok: false,
      explanation_for_user: 'Validator response could not be parsed.',
    }
  }

  /**
   * Deterministic rules layer (non-LLM). Checks expression and target against extension constraints.
   * Runs leftover-marker checks after sanitization so harmless leading/trailing fences do not cause false blocks.
   * Returns { passed: boolean, block: boolean, issues: string[], sanitizedExpression?: string }.
   * When passed, sanitizedExpression is the expression to use downstream (fences/markers stripped).
   */
  function runDeterministicRules (expression, targetSnapshot) {
    var issues = []
    if (!expression || typeof expression !== 'string') {
      issues.push('missing or empty expression')
      return { passed: false, block: true, issues: issues }
    }
    var trimmed = expression.trim()
    if (!trimmed) {
      issues.push('expression is blank after trim')
      return { passed: false, block: true, issues: issues }
    }
    var sanitized = sanitizeExpression(trimmed)
    if (!sanitized) {
      issues.push('expression invalid after sanitization')
      return { passed: false, block: true, issues: issues }
    }
    if (sanitized.indexOf('---EXPLANATION---') !== -1 || sanitized.indexOf('---NOTES---') !== -1 || sanitized.indexOf('```') !== -1) {
      issues.push('leftover wrapper markers or malformed formatting in expression')
      return { passed: false, block: true, issues: issues }
    }
    // Source Text: value may be string; value.text can be undefined and cause TypeError.
    if (targetSnapshot && targetSnapshot.propertyPath === 'Text>Source Text') {
      var hasValueDotText = /\bvalue\s*\.\s*text\b/.test(sanitized)
      var hasDefensiveCheck = /typeof\s+value\s*===?\s*['"]string['"]|value\s*\?\s*\.\s*text|value\s*\?\s*value\s*\.\s*text|value\s*&&\s*value\s*\.\s*text/.test(sanitized)
      if (hasValueDotText && !hasDefensiveCheck) {
        issues.push('Source Text: value may be a string; using value.text can cause TypeError. Use (typeof value === \'string\' ? value : value.text) or documented text APIs.')
      }
    }
    if (targetSnapshot && (targetSnapshot.propertyPath || targetSnapshot.layerName)) {
      if (!targetSnapshot.compName || !targetSnapshot.propertyPath) {
        issues.push('target context incomplete for apply path')
      }
    }
    return {
      passed: issues.length === 0,
      block: issues.length > 0,
      issues: issues,
      sanitizedExpression: issues.length === 0 ? sanitized : undefined,
    }
  }

  /**
   * Assemble request payload (messages + docs context + target instruction) for a single-pass call.
   * Returns { payloadMessages, docsRetrieval, targetSnapshot } for use by invokeCloudChat and processAssistantResponse.
   */
  function buildSinglePassPayload (session) {
    var lastUserIndex = -1
    for (var i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === 'user') {
        lastUserIndex = i
        break
      }
    }
    var lastUserMessage = lastUserIndex >= 0 ? session.messages[lastUserIndex] : null
    var docsRetrieval = null
    var retrievalQueryText = lastUserMessage ? lastUserMessage.text : ''
    var targetSnapshot = getResolvedTarget()
    if (targetSnapshot) {
      retrievalQueryText +=
        '\n[TARGET_LAYER:' +
        targetSnapshot.layerName +
        '] [TARGET_PROPERTY:' +
        targetSnapshot.propertyDisplayName +
        ']'
    }
    if (RETRIEVE_DOCS && retrievalQueryText) {
      docsRetrieval = RETRIEVE_DOCS(retrievalQueryText, { maxSnippets: 6 })
    }
    var payloadMessages = []
    session.messages.forEach(function (msg, idx) {
      if (idx === lastUserIndex) {
        if (docsRetrieval && BUILD_DOCS_CONTEXT_MESSAGE) {
          var docsUserText = lastUserMessage ? lastUserMessage.text : ''
          if (targetSnapshot) {
            docsUserText +=
              '\n\nSelected target: comp "' +
              targetSnapshot.compName +
              '", layer "' +
              targetSnapshot.layerName +
              '", property ' +
              targetSnapshot.propertyDisplayName +
              '.'
          }
          payloadMessages.push({
            role: 'system',
            content: BUILD_DOCS_CONTEXT_MESSAGE(docsUserText, docsRetrieval),
          })
        }
        if (targetSnapshot) {
          var targetInstruction =
            'For this request, you MUST generate a single After Effects expression intended for the property "' +
            targetSnapshot.propertyDisplayName +
            '" (path "' +
            targetSnapshot.propertyPath +
            '") on layer "' +
            targetSnapshot.layerName +
            '" in comp "' +
            targetSnapshot.compName +
            '". Do not write expressions that target a different property or context.'
          payloadMessages.push({
            role: 'system',
            content: targetInstruction,
          })
        }
      }
      payloadMessages.push({
        role: msg.role,
        content: msg.text,
      })
    })
    return { payloadMessages: payloadMessages, docsRetrieval: docsRetrieval, targetSnapshot: targetSnapshot }
  }

  function buildPipelineGeneratorPayload (session, userText, targetSnapshot, docsRetrieval, extraGrounding) {
    var eg = extraGrounding || {}
    var diag = typeof window !== 'undefined' && window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS
    var systemContent = null
    if (typeof window !== 'undefined' && window.PIPELINE_ASSEMBLY && window.KB_CORPUS_INDEX) {
      try {
        var grounding = window.PIPELINE_ASSEMBLY.getGroundingForRole('generator')
        systemContent = window.PIPELINE_ASSEMBLY.getGeneratorSystemWithGrounding(grounding)
      } catch (e) {}
    }
    if (!systemContent) {
      if (diag && diag.logDebug) diag.logDebug('[pipeline] prompt assembly degraded to inline', 'generator')
      systemContent = SYSTEM_PROMPT + '\n\n' + PIPELINE_GENERATOR_INSTRUCTION
    }
    var messages = [{ role: 'system', content: systemContent }]
    if (eg.hostBlock) messages.push({ role: 'system', content: eg.hostBlock })
    if (docsRetrieval && BUILD_DOCS_CONTEXT_MESSAGE) {
      var docsUser = userText || ''
      if (targetSnapshot) {
        docsUser += '\n\nSelected target: comp "' + targetSnapshot.compName + '", layer "' + targetSnapshot.layerName + '", property ' + targetSnapshot.propertyDisplayName + '.'
      }
      messages.push({ role: 'system', content: BUILD_DOCS_CONTEXT_MESSAGE(docsUser, docsRetrieval) })
    }
    if (eg.frameBlock) messages.push({ role: 'system', content: eg.frameBlock })
    if (eg.uiBlock) messages.push({ role: 'system', content: eg.uiBlock })
    if (targetSnapshot) {
      messages.push({
        role: 'system',
        content: 'Generate a single After Effects expression for property "' + targetSnapshot.propertyDisplayName + '" (path "' + targetSnapshot.propertyPath + '") on layer "' + targetSnapshot.layerName + '" in comp "' + targetSnapshot.compName + '".',
      })
    }
    messages.push({ role: 'user', content: userText || '' })
    return messages
  }

  function buildPipelineValidatorPayload (expression, targetSnapshot, validatorContext) {
    var diag = typeof window !== 'undefined' && window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS
    var systemContent = null
    if (typeof window !== 'undefined' && window.PIPELINE_ASSEMBLY && window.KB_CORPUS_INDEX) {
      try {
        var grounding = window.PIPELINE_ASSEMBLY.getGroundingForRole('validator')
        systemContent = window.PIPELINE_ASSEMBLY.getValidatorSystemWithGrounding(grounding)
      } catch (e) {}
    }
    if (!systemContent) {
      if (diag && diag.logDebug) diag.logDebug('[pipeline] prompt assembly degraded to inline', 'validator')
      systemContent = SYSTEM_PROMPT + '\n\n' + PIPELINE_VALIDATOR_INSTRUCTION
    }
    var user = 'Validate this expression:\n\n' + expression
    if (targetSnapshot) {
      user += '\n\nTarget: comp "' + targetSnapshot.compName + '", layer "' + targetSnapshot.layerName + '", property ' + targetSnapshot.propertyDisplayName + ' (path ' + targetSnapshot.propertyPath + ').'
    }
    if (validatorContext) {
      user += '\n\nContext: ' + validatorContext
    }
    return [
      { role: 'system', content: systemContent },
      { role: 'user', content: user },
    ]
  }

  function buildPipelineRepairPayload (expression, issues, fixInstructions, targetSnapshot) {
    var diag = typeof window !== 'undefined' && window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS
    var systemContent = null
    if (typeof window !== 'undefined' && window.PIPELINE_ASSEMBLY && window.KB_CORPUS_INDEX) {
      try {
        var grounding = window.PIPELINE_ASSEMBLY.getGroundingForRole('repair')
        systemContent = window.PIPELINE_ASSEMBLY.getRepairSystemWithGrounding(grounding)
      } catch (e) {}
    }
    if (!systemContent) {
      if (diag && diag.logDebug) diag.logDebug('[pipeline] prompt assembly degraded to inline', 'repair')
      systemContent = SYSTEM_PROMPT + '\n\n' + PIPELINE_REPAIR_INSTRUCTION
    }
    var user = 'Fix this expression.\n\nCurrent expression:\n' + expression + '\n\nIssues:\n' + (issues && issues.length ? issues.join('\n') : 'None specified') + '\n\nFix instructions: ' + (fixInstructions || 'Address the issues above.')
    if (targetSnapshot) {
      user += '\n\nTarget: ' + targetSnapshot.propertyDisplayName + ' on layer "' + targetSnapshot.layerName + '" in comp "' + targetSnapshot.compName + '".'
    }
    return [
      { role: 'system', content: systemContent },
      { role: 'user', content: user },
    ]
  }

  /**
   * Invoke cloud chat/completions API. Returns a promise that resolves with raw API response data.
   */
  function invokeCloudChat (model, payloadMessages) {
    var body = {
      model: model,
      messages: payloadMessages,
      max_tokens: 2500,
      temperature: 0.5,
      presence_penalty: 0,
      top_p: 0.95,
    }
    return fetch(CLOUD_API_CHAT_COMPLETIONS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + CLOUD_API_KEY,
      },
      body: JSON.stringify(body),
    }).then(function (res) {
      if (!res.ok) {
        throw new Error('Cloud model HTTP error ' + res.status + ' ' + res.statusText)
      }
      return res.json()
    })
  }

  /**
   * Invoke cloud chat with runtime fallback: on HTTP/network/malformed response error, retry once with fallbackModel.
   * Use only for execution failures, not for semantic/validation failure.
   */
  function invokeCloudChatWithFallback (primaryModel, fallbackModel, payloadMessages) {
    var diag = typeof window !== 'undefined' && window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS
    return invokeCloudChat(primaryModel, payloadMessages).catch(function (err) {
      if (fallbackModel && fallbackModel !== primaryModel) {
        if (diag && diag.logDebug) {
          var msg = (err && err.message) ? err.message : String(err)
          var safe = diag.sanitizeForLog ? diag.sanitizeForLog(msg, 80) : msg.slice(0, 80)
          diag.logDebug('[pipeline] fallback model activation', fallbackModel, 'primary failed', safe)
        }
        return invokeCloudChat(fallbackModel, payloadMessages)
      }
      throw err
    })
  }

  /**
   * Normalize cloud response to { content: string }. Throws on malformed response.
   */
  function normalizeChatResponse (data) {
    if (!data) {
      throw new Error('Empty response from cloud model')
    }
    var choices = data.choices
    if (!choices || !choices.length || !choices[0].message || typeof choices[0].message.content !== 'string') {
      throw new Error('Malformed cloud model response')
    }
    return { content: choices[0].message.content }
  }

  /**
   * Process assistant response: optional validation annotation, push message, extract expression, update session.
   */
  function processAssistantResponse (content, session, docsRetrieval) {
    var assistantText = content
    if (ANNOTATE_WITH_VALIDATION && docsRetrieval) {
      try {
        assistantText = ANNOTATE_WITH_VALIDATION(assistantText, docsRetrieval)
      } catch (e) {}
    }
    session.messages.push({
      role: 'assistant',
      text: assistantText,
    })
    var extracted = extractExpressionFromResponse(assistantText)
    if (extracted) {
      session.latestExtractedExpression = extracted
    } else {
      session.latestExtractedExpression = null
      session.messages.push({
        role: 'system',
        text: 'Model output did not contain a clean, standalone expression. Nothing was applied.',
      })
    }
    session.updatedAt = Date.now()
    renderTranscript()
    scrollTranscriptToBottom()
    persistState()
  }

  /**
   * Chat service: call the cloud model for a given session (single-pass).
   * Uses buildSinglePassPayload, invokeCloudChat, normalizeChatResponse, processAssistantResponse.
   */
  function callOllamaForSession (session) {
    var payload = buildSinglePassPayload(session)
    var model = session.model || DEFAULT_MODEL
    return invokeCloudChat(model, payload.payloadMessages)
      .then(function (data) {
        var normalized = normalizeChatResponse(data)
        updateModelStatus('ok', 'model: online')
        processAssistantResponse(normalized.content, session, payload.docsRetrieval)
      })
  }

  /**
   * Current working send flow: single-pass request with pipeline state and status updates.
   * Kept as internal fallback when pipeline is not used (e.g. transport fallback or dev).
   */
  function runCurrentSinglePassFlow (session) {
    ensureSessionPipelineState(session)
    resetPipelineState(session)
    setPipelineStage(session, 'generate', 'running', 'Отправка запроса к облачной модели...')
    updateModelStatus('unknown', 'model: checking...')
    return callOllamaForSession(session)
      .then(function () {
        finalizePipelineState(session, 'success', 'Готово.')
      })
      .catch(function (err) {
        finalizePipelineState(session, 'error', 'Ошибка при обращении к облачному API.')
        throw err
      })
  }

  /**
   * Publish only the final result to chat (one assistant or system message). Called at pipeline finalize.
   * disposition: 'acceptable' | 'warned_draft' | 'blocked'
   */
  function publishFinalResultToChat (session, disposition, displayText, finalExpression) {
    if (disposition === 'acceptable' || disposition === 'warned_draft') {
      session.messages.push({ role: 'assistant', text: displayText })
      if (disposition === 'acceptable' && finalExpression) {
        session.latestExtractedExpression = finalExpression
      } else {
        session.latestExtractedExpression = null
      }
    } else {
      session.messages.push({ role: 'system', text: displayText || 'Expression could not be produced or validated. Please try again or rephrase.' })
      session.latestExtractedExpression = null
    }
    session.updatedAt = Date.now()
    renderTranscript()
    scrollTranscriptToBottom()
    persistState()
    updateApplyExpressionEnabled()
  }

  /**
   * Build display text for the panel (expression + ---EXPLANATION--- + bullets [+ ---NOTES---]).
   */
  function buildDisplayTextForResult (expression, explanationBullets, notesBullets) {
    var out = (expression || '').trim()
    if (!out) return ''
    out += '\n---EXPLANATION---\n'
    if (explanationBullets && explanationBullets.length) {
      explanationBullets.forEach(function (b) {
        out += '- ' + (b || '').trim() + '\n'
      })
    } else {
      out += '- Expression generated and validated.\n'
    }
    if (notesBullets && notesBullets.length) {
      out += '---NOTES---\n'
      notesBullets.forEach(function (b) {
        out += '- ' + (b || '').trim() + '\n'
      })
    }
    return out
  }

  /**
   * Multi-pass pipeline: prepare → generate → validate1 → rules → validate2 → repair1/repair2 if needed → finalize.
   * User sees only the final result in chat; status line shows stage progress.
   */
  function runPipelineFlow (session, userText) {
    var diag = typeof window !== 'undefined' && window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS
    if (diag && diag.logDebug) diag.logDebug('[pipeline] flow started')

    ensureSessionPipelineState(session)
    resetPipelineState(session)
    updateModelStatus('unknown', 'model: checking...')

    var targetSnapshot = getResolvedTarget()
    var docsRetrieval = null
    if (RETRIEVE_DOCS && userText) {
      var retrievalQuery = userText
      if (targetSnapshot) {
        retrievalQuery += '\n[TARGET_LAYER:' + targetSnapshot.layerName + '] [TARGET_PROPERTY:' + targetSnapshot.propertyDisplayName + ']'
      }
      docsRetrieval = RETRIEVE_DOCS(retrievalQuery, { maxSnippets: 6 })
    }

    setPipelineStage(session, 'prepare', 'running', 'Preparing request…')
    var genResult = null
    var report1 = null
    var report2 = null
    var rulesResult = null
    var currentExpression = null
    var finalDisposition = 'blocked'
    var displayExplanation = []
    var displayNotes = []
    var extraGrounding = { hostBlock: '', frameBlock: '', uiBlock: '' }

    function doGenerate () {
      if (diag && diag.logDebug) diag.logDebug('[pipeline] stage=generate entry')
      setPipelineStage(session, 'generate', 'running', 'Generating expression…')
      var messages = buildPipelineGeneratorPayload(session, userText, targetSnapshot, docsRetrieval, extraGrounding)
      return invokeCloudChatWithFallback(DEFAULT_MODEL, FALLBACK_MODEL, messages)
        .then(function (data) {
          var normalized = normalizeChatResponse(data)
          updateModelStatus('ok', 'model: online')
          genResult = parseGeneratorStructuredResponse(normalized.content)
          currentExpression = genResult.expression || null
          if (genResult.assumptions) displayNotes.push(genResult.assumptions)
          if (genResult.self_check_notes) displayNotes.push(genResult.self_check_notes)
          if (diag && diag.logDebug) diag.logDebug('[pipeline] stage=generate exit', currentExpression ? 'ok' : 'blocked')
          if (!currentExpression) {
            finalDisposition = 'blocked'
            return Promise.reject(new Error('Generator did not produce a valid expression.'))
          }
        })
    }

    function doValidate1 () {
      if (diag && diag.logDebug) diag.logDebug('[pipeline] stage=validate1 entry')
      setPipelineStage(session, 'validate1', 'running', 'Validating expression…')
      var messages = prependGroundingToRoleMessages(
        buildPipelineValidatorPayload(currentExpression, targetSnapshot, null),
        extraGrounding
      )
      return invokeCloudChatWithFallback(DEFAULT_MODEL, FALLBACK_MODEL, messages)
        .then(function (data) {
          var normalized = normalizeChatResponse(data)
          report1 = parseValidatorStructuredReport(normalized.content)
          if (report1.explanation_for_user) displayExplanation.push(report1.explanation_for_user)
          if (diag && diag.logDebug) diag.logDebug('[pipeline] stage=validate1 exit', report1.status || 'unknown')
        })
    }

    function doRules () {
      if (diag && diag.logDebug) diag.logDebug('[pipeline] stage=rules entry')
      setPipelineStage(session, 'rules', 'running', 'Applying checks…')
      rulesResult = runDeterministicRules(currentExpression, targetSnapshot)
      if (diag && diag.logDebug) diag.logDebug('[pipeline] stage=rules exit', rulesResult.block ? 'blocked' : 'ok')
      if (rulesResult.block) {
        finalDisposition = 'blocked'
        return Promise.reject(new Error('Rules check failed: ' + (rulesResult.issues && rulesResult.issues.length ? rulesResult.issues.join('; ') : 'invalid')))
      }
      if (rulesResult.sanitizedExpression) {
        currentExpression = rulesResult.sanitizedExpression
      }
    }

    function doValidate2 () {
      if (diag && diag.logDebug) diag.logDebug('[pipeline] stage=validate2 entry')
      setPipelineStage(session, 'validate2', 'running', 'Validating expression…')
      var messages = prependGroundingToRoleMessages(
        buildPipelineValidatorPayload(
          currentExpression,
          targetSnapshot,
          report1 ? ('Previous check: ' + report1.status + '. ' + (report1.fix_instructions || '')) : null
        ),
        extraGrounding
      )
      return invokeCloudChatWithFallback(DEFAULT_MODEL, FALLBACK_MODEL, messages)
        .then(function (data) {
          var normalized = normalizeChatResponse(data)
          report2 = parseValidatorStructuredReport(normalized.content)
          if (report2.explanation_for_user) displayExplanation.push(report2.explanation_for_user)
          if (diag && diag.logDebug) diag.logDebug('[pipeline] stage=validate2 exit', report2.status || 'unknown')
        })
    }

    function doRepair (attempt) {
      if (diag && diag.logDebug) diag.logDebug('[pipeline] stage=repair entry', 'attempt=' + attempt)
      setPipelineStage(session, 'repair', 'running', 'Repairing expression…')
      var issues = []
      var fixInstructions = ''
      if (report1 && report1.issues && report1.issues.length) issues = issues.concat(report1.issues)
      if (report2 && report2.issues && report2.issues.length) issues = issues.concat(report2.issues)
      if (report1 && report1.fix_instructions) fixInstructions = report1.fix_instructions
      if (report2 && report2.fix_instructions) fixInstructions = fixInstructions ? fixInstructions + ' ' + report2.fix_instructions : report2.fix_instructions
      var messages = prependGroundingToRoleMessages(
        buildPipelineRepairPayload(currentExpression, issues, fixInstructions, targetSnapshot),
        extraGrounding
      )
      return invokeCloudChat(FALLBACK_MODEL, messages)
        .then(function (data) {
          var normalized = normalizeChatResponse(data)
          var repaired = extractExpressionFromResponse(normalized.content)
          if (repaired) {
            currentExpression = repaired
            var rules = runDeterministicRules(currentExpression, targetSnapshot)
            if (rules.block) {
              if (diag && diag.logDebug) diag.logDebug('[pipeline] stage=repair exit', 'rules blocked after repair')
              if (attempt < 2) return doRepair(attempt + 1)
              finalDisposition = 'warned_draft'
              displayNotes.push('Repair attempted but checks still reported issues.')
            } else if (diag && diag.logDebug) diag.logDebug('[pipeline] stage=repair exit', 'ok')
          } else {
            if (diag && diag.logDebug) {
              var sample = diag.sanitizeForLog ? diag.sanitizeForLog(normalized.content, 80) : (normalized.content ? String(normalized.content).slice(0, 80) : '')
              diag.logDebug('[pipeline] repair extraction failed', 'attempt=' + attempt, sample)
            }
            if (attempt < 2) return doRepair(attempt + 1)
            if (diag && diag.logDebug) diag.logDebug('[pipeline] stage=repair exit', 'extraction failed, exhausted retries')
          }
        })
    }

    function doFinalize () {
      if (diag && diag.logDebug) diag.logDebug('[pipeline] stage=finalize entry')
      setPipelineStage(session, 'finalize', 'running', 'Finalizing…')
      var needRepair = (report1 && report1.status === 'fail') || (report2 && report2.status === 'fail') ||
        ((report1 && report1.status === 'warn') && (report2 && report2.status === 'warn'))
      if (needRepair && currentExpression) {
        return doRepair(1).then(function () {
          decideAndPublish()
        })
      }
      decideAndPublish()
      return Promise.resolve()
    }

    function decideAndPublish () {
      if (!currentExpression) {
        finalDisposition = 'blocked'
        publishFinalResultToChat(session, 'blocked', 'Expression could not be generated or validated. Please try again or rephrase your request.', null)
        finalizePipelineState(session, 'blocked', 'Failed / blocked.')
        return
      }
      var v1Pass = report1 && report1.status === 'pass'
      var v2Pass = report2 && report2.status === 'pass'
      var v1Warn = report1 && report1.status === 'warn'
      var v2Warn = report2 && report2.status === 'warn'
      // When no target is selected, do not require target_ok from validators.
      var targetOk = (!targetSnapshot || !targetSnapshot.propertyPath)
        ? true
        : ((report1 && report1.target_ok !== false) && (report2 && report2.target_ok !== false))
      if ((v1Pass || v2Pass) && targetOk) {
        finalDisposition = 'acceptable'
      } else if ((v1Pass || v2Pass) && !targetOk) {
        finalDisposition = 'warned_draft'
        displayNotes.push('Validator reported target mismatch; review before use.')
      } else if (v1Warn || v2Warn) {
        finalDisposition = 'warned_draft'
        displayNotes.push('Validation reported warnings; use with care.')
      } else {
        finalDisposition = 'warned_draft'
        displayNotes.push('Validation did not fully pass; review before applying.')
      }
      if (finalDisposition === 'warned_draft') {
        displayNotes.push('Not fully validated; Apply is disabled. Review before use.')
      }
      var displayText = buildDisplayTextForResult(currentExpression, displayExplanation, displayNotes)
      publishFinalResultToChat(session, finalDisposition, displayText, currentExpression)
      if (finalDisposition === 'acceptable') {
        finalizePipelineState(session, 'success', 'Completed successfully.')
      } else if (finalDisposition === 'warned_draft') {
        finalizePipelineState(session, 'warned', 'Completed with warnings.')
      } else {
        finalizePipelineState(session, 'blocked', 'Failed / blocked.')
      }
    }

    return fetchHostContextPromise()
      .then(function (hostParsed) {
        extraGrounding = buildExtraGroundingForSession(session, hostParsed)
        return doGenerate()
          .then(doValidate1)
          .then(doRules)
          .then(doValidate2)
          .then(doFinalize)
      })
      .catch(function (err) {
        if (diag && diag.logDebug) {
          var errMsg = (err && err.message) ? err.message : String(err)
          var safeErr = diag.sanitizeForLog ? diag.sanitizeForLog(errMsg, 80) : errMsg.slice(0, 80)
          diag.logDebug('[pipeline] flow failed', safeErr)
        }
        session.messages.push({
          role: 'system',
          text: 'Pipeline failed: ' + (err && err.message ? err.message : String(err)),
        })
        session.latestExtractedExpression = null
        session.updatedAt = Date.now()
        renderTranscript()
        scrollTranscriptToBottom()
        persistState()
        updateApplyExpressionEnabled()
        finalizePipelineState(session, 'blocked', 'Failed / blocked.')
        updateModelStatus('error', 'model: offline / error')
        throw err
      })
  }

  function updateSendEnabled () {
    var disabled = state.isRequestInFlight
    if (sendBtn) sendBtn.disabled = disabled
    if (userInputEl) userInputEl.disabled = disabled
    if (modelSelectEl) modelSelectEl.disabled = disabled || !getActiveSession()
    updateCaptureUiEnabled()
  }

  function updateApplyExpressionEnabled () {
    var session = getActiveSession()
    if (applyExpressionBtn) {
      if (!session || !session.latestExtractedExpression || state.isRequestInFlight) {
        applyExpressionBtn.disabled = true
      } else {
        applyExpressionBtn.disabled = false
      }
    }
    if (applyBatchExpressionsBtn) {
      var hasBatch = !!(session && session.latestBatchPlan && session.latestBatchPlan.length)
      applyBatchExpressionsBtn.disabled = !hasBatch || state.isRequestInFlight
      applyBatchExpressionsBtn.classList.toggle('batch-ready', hasBatch && !state.isRequestInFlight)
    }
  }

  function extractExpressionFromResponse (text) {
    if (!text || typeof text !== 'string') return null
    var separator = '---EXPLANATION---'
    var idx = text.indexOf(separator)
    var expr = idx === -1 ? text : text.slice(0, idx)
    expr = expr.trim()
    expr = sanitizeExpression(expr)
    if (!expr) return null
    // If expression still contains obvious non-expression wrappers, treat it as invalid.
    if (expr.indexOf('```') !== -1 || expr.indexOf('---EXPLANATION---') !== -1 || expr.indexOf('---NOTES---') !== -1) {
      return null
    }
    return expr
  }

  function callOllamaWithFallback (session, originalStatus, originalStatusText, docsRetrieval) {
    // Rebuild messages and re-inject the same documentation context block on fallback.
    var lastUserIndex = -1
    for (var i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === 'user') {
        lastUserIndex = i
        break
      }
    }

    var lastUserMessage = lastUserIndex >= 0 ? session.messages[lastUserIndex] : null
    var targetSnapshot = getResolvedTarget()

    var fallbackMessages = []
    session.messages.forEach(function (msg, idx) {
      if (
        idx === lastUserIndex &&
        docsRetrieval &&
        BUILD_DOCS_CONTEXT_MESSAGE
      ) {
        var docsUserText = lastUserMessage ? lastUserMessage.text : ''
        if (targetSnapshot) {
          docsUserText +=
            '\n\nSelected target: comp "' +
            targetSnapshot.compName +
            '", layer "' +
            targetSnapshot.layerName +
            '", property ' +
            targetSnapshot.propertyDisplayName +
            '.'
        }
        fallbackMessages.push({
          role: 'system',
          content: BUILD_DOCS_CONTEXT_MESSAGE(docsUserText, docsRetrieval),
        })

        if (targetSnapshot) {
          var targetInstruction =
            'For this request, you MUST generate a single After Effects expression intended for the property "' +
            targetSnapshot.propertyDisplayName +
            '" (path "' +
            targetSnapshot.propertyPath +
            '") on layer "' +
            targetSnapshot.layerName +
            '" in comp "' +
            targetSnapshot.compName +
            '". Do not write expressions that target a different property or context.'
          fallbackMessages.push({
            role: 'system',
            content: targetInstruction,
          })
        }
      }
      fallbackMessages.push({
        role: msg.role,
        content: msg.text,
      })
    })

    var fallbackBody = {
      model: FALLBACK_MODEL,
      messages: fallbackMessages,
      max_tokens: 2500,
      temperature: 0.5,
      presence_penalty: 0,
      top_p: 0.95,
    }

    return fetch(CLOUD_API_CHAT_COMPLETIONS, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + CLOUD_API_KEY,
      },
      body: JSON.stringify(fallbackBody),
    })
      .then(function (res) {
        if (!res.ok) {
          throw new Error(
            'Cloud model error ' +
              originalStatus +
              ' / fallback HTTP error ' +
              res.status +
              ' ' +
              res.statusText
          )
        }
        return res.json()
      })
      .then(function (data) {
        if (!data) {
          throw new Error('Empty response from cloud model (fallback)')
        }
        var choices = data.choices
        if (!choices || !choices.length || !choices[0].message || typeof choices[0].message.content !== 'string') {
          throw new Error('Malformed cloud model response (fallback)')
        }

        var assistantText = choices[0].message.content

        // Reuse the same docs context for validation when falling back.
        if (ANNOTATE_WITH_VALIDATION && docsRetrieval) {
          try {
            assistantText = ANNOTATE_WITH_VALIDATION(assistantText, docsRetrieval)
          } catch (e) {}
        }
        session.messages.push({
          role: 'assistant',
          text: assistantText,
        })

        var extracted = extractExpressionFromResponse(assistantText)
        if (extracted) {
          session.latestExtractedExpression = extracted
        }

        session.updatedAt = Date.now()
        session.model = FALLBACK_MODEL
        renderTranscript()
        scrollTranscriptToBottom()
      })
  }

  function updateStatus (text) {
    if (!statusTextEl) return
    statusTextEl.textContent = text
  }

  function updateModelStatus (status, label) {
    if (!modelStatusEl) return
    modelStatusEl.textContent = label
    modelStatusEl.classList.remove('model-status-ok', 'model-status-error', 'model-status-unknown')
    if (status === 'ok') {
      modelStatusEl.classList.add('model-status-ok')
    } else if (status === 'error') {
      modelStatusEl.classList.add('model-status-error')
    } else {
      modelStatusEl.classList.add('model-status-unknown')
    }
    if (label && typeof label === 'string' && label.indexOf('model:') === 0) {
      state.lastCloudModelStatus = { status: status || 'unknown', label: label }
    }
  }

  function renderAssistantMessage (container, text) {
    if (!text || typeof text !== 'string') {
      container.textContent = '[assistant] ' + String(text)
      return
    }

    var separator = '---EXPLANATION---'
    var notesSep = '---NOTES---'

    var explanationIndex = text.indexOf(separator)
    var notesIndex = text.indexOf(notesSep)

    var expr = explanationIndex === -1 ? text : text.slice(0, explanationIndex)
    var rest = explanationIndex === -1 ? '' : text.slice(explanationIndex + separator.length)

    expr = expr.trim()
    expr = sanitizeExpression(expr)

    var explanationBlock = ''
    var notesBlock = ''

    if (rest) {
      if (notesIndex !== -1 && notesIndex > explanationIndex) {
        var relNotes = notesIndex - (explanationIndex + separator.length)
        explanationBlock = rest.slice(0, relNotes)
        notesBlock = text.slice(notesIndex + notesSep.length)
      } else {
        explanationBlock = rest
      }
    }

    // Expression block
    if (expr) {
      var header = document.createElement('div')
      header.className = 'chat-expression-header'
      var labelSpan = document.createElement('span')
      labelSpan.textContent = 'Expression'
      var copyBtn = document.createElement('button')
      copyBtn.className = 'chat-expression-copy-btn'
      copyBtn.type = 'button'
      copyBtn.textContent = 'Копировать'
      header.appendChild(labelSpan)
      header.appendChild(copyBtn)

      var exprDiv = document.createElement('div')
      exprDiv.className = 'chat-expression'
      exprDiv.textContent = expr

      copyBtn.addEventListener('click', function () {
        var textToCopy = expr
        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(textToCopy).catch(function () {
            fallbackCopyText(textToCopy)
          })
        } else {
          fallbackCopyText(textToCopy)
        }
      })

      container.appendChild(header)
      container.appendChild(exprDiv)
    }

    // Explanation separator and bullets
    if (explanationIndex !== -1) {
      var sepDiv = document.createElement('div')
      sepDiv.className = 'chat-separator'
      sepDiv.textContent = '---EXPLANATION---'
      container.appendChild(sepDiv)

      var explTrim = explanationBlock.trim()
      if (explTrim) {
        var explDiv = document.createElement('div')
        explDiv.className = 'chat-explanation'
        var ul = document.createElement('ul')
        explTrim.split('\n').forEach(function (line) {
          var trimmed = line.trim()
          if (!trimmed) return
          if (trimmed.indexOf('- ') === 0) {
            trimmed = trimmed.slice(2)
          }
          var li = document.createElement('li')
          li.textContent = trimmed
          ul.appendChild(li)
        })
        explDiv.appendChild(ul)
        container.appendChild(explDiv)
      }
    }

    // Notes separator and bullets
    if (notesIndex !== -1) {
      var notesSepDiv = document.createElement('div')
      notesSepDiv.className = 'chat-separator'
      notesSepDiv.textContent = '---NOTES---'
      container.appendChild(notesSepDiv)

      var notesTrim = notesBlock.trim()
      if (notesTrim) {
        var notesDiv = document.createElement('div')
        notesDiv.className = 'chat-notes'
        var ulNotes = document.createElement('ul')
        notesTrim.split('\n').forEach(function (line) {
          var trimmed = line.trim()
          if (!trimmed) return
          if (trimmed.indexOf('- ') === 0) {
            trimmed = trimmed.slice(2)
          }
          var li = document.createElement('li')
          li.textContent = trimmed
          ulNotes.appendChild(li)
        })
        notesDiv.appendChild(ulNotes)
        container.appendChild(notesDiv)
      }
    }

    // Fallback: if nothing was parsed, show raw
    if (!container.hasChildNodes()) {
      container.textContent = '[assistant] ' + text
    }
  }

  function fallbackCopyText (text) {
    try {
      var textarea = document.createElement('textarea')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    } catch (e) {
      // Ignore; нет надёжного способа скопировать в этом окружении.
    }
  }

  // NOTE: we keep a single updateStatus implementation that writes into
  // the dedicated status-text span to avoid innerHTML races.

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      try {
        init()
      } catch (e) {
        showBootError(e, 'init')
      }
    })
  } else {
    try {
      init()
    } catch (e) {
      showBootError(e, 'init')
    }
  }
})()

