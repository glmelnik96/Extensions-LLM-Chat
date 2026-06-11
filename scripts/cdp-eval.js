// Live-test helper: evaluate JS inside the CEP panel via Chrome DevTools Protocol.
// Usage: node scripts/cdp-eval.js "<expression>"
// The expression may return a Promise; the awaited value is printed as JSON.
let expr = process.argv[2]
if (!expr) { console.error('usage: node scripts/cdp-eval.js "<js expression>" | @file.js'); process.exit(1) }
if (expr.startsWith('@')) expr = require('fs').readFileSync(expr.slice(1), 'utf8')

async function main() {
  const targets = await (await fetch('http://localhost:8092/json')).json()
  const page = targets.find(t => t.type === 'page')
  if (!page) throw new Error('panel target not found')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

  const reply = await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('CDP timeout (120s)')), 120000)
    ws.onmessage = e => {
      const msg = JSON.parse(e.data)
      if (msg.id === 1) { clearTimeout(timer); res(msg) }
    }
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: expr, awaitPromise: true, returnByValue: true, timeout: 110000 }
    }))
  })
  ws.close()

  const r = reply.result
  if (r.exceptionDetails) {
    console.error('EXCEPTION:', JSON.stringify(r.exceptionDetails, null, 2))
    process.exit(2)
  }
  console.log(JSON.stringify(r.result.value !== undefined ? r.result.value : r.result, null, 2))
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
