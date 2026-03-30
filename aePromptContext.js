;(function () {
  'use strict';

  /**
   * Prompt-context assembly for documentation grounding.
   *
   * This module is responsible for taking a set of documentation snippets
   * and turning them into a structured system message that the model can
   * consume alongside the main system prompt.
   */

  function buildDocsContextBlock (userText, retrievalResult) {
    var snippets = retrievalResult && retrievalResult.snippets ? retrievalResult.snippets : [];
    if (!snippets.length) {
      return (
        '[AFTER_EFFECTS_EXPRESSION_DOCS]\n' +
        'No specific local documentation snippets were matched for this request.\n' +
        '\n' +
        'For this answer, you MUST stay strictly within the clearly documented Adobe After Effects expression ' +
        'environment as described in the official Adobe Expression Language Reference and the docsforadobe ' +
        'After Effects Expression Reference. In particular:\n' +
        '- Use only expression-safe globals and methods such as thisComp, thisLayer, thisProperty, transform, ' +
        'time, value, wiggle(), random(), seedRandom(), valueAtTime(), loopOut(), loopIn(), ease(), linear(), ' +
        'sourceRectAtTime(), expression controls via effect(\"Control Name\")(\"Property Name\"), and the other ' +
        'APIs explicitly documented for expressions.\n' +
        '- Do NOT use browser or DOM globals (for example window, document, navigator, fetch, XMLHttpRequest), ' +
        'Node-like globals (for example require, module, process), or any ExtendScript / JSX / scripting-only ' +
        'APIs (for example app, $.writeln, File, Folder, system.callSystem).\n' +
        '- If you are unsure whether an API is available in expressions, treat it as unsupported: avoid it and ' +
        'prefer a simpler, clearly documented pattern instead.\n' +
        '- Prefer simple, robust expressions that behave like the examples in the official Adobe and ' +
        'docsforadobe references, rather than ambitious constructs that may rely on undocumented behavior.\n' +
        '- When you must make assumptions (for example which property the expression is on, or which layer type ' +
        'is used), state those assumptions briefly in the explanation bullets instead of inventing new APIs.\n' +
        '[/AFTER_EFFECTS_EXPRESSION_DOCS]'
      );
    }

    var lines = [];
    lines.push('[AFTER_EFFECTS_EXPRESSION_DOCS]');
    lines.push(
      'The following are curated excerpts and usage notes from the official Adobe After Effects ' +
        'Expression Language Reference and the docsforadobe After Effects Expression Reference. ' +
        'Treat them as authoritative for this request. Follow them strictly and avoid inventing APIs.'
    );
    lines.push('');
    lines.push('User prompt (for context, do not answer here):');
    lines.push(userText || '');
    lines.push('');

    snippets.forEach(function (s, idx) {
      lines.push('Snippet ' + (idx + 1) + ' – category: ' + s.category + ' – ' + s.title);
      if (s.aeVersion) {
        lines.push('AE version: ' + s.aeVersion);
      }
      if (s.apis && s.apis.length) {
        lines.push('APIs: ' + s.apis.join(', '));
      }
      if (s.text) {
        lines.push('Summary: ' + s.text);
      }
      lines.push('');
    });

    lines.push(
      'Use only properties, functions and patterns that are consistent with these snippets and ' +
        'the known After Effects expression reference. If something is not documented, avoid it or ' +
        'explicitly mark it as an assumption in the explanation.'
    );
    lines.push('[/AFTER_EFFECTS_EXPRESSION_DOCS]');

    return lines.join('\n');
  }

  /**
   * System message wrapper describing how the model should use the docs block.
   */
  function buildGroundingInstructionMessage () {
    return (
      'You are receiving a special documentation block wrapped in [AFTER_EFFECTS_EXPRESSION_DOCS] tags. ' +
      'It contains excerpts and usage notes from the official Adobe After Effects Expression ' +
      'Language Reference and the docsforadobe After Effects Expression Reference. ' +
      'For this user request, you must:\n' +
      '- Treat the documentation block as authoritative for supported APIs and patterns.\n' +
      '- Prefer documented After Effects expression behavior over generic JavaScript behavior.\n' +
      '- Avoid using properties or methods that are not clearly documented there or in the official references.\n' +
      '- If the user request is ambiguous or missing context, ask one short clarifying question in Russian ' +
      'rather than invent missing details.'
    );
  }

  /**
   * Build a full system message string that combines the grounding instructions
   * and the concrete documentation snippets for the current request.
   */
  function buildDocsContextMessage (userText, retrievalResult) {
    var parts = [];
    parts.push(buildGroundingInstructionMessage());
    parts.push('');
    parts.push(buildDocsContextBlock(userText, retrievalResult));
    return parts.join('\n');
  }

  if (typeof window !== 'undefined') {
    window.AE_BUILD_DOCS_CONTEXT_MESSAGE = buildDocsContextMessage;
  } else {
    this.AE_BUILD_DOCS_CONTEXT_MESSAGE = buildDocsContextMessage;
  }
})();

