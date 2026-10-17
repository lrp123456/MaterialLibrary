const BASE = 'http://127.0.0.1:30001'
async function main() {
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '' }),
  }).then((r) => r.json())
  const token = login.data.token
  const caps = await fetch(BASE + '/api/lab/capabilities', {
    headers: { Authorization: 'Bearer ' + token },
  }).then((r) => r.json())
  const studio = (caps.data || {}).studio || {}
  for (const [k, v] of Object.entries(studio)) {
    if (Array.isArray(v)) {
      console.log(k, 'array', v.length, v.map((m) => m.id || m.model_code).join(','))
    } else if (v && typeof v === 'object') {
      const arr = v.models || v.items || []
      console.log(k, 'object', Object.keys(v).join(','), 'models', Array.isArray(arr) ? arr.length : typeof arr)
      if (Array.isArray(arr)) console.log(' ', arr.map((m) => m.id || m.model_code).join(','))
    } else console.log(k, typeof v)
  }
  const engines = (caps.data || {}).engines || {}
  console.log('engines', JSON.stringify({
    gen: engines.gen && { ready: engines.gen.ready, image: (engines.gen.imageAdapters || []).map((a) => a.id), video: (engines.gen.videoAdapters || []).map((a) => a.id) },
    umbra: engines.umbra && { ready: engines.umbra.ready },
  }))
}
main().catch((e) => { console.error(e); process.exit(1) })
