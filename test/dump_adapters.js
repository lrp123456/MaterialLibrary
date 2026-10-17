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
  const gen = (caps.data || {}).engines?.gen || {}
  for (const kind of ['imageAdapters', 'videoAdapters']) {
    console.log('==', kind)
    for (const a of gen[kind] || []) {
      console.log(JSON.stringify({ id: a.id, protocol: a.protocol, base_url: a.base_url, defaultModel: a.config?.defaultModel || a.defaultModel, path: a.config?.path || a.config?.submitPath }))
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
