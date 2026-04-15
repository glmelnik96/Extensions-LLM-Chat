/**
 * Centralized diagnostics and error taxonomy for the CEP extension.
 * Exposes window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS.
 * Verbose logging is off by default; set debug to true in createLogger to enable.
 */
(function () {
  'use strict'

  var ERROR_CATEGORY = {
    CONFIGURATION: 'configuration',
    NETWORK_TRANSPORT: 'network_transport',
    HTTP: 'http',
    MALFORMED_RESPONSE: 'malformed_response',
    PROMPT_ASSEMBLY: 'prompt_assembly',
    KNOWLEDGE_LOADING: 'knowledge_loading',
    RULES_BLOCK: 'rules_block',
    VALIDATION_REJECTION: 'validation_rejection',
    REPAIR_EXHAUSTION: 'repair_exhaustion',
    HOST_APPLY: 'host_apply',
    TARGET_RESOLUTION: 'target_resolution',
    LOCAL_VISION: 'local_vision',
    CAPTURE_MACOS: 'capture_macos',
    UNKNOWN: 'unknown',
  }

  var DISPOSITION = {
    SUCCESS: 'success',
    WARNED: 'warned',
    BLOCKED: 'blocked',
    RUNTIME_FAILURE: 'runtime_failure',
  }

  function createLogger (options) {
    var opts = options || {}
    var debug = opts.debug === true
    var prefix = opts.prefix || '[LLM Chat]'

    function log (level, args) {
      var fn = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info'
      if (typeof console !== 'undefined' && console[fn]) {
        var arr = [prefix].concat(Array.prototype.slice.call(args))
        console[fn].apply(console, arr)
      }
    }

    return {
      debug: debug,
      info: function () {
        log('info', arguments)
      },
      warn: function () {
        log('warn', arguments)
      },
      error: function () {
        log('error', arguments)
      },
      debugLog: function () {
        if (debug) {
          log('info', arguments)
        }
      },
    }
  }

  var defaultLogger = createLogger({ debug: false })

  function logInfo () {
    defaultLogger.info.apply(defaultLogger, arguments)
  }

  function logWarn () {
    defaultLogger.warn.apply(defaultLogger, arguments)
  }

  function logError () {
    defaultLogger.error.apply(defaultLogger, arguments)
  }

  function logDebug () {
    defaultLogger.debugLog.apply(defaultLogger, arguments)
  }

  /**
   * Log elapsed ms for a phase (capture, Ollama vision, etc.). Only when setDebug(true).
   * Do not pass secrets, full paths, or image bytes — use short labels only.
   */
  function logPhaseTiming (phase, elapsedMs, safeDetail) {
    if (!defaultLogger.debug) return
    var ms = typeof elapsedMs === 'number' ? Math.round(elapsedMs) : 0
    var detail = safeDetail != null ? String(safeDetail) : ''
    defaultLogger.debugLog('[timing]', phase, ms + 'ms', detail)
  }

  /**
   * Sanitize a string for debug logging. Never log secrets (apiKey, full config, full message bodies).
   * Use for short samples only: truncates to maxLen (default 80), replaces newlines with space.
   */
  function sanitizeForLog (str, maxLen) {
    if (str == null) return ''
    var s = String(str).replace(/\s+/g, ' ').trim()
    var limit = typeof maxLen === 'number' && maxLen > 0 ? maxLen : 80
    if (s.length > limit) return s.slice(0, limit) + '…'
    return s
  }

  /**
   * Report a user-facing failure (concise message for chat/status).
   * Internal details can be logged separately; do not include secrets.
   */
  function reportUserFacingFailure (shortMessage, category, internalDetail) {
    if (internalDetail && defaultLogger.debug) {
      defaultLogger.debugLog('reportUserFacingFailure category=', category, internalDetail)
    }
    return shortMessage
  }

  /**
   * Normalize an error into a safe, categorizable shape for logging and user message.
   * Returns { category, message, userMessage }.
   */
  function normalizeRuntimeError (err) {
    var category = ERROR_CATEGORY.UNKNOWN
    var message = (err && err.message) ? err.message : String(err)
    var userMessage = message

    if (message.indexOf('Configuration') !== -1 || message.indexOf('config') !== -1 || message.indexOf('API key') !== -1) {
      category = ERROR_CATEGORY.CONFIGURATION
      userMessage = 'Configuration missing or invalid. See config/README.md.'
    } else if (message.indexOf('fetch') !== -1 || message.indexOf('network') !== -1 || message.indexOf('Network') !== -1) {
      category = ERROR_CATEGORY.NETWORK_TRANSPORT
      userMessage = 'Network error. Check connection and try again.'
    } else if (message.indexOf('HTTP') !== -1 || message.indexOf('res.status') !== -1 || message.indexOf('404') !== -1 || message.indexOf('500') !== -1) {
      category = ERROR_CATEGORY.HTTP
      userMessage = 'Cloud API returned an error. Check endpoint and key.'
    } else if (message.indexOf('Malformed') !== -1 || message.indexOf('Empty response') !== -1 || message.indexOf('choices') !== -1) {
      category = ERROR_CATEGORY.MALFORMED_RESPONSE
      userMessage = 'Invalid response from cloud model. Try again.'
    } else if (message.indexOf('Pipeline failed') !== -1 && message.indexOf('Rules') !== -1) {
      category = ERROR_CATEGORY.RULES_BLOCK
      userMessage = message
    } else if (message.indexOf('Pipeline failed') !== -1) {
      userMessage = message
    }

    return {
      category: category,
      message: message,
      userMessage: userMessage,
    }
  }

  function setDebug (enabled) {
    defaultLogger.debug = !!enabled
  }

  if (typeof window !== 'undefined') {
    window.EXTENSIONS_LLM_CHAT_DIAGNOSTICS = {
      createLogger: createLogger,
      logInfo: logInfo,
      logWarn: logWarn,
      logError: logError,
      logDebug: logDebug,
      logPhaseTiming: logPhaseTiming,
      sanitizeForLog: sanitizeForLog,
      reportUserFacingFailure: reportUserFacingFailure,
      normalizeRuntimeError: normalizeRuntimeError,
      ERROR_CATEGORY: ERROR_CATEGORY,
      DISPOSITION: DISPOSITION,
      setDebug: setDebug,
    }
  }
})()
