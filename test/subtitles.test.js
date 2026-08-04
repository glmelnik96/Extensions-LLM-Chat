/**
 * Tests for lib/pure/subtitles.js — Whisper segment normalization,
 * char-weighted word alignment (with silence subtraction), smart line
 * wrapping (glue words, balance), and segment→cue building (splitting by
 * length/duration). Ported logic from the Premiere sibling plugin.
 */
const test = require('node:test')
const assert = require('node:assert')

const SUB = require('../lib/pure/subtitles.js')

test('subtitles: normalizeWhisperSegments handles verbose_json and offset', () => {
  const raw = {
    language: 'russian',
    segments: [
      { start: 0, end: 2.5, text: '  Привет   мир ' },
      { start: 2.5, end: 2.5, text: 'zero duration skipped' },
      { start: 3, end: 5, text: '' },
      { start: 5, end: 7.25, text: 'вторая фраза' }
    ]
  }
  const out = SUB.normalizeWhisperSegments(raw, 10)
  assert.deepStrictEqual(out, [
    { startSec: 10, endSec: 12.5, text: 'Привет мир' },
    { startSec: 15, endSec: 17.25, text: 'вторая фраза' }
  ])
  // idempotent: already-normalized array passes through
  const again = SUB.normalizeWhisperSegments(out, 0)
  assert.deepStrictEqual(again, out)
  assert.deepStrictEqual(SUB.normalizeWhisperSegments(null, 0), [])
  assert.deepStrictEqual(SUB.normalizeWhisperSegments({}, 0), [])
})

test('subtitles: alignWordsChar distributes by char weight, back-to-back', () => {
  const words = ['я', 'коротко', 'сверхдлинное']
  const timed = SUB.alignWordsChar(words, 0, 10, null)
  assert.strictEqual(timed.length, 3)
  assert.strictEqual(timed[0].s, 0)
  assert.strictEqual(timed[2].e, 10)
  // durations proportional to 1/7/12 of 20 chars over 10s
  assert.ok(Math.abs((timed[0].e - timed[0].s) - 0.5) < 0.01)
  assert.ok(Math.abs((timed[1].e - timed[1].s) - 3.5) < 0.01)
  assert.ok(Math.abs((timed[2].e - timed[2].s) - 6.0) < 0.01)
  // contiguous
  assert.strictEqual(timed[0].e, timed[1].s)
  assert.strictEqual(timed[1].e, timed[2].s)
})

test('subtitles: alignWordsChar skips silences >= 0.3s', () => {
  // segment 0-10, silence 4-8 => speech 0-4 and 8-10 (6s total)
  const words = ['aa', 'bb', 'cc'] // equal weights: 2s each on speech axis
  const timed = SUB.alignWordsChar(words, 0, 10, [{ startSec: 4, endSec: 8 }])
  assert.strictEqual(timed[0].s, 0)
  assert.strictEqual(timed[0].e, 2)
  assert.strictEqual(timed[1].e, 4)
  // third word spans the gap: boundary position maps to the end of the
  // previous speech interval (4), end lands after the silence (10) —
  // identical to the Premiere-plugin implementation
  assert.strictEqual(timed[2].s, 4)
  assert.strictEqual(timed[2].e, 10)
  // short silence (<0.3s) ignored
  const t2 = SUB.alignWordsChar(words, 0, 6, [{ startSec: 2, endSec: 2.2 }])
  assert.strictEqual(t2[2].e, 6)
  assert.strictEqual(t2[1].e, 4)
})

test('subtitles: wrapCueLines avoids hanging glue words', () => {
  // Greedy would produce "мы идём в\nкино"; smart wrap must not end line 1 with "в"
  const wrapped = SUB.wrapCueLines(['мы', 'идём', 'в', 'кино'], 10, 2)
  const lines = wrapped.split('\n')
  assert.strictEqual(lines.length, 2)
  assert.notStrictEqual(lines[0].split(' ').pop(), 'в')
  assert.strictEqual(wrapped.replace('\n', ' '), 'мы идём в кино')
})

