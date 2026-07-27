/**
 * Agent Tool Loop — orchestrates the LLM ↔ tool execution cycle.
 *
 * Flow:
 * 1. Build messages (system prompt + history + user message)
 * 2. Call chat API with tools array
 * 3. If response has tool_calls → execute each via HOST_BRIDGE → push results → goto 2
 * 4. If response is plain content → done, return to UI
 */
(function () {
  'use strict'

  var DEFAULT_MAX_STEPS = 60
  var DEFAULT_TEMPERATURE = 0.3

  /**
   * Run the agent tool loop.
   *
   * @param {object} options
   *   - modelId:     string — model to use (e.g. "zai-org/GLM-5.1")
   *   - systemPrompt: string — system prompt text
   *   - messages:     Array — conversation history (user/assistant messages)
   *   - tools:        Array — OpenAI-compatible tool definitions (default: all from registry)
   *   - maxSteps:     number — max tool-call rounds (default 150)
   *   - temperature:  number — (default 0.3)
   *   - onToolCall:   function(toolCall) — callback for UI updates per tool call
   *   - onStepStart:  function(stepIndex) — fired before each model request
   *   - onStepComplete: function(stepIndex, toolResults) — callback after each step
   *
   * @returns {Promise<object>} { content: string, toolCallLog: Array }
   */
  /**
   * Create an abort handle that can be passed to runAgentLoop and cancelled later.
   */
  function createAbortHandle () {
    return { aborted: false }
  }

  function runAgentLoop (options) {
    if (!options) throw new Error('runAgentLoop: options required')

    // Reset anti-spam streak counters at the start of every user request so
    // a previous run's blocked call doesn't pre-block the next run.
    if (window.HOST_BRIDGE && typeof window.HOST_BRIDGE.resetSpamGuard === 'function') {
      try { window.HOST_BRIDGE.resetSpamGuard() } catch (_) {}
    }

    var modelId = options.modelId
    var systemPrompt = options.systemPrompt || ''
    var conversationMessages = options.messages || []
    var tools = options.tools || (window.AGENT_TOOL_REGISTRY && window.AGENT_TOOL_REGISTRY.tools) || []
    var maxSteps = (typeof options.maxSteps === 'number') ? options.maxSteps : DEFAULT_MAX_STEPS
    var temperature = (typeof options.temperature === 'number') ? options.temperature : DEFAULT_TEMPERATURE
    var onToolCall = options.onToolCall || function () {}
    var onStepComplete = options.onStepComplete || function () {}
    // Fired right before each model request. Lets the UI show a live
    // "waiting for model" state during the (non-streaming) turn instead of
    // leaving the label stuck on the previous tool's status.
    var onStepStart = options.onStepStart || function () {}
    var onTextChunk = options.onTextChunk || null
    var onReasoningChunk = options.onReasoningChunk || null
    var abortHandle = options.abortHandle || null
    // GLM has no thinking budget — only on/off via chat_template_kwargs
    // (verified live 2026-06-10; Z.ai recommends turn-level thinking for
    // agents). Default: thinking OFF on every loop turn — measured 12x faster
    // end-to-end (94s vs 18.8min) with equal-quality output on the reference
    // task. Set thinkingFirstTurn: true to allow a thinking planning turn.
    var thinkingFirstTurn = options.thinkingFirstTurn === true

    // Build the full message array for the API.
    var messages = []
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }
    // Add conversation history.
    for (var i = 0; i < conversationMessages.length; i++) {
      messages.push(conversationMessages[i])
    }

    var toolCallLog = []
    var totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    // Cloud.ru vLLM 0.22 streaming bug guard: retries allowed when the server
    // reports finish_reason=tool_calls but delivers zero tool calls.
    var emptyToolCallRetries = 0
    var EMPTY_TOOL_CALL_MAX_RETRIES = 2

    function step (stepIndex) {
      // P1-3: the full message array is re-sent every turn, so old verbose
      // tool results dominate prompt tokens on long runs (live e2e measured
      // 160k cumulative prompt tokens for a 12-turn run). Older tool results
      // have already been acted upon — truncate them, keeping the most recent
      // ones intact for the model's working state.
      trimOldToolResults(messages)

      if (abortHandle && abortHandle.aborted) {
        return Promise.resolve({
          content: '[Agent cancelled by user.]',
          toolCallLog: toolCallLog,
          usage: totalUsage
        })
      }
      if (stepIndex >= maxSteps) {
        return Promise.resolve({
          content: '[Agent reached maximum step limit (' + maxSteps + '). Partial results above.]',
          toolCallLog: toolCallLog,
          usage: totalUsage
        })
      }

      var invokeOptions = {
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? 'auto' : undefined,
        // Output budget covers reasoning + tool_calls JSON + answer in one turn.
        // Reasoning models (GLM-5.1 etc.) bill their chain-of-thought as
        // completion tokens, so this is generous; the endpoint accepts up to
        // 131072 for these models. (History: Fix H/M raised this from 4096 to
        // 32768 for gpt-oss; 65536 leaves room for reasoning + long tool chains.)
        max_tokens: 65536,
        temperature: temperature,
        abortHandle: abortHandle
      }
      // Disable thinking on executor turns (and on the first turn too unless
      // explicitly opted in). Omitting the kwargs keeps the server default
      // (thinking ON) for the planning turn.
      if (!(thinkingFirstTurn && stepIndex === 0)) {
        invokeOptions.chat_template_kwargs = { enable_thinking: false }
      }
      // Signal that a model request is about to start (UI: "waiting for model").
      try { onStepStart(stepIndex) } catch (_) {}

      // Streaming is opt-in for the agent loop. Verified live 2026-06-10:
      // Cloud.ru (vllm-0.22.0) drops ALL delta.tool_calls in streaming mode for
      // GLM-5.1 (10/10 repro) while non-streaming returns them correctly, so
      // the default is non-streaming until the server is fixed.
      // CHAT_PROVIDER.invoke picks streaming iff onTextChunk is a function.
      if (options.streaming === true) {
        invokeOptions.onTextChunk = onTextChunk
        invokeOptions.onReasoningChunk = onReasoningChunk
      }

      return window.CHAT_PROVIDER.invoke(modelId, messages, invokeOptions)
        .then(function (response) {
          // Accumulate token usage.
          if (response.usage) {
            totalUsage.prompt_tokens += response.usage.prompt_tokens || 0
            totalUsage.completion_tokens += response.usage.completion_tokens || 0
            totalUsage.total_tokens += response.usage.total_tokens || 0
          }
          var choice = response.choices[0]
          var assistantMsg = choice.message
          var toolCalls = assistantMsg.tool_calls || []

          // Case 1: Model wants to call tools (and they actually arrived).
          if (toolCalls.length > 0) {
            // GLM's chat template looks for `reasoning_content` on in-loop
            // assistant messages; without it an empty <think></think> is
            // injected and the model loses its own chain between tool turns
            // (Z.ai interleaved-thinking guidance). Cloud.ru returns the field
            // as `reasoning`, so rename before echoing back.
            if (assistantMsg.reasoning && !assistantMsg.reasoning_content) {
              assistantMsg.reasoning_content = assistantMsg.reasoning
              delete assistantMsg.reasoning
            }
            // Push the assistant message with tool_calls into conversation.
            messages.push(assistantMsg)

            return executeToolCallsSequentially(toolCalls, toolCallLog, onToolCall)
              .then(function (results) {
                // Push each tool result as a tool message.
                for (var r = 0; r < results.length; r++) {
                  messages.push({
                    role: 'tool',
                    tool_call_id: results[r].id,
                    content: results[r].content
                  })
                }
                onStepComplete(stepIndex, results)
                return step(stepIndex + 1)
              })
          }

          // Server anomaly: finish_reason says tool_calls but none were
          // delivered (Cloud.ru vLLM 0.22 streaming parser bug). Without this
          // guard the old code pushed an empty assistant turn and spun until
          // maxSteps/timeout with no visible answer. Retry the same step a
          // couple of times, then fail loudly instead of silently.
          if (choice.finish_reason === 'tool_calls') {
            if (emptyToolCallRetries < EMPTY_TOOL_CALL_MAX_RETRIES) {
              emptyToolCallRetries++
              return step(stepIndex)
            }
            return {
              content: (assistantMsg.content || '') ||
                ('[Server returned finish_reason=tool_calls with no tool calls ' +
                 EMPTY_TOOL_CALL_MAX_RETRIES + 'x in a row (known Cloud.ru streaming bug). ' +
                 'Run aborted.' + (toolCallLog.length ? ' Completed so far: ' + summarizeToolCallLog(toolCallLog) : '') + ']'),
              toolCallLog: toolCallLog,
              usage: totalUsage
            }
          }

          // Case 2: Model responded with content (done). Never end the run
          // with empty visible text — synthesize a summary from the tool log
          // so the user always sees an outcome (P0-2 fix).
          var content = assistantMsg.content || ''
          if (!content) {
            content = toolCallLog.length > 0
              ? 'Done — ' + summarizeToolCallLog(toolCallLog) + '.'
              : '[Model returned an empty response.]'
          }
          return {
            content: content,
            toolCallLog: toolCallLog,
            usage: totalUsage
          }
        })
    }

    // Attach the partial tool log to any rejection so the UI can render
    // already-executed calls (layers may exist in AE even when the LLM call
    // later times out) and replay them to the model on the next turn (P0-3).
    return step(0).catch(function (err) {
      var e = err || new Error('Agent loop failed')
      try { e.toolCallLog = toolCallLog; e.usage = totalUsage } catch (_) {}
      throw e
    })
  }

  // Keep this many most-recent tool results untouched; older ones are
  // truncated to TRIM_MAX_CHARS. 8 results ≈ the current working set the
  // model still references; everything older was already consumed.
  var TRIM_KEEP_RECENT_TOOL_MSGS = 8
  var TRIM_MAX_CHARS = 400
  var TRIM_MARKER = '…[truncated to save context — re-read with a get_* tool if needed]'

  /**
   * Truncate tool-result message contents that are older than the most
   * recent TRIM_KEEP_RECENT_TOOL_MSGS tool messages. Mutates in place —
   * the messages array is loop-local, so the UI/tool log is unaffected.
   */
  function trimOldToolResults (messages) {
    var toolIdxs = []
    for (var i = 0; i < messages.length; i++) {
      if (messages[i].role === 'tool') toolIdxs.push(i)
    }
    var cutoff = toolIdxs.length - TRIM_KEEP_RECENT_TOOL_MSGS
    for (var j = 0; j < cutoff; j++) {
      var m = messages[toolIdxs[j]]
      if (typeof m.content !== 'string') continue
      if (m.content.length <= TRIM_MAX_CHARS) continue
      if (m.content.indexOf(TRIM_MARKER) !== -1) continue // already trimmed
      m.content = m.content.slice(0, TRIM_MAX_CHARS) + TRIM_MARKER
    }
  }

  /**
   * Compact human-readable summary of a tool call log, e.g.
   * "8 tool calls: create_layer, set_keyframes_batch x2, add_effect (1 failed)".
   */
  function summarizeToolCallLog (log) {
    var counts = {}
    var order = []
    var failed = 0
    for (var i = 0; i < log.length; i++) {
      var name = log[i].name || 'unknown'
      if (!counts[name]) { counts[name] = 0; order.push(name) }
      counts[name]++
      if (log[i].status === 'error') failed++
    }
    var parts = []
    for (var j = 0; j < order.length; j++) {
      parts.push(order[j] + (counts[order[j]] > 1 ? ' x' + counts[order[j]] : ''))
    }
    return log.length + ' tool call' + (log.length === 1 ? '' : 's') + ': ' +
      parts.join(', ') + (failed > 0 ? ' (' + failed + ' failed)' : '')
  }

  /**
   * Read-only tools that can run in parallel within a single tool_calls batch.
   * Mutating tools must remain sequential because AE ExtendScript is single-threaded
   * (concurrent setValue/setValueAtTime calls race the AE undo group and timeline state).
   */
  var READ_ONLY_TOOLS = {
    get_detailed_comp_summary: 1,
    get_host_context: 1,
    get_property_value: 1,
    get_expression: 1,
    get_keyframes: 1,
    get_layer_properties: 1,
    get_effect_properties: 1,
    search_layers: 1,
    get_mask_info: 1,
    get_markers: 1,
    list_project_items: 1,
    capture_comp_frame: 1,
    search_expression_library: 1,
    list_available_effects: 1,
    // Panel-local user-library tools: mutate localStorage only — no AE undo
    // group, so they must not count toward the Undo button, and they are
    // synchronous JS (no parallelism race).
    save_user_expression: 1,
    list_user_expressions: 1,
    delete_user_expression: 1
  }

  /**
   * Build a thunk that executes one tool call and resolves with the
   * { id, content } result entry. The thunk runs static validation before
   * the host call and attaches any warnings to the result so the model sees
   * them on the next turn (#5: validation feedback to agent).
   */
  function buildToolCallThunk (tc, log, onToolCall) {
    return function () {
      var toolName = tc.function.name
      var rawArgs = tc.function.arguments
      var args = {}
      var argParseError = null
      if (typeof rawArgs === 'string') {
        // Models send "{}" for no-arg tools; an empty/whitespace string is not
        // an error, just no arguments. A non-empty but malformed string IS an
        // error the model must learn about (previously it was silently coerced
        // to {} and the call ran with wrong/empty args).
        if (rawArgs.trim() === '') {
          args = {}
        } else {
          try {
            args = JSON.parse(rawArgs)
          } catch (e) {
            argParseError = (e && e.message) || String(e)
            args = {}
          }
        }
      } else {
        args = rawArgs || {}
      }

      var logEntry = {
        id: tc.id || ('call_' + Date.now()),
        name: toolName,
        args: args,
        result: null,
        status: 'running',
        startTime: Date.now()
      }
      log.push(logEntry)
      onToolCall(logEntry)

      // Malformed tool-call arguments: don't hit the host with empty {} and
      // report a phantom result — tell the model its JSON was invalid so it can
      // re-issue the call correctly on the next turn.
      if (argParseError) {
        var parseErrResult = {
          ok: false,
          message: 'Tool arguments were not valid JSON (' + argParseError +
            '). Re-issue this call with a single well-formed JSON object as the arguments.'
        }
        logEntry.result = parseErrResult
        logEntry.status = 'error'
        logEntry.endTime = Date.now()
        onToolCall(logEntry)
        return Promise.resolve({ id: logEntry.id, content: JSON.stringify(parseErrResult) })
      }

      // Static expression validation before sending to AE.
      var validationWarnings = []
      if ((toolName === 'apply_expression' || toolName === 'apply_expression_batch') && window.validateExpression) {
        var exprText = args.expression || ''
        if (toolName === 'apply_expression_batch' && args.targets) {
          exprText = args.targets.map(function (t) { return t.expression || '' }).join('\n')
        }
        validationWarnings = window.validateExpression(exprText) || []
        if (validationWarnings.length > 0) {
          logEntry.validationWarnings = validationWarnings
        }
      }

      function attachWarnings (result) {
        if (validationWarnings.length > 0) {
          // Mutate so the JSON sent to the model includes the warnings inline.
          result.validationWarnings = validationWarnings
        }
        return result
      }

      return window.HOST_BRIDGE.executeToolCall(toolName, args)
        .then(function (hostResult) {
          var withWarnings = attachWarnings(hostResult || { ok: false, message: 'Empty host result.' })
          logEntry.result = withWarnings
          logEntry.status = withWarnings.ok ? 'ok' : 'error'
          logEntry.endTime = Date.now()
          onToolCall(logEntry)
          return { id: logEntry.id, content: JSON.stringify(withWarnings) }
        })
        .catch(function (err) {
          var errResult = attachWarnings({ ok: false, message: (err && err.message) || String(err) })
          logEntry.result = errResult
          logEntry.status = 'error'
          logEntry.endTime = Date.now()
          onToolCall(logEntry)
          return { id: logEntry.id, content: JSON.stringify(errResult) }
        })
    }
  }

  /**
   * Execute the tool_calls of a single round. Contiguous runs of read-only
   * tools execute in parallel via Promise.all; mutating tools execute one
   * at a time. Result order matches the input tool_calls order so the
   * tool_call_id pairing in the conversation history stays correct.
   */
  function executeToolCallsSequentially (toolCalls, log, onToolCall) {
    var resultsByIndex = new Array(toolCalls.length)
    var chain = Promise.resolve()
    var i = 0

    while (i < toolCalls.length) {
      var name = toolCalls[i].function && toolCalls[i].function.name
      if (READ_ONLY_TOOLS[name]) {
        // Collect contiguous read-only run.
        var batch = []
        while (i < toolCalls.length && READ_ONLY_TOOLS[toolCalls[i].function && toolCalls[i].function.name]) {
          batch.push({ thunk: buildToolCallThunk(toolCalls[i], log, onToolCall), index: i })
          i++
        }
        ;(function (b) {
          chain = chain.then(function () {
            return Promise.all(b.map(function (item) {
              return item.thunk().then(function (r) { resultsByIndex[item.index] = r })
            }))
          })
        })(batch)
      } else {
        // Mutating call — serialize.
        ;(function (tc, idx) {
          var thunk = buildToolCallThunk(tc, log, onToolCall)
          chain = chain.then(thunk).then(function (r) { resultsByIndex[idx] = r })
        })(toolCalls[i], i)
        i++
      }
    }

    return chain.then(function () {
      // Filter out any holes (shouldn't happen, but defensive).
      var out = []
      for (var k = 0; k < resultsByIndex.length; k++) {
        if (resultsByIndex[k]) out.push(resultsByIndex[k])
      }
      return out
    })
  }

  // Export
  if (typeof window !== 'undefined') {
    window.AGENT_TOOL_LOOP = {
      runAgentLoop: runAgentLoop,
      createAbortHandle: createAbortHandle,
      // Single source of truth for "read-only" tools (no AE undo group, safe
      // to parallelize). main.js uses this to count undoable agent actions —
      // keep ONE list so the Undo count can never drift out of sync again.
      READ_ONLY_TOOLS: READ_ONLY_TOOLS
    }
  }
})()
