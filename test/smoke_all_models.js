/**
 * Smoke-test catalog, jobs, optimize, chat, and gen adapters.
 * Does NOT run ingest workflow.
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
    return { status: aborted ? 0 : -1, json: { error: aborted ? `timeout ${ms}ms` : String(e.message || e) }, text: '' }
  } finally {
    t.done()
  }
}

function rows(data) {
  if (!data) return []
  if (Array.isArray(data)) return data
  if (Array.isArray(data.models)) return data.models
  const out = []
  for (const k of ['chat', 'image', 'video', 'music', 'portrait']) {
    if (Array.isArray(data[k])) out.push(...data[k].map((m) => ({ ...m, _domain: k })))
  }
  return out
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
    report.push({ ok, name, detail: String(detail || '').slice(0, 240) })
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail || ''}`)
  }

  const lanMe = await req('/api/auth/me')
  push(lanMe.status === 200 && lanMe.json?.data?.username, 'LAN auto-auth /auth/me',
    lanMe.status === 200 ? `${lanMe.json?.data?.username} ${lanMe.json?.data?.role}` : `${lanMe.status} ${JSON.stringify(lanMe.json)}`)

  const login = await req('/api/auth/login', { method: 'POST', body: { username: USER, password: PASS } })
  const token = login.json?.data?.token
  if (!token) {
    push(false, 'admin login', JSON.stringify(login.json))
    process.exit(1)
  }
  push(true, 'admin login', login.json.data.user?.username)

  const modelsRes = await req('/api/governance/gen-models', { token })
  const jobsRes = await req('/api/governance/gen-jobs', { token })
  const capsRes = await req('/api/lab/capabilities', { token })
  const models = rows(modelsRes.json?.data)
  const jobs = jobsRes.json?.data || []
  const studio = capsRes.json?.data?.studio || {}

  push(modelsRes.status === 200 && models.length > 0, 'GET /governance/gen-models',
    `n=${models.length} domains=${Object.keys(modelsRes.json?.data || {}).join(',')}`)
  push(jobsRes.status === 200 && Array.isArray(jobs) && jobs.length >= 8, 'GET /governance/gen-jobs',
    Array.isArray(jobs) ? jobs.map((j) => `${j.job_id}=${j.model_id}`).join('; ') : JSON.stringify(jobsRes.json).slice(0, 200))

  const vlmJobs = (jobs || []).filter((j) => ['gate', 'tag', 'tag_furniture'].includes(j.job_id))
  const stale = vlmJobs.filter((j) => String(j.model_id || '').includes('agnes_vision') || !j.model_id)
  const emptyCapable = vlmJobs.filter((j) => !(j.capable || []).length)
  push(!stale.length && !emptyCapable.length, 'job bindings gate/tag not stale/empty',
    vlmJobs.map((j) => `${j.job_id}:${j.model_id} capable=${(j.capable || []).length}`).join(' | '))

  const asList = (x) => {
    if (Array.isArray(x)) return x
    if (x && Array.isArray(x.models)) return x.models
    return []
  }
  const skipId = (m) => {
    const id = String(m.id || m.model_code || '')
    return /^(custom_|modelscope_|groq_|kilo_|litellm_)/.test(id)
  }
  const uniqByCode = (list) => {
    const seen = new Set()
    const out = []
    for (const m of list) {
      if (skipId(m)) continue
      const k = String(m.model_code || m.id)
      if (seen.has(k)) continue
      seen.add(k)
      out.push(m)
    }
    return out
  }
  const chatModels = uniqByCode(asList(studio.chat).length ? asList(studio.chat) : models.filter((m) => m._domain === 'chat'))
  const imageModels = uniqByCode(asList(studio.image).length ? asList(studio.image) : models.filter((m) => m._domain === 'image'))
  const videoModels = uniqByCode(asList(studio.video).length ? asList(studio.video) : models.filter((m) => m._domain === 'video'))
  push((chatModels || []).length >= 6, 'studio.chat roster', (chatModels || []).map((m) => m.id || m.model_code).join(', '))
  push((imageModels || []).length >= 4, 'studio.image roster', (imageModels || []).map((m) => m.id || m.model_code).join(', '))
  push((videoModels || []).length >= 4, 'studio.video roster', (videoModels || []).map((m) => m.id || m.model_code).join(', '))

  const optTargets = [
    { modelId: 'seedream5pro', mode: 'text_to_image' },
    { modelId: 'seedance2_5', mode: 'text_to_video' },
    { modelId: 'gemini_omni_flash', mode: 'image_to_video' },
  ]
  for (const t of optTargets) {
    const r = await req('/api/chat/optimize-prompt', {
      token,
      method: 'POST',
      ms: 25000,
      body: { prompt: '客厅落地窗边放一张原木餐桌，自然光', modelId: t.modelId, mode: t.mode, slots: {}, locked: { ratio: '9:16' } },
    })
    const opt = r.json?.data?.optimized || r.json?.optimized || ''
    push(r.status === 200 && opt.length > 10, `optimize ${t.modelId}/${t.mode}`,
      r.status === 200 ? `chars=${opt.length}` : `${r.status} ${JSON.stringify(r.json).slice(0, 180)}`)
  }

  const chatList = chatModels.length ? chatModels : asList(modelsRes.json?.data?.chat)
  console.log('\n--- chat/vision ---')
  for (const m of chatList) {
    const code = m.model_code || m.id
    const r = await req('/api/gen/chat', {
      token,
      method: 'POST',
      ms: 35000,
      body: { model: code, messages: [{ role: 'user', content: '只回复：pong' }], max_tokens: 32, temperature: 0, timeoutMs: 25000 },
    })
    const txt = chatText(r.json).replace(/\s+/g, ' ').trim()
    push(r.status === 200 && txt.length > 0, `chat ${m.id || code}`,
      r.status === 200 ? txt.slice(0, 80) : `${r.status} ${JSON.stringify(r.json).slice(0, 180)}`)
  }

  console.log('\n--- image adapters (no ingest) ---')
  for (const m of imageModels || []) {
    const schemaKeys = [
      ...((m.schema && m.schema.common) || []),
      ...((m.schema && m.schema.advanced) || []),
    ].map((f) => f.key)
    const hasSchema = schemaKeys.length > 0
    const r = await req('/api/gen/images', {
      token,
      method: 'POST',
      ms: 90000,
      body: {
        model: m.model_code || m.id,
        prompt: 'minimal indoor living room, wood table, daylight, no text',
        ratio: '1:1',
        size: (m.schema?.common || []).find((f) => f.key === 'size')?.default || '1K',
        extras: { n: 1 },
      },
    })
    const ok = r.status === 200 && (r.json?.success || r.json?.ok || (r.json?.files && r.json.files.length) || (r.json?.urls && r.json.urls.length))
    const detail = ok
      ? `files=${(r.json.files || []).length || (r.json.urls || []).length} schema=${schemaKeys.slice(0, 8).join(',')}`
      : `${r.status} schema=${hasSchema} ${JSON.stringify(r.json).slice(0, 180)}`
    push(ok, `image ${m.id || m.model_code}`, detail)
  }

  console.log('\n--- video submit (allow pending, no ingest) ---')
  for (const m of videoModels || []) {
    const r = await req('/api/gen/videos', {
      token,
      method: 'POST',
      ms: 100000,
      body: {
        model: m.model_code || m.id,
        prompt: 'slow indoor walkthrough of a bright living room, one shot, no cut',
        ratio: '16:9',
        durationSec: 4,
        extras: { duration: 4 },
      },
    })
    const ok = r.status === 200 && (r.json?.success || r.json?.ok || r.json?.pending || r.json?.taskId || (r.json?.files && r.json.files.length) || (r.json?.urls && r.json.urls.length))
    push(ok, `video ${m.id || m.model_code}`,
      ok ? `pending=${!!r.json.pending} files=${(r.json.files || []).length}` : `${r.status} ${JSON.stringify(r.json).slice(0, 180)}`)
  }

  const pass = report.filter((x) => x.ok).length
  const fail = report.filter((x) => !x.ok)
  console.log(`\n==== ${pass}/${report.length} passed, ${fail.length} failed ====`)
  for (const f of fail) console.log('  FAIL', f.name, f.detail)
  process.exit(fail.length ? 2 : 0)
}

main().catch((e) => {
  console.error('FATAL', e)
  process.exit(1)
})