test('subtitles: wrapCueLines balances lines and respects maxChars', () => {
  const wrapped = SUB.wrapCueLines(['первое', 'слово', 'второе', 'слово'], 14, 2)
  const lines = wrapped.split('\n')
  assert.strictEqual(lines.length, 2)
  for (const ln of lines) assert.ok(ln.length <= 14, ln)
  // single word: as-is; empty: ''
  assert.strictEqual(SUB.wrapCueLines(['одно'], 20, 2), 'одно')
  assert.strictEqual(SUB.wrapCueLines([], 20, 2), '')
})

test('subtitles: isGlueWord matches RU and EN function words', () => {
  assert.ok(SUB.isGlueWord('в'))
  assert.ok(SUB.isGlueWord('И')) // case-insensitive
  assert.ok(SUB.isGlueWord('the'))
  assert.ok(!SUB.isGlueWord('кино'))
})

test('subtitles: buildCues splits long segments by chars and duration', () => {
  // 10 words, 2s each => 20s segment; maxDurSec 4 forces splits
  const words = []
  for (let i = 0; i < 10; i++) words.push('слово' + i)
  const segments = [{ startSec: 0, endSec: 20, text: words.join(' ') }]
  const cues = SUB.buildCues(segments, { maxCharsPerLine: 20, maxLines: 2, maxDurSec: 4 })
  assert.ok(cues.length >= 5, 'expected >=5 cues, got ' + cues.length)
  // cues tile the segment: first starts at 0, last ends at 20, no overlaps
  assert.strictEqual(cues[0].startSec, 0)
  assert.strictEqual(cues[cues.length - 1].endSec, 20)
  for (let i = 1; i < cues.length; i++) {
    assert.ok(cues[i].startSec >= cues[i - 1].endSec - 0.001)
  }
  for (const c of cues) {
    assert.ok(c.endSec - c.startSec <= 4.001, 'cue too long: ' + (c.endSec - c.startSec))
    for (const ln of c.text.split('\n')) assert.ok(ln.length <= 20)
    assert.ok(Array.isArray(c.words) && c.words.length > 0)
  }
})

test('subtitles: buildCues keeps short segments whole and skips empties', () => {
  const cues = SUB.buildCues([
    { startSec: 1, endSec: 3, text: 'короткая фраза' },
    { startSec: 3, endSec: 4, text: '   ' },
    null
  ], {})
  assert.strictEqual(cues.length, 1)
  assert.strictEqual(cues[0].startSec, 1)
  assert.strictEqual(cues[0].endSec, 3)
  assert.strictEqual(cues[0].text.replace('\n', ' '), 'короткая фраза')
  assert.strictEqual(cues[0].words.length, 2)
  assert.deepStrictEqual(SUB.buildCues([], {}), [])
  assert.deepStrictEqual(SUB.buildCues(null, {}), [])
})

test('subtitles: buildCues puts an over-long word into its own cue', () => {
  const long = 'сверхдлинноеслово-непереносимое'
  const cues = SUB.buildCues([
    { startSec: 0, endSec: 6, text: 'до ' + long + ' после' }
  ], { maxCharsPerLine: 10, maxLines: 2, maxDurSec: 10 })
  const hit = cues.filter(c => c.text === long)
  assert.strictEqual(hit.length, 1)
  assert.strictEqual(hit[0].words.length, 1)
})

test('subtitles: parseSilencedetect parses ffmpeg stderr with offset and half-open tail', () => {
  const stderr = [
    '  Duration: 00:00:31.20, start: 0.000000, bitrate: 1536 kb/s',
    '[silencedetect @ 0x1] silence_start: 0',
    '[silencedetect @ 0x1] silence_end: 0.565417 | silence_duration: 0.565417',
    '[silencedetect @ 0x1] silence_start: 5.167979',
    '[silencedetect @ 0x1] silence_end: 5.806917 | silence_duration: 0.638937',
    '[silencedetect @ 0x1] silence_start: 30.558062'
  ].join('\n')
  const out = SUB.parseSilencedetect(stderr, 0)
  assert.strictEqual(out.length, 3)
  assert.deepStrictEqual(out[0], { startSec: 0, endSec: 0.565 })
  assert.deepStrictEqual(out[1], { startSec: 5.168, endSec: 5.807 })
  // half-open silence closed at file Duration (31.2s)
  assert.deepStrictEqual(out[2], { startSec: 30.558, endSec: 31.2 })
  // offset shifts to comp time (audio rendered from a span)
  const off = SUB.parseSilencedetect(stderr, 10)
  assert.strictEqual(off[0].startSec, 10)
  assert.strictEqual(off[1].startSec, 15.168)
  // garbage in — empty out
  assert.deepStrictEqual(SUB.parseSilencedetect('', 0), [])
  assert.deepStrictEqual(SUB.parseSilencedetect(null, 0), [])
})

