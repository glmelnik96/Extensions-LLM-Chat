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

  var DEFAULT_MAX_STEPS = 150
  var DEFAULT_TEMPERATURE = 0.3

  /**
   * Run the agent tool loop.
   *
   * @param {object} options
   *   - modelId:     string — model to use (e.g. "cloudru/Qwen/Qwen3-Coder-Next")
   *   - systemPrompt: string — system prompt text
   *   - messages:     Array — conversation history (user/assistant messages)
   *   - tools:        Array — OpenAI-compatible tool definitions (default: all from registry)
   *   - maxSteps:     number — max tool-call rounds (default 150)
   *   - temperature:  number — (default 0.3)
   *   - onToolCall:   function(toolCall) — callback for UI updates per tool call
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

    var modelId = options.modelId
    var systemPrompt = options.systemPrompt || ''
    var conversationMessages = options.messages || []
    var tools = options.tools || (window.AGENT_TOOL_REGISTRY && window.AGENT_TOOL_REGISTRY.tools) || []
    var maxSteps = (typeof options.maxSteps === 'number') ? options.maxSteps : DEFAULT_MAX_STEPS
    var temperature = (typeof options.temperature === 'number') ? options.temperature : DEFAULT_TEMPERATURE
    var onToolCall = options.onToolCall || function () {}
    var onStepComplete = options.onStepComplete || function () {}
    var onTextChunk = options.onTextChunk || null
    var abortHandle = options.abortHandle || null

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

    function step (stepIndex) {
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
        max_tokens: 4096,
        temperature: temperature,
        abortHandle: abortHandle,
        onTextChunk: onTextChunk
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

          // Case 1: Model wants to call tools.
          if (choice.finish_reason === 'tool_calls' ||
              (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0)) {

            // Push the assistant message with tool_calls into conversation.
            messages.push(assistantMsg)

            var toolCalls = assistantMsg.tool_calls || []
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

          // Case 2: Model responded with content (done).
          var content = assistantMsg.content || ''
          return {
            content: content,
            toolCallLog: toolCallLog,
            usage: totalUsage
          }
        })
    }

    return step(0)
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
    get_mask_info: 1,
    get_markers: 1,
    list_project_items: 1,
    capture_comp_frame: 1
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
      var args = {}
      try {
        args = typeof tc.function.arguments === 'string'
          ? JSON.parse(tc.function.arguments)
          : (tc.function.arguments || {})
      } catch (e) {
        args = {}
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
      createAbortHandle: createAbortHandle
    }
  }
})()
