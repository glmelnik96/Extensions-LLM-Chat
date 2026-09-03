/**
 * Phantom-"done" guard: detect final agent replies that claim completed work
 * the run never actually performed.
 *
 * Two live-observed failure shapes (bug-hunt round 5, GLM-4.7):
 *  1. no-tools: the model answered "Готово! Добавил слайдер…" with ZERO tool
 *     calls in the whole run — nothing in the comp changed, the user gets a
 *     confident lie. (Turn A3: second slider + wiggle "applied", comp probe
 *     showed neither existed.)
 *  2. unresolved-failures: a mutating call failed (all 20 batch targets
 *     rejected) and the model still closed the turn with a success report
 *     without any later successful mutating call. (Turn A4: "Сетка поднята
 *     на 80px" after set_keyframes_batch 0/20 succeeded.)
 *
 * The agent loop consults this before accepting a text answer as final and,
 * on a hit, injects ONE corrective [SYSTEM] user message so the model can
 * actually do the work or report honestly. One nudge per run — no loops.
 */
(function () {
  'use strict'

  // Past-tense action claims, RU + EN. Deliberately past/perfective only:
  // present-tense explanation wording ("wiggle добавляет случайное движение",
  // "this adds noise") must NOT trigger the guard on pure Q&A replies.
  var ACTION_CLAIM_RE = new RegExp([
    '\u0433\u043e\u0442\u043e\u0432\u043e', // готово
    '\u0441\u0434\u0435\u043b\u0430\u043d\u043e', // сделано
    '\u0441\u0434\u0435\u043b\u0430\u043b', // сделал
    '\u0441\u043e\u0437\u0434\u0430\u043b', // создал
    '\u0434\u043e\u0431\u0430\u0432\u0438\u043b', // добавил
    '\u0438\u0437\u043c\u0435\u043d\u0438\u043b', // изменил
    '\u043f\u0440\u0438\u043c\u0435\u043d\u0438\u043b', // применил
    '\u0438\u0441\u043f\u0440\u0430\u0432\u0438\u043b', // исправил
    '\u043e\u0431\u043d\u043e\u0432\u0438\u043b', // обновил
    '\u0443\u0434\u0430\u043b\u0438\u043b', // удалил
    '\u043d\u0430\u0441\u0442\u0440\u043e\u0438\u043b', // настроил
    '\u043f\u0435\u0440\u0435\u0438\u043c\u0435\u043d\u043e\u0432\u0430\u043b', // переименовал
    '\u043f\u0435\u0440\u0435\u043a\u0440\u0430\u0441\u0438\u043b', // перекрасил
    '\u043f\u0440\u0438\u0432\u044f\u0437\u0430\u043b', // привязал
    '\\bdone\\b',
    '\\bcreated\\b',
    '\\badded\\b',
    '\\bapplied\\b',
    '\\bupdated\\b',
    '\\bfixed\\b',
    '\\brenamed\\b',
    '\\bsuccessfully\\b',
    'has been (created|added|applied|updated|changed|fixed)'
  ].join('|'), 'i')

  // A reply that is a PLAN (numbered steps naming tools / future-tense
  // intentions) delivered where the action should have been. Eval corpus
  // 2026-09-02: with the plan-first turn on, gpt-oss-120b sometimes answers
  // the execution turn with the plan again (4 of 25 cases, zero tool calls)
  // — the loop then accepted a to-do list as the final answer.
  var TOOL_NAME_RE = /`?\b(get_detailed_comp_summary|get_host_context|search_layers|set_property_value|set_keyframes_batch|add_keyframes|apply_expression(_batch)?|apply_motion_recipe|batch_call|set_layer_parent|set_layer_timing|set_layer_switches|create_layer|set_text_document|probe_motion|get_keyframes|link_properties|add_effect|set_effect_property)\b`?/
  var PLAN_STEP_RE = /(^|\n)\s*(\d+[.)]|[a-z][.)]|[-*•])\s+.{0,40}(\u0432\u044b\u0437\u0432\u0430\u0442\u044c|\u043f\u043e\u043b\u0443\u0447\u0438\u0442\u044c|\u043f\u043e\u043b\u0443\u0447\u0438\u043c|\u043f\u0440\u0438\u043c\u0435\u043d\u0438\u0442\u044c|\u043f\u0440\u0438\u043c\u0435\u043d\u0438\u043c|\u0432\u044b\u0447\u0438\u0441\u043b\u0438\u0442\u044c|\u0432\u044b\u0447\u0438\u0441\u043b\u0438\u043c|\u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0438\u0442\u044c|\u043e\u043f\u0440\u0435\u0434\u0435\u043b\u0438\u043c|\u043d\u0430\u0439\u0442\u0438|\u043d\u0430\u0439\u0434\u0451\u043c|\u043d\u0430\u0439\u0434\u0435\u043c|\u0441\u043e\u0437\u0434\u0430\u0442\u044c|\u0441\u043e\u0437\u0434\u0430\u0434\u0438\u043c|\u0434\u043e\u0431\u0430\u0432\u0438\u0442\u044c|\u0434\u043e\u0431\u0430\u0432\u0438\u043c|\u0443\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u0442\u044c|\u0443\u0441\u0442\u0430\u043d\u043e\u0432\u0438\u043c|\u043f\u0440\u043e\u0432\u0435\u0440\u0438\u0442\u044c|\u043f\u0440\u043e\u0432\u0435\u0440\u0438\u043c|\u0437\u0430\u0434\u0430\u0442\u044c|\u0437\u0430\u0434\u0430\u0434\u0438\u043c|will\b|call\b|fetch\b|compute\b|apply\b|set\b|create\b|then\b)/i
  var PLAN_HEADER_RE = /(\u043f\u043b\u0430\u043d|\u0448\u0430\u0433\u0438|\u0446\u0435\u043b\u044c|\u043e\u0436\u0438\u0434\u0430\u0435\u043c\u044b\u0439 \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442|\bplan\b|\bsteps\b|\btargets?\b|expected result|hard constraints)/i

  /** True when the text reads as a to-do plan rather than a report or a question. */
  function looksLikePlan (text) {
    var t = String(text || '')
    if (t.indexOf('?') !== -1 && t.length < 400) return false
    var steps = (t.match(PLAN_STEP_RE) || []).length
    var stepLines = t.split(/\n/).filter(function (l) { return /^\s*(\d+[.)]|[a-z][.)]|[-*•])\s+/.test(l) }).length
    return (PLAN_HEADER_RE.test(t) && stepLines >= 2 && (steps >= 1 || TOOL_NAME_RE.test(t))) || (stepLines >= 3 && TOOL_NAME_RE.test(t))
  }

  /**
   * Decide whether the final text answer needs a corrective nudge.
   *
   * @param {string} content - the model's final visible reply
   * @param {Array} toolCallLog - loop log entries ({ name, status, result })
   * @param {Object} readOnlyTools - map of tool names that cannot mutate
   * @returns {null | { reason: 'no-tools' | 'unresolved-failures', failedSummary?: string[] }}
   */
  function checkPhantomDone (content, toolCallLog, readOnlyTools) {
    var text = String(content || '')
    var log = toolCallLog || []

    if (log.length === 0) {
      if (ACTION_CLAIM_RE.test(text)) return { reason: 'no-tools' }
      if (looksLikePlan(text)) return { reason: 'plan-only' }
      return null
    }

    // A reply that asks the user something is treated as an honest handoff —
    // overriding a clarification question with "go fix it" would make the
    // model guess instead of asking.
    if (text.indexOf('?') !== -1) return null

    var lastFail = -1
    for (var i = 0; i < log.length; i++) {
      if (log[i].status === 'error') lastFail = i
    }
    if (lastFail === -1) return null

    // A successful MUTATING call after the last failure counts as recovery
    // (the model re-did the work another way). Read-only calls do not.
    for (var j = lastFail + 1; j < log.length; j++) {
      if (log[j].status === 'ok' && !(readOnlyTools && readOnlyTools[log[j].name])) return null
    }

    var failed = []
    for (var k = 0; k < log.length && failed.length < 4; k++) {
      if (log[k].status !== 'error') continue
      var msg = (log[k].result && log[k].result.message) ? String(log[k].result.message).slice(0, 140) : ''
      failed.push(log[k].name + (msg ? ' — ' + msg : ''))
    }
    return { reason: 'unresolved-failures', failedSummary: failed }
  }

  /** Build the corrective [SYSTEM] user message for a guard hit. */
  function buildNudge (guard) {
    if (guard && guard.reason === 'plan-only') {
      return '[SYSTEM] That is a plan, not the work. The plan is accepted — now EXECUTE it: call the tools in this turn ' +
        '(start with the read you planned, then the mutations). Do not restate the plan. If you cannot proceed without an answer from the user, ask ONE concrete question instead.'
    }
    if (guard && guard.reason === 'no-tools') {
      return '[SYSTEM] You made ZERO tool calls this turn — nothing in the composition changed, ' +
        'yet your reply claims completed work. Either perform the work NOW with real tool calls, ' +
        'or state honestly that no changes were made. Never present unperformed work as done.'
    }
    var list = (guard && guard.failedSummary && guard.failedSummary.length)
      ? guard.failedSummary.join('; ')
      : 'see tool results above'
    return '[SYSTEM] Tool call(s) failed this turn with no successful retry afterwards: ' + list + '. ' +
      'The user\'s request may be only partially applied. Verify the actual comp state with read-only tools, ' +
      'fix what is missing, and make your final reply match what really happened. ' +
      'If something cannot be done or you need clarification, say so explicitly.'
  }

  var api = { checkPhantomDone: checkPhantomDone, buildNudge: buildNudge, looksLikePlan: looksLikePlan, ACTION_CLAIM_RE: ACTION_CLAIM_RE }

  if (typeof window !== 'undefined') window.PURE_DONE_GUARD = api
  if (typeof module !== 'undefined' && module.exports) module.exports = api
})()