test('subtitles: buildCues with silences snaps first cue to speech onset', () => {
  // Whisper says 0-5s, but real speech starts at 1.2s (leading silence).
  const cues = SUB.buildCues(
    [{ startSec: 0, endSec: 5, text: 'привет мир и всем добра' }],
    { silences: [{ startSec: 0, endSec: 1.2 }] }
  )
  assert.ok(cues.length >= 1)
  // first word must not start inside the leading silence
  assert.strictEqual(cues[0].startSec, 1.2)
  assert.strictEqual(cues[cues.length - 1].endSec, 5)
})

test('subtitles: parseSilencedetect merges silences split by a sub-word voiced blip', () => {
  // Real BRAW capture: silences 0-0.565 and 0.685-1.204 separated by a 0.12s
  // breath — must merge so the first cue snaps to 1.204 (speech onset).
  const stderr = [
    '[silencedetect @ 0x1] silence_start: 0',
    '[silencedetect @ 0x1] silence_end: 0.565417 | silence_duration: 0.565417',
    '[silencedetect @ 0x1] silence_start: 0.684812',
    '[silencedetect @ 0x1] silence_end: 1.203958 | silence_duration: 0.519146',
    '[silencedetect @ 0x1] silence_start: 8.217104',
    '[silencedetect @ 0x1] silence_end: 9.267167 | silence_duration: 1.050062'
  ].join('\n')
  const out = SUB.parseSilencedetect(stderr, 0)
  assert.strictEqual(out.length, 2)
  assert.deepStrictEqual(out[0], { startSec: 0, endSec: 1.204 })
  assert.deepStrictEqual(out[1], { startSec: 8.217, endSec: 9.267 })
  // and buildCues with the merged silences snaps to real speech onset
  const cues = SUB.buildCues(
    [{ startSec: 0, endSec: 5, text: 'привет мир и всем добра' }],
    { silences: out }
  )
  assert.strictEqual(cues[0].startSec, 1.204)
})

test('subtitles: leading sub-word sliver before a pause is treated as previous-phrase tail', () => {
  // Live BRAW case: segment opens at 8.0, silence 8.217-9.267, phrase really
  // starts at 9.267. The 0.217s sliver is the previous phrase's tail.
  const cues = SUB.buildCues(
    [{ startSec: 8, endSec: 12, text: 'новая фраза после паузы' }],
    { silences: [{ startSec: 8.217, endSec: 9.267 }] }
  )
  assert.strictEqual(cues[0].startSec, 9.267)
  // a long voiced lead (>= 0.4s) is genuine first-word speech — kept
  const kept = SUB.buildCues(
    [{ startSec: 8, endSec: 12, text: 'новая фраза после паузы' }],
    { silences: [{ startSec: 8.6, endSec: 9.267 }] }
  )
  assert.strictEqual(kept[0].startSec, 8)
})

test('subtitles: buildKaraokeTracks emits one key per word + a clear key in gaps', () => {
  const cues = [
    { startSec: 0, endSec: 2, text: 'привет мир', words: [{ w: 'привет', s: 0, e: 1 }, { w: 'мир', s: 1, e: 2 }] },
    { startSec: 5, endSec: 6, text: 'снова', words: [{ w: 'снова', s: 5, e: 6 }] }
  ]
  const tr = SUB.buildKaraokeTracks(cues)
  assert.deepStrictEqual(tr, [
    { t: 0, index: 1, prefix: 'привет', word: 'привет' },
    { t: 1, index: 2, prefix: 'привет мир', word: 'мир' },
    { t: 2, index: 0, prefix: '', word: '' },
    { t: 5, index: 1, prefix: 'снова', word: 'снова' },
    { t: 6, index: 0, prefix: '', word: '' }
  ])
})

