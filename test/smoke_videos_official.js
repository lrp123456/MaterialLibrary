const BASE = 'http://127.0.0.1:30001'
async function req(path, token, body, ms = 100000) {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), ms)
  try {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, 'X-Umbra-Internal': '1' },
      body: JSON.stringify(body),
      signal: c.signal,
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { json = { raw: text.slice(0, 300) } }
    return { status: res.status, json }
  } catch (e) {
    return { status: 0, json: { error: String(e.message || e) } }
  } finally { clearTimeout(t) }
}
async function main() {
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: '' }),
  }).then((r) => r.json())
  const token = login.data.token
  const models = [
    { id: 'seedance2_5', code: 'doubao-seedance-2-5-260628', adapterId: 'ark_seedance' },
    { id: 'seedance2_0', code: 'doubao-seedance-2-0-260128', adapterId: 'ark_seedance' },
    { id: 'agnes_video_2_5_flash', code: 'agnes-video-2.5-flash', adapterId: 'agnes_video' },
  ]
  for (const m of models) {
    const r = await req('/api/gen/videos', token, {
      model: m.code,
      adapterId: m.adapterId,
      prompt: 'slow indoor walkthrough of a bright living room, one shot, no cut',
      ratio: '16:9',
      durationSec: 4,
    })
    const ok = r.status === 200 && (r.json?.success || r.json?.ok || r.json?.pending || r.json?.taskId || (r.json?.files && r.json.files.length))
    console.log(`${ok ? 'PASS' : 'FAIL'}  video ${m.id} (${m.code})  ${ok ? `pending=${!!r.json.pending} taskId=${r.json.taskId || ''} files=${(r.json.files || []).length}` : `${r.status} ${JSON.stringify(r.json).slice(0, 240)}`}`)
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
