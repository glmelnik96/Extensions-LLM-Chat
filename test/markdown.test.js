'use strict'
const { test } = require('node:test')
const assert = require('node:assert')
const { renderMarkdown } = require('../lib/pure/markdown.js')

test('empty / falsy input', () => {
  assert.strictEqual(renderMarkdown(''), '')
  assert.strictEqual(renderMarkdown(null), '')
  assert.strictEqual(renderMarkdown(undefined), '')
})

test('basic formatting', () => {
  assert.match(renderMarkdown('**bold**'), /<strong>bold<\/strong>/)
  assert.match(renderMarkdown('*it*'), /<em>it<\/em>/)
  assert.match(renderMarkdown('`x`'), /<code class="md-inline-code">x<\/code>/)
  assert.match(renderMarkdown('# Title'), /<strong class="md-h1">Title<\/strong>/)
  assert.match(renderMarkdown('- one\n- two'), /<ul><li>one<\/li>.*<li>two<\/li><\/ul>/)
})

test('angle brackets and ampersands are escaped (no raw HTML)', () => {
  const out = renderMarkdown('<script>alert(1)</script>')
  assert.ok(!/<script>/.test(out), 'raw <script> must not survive')
  assert.match(out, /&lt;script&gt;/)
})

test('svg onload payload is inert', () => {
  const out = renderMarkdown('<svg onload=alert(1)>')
  assert.ok(!/<svg/.test(out), 'raw <svg> must not survive')
  assert.match(out, /&lt;svg/)
})

test('#1 XSS: quote in img alt cannot break out of the attribute', () => {
  const out = renderMarkdown('![x" onerror="alert(1)](https://example.com/a.png)')
  // The injected onerror must not appear as a live attribute.
  assert.ok(!/onerror=/.test(out.replace(/&quot;/g, '')) || /alt="x&quot; onerror=&quot;alert\(1\)"/.test(out),
    'alt quotes must be escaped so onerror cannot escape the attribute')
  assert.match(out, /alt="x&quot; onerror=&quot;alert\(1\)"/)
})

test('#1 XSS: javascript: img src is dropped (renders alt text only)', () => {
  const out = renderMarkdown('![pic](javascript:alert(1))')
  assert.ok(!/<img/.test(out), 'unsafe-scheme image must not produce an <img>')
  assert.match(out, /pic/)
})

test('#1 XSS: unknown scheme src dropped', () => {
  const out = renderMarkdown('![p](evil://x)')
  assert.ok(!/<img/.test(out))
})

test('safe image schemes are allowed', () => {
  assert.match(renderMarkdown('![a](https://x/a.png)'), /<img[^>]+src="https:\/\/x\/a\.png"/)
  assert.match(renderMarkdown('![a](file:///tmp/a.png)'), /<img[^>]+src="file:\/\/\/tmp\/a\.png"/)
  assert.match(renderMarkdown('![a](data:image/png;base64,AAAA)'), /<img[^>]+src="data:image\/png;base64,AAAA"/)
})

// Regression: code contents must be immune to later markdown transforms.
// AE expressions are full of `*` (multiplication) — before the fix,
// `value * 2 * 3` inside code became `value <em> 2 </em> 3`.
test('inline code with asterisks is not italicized', () => {
  const out = renderMarkdown('`value * 2 * 3`')
  assert.match(out, /<code class="md-inline-code">value \* 2 \* 3<\/code>/)
  assert.ok(!/<em>/.test(out), 'no <em> may be injected inside code')
})

test('code block with asterisks/hash/dash lines stays verbatim', () => {
  const out = renderMarkdown('```\nx = a * b * c\n# comment\n- not a list\n```')
  assert.ok(!/<em>/.test(out), 'no italics inside code block')
  assert.ok(!/<ul>|<li>/.test(out), 'no lists inside code block')
  assert.ok(!/md-h1/.test(out), 'no headers inside code block')
  assert.match(out, /x = a \* b \* c\n# comment\n- not a list/)
})

test('code block newlines are not converted to <br>', () => {
  const out = renderMarkdown('```\nline1\nline2\n```')
  assert.ok(!/line1<br>line2/.test(out), 'code newlines must stay raw for <pre>')
  assert.match(out, /line1\nline2/)
})

test('code containing dollar signs renders literally', () => {
  assert.match(renderMarkdown('`cost $1 and $& here`'), /cost \$1 and \$&amp; here/)
})

test('escaping still applies inside code (no XSS regression)', () => {
  const out = renderMarkdown('`<img onerror=alert(1)>` and ```\n<script>x</script>\n```')
  assert.ok(!/<img/.test(out) && !/<script>x/.test(out))
  assert.match(out, /&lt;img/)
  assert.match(out, /&lt;script&gt;/)
})

test('markdown outside code still works alongside protected code', () => {
  const out = renderMarkdown('use **bold** with `a * b`')
  assert.match(out, /<strong>bold<\/strong>/)
  assert.match(out, /<code class="md-inline-code">a \* b<\/code>/)
})
