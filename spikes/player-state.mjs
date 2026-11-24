// Проверка состояния плеера через CDP: точные цифры вместо догадок по скриншоту.
const EXPR = `(() => {
  const a = document.querySelector('audio');
  if (!a) return { err: 'no audio element' };
  return {
    src: a.currentSrc ? a.currentSrc.slice(0, 42) : null,
    t: Math.round(a.currentTime * 100) / 100,
    dur: Math.round(a.duration * 100) / 100,
    paused: a.paused,
    readyState: a.readyState,
    networkState: a.networkState,
    error: a.error ? { code: a.error.code, msg: a.error.message } : null,
    volume: a.volume
  };
})()`

const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173')) ?? targets.find((t) => t.type === 'page')
if (!page) {
  console.error('нет page-таргета, вот что есть:', targets.map((t) => `${t.type} ${t.url}`))
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
const result = await new Promise((resolve, reject) => {
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id === 1) resolve(msg)
  }
  ws.onerror = reject
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: EXPR, returnByValue: true } }))
})
console.log(JSON.stringify(result.result?.result?.value ?? result, null, 1))
ws.close()
