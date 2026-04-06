/**
 * Chat Provider — unified abstraction over Cloud.ru and Ollama chat APIs.
 * Both providers are normalized to the OpenAI chat/completions response shape.
 */
(function () {
  'use strict'

  function getConfig () {
    return (typeof window !== 'undefined' && window.EXTENSIONS_LLM_CHAT_CONFIG) || {}
  }

  function getApiKey () {
    var secrets = (typeof window !== 'undefined' && window.EXTENSIONS_LLM_CHAT_SECRETS) || {}
    var cfg = getConfig()
    return secrets.apiKey || cfg.apiKey || ''
  }

  function ensureAbortHandleApi (abortHandle) {
    if (!abortHandle) return null
    if (!Array.isArray(abortHandle._listeners)) abortHandle._listeners = []
    if (typeof abortHandle.onAbort !== 'function') {
      abortHandle.onAbort = function (fn) {
        if (typeof fn !== 'function') return function () {}
        abortHandle._listeners.push(fn)
        return function () {
          var idx = abortHandle._listeners.indexOf(fn)
          if (idx !== -1) abortHandle._listeners.splice(idx, 1)
        }
      }
    }
    if (typeof abortHandle.abort !== 'function') {
      abortHandle.abort = function () {
        abortHandle.aborted = true
        var listeners = abortHandle._listeners.slice()
        for (var i = 0; i < listeners.length; i++) {
          try { listeners[i]() } catch (_) {}
        }
      }
    }
    return abortHandle
  }

  /**
   * Parse a model string like "cloudru/Qwen/Qwen3-Coder-Next" or "ollama/qwen2.5:14b".
   * Returns { provider: 'cloudru'|'ollama', model: 'Qwen/Qwen3-Coder-Next' }
   */
  function parseModelId (modelId) {
    if (!modelId || typeof modelId !== 'string') {
      return { provider: 'cloudru', model: getConfig().defaultModel || 'openai/gpt-oss-120b' }
    }
    if (modelId.indexOf('ollama/') === 0) {
      return { provider: 'ollama', model: modelId.substring(7) }
    }
    if (modelId.indexOf('cloudru/') === 0) {
      return { provider: 'cloudru', model: modelId.substring(8) }
    }
    // Legacy model strings without prefix → Cloud.ru.
    return { provider: 'cloudru', model: modelId }
  }

  // ── Cloud.ru provider ────────────────────────────────────────────────

  function invokeCloudRu (model, messages, options) {
    var cfg = getConfig()
    var baseUrl = cfg.baseUrl || 'https://foundation-models.api.cloud.ru/v1'
    var url = baseUrl + '/chat/completions'
    var apiKey = getApiKey()
    var timeoutMs = (cfg.cloudChatTimeoutMs) || 120000
    var abortHandle = ensureAbortHandleApi(options && options.abortHandle)

    var body = {
      model: model,
      messages: messages,
      max_tokens: (options && options.max_tokens) || 4096,
      temperature: (options && typeof options.temperature === 'number') ? options.temperature : 0.3,
      top_p: 0.95
    }

    // Add tools if provided.
    if (options && options.tools && options.tools.length > 0) {
      body.tools = options.tools
      body.tool_choice = (options && options.tool_choice) || 'auto'
    }

    return new Promise(function (resolve, reject) {
      var controller = new AbortController()
      var didTimeout = false
      var didUserAbort = false
      var unsubscribeAbort = function () {}
      var timer = setTimeout(function () {
        didTimeout = true
        controller.abort()
      }, timeoutMs)

      if (abortHandle) {
        if (abortHandle.aborted) {
          didUserAbort = true
          clearTimeout(timer)
          reject(new Error('Request cancelled by user.'))
          return
        }
        unsubscribeAbort = abortHandle.onAbort(function () {
          didUserAbort = true
          controller.abort()
        })
      }

      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiKey
        },
        body: JSON.stringify(body),
        signal: controller.signal
      }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (txt) {
            throw new Error('Cloud.ru HTTP ' + res.status + ': ' + txt.substring(0, 500))
          })
        }
        return res.json()
      }).then(function (data) {
        // Already in OpenAI format.
        if (!data.choices || !data.choices.length) {
          throw new Error('Cloud.ru: empty choices in response')
        }
        resolve(data)
      }).catch(function (err) {
        if (didTimeout) {
          reject(new Error('Cloud.ru chat timeout after ' + timeoutMs + 'ms'))
          return
        }
        if (didUserAbort || (abortHandle && abortHandle.aborted)) {
          reject(new Error('Request cancelled by user.'))
          return
        }
        reject(err)
      }).then(function () {
        clearTimeout(timer)
        unsubscribeAbort()
      }, function () {
        clearTimeout(timer)
        unsubscribeAbort()
      })
    })
  }

  // ── Ollama provider ──────────────────────────────────────────────────

  function invokeOllama (model, messages, options) {
    var cfg = getConfig()
    var baseUrl = cfg.ollamaBaseUrl || 'http://127.0.0.1:11434'
    var url = baseUrl + '/api/chat'
    var abortHandle = ensureAbortHandleApi(options && options.abortHandle)

    var body = {
      model: model,
      messages: messages,
      stream: false,
      options: {
        temperature: (options && typeof options.temperature === 'number') ? options.temperature : 0.3
      }
    }

    // Ollama tool calling support.
    if (options && options.tools && options.tools.length > 0) {
      body.tools = options.tools
    }

    var timeoutMs = (cfg.ollamaChatTimeoutMs) || 120000

    return new Promise(function (resolve, reject) {
      var controller = new AbortController()
      var didTimeout = false
      var didUserAbort = false
      var unsubscribeAbort = function () {}
      var timer = setTimeout(function () {
        didTimeout = true
        controller.abort()
      }, timeoutMs)

      if (abortHandle) {
        if (abortHandle.aborted) {
          clearTimeout(timer)
          reject(new Error('Request cancelled by user.'))
          return
        }
        unsubscribeAbort = abortHandle.onAbort(function () {
          didUserAbort = true
          controller.abort()
        })
      }

      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (txt) {
            throw new Error('Ollama HTTP ' + res.status + ': ' + txt.substring(0, 500))
          })
        }
        return res.json()
      }).then(function (data) {
        // Normalize Ollama response to OpenAI shape.
        var normalized = normalizeOllamaResponse(data)
        resolve(normalized)
      }).catch(function (err) {
        if (didTimeout) {
          reject(new Error('Ollama chat timeout after ' + timeoutMs + 'ms'))
          return
        }
        if (didUserAbort || (abortHandle && abortHandle.aborted)) {
          reject(new Error('Request cancelled by user.'))
          return
        }
        reject(err)
      }).then(function () {
        clearTimeout(timer)
        unsubscribeAbort()
      }, function () {
        clearTimeout(timer)
        unsubscribeAbort()
      })
    })
  }

  /**
   * Normalize Ollama /api/chat response to OpenAI chat/completions shape.
   *
   * Ollama: { message: { role, content, tool_calls? }, done: true }
   * OpenAI: { choices: [{ message: { role, content, tool_calls? }, finish_reason }] }
   */
  function normalizeOllamaResponse (data) {
    if (!data || !data.message) {
      throw new Error('Ollama: invalid response shape')
    }

    var msg = data.message
    var finishReason = 'stop'

    // Normalize tool_calls if present.
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      finishReason = 'tool_calls'
      // Ollama tool_calls have function.arguments as object; OpenAI expects string.
      for (var i = 0; i < msg.tool_calls.length; i++) {
        var tc = msg.tool_calls[i]
        if (!tc.id) tc.id = 'call_ollama_' + i + '_' + Date.now()
        if (tc.function && typeof tc.function.arguments === 'object') {
          tc.function.arguments = JSON.stringify(tc.function.arguments)
        }
        if (!tc.type) tc.type = 'function'
      }
    }

    return {
      choices: [{
        index: 0,
        message: msg,
        finish_reason: finishReason
      }],
      model: data.model || '',
      usage: data.eval_count ? { total_tokens: data.eval_count } : null
    }
  }

  // ── Retry helper ─────────────────────────────────────────────────────

  /**
   * Retry a function with exponential backoff on retryable errors (429, 5xx).
   */
  function withRetry (fn, maxRetries) {
    if (typeof maxRetries !== 'number') maxRetries = 3
    var attempt = 0
    function tryOnce () {
      attempt++
      return fn().catch(function (err) {
        var msg = err.message || ''
        var isRetryable = msg.indexOf('HTTP 429') !== -1 ||
          msg.indexOf('HTTP 500') !== -1 ||
          msg.indexOf('HTTP 502') !== -1 ||
          msg.indexOf('HTTP 503') !== -1 ||
          msg.indexOf('HTTP 504') !== -1
        if (isRetryable && attempt < maxRetries) {
          var delay = Math.min(1000 * Math.pow(2, attempt - 1), 8000)
          return new Promise(function (resolve) {
            setTimeout(resolve, delay)
          }).then(tryOnce)
        }
        throw err
      })
    }
    return tryOnce()
  }

  // ── Unified invoke ───────────────────────────────────────────────────

  /**
   * Send a chat completion request to the appropriate provider.
   * Automatically retries on 429/5xx errors with exponential backoff.
   * @param {string} modelId  "cloudru/..." or "ollama/..." or legacy model name
   * @param {Array}  messages Chat messages array
   * @param {object} options  { tools?, tool_choice?, max_tokens?, temperature?, abortHandle? }
   * @returns {Promise<object>} OpenAI-compatible response
   */
  function invoke (modelId, messages, options) {
    var parsed = parseModelId(modelId)
    return withRetry(function () {
      if (parsed.provider === 'ollama') {
        return invokeOllama(parsed.model, messages, options)
      }
      return invokeCloudRu(parsed.model, messages, options)
    }, 3)
  }

  /**
   * Invoke with automatic fallback to a secondary model on failure.
   */
  function invokeWithFallback (primaryModelId, fallbackModelId, messages, options) {
    return invoke(primaryModelId, messages, options).catch(function (err) {
      console.warn('Primary model failed (' + primaryModelId + '), trying fallback: ' + err.message)
      if (!fallbackModelId) throw err
      return invoke(fallbackModelId, messages, options)
    })
  }

  /**
   * Check if Ollama is reachable.
   */
  function checkOllamaHealth () {
    var cfg = getConfig()
    var baseUrl = cfg.ollamaBaseUrl || 'http://127.0.0.1:11434'
    return fetch(baseUrl + '/api/tags', { method: 'GET' })
      .then(function (res) { return res.ok })
      .catch(function () { return false })
  }

  /**
   * List available Ollama models.
   */
  function listOllamaModels () {
    var cfg = getConfig()
    var baseUrl = cfg.ollamaBaseUrl || 'http://127.0.0.1:11434'
    return fetch(baseUrl + '/api/tags', { method: 'GET' })
      .then(function (res) {
        if (!res.ok) return []
        return res.json()
      })
      .then(function (data) {
        if (!data || !data.models) return []
        return data.models.map(function (m) { return m.name })
      })
      .catch(function () { return [] })
  }

  // Export
  if (typeof window !== 'undefined') {
    window.CHAT_PROVIDER = {
      invoke: invoke,
      invokeWithFallback: invokeWithFallback,
      parseModelId: parseModelId,
      checkOllamaHealth: checkOllamaHealth,
      listOllamaModels: listOllamaModels
    }
  }
})()
