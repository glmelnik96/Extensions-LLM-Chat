/**
 * Subtitle cue building (pure, no DOM, no Node deps).
 * Browser global window.PURE_SUBTITLES + Node module for tests.
 *
 * Ported from the Premiere Pro sibling plugin (Extensions-LLM-Chat_Pr,
 * client/shared/reels-pipeline.js) where the pipeline is battle-tested on
 * hour-long podcasts. Cloud.ru Whisper (openai/whisper-large-v3) does NOT
 * return word-level timestamps (verified live twice: timestamp_granularities
 * probe -> 200 OK, words empty), so word timing is deterministic:
 * char-weighted distribution across the segment, optionally skipping
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

  /**
   * Char-weighted word timing across speech intervals of a segment.
   * words: string[]; silences: [{startSec,endSec}] or [{start,end}] or null.
   * Returns [{w, s, e}] back-to-back, last word ends at end of speech.
   */
  function alignWordsChar (words, start, end, silences) {
    var iv = _speechIntervals(start, end, silences, 0.3)
    var total = 0
    var i
    for (i = 0; i < iv.length; i++) total += iv[i].e - iv[i].s
    var chars = 0
    for (i = 0; i < words.length; i++) chars += Math.max(1, String(words[i]).length)
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
      var dur = total * Math.max(1, w.length) / chars
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
      if (isGlueWord(words[breaks[i]])) penalty += 100
    }
    var minLen = -1
    var maxLen = -1
    var lineStart = 0
    for (var j = 0; j < breaks.length; j++) {
      var ln = _groupLen(words, lineStart, breaks[j])
      if (minLen < 0 || ln < minLen) minLen = ln
      if (maxLen < 0 || ln > maxLen) maxLen = ln
      lineStart = breaks[j] + 1
    }
    penalty += (maxLen - minLen)
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
   * maxDurSec; word times come from alignWordsChar (char-weighted).
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
      var timed = alignWordsChar(words, start, end, o.silences)
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
        cues.push({
          startSec: Math.round(timed[cueStartIdx].s * 1000) / 1000,
          endSec: Math.round(timed[idx - 1].e * 1000) / 1000,
          text: wrapCueLines(take, maxChars, maxLines),
          words: timed.slice(cueStartIdx, idx)
        })
      }
    }
    return cues
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
    alignWordsChar: alignWordsChar,
    wrapCueLines: wrapCueLines,
    isGlueWord: isGlueWord,
    buildCues: buildCues,
    parseSilencedetect: parseSilencedetect,
    _speechIntervals: _speechIntervals
  }
})
