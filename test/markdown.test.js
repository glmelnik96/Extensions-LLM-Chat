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
