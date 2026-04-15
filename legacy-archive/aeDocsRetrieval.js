;(function () {
  'use strict';

  /**
   * Lightweight retrieval over AE_DOCS_INDEX.
   *
   * Heuristic only: keyword overlap + simple Russian keyword mapping.
   * Designed to be fast and local; no embeddings or network calls.
   */

  function normalizeText (text) {
    return (text || '').toString().toLowerCase();
  }

  function tokenize (text) {
    return normalizeText(text)
      .split(/[^a-zа-я0-9_]+/i)
      .filter(Boolean);
  }

  // Rough Russian/English -> category hints for better ranking.
  var RUSSIAN_CATEGORY_HINTS = [
    { category: 'transforms', keywords: ['позиция', 'положение', 'anchor', 'якорь', 'масштаб', 'rotation', 'вращение'] },
    { category: 'interpolation_easing', keywords: ['интерполяция', 'плавность', 'ease', 'easing'] },
    { category: 'time_based', keywords: ['время', 'по времени', 'time', 'секунд'] },
    { category: 'valueAtTime', keywords: ['задержка', 'сдвиг', 'valueattime', 'delay', 'offset', 'каскад', 'trail'] },
    { category: 'looping', keywords: ['цикл', 'циклич', 'loop', 'loopout', 'loopin', 'pingpong'] },
    { category: 'random', keywords: ['random', 'рандом', 'wiggle', 'шум', 'тряска', 'noise', 'seedrandom'] },
    { category: 'text_sourceRectAtTime', keywords: ['sourcerectattime', 'рамка', 'bounding', 'ширина текста', 'высота текста'] },
    { category: 'text_index', keywords: ['textindex', 'text total', 'индекс символа', 'по символам'] },
    { category: 'text_source', keywords: ['sourcetext', 'исходный текст', 'source text'] },
    { category: 'expression_controls', keywords: ['контрол', 'slider', 'слайдер', 'dropdown', 'меню', 'angle control', 'color control', 'point control'] },
    { category: 'paths', keywords: ['контур', 'shape', 'path', 'траектория', 'точки'] },
    { category: 'property_references', keywords: ['свойство', 'thisproperty', 'value', 'tocomp', 'fromcomp', 'координаты композиции'] }
  ];

  function inferCategoryBoosts (queryTokens) {
    var boosts = {};
    var joined = ' ' + queryTokens.join(' ') + ' ';
    RUSSIAN_CATEGORY_HINTS.forEach(function (hint) {
      hint.keywords.forEach(function (kw) {
        if (joined.indexOf(' ' + kw + ' ') !== -1) {
          boosts[hint.category] = (boosts[hint.category] || 0) + 2;
        }
      });
    });
    return boosts;
  }

  function scoreDoc (entry, queryTokens, categoryBoosts) {
    var score = 0;
    var kwSet = {};
    (entry.keywords || []).forEach(function (kw) {
      kwSet[normalizeText(kw)] = true;
    });

    queryTokens.forEach(function (tok) {
      if (!tok) return;
      if (kwSet[tok]) {
        score += 3;
      }
    });

    if (categoryBoosts[entry.category]) {
      score += categoryBoosts[entry.category];
    }

    // Small generic boost for more recent AE versions when user mentions 26 or newer.
    if (entry.aeVersion && /26/.test(entry.aeVersion) && queryTokens.indexOf('26') !== -1) {
      score += 1;
    }

    return score;
  }

  function retrieveRelevantDocs (queryText, options) {
    var opts = options || {};
    var maxSnippets = typeof opts.maxSnippets === 'number' ? opts.maxSnippets : 6;

    var allDocs = (typeof AE_DOCS_INDEX !== 'undefined' && AE_DOCS_INDEX) ? AE_DOCS_INDEX : [];
    if (!allDocs.length) {
      return { snippets: [], debug: { reason: 'NO_INDEX' } };
    }

    var tokens = tokenize(queryText || '');
    if (!tokens.length) {
      return { snippets: [], debug: { reason: 'EMPTY_QUERY' } };
    }

    var categoryBoosts = inferCategoryBoosts(tokens);

    var scored = allDocs
      .map(function (entry) {
        return {
          entry: entry,
          score: scoreDoc(entry, tokens, categoryBoosts)
        };
      })
      .filter(function (s) {
        return s.score > 0;
      })
      .sort(function (a, b) {
        return b.score - a.score;
      });

    var top = scored.slice(0, maxSnippets).map(function (s) {
      return s.entry;
    });

    return {
      snippets: top,
      debug: {
        reason: top.length ? 'OK' : 'NO_MATCH',
        tokenCount: tokens.length,
        categoriesBoosted: Object.keys(categoryBoosts)
      }
    };
  }

  if (typeof window !== 'undefined') {
    window.AE_DOCS_RETRIEVE_RELEVANT = retrieveRelevantDocs;
  } else {
    this.AE_DOCS_RETRIEVE_RELEVANT = retrieveRelevantDocs;
  }
})();

