/**
 * Subtitle cue building (pure, no DOM, no Node deps).
 * Browser global window.PURE_SUBTITLES + Node module for tests.
 *
 * Ported from the Premiere Pro sibling plugin (Extensions-LLM-Chat_Pr,
 * client/shared/reels-pipeline.js) where the pipeline is battle-tested on
 * hour-long podcasts. Cloud.ru Whisper (openai/whisper-large-v3) does NOT
 * return word-level timestamps (verified live twice: timestamp_granularities
 * probe -> 200 OK, words empty), so word timing is deterministic:
 * syllable-weighted distribution across the segment, optionally skipping
 * silences >= 0.3s. Line breaking penalizes hanging prepositions/conjunctions
 * (RU glue words) and unbalanced lines.
 *
 * Pipeline: normalizeWhisperSegments(raw) -> buildCues(segments, opts)
 * -> [{startSec, endSec, text('\n'-separated), words:[{w,s,e}]}] ready for
 * the create_subtitles host function (Source Text hold keyframes).
 */
;(function (root, factory) {
  var api = factory()
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (root) root.PURE_SUBTITLES = api
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  /* ── Whisper response → normalized segments ─────────────────────────── */

  /**
   * verbose_json → [{startSec, endSec, text}]. Accepts the raw parsed
   * response object or an already-normalized array (idempotent).
   * offsetSec shifts all timestamps (audio rendered from a comp span).
   */
  function normalizeWhisperSegments (raw, offsetSec) {
    var off = isFinite(Number(offsetSec)) ? Number(offsetSec) : 0
    var src = null
    if (raw && Object.prototype.toString.call(raw.segments) === '[object Array]') src = raw.segments
    else if (Object.prototype.toString.call(raw) === '[object Array]') src = raw
    if (!src) return []
    var out = []
    for (var i = 0; i < src.length; i++) {
      var sg = src[i]
      if (!sg) continue
      var s = Number(sg.startSec !== undefined ? sg.startSec : sg.start)
      var e = Number(sg.endSec !== undefined ? sg.endSec : sg.end)
      var text = String(sg.text == null ? '' : sg.text).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '')
      if (!isFinite(s) || !isFinite(e) || e <= s || !text) continue
      out.push({ startSec: Math.round((s + off) * 1000) / 1000, endSec: Math.round((e + off) * 1000) / 1000, text: text })
    }
    return out
  }

  /* ── Speech intervals: segment minus silences >= minSilenceSec ──────── */

  function _speechIntervals (start, end, silences, minSilenceSec) {
    var minSil = minSilenceSec > 0 ? minSilenceSec : 0.3
    var sils = []
    var n = silences ? silences.length : 0
    for (var i = 0; i < n; i++) {
      var sl = silences[i]
      if (!sl) continue
      var s = Number(sl.startSec !== undefined ? sl.startSec : sl.start)
      var e = Number(sl.endSec !== undefined ? sl.endSec : sl.end)
      if (!isFinite(s) || !isFinite(e) || e - s < minSil) continue
      var cs = Math.max(s, start)
      var ce = Math.min(e, end)
      if (ce > cs) sils.push({ s: cs, e: ce })
    }
    if (!sils.length) return [{ s: start, e: end }]
    sils.sort(function (a, b) { return a.s - b.s })
    var out = []
    var cur = start
    for (var k = 0; k < sils.length; k++) {
      if (sils[k].s > cur + 1e-9) out.push({ s: cur, e: sils[k].s })
      cur = Math.max(cur, sils[k].e)
    }
    if (cur < end - 1e-9) out.push({ s: cur, e: end })
    if (!out.length) return [{ s: start, e: end }]
    // Whisper often opens a segment ~0.2s BEFORE the pause that separates it
    // from the previous phrase (live-measured on BRAW: segment 8.0, silence
    // 8.217-9.267, actual phrase onset 9.267). That leading voiced sliver is
    // the previous phrase's tail — too short to be this segment's first word.
    // Drop it so words (and the cue start) land after the pause. Divergence
    // from the Premiere-plugin implementation, which keeps the sliver.
    if (out.length > 1 && out[0].e - out[0].s < 0.4) out.shift()
    return out
  }

  /* ── Word weight: syllables + per-word overhead ─────────────────────── */

  /**
   * Spoken duration tracks SYLLABLE count far better than character count:
   * "и" vs "вздрогнешь" differ 1:10 in chars but 1:2 in time, and "them" is
   * one syllable despite 4 chars. Weight = vowels (RU + EN) + 0.4 constant
   * per-word overhead (articulation onset + inter-word micro-gap), so short
   * function words are not squeezed to near-zero. Punctuation and quotes
   * carry no duration and are ignored. Digit runs are read out as full
   * numerals ("2026" ≈ "две тысячи двадцать шесть"), ~2 syllables per digit.
   */
  var _VOWEL_RE = /[аеёиоуыэюяaeiouy]/ig
  function _wordWeight (w) {
    var s = String(w == null ? '' : w)
    var digits = s.match(/[0-9]/g)
    var m = s.match(_VOWEL_RE)
    var syl = (m ? m.length : 0) + (digits ? digits.length * 2 : 0)
    if (syl < 1) syl = 1
    return syl + 0.4
  }

  /**
   * Syllable-weighted word timing across speech intervals of a segment.
   * words: string[]; silences: [{startSec,endSec}] or [{start,end}] or null.
   * Returns [{w, s, e}] back-to-back, last word ends at end of speech.
   */
  function alignWords (words, start, end, silences) {
    var iv = _speechIntervals(start, end, silences, 0.3)
    var total = 0
    var i
    for (i = 0; i < iv.length; i++) total += iv[i].e - iv[i].s
    var wsum = 0
    for (i = 0; i < words.length; i++) wsum += _wordWeight(words[i])
    function toReal (pos) {
      var acc = 0
      for (var k = 0; k < iv.length; k++) {
        var d = iv[k].e - iv[k].s
        if (pos <= acc + d + 1e-9) return iv[k].s + (pos - acc)
        acc += d
      }
      return iv[iv.length - 1].e
    }
    var out = []
    var cum = 0
    for (i = 0; i < words.length; i++) {
      var w = String(words[i])
      var dur = total * _wordWeight(w) / wsum
      out.push({
        w: w,
        s: Math.round(toReal(cum) * 1000) / 1000,
        e: Math.round(toReal(cum + dur) * 1000) / 1000
      })
      cum += dur
    }
    return out
  }

  /* ── Smart line wrapping (hanging glue words, balance) ──────────────── */

  var _GLUE = (function () {
    var g = {}
    var words = [
      'в', 'во', 'на', 'над', 'под', 'по', 'за', 'к', 'ко', 'с', 'со', 'о', 'об', 'от', 'до',
      'из', 'у', 'для', 'без', 'при', 'про', 'через', 'между', 'перед',
      'и', 'а', 'но', 'да', 'или', 'либо', 'что', 'чтобы', 'как', 'когда', 'если', 'чем', 'то',
      'не', 'ни', 'же', 'бы', 'ли', 'уж',
      'a', 'an', 'the', 'in', 'on', 'at', 'of', 'to', 'for', 'and', 'or', 'but', 'is', 'are', 'was', 'with'
    ]
    for (var i = 0; i < words.length; i++) g[words[i]] = 1
    return g
  }())

  function isGlueWord (w) {
    var bare = String(w).toLowerCase().replace(/[.,!?…:;«»"'()\u2014\u2013-]/g, '')
    return _GLUE[bare] === 1
  }

  /* ── Subtitle typography rules (2026-08-04) ───────────────────────────
   * R1  A cue never ends with `.` `,` `;` `:` or a dash — social-style
   *     subtitles drop them; `?` `!` `…` carry meaning and are kept.
   * R2  A cue never starts with `.` `,` `;` `:` (Whisper leaves them behind
   *     when a phrase is split); a leading dialogue dash is kept.
   * R3  A cue never ENDS with a preposition / conjunction / particle — the
   *     word moves to the next cue instead of hanging on screen alone.
   * R4  A LINE never ends with one either (soft rule: honoured whenever a
   *     valid split exists).
   * R5  No break between a number and the word it belongs to ("5 кг").
   * R6  No break after an opening quote/bracket or a dangling dash.
   * R7  Lines stay balanced (shortest/longest spread is penalized).
   * R8  Pyramid: at equal balance, the TOP line is the shorter one.
   * A word that already ends in punctuation is a NATURAL break — it never
   * counts as a bad break even if it is a function word ("что," is fine).
   */
  var _ENDS_PUNCT = /[.,;:!?\u2026]["»')\]]*$/
  var _NUMBER_ONLY = /^[0-9]+([.,][0-9]+)?$/
  var _ENDS_OPEN = /[«"(\[\u2014\u2013]$/

  /* Would breaking a line right AFTER this word read badly? (R4/R5/R6) */
  function isBadBreakWord (w) {
    var s = String(w == null ? '' : w)
    if (!s) return false
    if (_ENDS_PUNCT.test(s)) return false
    if (_NUMBER_ONLY.test(s)) return true
    if (_ENDS_OPEN.test(s)) return true
    return isGlueWord(s)
  }

  /**
   * R1/R2: clean the punctuation at the edges of a cue. Returns a NEW array of
   * the same length (callers keep word timings index-aligned); a word that was
   * punctuation only becomes '' and is dropped by the caller together with its
   * timing.
   */
  function polishCueEdges (words) {
    if (!words || !words.length) return []
    var out = []
    for (var i = 0; i < words.length; i++) out.push(String(words[i]))
    var last = out.length - 1
    out[last] = out[last].replace(/[.,;:\u2014\u2013-]+(?=["\u00bb')\]]*$)/, '')
    out[0] = out[0].replace(/^[.,;:]+/, '')
    return out
  }

  /* Greedy wrap into <= maxLines lines of <= maxChars. null if it can't fit. */
  function _wrapWords (words, maxChars, maxLines) {
    var lines = ['']
    for (var i = 0; i < words.length; i++) {
      var w = words[i]
      var cur = lines[lines.length - 1]
      if (!cur.length) {
        if (w.length > maxChars) return null
        lines[lines.length - 1] = w
      } else if (cur.length + 1 + w.length <= maxChars) {
        lines[lines.length - 1] = cur + ' ' + w
      } else {
        if (lines.length >= maxLines || w.length > maxChars) return null
        lines.push(w)
      }
    }
    return lines.join('\n')
  }

  function _groupLen (words, from, to) {
    var n = 0
    for (var i = from; i <= to; i++) {
      if (i > from) n += 1
      n += words[i].length
    }
    return n
  }

  /* Recursive enumeration of all valid splits of words[start..end] into
   * linesLeft non-empty lines. Each result: array of inclusive line-end
   * indexes. Intermediate lines are length-checked here, the last line by
   * the caller. */
  function _enumBreaks (words, start, end, linesLeft, breaksSoFar, out) {
    if (linesLeft === 1) {
      var copy = []
      for (var ci = 0; ci < breaksSoFar.length; ci++) copy.push(breaksSoFar[ci])
      copy.push(end)
      out.push(copy)
      return
    }
    for (var k = start; k < end; k++) {
      var len = _groupLen(words, start, k)
      if (len > out._maxChars) continue
      breaksSoFar.push(k)
      var remaining = end - k
      if (remaining >= linesLeft - 1) {
        _enumBreaks(words, k + 1, end, linesLeft - 1, breaksSoFar, out)
      }
      breaksSoFar.pop()
    }
  }

  function _scoreSplit (words, breaks) {
    var penalty = 0
    for (var i = 0; i < breaks.length - 1; i++) {
      if (isBadBreakWord(words[breaks[i]])) penalty += 100
    }
    var minLen = -1
    var maxLen = -1
    var firstLen = -1
    var lastLen = -1
    var lineStart = 0
    for (var j = 0; j < breaks.length; j++) {
      var ln = _groupLen(words, lineStart, breaks[j])
      if (minLen < 0 || ln < minLen) minLen = ln
      if (maxLen < 0 || ln > maxLen) maxLen = ln
      if (firstLen < 0) firstLen = ln
      lastLen = ln
      lineStart = breaks[j] + 1
    }
    penalty += (maxLen - minLen)
    // R8 (pyramid): with equal balance, prefer a top line SHORTER than the
    // bottom one — the eye travels down into a widening block, and a wide top
    // line over a short one reads as a stranded remainder. Fractional so it
    // only ever breaks ties: every other term here is an integer.
    if (breaks.length > 1 && firstLen > lastLen) penalty += 0.5
    return penalty
  }

  /**
   * Smart subtitle wrapping: enumerate all valid splits, penalize hanging
   * glue words (+100) and unbalanced lines (+maxLen-minLen), prefer fewer
   * lines and center-most break on ties. Returns '\n'-joined lines.
   */
  function wrapCueLines (words, maxChars, maxLines) {
    var mxC = (maxChars > 0) ? maxChars : 20
    var mxL = (maxLines > 0) ? maxLines : 2
    if (!words || !words.length) return ''
    if (words.length === 1) return words[0]

    var rawOut = []
    rawOut._maxChars = mxC
    for (var nl = 1; nl <= mxL; nl++) {
      if (nl > words.length) break
      _enumBreaks(words, 0, words.length - 1, nl, [], rawOut)
    }

    var candidates = []
    for (var ri = 0; ri < rawOut.length; ri++) {
      var breaks = rawOut[ri]
      var valid = true
      var ls = 0
      for (var bi = 0; bi < breaks.length; bi++) {
        if (_groupLen(words, ls, breaks[bi]) > mxC) { valid = false; break }
        ls = breaks[bi] + 1
      }
      if (valid) candidates.push(breaks)
    }

    if (!candidates.length) {
      var fw = _wrapWords(words, mxC, mxL)
      if (fw !== null) return fw
      var half = Math.ceil(words.length / 2)
      return words.slice(0, half).join(' ') + '\n' + words.slice(half).join(' ')
    }

    var bestBreaks = null
    var bestScore = 0
    for (var ci = 0; ci < candidates.length; ci++) {
      var sc = _scoreSplit(words, candidates[ci])
      var better = false
      if (bestBreaks === null) {
        better = true
      } else if (sc < bestScore) {
        better = true
      } else if (sc === bestScore) {
        if (candidates[ci].length < bestBreaks.length) {
          better = true
        } else if (candidates[ci].length === bestBreaks.length) {
          var center = (words.length - 1) / 2
          if (Math.abs(candidates[ci][0] - center) < Math.abs(bestBreaks[0] - center)) better = true
        }
      }
      if (better) {
        bestBreaks = candidates[ci]
        bestScore = sc
      }
    }

    var lines = []
    var lstart = 0
    for (var li = 0; li < bestBreaks.length; li++) {
      lines.push(words.slice(lstart, bestBreaks[li] + 1).join(' '))
      lstart = bestBreaks[li] + 1
    }
    return lines.join('\n')
  }

  /* ── Segments → display cues ────────────────────────────────────────── */

  /**
   * Whisper segments → subtitle cues sized for on-screen display.
   * Long segments split at word boundaries by maxCharsPerLine*maxLines and
   * maxDurSec; word times come from alignWords (syllable-weighted).
   * opts: {maxCharsPerLine=20, maxLines=2, maxDurSec=4, silences=null}.
   * Returns [{startSec, endSec, text, words:[{w,s,e}]}].
   */
  function buildCues (segments, opts) {
    var o = opts || {}
    var maxChars = o.maxCharsPerLine > 0 ? o.maxCharsPerLine : 20
    var maxLines = o.maxLines > 0 ? o.maxLines : 2
    var maxDur = o.maxDurSec > 0 ? o.maxDurSec : 4
    var cues = []
    if (!segments || !segments.length) return cues
    for (var i = 0; i < segments.length; i++) {
      var sg = segments[i]
      if (!sg) continue
      var text = String(sg.text == null ? '' : sg.text).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '')
      if (!text) continue
      var start = Number(sg.startSec)
      var end = Number(sg.endSec)
      if (!isFinite(start) || !isFinite(end) || end <= start) continue
      var words = text.split(' ')
      var timed = alignWords(words, start, end, o.silences)
      var idx = 0
      while (idx < words.length) {
        var cueStartIdx = idx
        var take = []
        while (idx < words.length) {
          var wrapped = _wrapWords(take.concat([words[idx]]), maxChars, maxLines)
          var candDur = timed[idx].e - timed[cueStartIdx].s
          if (take.length && (wrapped === null || candDur > maxDur + 1e-9)) break
          take.push(words[idx])
          idx++
          if (wrapped === null) break /* one over-long word becomes its own cue */
        }
        // R3: a cue must not end on a preposition/conjunction while more words
        // follow — hand it to the next cue instead of leaving it hanging.
        var backoff = 0
        while (idx < words.length && take.length > 1 && backoff < 2 &&
               isGlueWord(take[take.length - 1]) && !_ENDS_PUNCT.test(take[take.length - 1])) {
          take.pop()
          idx--
          backoff++
        }
        // R1/R2: trim edge punctuation, dropping words that were punctuation
        // only — text and word timings stay in lockstep (karaoke reads both).
        var polished = polishCueEdges(take)
        var cueWords = []
        var cueTimed = []
        for (var pi = 0; pi < polished.length; pi++) {
          if (!polished[pi].length) continue
          var t = timed[cueStartIdx + pi]
          cueWords.push(polished[pi])
          cueTimed.push({ w: polished[pi], s: t.s, e: t.e })
        }
        if (!cueWords.length) continue
        cues.push({
          startSec: Math.round(cueTimed[0].s * 1000) / 1000,
          endSec: Math.round(cueTimed[cueTimed.length - 1].e * 1000) / 1000,
          text: wrapCueLines(cueWords, maxChars, maxLines),
          words: cueTimed
        })
      }
    }
    return cues
  }

  /* ── Karaoke (CapCut-style) word tracks ─────────────────────────────── */

  /**
   * Cues (with word timings) → hold-keyframe tracks that drive the karaoke
   * rig in AE: one key per spoken word, plus a "nothing spoken" key in gaps.
   *   [{ t, index, prefix, word }]
   * index  — 1-based word ordinal INSIDE the current cue (0 = no word active);
   *          drives the "Word Index" slider that the highlight text animator
   *          and the plate visibility read.
   * prefix — cue text from the first word up to AND INCLUDING the current one.
   * word   — the current word alone.
   * The two strings are keyframed onto hidden measure text layers: the plate's
   * x is (line left + width(prefix) - width(word)/2), which is the only way to
   * get a per-word rect out of AE (sourceRectAtTime is whole-block only).
   * Karaoke cues are single-line by construction, so the plate's y is the
   * block's own center.
   * gapEpsSec matches the Source Text gap epsilon in the host rig (0.08).
   */
  function buildKaraokeTracks (cues, gapEpsSec) {
    var eps = gapEpsSec > 0 ? gapEpsSec : 0.08
    var out = []
    if (!cues || !cues.length) return out
    function push (t, index, prefix, word) {
      var last = out[out.length - 1]
      var tt = Math.round(t * 1000) / 1000
      // setValueAtTime on a duplicate time overwrites the previous key —
      // nudge instead so every word keeps its own key.
      if (last && tt <= last.t) tt = Math.round((last.t + 0.001) * 1000) / 1000
      out.push({ t: tt, index: index, prefix: prefix, word: word })
    }
    for (var i = 0; i < cues.length; i++) {
      var cue = cues[i]
      var words = cue && cue.words
      if (!words || !words.length) continue
      var prefix = ''
      for (var j = 0; j < words.length; j++) {
        var w = String(words[j].w == null ? '' : words[j].w)
        prefix = prefix ? (prefix + ' ' + w) : w
        push(Math.max(Number(cue.startSec), Number(words[j].s)), j + 1, prefix, w)
      }
      var nextStart = (i + 1 < cues.length) ? Number(cues[i + 1].startSec) : null
      // Back-to-back cues: the next cue's first word key clears this one.
      if (nextStart === null || nextStart - Number(cue.endSec) > eps) {
        push(Number(cue.endSec), 0, '', '')
      }
    }
    return out
  }

  /* ── Editing built cues without breaking timing ─────────────────────── */

  /**
   * Apply TEXT edits to cues read back from an existing AE subtitle rig,
   * preserving all cue timing (transcription word fixes must never re-time
   * the animation). cues: [{startSec, endSec, text, words?:[{w,s,e}]}].
   * edits, each either:
   *   {find, replace}    — case-insensitive substring match on the cue's
   *                        space-joined text, all occurrences, all cues;
   *   {cue_index, text}  — replace the whole text of one cue (1-based).
   * opts: {maxCharsPerLine, maxLines} — re-wrap params (derived by the
   * caller from the rig's existing look).
   * Word re-timing inside a changed cue: same word count → per-word times
   * kept verbatim; different count → the cue's own span is redistributed by
   * _wordWeight. Unchanged cues pass through untouched.
   * Returns {cues, changedIndexes (1-based), notFound: [find strings],
   * warnings: [strings]}.
   */
  function applySubtitleEdits (cues, edits, opts) {
    var o = opts || {}
    var maxChars = o.maxCharsPerLine > 0 ? o.maxCharsPerLine : 20
    var maxLines = o.maxLines > 0 ? o.maxLines : 2
    var out = []
    var i, j
    for (i = 0; i < (cues ? cues.length : 0); i++) {
      var c = cues[i]
      var wcopy = null
      if (c.words && c.words.length) {
        wcopy = []
        for (j = 0; j < c.words.length; j++) {
          wcopy.push({ w: String(c.words[j].w), s: Number(c.words[j].s), e: Number(c.words[j].e) })
        }
      }
      out.push({
        startSec: Number(c.startSec),
        endSec: Number(c.endSec),
        text: String(c.text == null ? '' : c.text),
        words: wcopy
      })
    }
    var changed = {}
    var notFound = []
    var warnings = []
    function escRe (s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
    function flatText (cue) { return cue.text.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '') }
    for (j = 0; j < (edits ? edits.length : 0); j++) {
      var ed = edits[j]
      if (!ed) continue
      if (typeof ed.cue_index === 'number' && typeof ed.text === 'string') {
        var idx = Math.round(ed.cue_index) - 1
        if (idx < 0 || idx >= out.length) {
          warnings.push('cue_index ' + ed.cue_index + ' is out of range (1..' + out.length + ')')
          continue
        }
        var nt = ed.text.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '')
        if (!nt) { warnings.push('cue_index ' + ed.cue_index + ': empty replacement text ignored'); continue }
        if (nt !== flatText(out[idx])) { out[idx].text = nt; changed[idx] = 1 }
      } else if (typeof ed.find === 'string' && ed.find.replace(/\s+/g, '') !== '' && typeof ed.replace === 'string') {
        var findNorm = ed.find.replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '')
        var re = new RegExp(escRe(findNorm).replace(/ /g, '\\s+'), 'gi')
        var hit = false
        for (i = 0; i < out.length; i++) {
          var flat = flatText(out[i])
          var next = flat.replace(re, ed.replace).replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '')
          re.lastIndex = 0
          if (next === flat) continue
          hit = true
          if (!next) { warnings.push('replacing "' + findNorm + '" would empty cue ' + (i + 1) + ' — skipped'); continue }
          out[i].text = next
          changed[i] = 1
        }
        if (!hit) notFound.push(findNorm)
      } else {
        warnings.push('edit #' + (j + 1) + ' ignored: pass {find, replace} or {cue_index, text}')
      }
    }
    var changedIndexes = []
    for (i = 0; i < out.length; i++) {
      if (!changed[i]) continue
      changedIndexes.push(i + 1)
      var cue = out[i]
      var parts = flatText(cue).split(' ')
      var ws = []
      for (j = 0; j < parts.length; j++) if (parts[j] !== '') ws.push(parts[j])
      var oldWords = cue.words
      var newWords = []
      if (oldWords && oldWords.length === ws.length) {
        for (j = 0; j < ws.length; j++) newWords.push({ w: ws[j], s: oldWords[j].s, e: oldWords[j].e })
      } else {
        var wsum = 0
        for (j = 0; j < ws.length; j++) wsum += _wordWeight(ws[j])
        var span = cue.endSec - cue.startSec
        var cum = cue.startSec
        for (j = 0; j < ws.length; j++) {
          var dur = span * _wordWeight(ws[j]) / wsum
          newWords.push({
            w: ws[j],
            s: Math.round(cum * 1000) / 1000,
            e: Math.round((cum + dur) * 1000) / 1000
          })
          cum += dur
        }
        newWords[newWords.length - 1].e = Math.round(cue.endSec * 1000) / 1000
      }
      cue.words = newWords
      // maxLines 1 (karaoke rigs): never introduce a line break — wrapCueLines'
      // no-fit fallback force-splits regardless of maxLines, which would break
      // the single-line plate/measure rig. Overflow is warned about below.
      cue.text = maxLines === 1 ? ws.join(' ') : wrapCueLines(ws, maxChars, maxLines)
      var lines = cue.text.split('\n')
      for (j = 0; j < lines.length; j++) {
        if (lines[j].length > maxChars) {
          warnings.push('cue ' + (i + 1) + ': line "' + lines[j] + '" is longer than the rig\'s ' +
            maxChars + '-char line width — it may overflow (font size is kept as-is)')
        }
      }
    }
    return { cues: out, changedIndexes: changedIndexes, notFound: notFound, warnings: warnings }
  }

  /* ── ffmpeg silencedetect stderr → silence intervals ────────────────── */

  /**
   * Parse `-af silencedetect` output (ffmpeg writes it to stderr).
   * Lines: "silence_start: 12.345" / "silence_end: 13.21 | silence_duration: 0.865".
   * A trailing silence_start without silence_end (silence runs to EOF) is
   * closed using the "Duration: HH:MM:SS.xx" header line, like the
   * Premiere-plugin implementation. offsetSec shifts file times to comp times
   * (audio rendered from a comp span). Returns [{startSec, endSec}].
   */
  function parseSilencedetect (stderr, offsetSec) {
    var off = isFinite(Number(offsetSec)) ? Number(offsetSec) : 0
    var text = String(stderr == null ? '' : stderr)
    var starts = []
    var ends = []
    var m
    var startRe = /silence_start:\s*(-?[\d.]+)/g
    var endRe = /silence_end:\s*([\d.]+)/g
    while ((m = startRe.exec(text)) !== null) starts.push(parseFloat(m[1]))
    while ((m = endRe.exec(text)) !== null) ends.push(parseFloat(m[1]))
    var out = []
    var n = Math.min(starts.length, ends.length)
    for (var i = 0; i < n; i++) {
      var s = Math.max(0, starts[i])
      if (!isFinite(s) || !isFinite(ends[i]) || ends[i] <= s) continue
      out.push({
        startSec: Math.round((s + off) * 1000) / 1000,
        endSec: Math.round((ends[i] + off) * 1000) / 1000
      })
    }
    if (starts.length > ends.length) {
      var durM = text.match(/Duration:\s*(\d+):(\d+):([\d.]+)/)
      if (durM) {
        var fileDur = parseInt(durM[1], 10) * 3600 + parseInt(durM[2], 10) * 60 + parseFloat(durM[3])
        var lastStart = Math.max(0, starts[starts.length - 1])
        if (isFinite(fileDur) && fileDur > lastStart) {
          out.push({
            startSec: Math.round((lastStart + off) * 1000) / 1000,
            endSec: Math.round((fileDur + off) * 1000) / 1000
          })
        }
      }
    }
    // Merge silences separated by a voiced blip too short to be a word
    // (breath, click — live-measured 0.12s between the two leading silences):
    // without merging, word alignment anchors the first word on the blip and
    // the cue still fires before actual speech.
    var MERGE_GAP_SEC = 0.35
    var merged = []
    for (var j = 0; j < out.length; j++) {
      var prev = merged[merged.length - 1]
      if (prev && out[j].startSec - prev.endSec < MERGE_GAP_SEC) prev.endSec = out[j].endSec
      else merged.push({ startSec: out[j].startSec, endSec: out[j].endSec })
    }
    return merged
  }

  return {
    normalizeWhisperSegments: normalizeWhisperSegments,
    alignWords: alignWords,
    applySubtitleEdits: applySubtitleEdits,
    _wordWeight: _wordWeight,
    wrapCueLines: wrapCueLines,
    isGlueWord: isGlueWord,
    isBadBreakWord: isBadBreakWord,
    polishCueEdges: polishCueEdges,
    buildCues: buildCues,
    buildKaraokeTracks: buildKaraokeTracks,
    parseSilencedetect: parseSilencedetect,
    _speechIntervals: _speechIntervals
  }
})
