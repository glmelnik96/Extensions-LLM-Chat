/**
 * Vision check — pure functions for the post-agent visual QA feature.
 * After the agent loop finishes a mutating run, capture the comp frame,
 * downscale, send to MiniMax-M3 for a visual verdict, optionally run one
 * correction round.
 *
 * IIFE pattern: exports to window.PURE_VISION_CHECK (browser) and works
 * under node:test via the same vm.runInContext loader other pure modules use.
 */
;(function () {
  'use strict'

  var VISION_MODEL_ID = 'MiniMaxAI/MiniMax-M3'

  var SYSTEM_TEXT = [
    'You are a visual QA reviewer for Adobe After Effects compositions.',
    'You will receive a single frame capture from an AE comp, the user\'s original request, and a summary of what the agent did.',
    'Your job: decide whether the frame plausibly matches the request and whether there are any real visual defects.',
    '',
    'REAL DEFECTS (report these):',
    '- Text overflowing its container or cut off',
    '- Elements fully off-screen that should be visible',
    '- Unreadable contrast (white text on white, etc.)',
    '- Empty/black frame when content was expected',
    '- Clearly wrong colors or layout vs. what was requested',
    '',
    'NOT DEFECTS (ignore these):',
    '- Aesthetic preferences (font choice, spacing, color taste)',
    '- Minor alignment differences',
    '- The frame being a single point in time of an animation',
    '- Layers existing but not yet animated (keyframes at later time)',
    '',
    'Respond with STRICT JSON only, no markdown, no explanation:',
    '{"ok": true, "issues": []}',
    'or',
    '{"ok": false, "issues": ["description of issue 1", "description of issue 2"]}',
    '',
    'Maximum 5 issues. Be concise. If uncertain, lean toward ok:true.'
  ].join('\n')

  /**
   * Build the messages array for the M3 vision call.
   * @param {string} userRequest  - original user prompt
   * @param {string} agentSummary - what the agent did (its text response)
   * @param {string} dataUrl      - data:image/jpeg;base64,... of the downscaled frame
   * @returns {Array} messages for chat/completions
   */
  function buildMessages (userRequest, agentSummary, dataUrl) {
    var textPart = 'User request: ' + (userRequest || '(none)') +
      '\n\nAgent actions summary: ' + (agentSummary || '(no summary)')

    return [
      { role: 'system', content: SYSTEM_TEXT },
      {
        role: 'user',
        content: [
          { type: 'text', text: textPart },
          { type: 'image_url', image_url: { url: dataUrl } }
        ]
      }
    ]
  }

  /**
   * Parse M3's response text into a structured verdict.
   * Robust: strips markdown fences, finds first {...} JSON, tolerates
   * reasoning-only or empty content. Fails open (ok:true) on garbage.
   * @param {string} responseText
   * @returns {{ok: boolean, issues: string[]}}
   */
  function parseVerdict (responseText) {
    var FAIL_OPEN = { ok: true, issues: [] }
    if (!responseText || typeof responseText !== 'string') return FAIL_OPEN

    // Strip markdown code fences
    var cleaned = responseText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()

    // Find first { ... } block
    var start = cleaned.indexOf('{')
    if (start < 0) return FAIL_OPEN

    var depth = 0
    var end = -1
    for (var i = start; i < cleaned.length; i++) {
      if (cleaned.charAt(i) === '{') depth++
      if (cleaned.charAt(i) === '}') {
        depth--
        if (depth === 0) { end = i; break }
      }
    }
    if (end < 0) return FAIL_OPEN

    var jsonStr = cleaned.substring(start, end + 1)
    var parsed
    try {
      parsed = JSON.parse(jsonStr)
    } catch (e) {
      return FAIL_OPEN
    }

    if (!parsed || typeof parsed !== 'object') return FAIL_OPEN

    var ok = parsed.ok !== false
    var issues = []
    if (Array.isArray(parsed.issues)) {
      for (var j = 0; j < parsed.issues.length && issues.length < 5; j++) {
        var item = parsed.issues[j]
        if (item !== null && item !== undefined) {
          issues.push(String(item))
        }
      }
    }

    // GAP 1: ok:false with zero actionable issues → fail open.
    // Prevents a nonsensical correction round with no issues listed.
    if (!ok && issues.length === 0) ok = true

    return { ok: ok, issues: issues }
  }

  /**
   * True when an issue describes only frame emptiness (black/blank/empty
   * frame, nothing visible). With a single-frame capture this is usually the
   * capture time predating every layer's in-point — NOT a real defect.
   * Bug-hunt 2026-08-16 finding #2: such false verdicts triggered correction
   * rounds that made destructive phantom "fixes" (reordered layers, moved
   * the camera).
   * @param {string} issue
   * @returns {boolean}
   */
  function isEmptyFrameIssue (issue) {
    var t = String(issue || '')
    if (/\bno (visible )?(content|layers?|elements?)\b/i.test(t)) return true
    if (/\bnothing (is |appears )?(visible|shown|rendered|displayed)\b/i.test(t)) return true
    return /\b(black|blank|empty|dark)\b/i.test(t) &&
      /\b(frame|screen|canvas|comp|composition|image)\b/i.test(t)
  }

  /**
   * Split verdict issues into actionable ones and weak (frame-emptiness)
   * ones. When `actionable` is empty the caller must SKIP the correction
   * round — running the agent on emptiness-only issues mutates the comp
   * based on a false signal.
   * @param {string[]} issues
   * @returns {{actionable: string[], weak: string[]}}
   */
  function classifyIssues (issues) {
    var actionable = []
    var weak = []
    var list = Array.isArray(issues) ? issues : []
    for (var i = 0; i < list.length; i++) {
      if (isEmptyFrameIssue(list[i])) weak.push(String(list[i]))
      else actionable.push(String(list[i]))
    }
    return { actionable: actionable, weak: weak }
  }

  /**
   * Build the follow-up user message for the correction agent-loop run.
   * @param {string[]} issues
   * @returns {string}
   */
  function buildCorrectionPrompt (issues) {
    var lines = [
      'Visual check found the following issues with the current comp frame:',
      ''
    ]
    for (var i = 0; i < issues.length; i++) {
      lines.push('- ' + issues[i])
    }
    lines.push('')
    lines.push('IMPORTANT: the visual check sees ONE still frame and can be wrong (e.g. the frame was captured at a time where layers are not yet visible). FIRST verify each issue against the actual comp state (get_detailed_comp_summary, get_layer_properties, get_keyframes). If an issue is a false positive, change NOTHING for it and say so.')
    lines.push('Fix ONLY the confirmed visual defects with minimal changes. Do not redesign, restructure, reorder layers, or move the camera unless a confirmed issue directly requires it.')
    return lines.join('\n')
  }

  // Export
  if (typeof window !== 'undefined') {
    window.PURE_VISION_CHECK = {
      VISION_MODEL_ID: VISION_MODEL_ID,
      buildMessages: buildMessages,
      parseVerdict: parseVerdict,
      classifyIssues: classifyIssues,
      buildCorrectionPrompt: buildCorrectionPrompt
    }
  }
})()
