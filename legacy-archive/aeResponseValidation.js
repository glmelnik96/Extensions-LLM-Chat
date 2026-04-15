;(function () {
  'use strict';

  /**
   * Lightweight response validation against the selected documentation snippets.
   *
   * Goal: detect obviously non-documented APIs and gently annotate the answer
   * under ---NOTES--- without changing the expression itself.
   */

  var DEFAULT_ALLOWED_FUNCTIONS = [
    // General JS / math helpers
    'Math',
    'sin',
    'cos',
    'tan',
    'asin',
    'acos',
    'atan',
    'pow',
    'sqrt',
    'abs',
    'min',
    'max',
    'clamp',
    'floor',
    'ceil',
    'round',
    'random',
    // AE-specific
    'linear',
    'ease',
    'easeIn',
    'easeOut',
    'easeInOut',
    'loopOut',
    'loopIn',
    'valueAtTime',
    'lookAt',
    'length',
    'normalize',
    'seedRandom',
    'posterizeTime',
    'wiggle'
  ];

  var DEFAULT_ALLOWED_IDENTIFIERS = [
    'thisComp',
    'thisLayer',
    'thisProperty',
    'parent',
    'transform',
    'position',
    'anchorPoint',
    'scale',
    'rotation',
    'opacity',
    'effect',
    'time',
    'value',
    'velocity',
    'inPoint',
    'outPoint',
    'index',
    'text',
    'sourceText',
    'sourceRectAtTime',
    'path',
    'points',
    'inTangents',
    'outTangents',
    'textIndex',
    'textTotal',
    'toComp',
    'fromComp'
  ];

  var FORBIDDEN_ENVIRONMENT_IDENTIFIERS = [
    // Browser / DOM
    'window',
    'document',
    'navigator',
    'fetch',
    'XMLHttpRequest',
    // Node-like
    'require',
    'module',
    'process',
    // ExtendScript / JSX / scripting-only
    'app',
    '$',
    'File',
    'Folder',
    'system',
    'system.callSystem'
  ];

  function buildAllowedSetFromDocs (snippets) {
    var set = {};
    DEFAULT_ALLOWED_FUNCTIONS.concat(DEFAULT_ALLOWED_IDENTIFIERS).forEach(function (name) {
      set[name] = true;
    });
    (snippets || []).forEach(function (s) {
      (s.apis || []).forEach(function (name) {
        if (typeof name === 'string' && name) {
          set[name] = true;
        }
      });
    });
    return set;
  }

  function extractExpressionPart (assistantText) {
    if (!assistantText || typeof assistantText !== 'string') return '';
    var sep = '---EXPLANATION---';
    var idx = assistantText.indexOf(sep);
    var expr = idx === -1 ? assistantText : assistantText.slice(0, idx);
    return expr.trim();
  }

  function findSuspiciousIdentifiers (expression, allowedSet) {
    var suspicious = {};
    if (!expression) return [];

    // Function-like identifiers foo(...)
    var funcRegex = /\b([A-Za-z_]\w*)\s*\(/g;
    var match;
    while ((match = funcRegex.exec(expression))) {
      var name = match[1];
      if (!allowedSet[name]) {
        suspicious[name] = true;
      }
    }

    // Property-like identifiers .foo
    var propRegex = /\.([A-Za-z_]\w*)\b/g;
    while ((match = propRegex.exec(expression))) {
      var propName = match[1];
      if (!allowedSet[propName]) {
        suspicious[propName] = true;
      }
    }

    return Object.keys(suspicious);
  }

  function findForbiddenEnvironmentPatterns (expression) {
    if (!expression || typeof expression !== 'string') return [];
    var text = expression;
    var found = {};

    // Simple pattern-based checks for obviously non-expression environments.
    var patterns = [
      { name: '$', regex: /\$\s*\./ },
      { name: 'system.callSystem', regex: /system\s*\.\s*callSystem\s*\(/ },
      { name: 'app', regex: /\bapp\s*\./ },
      { name: 'window', regex: /\bwindow\s*[\.\[]/ },
      { name: 'document', regex: /\bdocument\s*[\.\[]/ },
      { name: 'navigator', regex: /\bnavigator\s*[\.\[]/ },
      { name: 'fetch', regex: /\bfetch\s*\(/ },
      { name: 'XMLHttpRequest', regex: /\bXMLHttpRequest\s*\(/ },
      { name: 'require', regex: /\brequire\s*\(/ },
      { name: 'module', regex: /\bmodule\s*[\.\[]/ },
      { name: 'process', regex: /\bprocess\s*[\.\[]/ },
      { name: 'File', regex: /\bFile\s*\(/ },
      { name: 'Folder', regex: /\bFolder\s*\(/ }
    ];

    patterns.forEach(function (p) {
      if (p.regex.test(text)) {
        found[p.name] = true;
      }
    });

    return Object.keys(found);
  }

  function appendValidationNotes (assistantText, issues, forbiddenIssues) {
    var hasIssues = (issues && issues.length) || (forbiddenIssues && forbiddenIssues.length);
    if (!hasIssues) return assistantText;
    var text = assistantText || '';

    var notesSep = '---NOTES---';
    var hasNotes = text.indexOf(notesSep) !== -1;
    if (!hasNotes) {
      // Ensure expression + explanation already exist; if not, append safely.
      if (text.indexOf('---EXPLANATION---') === -1) {
        text = text.trim() + '\n---EXPLANATION---\n- Краткое объяснение недоступно.\n';
      }
      text += '\n' + notesSep + '\n';
    } else {
      text += '\n';
    }

    if (issues && issues.length) {
      var genericSnippet =
        '- Внимание: в выражении используются функции или свойства, ' +
        'которые не найдены в локальном справочнике выражений After Effects: ' +
        issues.join(', ') +
        '. Пожалуйста, сверитесь с официальной справкой AE или упростите выражение.';
      text += genericSnippet + '\n';
    }

    if (forbiddenIssues && forbiddenIssues.length) {
      var forbiddenSnippet =
        '- Важно: в выражении обнаружены идентификаторы, которые относятся к браузеру, Node или ' +
        'ExtendScript/JSX окружению и не поддерживаются в выражениях After Effects: ' +
        forbiddenIssues.join(', ') +
        '. Такие конструкции обычно работают только в скриптах, а не в expression, поэтому перепишите ' +
        'выражение, используя только документированные API языка выражений After Effects.';
      text += forbiddenSnippet;
    }

    return text;
  }

  function annotateAssistantWithValidation (assistantText, retrievalResult) {
    var snippets = retrievalResult && retrievalResult.snippets ? retrievalResult.snippets : [];
    var expr = extractExpressionPart(assistantText);
    if (!expr) return assistantText;

    var allowedSet = buildAllowedSetFromDocs(snippets);
    var issues = findSuspiciousIdentifiers(expr, allowedSet);

    // Separate obviously forbidden environment identifiers (browser/Node/ExtendScript)
    // so we can warn more explicitly about them, while keeping validation advisory-only.
    var forbiddenIssues = [];
    if (issues && issues.length) {
      issues = issues.filter(function (name) {
        if (FORBIDDEN_ENVIRONMENT_IDENTIFIERS.indexOf(name) !== -1) {
          forbiddenIssues.push(name);
          return false;
        }
        return true;
      });
    }

    // Also detect composite environment patterns like $.writeln or system.callSystem()
    // that may not surface cleanly as a single identifier.
    var patternHits = findForbiddenEnvironmentPatterns(expr);
    patternHits.forEach(function (name) {
      if (FORBIDDEN_ENVIRONMENT_IDENTIFIERS.indexOf(name) !== -1 && forbiddenIssues.indexOf(name) === -1) {
        forbiddenIssues.push(name);
      }
    });

    if ((!issues || !issues.length) && (!forbiddenIssues || !forbiddenIssues.length)) {
      return assistantText;
    }

    return appendValidationNotes(assistantText, issues, forbiddenIssues);
  }

  if (typeof window !== 'undefined') {
    window.AE_ANNOTATE_ASSISTANT_WITH_VALIDATION = annotateAssistantWithValidation;
  } else {
    this.AE_ANNOTATE_ASSISTANT_WITH_VALIDATION = annotateAssistantWithValidation;
  }
})();

