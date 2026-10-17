/**
 * Remainder after first all-models smoke: seedream T2I, videos, agnes chat.
 */
const BASE = process.env.MLS_BASE_URL || 'http://127.0.0.1:30001'
const USER = process.env.ML_ADMIN_USER || 'admin'
const PASS = process.env.ML_ADMIN_PASS || ''

function timeout(ms) {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), ms)
  return { signal: c.signal, done: () => clearTimeout(t) }
}

async function req(path, { method = 'GET', token, body, ms = 25000 } = {}) {
  const t = timeout(ms)
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'X-Umbra-Internal': '1',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: t.signal,
    })
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = { raw: text.slice(0, 400) } }
    return { status: res.status, json, text }
  } catch (e) {
    const aborted = e && (e.name === 'AbortError' || /aborted/i.test(String(e.message || e)))
    return { status: 0, json: { error: aborted ? `timeout ${ms}ms` : String(e.message || e) } }
  } finally {
    t.done()
  }
}

function chatText(json) {
  return json?.choices?.[0]?.message?.content
    || json?.data?.choices?.[0]?.message?.content
    || json?.data?.text
    || json?.text
    || ''
}

async function main() {
  const report = []
  const push = (ok, name, detail) => {
    report.push({ ok, name, detail: String(detail || '').slice(0, 280) })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail || ''}`)
  }

  const login = await req('/api/auth/login', { method: 'POST', body: { username: USER, password: PASS } })
  const token = login.json?.data?.token
  if (!token) {
    push(false, 'admin login', JSON.stringify(login.json))
    process.exit(1)
  }
  push(true, 'admin login', login.json.data.user?.username)

  const rChat = await req('/api/gen/chat', {
    token, method: 'POST', ms: 35000,
    body: { model: 'agnes-3.0-flash', messages: [{ role: 'user', content: '只回复：pong' }], max_tokens: 32, temperature: 0, timeoutMs: 30000 },
  })
  const txt = chatText(rChat.json).replace(/\s+/g, ' ').trim()
  push(rChat.status === 200 && txt.length > 0, 'chat agnes-3.0-flash',
    rChat.status === 200 ? (txt.slice(0, 80) || JSON.stringify(rChat.json).slice(0, 180)) : `${rChat.status} ${JSON.stringify(rChat.json).slice(0, 180)}`)

  for (const model of ['doubao-seedream-5-0-pro-260628', 'doubao-seedream-5-0-260128']) {
    const r = await req('/api/gen/images', {
      token, method: 'POST', ms: 90000,
      body: { model, prompt: 'minimal indoor living room, wood table, daylight, no text', ratio: '1:1', size: '2K', extras: { n: 1 } },
    })
    const ok = r.status === 200 && (r.json?.success || r.json?.ok || (r.json?.files && r.json.files.length) || (r.json?.urls && r.json.urls.length))
    push(ok, `image ${model}`, ok
      ? `files=${(r.json.files || []).length}`
      : `${r.status} ${JSON.stringify(r.json).slice(0, 220)}`)
  }

  const videos = [
    'doubao-seedance-2-5',
    'doubao-seedance-2-0',
    'agnes-video-2.5-flash',
    'gemini-omni-1.1-flash',
    'veo-3.1-generate-preview',
    'veo-3.1-fast-generate-preview',
    'veo-3.1-lite-generate-preview',
  ]
  // use studio ids too if codes fail — capabilities dump used ids
  const videoIds = [
    'seedance2_5', 'seedance2_0', 'agnes_video_2_5_flash',
    'gemini_omni_flash', 'veo_3_generate', 'veo_3_fast_generate', 'veo_3_lite_generate',
  ]
  console.log('\n--- video submit ---')
  for (const model of videoIds) {
    const r = await req('/api/gen/videos', {
      token, method: 'POST', ms: 100000,
      body: {
        model,
        prompt: 'slow indoor walkthrough of a bright living room, one shot, no cut',
        ratio: '16:9',
        durationSec: 4,
        extras: { duration: 4 },
      },
    })
    const ok = r.status === 200 && (r.json?.success || r.json?.ok || r.json?.pending || r.json?.taskId || (r.json?.files && r.json.files.length) || (r.json?.urls && r.json.urls.length))
    push(ok, `video ${model}`,
      ok ? `pending=${!!r.json.pending} taskId=${r.json.taskId || ''} files=${(r.json.files || []).length}` : `${r.status} ${JSON.stringify(r.json).slice(0, 220)}`)
  }

  const pass = report.filter((x) => x.ok).length
  const fail = report.filter((x) => !x.ok)
  console.log(`\n==== ${pass}/${report.length} passed, ${fail.length} failed ====`)
  for (const f of fail) console.log('  FAIL', f.name, f.detail)
  process.exit(fail.length ? 2 : 0)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
