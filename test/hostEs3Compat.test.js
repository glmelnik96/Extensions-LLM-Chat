'use strict'
// Regression guard for the ExtendScript-compatibility bug class documented in
// the cross-plugin fix report (2026-06-18): ExtendScript (the JSX engine in AE)
// has NO native `JSON` object and NO `String.prototype.trim()`, plus none of the
// ES5/ES6 niceties (arrow functions, let/const, Array iteration helpers, template
// literals, etc.). Using any of them in host/index.jsx fails at load/parse time
// — bugs that node unit tests of the panel JS can never surface because that
// code runs in CEF (a full browser), not ExtendScript.
//
// This test scans host/index.jsx with comments and string literals removed, then
// asserts none of the forbidden constructs appear in actual code.
const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const HOST_PATH = path.join(__dirname, '..', 'host', 'index.jsx')

// Replace every comment and string literal with same-length whitespace (newlines
// preserved) so line/column references in matches stay accurate and so tokens
// that legitimately appear inside comments or message strings (e.g. the word
// "JSON" in a doc comment) never trip the lint.
function stripCommentsAndStrings (src) {
  let out = ''
  let i = 0
  const n = src.length
  let state = 'code' // code | line | block | sq | dq
  while (i < n) {
    const c = src[i]
    const c2 = i + 1 < n ? src[i + 1] : ''
    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line'; out += '  '; i += 2; continue }
      if (c === '/' && c2 === '*') { state = 'block'; out += '  '; i += 2; continue }
      if (c === "'") { state = 'sq'; out += ' '; i++; continue }
      if (c === '"') { state = 'dq'; out += ' '; i++; continue }
      out += c; i++; continue
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n'; i++; continue }
      out += c === '\t' ? '\t' : ' '; i++; continue
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') { state = 'code'; out += '  '; i += 2; continue }
      out += c === '\n' ? '\n' : (c === '\t' ? '\t' : ' '); i++; continue
    }
    // string states — honor backslash escapes
    if (c === '\\') { out += '  '; i += 2; continue }
    if (state === 'sq' && c === "'") { state = 'code'; out += ' '; i++; continue }
    if (state === 'dq' && c === '"') { state = 'code'; out += ' '; i++; continue }
    out += c === '\n' ? '\n' : (c === '\t' ? '\t' : ' '); i++; continue
  }
  return out
}

function findViolations (code, regex) {
  const lines = code.split('\n')
  const hits = []
  for (let li = 0; li < lines.length; li++) {
    const re = new RegExp(regex.source, regex.flags.replace('g', '') + 'g')
    let m
    while ((m = re.exec(lines[li])) !== null) {
      hits.push('line ' + (li + 1) + ': ' + m[0])
      if (m.index === re.lastIndex) re.lastIndex++
    }
  }
  return hits
}

const raw = fs.readFileSync(HOST_PATH, 'utf8')
const code = stripCommentsAndStrings(raw)

// Each entry: [human reason, regex]. ExtendScript = ES3-ish, none of these exist.
const FORBIDDEN = [
  ['native JSON object (use the hand-built resultToJson serializer instead)', /\bJSON\s*\./],
  ['String.prototype.trim() (use .replace(/^\\s+|\\s+$/g, "") )', /\.trim\s*\(/],
  ['ES5 Array iteration method (write an indexed for-loop)', /\.(forEach|map|filter|reduce|reduceRight|some|every|find|findIndex)\b\s*\(/],
  ['ES6 String method (absent in ExtendScript)', /\.(includes|startsWith|endsWith|padStart|padEnd|repeat)\b\s*\(/],
  ['ES5 static helper (Object.keys/assign, Array.isArray, Date.now, ...)', /\b(Object\.(keys|assign|values|entries)|Array\.(isArray|from|of)|Date\.now|String\.fromCodePoint|Number\.(isInteger|isFinite|parseFloat|parseInt))\b/],
  ['arrow function (use function expression)', /=>/],
  ['let/const declaration (use var)', /\b(let|const)\s+[A-Za-z_$]/],
  ['template literal backtick (use string concatenation)', /`/]
]

for (const [reason, regex] of FORBIDDEN) {
  test('host/index.jsx is ExtendScript-safe: no ' + reason, () => {
    const hits = findViolations(code, regex)
    assert.strictEqual(
      hits.length, 0,
      'Found ExtendScript-incompatible construct in host/index.jsx (' + reason + '):\n  ' + hits.join('\n  ')
    )
  })
}

test('comment/string stripper sanity: keeps code tokens, drops string contents', () => {
  const sample = 'var a = JSON; /* JSON */ var s = "JSON"; b.trim()'
  const stripped = stripCommentsAndStrings(sample)
  // The real `JSON` and `.trim(` in code survive; the ones in comment/string do not.
  assert.ok(/\bJSON\b/.test(stripped.slice(0, 12)), 'code-level JSON token preserved')
  assert.ok(/\.trim\s*\(/.test(stripped), 'code-level .trim( preserved')
  // Exactly one JSON should remain (the var assignment), not the comment/string ones.
  assert.strictEqual((stripped.match(/JSON/g) || []).length, 1)
})
