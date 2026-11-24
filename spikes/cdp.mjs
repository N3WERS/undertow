// Универсальная проверка через CDP: node spikes/cdp.mjs "await window.undertow.state()"
const expr = process.argv.slice(2).join(' ')
if (!expr) {
  console.error('usage: node spikes/cdp.mjs "<expression>"')
  process.exit(1)
}

const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = targets.find((t) => t.type === 'page') ?? null
if (!page) {
  console.error('нет page-таргета:', targets.map((t) => `${t.type} ${t.url}`))
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))

const wrap = `(async () => { try { return { ok: true, value: ${expr} } } catch (e) { return { ok: false, error: String(e && e.message || e) } } })()`

const result = await new Promise((resolve, reject) => {
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id === 1) resolve(msg)
  }
  ws.onerror = reject
  ws.send(
    JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: wrap, awaitPromise: true, returnByValue: true }
    })
  )
})
ws.close()

const out = result.result?.result?.value ?? result
console.log(JSON.stringify(out, null, 1))
