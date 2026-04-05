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

  var DEFAULT_MAX_STEPS = 15
  var DEFAULT_TEMPERATURE = 0.3

  /**
   * Run the agent tool loop.
   *
   * @param {object} options
   *   - modelId:     string — model to use (e.g. "cloudru/Qwen/Qwen3-Coder-Next")
   *   - systemPrompt: string — system prompt text
   *   - messages:     Array — conversation history (user/assistant messages)
   *   - tools:        Array — OpenAI-compatible tool definitions (default: all from registry)
   *   - maxSteps:     number — max tool-call rounds (default 15)
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
        temperature: temperature
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
   * Execute tool calls one at a time (AE ExtendScript is single-threaded).
   */
  function executeToolCallsSequentially (toolCalls, log, onToolCall) {
    var results = []
    var chain = Promise.resolve()

    for (var i = 0; i < toolCalls.length; i++) {
      (function (tc) {
        chain = chain.then(function () {
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

          return window.HOST_BRIDGE.executeToolCall(toolName, args)
            .then(function (hostResult) {
              logEntry.result = hostResult
              logEntry.status = hostResult.ok ? 'ok' : 'error'
              logEntry.endTime = Date.now()
              onToolCall(logEntry)

              results.push({
                id: logEntry.id,
                content: JSON.stringify(hostResult)
              })
            })
            .catch(function (err) {
              logEntry.result = { ok: false, message: err.message }
              logEntry.status = 'error'
              logEntry.endTime = Date.now()
              onToolCall(logEntry)

              results.push({
                id: logEntry.id,
                content: JSON.stringify({ ok: false, message: err.message })
              })
            })
        })
      })(toolCalls[i])
    }

    return chain.then(function () { return results })
  }

  // Export
  if (typeof window !== 'undefined') {
    window.AGENT_TOOL_LOOP = {
      runAgentLoop: runAgentLoop,
      createAbortHandle: createAbortHandle
    }
  }
})()