test('subtitles: buildKaraokeTracks skips the clear key between back-to-back cues', () => {
  const cues = [
    { startSec: 0, endSec: 2, text: 'раз', words: [{ w: 'раз', s: 0, e: 2 }] },
    { startSec: 2.05, endSec: 3, text: 'два', words: [{ w: 'два', s: 2.05, e: 3 }] }
  ]
  const tr = SUB.buildKaraokeTracks(cues)
  assert.deepStrictEqual(tr.map((k) => [k.t, k.index]), [[0, 1], [2.05, 1], [3, 0]])
})

test('subtitles: buildKaraokeTracks nudges duplicate key times', () => {
  // Two words rounding to the same millisecond would otherwise overwrite each
  // other via setValueAtTime.
  const cues = [{
    startSec: 1,
    endSec: 1.4,
    text: 'а б',
    words: [{ w: 'а', s: 1.0001, e: 1.2 }, { w: 'б', s: 1.0002, e: 1.4 }]
  }]
  const tr = SUB.buildKaraokeTracks(cues)
  assert.deepStrictEqual(tr.map((k) => k.t), [1, 1.001, 1.4])
})

/* ── Typography rules (2026-08-04) ──────────────────────────────────── */

test('subtitles: polishCueEdges drops a terminal period and leading comma', () => {
  assert.deepStrictEqual(SUB.polishCueEdges(['Привет', 'мир.']), ['Привет', 'мир'])
  assert.deepStrictEqual(SUB.polishCueEdges([',', 'и', 'дальше,']), ['', 'и', 'дальше'])
  // meaning-carrying punctuation survives, and so does a closing quote
  assert.deepStrictEqual(SUB.polishCueEdges(['Что?']), ['Что?'])
  assert.deepStrictEqual(SUB.polishCueEdges(['Ну…']), ['Ну…'])
  assert.deepStrictEqual(SUB.polishCueEdges(['«конец».']), ['«конец»'])
})

test('subtitles: isBadBreakWord flags glue/number/opener, not natural pauses', () => {
  assert.ok(SUB.isBadBreakWord('в'))
  assert.ok(SUB.isBadBreakWord('5'))
  assert.ok(SUB.isBadBreakWord('«'))
  assert.ok(SUB.isBadBreakWord('—'))
  // already punctuated => a natural break even for a function word
  assert.ok(!SUB.isBadBreakWord('что,'))
  assert.ok(!SUB.isBadBreakWord('кино'))
})

test('subtitles: buildCues applies R1/R3 (no trailing dot, no hanging preposition)', () => {
  const cues = SUB.buildCues([
    { startSec: 0, endSec: 8, text: 'мы пришли в большой красивый дом.' }
  ], { maxCharsPerLine: 12, maxLines: 1, maxDurSec: 10 })
  assert.ok(cues.length >= 2)
  for (const c of cues) {
    assert.ok(!/\.$/.test(c.text), 'cue ends with a period: ' + c.text)
    // no cue but the last may end on a preposition
    if (c !== cues[cues.length - 1]) {
      const lastWord = c.text.split(/\s+/).pop()
      assert.ok(!SUB.isGlueWord(lastWord), 'cue ends on a glue word: ' + c.text)
    }
    // text and word timings stay in lockstep (karaoke depends on it)
    assert.strictEqual(c.text.replace(/\n/g, ' '), c.words.map((w) => w.w).join(' '))
  }
})

test('subtitles: buildCues never breaks a number from its unit', () => {
  const wrapped = SUB.wrapCueLines(['стоит', '5', 'кг', 'ровно'], 11, 2)
  assert.notStrictEqual(wrapped.split('\n')[0].split(' ').pop(), '5')
})

test('subtitles: R8 pyramid — the top line is the shorter one on a tie', () => {
  // "аб вгд еёж" → "аб вгд"/"еёж" (6/3) vs "аб"/"вгд еёж" (2/7): the second
  // is better balanced, so R8 must not override R7 here.
  const balanced = SUB.wrapCueLines(['аба', 'вгд', 'еёж'], 8, 2).split('\n')
  assert.strictEqual(balanced.length, 2)
  // Equal-balance case: both splits spread 4 chars, R8 picks the short top.
  const tie = SUB.wrapCueLines(['аб', 'вг', 'де', 'жз'], 6, 2).split('\n')
  assert.strictEqual(tie.length, 2)
  assert.ok(tie[0].length <= tie[1].length, 'top line longer than bottom: ' + tie.join(' | '))
})
