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
   *   - journal:      string — the agent's own change journal ([SYSTEM] text from
   *                   lib/pure/changeJournal.js), inserted right before the latest user message
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
    // Tool gating (2026-09-02, lib/pure/toolGating.js): the 69 schemas cost
    // ~17k tokens per model call. With options.toolGating the model is offered
    // CORE tools + the groups the conversation mentions; a gated group is
    // loaded the moment the model calls one of its tools (it knows the names
    // from the prompt), and that call still executes — a missed keyword costs
    // nothing but one schema-less call.
    var gating = options.toolGating === true && !!window.PURE_TOOL_GATING && tools.length > 0
    var allTools = tools
    var activeGroups = gating ? window.PURE_TOOL_GATING.initialGroups(conversationMessages) : []
    var initialGroupsSnapshot = activeGroups.slice()
    var loadedOnDemand = []
    if (gating) tools = window.PURE_TOOL_GATING.selectTools(allTools, activeGroups)
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
    // Plan-first turn (2026-09-02): one tool-less model call that writes
    // targets / hard constraints / expected result / steps before anything is
    // touched. The plan is shown to the user and stays in the loop history so
    // the VERIFY turn can hold the model to it. Opt-in via options.planTurn;
    // thinkingFirstTurn applies to this turn when it runs.
    var planTurn = options.planTurn === true
    var onPlan = options.onPlan || function () {}
    var planText = ''
    // Verify turn (2026-09-02): before accepting a final answer after >= 1
    // successful mutating call, hand the model the ACTUAL scene diff (from
    // options.getSceneDiff) and demand measurement + fixes. Once per run.
    var verifyTurn = options.verifyTurn === true && typeof options.getSceneDiff === 'function'
    var verifyUsed = false
    // Eval corpus 2026-09-03 (stagger-new): the VERIFY diff said "NO changes"
    // and the model still reported the animation as done. Remember what the
    // verify turn saw so the reply after it can be held to it.
    var verifyNoChange = false
    var verifyLogLen = -1

    // Build the full message array for the API.
    var messages = []
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt })
    }
    // Add conversation history.
    for (var i = 0; i < conversationMessages.length; i++) {
      messages.push(conversationMessages[i])
    }
    // Change journal (2026-09-03, lib/pure/changeJournal.js): what this agent
    // changed earlier in the comp, as one [SYSTEM] message right before the
    // new request — so "faster / again / undo" edits the rig it built instead
    // of building a second one. options.journal is the formatted text.
    var journalText = (typeof options.journal === 'string') ? options.journal.replace(/^\s+|\s+$/g, '') : ''
    if (journalText) {
      var lastUserIdx = -1
      for (var ju = 0; ju < messages.length; ju++) if (messages[ju] && messages[ju].role === 'user') lastUserIdx = ju
      if (lastUserIdx >= 0) messages.splice(lastUserIdx, 0, { role: 'user', content: journalText })
    }

    var toolCallLog = []
    var totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    // Cloud.ru vLLM 0.22 streaming bug guard: retries allowed when the server
    // reports finish_reason=tool_calls but delivers zero tool calls.
    var emptyToolCallRetries = 0
    var EMPTY_TOOL_CALL_MAX_RETRIES = 2
    // Tool calls recovered from `content` (see the salvage block in step()).
    // Capped so a model stuck emitting JSON prose can't drive the loop by
    // itself for all 60 steps.
    var salvagedCalls = 0
    var MAX_SALVAGED_CALLS = 10
    // Phantom-"done" guard (lib/pure/doneGuard.js): one corrective nudge per
    // run when the final text claims work that never happened (zero tool
    // calls) or ends on unrecovered tool failures. Observed live (round-5
    // hunt, GLM-4.7): "Готово! Добавил слайдер…" with 0 tool calls, and a
    // success report right after set_keyframes_batch failed 20/20 targets.
    var doneNudgeUsed = false

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
        // Step cap hit mid-work. Previously the run ended with a bare
        // "[maximum step limit]" system stub — the model never reported what
        // it did or did NOT finish, so partial/broken state looked like
        // success (observed live: 6x6 grid correction died at step 60 with 14
        // stray half-created layers and zero explanation). Give the model ONE
        // tool-less turn to summarize honestly, falling back to the stub if
        // even that fails.
        var capNote = '[Agent reached maximum step limit (' + maxSteps + ').]'
        messages.push({
          role: 'user',
          content: '[SYSTEM] The tool-step limit (' + maxSteps + ') is reached — no more tool calls are possible in this run. ' +
            'Reply NOW, in the language of the conversation, with a short honest status report: ' +
            '(1) what was completed, (2) what was NOT completed or is left half-done (including any temporary/leftover layers), ' +
            '(3) what the user should do or ask next. Never claim unfinished work as done.'
        })
        return window.CHAT_PROVIDER.invoke(modelId, messages, {
          max_tokens: 4096,
          temperature: temperature,
          abortHandle: abortHandle,
          chat_template_kwargs: { enable_thinking: false }
        }).then(function (response) {
          if (response.usage) {
            totalUsage.prompt_tokens += response.usage.prompt_tokens || 0
            totalUsage.completion_tokens += response.usage.completion_tokens || 0
            totalUsage.total_tokens += response.usage.total_tokens || 0
          }
          var finalMsg = response.choices && response.choices[0] && response.choices[0].message
          var finalText = (finalMsg && finalMsg.content) || ''
          return {
            content: capNote + (finalText ? '\n\n' + finalText : ' Partial results above.'),
            toolCallLog: toolCallLog,
            usage: totalUsage
          }
        }).catch(function () {
          return {
            content: capNote + ' Partial results above.',
            toolCallLog: toolCallLog,
            usage: totalUsage
          }
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

          // The model sometimes writes the tool call into `content` instead of
          // emitting it as a tool_calls entry — the run then "finished" with a
          // blob of JSON as its answer and the operation never happened. If the
          // text is nothing but a payload that unambiguously identifies one
          // tool, turn it back into a real call and continue as normal.
          if (toolCalls.length === 0 && salvagedCalls < MAX_SALVAGED_CALLS && window.PURE_TOOL_CALL_SALVAGE) {
            var salvaged = window.PURE_TOOL_CALL_SALVAGE.parseLeakedCall(assistantMsg.content, tools)
            if (salvaged) {
              salvagedCalls++
              toolCalls = [{
                id: 'salvaged_' + stepIndex + '_' + salvagedCalls,
                type: 'function',
                function: { name: salvaged.tool, arguments: JSON.stringify(salvaged.args) }
              }]
              assistantMsg = { role: 'assistant', content: null, tool_calls: toolCalls }
            }
          }

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

            if (gating) expandGroupsFor(toolCalls)
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
          // Phantom-"done" guard: don't accept a success-claiming answer when
          // the run did no work (or ended on unrecovered failures). Inject ONE
          // corrective [SYSTEM] turn so the model actually does the work or
          // reports honestly.
          if (!doneNudgeUsed && assistantMsg.content && window.PURE_DONE_GUARD) {
            var phantom = window.PURE_DONE_GUARD.checkPhantomDone(
              content, toolCallLog, READ_ONLY_TOOLS)
            if (phantom) {
              doneNudgeUsed = true
              messages.push({ role: 'assistant', content: content })
              messages.push({ role: 'user', content: window.PURE_DONE_GUARD.buildNudge(phantom) })
              return step(stepIndex + 1)
            }
          }
          // After a VERIFY that found NO changes: a reply that still claims
          // completed work, with no further tool calls, gets one nudge.
          if (verifyUsed && verifyNoChange && !doneNudgeUsed && toolCallLog.length === verifyLogLen &&
              assistantMsg.content && window.PURE_DONE_GUARD && window.PURE_DONE_GUARD.ACTION_CLAIM_RE.test(content)) {
            doneNudgeUsed = true
            messages.push({ role: 'assistant', content: content })
            messages.push({ role: 'user', content: '[SYSTEM] The scene diff showed NO changes in the composition and you made no further tool calls, yet your reply reports completed work. Either perform the change NOW with tool calls, or state plainly that nothing was changed and why (e.g. a tool refused or removed what you set).' })
            return step(stepIndex + 1)
          }
          // Verify turn: the model wants to finish after real mutations. Hand
          // it the ACTUAL scene diff once and let it measure/fix before the
          // answer is accepted — the final text is then grounded in state,
          // not in the model's memory of what it meant to do.
          if (verifyTurn && !verifyUsed && hasSuccessfulMutation(toolCallLog) && !(abortHandle && abortHandle.aborted)) {
            verifyUsed = true
            return options.getSceneDiff().then(function (diff) {
              verifyNoChange = !!(diff && diff.changed === false)
              verifyLogLen = toolCallLog.length
              messages.push({ role: 'assistant', content: content })
              messages.push({ role: 'user', content: buildVerifyMessage(diff, collectUnlocks(toolCallLog)) })
              return step(stepIndex + 1)
            }, function () {
              return finalResult(content)
            })
          }
          return finalResult(content)
        })
    }

    function addUsage (response) {
      if (response && response.usage) {
        totalUsage.prompt_tokens += response.usage.prompt_tokens || 0
        totalUsage.completion_tokens += response.usage.completion_tokens || 0
        totalUsage.total_tokens += response.usage.total_tokens || 0
      }
    }

    // Result shape: `content` = what the user sees (plan + outcome), `outcome`
    // = the model's final message alone (what evals and guards should judge),
    // `plan` = the plan-turn text ('' when no plan turn ran).
    function finalResult (content) {
      var clean = stripFinalMarker(content)
      if (!clean && planText && toolCallLog.length === 0) clean = planText
      return { content: composeFinal(clean), outcome: clean, plan: planText, toolCallLog: toolCallLog, usage: totalUsage }
    }

    // The model may echo the plan-turn marker on any later turn ('[[final]]'
    // alone, or appended to an answer). It is never part of the answer.
    function stripFinalMarker (text) {
      var t = String(text || '')
      if (t.indexOf(PLAN_FINAL_MARKER) === -1) return t
      return t.split(PLAN_FINAL_MARKER).join('').replace(/^\s+|\s+$/g, '')
    }

    // The plan is shown to the user once; the outcome follows it. With no
    // tool calls both turns may carry the answer — keep the fuller one.
    function composeFinal (content) {
      if (!planText) return content
      if (toolCallLog.length === 0) return (content && content.length > planText.length) ? content : planText
      if (content === planText) return content
      return planText + '\n\n' + content
    }

    // One tool-less model call: plan (targets, constraints, expected result,
    // steps) or, for a pure question, the answer itself marked [[final]].
    function runPlanTurn () {
      messages.push({ role: 'user', content: buildPlanInstruction() })
      var planOptions = {
        max_tokens: 2048,
        temperature: temperature,
        abortHandle: abortHandle
      }
      if (!thinkingFirstTurn) planOptions.chat_template_kwargs = { enable_thinking: false }
      try { onStepStart(0) } catch (_) {}
      return window.CHAT_PROVIDER.invoke(modelId, messages, planOptions).then(function (response) {
        addUsage(response)
        var msg = response.choices && response.choices[0] && response.choices[0].message
        var text = (msg && msg.content) ? String(msg.content) : ''
        // A model that answers only in its reasoning channel leaves content
        // empty — no plan then; drop the instruction and run as before.
        if (!text.replace(/\s+/g, '')) {
          messages.pop()
          return step(0)
        }
        if (text.indexOf(PLAN_FINAL_MARKER) !== -1) {
          var answer = text.split(PLAN_FINAL_MARKER).join('').replace(/^\s+|\s+$/g, '')
          // Eval corpus 2026-09-03 (shrink, and the four "plan restated"
          // failures the day before): the marker also arrives glued to a PLAN
          // or to a "done" claim — one model call, zero tools — and this
          // short-circuit skipped the phantom-done guard entirely. Run the
          // same guard here: a plan or an action claim is never the final
          // answer to a request that needs tools.
          var early = (window.PURE_DONE_GUARD && answer) ? window.PURE_DONE_GUARD.checkPhantomDone(answer, [], READ_ONLY_TOOLS) : null
          if (early) {
            doneNudgeUsed = true
            if (early.reason === 'plan-only') { planText = answer; try { onPlan(planText) } catch (_) {} }
            messages.push({ role: 'assistant', content: answer })
            messages.push({ role: 'user', content: window.PURE_DONE_GUARD.buildNudge(early) })
            return step(0)
          }
          return { content: answer, outcome: answer, plan: '', toolCallLog: toolCallLog, usage: totalUsage }
        }
        planText = text.replace(/\s+$/, '')
        messages.push({ role: 'assistant', content: planText })
        try { onPlan(planText) } catch (_) {}
        return step(0)
      })
    }

    // Attach the partial tool log to any rejection so the UI can render
    // already-executed calls (layers may exist in AE even when the LLM call
    // later times out) and replay them to the model on the next turn (P0-3).
    // Load the groups of any gated tool the model is calling (also inside
    // batch_call items) so its schema is visible from the next turn on.
    function expandGroupsFor (calls) {
      var TG = window.PURE_TOOL_GATING
      var names = []
      for (var i = 0; i < calls.length; i++) {
        var fn = calls[i] && calls[i].function
        if (!fn) continue
        names.push(fn.name)
        if (fn.name === 'batch_call') {
          try {
            var parsed = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : fn.arguments
            var items = (parsed && parsed.calls) || []
            for (var b = 0; b < items.length; b++) if (items[b] && items[b].tool) names.push(items[b].tool)
          } catch (_) {}
        }
      }
      var added = false
      for (var n = 0; n < names.length; n++) {
        var g = TG.groupOfTool(names[n])
        if (g && activeGroups.indexOf(g) === -1) { activeGroups.push(g); loadedOnDemand.push(g); added = true }
      }
      if (added) tools = TG.selectTools(allTools, activeGroups)
    }

    var start = (planTurn && tools.length > 0) ? runPlanTurn : function () { return step(0) }
    return start().then(function (res) {
      if (gating && res && typeof res === 'object') {
        res.toolGating = { initialGroups: initialGroupsSnapshot, loadedOnDemand: loadedOnDemand, offeredTools: tools.length, allTools: allTools.length }
      }
      return res
    }).catch(function (err) {
      var e = err || new Error('Agent loop failed')
      try { e.toolCallLog = toolCallLog; e.usage = totalUsage } catch (_) {}
      throw e
    })
  }

  // Marker a model appends when its plan-turn message IS the final answer
  // (pure question, nothing to do in AE) — the loop then skips the tool turns.
  var PLAN_FINAL_MARKER = '[[final]]'

  /** [SYSTEM] instruction for the tool-less plan turn. */
  function buildPlanInstruction () {
    return '[SYSTEM] PLAN FIRST — no tool calls in this message. Write a short plan (max 10 lines, in the language of the conversation):\n' +
      '1. TARGETS: which layers exactly (names/ids if known from the conversation; otherwise say what you will look up first — never guess a target; if it depends on the current selection or is ambiguous, say you will ask).\n' +
      '2. HARD CONSTRAINTS: everything the request forbids or qualifies ("don\'t touch X", "small", "slow", "only", explicit numbers, order, names).\n' +
      '3. EXPECTED RESULT: what a designer would SEE and MEASURE afterwards (which property changes, from what to what, when; what must stay unchanged).\n' +
      '4. STEPS: the tool calls you intend to make.\n' +
      'This plan is shown to the user as-is; after executing it, your final answer must report the OUTCOME (what actually changed), not repeat the plan. ' +
      'If the request is a pure question that needs no tools at all, answer it now instead of planning and end your message with the marker ' + PLAN_FINAL_MARKER + '.'
  }

  /**
   * [SYSTEM] message for the verify turn. `diff` = { text, changed } from the
   * panel's scene-diff (changed === false means the run mutated nothing).
   */
  function buildVerifyMessage (diff, unlocked) {
    var text = (diff && diff.text) ? String(diff.text) : 'Scene diff unavailable.'
    var head = '[SYSTEM] VERIFY before finishing. Ground truth — actual changes in the composition since the request started:\n' + text + '\n\n'
    // Eval corpus 2026-09-02: the model unlocked a locked layer inside a
    // batch_call, moved it, locked it again and reported a plain move. The
    // snapshot diff cannot see a transient unlock — the tool log can.
    if (unlocked && unlocked.length) {
      head += 'You UNLOCKED layer(s) during this run (' + unlocked.join(', ') + ') — the user locked them on purpose. State this explicitly in your answer (and whether you locked them again); never present the change as if the lock had not been there. '
    }
    if (diff && diff.changed === false) {
      head += 'NO changes were detected: your tool calls did not alter the composition state (wrong target, value overridden by an expression, or nothing applied). '
    }
    // Live finding (2026-09-02): the model scaled a layer whose video switch
    // was off, got the host WARNING, and still told the user nothing. The
    // diff marks such layers; make the verify turn act on the mark.
    if (text.indexOf('holds ') !== -1 && text.indexOf(' BEFORE ') !== -1) {
      head += 'A property marked "holds X BEFORE t" is at that value from the layer\'s in-point until its first key — the layer is VISIBLE before its window. Add a key at the in-point with the off value (out_type hold) or trim with set_layer_timing if it must be hidden until then. '
    }
    if (text.indexOf('[video switch OFF') !== -1) {
      head += 'A layer marked [video switch OFF] renders NOTHING — whatever you changed on it is invisible: enable it (set_layer_switches enabled:true) if the request implies it should be seen, otherwise state explicitly in your answer that the layer is hidden. '
    }
    return head +
      'Compare this with your PLAN (targets, hard constraints, expected result). Where motion or timing matters, MEASURE it now with probe_motion ' +
      '(space:"comp" for parented layers) or get_keyframes instead of assuming. If anything is missing, wrong, or touched something the request said not to touch, fix it now with tool calls. ' +
      'Then give the final answer for the user: what changed (layers, properties, timings) and what was NOT done. Never report unperformed work.'
  }

  /** Layers whose lock was released by set_layer_switches during the run (also inside batch_call). */
  function collectUnlocks (log) {
    var out = []
    function note (args) {
      if (!args || args.locked !== false) return
      var label = (typeof args.layer_id === 'number') ? 'layer_id ' + args.layer_id
        : (typeof args.layer_index === 'number') ? 'layer_index ' + args.layer_index : 'a layer'
      if (out.indexOf(label) === -1) out.push(label)
    }
    for (var i = 0; i < (log ? log.length : 0); i++) {
      var e = log[i]
      if (!e || e.status !== 'ok') continue
      if (e.name === 'set_layer_switches') note(e.args)
      if (e.name === 'batch_call' && e.args && e.args.calls instanceof Array) {
        for (var b = 0; b < e.args.calls.length; b++) {
          var it = e.args.calls[b]
          if (it && it.tool === 'set_layer_switches') note(it.args)
        }
      }
    }
    return out
  }

  /** True when at least one mutating (non read-only) call succeeded. */
  function hasSuccessfulMutation (log) {
    for (var i = 0; i < (log ? log.length : 0); i++) {
      if (log[i].status === 'ok' && !READ_ONLY_TOOLS[log[i].name]) return true
    }
    return false
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
    probe_motion: 1,
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
    delete_user_expression: 1,
    // Renders audio to a temp file + uploads it — heavy, but does not modify
    // the project (render queue state is restored), so no Undo counting.
    // Kept OUT of parallel batches implicitly: the render queue is a shared
    // singleton, but read-only tools only parallelize with each other and
    // other reads don't touch the RQ.
    transcribe_comp_audio: 1
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
        // Large payloads (esp. batch_call) get corrupted by the model itself —
        // retrying the same giant call fails identically (observed live: 3x the
        // exact same parse error at the same offset). Tell the model to SPLIT
        // instead of re-issuing verbatim.
        var parseErrMsg = 'Tool arguments were not valid JSON (' + argParseError +
          '). Re-issue this call with a single well-formed JSON object as the arguments.'
        if (toolName === 'batch_call' || (typeof rawArgs === 'string' && rawArgs.length > 4000)) {
          parseErrMsg += ' Your payload was large (' +
            (typeof rawArgs === 'string' ? rawArgs.length : 0) +
            ' chars) — do NOT retry the same big call: split the work into several smaller batches (max 8 inner calls each) or individual tool calls.'
        }
        var parseErrResult = {
          ok: false,
          message: parseErrMsg
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
      buildPlanInstruction: buildPlanInstruction,
      buildVerifyMessage: buildVerifyMessage,
      collectUnlocks: collectUnlocks,
      PLAN_FINAL_MARKER: PLAN_FINAL_MARKER,
      // Single source of truth for "read-only" tools (no AE undo group, safe
      // to parallelize). main.js uses this to count undoable agent actions —
      // keep ONE list so the Undo count can never drift out of sync again.
      READ_ONLY_TOOLS: READ_ONLY_TOOLS
    }
  }
})()
